import { withToolRoute } from '@/lib/api/with-tool-route';
import { RASTER_INPUT_FORMATS } from '@/lib/constants';
import { imageResponse, jsonError } from '@/lib/http/responses';
import { isCropInBounds, parseCropParams } from '@/lib/image/crop';
import { buildOutputFilename } from '@/lib/image/filename';
import { applyOutputFormat, createPipeline } from '@/lib/image/pipeline';

export const runtime = 'nodejs';
export const maxDuration = 60;

export const POST = withToolRoute({
    name: 'crop',
    accept: RASTER_INPUT_FORMATS,
    invalidTypeError: 'File failed validation. Please upload a valid JPEG, PNG, or WebP image.',
    errorMessage: 'An internal server error occurred while cropping the image.',
    handler: async ({ formData, file, buffer, sourceFormat, remaining }) => {
        const parsed = parseCropParams({
            x: formData.get('crop_x'),
            y: formData.get('crop_y'),
            width: formData.get('crop_width'),
            height: formData.get('crop_height'),
        });
        if (!parsed.ok) return jsonError(parsed.error, 400);

        let pipeline = createPipeline(buffer);
        const meta = await pipeline.metadata();

        // Also false when sharp could not resolve the source dimensions, which
        // used to slip past `n > undefined` and surface as a 500 from extract().
        if (!isCropInBounds(parsed.rect, meta)) {
            return jsonError('Crop parameters are out of bounds of the original image dimensions.', 400);
        }

        pipeline = pipeline.extract({
            left: parsed.rect.x,
            top: parsed.rect.y,
            width: parsed.rect.width,
            height: parsed.rect.height,
        });

        const processed = await applyOutputFormat(pipeline, sourceFormat).toBuffer();

        return imageResponse(processed, {
            format: sourceFormat,
            filename: buildOutputFilename({ name: file.name, prefix: 'resizo-cropped', format: sourceFormat }),
            remaining,
        });
    },
});
