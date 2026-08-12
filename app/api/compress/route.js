import { withToolRoute } from '@/lib/api/with-tool-route';
import { DEFAULT_QUALITY, RASTER_INPUT_FORMATS } from '@/lib/constants';
import { imageResponse, jsonError } from '@/lib/http/responses';
import { buildOutputFilename } from '@/lib/image/filename';
import { applyOutputFormat, createPipeline } from '@/lib/image/pipeline';
import { parseQuality } from '@/lib/image/quality';
import { compressToTarget, parseTargetBytes } from '@/lib/image/target-size';

export const runtime = 'nodejs';
export const maxDuration = 60;

export const POST = withToolRoute({
    name: 'compress',
    accept: RASTER_INPUT_FORMATS,
    invalidTypeError: 'File failed validation. Please upload a valid JPEG, PNG, or WebP image.',
    errorMessage: 'An internal server error occurred while compressing the image.',
    handler: async ({ formData, file, buffer, sourceFormat, remaining }) => {
        // Both fields are validated before either is used, so a request that
        // carries a target AND a malformed quality is still a 400 rather than a
        // silently ignored field.
        const target = parseTargetBytes(formData.get('targetBytes'));
        if (!target.ok && !target.absent) return jsonError(target.error, 400);

        const parsed = parseQuality(formData.get('quality'));
        if (!parsed.ok && !parsed.absent) return jsonError(parsed.error, 400);
        const quality = parsed.ok ? parsed.value : DEFAULT_QUALITY;

        const filename = buildOutputFilename({
            name: file.name,
            prefix: 'resizo-compressed',
            format: sourceFormat,
        });

        // Every response reports the byte counts the result panel prints, so
        // the client never has to re-measure the file it just uploaded.
        if (target.ok) {
            const result = await compressToTarget({
                buffer,
                format: sourceFormat,
                targetBytes: target.value,
            });

            if (!result.ok) return jsonError(result.error, 400);

            return imageResponse(result.buffer, {
                format: sourceFormat,
                filename,
                remaining,
                extra: {
                    'X-Original-Size': buffer.length,
                    'X-Output-Size': result.buffer.length,
                    'X-Target-Size': target.value,
                },
            });
        }

        const pipeline = applyOutputFormat(createPipeline(buffer), sourceFormat, { quality });
        const processed = await pipeline.toBuffer();

        return imageResponse(processed, {
            format: sourceFormat,
            filename,
            remaining,
            extra: {
                'X-Original-Size': buffer.length,
                'X-Output-Size': processed.length,
            },
        });
    },
});
