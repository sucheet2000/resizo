import { NextResponse } from 'next/server';
import JSZip from 'jszip';
import sharp from 'sharp';
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

export const maxDuration = 60;

const MAX_FILE_SIZE = 20 * 1024 * 1024;
const MAX_FILES = 20;
const MAX_DIMENSION = 8000;
const ALLOWED_FORMATS = ['jpeg', 'png', 'webp'];

const ratelimit = new Ratelimit({
    redis: Redis.fromEnv(),
    limiter: Ratelimit.slidingWindow(5, '1 m'),
    analytics: true,
});

export async function POST(request) {
    try {
        // Rate limiting — use x-real-ip (set by Vercel, cannot be spoofed by client)
        // Fall back to the rightmost (Vercel-appended) IP in X-Forwarded-For chain
        const ip = request.headers.get('x-real-ip')
            ?? request.headers.get('x-forwarded-for')?.split(',').pop()?.trim()
            ?? '127.0.0.1';
        const { success, limit, remaining } = await ratelimit.limit(`bulk_${ip}`);

        if (!success) {
            return NextResponse.json(
                { error: 'Too many requests. Please wait before processing again.' },
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

        const filesToProcess = [];
        let i = 0;
        while (formData.has(`file_${i}`)) {
            const file = formData.get(`file_${i}`);
            const configStr = formData.get(`config_${i}`);

            // Safe JSON parse with fallback to empty config
            let config = {};
            if (configStr) {
                try {
                    config = JSON.parse(configStr);
                } catch {
                    config = {};
                }
            }

            if (file) {
                filesToProcess.push({ file, config, index: i });
            }
            i++;

            // T1: Hard server-side cap — max 20 files per request
            if (filesToProcess.length >= MAX_FILES) break;
        }

        if (filesToProcess.length === 0) {
            return NextResponse.json({ error: 'No files provided.' }, { status: 400 });
        }

        const zip = new JSZip();

        for (const { file, config, index } of filesToProcess) {

            // Validate file type
            if (!file.type.startsWith('image/')) {
                return NextResponse.json({ error: `File ${index} is not a valid image.` }, { status: 400 });
            }

            // Validate file size
            if (file.size > MAX_FILE_SIZE) {
                return NextResponse.json({ error: `File ${index} exceeds 20MB.` }, { status: 400 });
            }

            const arrayBuffer = await file.arrayBuffer();
            const buffer = Buffer.from(arrayBuffer);

            // T10: Strict magic bytes — consistent with single-resize route
            // JPEG:  FF D8 FF (3 bytes)
            // PNG:   89 50 4E 47 (4 bytes)
            // WebP:  RIFF at 0-3 AND WEBP at 8-11 (full container check)
            // GIF:   GIF87a (47 49 46 38 37 61) or GIF89a (47 49 46 38 39 61)
            const isJpeg = buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF;
            const isPng  = buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47;
            const isWebp = buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46
                        && buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50;
            const isGif  = (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x38 && buffer[4] === 0x37 && buffer[5] === 0x61)
                        || (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x38 && buffer[4] === 0x39 && buffer[5] === 0x61);

            if (!isJpeg && !isPng && !isWebp && !isGif) {
                return NextResponse.json({ error: `File ${index} failed validation.` }, { status: 400 });
            }

            let pipeline = sharp(buffer);
            const originalMeta = await pipeline.metadata();

            // T4: Server-side dimension bounds — reject requests that exceed limits
            if (config.width || config.height) {
                const resizeOptions = {};
                if (config.width) {
                    const w = parseInt(config.width, 10);
                    if (!Number.isFinite(w) || w < 1 || w > MAX_DIMENSION) {
                        return NextResponse.json({ error: 'Dimensions exceed maximum allowed values.' }, { status: 400 });
                    }
                    resizeOptions.width = w;
                }
                if (config.height) {
                    const h = parseInt(config.height, 10);
                    if (!Number.isFinite(h) || h < 1 || h > MAX_DIMENSION) {
                        return NextResponse.json({ error: 'Dimensions exceed maximum allowed values.' }, { status: 400 });
                    }
                    resizeOptions.height = h;
                }
                pipeline = pipeline.resize(resizeOptions);
            }

            pipeline = pipeline.withMetadata(false);

            // T8: Validate output format against explicit allowlist
            const rawFormat = config.format && config.format !== 'same'
                ? config.format
                : (originalMeta.format === 'jpeg' ? 'jpeg' : originalMeta.format) || 'jpeg';
            const outputFormat = ALLOWED_FORMATS.includes(rawFormat) ? rawFormat : 'jpeg';

            if (outputFormat === 'png') {
                pipeline = pipeline.png();
            } else if (outputFormat === 'webp') {
                pipeline = pipeline.webp();
            } else {
                pipeline = pipeline.jpeg({ quality: 85 });
            }

            const processedBuffer = await pipeline.toBuffer();
            const outputMeta = await sharp(processedBuffer).metadata();
            const w = outputMeta.width || config.width || originalMeta.width;
            const h = outputMeta.height || config.height || originalMeta.height;
            const ext = outputFormat === 'jpeg' ? 'jpg' : outputFormat;

            const baseName = file.name
                ? file.name.replace(/\.[^/.]+$/, '').replace(/[^a-zA-Z0-9-_]/g, '')
                : `image_${index}`;

            zip.file(`resizo-${baseName}-${w}x${h}.${ext}`, processedBuffer);
        }

        const zipBuffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });

        return new NextResponse(zipBuffer, {
            status: 200,
            headers: {
                'Content-Type': 'application/zip',
                'Content-Disposition': 'attachment; filename="resizo-bulk.zip"',
            },
        });

    } catch (error) {
        // T3: Log full error server-side but return a generic message to the client
        console.error('Bulk resize error:', error.message, error.stack);
        return NextResponse.json({ error: 'An internal server error occurred while processing the images.' }, { status: 500 });
    }
}
