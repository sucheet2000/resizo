import { NextResponse } from 'next/server';
import sharp from 'sharp';
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB
const MAX_DIMENSION = 8000;
const ALLOWED_FORMATS = ['jpeg', 'png', 'webp'];

// Allow 10 requests per IP per minute
const ratelimit = new Ratelimit({
    redis: Redis.fromEnv(),
    limiter: Ratelimit.slidingWindow(10, '1 m'),
    analytics: true,
});

export const maxDuration = 60;

export async function POST(request) {
    try {
        // 1. Rate limiting — use x-real-ip (set by Vercel, cannot be spoofed by client)
        // Fall back to the rightmost (Vercel-appended) IP in X-Forwarded-For chain
        const ip = request.headers.get('x-real-ip')
            ?? request.headers.get('x-forwarded-for')?.split(',').pop()?.trim()
            ?? '127.0.0.1';
        const { success, limit, remaining } = await ratelimit.limit(ip);

        if (!success) {
            return NextResponse.json(
                { error: 'Too many requests. Please wait a moment before resizing again.' },
                {
                    status: 429,
                    headers: {
                        'X-RateLimit-Limit': limit.toString(),
                        'X-RateLimit-Remaining': remaining.toString(),
                    },
                }
            );
        }

        // 2. Parse the multipart form data
        const formData = await request.formData();
        const file = formData.get('file');

        if (!file) {
            return NextResponse.json({ error: 'No file provided in the request.' }, { status: 400 });
        }

        // 3. Validate file type
        if (!file.type.startsWith('image/')) {
            return NextResponse.json({ error: 'Invalid file type. Only images are allowed.' }, { status: 400 });
        }

        // 4. Validate file size (20MB limit)
        if (file.size > MAX_FILE_SIZE) {
            return NextResponse.json({ error: 'File exceeds the maximum allowed size of 20MB.' }, { status: 400 });
        }

        const widthParam = formData.get('width');
        const heightParam = formData.get('height');
        const scaleParam = formData.get('scale');

        // 5. T8: Validate format against explicit allowlist before use in Content-Type header
        const rawFormat = formData.get('format') || 'jpeg';
        const formatParam = ALLOWED_FORMATS.includes(rawFormat) ? rawFormat : 'jpeg';

        const arrayBuffer = await file.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        // 6. Validate magic bytes — reject spoofed Content-Type headers
        //    JPEG: FF D8 FF  |  PNG: 89 50 4E 47  |  WebP: RIFF....WEBP  |  GIF: GIF87a or GIF89a
        const isJPEG = buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF;
        const isPNG  = buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47;
        const isWEBP = buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50;
        const isGIF  = buffer[0] === 0x47 && buffer[1] === 0x49;

        if (!isJPEG && !isPNG && !isWEBP && !isGIF) {
            return NextResponse.json(
                { error: 'File failed validation. Please upload a valid image.' },
                { status: 400 }
            );
        }

        // 7. Initialize Sharp and retrieve metadata for scaling calculations
        let pipeline = sharp(buffer);
        const metadata = await pipeline.metadata();

        let resizeOptions = {};

        // 8. T4: Determine resize parameters with server-side bounds enforcement
        if (widthParam || heightParam) {
            if (widthParam) {
                const w = parseInt(widthParam, 10);
                if (!Number.isFinite(w) || w < 1 || w > MAX_DIMENSION) {
                    return NextResponse.json({ error: 'Dimensions exceed maximum allowed values.' }, { status: 400 });
                }
                resizeOptions.width = w;
            }
            if (heightParam) {
                const h = parseInt(heightParam, 10);
                if (!Number.isFinite(h) || h < 1 || h > MAX_DIMENSION) {
                    return NextResponse.json({ error: 'Dimensions exceed maximum allowed values.' }, { status: 400 });
                }
                resizeOptions.height = h;
            }
        } else if (scaleParam) {
            const scalePct = parseFloat(scaleParam);
            if (!Number.isFinite(scalePct) || scalePct <= 0 || scalePct > 400) {
                return NextResponse.json({ error: 'Dimensions exceed maximum allowed values.' }, { status: 400 });
            }
            if (metadata.width && metadata.height) {
                resizeOptions.width = Math.round(metadata.width * (scalePct / 100));
                resizeOptions.height = Math.round(metadata.height * (scalePct / 100));
            } else {
                return NextResponse.json({ error: 'Invalid scale parameter provided.' }, { status: 400 });
            }
        }

        if (Object.keys(resizeOptions).length > 0) {
            pipeline = pipeline.resize(resizeOptions);
        }

        // 9. Set output format
        if (formatParam === 'png') {
            pipeline = pipeline.png();
        } else if (formatParam === 'webp') {
            pipeline = pipeline.webp();
        } else {
            pipeline = pipeline.jpeg();
        }

        // 10. Strip all metadata for privacy
        pipeline = pipeline.withMetadata(false);

        // 11. Process the buffer
        const processedBuffer = await pipeline.toBuffer();

        // 12. Construct and return the binary response
        const headers = new Headers();
        headers.set('Content-Type', `image/${formatParam}`);
        headers.set('Content-Length', processedBuffer.length.toString());
        headers.set('X-RateLimit-Remaining', remaining.toString());

        const safeName = file.name ? file.name.replace(/[^a-zA-Z0-9.\-_]/g, '') : 'image';
        const splitName = safeName.split('.');
        const baseName = splitName.length > 1 ? splitName.slice(0, -1).join('.') : safeName;
        const finalExt = formatParam === 'jpeg' ? 'jpg' : formatParam;

        headers.set('Content-Disposition', `attachment; filename="resizo-processed-${baseName}.${finalExt}"`);

        return new NextResponse(processedBuffer, { status: 200, headers });

    } catch (error) {
        console.error('Resize API Error:', error);
        return NextResponse.json({ error: 'An internal server error occurred while processing the image.' }, { status: 500 });
    }
}
