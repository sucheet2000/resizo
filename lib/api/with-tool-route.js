/**
 * Image Route Wrapper
 *
 * The six upload routes were the same 60-line preamble pasted six times, and
 * the copies drifted: five shared one rate-limit bucket, the magic-byte check
 * existed in four incompatible versions, and a text form field posted as
 * `file` produced a 500 instead of a 400. That preamble lives here now, so a
 * route file contains only the logic unique to its tool.
 *
 * Order is fixed and must not be reordered by a caller:
 *   rate limit -> parse body -> validate upload -> sniff magic bytes -> handler
 */
import { recordResizeHistory } from '@/lib/api/resize-history';
import { MAX_FILE_SIZE } from '@/lib/constants';
import { getClientIp } from '@/lib/http/client-ip';
import { checkRateLimit } from '@/lib/http/rate-limit';
import { HISTORY_META, jsonError } from '@/lib/http/responses';
import { logError, logInfo, requestIdFrom } from '@/lib/log';
import { sniffImageType } from '@/lib/image/magic-bytes';
import { validateUpload } from '@/lib/image/validate';

const GENERIC_ERROR = 'An internal server error occurred while processing the image.';

// createPipeline caps the decode at MAX_DECODE_PIXELS, and sharp reports that
// as a throw — from metadata() as readily as from toBuffer(). It is a rejected
// upload, not a server fault, so it must not surface as a 500.
const PIXEL_LIMIT_SIGNAL = 'exceeds pixel limit';
const PIXEL_LIMIT_ERROR = 'This image has too many pixels to process.';

function isPixelLimitError(error) {
    return error instanceof Error && typeof error.message === 'string'
        && error.message.includes(PIXEL_LIMIT_SIGNAL);
}

/**
 * Rate-limits a request, hands `remaining` to the handler for the success
 * header, and converts any thrown error into a logged, generic 500.
 *
 * checkRateLimit rather than enforceRateLimit: the success responses carry
 * X-RateLimit-Remaining, which the thin wrapper cannot supply.
 */
export function withRateLimitedRoute({ name, errorMessage = GENERIC_ERROR, handler }) {
    return async function handleRequest(request) {
        const start = Date.now();
        try {
            const { remaining, response } = await checkRateLimit(request, name);
            if (response) return response;

            const result = await handler({ request, remaining });

            const meta = result?.[HISTORY_META];
            logInfo({
                code: 'REQUEST_OK',
                route: name,
                requestId: requestIdFrom(request),
                ip: getClientIp(request),
                bytes: meta?.outputBytes,
                sourceFormat: meta?.outputFormat,
                durationMs: Date.now() - start,
            });

            return result;
        } catch (error) {
            if (isPixelLimitError(error)) return jsonError(PIXEL_LIMIT_ERROR, 400);

            logError({
                code: 'ROUTE_ERROR',
                route: name,
                requestId: requestIdFrom(request),
                ip: getClientIp(request),
                durationMs: Date.now() - start,
                msg: `[api:${name}] request failed`,
                err: error,
            });
            return jsonError(errorMessage, 500);
        }
    };
}

/**
 * Single-file upload route.
 *
 * @param name              rate-limit bucket, e.g. 'compress'
 * @param accept            sniffed formats this tool accepts, e.g. ['jpeg','png','webp']
 * @param allowedTypes      MIME allowlist for the declared Content-Type. Stays
 *                          broad on purpose — browsers and phones send aliases
 *                          like image/jpg and image/x-png, and the magic-byte
 *                          sniff below is what actually decides.
 * @param allowedExtensions filename fallback, ORed with allowedTypes (HEIC often has no MIME)
 * @param invalidTypeError  400 body when the magic bytes do not match `accept`
 * @param handler           receives { request, formData, file, buffer, sourceFormat, remaining }
 */
export function withToolRoute({
    name,
    accept,
    allowedTypes = ['image/*'],
    allowedExtensions = [],
    maxBytes = MAX_FILE_SIZE,
    invalidTypeError = 'File failed validation. Please upload a valid image.',
    errorMessage,
    handler,
}) {
    return withRateLimitedRoute({
        name,
        errorMessage,
        handler: async ({ request, remaining }) => {
            let formData;
            try {
                formData = await request.formData();
            } catch {
                return jsonError('Invalid request body. Expected a multipart form upload.', 400);
            }

            const file = formData.get('file');

            const validation = validateUpload(file, { allowedTypes, allowedExtensions, maxBytes });
            if (!validation.ok) return jsonError(validation.error, validation.status);

            const buffer = Buffer.from(await file.arrayBuffer());

            // Content-Type is caller-supplied and worthless on its own; the
            // signature decides what actually reaches the decoder.
            const sourceFormat = sniffImageType(buffer);
            if (!sourceFormat || !accept.includes(sourceFormat)) {
                return jsonError(invalidTypeError, 400);
            }

            const response = await handler({ request, formData, file, buffer, sourceFormat, remaining });

            // Only a successful image response carries HISTORY_META. A 400 from
            // the handler (bad target, out-of-bounds crop) records nothing.
            const meta = response?.[HISTORY_META];
            if (meta) {
                recordResizeHistory(request, {
                    originalFilename: typeof file?.name === 'string' ? file.name : null,
                    originalFormat: sourceFormat,
                    outputFormat: meta.outputFormat,
                    originalBytes: buffer.length,
                    resizedBytes: meta.outputBytes,
                });
            }

            return response;
        },
    });
}
