/**
 * Direct-or-Blob single-file upload.
 *
 * A Vercel serverless function rejects a request BODY over 4.5MB, but the tools
 * accept 20MB per file. A file at or below DIRECT_UPLOAD_MAX_BYTES is POSTed the
 * old way — a multipart body straight to the route. Anything larger is uploaded
 * to Vercel Blob from the browser first, and only the tiny blob URL is sent to
 * the route (as JSON), which fetches the bytes server-side.
 *
 * The route runs the identical gates on both paths, so the choice here is a
 * transport detail: the caller gets back the processed blob and the same numbers
 * either way. When Blob is not provisioned yet the client-upload endpoint answers
 * 503 and the upload throws; a large file then falls back to the direct path,
 * where it may be refused for its size — which is still the honest outcome, and
 * strictly better than the silent failure every large upload hits today.
 */
import { upload } from '@vercel/blob/client';

import { DIRECT_UPLOAD_MAX_BYTES } from '@/lib/constants';
import { parseHeaders, readErrorMessage, resultStats } from '@/lib/hooks/submit-helpers';
import { buildOutputFilename } from '@/lib/image/filename';

const BLOB_UPLOAD_ENDPOINT = '/api/blob/upload';

function isAbort(error) {
    return error?.name === 'AbortError';
}

function filenameFromDisposition(value) {
    if (typeof value !== 'string') return null;

    const utf8 = value.match(/filename\*=UTF-8''([^;]+)/i);
    if (utf8) {
        try {
            return decodeURIComponent(utf8[1]);
        } catch {
            // Malformed percent-encoding: fall through to the ASCII form.
        }
    }

    const ascii = value.match(/filename="([^"]+)"/i);
    return ascii ? ascii[1] : null;
}

function headerLines(headers) {
    if (!headers || typeof headers.forEach !== 'function') return '';
    const lines = [];
    headers.forEach((value, key) => lines.push(`${key}: ${value}`));
    return lines.join('\r\n');
}

async function readErrorBody(response) {
    let text = '';
    try {
        text = typeof response.text === 'function' ? await response.text() : '';
    } catch {
        text = '';
    }
    return readErrorMessage(text, response.status);
}

async function parseResponse(response, { originalBytes, fallbackName }) {
    if (!response.ok) {
        return { ok: false, error: await readErrorBody(response) };
    }

    const blob = await response.blob();
    if (!blob || blob.size === 0) {
        return { ok: false, error: readErrorMessage('', 500) };
    }

    const headers = parseHeaders(headerLines(response.headers));
    const filename = filenameFromDisposition(headers['content-disposition']) || fallbackName;

    return {
        ok: true,
        blob,
        filename,
        ...resultStats({ headers, originalBytes, blobBytes: blob.size }),
    };
}

function directBody(file, fields) {
    const formData = new FormData();
    formData.append('file', file);
    for (const [key, value] of Object.entries(fields)) {
        if (value !== undefined && value !== null) formData.append(key, String(value));
    }
    return formData;
}

function blobBody(blobUrl, filename, fields) {
    const body = { blobUrl, filename };
    for (const [key, value] of Object.entries(fields)) {
        if (value !== undefined && value !== null) body[key] = String(value);
    }
    return JSON.stringify(body);
}

async function postDirect(endpoint, file, fields, signal) {
    return fetch(endpoint, { method: 'POST', body: directBody(file, fields), signal });
}

async function postBlobReference(endpoint, blobUrl, filename, fields, signal) {
    return fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: blobBody(blobUrl, filename, fields),
        signal,
    });
}

/**
 * Uploads the file to Vercel Blob and returns its URL, or null when Blob is not
 * available (the token endpoint answered 503, so the caller falls back to the
 * direct path). An abort propagates so a cancelled batch stops cleanly.
 */
async function uploadToBlob(file, signal) {
    try {
        const blob = await upload(file.name, file, {
            access: 'public',
            handleUploadUrl: BLOB_UPLOAD_ENDPOINT,
            contentType: file.type,
        });
        return blob?.url ?? null;
    } catch (error) {
        if (isAbort(error)) throw error;
        return null;
    }
}

/**
 * @param {object}   options
 * @param {string}   options.endpoint  processing route, e.g. '/api/resize'
 * @param {File}     options.file
 * @param {object}   options.fields    option fields (width/height/format/…)
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<{ok:true, blob:Blob, filename:string, originalBytes:number|null,
 *   resultBytes:number|null, savedPercent:number|null}|{ok:false, error:string}>}
 */
export async function submitFile({ endpoint, file, fields = {}, signal } = {}) {
    if (!endpoint) throw new Error('submitFile requires an endpoint.');
    if (!file) return { ok: false, error: readErrorMessage('', 400) };

    const fallbackName = buildOutputFilename({
        name: file.name,
        prefix: 'resizo-processed',
        format: fields.format,
    });

    try {
        let response;

        if (file.size > DIRECT_UPLOAD_MAX_BYTES) {
            const blobUrl = await uploadToBlob(file, signal);
            response = blobUrl
                ? await postBlobReference(endpoint, blobUrl, file.name, fields, signal)
                : await postDirect(endpoint, file, fields, signal);
        } else {
            response = await postDirect(endpoint, file, fields, signal);
        }

        return parseResponse(response, { originalBytes: file.size, fallbackName });
    } catch (error) {
        if (isAbort(error)) throw error;
        return { ok: false, error: readErrorMessage('', 0) };
    }
}

export default submitFile;
