import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from '@/app/api/resize/route';
import { MAX_FILE_SIZE } from '@/lib/constants';
import { allowLimiter, clearLimiters, denyLimiter } from './helpers/limiter';
import {
    BMP_BYTES,
    GIF_PREFIX_ONLY,
    PDF_BYTES,
    PLAIN_TEXT,
    RIFF_WAVE,
    SVG_WEBP_POLYGLOT,
    ZIP_BYTES,
    gifBytes,
    jpegBytes,
    pngBytes,
    webpBytes,
} from './helpers/fixtures';
import { TEST_IP, buildFormData, makeFile, postRequest, readBytes, stubRequest } from './helpers/request';

const URL_UNDER_TEST = 'http://localhost:3000/api/resize';

async function resize({ bytes, name = 'photo.jpg', type = 'image/jpeg', fields = {}, headers } = {}) {
    const body = buildFormData({ file: makeFile(bytes ?? (await jpegBytes()), { name, type }), fields });
    return POST(postRequest(URL_UNDER_TEST, body, { headers }));
}

beforeEach(() => {
    clearLimiters();
    allowLimiter('resize');
});

afterEach(() => {
    clearLimiters();
    vi.restoreAllMocks();
});

describe('POST /api/resize — happy paths', () => {
    it('resizes to an explicit width and height', async () => {
        const response = await resize({ fields: { width: '50', height: '25' } });

        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toBe('image/jpeg');

        const meta = await sharp(await readBytes(response)).metadata();
        expect(meta.width).toBe(50);
        expect(meta.height).toBe(25);
    });

    it('derives the missing side from the aspect ratio when only width is given', async () => {
        const response = await resize({ bytes: await jpegBytes({ width: 200, height: 100 }), fields: { width: '50' } });

        const meta = await sharp(await readBytes(response)).metadata();
        expect(meta.width).toBe(50);
        expect(meta.height).toBe(25);
    });

    it('derives the missing side from the aspect ratio when only height is given', async () => {
        const response = await resize({ bytes: await jpegBytes({ width: 200, height: 100 }), fields: { height: '25' } });

        const meta = await sharp(await readBytes(response)).metadata();
        expect(meta).toMatchObject({ width: 50, height: 25 });
    });

    it('applies a percentage scale', async () => {
        const response = await resize({ bytes: await jpegBytes({ width: 200, height: 100 }), fields: { scale: '50' } });

        const meta = await sharp(await readBytes(response)).metadata();
        expect(meta).toMatchObject({ width: 100, height: 50 });
    });

    it('clamps a tiny scale to 1x1 instead of asking sharp for a 0x0 image', async () => {
        const response = await resize({ bytes: await jpegBytes({ width: 200, height: 100 }), fields: { scale: '0.01' } });

        expect(response.status).toBe(200);
        const meta = await sharp(await readBytes(response)).metadata();
        expect(meta).toMatchObject({ width: 1, height: 1 });
    });

    it('returns the source untouched when neither width, height nor scale is supplied', async () => {
        const response = await resize({ bytes: await jpegBytes({ width: 64, height: 48 }) });

        expect(response.status).toBe(200);
        const meta = await sharp(await readBytes(response)).metadata();
        expect(meta).toMatchObject({ width: 64, height: 48 });
    });

    it.each([
        ['png', 'image/png', 'png'],
        ['webp', 'image/webp', 'webp'],
        ['jpeg', 'image/jpeg', 'jpeg'],
    ])('honours format=%s', async (format, contentType, sharpFormat) => {
        const response = await resize({ fields: { width: '20', format } });

        expect(response.headers.get('content-type')).toBe(contentType);
        expect((await sharp(await readBytes(response)).metadata()).format).toBe(sharpFormat);
    });

    it('falls back to jpeg for an output format outside the allowlist', async () => {
        const response = await resize({ fields: { width: '20', format: 'gif' } });

        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toBe('image/jpeg');
    });

    // Resize was the one tool whose allowlist carried GIF, and it no longer
    // does: there is no GIF decoder in the browser build, and resizing one only
    // ever produced a still first frame anyway.
    it('refuses a GIF input — no allowlist carries it now, resize included', async () => {
        const response = await resize({ bytes: await gifBytes(), name: 'loop.gif', type: 'image/gif', fields: { width: '20' } });

        expect(response.status).toBe(400);
    });

    it.each([
        ['png', () => pngBytes(), 'shot.png', 'image/png'],
        ['webp', () => webpBytes(), 'shot.webp', 'image/webp'],
    ])('accepts a %s input', async (_label, build, name, type) => {
        const response = await resize({ bytes: await build(), name, type, fields: { width: '20' } });
        expect(response.status).toBe(200);
    });

    it('sets a no-store cache header and an RFC 6266 filename', async () => {
        const response = await resize({ fields: { width: '20' } });

        expect(response.headers.get('cache-control')).toBe('no-store');
        expect(response.headers.get('content-disposition'))
            .toBe('attachment; filename="resizo-processed-photo.jpg"; filename*=UTF-8\'\'resizo-processed-photo.jpg');
    });

    it('percent-encodes a non-ASCII filename instead of emitting raw bytes in the header', async () => {
        const response = await resize({ name: '照片.jpg', fields: { width: '20' } });

        const disposition = response.headers.get('content-disposition');
        expect(disposition).toBe(
            'attachment; filename="resizo-processed-__.jpg"; filename*=UTF-8\'\'resizo-processed-%E7%85%A7%E7%89%87.jpg'
        );
        expect(disposition).not.toMatch(/[\r\n]/);
    });

    it('never lets a filename inject a second header', async () => {
        const response = await resize({ name: 'a\r\nX-Injected: 1.jpg', fields: { width: '20' } });

        expect(response.headers.get('x-injected')).toBeNull();
        expect(response.headers.get('content-disposition')).not.toMatch(/[\r\n]/);
    });
});

describe('POST /api/resize — rate limiting', () => {
    it('returns 429 with the limit, remaining and Retry-After headers', async () => {
        clearLimiters();
        denyLimiter('resize', { limit: 10, remaining: 0, resetInMs: 45_000 });

        const response = await resize({ fields: { width: '20' } });

        expect(response.status).toBe(429);
        expect(response.headers.get('X-RateLimit-Limit')).toBe('10');
        expect(response.headers.get('X-RateLimit-Remaining')).toBe('0');

        const retryAfter = Number(response.headers.get('Retry-After'));
        expect(retryAfter).toBeGreaterThan(0);
        expect(retryAfter).toBeLessThanOrEqual(45);

        expect(await response.json()).toEqual({
            error: 'Too many requests. Please wait a moment before resizing again.',
        });
    });

    it('reports the remaining allowance on a successful response', async () => {
        clearLimiters();
        allowLimiter('resize', { limit: 10, remaining: 4 });

        const response = await resize({ fields: { width: '20' } });

        expect(response.status).toBe(200);
        expect(response.headers.get('X-RateLimit-Remaining')).toBe('4');
    });

    it('keys the bucket on the caller IP under its own route name', async () => {
        clearLimiters();
        const limit = allowLimiter('resize');

        await resize({ fields: { width: '20' } });

        expect(limit).toHaveBeenCalledWith(`resize:${TEST_IP}`);
    });

    it('gives an unidentifiable caller its own bucket rather than one shared anon key', async () => {
        clearLimiters();
        const limit = allowLimiter('resize');
        const body = buildFormData({ file: makeFile(await jpegBytes(), {}), fields: { width: '20' } });

        await POST(new Request(URL_UNDER_TEST, { method: 'POST', body }));

        expect(limit.mock.calls[0][0]).toMatch(/^resize:anon:.+/);
    });

    it('does not run the pipeline at all when the limiter denies the request', async () => {
        clearLimiters();
        denyLimiter('resize');

        const response = await resize({ bytes: PLAIN_TEXT, type: 'text/plain', fields: { width: '20' } });

        expect(response.status).toBe(429);
    });
});

describe('POST /api/resize — upload validation', () => {
    it('rejects a request with no file field', async () => {
        const response = await POST(postRequest(URL_UNDER_TEST, buildFormData({ fields: { width: '20' } })));

        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({ error: 'No file provided in the request.' });
    });

    it('rejects a text form field posted as `file` with a 400, not a 500', async () => {
        const body = new FormData();
        body.append('file', 'photo.jpg');
        body.append('width', '20');

        const response = await POST(postRequest(URL_UNDER_TEST, body));

        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({ error: 'No valid file was uploaded.' });
    });

    it('rejects a zero-byte file', async () => {
        const response = await resize({ bytes: Buffer.alloc(0) });

        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({ error: 'The uploaded file is empty.' });
    });

    it('rejects a declared MIME type outside the image allowlist', async () => {
        const response = await resize({ bytes: PLAIN_TEXT, name: 'notes.txt', type: 'text/plain' });

        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({ error: 'Invalid file type. Only images are allowed.' });
    });

    it('rejects a file over the 20MB cap', async () => {
        const file = makeFile(await jpegBytes(), { size: MAX_FILE_SIZE + 1 });
        const body = buildFormData({ file, fields: { width: '20' } });

        const response = await POST(stubRequest(URL_UNDER_TEST, body));

        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({ error: 'File exceeds the maximum allowed size of 20MB.' });
    });

    it('accepts a file exactly at the 20MB cap', async () => {
        const file = makeFile(await jpegBytes(), { size: MAX_FILE_SIZE });
        const body = buildFormData({ file, fields: { width: '20' } });

        const response = await POST(stubRequest(URL_UNDER_TEST, body));

        expect(response.status).toBe(200);
    });

    // A JSON body is now a recognised content type — it can carry a `blobUrl`
    // for a large upload the browser sent straight to Blob. One that carries
    // neither a file nor a blobUrl is rejected as a plain missing file.
    it('rejects a JSON body that carries no file and no blobUrl', async () => {
        const response = await POST(new Request(URL_UNDER_TEST, {
            method: 'POST',
            body: '{"width":20}',
            headers: { 'content-type': 'application/json', 'x-real-ip': TEST_IP },
        }));

        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({
            error: 'No file provided in the request.',
        });
    });
});

describe('POST /api/resize — magic bytes decide, not the declared MIME type', () => {
    const INVALID = { error: 'File failed validation. Please upload a valid image.' };

    it('rejects the SVG polyglot whose bytes 8-11 spell WEBP', async () => {
        const response = await resize({ bytes: SVG_WEBP_POLYGLOT, name: 'evil.webp', type: 'image/webp' });

        expect(response.status).toBe(400);
        expect(await response.json()).toEqual(INVALID);
    });

    it('rejects "GI" plus junk, which the old two-byte GIF check accepted', async () => {
        const response = await resize({ bytes: GIF_PREFIX_ONLY, name: 'evil.gif', type: 'image/gif' });

        expect(response.status).toBe(400);
        expect(await response.json()).toEqual(INVALID);
    });

    it.each([
        ['a WAV wearing a RIFF header', RIFF_WAVE],
        ['a PDF', PDF_BYTES],
        ['a BMP', BMP_BYTES],
        ['a ZIP', ZIP_BYTES],
        ['plain text', PLAIN_TEXT],
    ])('rejects %s renamed to .jpg with an image MIME type', async (_label, bytes) => {
        const response = await resize({ bytes, name: 'evil.jpg', type: 'image/jpeg' });

        expect(response.status).toBe(400);
        expect(await response.json()).toEqual(INVALID);
    });

    it('rejects a JPEG truncated to two signature bytes', async () => {
        const response = await resize({ bytes: Buffer.from([0xFF, 0xD8]) });

        expect(response.status).toBe(400);
        expect(await response.json()).toEqual(INVALID);
    });
});

describe('POST /api/resize — strict dimension parsing', () => {
    const DIMENSION_ERROR = { error: 'Dimensions exceed maximum allowed values.' };

    it.each([
        ['width above MAX_DIMENSION', { width: '8001' }],
        ['width of zero', { width: '0' }],
        ['a negative width', { width: '-100' }],
        ['a trailing-garbage width', { width: '8000abc' }],
        ['exponent notation', { width: '1e10' }],
        ['hex notation', { width: '0x10' }],
        ['a fractional width', { width: '50.9' }],
        ['a signed width', { width: '+800' }],
        ['a non-numeric width', { width: 'abc' }],
        ['a height above MAX_DIMENSION', { height: '8001' }],
        ['a fractional height', { height: '50.9' }],
    ])('rejects %s', async (_label, fields) => {
        const response = await resize({ fields });

        expect(response.status).toBe(400);
        expect(await response.json()).toEqual(DIMENSION_ERROR);
    });

    it.each([
        ['zero', '0'],
        ['a negative percentage', '-50'],
        ['above the 400 ceiling', '400.1'],
        ['exponent notation', '1e400'],
        ['a non-numeric scale', 'abc'],
    ])('rejects a scale of %s', async (_label, scale) => {
        const response = await resize({ fields: { scale } });

        expect(response.status).toBe(400);
        expect((await response.json()).error).toMatch(/Scale must be/);
    });

    it('ignores an empty scale field rather than failing on it', async () => {
        const response = await resize({ fields: { scale: '' } });

        expect(response.status).toBe(200);
    });

    it('treats an empty height alongside a real width as "not supplied"', async () => {
        const response = await resize({
            bytes: await jpegBytes({ width: 200, height: 100 }),
            fields: { width: '50', height: '' },
        });

        expect(response.status).toBe(200);
        expect(await sharp(await readBytes(response)).metadata()).toMatchObject({ width: 50, height: 25 });
    });

    it('lets explicit dimensions win over a scale sent in the same body', async () => {
        const response = await resize({
            bytes: await jpegBytes({ width: 200, height: 100 }),
            fields: { width: '40', height: '20', scale: '400' },
        });

        const meta = await sharp(await readBytes(response)).metadata();
        expect(meta).toMatchObject({ width: 40, height: 20 });
    });
});

describe('POST /api/resize — size bombs', () => {
    it('rejects a scale that would blow past MAX_DIMENSION', async () => {
        const response = await resize({
            bytes: await jpegBytes({ width: 2100, height: 2100 }),
            fields: { scale: '400' },
        });

        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({ error: 'Dimensions exceed maximum allowed values.' });
    });

    it('rejects a scale that stays under MAX_DIMENSION but blows the pixel budget', async () => {
        const response = await resize({
            bytes: await jpegBytes({ width: 4000, height: 4000 }),
            fields: { scale: '200' },
        });

        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({ error: 'Dimensions exceed maximum allowed values.' });
    });

    it.each([
        ['a width that stretches the height past MAX_DIMENSION', { width: 200, height: 400 }, { width: '8000' }],
        ['a height that stretches the width past MAX_DIMENSION', { width: 400, height: 200 }, { height: '8000' }],
        ])('rejects %s', async (_label, source, fields) => {
        const response = await resize({ bytes: await jpegBytes(source), fields });

        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({ error: 'Dimensions exceed maximum allowed values.' });
    });

    it('applies the caps to the side sharp derives, not just the side the caller sent', async () => {
        const response = await resize({
            bytes: await jpegBytes({ width: 3000, height: 3000 }),
            fields: { width: '8000' },
        });

        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({ error: 'Dimensions exceed maximum allowed values.' });
    });

    it('rejects a scale that blows the pixel budget from an oversized source', async () => {
        const response = await resize({
            bytes: await jpegBytes({ width: 8000, height: 6000 }),
            fields: { scale: '400' },
        });

        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({ error: 'Dimensions exceed maximum allowed values.' });
    });
});

/**
 * MAX_PIXELS is the budget for what comes OUT. A source above it is the normal
 * case — every recent phone shoots past 40MP — and shrinking one is the whole
 * reason this route exists. These four used to be 400s.
 */
describe('POST /api/resize — a source larger than the output budget is the point', () => {
    it('shrinks a 48MP source to a 12MP output at scale 50', async () => {
        const response = await resize({
            bytes: await jpegBytes({ width: 8000, height: 6000 }),
            fields: { scale: '50' },
        });

        expect(response.status).toBe(200);
        expect(await sharp(await readBytes(response)).metadata()).toMatchObject({ width: 4000, height: 3000 });
    });

    it('accepts a source longer than MAX_DIMENSION on one side', async () => {
        const response = await resize({
            bytes: await jpegBytes({ width: 9000, height: 2000 }),
            fields: { width: '100' },
        });

        expect(response.status).toBe(200);
        expect(await sharp(await readBytes(response)).metadata()).toMatchObject({ width: 100, height: 22 });
    });

    it('accepts a 42MP source, which the old decode cap rejected outright', async () => {
        const response = await resize({
            bytes: await jpegBytes({ width: 7000, height: 6000 }),
            fields: { width: '100' },
        });

        expect(response.status).toBe(200);
    });

    it('re-encodes an oversized source with no resize step at all', async () => {
        const response = await resize({ bytes: await jpegBytes({ width: 8000, height: 6000 }) });

        expect(response.status).toBe(200);
        expect(await sharp(await readBytes(response)).metadata()).toMatchObject({ width: 8000, height: 6000 });
    });
});

/**
 * Every one of these is a MIME type a real browser or camera actually sends.
 * The exact-match allowlist rejected them with a 400 the client-side gate
 * (file.type.startsWith('image/')) had already waved through, so the upload
 * failed only after the bytes were on the wire.
 */
describe('POST /api/resize — MIME aliases reach the magic-byte check', () => {
    it.each([
        ['image/jpg'],
        ['image/pjpeg'],
        ['image/x-png'],
    ])('accepts a real JPEG declared as %s', async (type) => {
        const response = await resize({ type, fields: { width: '20' } });

        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toBe('image/jpeg');
    });

    it('still rejects an alias whose bytes are not an image', async () => {
        const response = await resize({ bytes: PLAIN_TEXT, name: 'evil.jpg', type: 'image/jpg' });

        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({
            error: 'File failed validation. Please upload a valid image.',
        });
    });
});

describe('POST /api/resize — route configuration', () => {
    it('exports only POST and pins the Node runtime', async () => {
        const route = await import('@/app/api/resize/route');

        expect(route.runtime).toBe('nodejs');
        expect(route.maxDuration).toBe(60);
        expect(typeof route.POST).toBe('function');
        expect(route.GET).toBeUndefined();
    });

    // The old module-scope Redis.fromEnv() threw during import, so the whole
    // route was unloadable without Upstash credentials. It now imports, and a
    // missing limiter fails OPEN rather than 500-ing every tool at once.
    it('imports and answers without Upstash configured, failing open at request time', async () => {
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        clearLimiters();

        expect(process.env.UPSTASH_REDIS_REST_URL).toBeUndefined();

        const response = await resize({ fields: { width: '20' } });

        expect(response.status).toBe(200);

        const logged = errorSpy.mock.calls
            .map(([line]) => line)
            .filter((line) => typeof line === 'string');
        expect(logged.some((line) => line.includes('RATELIMIT_UNAVAILABLE'))).toBe(true);
    });
});
