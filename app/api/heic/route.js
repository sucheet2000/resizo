import heicConvert from 'heic-convert';
import { withToolRoute } from '@/lib/api/with-tool-route';
import { HEIC_EXTENSIONS, HEIC_INPUT_FORMATS, HEIC_MIME_TYPES } from '@/lib/constants';
import { imageResponse, jsonError } from '@/lib/http/responses';
import { buildOutputFilename } from '@/lib/image/filename';

export const runtime = 'nodejs';
export const maxDuration = 60;

export const POST = withToolRoute({
    name: 'heic',
    accept: HEIC_INPUT_FORMATS,
    allowedTypes: HEIC_MIME_TYPES,
    allowedExtensions: HEIC_EXTENSIONS,
    invalidTypeError: 'File failed validation. Please upload a valid HEIC or HEIF image.',
    errorMessage: 'An internal server error occurred while processing the file.',
    handler: async ({ file, buffer, remaining }) => {
        let rawOutput;
        try {
            rawOutput = await heicConvert({ buffer, format: 'JPEG', quality: 0.9 });
        } catch (error) {
            // The signature already proved this is a HEIF brand, so a failure
            // here means the file itself is malformed: a client error, not ours.
            console.error('[api:heic] conversion failed:', error);
            return jsonError('This HEIC image could not be converted. It may be corrupted or unsupported.', 400);
        }

        const output = Buffer.isBuffer(rawOutput) ? rawOutput : Buffer.from(rawOutput);

        return imageResponse(output, {
            format: 'jpeg',
            filename: buildOutputFilename({ name: file.name, prefix: 'resizo-converted', format: 'jpeg' }),
            remaining,
        });
    },
});
