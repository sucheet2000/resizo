import { withToolRoute } from '@/lib/api/with-tool-route';
import { CONVERT_INPUT_FORMATS, CONVERT_OUTPUT_FORMATS } from '@/lib/constants';
import { imageResponse, jsonError } from '@/lib/http/responses';
import { buildOutputFilename } from '@/lib/image/filename';
import { applyOutputFormat, createPipeline } from '@/lib/image/pipeline';

export const runtime = 'nodejs';
export const maxDuration = 60;

export const POST = withToolRoute({
    name: 'convert',
    accept: CONVERT_INPUT_FORMATS,
    invalidTypeError: 'File failed validation. Please upload a valid JPEG, PNG, WebP, or AVIF image.',
    errorMessage: 'An internal server error occurred while converting the image.',
    handler: async ({ formData, file, buffer, remaining }) => {
        const targetFormat = formData.get('target_format');
        if (!CONVERT_OUTPUT_FORMATS.includes(targetFormat)) {
            return jsonError('Invalid target format. Must be jpeg, png, webp, or avif.', 400);
        }

        // No quality is passed on purpose: a format conversion must not
        // quantise a PNG down to a palette the way /compress deliberately does.
        // AVIF and WebP take the encoder default from applyOutputFormat.
        const pipeline = applyOutputFormat(createPipeline(buffer), targetFormat);
        const processed = await pipeline.toBuffer();

        return imageResponse(processed, {
            format: targetFormat,
            filename: buildOutputFilename({ name: file.name, prefix: 'resizo-converted', format: targetFormat }),
            remaining,
        });
    },
});
