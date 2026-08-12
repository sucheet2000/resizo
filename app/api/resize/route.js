import { withToolRoute } from '@/lib/api/with-tool-route';
import { ALLOWED_OUTPUT_FORMATS, MAX_DIMENSION, RESIZE_INPUT_FORMATS } from '@/lib/constants';
import { imageResponse, jsonError } from '@/lib/http/responses';
import {
    parsePositiveInt,
    parseScale,
    scaleDimensions,
    withinPixelBudget,
} from '@/lib/image/dimensions';
import { buildOutputFilename } from '@/lib/image/filename';
import { applyOutputFormat, createPipeline } from '@/lib/image/pipeline';

export const runtime = 'nodejs';
export const maxDuration = 60;

const DIMENSION_ERROR = 'Dimensions exceed maximum allowed values.';

function resolveExplicitTarget(meta, widthRaw, heightRaw) {
    const width = parsePositiveInt(widthRaw, { max: MAX_DIMENSION });
    const height = parsePositiveInt(heightRaw, { max: MAX_DIMENSION });

    if (width.absent && height.absent) return { ok: true, options: null };
    if ((!width.ok && !width.absent) || (!height.ok && !height.absent)) {
        return { ok: false, error: DIMENSION_ERROR };
    }

    // With one side supplied sharp derives the other from the aspect ratio, so
    // the caps have to be applied to the derived side too: width=8000 on a tall
    // thin source otherwise asks for a height in the hundreds of thousands.
    const targetWidth = width.ok
        ? width.value
        : Math.max(1, Math.round(meta.width * (height.value / meta.height)));
    const targetHeight = height.ok
        ? height.value
        : Math.max(1, Math.round(meta.height * (width.value / meta.width)));

    if (targetWidth > MAX_DIMENSION || targetHeight > MAX_DIMENSION) {
        return { ok: false, error: DIMENSION_ERROR };
    }
    if (!withinPixelBudget(targetWidth, targetHeight)) {
        return { ok: false, error: DIMENSION_ERROR };
    }

    const options = {};
    if (width.ok) options.width = width.value;
    if (height.ok) options.height = height.value;

    return { ok: true, options };
}

export const POST = withToolRoute({
    name: 'resize',
    accept: RESIZE_INPUT_FORMATS,
    invalidTypeError: 'File failed validation. Please upload a valid image.',
    errorMessage: 'An internal server error occurred while processing the image.',
    handler: async ({ formData, file, buffer, remaining }) => {
        const requestedFormat = formData.get('format');
        const format = ALLOWED_OUTPUT_FORMATS.includes(requestedFormat) ? requestedFormat : 'jpeg';

        let pipeline = createPipeline(buffer);

        // A source far bigger than MAX_PIXELS is fine — shrinking one is the
        // whole point. Only the requested OUTPUT is held to the budget below.
        const meta = await pipeline.metadata();

        const scaleRaw = formData.get('scale');
        const explicit = resolveExplicitTarget(meta, formData.get('width'), formData.get('height'));
        if (!explicit.ok) return jsonError(explicit.error, 400);

        let resizeOptions = explicit.options;

        if (!resizeOptions && scaleRaw !== null && String(scaleRaw).trim() !== '') {
            const scale = parseScale(scaleRaw);
            if (!scale.ok) return jsonError(scale.error, 400);

            const scaled = scaleDimensions(meta.width, meta.height, scale.value);
            if (!scaled.ok) return jsonError(scaled.error, 400);

            resizeOptions = { width: scaled.width, height: scaled.height };
        }

        if (resizeOptions) pipeline = pipeline.resize(resizeOptions);

        const processed = await applyOutputFormat(pipeline, format).toBuffer();

        return imageResponse(processed, {
            format,
            filename: buildOutputFilename({ name: file.name, prefix: 'resizo-processed', format }),
            remaining,
        });
    },
});
