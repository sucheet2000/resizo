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
import { deleteBlob, fetchBlobFile, isAllowedBlobUrl } from '@/lib/api/blob';
import { MAX_FILE_SIZE } from '@/lib/constants';
import { getClientIp } from '@/lib/http/client-ip';
import { checkRateLimit } from '@/lib/http/rate-limit';
import { RESPONSE_META, jsonError } from '@/lib/http/responses';
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

            const meta = result?.[RESPONSE_META];
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

const NO_OP = async () => {};

/**
 * Builds a FormData from a JSON body so a handler reading option fields
 * (`quality`, `target_format`, crop dimensions) sees the same `formData.get`
 * shape whether the tiny body arrived as JSON or as multipart form fields. The
 * blobUrl itself is not an option field, so it is dropped.
 */
function jsonBodyToFormData(body) {
    const formData = new FormData();
    if (body && typeof body === 'object') {
        for (const [key, value] of Object.entries(body)) {
            if (key === 'blobUrl' || value === undefined || value === null) continue;
            if (typeof value === 'object') continue;
            formData.append(key, String(value));
        }
    }
    return formData;
}

/**
 * Resolves one upload into { formData, file? , blobUrl? } or a ready 4xx
 * `response`. A route accepts EITHER a direct multipart file (the ≤4.5MB fast
 * path, unchanged) OR a `blobUrl` — as a JSON body or a form field — that points
 * at a Vercel Blob object the browser uploaded straight to storage. An
 * off-allowlist blobUrl is rejected here, before anything fetches or deletes it.
 */
async function resolveUploadSource(request) {
    const contentType = request.headers?.get?.('content-type') ?? '';

    if (contentType.includes('application/json')) {
        let body;
        try {
            body = await request.json();
        } catch {
            return { response: jsonError('Invalid request body. Expected a JSON object with a blobUrl.', 400) };
        }

        const blobUrl = typeof body?.blobUrl === 'string' ? body.blobUrl : '';
        const formData = jsonBodyToFormData(body);

        // No blobUrl: let validateUpload emit the canonical "no file" 400.
        if (!blobUrl) return { formData, file: null };
        if (!isAllowedBlobUrl(blobUrl)) return { response: jsonError('Invalid upload reference.', 400) };
        return { formData, blobUrl };
    }

    let formData;
    try {
        formData = await request.formData();
    } catch {
        return { response: jsonError('Invalid request body. Expected a multipart form upload.', 400) };
    }

    const file = formData.get('file');
    if (file && typeof file.arrayBuffer === 'function') {
        return { formData, file };
    }

    const blobUrl = formData.get('blobUrl');
    if (typeof blobUrl === 'string' && blobUrl) {
        if (!isAllowedBlobUrl(blobUrl)) return { response: jsonError('Invalid upload reference.', 400) };
        return { formData, blobUrl };
    }

    // Neither a file nor a blobUrl: validateUpload turns the null into a 400.
    return { formData, file };
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
            const source = await resolveUploadSource(request);
            if (source.response) return source.response;

            const { formData, blobUrl } = source;

            // A blob is ours the moment we accept its URL, so it is deleted in a
            // finally whether processing succeeds, fails validation, or throws —
            // nothing lingers in the store. The direct-file path has nothing to
            // clean up.
            const cleanup = blobUrl ? () => deleteBlob(blobUrl) : NO_OP;

            try {
                let file = source.file;
                if (blobUrl) {
                    const filenameField = formData.get('filename');
                    const fetched = await fetchBlobFile(blobUrl, {
                        maxBytes,
                        filename: typeof filenameField === 'string' ? filenameField : undefined,
                    });
                    if (!fetched.ok) return jsonError(fetched.error, fetched.status);
                    file = fetched.file;
                }

                const validation = validateUpload(file, { allowedTypes, allowedExtensions, maxBytes });
                if (!validation.ok) return jsonError(validation.error, validation.status);

                const buffer = Buffer.from(await file.arrayBuffer());

                // Content-Type is caller-supplied and worthless on its own; the
                // signature decides what actually reaches the decoder. It gates
                // the fetched blob bytes exactly as it gates a direct upload.
                const sourceFormat = sniffImageType(buffer);
                if (!sourceFormat || !accept.includes(sourceFormat)) {
                    return jsonError(invalidTypeError, 400);
                }

                return await handler({ request, formData, file, buffer, sourceFormat, remaining });
            } finally {
                await cleanup();
            }
        },
    });
}
