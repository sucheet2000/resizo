'use client';

/**
 * Direct-to-Blob upload strategy (client half).
 *
 * A Vercel serverless function rejects a request body over 4.5 MB, but the
 * tools accept files up to 20 MB. So a file small enough to fit under that cap
 * is posted straight to the processing route (the fast path, lowest latency);
 * a larger file is uploaded to Vercel Blob first — from the browser, never
 * through a function body — and the route is then called with the blob URL in
 * a tiny JSON-sized body instead of the bytes.
 *
 * This module owns the size threshold, the upload itself, and the small
 * request body the processing route reads in place of a file.
 */
import { upload } from '@vercel/blob/client';

import { formatFileSize } from '@/lib/format-bytes';

// Sits below Vercel's 4.5 MB body cap with headroom for multipart overhead. A
// file at or under this posts directly; a larger one goes to Blob first.
export const DIRECT_UPLOAD_MAX_BYTES = 4 * 1024 * 1024;

// The server route that mints a short-lived, scoped client-upload token.
export const BLOB_UPLOAD_ENDPOINT = '/api/blob/upload';

// Shown when the Blob store is not provisioned yet (the token route answers
// 503) or the token handshake never completes. A smaller file still works over
// the direct path, which is the one thing the visitor can act on.
export const LARGE_FILE_UNAVAILABLE_MESSAGE =
    `Large-file upload isn't available yet — try a file under ${formatFileSize(DIRECT_UPLOAD_MAX_BYTES)}.`;

/** True when a value pulled from FormData is a real File the browser can upload. */
export function isUploadableFile(value) {
    return Boolean(value)
        && typeof value === 'object'
        && typeof value.name === 'string'
        && typeof value.size === 'number';
}

/** True when a file is large enough that it must skip the request body. */
export function shouldUploadToBlob(file) {
    return isUploadableFile(file) && file.size > DIRECT_UPLOAD_MAX_BYTES;
}

/**
 * Why a Blob upload failed, so the hook can tell "the store is not wired up
 * yet" (act on it with a smaller file) apart from a mid-transfer drop.
 *   'unavailable' — the token handshake never got as far as sending bytes.
 *   'failed'      — bytes were on the wire and the transfer broke.
 */
export class BlobUploadError extends Error {
    constructor(code, options) {
        super(`blob-upload-${code}`, options);
        this.name = 'BlobUploadError';
        this.code = code;
    }
}

/**
 * Uploads a file straight to Vercel Blob and resolves its public URL. Byte
 * progress is reported so the caller can drive the same bar the direct upload
 * uses. A failure before any byte leaves the browser surfaces as 'unavailable'
 * (no store, or the token route is down); a failure mid-transfer as 'failed'.
 * An abort is re-thrown untouched so the caller can treat it as a cancel.
 */
export async function uploadToBlob(file, { onProgress, signal } = {}) {
    let started = false;

    try {
        const result = await upload(file.name, file, {
            access: 'public',
            handleUploadUrl: BLOB_UPLOAD_ENDPOINT,
            contentType: file.type || undefined,
            abortSignal: signal,
            onUploadProgress: ({ loaded, total }) => {
                started = true;
                onProgress?.(loaded, total);
            },
        });

        return result.url;
    } catch (error) {
        if (signal?.aborted) throw error;
        throw new BlobUploadError(started ? 'failed' : 'unavailable', { cause: error });
    }
}

/**
 * The tiny body the processing route reads instead of a file. Every option
 * field the tool set travels through unchanged; the `file` is replaced by
 * `blobUrl`, and `filename` carries the original name so the output is named
 * sensibly rather than from the blob's random-suffixed pathname.
 */
export function toProcessBody(formData, { blobUrl, filename } = {}) {
    const body = new FormData();

    for (const [key, value] of formData.entries()) {
        if (key === 'file') continue;
        body.append(key, value);
    }

    body.append('blobUrl', blobUrl);
    if (filename) body.append('filename', filename);

    return body;
}
