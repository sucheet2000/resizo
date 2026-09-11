/**
 * Does an AVIF get bigger when you ask for more quality?
 *
 * THE QUESTION IS NOT ACADEMIC AND IT IS NOT ABOUT AVIF. It is about
 * `/compress`, whose whole design rests on one assumption, stated in
 * `lib/image-client/compress-target.js`: "output size rises with quality — the
 * monotonicity the search above already relies on". A bisection over quality
 * is only a search if the ladder it is climbing goes one way. On a codec where
 * quality 60 can land below quality 55, the search returns a file that is not
 * the best one under the ceiling, and — worse — the shortcut that makes a
 * hopeless target cost one encode instead of eight stops being sound: if the
 * FLOOR quality cannot fit, nothing above it can, and that sentence is only
 * true of a monotonic ladder.
 *
 * So this file measures the ladder rather than assuming it, and it is written
 * to DOCUMENT the finding rather than to assert a wish. A codec upgrade that
 * introduced a few one-byte wobbles is not a failure; one that made the ladder
 * unusable is. The measured facts, on this machine, on 2026-09-11, at
 * AVIF_ENCODE_SPEED:
 *
 *   a 640×480 synthetic photograph   0 inversions over 20 steps,  54 ms/encode
 *   the 1600×1067 repo sample        0 inversions over 20 steps, 314 ms/encode
 *   the same sample at speed 7       0 inversions over 20 steps (from the bench)
 *
 * The third is from the bench in the AVIF codec review rather than from here:
 * this file runs at the one speed the product ships. The second series matches
 * that bench's byte-for-byte, which is its own small finding — the engine
 * hands libavif the slider value untouched.
 *
 * AND YET /compress STILL DOES NOT OFFER AVIF, which is the thing worth
 * writing down. Monotonicity was the risk everybody expected, and it is not
 * the one that decided it: the deferral is about the CLOCK. A byte-target
 * search is eight encodes inside `TARGET_SEARCH_DEADLINE_MS`, and libavif has
 * no `target_size` equivalent to do it in one pass the way libwebp does. The
 * per-encode time this file measures is printed with the ladder, so the next
 * person to ask "can we turn on AVIF compression yet" has both numbers in
 * front of them.
 *
 * It drives `encodeImageData` rather than a whole operation on purpose: that
 * is the exact function `compress-target.js` would call, once per probe, and
 * putting a decode in front of each of forty-two encodes would measure the
 * decoder.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';
import { beforeAll, describe, expect, it } from 'vitest';

import { TARGET_SEARCH_ITERATIONS } from '@/lib/limits';
import { parseAvif } from '../../helpers/avif.js';
import { installBrowserEnv } from './helpers/browser-env';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SAMPLE = path.join(ROOT, 'public', 'samples', 'landscape-1600x1067.jpg');

/** 1, 5, 10, … 100 — the bench's own ladder, so the two are comparable. */
const QUALITIES = [1, ...Array.from({ length: 20 }, (_, step) => (step + 1) * 5)];

/**
 * How many inversions make the ladder unusable rather than bumpy.
 *
 * Measured zero on both series here and on all three in the bench. The ceiling
 * is not a prediction — it is the line past which `compress-target.js`'s
 * floor-first shortcut would start returning wrong answers often enough to
 * matter, and it exists so a codec upgrade that crossed it fails loudly
 * instead of being discovered by a visitor whose 100 KB target came back at
 * 140 KB.
 */
const USABLE_INVERSION_CEILING = 3;

let encodeImageData;
let AVIF_ENCODE_SPEED;

beforeAll(async () => {
    installBrowserEnv();
    ({ encodeImageData, AVIF_ENCODE_SPEED } = await import('@/lib/image-client/encode'));
});

/** ImageData from any file libvips can read. */
async function surfaceFrom(source) {
    const { data, info } = await sharp(source)
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
    return new ImageData(new Uint8ClampedArray(data), info.width, info.height);
}

/**
 * A photograph-shaped drawing: a gradient, some shapes and fine grain.
 *
 * Grain matters here more than composition does. A flat picture compresses to
 * almost nothing at every quality, so its ladder is twenty numbers within a
 * few hundred bytes of each other and an inversion count over it would be
 * noise. This one has detail at several scales, which is what makes each rung
 * of the ladder a real distance from the last.
 */
function syntheticPhoto(width, height) {
    const raw = Buffer.alloc(width * height * 4);
    let state = 1;
    const random = () => {
        state = (state * 1664525 + 1013904223) >>> 0;
        return state / 4294967296;
    };

    for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
            const at = (y * width + x) * 4;
            const sky = y / height;
            const ring = Math.hypot(x - width * 0.3, y - height * 0.35) < height * 0.22 ? 60 : 0;
            const stripe = Math.sin(x / 9) * 18;
            const grain = (random() - 0.5) * 28;

            raw[at] = Math.max(0, Math.min(255, 40 + sky * 180 + ring + stripe + grain));
            raw[at + 1] = Math.max(0, Math.min(255, 70 + sky * 120 - ring / 2 + stripe + grain));
            raw[at + 2] = Math.max(0, Math.min(255, 150 - sky * 60 + ring / 3 - stripe + grain));
            raw[at + 3] = 255;
        }
    }

    return new ImageData(new Uint8ClampedArray(raw), width, height);
}

/** One encode per quality, with the bytes and the wall time it cost. */
async function ladder(surface) {
    const rungs = [];

    for (const quality of QUALITIES) {
        const started = Date.now();
        const encoded = await encodeImageData(surface, { format: 'avif', quality });
        rungs.push({ quality, bytes: encoded.bytes, ms: Date.now() - started, blob: encoded.blob });
    }

    return rungs;
}

/** Every step where the file got SMALLER as the quality went up. */
function inversionsIn(rungs) {
    const found = [];
    for (let step = 1; step < rungs.length; step += 1) {
        const drop = rungs[step - 1].bytes - rungs[step].bytes;
        if (drop > 0) {
            found.push({
                from: rungs[step - 1].quality,
                to: rungs[step].quality,
                drop,
            });
        }
    }
    return found;
}

/** The whole measurement, as text, so a failure carries the evidence with it. */
function report(label, rungs, found) {
    const table = rungs.map(({ quality, bytes, ms }) => `q${quality}=${bytes}B/${ms}ms`).join(' ');
    const median = [...rungs].sort((a, b) => a.ms - b.ms)[Math.floor(rungs.length / 2)].ms;
    return `${label} at speed ${AVIF_ENCODE_SPEED}: ${found.length} inversion(s) over `
        + `${rungs.length - 1} steps, median ${median} ms/encode\n  ${table}`;
}

describe.each([
    ['a 640×480 synthetic photograph', () => syntheticPhoto(640, 480)],
    ['the 1600×1067 sample this repo ships', () => surfaceFrom(SAMPLE)],
])('the quality ladder on %s', (label, build) => {
    let rungs;
    let found;

    beforeAll(async () => {
        rungs = await ladder(await build());
        found = inversionsIn(rungs);
    }, 120_000);

    /**
     * NON-VACUITY FIRST. Twenty-one numbers that all came from a failed encode
     * would be a perfectly monotonic ladder of zeroes, and a suite that only
     * counted inversions would call that a pass.
     */
    it('produced twenty-one real AVIFs, one per quality point', () => {
        expect(rungs).toHaveLength(QUALITIES.length);

        for (const rung of rungs) {
            expect(rung.bytes, `q${rung.quality} produced ${rung.bytes} bytes`).toBeGreaterThan(0);
            expect(rung.blob.type).toBe('image/avif');
        }
    });

    it('is really a quality dial and not a constant', async () => {
        const first = rungs[0];
        const last = rungs[rungs.length - 1];

        // The one thing a pass-through that stopped passing through would break:
        // quality 1 and quality 100 have to be different pictures, by a lot.
        expect(last.bytes, report(label, rungs, found)).toBeGreaterThan(first.bytes * 3);

        const bytes = Buffer.from(await last.blob.arrayBuffer());
        const avif = parseAvif(bytes);
        expect(avif.brand).toBe('avif');
        expect(avif.animated).toBe(false);
    });

    it('climbs without enough inversions to break a bisection search', () => {
        expect(found.length, report(label, rungs, found)).toBeLessThanOrEqual(USABLE_INVERSION_CEILING);
    });
});

describe('why /compress still does not offer AVIF', () => {
    /**
     * The deferral does not rest on the ladder above — it rests on how long
     * eight rungs of it take. This records the arithmetic rather than asserting
     * a millisecond, because a time measured on one laptop is not a product
     * claim (benchmarks/README.md says so at length).
     */
    it('would cost a whole byte-target search, one full encode at a time', () => {
        expect(TARGET_SEARCH_ITERATIONS).toBe(8);
    });

    it('has no rate controller to do it in one pass, the way WebP does', async () => {
        const { encodeImageData: encode } = await import('@/lib/image-client/encode');
        const surface = syntheticPhoto(64, 48);

        // WebP takes a byte target and hits it itself; AVIF has no equivalent,
        // so `targetBytes` is meaningless here and must not be silently honoured
        // as if it were.
        const encoded = await encode(surface, { format: 'avif', quality: 50, targetBytes: 1_000 });

        expect(encoded.format).toBe('avif');
        expect(encoded.targetRequested).toBeNull();
    });
});
