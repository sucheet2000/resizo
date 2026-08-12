/**
 * The client-upload token endpoint, POST /api/blob/upload.
 *
 * It mints a scoped Vercel Blob client token so the browser can upload straight
 * to storage, never through a 4.5MB-capped function body. @vercel/blob/client's
 * handleUpload is mocked so the route's own scoping — image types only, the 20MB
 * cap, a short validity window, the 503 before the store exists — is what these
 * tests actually assert.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_FILE_SIZE } from '@/lib/constants';
import { allowLimiter, clearLimiters, denyLimiter } from './helpers/limiter';
import { TEST_IP, jsonRequest } from './helpers/request';

const { handleUploadMock } = vi.hoisted(() => ({ handleUploadMock: vi.fn() }));

vi.mock('@vercel/blob/client', () => ({ handleUpload: handleUploadMock }));

const { POST } = await import('@/app/api/blob/upload/route');

const URL_UNDER_TEST = 'http://localhost:3000/api/blob/upload';

const GENERATE_BODY = {
    type: 'blob.generate-client-token',
    payload: { pathname: 'photo.jpg', callbackUrl: `${URL_UNDER_TEST}`, clientPayload: null, multipart: false },
};

const IMAGE_CONTENT_TYPES = [
    'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif', 'image/avif',
];

function post(body, options) {
    return POST(jsonRequest(URL_UNDER_TEST, body, options));
}

/** Drives handleUpload to invoke onBeforeGenerateToken and capture its options. */
function captureTokenOptions(clientToken = 'client-token-xyz') {
    let captured;
    handleUploadMock.mockImplementation(async ({ onBeforeGenerateToken }) => {
        captured = await onBeforeGenerateToken('photo.jpg', null, false);
        return { type: 'blob.generate-client-token', clientToken };
    });
    return () => captured;
}

beforeEach(() => {
    clearLimiters();
    allowLimiter('blob');
    vi.stubEnv('BLOB_READ_WRITE_TOKEN', 'vercel_blob_rw_TESTTOKEN');
    handleUploadMock.mockReset();
});

afterEach(() => {
    clearLimiters();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
});

describe('POST /api/blob/upload', () => {
    it('mints a client token and returns it to the browser', async () => {
        captureTokenOptions('client-token-xyz');

        const response = await post(GENERATE_BODY);

        expect(response.status).toBe(200);
        expect(await response.json())
            .toEqual({ type: 'blob.generate-client-token', clientToken: 'client-token-xyz' });
    });

    it('scopes the token to image types only, caps it at 20MB, and gives it a short window', async () => {
        const read = captureTokenOptions();
        const before = Date.now();

        await post(GENERATE_BODY);
        const options = read();

        expect(options.allowedContentTypes).toEqual(IMAGE_CONTENT_TYPES);
        expect(options.allowedContentTypes.some((type) => !type.startsWith('image/'))).toBe(false);
        expect(options.maximumSizeInBytes).toBe(MAX_FILE_SIZE);
        expect(options.maximumSizeInBytes).toBe(20 * 1024 * 1024);
        expect(options.addRandomSuffix).toBe(true);
        expect(options.validUntil).toBeGreaterThan(before);
        expect(options.validUntil).toBeLessThanOrEqual(Date.now() + 60_000);
    });

    it('returns a 503 when BLOB_READ_WRITE_TOKEN is not set, without calling the SDK', async () => {
        vi.stubEnv('BLOB_READ_WRITE_TOKEN', '');

        const response = await post(GENERATE_BODY);

        expect(response.status).toBe(503);
        expect(await response.json()).toEqual({ error: 'Direct upload is not available right now.' });
        expect(handleUploadMock).not.toHaveBeenCalled();
    });

    it('returns 429 from its own blob bucket when rate-limited, before touching the SDK', async () => {
        clearLimiters();
        const limit = denyLimiter('blob');

        const response = await post(GENERATE_BODY);

        expect(response.status).toBe(429);
        expect(limit).toHaveBeenCalledWith(`blob:${TEST_IP}`);
        expect(response.headers.get('Retry-After')).toBeTruthy();
        expect(handleUploadMock).not.toHaveBeenCalled();
    });

    it('rejects a malformed JSON body with a 400', async () => {
        const response = await POST(jsonRequest(URL_UNDER_TEST, undefined, { raw: '{' }));

        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({ error: 'Invalid request body.' });
        expect(handleUploadMock).not.toHaveBeenCalled();
    });

    it('turns a handleUpload failure into a masked 400', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        handleUploadMock.mockRejectedValue(new Error('BLOB_READ_WRITE_TOKEN=secret rejected the payload'));

        const response = await post(GENERATE_BODY);

        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({ error: 'Could not authorize the upload.' });
    });

    it('pins the Node runtime', async () => {
        const route = await import('@/app/api/blob/upload/route');
        expect(route.runtime).toBe('nodejs');
        expect(route.maxDuration).toBe(15);
    });
});
