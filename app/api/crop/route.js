import { NextResponse } from 'next/server';
import sharp from 'sharp';
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
                { error: 'Too many requests. Please wait a moment before cropping again.' },
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

        const cxStr = formData.get('crop_x');
        const cyStr = formData.get('crop_y');
        const cwStr = formData.get('crop_width');
        const chStr = formData.get('crop_height');

        if (!cxStr || !cyStr || !cwStr || !chStr) {
            return NextResponse.json({ error: 'Missing crop parameters (crop_x, crop_y, crop_width, crop_height).' }, { status: 400 });
        }

        const crop_x = parseInt(cxStr, 10);
        const crop_y = parseInt(cyStr, 10);
        const crop_width = parseInt(cwStr, 10);
        const crop_height = parseInt(chStr, 10);

        if (isNaN(crop_x) || isNaN(crop_y) || isNaN(crop_width) || isNaN(crop_height) || crop_width <= 0 || crop_height <= 0 || crop_x < 0 || crop_y < 0) {
            return NextResponse.json({ error: 'Invalid crop parameters provided.' }, { status: 400 });
        }

        const arrayBuffer = await file.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        const isJPEG = buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF;
        const isPNG = buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47;
        const isWEBP = buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46
            && buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50;

        if (!isJPEG && !isPNG && !isWEBP) {
            return NextResponse.json({ error: 'File failed validation. Please upload a valid JPEG, PNG, or WebP image.' }, { status: 400 });
        }

        let pipeline = sharp(buffer);
        const metadata = await pipeline.metadata();

        if (crop_x + crop_width > metadata.width || crop_y + crop_height > metadata.height) {
            return NextResponse.json({ error: 'Crop parameters are out of bounds of the original image dimensions.' }, { status: 400 });
        }

        pipeline = pipeline.extract({ left: crop_x, top: crop_y, width: crop_width, height: crop_height });
        pipeline = pipeline.withMetadata(false);

        let formatParam = 'jpeg';
        if (isPNG) formatParam = 'png';
        if (isWEBP) formatParam = 'webp';

        const processedBuffer = await pipeline.toBuffer();

        const headers = new Headers();
        headers.set('Content-Type', `image/${formatParam}`);
        headers.set('Content-Length', processedBuffer.length.toString());
        headers.set('X-RateLimit-Remaining', remaining.toString());

        const safeName = file.name ? file.name.replace(/[^a-zA-Z0-9.\-_]/g, '') : 'image';
        const splitName = safeName.split('.');
        const baseName = splitName.length > 1 ? splitName.slice(0, -1).join('.') : safeName;
        const finalExt = formatParam === 'jpeg' ? 'jpg' : formatParam;

        headers.set('Content-Disposition', `attachment; filename="resizo-cropped-${baseName}.${finalExt}"`);

        return new NextResponse(processedBuffer, { status: 200, headers });
    } catch (error) {
        console.error('Crop API Error:', error);
        return NextResponse.json({ error: 'An internal server error occurred while cropping the image.' }, { status: 500 });
    }
}
