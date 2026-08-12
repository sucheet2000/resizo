import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from '@/app/api/compress/route';
import { allowLimiter, clearLimiters, denyLimiter } from './helpers/limiter';
import {
    AVIF_HEADER,
    GIF_PREFIX_ONLY,
    SVG_WEBP_POLYGLOT,
    avifBytes,
    gifBytes,
    jpegBytes,
    pngBytes,
    webpBytes,
} from './helpers/fixtures';
import { TEST_IP, buildFormData, makeFile, postRequest, readBytes } from './helpers/request';

const URL_UNDER_TEST = 'http://localhost:3000/api/compress';

const INVALID_TYPE = { error: 'File failed validation. Please upload a valid JPEG, PNG, or WebP image.' };
const QUALITY_ERROR = { error: 'Quality must be an integer between 1 and 100.' };

async function compress({ bytes, name = 'photo.jpg', type = 'image/jpeg', fields = {} } = {}) {
    const body = buildFormData({ file: makeFile(bytes ?? (await jpegBytes()), { name, type }), fields });
    return POST(postRequest(URL_UNDER_TEST, body));
}

beforeEach(() => {
    clearLimiters();
    allowLimiter('compress');
});

afterEach(() => {
    clearLimiters();
    vi.restoreAllMocks();
});

describe('POST /api/compress', () => {
    it('compresses a JPEG at the supplied quality', async () => {
        const response = await compress({ fields: { quality: '40' } });

        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toBe('image/jpeg');
        expect(response.headers.get('content-disposition'))
            .toContain('filename="resizo-compressed-photo.jpg"');
    });

    it('falls back to the default quality when the field is absent', async () => {
        const response = await compress();

        expect(response.status).toBe(200);
        expect((await sharp(await readBytes(response)).metadata()).format).toBe('jpeg');
    });

    it.each([
        ['1', 1],
        ['100', 100],
    ])('accepts the boundary quality %s', async (quality) => {
        expect((await compress({ fields: { quality } })).status).toBe(200);
    });

    it('mirrors the detected input format rather than the declared one', async () => {
        const response = await compress({
            bytes: await pngBytes(),
            name: 'shot.png',
            type: 'image/jpeg',
            fields: { quality: '50' },
        });

        expect(response.headers.get('content-type')).toBe('image/png');
        expect((await sharp(await readBytes(response)).metadata()).format).toBe('png');
    });

    it('keeps a WebP a WebP', async () => {
        const response = await compress({ bytes: await webpBytes(), name: 'shot.webp', type: 'image/webp', fields: { quality: '50' } });

        expect(response.headers.get('content-type')).toBe('image/webp');
    });

    it.each([
        ['zero', '0'],
        ['above the ceiling', '101'],
        ['non-numeric', 'abc'],
        ['exponent notation', '1e2'],
        ['fractional', '50.9'],
        ['negative', '-10'],
        ['an empty string', ''],
        ['whitespace only', '   '],
    ])('rejects a quality that is %s', async (_label, quality) => {
        const response = await compress({ fields: { quality } });

        expect(response.status).toBe(400);
        expect(await response.json()).toEqual(QUALITY_ERROR);
    });

    it('rejects a quality field that arrived as a file, not a string', async () => {
        const form = new FormData();
        form.append('file', makeFile(await jpegBytes(), { name: 'photo.jpg', type: 'image/jpeg' }));
        form.append('quality', makeFile(Buffer.from('80'), { name: 'quality.txt', type: 'text/plain' }));

        const response = await POST(postRequest(URL_UNDER_TEST, form));

        expect(response.status).toBe(400);
        expect(await response.json()).toEqual(QUALITY_ERROR);
    });

    it('rejects a GIF, unlike /api/resize', async () => {
        const response = await compress({ bytes: await gifBytes(), name: 'loop.gif', type: 'image/gif' });

        expect(response.status).toBe(400);
        expect(await response.json()).toEqual(INVALID_TYPE);
    });

    // AVIF is a /convert-only format. Accepting it here would mean handing
    // back an AVIF under an image/avif header from a tool that never offered it.
    it('rejects a real AVIF, which only /api/convert accepts', async () => {
        const response = await compress({ bytes: await avifBytes(), name: 'shot.avif', type: 'image/avif' });

        expect(response.status).toBe(400);
        expect(await response.json()).toEqual(INVALID_TYPE);
    });

    it('rejects an AVIF header renamed as a JPEG', async () => {
        const response = await compress({ bytes: AVIF_HEADER, name: 'photo.jpg', type: 'image/jpeg' });

        expect(response.status).toBe(400);
        expect(await response.json()).toEqual(INVALID_TYPE);
    });

    it('rejects the SVG-with-WEBP-at-offset-8 polyglot', async () => {
        const response = await compress({ bytes: SVG_WEBP_POLYGLOT, name: 'evil.webp', type: 'image/webp' });

        expect(response.status).toBe(400);
        expect(await response.json()).toEqual(INVALID_TYPE);
    });

    it('rejects "GI" plus junk', async () => {
        const response = await compress({ bytes: GIF_PREFIX_ONLY, name: 'evil.gif', type: 'image/gif' });

        expect(response.status).toBe(400);
    });

    it('rejects a missing file', async () => {
        const response = await POST(postRequest(URL_UNDER_TEST, buildFormData({ fields: { quality: '50' } })));

        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({ error: 'No file provided in the request.' });
    });

    it('returns 429 from its own bucket, with Retry-After', async () => {
        clearLimiters();
        const limit = denyLimiter('compress');

        const response = await compress({ fields: { quality: '50' } });

        expect(response.status).toBe(429);
        expect(limit).toHaveBeenCalledWith(`compress:${TEST_IP}`);
        expect(response.headers.get('Retry-After')).toBeTruthy();
        expect(await response.json()).toEqual({
            error: 'Too many requests. Please wait a moment before compressing again.',
        });
    });

    it('pins the Node runtime', async () => {
        const route = await import('@/app/api/compress/route');
        expect(route.runtime).toBe('nodejs');
        expect(route.maxDuration).toBe(60);
    });
});
