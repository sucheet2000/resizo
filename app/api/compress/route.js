import { NextResponse } from 'next/server';
import sharp from 'sharp';
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB
const DEFAULT_QUALITY = 80;

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
                { error: 'Too many requests. Please wait a moment before compressing again.' },
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

        if (!file.type.startsWith('image/')) {
            return NextResponse.json({ error: 'Invalid file type. Only images are allowed.' }, { status: 400 });
        }

        if (file.size > MAX_FILE_SIZE) {
            return NextResponse.json({ error: 'File exceeds the maximum allowed size of 20MB.' }, { status: 400 });
        }

        const qualityParam = formData.get('quality');
        let quality = DEFAULT_QUALITY;
        if (qualityParam !== null) {
            const parsed = parseInt(qualityParam, 10);
            if (!Number.isNaN(parsed) && parsed >= 1 && parsed <= 100) {
                quality = parsed;
            } else {
                return NextResponse.json({ error: 'Quality must be an integer between 1 and 100.' }, { status: 400 });
            }
        }

        const arrayBuffer = await file.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        // Magic bytes validation
        const isJPEG = buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF;
        const isPNG = buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47;
        const isWEBP = buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46
            && buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50;

        if (!isJPEG && !isPNG && !isWEBP) {
            return NextResponse.json({ error: 'File failed validation. Please upload a valid JPEG, PNG, or WebP image.' }, { status: 400 });
        }

        let formatParam = 'jpeg';
        if (isPNG) formatParam = 'png';
        if (isWEBP) formatParam = 'webp';

        let pipeline = sharp(buffer);

        if (formatParam === 'jpeg') {
            pipeline = pipeline.jpeg({ quality });
        } else if (formatParam === 'webp') {
            pipeline = pipeline.webp({ quality });
        } else if (formatParam === 'png') {
            pipeline = pipeline.png({ compressionLevel: Math.round((100 - quality) / 11) });
        }

        pipeline = pipeline.withMetadata(false);
        const processedBuffer = await pipeline.toBuffer();

        const headers = new Headers();
        headers.set('Content-Type', `image/${formatParam}`);
        headers.set('Content-Length', processedBuffer.length.toString());
        headers.set('X-RateLimit-Remaining', remaining.toString());

        const safeName = file.name ? file.name.replace(/[^a-zA-Z0-9.\-_]/g, '') : 'image';
        const splitName = safeName.split('.');
        const baseName = splitName.length > 1 ? splitName.slice(0, -1).join('.') : safeName;
        const finalExt = formatParam === 'jpeg' ? 'jpg' : formatParam;

        headers.set('Content-Disposition', `attachment; filename="resizo-compressed-${baseName}.${finalExt}"`);

        return new NextResponse(processedBuffer, { status: 200, headers });
    } catch (error) {
        console.error('Compress API Error:', error);
        return NextResponse.json({ error: 'An internal server error occurred while compressing the image.' }, { status: 500 });
    }
}
