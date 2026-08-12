import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from '@/app/api/convert/route';
import { sniffImageType } from '@/lib/image/magic-bytes';
import { allowLimiter, clearLimiters, denyLimiter } from './helpers/limiter';
import { avifBytes, gifBytes, jpegBytes, pngBytes, webpBytes } from './helpers/fixtures';
import { TEST_IP, buildFormData, makeFile, postRequest, readBytes } from './helpers/request';

const URL_UNDER_TEST = 'http://localhost:3000/api/convert';

const TARGET_ERROR = { error: 'Invalid target format. Must be jpeg, png, webp, or avif.' };

const INVALID_TYPE = { error: 'File failed validation. Please upload a valid JPEG, PNG, WebP, or AVIF image.' };

async function convert({ bytes, name = 'photo.jpg', type = 'image/jpeg', fields = {} } = {}) {
    const body = buildFormData({ file: makeFile(bytes ?? (await jpegBytes()), { name, type }), fields });
    return POST(postRequest(URL_UNDER_TEST, body));
}

beforeEach(() => {
    clearLimiters();
    allowLimiter('convert');
});

afterEach(() => {
    clearLimiters();
    vi.restoreAllMocks();
});

describe('POST /api/convert', () => {
    it.each([
        ['jpeg', 'image/jpeg', 'jpeg'],
        ['png', 'image/png', 'png'],
        ['webp', 'image/webp', 'webp'],
    ])('converts to %s', async (target, contentType, sharpFormat) => {
        const response = await convert({ fields: { target_format: target } });

        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toBe(contentType);
        expect((await sharp(await readBytes(response)).metadata()).format).toBe(sharpFormat);
    });

    it('converts a PNG source to WebP', async () => {
        const response = await convert({ bytes: await pngBytes(), name: 'shot.png', type: 'image/png', fields: { target_format: 'webp' } });

        expect((await sharp(await readBytes(response)).metadata()).format).toBe('webp');
    });

    it('converts a WebP source to PNG', async () => {
        const response = await convert({ bytes: await webpBytes(), name: 'shot.webp', type: 'image/webp', fields: { target_format: 'png' } });

        expect((await sharp(await readBytes(response)).metadata()).format).toBe('png');
    });

    it('converts a JPEG to AVIF', async () => {
        const response = await convert({ fields: { target_format: 'avif' } });
        const output = await readBytes(response);

        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toBe('image/avif');
        expect(response.headers.get('content-disposition'))
            .toContain('filename="resizo-converted-photo.avif"');
        expect(sniffImageType(output)).toBe('avif');
    });

    it('accepts an AVIF as input and converts it back to JPEG', async () => {
        const response = await convert({
            bytes: await avifBytes(),
            name: 'shot.avif',
            type: 'image/avif',
            fields: { target_format: 'jpeg' },
        });

        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toBe('image/jpeg');
        expect((await sharp(await readBytes(response)).metadata()).format).toBe('jpeg');
    });

    it('round-trips an AVIF back to AVIF with the pixels intact', async () => {
        const response = await convert({
            bytes: await avifBytes({ width: 48, height: 32 }),
            name: 'shot.avif',
            type: 'image/avif',
            fields: { target_format: 'avif' },
        });
        const output = await readBytes(response);

        expect(sniffImageType(output)).toBe('avif');
        expect(await sharp(output).metadata()).toMatchObject({ width: 48, height: 32 });
    });

    it('names a jpeg output .jpg, not .jpeg', async () => {
        const response = await convert({ bytes: await pngBytes(), name: 'shot.png', type: 'image/png', fields: { target_format: 'jpeg' } });

        expect(response.headers.get('content-disposition'))
            .toContain('filename="resizo-converted-shot.jpg"');
    });

    it.each([
        ['missing', undefined],
        ['an empty string', ''],
        ['gif', 'gif'],
        ['heic', 'heic'],
        ['a path traversal attempt', '../../etc/passwd'],
        ['a header-injection attempt', 'jpeg\r\nX-Injected: 1'],
        ['uppercase JPEG', 'JPEG'],
        ['jpg', 'jpg'],
        ['uppercase AVIF', 'AVIF'],
        ['avif with padding', ' avif '],
    ])('rejects a target_format that is %s', async (_label, target) => {
        const fields = target === undefined ? {} : { target_format: target };
        const response = await convert({ fields });

        expect(response.status).toBe(400);
        expect(await response.json()).toEqual(TARGET_ERROR);
    });

    it('rejects a GIF input', async () => {
        const response = await convert({ bytes: await gifBytes(), name: 'loop.gif', type: 'image/gif', fields: { target_format: 'png' } });

        expect(response.status).toBe(400);
        expect(await response.json()).toEqual(INVALID_TYPE);
    });

    it('returns 429 from its own bucket', async () => {
        clearLimiters();
        const limit = denyLimiter('convert');

        const response = await convert({ fields: { target_format: 'png' } });

        expect(response.status).toBe(429);
        expect(limit).toHaveBeenCalledWith(`convert:${TEST_IP}`);
        expect(await response.json()).toEqual({
            error: 'Too many requests. Please wait a moment before converting again.',
        });
    });

    it('validates the upload before it looks at target_format', async () => {
        const response = await POST(postRequest(URL_UNDER_TEST, buildFormData({ fields: { target_format: 'gif' } })));

        expect(await response.json()).toEqual({ error: 'No file provided in the request.' });
    });

    it('pins the Node runtime', async () => {
        const route = await import('@/app/api/convert/route');
        expect(route.runtime).toBe('nodejs');
        expect(route.maxDuration).toBe(60);
    });
});
