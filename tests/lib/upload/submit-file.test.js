/**
 * The direct-or-Blob single-file submit.
 *
 * A file at or below the 4.5MB serverless body cap is POSTed as multipart the
 * way it always was; a larger one is uploaded to Vercel Blob first and only its
 * URL is sent, as JSON. @vercel/blob/client's upload is mocked and global fetch
 * is stubbed, so the size branch, the fallback when Blob is unavailable, and the
 * error handling are all real code with no store and no network.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DIRECT_UPLOAD_MAX_BYTES, MAX_FILE_SIZE } from '@/lib/constants';

const { uploadMock } = vi.hoisted(() => ({ uploadMock: vi.fn() }));
vi.mock('@vercel/blob/client', () => ({ upload: uploadMock }));

const { submitFile } = await import('@/lib/upload/submit-file');

const ENDPOINT = '/api/resize';
const BLOB_URL = 'https://store123.public.blob.vercel-storage.com/photo-abc123.jpg';

function makeFile(name, { size, type = 'image/jpeg' } = {}) {
    const file = new File([new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0])], name, { type });
    if (Number.isFinite(size)) Object.defineProperty(file, 'size', { value: size, configurable: true });
    return file;
}

function imageResponse({ status = 200, bytes = 400, headers = {} } = {}) {
    return new Response(new Blob([new Uint8Array(bytes)], { type: 'image/webp' }), { status, headers });
}

const OK_HEADERS = {
    'Content-Type': 'image/webp',
    'Content-Disposition': 'attachment; filename="resizo-processed-photo.jpg"',
    'X-Original-Size': '1000000',
    'X-Output-Size': '250000',
};

let fetchMock;

beforeEach(() => {
    uploadMock.mockReset();
    fetchMock = vi.fn(async () => imageResponse({ headers: OK_HEADERS }));
    vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('a file under the body cap takes the direct multipart path', () => {
    it('POSTs the file and options as multipart and never touches Blob', async () => {
        const file = makeFile('photo.jpg', { size: 1024 });

        const result = await submitFile({ endpoint: ENDPOINT, file, fields: { format: 'webp', width: '800' } });

        expect(uploadMock).not.toHaveBeenCalled();
        expect(fetchMock).toHaveBeenCalledTimes(1);

        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe(ENDPOINT);
        expect(init.method).toBe('POST');
        expect(init.body).toBeInstanceOf(FormData);
        expect(init.body.get('file')).toBe(file);
        expect(init.body.get('format')).toBe('webp');
        expect(init.body.get('width')).toBe('800');

        expect(result).toMatchObject({
            ok: true,
            filename: 'resizo-processed-photo.jpg',
            originalBytes: 1000000,
            resultBytes: 250000,
            savedPercent: 75,
        });
        expect(result.blob).toBeInstanceOf(Blob);
    });

    it('falls back to the blob byte length when no output-size header is present', async () => {
        fetchMock.mockResolvedValue(imageResponse({ bytes: 321, headers: { 'Content-Type': 'image/webp' } }));
        const file = makeFile('photo.jpg', { size: 1024 });

        const result = await submitFile({ endpoint: ENDPOINT, file, fields: { format: 'jpeg' } });

        expect(result.ok).toBe(true);
        expect(result.resultBytes).toBe(321);
        // No Content-Disposition either: the name is derived from the source.
        expect(result.filename).toBe('resizo-processed-photo.jpg');
    });
});

describe('a file over the body cap goes to Blob first', () => {
    it('uploads to Blob, then posts the URL as JSON', async () => {
        uploadMock.mockResolvedValue({ url: BLOB_URL });
        const file = makeFile('big.jpg', { size: DIRECT_UPLOAD_MAX_BYTES + 1 });

        const result = await submitFile({ endpoint: ENDPOINT, file, fields: { format: 'jpeg', height: '600' } });

        expect(uploadMock).toHaveBeenCalledTimes(1);
        const [uploadName, uploadFile, uploadOptions] = uploadMock.mock.calls[0];
        expect(uploadName).toBe('big.jpg');
        expect(uploadFile).toBe(file);
        expect(uploadOptions).toMatchObject({ access: 'public', handleUploadUrl: '/api/blob/upload' });

        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe(ENDPOINT);
        expect(init.headers['content-type']).toBe('application/json');
        expect(JSON.parse(init.body)).toEqual({
            blobUrl: BLOB_URL,
            filename: 'big.jpg',
            format: 'jpeg',
            height: '600',
        });
        expect(result.ok).toBe(true);
    });

    it('falls back to the direct path when Blob is not provisioned (503)', async () => {
        uploadMock.mockRejectedValue(new Error('Direct upload is not available right now.'));
        const file = makeFile('big.jpg', { size: DIRECT_UPLOAD_MAX_BYTES + 1 });

        const result = await submitFile({ endpoint: ENDPOINT, file, fields: { format: 'jpeg' } });

        expect(uploadMock).toHaveBeenCalledTimes(1);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock.mock.calls[0][1].body).toBeInstanceOf(FormData);
        expect(result.ok).toBe(true);
    });
});

describe('error handling', () => {
    it('returns the server message for a non-2xx response', async () => {
        fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: 'That file type is not supported.' }), { status: 415 }));
        const file = makeFile('photo.jpg', { size: 1024 });

        const result = await submitFile({ endpoint: ENDPOINT, file, fields: { format: 'jpeg' } });

        expect(result).toEqual({ ok: false, error: 'That file type is not supported.' });
    });

    it('treats an empty 200 body as a failure', async () => {
        fetchMock.mockResolvedValue(new Response(new Blob([]), { status: 200 }));
        const file = makeFile('photo.jpg', { size: 1024 });

        const result = await submitFile({ endpoint: ENDPOINT, file, fields: { format: 'jpeg' } });

        expect(result.ok).toBe(false);
        expect(typeof result.error).toBe('string');
    });

    it('turns a network throw into a graceful failure', async () => {
        fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
        const file = makeFile('photo.jpg', { size: 1024 });

        const result = await submitFile({ endpoint: ENDPOINT, file, fields: { format: 'jpeg' } });

        expect(result.ok).toBe(false);
        expect(typeof result.error).toBe('string');
    });

    it('propagates an abort so a cancelled batch can stop', async () => {
        fetchMock.mockRejectedValue(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        const file = makeFile('photo.jpg', { size: 1024 });

        await expect(submitFile({ endpoint: ENDPOINT, file, fields: { format: 'jpeg' } }))
            .rejects.toMatchObject({ name: 'AbortError' });
    });

    it('requires an endpoint', async () => {
        await expect(submitFile({ file: makeFile('photo.jpg', { size: 10 }) })).rejects.toThrow(/endpoint/);
    });
});

describe('the size threshold is a safe value under the platform cap', () => {
    it('sits below the 4.5MB serverless body limit and the 20MB file cap', () => {
        expect(Number.isSafeInteger(DIRECT_UPLOAD_MAX_BYTES)).toBe(true);
        expect(DIRECT_UPLOAD_MAX_BYTES).toBeGreaterThan(0);
        expect(DIRECT_UPLOAD_MAX_BYTES).toBeLessThan(4.5 * 1024 * 1024);
        expect(DIRECT_UPLOAD_MAX_BYTES).toBeLessThan(MAX_FILE_SIZE);
    });
});
