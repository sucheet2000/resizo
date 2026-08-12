import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from '@/app/api/crop/route';
import { MAX_DIMENSION } from '@/lib/constants';
import { allowLimiter, clearLimiters, denyLimiter } from './helpers/limiter';
import { gifBytes, jpegBytes, pngBytes } from './helpers/fixtures';
import { TEST_IP, buildFormData, makeFile, postRequest, readBytes } from './helpers/request';

const URL_UNDER_TEST = 'http://localhost:3000/api/crop';

const MISSING = { error: 'Missing crop parameters (crop_x, crop_y, crop_width, crop_height).' };
const INVALID = { error: 'Invalid crop parameters provided.' };
const OUT_OF_BOUNDS = { error: 'Crop parameters are out of bounds of the original image dimensions.' };

async function crop({ bytes, name = 'photo.jpg', type = 'image/jpeg', fields = {} } = {}) {
    const body = buildFormData({ file: makeFile(bytes ?? (await jpegBytes({ width: 50, height: 50 })), { name, type }), fields });
    return POST(postRequest(URL_UNDER_TEST, body));
}

const RECT = { crop_x: '10', crop_y: '10', crop_width: '20', crop_height: '20' };

beforeEach(() => {
    clearLimiters();
    allowLimiter('crop');
});

afterEach(() => {
    clearLimiters();
    vi.restoreAllMocks();
});

describe('POST /api/crop', () => {
    it('crops an in-bounds rectangle', async () => {
        const response = await crop({ fields: RECT });

        expect(response.status).toBe(200);
        const meta = await sharp(await readBytes(response)).metadata();
        expect(meta).toMatchObject({ width: 20, height: 20 });
    });

    it('accepts a rectangle that exactly fills the image', async () => {
        const response = await crop({
            fields: { crop_x: '0', crop_y: '0', crop_width: '50', crop_height: '50' },
        });

        expect(response.status).toBe(200);
        expect((await sharp(await readBytes(response)).metadata()).width).toBe(50);
    });

    it('treats an offset of 0 as valid, not as missing', async () => {
        const response = await crop({
            fields: { crop_x: '0', crop_y: '0', crop_width: '1', crop_height: '1' },
        });

        expect(response.status).toBe(200);
        expect((await sharp(await readBytes(response)).metadata())).toMatchObject({ width: 1, height: 1 });
    });

    it('follows the detected input format for the output', async () => {
        const response = await crop({ bytes: await pngBytes({ width: 50, height: 50 }), name: 'shot.png', type: 'image/png', fields: RECT });

        expect(response.headers.get('content-type')).toBe('image/png');
        expect(response.headers.get('content-disposition')).toContain('filename="resizo-cropped-shot.png"');
    });

    it.each([
        ['crop_x', 'crop_x'],
        ['crop_y', 'crop_y'],
        ['crop_width', 'crop_width'],
        ['crop_height', 'crop_height'],
    ])('reports a missing %s distinctly from a malformed one', async (_label, key) => {
        const fields = { ...RECT };
        delete fields[key];

        const response = await crop({ fields });

        expect(response.status).toBe(400);
        expect(await response.json()).toEqual(MISSING);
    });

    it('treats an empty crop value as missing', async () => {
        const response = await crop({ fields: { ...RECT, crop_x: '' } });

        expect(await response.json()).toEqual(MISSING);
    });

    it.each([
        ['a negative x', { crop_x: '-1' }],
        ['a negative y', { crop_y: '-5' }],
        ['a zero width', { crop_width: '0' }],
        ['a zero height', { crop_height: '0' }],
        ['a fractional width', { crop_width: '50.9' }],
        ['a trailing-garbage width', { crop_width: '100abc' }],
        ['exponent notation', { crop_width: '1e2' }],
        ['a width past MAX_DIMENSION', { crop_width: String(MAX_DIMENSION + 1) }],
        ['a non-numeric offset', { crop_x: 'abc' }],
    ])('rejects %s', async (_label, override) => {
        const response = await crop({ fields: { ...RECT, ...override } });

        expect(response.status).toBe(400);
        expect(await response.json()).toEqual(INVALID);
    });

    it('rejects a crop area that fits the per-side cap but blows the pixel budget', async () => {
        const response = await crop({
            fields: { crop_x: '0', crop_y: '0', crop_width: '8000', crop_height: '8000' },
        });

        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({ error: 'Crop area exceeds the maximum allowed size.' });
    });

    it.each([
        ['x + width overshoots by one', { crop_x: '31', crop_width: '20' }],
        ['y + height overshoots by one', { crop_y: '31', crop_height: '20' }],
        ['the rectangle is larger than the image', { crop_x: '0', crop_y: '0', crop_width: '500', crop_height: '500' }],
    ])('rejects an out-of-bounds crop where %s', async (_label, override) => {
        const response = await crop({ fields: { ...RECT, ...override } });

        expect(response.status).toBe(400);
        expect(await response.json()).toEqual(OUT_OF_BOUNDS);
    });

    it('rejects a GIF input', async () => {
        const response = await crop({ bytes: await gifBytes({ width: 50, height: 50 }), name: 'loop.gif', type: 'image/gif', fields: RECT });

        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({
            error: 'File failed validation. Please upload a valid JPEG, PNG, or WebP image.',
        });
    });

    it('returns 429 from its own bucket', async () => {
        clearLimiters();
        const limit = denyLimiter('crop');

        const response = await crop({ fields: RECT });

        expect(response.status).toBe(429);
        expect(limit).toHaveBeenCalledWith(`crop:${TEST_IP}`);
        expect(await response.json()).toEqual({
            error: 'Too many requests. Please wait a moment before cropping again.',
        });
    });

    it('pins the Node runtime', async () => {
        const route = await import('@/app/api/crop/route');
        expect(route.runtime).toBe('nodejs');
        expect(route.maxDuration).toBe(60);
    });
});
