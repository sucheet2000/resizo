import { withToolRoute } from '@/lib/api/with-tool-route';
import { CONVERT_INPUT_FORMATS, CONVERT_OUTPUT_FORMATS } from '@/lib/constants';
import { formatProse, joinProse } from '@/lib/hooks/upload-helpers';
import { imageResponse, jsonError } from '@/lib/http/responses';
import { buildOutputFilename } from '@/lib/image/filename';
import { applyOutputFormat, createPipeline } from '@/lib/image/pipeline';

export const runtime = 'nodejs';
export const maxDuration = 60;

// Both sentences are built from the registry rather than typed out. They named
// AVIF for as long as it took somebody to notice, telling a caller to send a
// file this route had already stopped accepting; a hand-written list next to an
// allowlist is a copy of the allowlist that nothing keeps honest.
const INVALID_TYPE_ERROR =
    `File failed validation. Please upload a valid ${formatProse(CONVERT_INPUT_FORMATS, 'or')} image.`;

const INVALID_TARGET_ERROR =
    `Invalid target format. Must be ${joinProse(CONVERT_OUTPUT_FORMATS, 'or')}.`;

export const POST = withToolRoute({
    name: 'convert',
    accept: CONVERT_INPUT_FORMATS,
    invalidTypeError: INVALID_TYPE_ERROR,
    errorMessage: 'An internal server error occurred while converting the image.',
    handler: async ({ formData, file, buffer, remaining }) => {
        const targetFormat = formData.get('target_format');
        if (!CONVERT_OUTPUT_FORMATS.includes(targetFormat)) {
            return jsonError(INVALID_TARGET_ERROR, 400);
        }

        // No quality is passed on purpose: a format conversion must not
        // quantise a PNG down to a palette the way /compress deliberately does.
        // WebP takes the encoder default from applyOutputFormat.
        const pipeline = applyOutputFormat(createPipeline(buffer), targetFormat);
        const processed = await pipeline.toBuffer();

        return imageResponse(processed, {
            format: targetFormat,
            filename: buildOutputFilename({ name: file.name, prefix: 'resizo-converted', format: targetFormat }),
            remaining,
        });
    },
});
