/**
 * Vercel Blob input source.
 *
 * A Vercel serverless function caps the request BODY at 4.5MB, but Resizo
 * accepts 20MB per file. Uploads above that cap go straight to Vercel Blob from
 * the browser, and the processing route receives only the blob URL — a tiny
 * body — then fetches the bytes here, server-side.
 *
 * That URL is attacker-controlled, so it is checked against the Blob host
 * allowlist BEFORE any fetch: this fetch runs from inside the function's
 * network, and an unchecked URL is a server-side request forgery hole. Every
 * gate a direct upload passes — the 20MB cap, the magic-byte sniff, the pixel
 * budget — still applies to the fetched bytes, unchanged.
 */
import { del } from '@vercel/blob';
import { MAX_FILE_SIZE } from '@/lib/constants';
import { logError } from '@/lib/log';

const VERCEL_BLOB_HOST_SUFFIX = '.public.blob.vercel-storage.com';

function megabytes(bytes) {
    return Math.round(bytes / (1024 * 1024));
}

/**
 * True only for an https URL whose host is a Vercel Blob store
 * (<store>.public.blob.vercel-storage.com) or the host named in BLOB_HOST.
 * Anything else — a private IP, a metadata endpoint, an arbitrary domain — is
 * rejected so the server-side fetch can never be pointed at an SSRF target.
 */
export function isAllowedBlobUrl(rawUrl) {
    let url;
    try {
        url = new URL(rawUrl);
    } catch {
        return false;
    }

    if (url.protocol !== 'https:') return false;

    const host = url.hostname.toLowerCase();

    const configured = process.env.BLOB_HOST;
    if (configured && host === configured.toLowerCase()) return true;

    return host.length > VERCEL_BLOB_HOST_SUFFIX.length && host.endsWith(VERCEL_BLOB_HOST_SUFFIX);
}

function blobFilename(rawUrl) {
    try {
        const { pathname } = new URL(rawUrl);
        const last = pathname.split('/').filter(Boolean).pop();
        return last ? decodeURIComponent(last) : 'upload';
    } catch {
        return 'upload';
    }
}

/**
 * Fetches the blob bytes as a File, for a URL the caller has already checked
 * with isAllowedBlobUrl. Returns { ok:true, file } or { ok:false, status,
 * error }. A Content-Length over the cap is rejected before the body is read so
 * an oversized blob never fully lands in memory; validateUpload re-checks the
 * real byte length after.
 */
export async function fetchBlobFile(rawUrl, { maxBytes = MAX_FILE_SIZE, filename } = {}) {
    let response;
    try {
        response = await fetch(rawUrl);
    } catch {
        return { ok: false, status: 400, error: 'The uploaded file could not be retrieved.' };
    }

    if (!response.ok) {
        return { ok: false, status: 400, error: 'The uploaded file could not be retrieved.' };
    }

    const declared = Number(response.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > maxBytes) {
        return { ok: false, status: 400, error: `File exceeds the maximum allowed size of ${megabytes(maxBytes)}MB.` };
    }

    const bytes = Buffer.from(await response.arrayBuffer());
    const type = response.headers.get('content-type') ?? '';
    const name = (typeof filename === 'string' && filename) ? filename : blobFilename(rawUrl);

    return { ok: true, file: new File([bytes], name, { type }) };
}

/**
 * Deletes a processed blob, best-effort. A delete failure must never turn a
 * successful image response into a 500 — the blob lingers and the failure is
 * logged instead.
 */
export async function deleteBlob(rawUrl) {
    try {
        await del(rawUrl);
    } catch (error) {
        logError({ code: 'BLOB_DELETE_FAILED', msg: 'failed to delete processed blob', err: error });
    }
}
