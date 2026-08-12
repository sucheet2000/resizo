import heicConvert from 'heic-convert';
import { withToolRoute } from '@/lib/api/with-tool-route';
import { HEIC_EXTENSIONS, HEIC_INPUT_FORMATS, HEIC_MIME_TYPES, MAX_PIXELS } from '@/lib/constants';
import { imageResponse, jsonError } from '@/lib/http/responses';
import { buildOutputFilename } from '@/lib/image/filename';
import { probeHeicPixels } from '@/lib/image/heic-probe';

export const runtime = 'nodejs';
export const maxDuration = 60;

// libheif runs synchronously on the event loop. The pixel cap above is the real
// protection; this bounds the awaited response so a file that still runs long
// returns a JSON 400 the frontend can render rather than a platform 504.
const CONVERT_DEADLINE_MS = 25_000;

class ConvertTimeout extends Error {}

function withDeadline(promise, ms) {
    let timer;
    const deadline = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new ConvertTimeout()), ms);
    });
    return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

export const POST = withToolRoute({
    name: 'heic',
    accept: HEIC_INPUT_FORMATS,
    allowedTypes: HEIC_MIME_TYPES,
    allowedExtensions: HEIC_EXTENSIONS,
    invalidTypeError: 'File failed validation. Please upload a valid HEIC or HEIF image.',
    errorMessage: 'An internal server error occurred while processing the file.',
    handler: async ({ file, buffer, remaining }) => {
        // Read the declared dimensions from the container and reject an
        // oversized image before libheif allocates width*height*4 bytes and
        // decodes it synchronously on the shared event loop.
        const dims = probeHeicPixels(buffer);
        if (dims && dims.pixels > MAX_PIXELS) {
            return jsonError('This HEIC is too large; resize it first.', 400);
        }

        let rawOutput;
        try {
            rawOutput = await withDeadline(
                heicConvert({ buffer, format: 'JPEG', quality: 0.9 }),
                CONVERT_DEADLINE_MS,
            );
        } catch (error) {
            if (error instanceof ConvertTimeout) {
                return jsonError('This HEIC took too long to convert. Try a smaller image.', 400);
            }
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
