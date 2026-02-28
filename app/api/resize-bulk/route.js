import { NextResponse } from 'next/server';
import JSZip from 'jszip';
import sharp from 'sharp';
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

export const maxDuration = 60;

const MAX_FILE_SIZE = 20 * 1024 * 1024;

const ratelimit = new Ratelimit({
    redis: Redis.fromEnv(),
    limiter: Ratelimit.slidingWindow(5, '1 m'),
    analytics: true,
});

export async function POST(request) {
    try {
        // Rate limiting
        const ip = request.headers.get('x-forwarded-for') ?? '127.0.0.1';
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

            // Validate magic bytes server-side
            const magicBytes = buffer.slice(0, 12);
            const isJpeg = magicBytes[0] === 0xFF && magicBytes[1] === 0xD8;
            const isPng = magicBytes[0] === 0x89 && magicBytes[1] === 0x50;
            const isWebp = magicBytes[8] === 0x57 && magicBytes[9] === 0x45;
            const isGif = magicBytes[0] === 0x47 && magicBytes[1] === 0x49;

            if (!isJpeg && !isPng && !isWebp && !isGif) {
                return NextResponse.json({ error: `File ${index} failed validation.` }, { status: 400 });
            }

            let pipeline = sharp(buffer);
            const originalMeta = await pipeline.metadata();

            if (config.width || config.height) {
                const resizeOptions = {};
                if (config.width) resizeOptions.width = parseInt(config.width, 10);
                if (config.height) resizeOptions.height = parseInt(config.height, 10);
                pipeline = pipeline.resize(resizeOptions);
            }

            pipeline = pipeline.withMetadata(false);

            const outputFormat = config.format && config.format !== 'same'
                ? config.format
                : (originalMeta.format === 'jpeg' ? 'jpeg' : originalMeta.format) || 'jpeg';

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
        console.error('Bulk resize error:', error.message, error.stack);
        return NextResponse.json({ error: `Processing failed: ${error.message}` }, { status: 500 });
    }
}
