/**
 * The buffer-source abstraction in lib/api/with-tool-route.
 *
 * Every single-file tool now accepts EITHER a direct multipart file (the
 * ≤4.5MB fast path) OR a `blobUrl` that points at a Vercel Blob object the
 * browser uploaded straight to storage. Exercised through the real /api/compress
 * route so the whole preamble — rate limit, source resolution, validateUpload,
 * the magic-byte sniff, then the delete — runs exactly as production runs it.
 *
 * @vercel/blob is mocked at the package boundary (del/put) and global fetch is
 * stubbed, so no store and no network are needed; the SSRF guard and the 20MB
 * cap are real code paths here.
 */
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { gifBytes, jpegBytes } from './helpers/fixtures';
import { buildFormData, jsonRequest, makeFile, postRequest, readBytes } from './helpers/request';
import { allowLimiter, clearLimiters } from './helpers/limiter';

const { delMock, putMock } = vi.hoisted(() => ({
    delMock: vi.fn(async () => {}),
    putMock: vi.fn(),
}));

vi.mock('@vercel/blob', () => ({ del: delMock, put: putMock, head: vi.fn() }));

const { POST } = await import('@/app/api/compress/route');

const URL_UNDER_TEST = 'http://localhost:3000/api/compress';
const BLOB_URL = 'https://store123.public.blob.vercel-storage.com/uploads/photo-abc123.jpg';

function stubFetch(bytes, { contentType = 'image/jpeg', ok = true, contentLength } = {}) {
    const headers = new Headers();
    if (contentType) headers.set('content-type', contentType);
    if (contentLength !== undefined) headers.set('content-length', String(contentLength));
    const arrayBuffer = vi.fn(async () => Uint8Array.from(bytes).buffer);
    const response = { ok, headers, arrayBuffer };
    const fetchMock = vi.fn(async () => response);
    vi.stubGlobal('fetch', fetchMock);
    return { fetchMock, response };
}

beforeEach(() => {
    clearLimiters();
    allowLimiter('compress');
});

afterEach(() => {
    clearLimiters();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('/api/compress via a Blob upload', () => {
    it('fetches, validates, processes and then deletes the blob', async () => {
        const { fetchMock } = stubFetch(await jpegBytes());

        const response = await POST(jsonRequest(URL_UNDER_TEST, { blobUrl: BLOB_URL, quality: '50' }));

        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toBe('image/jpeg');
        expect(response.headers.get('content-disposition'))
            .toContain('resizo-compressed-photo-abc123.jpg');
        expect(fetchMock).toHaveBeenCalledWith(BLOB_URL);
        expect(delMock).toHaveBeenCalledWith(BLOB_URL);
        expect((await sharp(await readBytes(response)).metadata()).format).toBe('jpeg');
    });

    it('also accepts a blobUrl sent as a multipart form field', async () => {
        const { fetchMock } = stubFetch(await jpegBytes());

        const response = await POST(postRequest(URL_UNDER_TEST, buildFormData({
            fields: { blobUrl: BLOB_URL, quality: '50' },
        })));

        expect(response.status).toBe(200);
        expect(fetchMock).toHaveBeenCalledWith(BLOB_URL);
        expect(delMock).toHaveBeenCalledWith(BLOB_URL);
    });

    it('carries option fields from the JSON body through to the handler', async () => {
        stubFetch(await jpegBytes());

        const response = await POST(jsonRequest(URL_UNDER_TEST, { blobUrl: BLOB_URL, quality: '0' }));

        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({ error: 'Quality must be an integer between 1 and 100.' });
        // A rejected option still leaves nothing behind in the store.
        expect(delMock).toHaveBeenCalledWith(BLOB_URL);
    });

    it('runs the magic-byte gate on the fetched bytes and deletes a rejected blob', async () => {
        stubFetch(await gifBytes(), { contentType: 'image/gif' });

        const response = await POST(jsonRequest(URL_UNDER_TEST, { blobUrl: BLOB_URL }));

        expect(response.status).toBe(400);
        expect(await response.json())
            .toEqual({ error: 'File failed validation. Please upload a valid JPEG, PNG, or WebP image.' });
        expect(delMock).toHaveBeenCalledWith(BLOB_URL);
    });

    it('rejects a blob whose Content-Length exceeds the 20MB cap before reading the body', async () => {
        const { response: fetched } = stubFetch(await jpegBytes(), { contentLength: 25 * 1024 * 1024 });

        const response = await POST(jsonRequest(URL_UNDER_TEST, { blobUrl: BLOB_URL }));

        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({ error: 'File exceeds the maximum allowed size of 20MB.' });
        expect(fetched.arrayBuffer).not.toHaveBeenCalled();
        expect(delMock).toHaveBeenCalledWith(BLOB_URL);
    });

    it('deletes the blob even when the fetch itself fails', async () => {
        stubFetch(await jpegBytes(), { ok: false });

        const response = await POST(jsonRequest(URL_UNDER_TEST, { blobUrl: BLOB_URL }));

        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({ error: 'The uploaded file could not be retrieved.' });
        expect(delMock).toHaveBeenCalledWith(BLOB_URL);
    });
});

describe('the SSRF guard on the blobUrl host', () => {
    it.each([
        ['an arbitrary domain', 'https://evil.example.com/uploads/x.jpg'],
        ['plain http', 'http://store123.public.blob.vercel-storage.com/x.jpg'],
        ['the cloud metadata IP', 'https://169.254.169.254/latest/meta-data/'],
        ['a suffix look-alike', 'https://evilpublic.blob.vercel-storage.com.attacker.com/x.jpg'],
        ['a host that only starts with the store domain', 'https://public.blob.vercel-storage.com.evil.com/x.jpg'],
        ['a non-URL string', 'not-a-url'],
    ])('rejects %s with a 400 and never fetches or deletes it', async (_label, blobUrl) => {
        const { fetchMock } = stubFetch(await jpegBytes());

        const response = await POST(jsonRequest(URL_UNDER_TEST, { blobUrl }));

        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({ error: 'Invalid upload reference.' });
        expect(fetchMock).not.toHaveBeenCalled();
        expect(delMock).not.toHaveBeenCalled();
    });
});

describe('the direct multipart file path is unchanged', () => {
    it('never touches Blob when a real file is uploaded', async () => {
        const { fetchMock } = stubFetch(await jpegBytes());

        const response = await POST(postRequest(URL_UNDER_TEST, buildFormData({
            file: makeFile(await jpegBytes(), { name: 'photo.jpg', type: 'image/jpeg' }),
            fields: { quality: '50' },
        })));

        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toBe('image/jpeg');
        expect(fetchMock).not.toHaveBeenCalled();
        expect(delMock).not.toHaveBeenCalled();
    });

    it('returns the canonical no-file 400 for a JSON body without a blobUrl', async () => {
        const response = await POST(jsonRequest(URL_UNDER_TEST, { quality: '50' }));

        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({ error: 'No file provided in the request.' });
        expect(delMock).not.toHaveBeenCalled();
    });

    it('rejects a malformed JSON body with a 400', async () => {
        const response = await POST(jsonRequest(URL_UNDER_TEST, undefined, { raw: '{"blobUrl":' }));

        expect(response.status).toBe(400);
        expect(await response.json())
            .toEqual({ error: 'Invalid request body. Expected a JSON object with a blobUrl.' });
    });
});
