import { NextResponse } from 'next/server';
import heicConvert from 'heic-convert';
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB

const ratelimit = new Ratelimit({
    redis: Redis.fromEnv(),
    limiter: Ratelimit.slidingWindow(10, '1 m'),
    analytics: true,
});

export const maxDuration = 60;

export async function POST(request) {
    try {
        const ip = request.headers.get('x-real-ip')
            ?? request.headers.get('x-forwarded-for')?.split(',').pop()?.trim()
            ?? '127.0.0.1';
        const { success, limit, remaining } = await ratelimit.limit(ip);

        if (!success) {
            return NextResponse.json(
                { error: 'Too many requests. Please wait a moment before converting again.' },
                {
                    status: 429,
                    headers: {
                        'X-RateLimit-Limit': limit.toString(),
                        'X-RateLimit-Remaining': remaining.toString(),
                    },
                }
            );
        }

        const formData = await request.formData();
        const file = formData.get('file');

        if (!file) {
            return NextResponse.json({ error: 'No file provided in the request.' }, { status: 400 });
        }

        // C-2: File size limit
        if (file.size > MAX_FILE_SIZE) {
            return NextResponse.json({ error: 'File exceeds the maximum allowed size of 20MB.' }, { status: 400 });
        }

        if (!file.name.toLowerCase().endsWith('.heic') && !file.name.toLowerCase().endsWith('.heif') && file.type !== 'image/heic' && file.type !== 'image/heif') {
            return NextResponse.json({ error: 'Invalid file type. Please upload a HEIC or HEIF image.' }, { status: 400 });
        }

        const arrayBuffer = await file.arrayBuffer();
        const inputBuffer = Buffer.from(arrayBuffer);

        // C-3: Magic bytes validation — HEIC/HEIF is an ISO Base Media File (ISOBMFF).
        // The 'ftyp' box appears at bytes 4–7. Bytes 0–3 are the box length (variable),
        // so we check the box type only.
        const isFtyp =
            inputBuffer[4] === 0x66 && // f
            inputBuffer[5] === 0x74 && // t
            inputBuffer[6] === 0x79 && // y
            inputBuffer[7] === 0x70;   // p
        if (!isFtyp) {
            return NextResponse.json({ error: 'File failed validation. Please upload a valid HEIC or HEIF image.' }, { status: 400 });
        }

        // C-1: heic-convert v2+ returns ArrayBuffer, not Buffer — wrap before use.
        let rawOutput;
        try {
            rawOutput = await heicConvert({
                buffer: inputBuffer,
                format: 'JPEG',
                quality: 0.9,
            });
        } catch (convertError) {
            console.error('heic-convert inner error:', convertError);
            return NextResponse.json({ error: 'An error occurred while converting the image.' }, { status: 500 });
        }

        const outputBuffer = Buffer.isBuffer(rawOutput) ? rawOutput : Buffer.from(rawOutput);

        const headers = new Headers();
        headers.set('Content-Type', 'image/jpeg');
        headers.set('Content-Length', outputBuffer.length.toString());
        headers.set('X-RateLimit-Remaining', remaining.toString());

        const safeName = file.name ? file.name.replace(/[^a-zA-Z0-9.\-_]/g, '') : 'image';
        const splitName = safeName.split('.');
        const baseName = splitName.length > 1 ? splitName.slice(0, -1).join('.') : safeName;

        headers.set('Content-Disposition', `attachment; filename="resizo-converted-${baseName}.jpg"`);

        return new NextResponse(outputBuffer, { status: 200, headers });
    } catch (error) {
        console.error('HEIC API Error:', error);
        return NextResponse.json({ error: 'An internal server error occurred while processing the file.' }, { status: 500 });
    }
}
