import { NextResponse } from 'next/server';
import sharp from 'sharp';

export const maxDuration = 60;

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB

export async function POST(request) {
    try {
        // 1. Parse the multipart form data
        const formData = await request.formData();
        const file = formData.get('file');

        if (!file) {
            return NextResponse.json({ error: 'No file provided in the request.' }, { status: 400 });
        }

        // 2. Validate file type
        if (!file.type.startsWith('image/')) {
            return NextResponse.json({ error: 'Invalid file type. Only images are allowed.' }, { status: 400 });
        }

        // 3. Validate file size (20MB limit)
        if (file.size > MAX_FILE_SIZE) {
            return NextResponse.json({ error: 'File exceeds the maximum allowed size of 20MB.' }, { status: 400 });
        }

        const widthParam = formData.get('width');
        const heightParam = formData.get('height');
        const scaleParam = formData.get('scale');
        const formatParam = formData.get('format') || 'jpeg';

        const arrayBuffer = await file.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        // 4. Initialize Sharp instance and retrieve original metadata needed for scaling calculations
        let pipeline = sharp(buffer);
        const metadata = await pipeline.metadata();

        let resizeOptions = {};

        // 5. Determine resize parameters either by explicit dimensions or by scale percentage
        if (widthParam || heightParam) {
            if (widthParam) resizeOptions.width = parseInt(widthParam, 10);
            if (heightParam) resizeOptions.height = parseInt(heightParam, 10);

            // Prevent invalid values
            if (resizeOptions.width <= 0) delete resizeOptions.width;
            if (resizeOptions.height <= 0) delete resizeOptions.height;

        } else if (scaleParam) {
            const scalePct = parseFloat(scaleParam);
            if (scalePct > 0 && metadata.width && metadata.height) {
                resizeOptions.width = Math.round(metadata.width * (scalePct / 100));
                resizeOptions.height = Math.round(metadata.height * (scalePct / 100));
            } else {
                return NextResponse.json({ error: 'Invalid scale parameter provided.' }, { status: 400 });
            }
        }

        // Apply the resize operation if valid dimensions were collected
        if (Object.keys(resizeOptions).length > 0) {
            pipeline = pipeline.resize(resizeOptions);
        }

        // 6. Set output format
        if (formatParam === 'png') {
            pipeline = pipeline.png();
        } else if (formatParam === 'webp') {
            pipeline = pipeline.webp();
        } else {
            // Default to JPEG
            pipeline = pipeline.jpeg();
        }

        // 7. Strip metadata using withMetadata(false) for privacy
        pipeline = pipeline.withMetadata(false);

        // 8. Process the buffer
        const processedBuffer = await pipeline.toBuffer();

        // 9. Construct and return the binary response
        const headers = new Headers();
        headers.set('Content-Type', `image/${formatParam}`);
        headers.set('Content-Length', processedBuffer.length.toString());

        // Set Content-Disposition to force a direct file download
        const safeName = file.name ? file.name.replace(/[^a-zA-Z0-9.\-_]/g, '') : 'image';
        const splitName = safeName.split('.');
        const baseName = splitName.length > 1 ? splitName.slice(0, -1).join('.') : safeName;
        const finalExt = formatParam === 'jpeg' ? 'jpg' : formatParam;

        headers.set('Content-Disposition', `attachment; filename="resizo-processed-${baseName}.${finalExt}"`);

        return new NextResponse(processedBuffer, {
            status: 200,
            headers: headers,
        });

    } catch (error) {
        console.error('Resize API Error:', error);
        return NextResponse.json({ error: 'An internal server error occurred while processing the image.' }, { status: 500 });
    }
}
