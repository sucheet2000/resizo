/**
 * Exact-size compression in the browser, proved against the real codecs.
 *
 * "Compress this to 100 KB" is the request behind the highest-traffic pages on
 * the site, so nothing here is stubbed unless the point of the test is a
 * decision rather than a measurement. Every byte count asserted below came out
 * of MozJPEG, libwebp or the Squoosh PNG encoder for real.
 *
 * Three claims are under test, and they are the three the product decision
 * rests on:
 *
 *   1. JPEG and WebP REACH the target, at full resolution, within the bounded
 *      probe budget. No proxy, no extrapolation — a prior spike proved that
 *      shortcut undershoots by up to 82%.
 *   2. A PNG asked for a byte target is NEVER silently shrunk. It comes back at
 *      its source dimensions with `targetMet` telling the truth, so /compress
 *      can offer WebP instead of handing somebody a thumbnail.
 *   3. The quality slider's effect on a PNG is reported as `qualityApplied:
 *      false`, because this build has no quantiser for it to drive.
 */
import sharp from 'sharp';
import { beforeAll, describe, expect, it } from 'vitest';

import { TARGET_SEARCH_ITERATIONS } from '@/lib/constants';
import { installBrowserEnv } from './helpers/browser-env';

const KB = 1024;

let compressToTargetBytes;
let encodeImageData;
let runOperation;
let LOSSLESS;
let NATIVE;
let SEARCH;
let reachesTargetBytes;

beforeAll(async () => {
    installBrowserEnv();
    ({ compressToTargetBytes, reachesTargetBytes, LOSSLESS, NATIVE, SEARCH } = await import('@/lib/image-client/compress-target'));
    ({ encodeImageData } = await import('@/lib/image-client/encode'));
    ({ runOperation } = await import('@/lib/image-client/operations'));
});

/**
 * A picture that does not compress to nothing.
 *
 * Flat colour and smooth gradients encode to a few kilobytes at every quality,
 * which would make a byte target trivially met and prove nothing. Deterministic
 * per-pixel noise over a gradient is the cheap stand-in for a photograph: it
 * has real entropy, so its size actually responds to the quality dial and its
 * lossless PNG is genuinely large.
 */
function noisyPixels(width, height, seed = 7) {
    let state = seed;
    const random = () => {
        state = (state * 1103515245 + 12345) % 2147483648;
        return state / 2147483648;
    };

    const raw = Buffer.alloc(width * height * 3);
    for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
            const offset = (y * width + x) * 3;
            raw[offset] = Math.min(255, Math.floor((x * 255) / width) + Math.floor(random() * 120));
            raw[offset + 1] = Math.min(255, Math.floor((y * 255) / height) + Math.floor(random() * 120));
            raw[offset + 2] = Math.min(255, ((x * y) % 255) + Math.floor(random() * 120));
        }
    }

    return sharp(raw, { raw: { width, height, channels: 3 } });
}

const cache = new Map();
function memo(key, build) {
    if (!cache.has(key)) cache.set(key, build());
    return cache.get(key);
}

const noisyJpeg = ({ width = 400, height = 300 } = {}) => memo(
    `jpeg:${width}x${height}`,
    () => noisyPixels(width, height).jpeg({ quality: 95 }).toBuffer(),
);

const noisyPng = ({ width = 400, height = 300 } = {}) => memo(
    `png:${width}x${height}`,
    () => noisyPixels(width, height).png().toBuffer(),
);

const noisyWebp = ({ width = 400, height = 300 } = {}) => memo(
    `webp:${width}x${height}`,
    () => noisyPixels(width, height).webp({ quality: 95 }).toBuffer(),
);

/** A picture a lossless encoder CAN squeeze under 10 KB. */
const flatPng = ({ width = 120, height = 90 } = {}) => memo(
    `flat:${width}x${height}`,
    () => sharp({ create: { width, height, channels: 3, background: { r: 200, g: 40, b: 80 } } })
        .png()
        .toBuffer(),
);

function compress(source, options) {
    return runOperation('compress', source, options);
}

/* ------------------------------------------------------------------ *
 * 1. The target is reached, at full resolution
 * ------------------------------------------------------------------ */

describe('a byte target is reached at full resolution', () => {
    it.each([
        ['JPEG', noisyJpeg, 'jpeg', 20 * KB],
        ['JPEG', noisyJpeg, 'jpeg', 50 * KB],
        ['WebP', noisyWebp, 'webp', 20 * KB],
        ['WebP', noisyWebp, 'webp', 50 * KB],
    ])('%s hits %s at %d bytes without touching the dimensions', async (_label, fixture, format, targetBytes) => {
        const source = await fixture();
        const result = await compress(source, { targetBytes: String(targetBytes) });

        expect(result.format).toBe(format);
        expect(result.targetMet).toBe(true);
        expect(result.resultBytes).toBeLessThanOrEqual(targetBytes);
        // The whole point of not running the search on a proxy: the picture
        // that comes back is the picture that went in.
        expect({ width: result.width, height: result.height }).toEqual({ width: 400, height: 300 });
        expect(result.scalePercent).toBe(100);
    }, 60_000);

    it('lands close to the target rather than merely under it', async () => {
        const target = 50 * KB;
        const result = await compress(await noisyJpeg(), { targetBytes: String(target) });

        // A search that gave up early would return a far smaller file and throw
        // away quality that was asked for. Half the target is the floor a
        // proxy-and-extrapolate search failed (worst case measured: -82%).
        expect(result.resultBytes).toBeGreaterThan(target * 0.5);
    }, 60_000);

    it('stays inside the bounded probe budget', async () => {
        const result = await compress(await noisyJpeg(), { targetBytes: String(40 * KB) });
        expect(result.iterations).toBeLessThanOrEqual(TARGET_SEARCH_ITERATIONS);
    }, 60_000);

    it('reports every probe as progress, since it is the slowest job on the site', async () => {
        const seen = [];
        await runOperation(
            'compress',
            await noisyJpeg(),
            { targetBytes: String(40 * KB) },
            { onProgress: (value, phase) => seen.push({ value, phase }) },
        );

        const probes = seen.filter((entry) => entry.phase === 'searching');
        expect(probes.length).toBeGreaterThan(1);
        // Monotonic, and it actually moves — a bar that sat still through eight
        // encodes is what this replaced.
        const values = probes.map((entry) => entry.value);
        expect(values).toEqual([...values].sort((a, b) => a - b));
        expect(values[values.length - 1]).toBeGreaterThan(values[0]);
    }, 60_000);
});

/* ------------------------------------------------------------------ *
 * 2. WebP takes one encode, and is still measured
 * ------------------------------------------------------------------ */

describe('WebP uses libwebp target_size, and verifies it', () => {
    it('asks the encoder for a size and reports the request back', async () => {
        const pixels = await encodePixels(await noisyWebp());
        const encoded = await encodeImageData(pixels, { format: 'webp', targetBytes: 30 * KB });

        expect(encoded.targetRequested).toBe(30 * KB);
        // The rate controller decided the bytes, not the number on the slider.
        expect(encoded.qualityApplied).toBe(false);
    }, 60_000);

    it('ignores targetBytes for formats with no such mode', async () => {
        const pixels = await encodePixels(await noisyJpeg());

        expect((await encodeImageData(pixels, { format: 'jpeg', targetBytes: 30 * KB })).targetRequested).toBeNull();
        expect((await encodeImageData(pixels, { format: 'png', targetBytes: 30 * KB })).targetRequested).toBeNull();
    }, 60_000);

    it('costs ONE encode when the native controller lands under the target', async () => {
        const encodes = [];
        const outcome = await compressToTargetBytes({
            imageData: { width: 400, height: 300, data: new Uint8ClampedArray(4) },
            format: 'webp',
            targetBytes: 40 * KB,
            deadline: Number.MAX_SAFE_INTEGER,
            now: () => 0,
            encode: async (_pixels, options) => {
                encodes.push(options);
                return { bytes: 39 * KB, blob: null, format: 'webp' };
            },
        });

        expect(encodes).toEqual([{ format: 'webp', targetBytes: 40 * KB }]);
        expect(outcome.strategy).toBe(NATIVE);
        expect(outcome.iterations).toBe(1);
        expect(outcome.targetMet).toBe(true);
    });

    /**
     * Measured, not assumed: at pass=6, 16 of 84 image/target pairs came back
     * ABOVE the size asked for, the worst by 31%. Shipping the first encode
     * unchecked would hand people a file that misses their number.
     */
    it('falls back to the bounded search when the native encode overshoots', async () => {
        const encodes = [];
        const outcome = await compressToTargetBytes({
            imageData: { width: 400, height: 300, data: new Uint8ClampedArray(4) },
            format: 'webp',
            targetBytes: 40 * KB,
            deadline: Number.MAX_SAFE_INTEGER,
            now: () => 0,
            encode: async (_pixels, options) => {
                encodes.push(options);
                // The native attempt misses by a third; quality behaves.
                if (options.targetBytes) return { bytes: 53 * KB, blob: null, format: 'webp' };
                return { bytes: Math.round(options.quality * 600), blob: null, format: 'webp' };
            },
        });

        expect(encodes[0]).toEqual({ format: 'webp', targetBytes: 40 * KB });
        expect(encodes.length).toBeGreaterThan(1);
        expect(outcome.strategy).toBe(SEARCH);
        expect(outcome.targetMet).toBe(true);
        expect(outcome.fitBytes).toBeLessThanOrEqual(40 * KB);
    });

    it('counts the native attempt in the progress total so the bar cannot go backwards', async () => {
        const seen = [];
        await compressToTargetBytes({
            imageData: { width: 400, height: 300, data: new Uint8ClampedArray(4) },
            format: 'webp',
            targetBytes: 40 * KB,
            deadline: Number.MAX_SAFE_INTEGER,
            now: () => 0,
            onIteration: (index, total) => seen.push({ index, total }),
            encode: async (_pixels, options) => (options.targetBytes
                ? { bytes: 53 * KB, blob: null, format: 'webp' }
                : { bytes: Math.round(options.quality * 600), blob: null, format: 'webp' }),
        });

        expect(seen[0]).toEqual({ index: 1, total: TARGET_SEARCH_ITERATIONS + 1 });
        const indexes = seen.map((entry) => entry.index);
        expect(indexes).toEqual([...indexes].sort((a, b) => a - b));
        expect(seen.every((entry) => entry.index <= entry.total)).toBe(true);
    });
});

/* ------------------------------------------------------------------ *
 * 3. PNG: never a silent thumbnail
 * ------------------------------------------------------------------ */

describe('a PNG asked for a byte target is never silently scaled', () => {
    it('is not a format that can reach a byte target here', () => {
        expect(reachesTargetBytes('png')).toBe(false);
        expect(reachesTargetBytes('jpeg')).toBe(true);
        expect(reachesTargetBytes('webp')).toBe(true);
    });

    it('comes back at FULL SIZE with the miss reported, not shrunk to fake a hit', async () => {
        const source = await noisyPng();
        const target = 20 * KB;
        const result = await compress(source, { targetBytes: String(target) });

        // The naive port answered this exact request with a 13%-scale image.
        expect({ width: result.width, height: result.height }).toEqual({ width: 400, height: 300 });
        expect(result.scalePercent).toBe(100);
        expect(result.format).toBe('png');

        // And it says so, rather than presenting an over-target file as a hit.
        expect(result.targetMet).toBe(false);
        expect(result.resultBytes).toBeGreaterThan(target);
    }, 60_000);

    it('costs exactly one lossless encode — there is no quality axis to search', async () => {
        const outcome = await compressToTargetBytes({
            imageData: { width: 400, height: 300, data: new Uint8ClampedArray(4) },
            format: 'png',
            targetBytes: 20 * KB,
            deadline: Number.MAX_SAFE_INTEGER,
            now: () => 0,
            encode: async () => ({ bytes: 300 * KB, blob: null, format: 'png' }),
        });

        expect(outcome.strategy).toBe(LOSSLESS);
        expect(outcome.iterations).toBe(1);
        expect(outcome.targetMet).toBe(false);
        // A file is still handed back. Refusing outright would mean a multi
        // second wait ending in nothing at all.
        expect(outcome.fit).not.toBeNull();
        expect(outcome.fit.scalePercent).toBe(100);
    });

    it('reports the target as met when the lossless encode already fits', async () => {
        const result = await compress(await flatPng(), { targetBytes: String(20 * KB) });

        expect(result.targetMet).toBe(true);
        expect(result.resultBytes).toBeLessThanOrEqual(20 * KB);
        expect({ width: result.width, height: result.height }).toEqual({ width: 120, height: 90 });
    }, 60_000);

    /** The offer /compress makes, proved rather than promised. */
    it('reaches the same target as WebP, at the same full resolution', async () => {
        const source = await noisyPng();
        const target = 20 * KB;
        const result = await compress(source, { targetBytes: String(target), format: 'webp' });

        expect(result.format).toBe('webp');
        expect(result.targetMet).toBe(true);
        expect(result.resultBytes).toBeLessThanOrEqual(target);
        expect({ width: result.width, height: result.height }).toEqual({ width: 400, height: 300 });
    }, 60_000);
});

/* ------------------------------------------------------------------ *
 * 3b. targetMet is a claim, and it has to be an honest one
 * ------------------------------------------------------------------ */

/**
 * /compress throws on `fit === null` before it ever reads `targetMet`, so a lie
 * in the search lane is invisible from the tool today — mutation testing pinned
 * the flag to a constant `true` and nothing went red. It is asserted anyway,
 * because it is the documented return contract and the next caller to read the
 * flag instead of the payload would inherit a silent wrong answer. /jpg-to-pdf
 * is already such a caller in spirit: it keeps the document and reports the
 * miss rather than throwing.
 */
describe('targetMet tells the truth about the search lane', () => {
    it('is false when no encode ever fit the target', async () => {
        const outcome = await compressToTargetBytes({
            imageData: { width: 400, height: 300, data: new Uint8ClampedArray(4) },
            format: 'jpeg',
            targetBytes: 1_000,
            deadline: Number.MAX_SAFE_INTEGER,
            now: () => 0,
            encode: async () => ({ bytes: 90_000, blob: null, format: 'jpeg' }),
        });

        expect(outcome.fit).toBeNull();
        expect(outcome.targetMet).toBe(false);
        expect(outcome.floorBytes).toBe(90_000);
        expect(outcome.strategy).toBe(SEARCH);
    });

    it('is true when one did', async () => {
        const outcome = await compressToTargetBytes({
            imageData: { width: 400, height: 300, data: new Uint8ClampedArray(4) },
            format: 'jpeg',
            targetBytes: 100_000,
            deadline: Number.MAX_SAFE_INTEGER,
            now: () => 0,
            encode: async () => ({ bytes: 90_000, blob: null, format: 'jpeg' }),
        });

        expect(outcome.targetMet).toBe(true);
        expect(outcome.fitBytes).toBe(90_000);
    });
});

/* ------------------------------------------------------------------ *
 * 4. The quality dial tells the truth
 * ------------------------------------------------------------------ */

describe('qualityApplied reports whether the slider did anything', () => {
    it('is false for a PNG, because this build has no quantiser', async () => {
        const result = await compress(await noisyPng(), { quality: '20' });

        expect(result.format).toBe('png');
        expect(result.qualityApplied).toBe(false);
    }, 60_000);

    it('is true for a JPEG and a WebP', async () => {
        expect((await compress(await noisyJpeg(), { quality: '40' })).qualityApplied).toBe(true);
        expect((await compress(await noisyWebp(), { quality: '40' })).qualityApplied).toBe(true);
    }, 60_000);

    it('proves the PNG claim in bytes: two qualities, one output size', async () => {
        const source = await noisyPng();
        const low = await compress(source, { quality: '5' });
        const high = await compress(source, { quality: '95' });

        expect(low.resultBytes).toBe(high.resultBytes);
    }, 60_000);

    it('proves the JPEG contrast: two qualities, two output sizes', async () => {
        const source = await noisyJpeg();
        const low = await compress(source, { quality: '5' });
        const high = await compress(source, { quality: '95' });

        expect(low.resultBytes).toBeLessThan(high.resultBytes);
    }, 60_000);
});

/* ------------------------------------------------------------------ *
 * 5. The output format the offer switches to
 * ------------------------------------------------------------------ */

describe('the compress output format', () => {
    it('defaults to the source format', async () => {
        expect((await compress(await noisyPng(), { quality: '80' })).format).toBe('png');
    }, 60_000);

    it.each([[null], [undefined], [''], ['original'], ['same']])('treats %o as the source format', async (value) => {
        expect((await compress(await noisyPng(), { format: value, quality: '80' })).format).toBe('png');
    }, 60_000);

    it('refuses a format this build cannot write', async () => {
        await expect(compress(await noisyPng(), { format: 'avif', quality: '80' }))
            .rejects.toThrow(/Invalid output format/);
    }, 60_000);
});

/** Decodes a file to the ImageData the encoders speak. */
async function encodePixels(buffer) {
    const { decodeToImageData } = await import('@/lib/image-client/decode');
    return (await decodeToImageData(buffer)).data;
}
