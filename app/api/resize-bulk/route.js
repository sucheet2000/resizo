import JSZip from 'jszip';
import sharp from 'sharp';
import { NextResponse } from 'next/server';

export const maxDuration = 60;

const MAX_FILE_SIZE = 20 * 1024 * 1024;

export async function POST(request) {
    try {
        const formData = await request.formData();

        const filesToProcess = [];
        let i = 0;
        while (formData.has(`file_${i}`)) {
            const file = formData.get(`file_${i}`);
            const configStr = formData.get(`config_${i}`);

            // Use empty config if none assigned (DEFAULT CONFIG case)
            const config = configStr ? JSON.parse(configStr) : {};

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

            let pipeline = sharp(buffer);

            // Get original metadata for fallback dimensions
            const originalMeta = await pipeline.metadata();

            // Apply resize if config has dimensions
            if (config.width || config.height) {
                const resizeOptions = {};
                if (config.width) resizeOptions.width = parseInt(config.width, 10);
                if (config.height) resizeOptions.height = parseInt(config.height, 10);
                pipeline = pipeline.resize(resizeOptions);
            }

            // Strip metadata for privacy
            pipeline = pipeline.withMetadata(false);

            // Apply format - default to original format if none specified
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

            // Get output dimensions
            const outputMeta = await sharp(processedBuffer).metadata();
            const w = outputMeta.width || config.width || originalMeta.width;
            const h = outputMeta.height || config.height || originalMeta.height;
            const ext = outputFormat === 'jpeg' ? 'jpg' : outputFormat;

            // Clean filename
            const baseName = file.name
                ? file.name.replace(/\.[^/.]+$/, '').replace(/[^a-zA-Z0-9-_]/g, '')
                : `image_${index}`;

            zip.file(`resizo-${baseName}-${w}x${h}.${ext}`, processedBuffer);
        }

        // Generate ZIP buffer
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
