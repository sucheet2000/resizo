import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_FILE_SIZE } from '@/lib/constants';
import { allowLimiter, clearLimiters, denyLimiter } from './helpers/limiter';
import { HEIC_HEADER, MP4_FTYP_ISOM, PLAIN_TEXT, jpegBytes } from './helpers/fixtures';
import { TEST_IP, buildFormData, makeFile, postRequest, readBytes, stubRequest } from './helpers/request';

const { heicConvertMock } = vi.hoisted(() => ({ heicConvertMock: vi.fn() }));

vi.mock('heic-convert', () => ({ default: heicConvertMock }));

const { POST } = await import('@/app/api/heic/route');

const URL_UNDER_TEST = 'http://localhost:3000/api/heic';

const INVALID_TYPE = { error: 'File failed validation. Please upload a valid HEIC or HEIF image.' };

async function heic({ bytes = HEIC_HEADER, name = 'photo.heic', type = 'image/heic' } = {}) {
    const body = buildFormData({ file: makeFile(bytes, { name, type }) });
    return POST(postRequest(URL_UNDER_TEST, body));
}

beforeEach(async () => {
    clearLimiters();
    allowLimiter('heic');
    heicConvertMock.mockResolvedValue(await jpegBytes({ width: 30, height: 20 }));
});

afterEach(() => {
    clearLimiters();
    vi.restoreAllMocks();
});

describe('POST /api/heic', () => {
    it('converts a HEIC upload to JPEG', async () => {
        const response = await heic();

        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toBe('image/jpeg');
        expect(response.headers.get('content-disposition'))
            .toContain('filename="resizo-converted-photo.jpg"');
        expect((await sharp(await readBytes(response)).metadata()).format).toBe('jpeg');
    });

    it('asks heic-convert for a JPEG at the pinned quality', async () => {
        await heic();

        expect(heicConvertMock).toHaveBeenCalledTimes(1);
        const [args] = heicConvertMock.mock.calls[0];
        expect(args.format).toBe('JPEG');
        expect(args.quality).toBe(0.9);
        expect(Buffer.isBuffer(args.buffer)).toBe(true);
    });

    it('accepts an ArrayBuffer back from heic-convert', async () => {
        const jpeg = await jpegBytes({ width: 30, height: 20 });
        heicConvertMock.mockResolvedValue(jpeg.buffer.slice(jpeg.byteOffset, jpeg.byteOffset + jpeg.byteLength));

        const response = await heic();

        expect(response.status).toBe(200);
        expect((await readBytes(response)).length).toBe(jpeg.length);
    });

    it('accepts a .heic upload whose browser MIME type is empty', async () => {
        expect((await heic({ type: '' })).status).toBe(200);
    });

    it('accepts a .heif upload declared as image/heif', async () => {
        expect((await heic({ name: 'photo.heif', type: 'image/heif' })).status).toBe(200);
    });

    it('rejects an MP4 renamed .heic — the ftyp box alone is not enough', async () => {
        const response = await heic({ bytes: MP4_FTYP_ISOM, name: 'clip.heic' });

        expect(response.status).toBe(400);
        expect(await response.json()).toEqual(INVALID_TYPE);
        expect(heicConvertMock).not.toHaveBeenCalled();
    });

    it('rejects a JPEG renamed .heic', async () => {
        const response = await heic({ bytes: await jpegBytes(), name: 'photo.heic' });

        expect(response.status).toBe(400);
        expect(await response.json()).toEqual(INVALID_TYPE);
    });

    it('rejects a buffer with ftyp but no box at all past byte 8', async () => {
        const response = await heic({ bytes: Buffer.concat([Buffer.alloc(4), Buffer.from('ftyp', 'latin1')]) });

        expect(response.status).toBe(400);
    });

    it('rejects a plain JPEG upload at the MIME gate', async () => {
        const response = await heic({ bytes: await jpegBytes(), name: 'photo.jpg', type: 'image/jpeg' });

        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({ error: 'Invalid file type. Only images are allowed.' });
    });

    it('rejects a text file named .heic', async () => {
        const response = await heic({ bytes: PLAIN_TEXT, name: 'notes.heic', type: 'text/plain' });

        expect(response.status).toBe(400);
        expect(await response.json()).toEqual(INVALID_TYPE);
    });

    it('rejects an empty upload', async () => {
        const response = await heic({ bytes: Buffer.alloc(0) });

        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({ error: 'The uploaded file is empty.' });
    });

    it('rejects a file over the 20MB cap', async () => {
        const body = buildFormData({ file: makeFile(HEIC_HEADER, { name: 'big.heic', type: 'image/heic', size: MAX_FILE_SIZE + 1 }) });

        const response = await POST(stubRequest(URL_UNDER_TEST, body));

        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({ error: 'File exceeds the maximum allowed size of 20MB.' });
    });

    it('turns a conversion failure into a 400, not a 500 — the brand check already proved it is HEIF', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        heicConvertMock.mockRejectedValue(new Error('libheif: no compatible codec'));

        const response = await heic();

        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({
            error: 'This HEIC image could not be converted. It may be corrupted or unsupported.',
        });
    });

    it('never leaks the underlying error text to the caller', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        heicConvertMock.mockRejectedValue(new Error('/var/task/secret/path.node missing'));

        const body = await (await heic()).text();

        expect(body).not.toContain('/var/task');
    });

    it('returns 429 from its own bucket', async () => {
        clearLimiters();
        const limit = denyLimiter('heic');

        const response = await heic();

        expect(response.status).toBe(429);
        expect(limit).toHaveBeenCalledWith(`heic:${TEST_IP}`);
        expect(await response.json()).toEqual({
            error: 'Too many requests. Please wait a moment before converting again.',
        });
        expect(heicConvertMock).not.toHaveBeenCalled();
    });

    it('pins the Node runtime', async () => {
        const route = await import('@/app/api/heic/route');
        expect(route.runtime).toBe('nodejs');
        expect(route.maxDuration).toBe(60);
    });
});
