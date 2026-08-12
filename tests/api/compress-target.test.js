/**
 * Exact-size targeting on /api/compress.
 *
 * The search is only correct if it actually converges, so sharp is replaced
 * with an encoder whose output length is a pure, monotonic function of the
 * quality (and, for PNG, the scale) it was handed. That makes every probe the
 * binary search takes observable and every expected byte count arithmetic
 * rather than a guess — a real encoder could not pin the sequence.
 *
 * lib/image/target-size.js and lib/image/pipeline.js both run for real on top.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_PIXELS, MAX_TARGET_BYTES, MIN_TARGET_BYTES, TARGET_SEARCH_ITERATIONS } from '@/lib/constants';
import { compressToTarget } from '@/lib/image/target-size';
import { allowLimiter, clearLimiters } from './helpers/limiter';
import { buildFormData, makeFile, postRequest, readBytes } from './helpers/request';

const harness = vi.hoisted(() => {
    const state = {
        // (quality, scalePercent) -> encoded byte length.
        sizeFor: (quality) => 20_000 + quality * 2_000,
        metadata: { width: 1000, height: 800, format: 'jpeg' },
        metadataError: null,
    };

    const probes = [];

    function makeInstance() {
        let format = null;
        let quality = null;
        let scalePercent = 100;
        const instance = {};

        const encoder = (name) => (options = {}) => {
            format = name;
            quality = options.quality ?? null;
            return instance;
        };

        Object.assign(instance, {
            // compressToTarget decodes once and clones per probe; each clone is
            // an independent instance with its own format/quality/scale state.
            clone: () => makeInstance(),
            metadata: async () => {
                if (state.metadataError) throw state.metadataError;
                return state.metadata;
            },
            resize: ({ width }) => {
                scalePercent = Math.round((width / state.metadata.width) * 100);
                return instance;
            },
            jpeg: encoder('jpeg'),
            png: encoder('png'),
            webp: encoder('webp'),
            avif: encoder('avif'),
            toBuffer: async () => {
                const size = Math.max(1, Math.round(state.sizeFor(quality, scalePercent)));
                probes.push({ format, quality, scalePercent, size });
                return Buffer.alloc(size, 0x41);
            },
        });

        return instance;
    }

    return { state, probes, sharpMock: vi.fn(() => makeInstance()) };
});

vi.mock('sharp', () => ({ default: harness.sharpMock }));

const { POST } = await import('@/app/api/compress/route');

const URL_UNDER_TEST = 'http://localhost:3000/api/compress';

// Only the signature is read before sharp takes over.
const JPEG_HEADER = Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]), Buffer.alloc(60)]);
const PNG_HEADER = Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), Buffer.alloc(56)]);
const WEBP_HEADER = Buffer.concat([
    Buffer.from('RIFF', 'latin1'),
    Buffer.from([0x24, 0x00, 0x00, 0x00]),
    Buffer.from('WEBPVP8 ', 'latin1'),
    Buffer.alloc(52),
]);

const RANGE_ERROR = { error: 'Target size must be a whole number of bytes between 10 KB and 20 MB.' };

function compress({ bytes = JPEG_HEADER, name = 'photo.jpg', type = 'image/jpeg', fields = {} } = {}) {
    return POST(postRequest(URL_UNDER_TEST, buildFormData({ file: makeFile(bytes, { name, type }), fields })));
}

function qualitiesProbed() {
    return harness.probes.map((probe) => probe.quality);
}

beforeEach(() => {
    harness.probes.length = 0;
    harness.state.sizeFor = (quality) => 20_000 + quality * 2_000;
    harness.state.metadata = { width: 1000, height: 800, format: 'jpeg' };
    harness.state.metadataError = null;

    clearLimiters();
    allowLimiter('compress');
});

afterEach(() => {
    clearLimiters();
    vi.restoreAllMocks();
});

describe('the targetBytes field is parsed strictly', () => {
    it.each([
        ['an empty string', ''],
        ['whitespace only', '   '],
        ['non-numeric', 'abc'],
        ['a trailing suffix', '102400abc'],
        ['exponent notation', '1e6'],
        ['fractional', '102400.5'],
        ['negative', '-102400'],
        ['zero', '0'],
        ['a unit suffix', '100KB'],
        ['a thousands separator', '102,400'],
        ['one byte below the 10KB floor', String(MIN_TARGET_BYTES - 1)],
        ['one byte above the 20MB ceiling', String(MAX_TARGET_BYTES + 1)],
    ])('rejects a targetBytes that is %s', async (_label, targetBytes) => {
        const response = await compress({ fields: { targetBytes } });

        expect(response.status).toBe(400);
        expect(await response.json()).toEqual(RANGE_ERROR);
    });

    it('rejects a targetBytes that arrived as a file, not a string', async () => {
        const form = new FormData();
        form.append('file', makeFile(JPEG_HEADER, { name: 'photo.jpg', type: 'image/jpeg' }));
        form.append('targetBytes', makeFile(Buffer.from('102400'), { name: 't.txt', type: 'text/plain' }));

        const response = await POST(postRequest(URL_UNDER_TEST, form));

        expect(response.status).toBe(400);
        expect(await response.json()).toEqual(RANGE_ERROR);
    });

    it('never reaches the encoder when the field is malformed', async () => {
        await compress({ fields: { targetBytes: 'abc' } });

        expect(harness.probes).toHaveLength(0);
    });

    it('still rejects a malformed quality when a valid target is supplied', async () => {
        const response = await compress({ fields: { targetBytes: '102400', quality: 'abc' } });

        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({ error: 'Quality must be an integer between 1 and 100.' });
        expect(harness.probes).toHaveLength(0);
    });

    it.each([
        ['the 10KB floor', String(MIN_TARGET_BYTES)],
        ['the 20MB ceiling', String(MAX_TARGET_BYTES)],
    ])('accepts %s', async (_label, targetBytes) => {
        harness.state.sizeFor = () => 8_000;

        expect((await compress({ fields: { targetBytes } })).status).toBe(200);
    });
});

describe('the quality search converges on the target', () => {
    // sizeFor(q) = 20000 + 2000q, so the largest q that fits 102400 bytes is
    // 41 at exactly 102000. Anything else is a search bug, not a rounding one.
    it('lands on the highest quality whose output still fits', async () => {
        const response = await compress({ fields: { targetBytes: '102400' } });
        const output = await readBytes(response);

        expect(response.status).toBe(200);
        expect(output.length).toBe(102_000);
        expect(output.length).toBeLessThanOrEqual(102_400);
    });

    it('bisects the quality range instead of walking it', async () => {
        await compress({ fields: { targetBytes: '102400' } });

        expect(qualitiesProbed()).toEqual([50, 25, 37, 43, 40, 41, 42]);
    });

    it('never exceeds the encode budget', async () => {
        await compress({ fields: { targetBytes: '102400' } });

        expect(harness.probes.length).toBeLessThanOrEqual(TARGET_SEARCH_ITERATIONS);
    });

    it('holds the budget even when every probe overshoots', async () => {
        harness.state.sizeFor = () => 5_000_000;

        await compress({ fields: { targetBytes: '102400' } });

        expect(harness.probes.length).toBeLessThanOrEqual(TARGET_SEARCH_ITERATIONS);
    });

    it('holds the budget even when every probe fits', async () => {
        harness.state.sizeFor = () => 1_000;

        await compress({ fields: { targetBytes: '102400' } });

        expect(harness.probes.length).toBeLessThanOrEqual(TARGET_SEARCH_ITERATIONS);
    });

    it('takes quality 100 when the whole range fits', async () => {
        harness.state.sizeFor = (quality) => quality * 10;

        const response = await compress({ fields: { targetBytes: '102400' } });

        expect((await readBytes(response)).length).toBe(1_000);
        expect(qualitiesProbed().at(-1)).toBe(100);
    });

    it('lands exactly on a target the encoder can hit to the byte', async () => {
        harness.state.sizeFor = (quality) => quality * 1_024;

        const response = await compress({ fields: { targetBytes: '51200' } });

        expect((await readBytes(response)).length).toBe(51_200);
    });

    it('searches a WebP the same way it searches a JPEG', async () => {
        const response = await compress({
            bytes: WEBP_HEADER,
            name: 'shot.webp',
            type: 'image/webp',
            fields: { targetBytes: '102400' },
        });

        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toBe('image/webp');
        expect((await readBytes(response)).length).toBe(102_000);
        expect(new Set(harness.probes.map((probe) => probe.format))).toEqual(new Set(['webp']));
    });

    it('ignores the quality field entirely once a target is set', async () => {
        const response = await compress({ fields: { targetBytes: '102400', quality: '95' } });

        expect((await readBytes(response)).length).toBe(102_000);
        expect(qualitiesProbed()).not.toContain(95);
    });
});

describe('the size headers report what actually happened', () => {
    it('reports the original, the output and the target', async () => {
        const response = await compress({ fields: { targetBytes: '102400' } });

        expect(response.headers.get('X-Original-Size')).toBe(String(JPEG_HEADER.length));
        expect(response.headers.get('X-Output-Size')).toBe('102000');
        expect(response.headers.get('X-Target-Size')).toBe('102400');
    });

    it('keeps X-Output-Size honest against the body it shipped', async () => {
        const response = await compress({ fields: { targetBytes: '102400' } });
        const output = await readBytes(response);

        expect(Number(response.headers.get('X-Output-Size'))).toBe(output.length);
        expect(Number(response.headers.get('X-Output-Size')))
            .toBeLessThanOrEqual(Number(response.headers.get('X-Target-Size')));
    });

    it('reports the two size headers on an ordinary quality compress too', async () => {
        const response = await compress({ fields: { quality: '60' } });

        expect(response.status).toBe(200);
        expect(response.headers.get('X-Original-Size')).toBe(String(JPEG_HEADER.length));
        expect(response.headers.get('X-Output-Size')).toBe('140000');
        expect(response.headers.get('X-Target-Size')).toBeNull();
    });

    it('never lets a size header displace the download headers', async () => {
        const response = await compress({ fields: { targetBytes: '102400' } });

        expect(response.headers.get('Content-Type')).toBe('image/jpeg');
        expect(response.headers.get('Cache-Control')).toBe('no-store');
        expect(response.headers.get('Content-Disposition'))
            .toContain('filename="resizo-compressed-photo.jpg"');
    });
});

describe('an unreachable target is a 400, not a wrong file', () => {
    it('reports the measured floor rather than shipping an oversized file', async () => {
        const response = await compress({ fields: { targetBytes: '20480' } });

        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({
            error: 'Cannot reach 20 KB for this image. Smallest achievable is 22 KB. Raise the target.',
        });
    });

    it('only gives up after it has actually probed the bottom of the range', async () => {
        await compress({ fields: { targetBytes: '20480' } });

        expect(qualitiesProbed()).toEqual([50, 25, 12, 6, 3, 1]);
        expect(qualitiesProbed()).toContain(1);
    });

    it('quotes a floor the caller can retry with', async () => {
        const response = await compress({ fields: { targetBytes: '20480' } });
        const { error } = await response.json();
        const quoted = Number(/Smallest achievable is (\d+) KB/.exec(error)[1]);

        expect(quoted * 1024).toBeGreaterThanOrEqual(22_000);
    });
});

describe('PNG falls back to quantisation then to pixels', () => {
    beforeEach(() => {
        harness.state.metadata = { width: 1000, height: 800, format: 'png' };
        harness.state.sizeFor = (quality, scalePercent) => (40_000 + quality * 2_000) * (scalePercent / 100) ** 2;
    });

    it('takes the palette alone when quantisation is enough', async () => {
        const response = await compress({
            bytes: PNG_HEADER,
            name: 'shot.png',
            type: 'image/png',
            fields: { targetBytes: '102400' },
        });

        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toBe('image/png');
        expect(harness.probes.every((probe) => probe.scalePercent === 100)).toBe(true);
        expect((await readBytes(response)).length).toBeLessThanOrEqual(102_400);
    });

    it('quantises through the palette, never through a jpeg encoder', async () => {
        await compress({ bytes: PNG_HEADER, name: 'shot.png', type: 'image/png', fields: { targetBytes: '102400' } });

        expect(new Set(harness.probes.map((probe) => probe.format))).toEqual(new Set(['png']));
    });

    // 40000 + 2000 is the floor at full size, so 20 KB is out of reach for the
    // palette alone and the second phase has to drop pixels.
    it('scales the dimensions down when the palette alone cannot reach the target', async () => {
        const response = await compress({
            bytes: PNG_HEADER,
            name: 'shot.png',
            type: 'image/png',
            fields: { targetBytes: '20480' },
        });
        const output = await readBytes(response);

        expect(response.status).toBe(200);
        expect(output.length).toBeLessThanOrEqual(20_480);
        expect(harness.probes.some((probe) => probe.scalePercent < 100)).toBe(true);
    });

    it('keeps the largest scale that still fits, at the smallest palette', async () => {
        await compress({ bytes: PNG_HEADER, name: 'shot.png', type: 'image/png', fields: { targetBytes: '20480' } });

        const scaled = harness.probes.filter((probe) => probe.scalePercent < 100);
        const chosen = scaled.filter((probe) => probe.size <= 20_480).sort((a, b) => b.size - a.size)[0];

        expect(chosen.scalePercent).toBe(69);
        expect(chosen.quality).toBe(1);
    });

    it('runs the palette phase first and the scale phase second', async () => {
        await compress({ bytes: PNG_HEADER, name: 'shot.png', type: 'image/png', fields: { targetBytes: '20480' } });

        const firstScaled = harness.probes.findIndex((probe) => probe.scalePercent < 100);
        const lastFullSize = harness.probes.map((probe) => probe.scalePercent).lastIndexOf(100);

        expect(firstScaled).toBeGreaterThan(lastFullSize);
    });

    it('budgets each phase separately rather than sharing one', async () => {
        await compress({ bytes: PNG_HEADER, name: 'shot.png', type: 'image/png', fields: { targetBytes: '20480' } });

        const paletteProbes = harness.probes.filter((probe) => probe.scalePercent === 100);
        const scaleProbes = harness.probes.filter((probe) => probe.scalePercent < 100);

        expect(paletteProbes.length).toBeLessThanOrEqual(TARGET_SEARCH_ITERATIONS);
        expect(scaleProbes.length).toBeLessThanOrEqual(TARGET_SEARCH_ITERATIONS);
    });

    it('gives up with the floor from both phases when even a 10% scale overshoots', async () => {
        harness.state.sizeFor = () => 5_000_000;

        const response = await compress({
            bytes: PNG_HEADER,
            name: 'shot.png',
            type: 'image/png',
            fields: { targetBytes: '102400' },
        });

        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({
            error: 'Cannot reach 100 KB for this image. Smallest achievable is 4883 KB. Raise the target.',
        });
    });

    it.each([
        ['reports empty metadata', () => { harness.state.metadata = {}; }],
        ['reports a zero width', () => { harness.state.metadata = { width: 0, height: 800 }; }],
        ['reports a NaN height', () => { harness.state.metadata = { width: 1000, height: Number.NaN }; }],
        ['reports no metadata at all', () => { harness.state.metadata = null; }],
        ['throws from metadata', () => { harness.state.metadataError = new Error('vips: unsupported'); }],
    ])('gives up with the palette floor when sharp %s', async (_label, breakMetadata) => {
        harness.state.sizeFor = () => 5_000_000;
        breakMetadata();

        const response = await compress({
            bytes: PNG_HEADER,
            name: 'shot.png',
            type: 'image/png',
            fields: { targetBytes: '102400' },
        });

        expect(response.status).toBe(400);
        expect((await response.json()).error).toContain('Smallest achievable is');
        expect(harness.probes.every((probe) => probe.scalePercent === 100)).toBe(true);
    });

    it('never offers a JPEG the dimension fallback', async () => {
        harness.state.sizeFor = () => 5_000_000;

        const response = await compress({ fields: { targetBytes: '102400' } });

        expect(response.status).toBe(400);
        expect(harness.probes.every((probe) => probe.scalePercent === 100)).toBe(true);
    });
});

describe('the targeted path gates an oversized source before searching', () => {
    it('rejects a source over the pixel budget with a resize-first 400', async () => {
        // 8000x6000 = 48MP, above MAX_PIXELS (40MP).
        harness.state.metadata = { width: 8000, height: 6000, format: 'jpeg' };

        const response = await compress({ fields: { targetBytes: '102400' } });

        expect(response.status).toBe(400);
        expect((await response.json()).error).toMatch(/Resize it first/);
        expect(harness.probes).toHaveLength(0);
    });

    it('lets a source inside the pixel budget through to the search', async () => {
        harness.state.metadata = { width: 4000, height: 3000, format: 'jpeg' };
        expect(4000 * 3000).toBeLessThan(MAX_PIXELS);

        const response = await compress({ fields: { targetBytes: '102400' } });

        expect(response.status).toBe(200);
        expect(harness.probes.length).toBeGreaterThan(0);
    });
});

describe('compressToTarget stops at the wall-clock deadline', () => {
    it('returns the best fit found so far instead of running every probe', async () => {
        // deadline = now() + 100; the first probe runs at t=0, the check before
        // the second sees t=200 and breaks.
        const now = vi.fn()
            .mockReturnValueOnce(0)
            .mockReturnValueOnce(0)
            .mockReturnValue(200);

        const result = await compressToTarget({
            buffer: JPEG_HEADER,
            format: 'jpeg',
            targetBytes: 200_000,
            deadlineMs: 100,
            now,
        });

        // sizeFor(50) = 120000 <= 200000, so the single probe fits.
        expect(result.ok).toBe(true);
        expect(result.iterations).toBe(1);
        expect(harness.probes).toHaveLength(1);
        expect(harness.probes[0].quality).toBe(50);
        expect(result.buffer.length).toBe(120_000);
    });
});
