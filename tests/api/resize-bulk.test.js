import JSZip from 'jszip';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from '@/app/api/resize-bulk/route';
import { MAX_BULK_FILES } from '@/lib/constants';
import { allowLimiter, clearLimiters, denyLimiter } from './helpers/limiter';
import { GIF_PREFIX_ONLY, PLAIN_TEXT, gifBytes, jpegBytes, pngBytes, webpBytes } from './helpers/fixtures';
import { TEST_IP, buildFormData, makeFile, postRequest, readBytes, stubRequest } from './helpers/request';

const URL_UNDER_TEST = 'http://localhost:3000/api/resize-bulk';

const EIGHTEEN_MB = 18 * 1024 * 1024;

/**
 * @param items array of { bytes, name, type, config, size, index }
 */
async function bulkForm(items) {
    const form = new FormData();
    for (const [position, item] of items.entries()) {
        const index = item.index ?? position;
        if (item.raw !== undefined) {
            form.append(`file_${index}`, item.raw);
        } else {
            form.append(`file_${index}`, makeFile(item.bytes ?? (await jpegBytes()), {
                name: item.name ?? `photo-${index}.jpg`,
                type: item.type ?? 'image/jpeg',
                size: item.size,
            }));
        }
        if (item.config !== undefined) form.append(`config_${index}`, item.config);
    }
    return form;
}

async function bulk(items, { direct = false } = {}) {
    const form = await bulkForm(items);
    return POST(direct ? stubRequest(URL_UNDER_TEST, form) : postRequest(URL_UNDER_TEST, form));
}

async function zipEntries(response) {
    const zip = await JSZip.loadAsync(await readBytes(response));
    return Object.keys(zip.files).sort();
}

beforeEach(() => {
    clearLimiters();
    allowLimiter('bulk');
});

afterEach(() => {
    clearLimiters();
    vi.restoreAllMocks();
});

describe('POST /api/resize-bulk — happy paths', () => {
    it('returns a ZIP containing one entry per upload', async () => {
        const response = await bulk([{}, {}, {}]);

        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toBe('application/zip');
        expect(response.headers.get('content-disposition')).toContain('filename="resizo-bulk.zip"');
        expect(response.headers.get('cache-control')).toBe('no-store');
        expect(await zipEntries(response)).toHaveLength(3);
    });

    it('reports the remaining allowance on success', async () => {
        clearLimiters();
        allowLimiter('bulk', { limit: 5, remaining: 2 });

        const response = await bulk([{}]);

        expect(response.headers.get('X-RateLimit-Remaining')).toBe('2');
    });

    it('processes file_0 and file_2 when file_1 is missing', async () => {
        const response = await bulk([
            { index: 0, name: 'first.jpg' },
            { index: 2, name: 'third.jpg' },
        ]);

        expect(response.status).toBe(200);
        const entries = await zipEntries(response);
        expect(entries).toHaveLength(2);
        expect(entries.some((name) => name.includes('first'))).toBe(true);
        expect(entries.some((name) => name.includes('third'))).toBe(true);
    });

    it('ignores a file_ key whose suffix is not a number', async () => {
        const form = await bulkForm([{ index: 0, name: 'real.jpg' }]);
        form.append('file_abc', makeFile(await jpegBytes(), { name: 'ignored.jpg' }));

        const response = await POST(postRequest(URL_UNDER_TEST, form));

        expect(await zipEntries(response)).toHaveLength(1);
    });

    it('names entries resizo-<base>-<width>x<height>.<ext>', async () => {
        const response = await bulk([
            { name: 'holiday.jpg', bytes: await jpegBytes({ width: 200, height: 100 }), config: JSON.stringify({ width: 80 }) },
        ]);

        expect(await zipEntries(response)).toEqual(['resizo-holiday-80x40.jpg']);
    });

    it('reports the dimensions of the encoded output, not the requested ones', async () => {
        const response = await bulk([
            { name: 'holiday.jpg', bytes: await jpegBytes({ width: 200, height: 100 }), config: JSON.stringify({ height: 50 }) },
        ]);

        expect(await zipEntries(response)).toEqual(['resizo-holiday-100x50.jpg']);
    });

    it('gives two identically named uploads two distinct ZIP entries', async () => {
        const response = await bulk([
            { name: 'same.jpg' },
            { name: 'same.jpg' },
            { name: 'same.jpg' },
        ]);

        const entries = await zipEntries(response);
        expect(entries).toHaveLength(3);
        expect(new Set(entries).size).toBe(3);
        expect(entries).toContain('resizo-same-100x80.jpg');
        expect(entries).toContain('resizo-same-100x80-2.jpg');
        expect(entries).toContain('resizo-same-100x80-3.jpg');
    });

    it('gives an emoji-only filename a usable base instead of resizo--100x80.jpg', async () => {
        const response = await bulk([{ name: '🙂.jpg' }]);

        expect(await zipEntries(response)).toEqual(['resizo-image-100x80.jpg']);
    });

    it('returns 20 distinct entries for 20 uploads that all share one filename', async () => {
        const items = Array.from({ length: MAX_BULK_FILES }, (_unused, index) => ({ name: 'IMG_0001.jpg', index }));

        const response = await bulk(items);
        const entries = await zipEntries(response);

        expect(response.status).toBe(200);
        expect(entries).toHaveLength(MAX_BULK_FILES);
        expect(new Set(entries).size).toBe(MAX_BULK_FILES);
    });
});

describe('POST /api/resize-bulk — output format resolution', () => {
    it.each([
        ['original', 'shot.png', () => pngBytes(), 'image/png', 'resizo-shot-100x80.png'],
        ['same', 'shot.png', () => pngBytes(), 'image/png', 'resizo-shot-100x80.png'],
        ['original', 'shot.webp', () => webpBytes(), 'image/webp', 'resizo-shot-100x80.webp'],
        ['same', 'shot.webp', () => webpBytes(), 'image/webp', 'resizo-shot-100x80.webp'],
    ])('resolves format "%s" to the source format for %s', async (format, name, build, type, expected) => {
        const response = await bulk([{ name, type, bytes: await build(), config: JSON.stringify({ format }) }]);

        expect(response.status).toBe(200);
        expect(await zipEntries(response)).toEqual([expected]);
    });

    it('falls back to jpeg when the source format has no encoder in the allowlist', async () => {
        const response = await bulk([
            { name: 'loop.gif', type: 'image/gif', bytes: await gifBytes({ width: 40, height: 30 }), config: JSON.stringify({ format: 'original' }) },
        ]);

        expect(await zipEntries(response)).toEqual(['resizo-loop-40x30.jpg']);
    });

    it('keeps the source format when no config is supplied at all', async () => {
        const response = await bulk([{ name: 'shot.png', type: 'image/png', bytes: await pngBytes() }]);

        expect(await zipEntries(response)).toEqual(['resizo-shot-100x80.png']);
    });

    it('honours an explicit target format', async () => {
        const response = await bulk([{ name: 'photo.jpg', config: JSON.stringify({ format: 'webp' }) }]);

        expect(await zipEntries(response)).toEqual(['resizo-photo-100x80.webp']);
    });

    it('accepts an uppercase format spelling', async () => {
        const response = await bulk([{ name: 'photo.jpg', config: JSON.stringify({ format: 'PNG' }) }]);

        expect(await zipEntries(response)).toEqual(['resizo-photo-100x80.png']);
    });

    it('rejects an output format outside the allowlist', async () => {
        const response = await bulk([{ config: JSON.stringify({ format: 'gif' }) }]);

        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({ error: 'Invalid output format for file 0.' });
    });
});

describe('POST /api/resize-bulk — request validation', () => {
    it('rejects a request with no files', async () => {
        const response = await POST(postRequest(URL_UNDER_TEST, new FormData()));

        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({ error: 'No files provided.' });
    });

    it('rejects a batch of 21 files outright instead of silently dropping one', async () => {
        const items = Array.from({ length: MAX_BULK_FILES + 1 }, (_unused, index) => ({ index }));

        const response = await bulk(items);

        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({
            error: 'A maximum of 20 images can be processed in one request.',
        });
    });

    it('rejects a body that is not a multipart form', async () => {
        const response = await POST(new Request(URL_UNDER_TEST, {
            method: 'POST',
            body: '[]',
            headers: { 'content-type': 'application/json', 'x-real-ip': TEST_IP },
        }));

        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({
            error: 'Invalid request body. Expected a multipart form upload.',
        });
    });

    it.each([
        ['the literal null', 'null'],
        ['malformed JSON', '{bad json'],
        ['a JSON array', '[]'],
        ['a bare string', '"png"'],
        ['a number', '7'],
    ])('rejects a config that is %s with a 400, not a 500', async (_label, config) => {
        const response = await bulk([{ config }]);

        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({ error: 'Invalid configuration for file 0.' });
    });

    it('rejects a config field that arrived as a file rather than a string', async () => {
        const form = await bulkForm([{ index: 0 }]);
        form.append('config_0', makeFile(Buffer.from('{"width":80}'), { name: 'config.json', type: 'application/json' }));

        const response = await POST(postRequest(URL_UNDER_TEST, form));

        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({ error: 'Invalid configuration for file 0.' });
    });

    it('treats an empty config string as no config', async () => {
        const response = await bulk([{ config: '' }]);

        expect(response.status).toBe(200);
    });

    it('names the offending index when one file fails the magic-byte check', async () => {
        const response = await bulk([
            { index: 0 },
            { index: 1, bytes: GIF_PREFIX_ONLY, name: 'evil.gif', type: 'image/gif' },
        ]);

        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({ error: 'File 1 failed validation.' });
    });

    it('names the offending index when one entry is a text field, not a file', async () => {
        const response = await bulk([
            { index: 0 },
            { index: 1, raw: 'not-a-file' },
        ]);

        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({ error: 'File 1: No valid file was uploaded.' });
    });

    it('rejects a non-image MIME type per file', async () => {
        const response = await bulk([{ bytes: PLAIN_TEXT, name: 'notes.txt', type: 'text/plain' }]);

        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({ error: 'File 0: Invalid file type. Only images are allowed.' });
    });

    it.each([
        ['a fractional width', { width: '50.9' }],
        ['a trailing-garbage width', { width: '100abc' }],
        ['a width past MAX_DIMENSION', { width: 8001 }],
        ['a zero width', { width: 0 }],
        ['a boolean width', { width: true }],
    ])('rejects %s in a per-file config', async (_label, config) => {
        const response = await bulk([{ config: JSON.stringify(config) }]);

        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({ error: 'Dimensions exceed maximum allowed values.' });
    });

    it.each([
        ['stretches the derived height past MAX_DIMENSION', { width: 200, height: 400 }, { width: 8000 }],
        ['stretches the derived width past MAX_DIMENSION', { width: 400, height: 200 }, { height: 8000 }],
        ['blows the output pixel budget', { width: 3000, height: 3000 }, { width: 8000 }],
    ])('rejects a per-file config that %s', async (_label, source, config) => {
        const response = await bulk([{ bytes: await jpegBytes(source), config: JSON.stringify(config) }]);

        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({ error: 'Dimensions exceed maximum allowed values.' });
    });

    it.each([
        ['image/jpg'],
        ['image/pjpeg'],
        ['image/x-png'],
    ])('accepts a real JPEG declared as %s', async (type) => {
        const response = await bulk([{ name: 'photo.jpg', type }]);

        expect(response.status).toBe(200);
        expect(await zipEntries(response)).toEqual(['resizo-photo-100x80.jpg']);
    });
});

/**
 * MAX_PIXELS bounds the output, not the upload. Both of these used to be 400s,
 * which meant a batch of ordinary phone photos could not be resized at all.
 */
describe('POST /api/resize-bulk — a source larger than the output budget is the point', () => {
    it('shrinks a source longer than MAX_DIMENSION on one side', async () => {
        const response = await bulk([
            { name: 'wide.jpg', bytes: await jpegBytes({ width: 9000, height: 2000 }), config: JSON.stringify({ width: 900 }) },
        ]);

        expect(response.status).toBe(200);
        expect(await zipEntries(response)).toEqual(['resizo-wide-900x200.jpg']);
    });

    it('shrinks a 48MP source to a 12MP output', async () => {
        const response = await bulk([
            { name: 'phone.jpg', bytes: await jpegBytes({ width: 8000, height: 6000 }), config: JSON.stringify({ width: 4000 }) },
        ]);

        expect(response.status).toBe(200);
        expect(await zipEntries(response)).toEqual(['resizo-phone-4000x3000.jpg']);
    });

    it('still rejects a per-file config whose output blows the budget', async () => {
        const response = await bulk([
            { bytes: await jpegBytes({ width: 8000, height: 6000 }), config: JSON.stringify({ width: 8000 }) },
        ]);

        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({ error: 'Dimensions exceed maximum allowed values.' });
    });
});

describe('POST /api/resize-bulk — aggregate size budget', () => {
    it('rejects a batch whose combined size passes 80MB with a 413', async () => {
        const items = Array.from({ length: 5 }, (_unused, index) => ({ index, size: EIGHTEEN_MB }));

        const response = await bulk(items, { direct: true });

        expect(response.status).toBe(413);
        expect(await response.json()).toEqual({
            error: 'The combined size of these files is too large for one request.',
        });
    });

    it('accepts a batch that stays under the aggregate budget', async () => {
        const items = Array.from({ length: 4 }, (_unused, index) => ({ index, size: EIGHTEEN_MB }));

        const response = await bulk(items, { direct: true });

        expect(response.status).toBe(200);
    });

    it('still enforces the 20MB per-file cap inside a batch', async () => {
        const response = await bulk([{ size: 21 * 1024 * 1024 }], { direct: true });

        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({
            error: 'File 0: File exceeds the maximum allowed size of 20MB.',
        });
    });
});

describe('POST /api/resize-bulk — rate limiting', () => {
    it('returns 429 from the bulk bucket with Retry-After', async () => {
        clearLimiters();
        const limit = denyLimiter('bulk', { limit: 5, remaining: 0 });

        const response = await bulk([{}]);

        expect(response.status).toBe(429);
        expect(limit).toHaveBeenCalledWith(`bulk:${TEST_IP}`);
        expect(response.headers.get('X-RateLimit-Limit')).toBe('5');
        expect(Number(response.headers.get('Retry-After'))).toBeGreaterThan(0);
        expect(await response.json()).toEqual({
            error: 'Too many requests. Please wait before processing again.',
        });
    });

    it('pins the Node runtime', async () => {
        const route = await import('@/app/api/resize-bulk/route');
        expect(route.runtime).toBe('nodejs');
        expect(route.maxDuration).toBe(60);
    });
});
