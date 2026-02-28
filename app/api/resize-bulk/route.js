import JSZip from 'jszip';
import sharp from 'sharp';
import { NextResponse } from 'next/server';

export const maxDuration = 60;

// Maximum allowed size per file (20MB)
const MAX_FILE_SIZE = 20 * 1024 * 1024;

export async function POST(request) {
    try {
        // Parse incoming multipart form data
        const formData = await request.formData();

        // Extract files and their configurations
        const filesToProcess = [];
        let i = 0;
        while (formData.has(`file_${i}`)) {
            const file = formData.get(`file_${i}`);
            const configStr = formData.get(`config_${i}`);

            if (file && configStr) {
                filesToProcess.push({
                    file,
                    config: JSON.parse(configStr),
                    index: i
                });
            }
            i++;
        }

        if (filesToProcess.length === 0) {
            return NextResponse.json(
                { error: 'No files provided for processing' },
                { status: 400 }
            );
        }

        // Initialize JSZip for bundling images
        const zip = new JSZip();

        // Process each file with its configuration
        for (const { file, config, index } of filesToProcess) {

            // Validate file type
            if (!file.type.startsWith('image/')) {
                return NextResponse.json(
                    { error: `File at index ${index} is not an image type.` },
                    { status: 400 }
                );
            }

            // Validate file size under 20MB
            if (file.size > MAX_FILE_SIZE) {
                return NextResponse.json(
                    { error: `File at index ${index} exceeds 20MB.` },
                    { status: 400 }
                );
            }

            // Read file into buffer
            const arrayBuffer = await file.arrayBuffer();
            const buffer = Buffer.from(arrayBuffer);

            // Initialize Sharp
            let sharpInstance = sharp(buffer);

            // Resize by width or height if provided
            if (config.width || config.height) {
                const resizeOptions = {};
                if (config.width) resizeOptions.width = parseInt(config.width, 10);
                if (config.height) resizeOptions.height = parseInt(config.height, 10);

                sharpInstance = sharpInstance.resize(resizeOptions);
            }

            // Strip metadata
            sharpInstance = sharpInstance.withMetadata(false);

            // Convert format
            if (config.format) {
                sharpInstance = sharpInstance.toFormat(config.format);
            }

            // Execute processing to a buffer
            const processedBuffer = await sharpInstance.toBuffer();

            // Determine resulting format and dimensions
            const metadata = await sharp(processedBuffer).metadata();
            const outputWidth = metadata.width;
            const outputHeight = metadata.height;
            const outputExt = config.format || metadata.format || 'jpg';

            // Parse original filename safely
            let originalName = 'image';
            if (file.name) {
                const lastDotIndex = file.name.lastIndexOf('.');
                originalName = lastDotIndex !== -1 ? file.name.substring(0, lastDotIndex) : file.name;
            }

            // Bundle processed image into JSZip
            const finalFileName = `resizo-${originalName}-${outputWidth}x${outputHeight}.${outputExt}`;
            zip.file(finalFileName, processedBuffer);
        }

        // Generate ZIP archive as binary
        const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });

        // Return the ZIP binary
        return new NextResponse(zipBuffer, {
            status: 200,
            headers: {
                'Content-Type': 'application/zip',
                'Content-Disposition': 'attachment; filename="resizo-bulk.zip"',
            },
        });

    } catch (error) {
        console.error('Bulk resize processing error:', error);
        return NextResponse.json(
            { error: 'An error occurred during bulk processing' },
            { status: 500 }
        );
    }
}
