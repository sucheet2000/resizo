/**
 * "Fit under the target" — the second compress policy, and the only one in this
 * build that is allowed to make the picture smaller.
 *
 * WHY THERE ARE TWO POLICIES AT ALL
 *
 * compressToTargetBytes answers "make this 100 KB and do not touch my
 * dimensions". That is the honest answer for a photo, and when no quality
 * reaches the number it says so rather than quietly handing back a thumbnail —
 * the naive port answered a 20 KB request on an 800x600 PNG with a 104x78
 * image, and nobody asking for a smaller FILE asked for a smaller PICTURE.
 *
 * But a portal that will not accept anything over 50 KB does not care about the
 * dimensions, and for that person a refusal is useless. So the second policy
 * exists, it is OPT-IN, and it reports exactly what it did: `resized`,
 * `scalePercent`, `steps` and the size it landed on. The quality floor
 * (FIT_MIN_QUALITY) is where the trade changes hands — below 50 the artefacts
 * are worse than the smaller picture would have been, so the search stops
 * turning that dial and starts dropping pixels instead.
 *
 * WHAT IS REAL HERE AND WHAT IS SYNTHETIC
 *
 * The decisions — how many steps, which size wins, what happens at a boundary —
 * are proved with synthetic encoders through the `encode`/`resize` seams,
 * because a decision should be provable without waiting on MozJPEG and because
 * an encoder whose bytes depend only on the pixel count is the only way to
 * prove that shrinking is what did the work rather than the quality dial.
 *
 * The measurements are proved with the real codecs. Every byte count asserted
 * in those cases came out of MozJPEG or the Squoosh PNG encoder for real, and
 * the fixtures are the same noisy 400x300 pair compress-target.test.js uses.
 */
import sharp from 'sharp';
import { beforeAll, describe, expect, it } from 'vitest';

import {
    FIT_MAX_STEPS,
    FIT_MIN_DIMENSION,
    FIT_MIN_QUALITY,
    FIT_SCALE_STEP,
    TARGET_SEARCH_ITERATIONS,
} from '@/lib/limits';
import { installBrowserEnv } from './helpers/browser-env';
import { noiseJpeg } from './helpers/fixtures';

const KB = 1024;

let compressToTargetBytes;
let fitUnderTargetBytes;
let runOperation;
let JobError;
let LOSSLESS;
let NATIVE;
let SEARCH;

beforeAll(async () => {
    installBrowserEnv();
    ({ compressToTargetBytes, fitUnderTargetBytes, LOSSLESS, NATIVE, SEARCH } = await import('@/lib/image-client/compress-target'));
    ({ runOperation, JobError } = await import('@/lib/image-client/operations'));
});

/* ------------------------------------------------------------------ *
 * Synthetic pixels and seams
 * ------------------------------------------------------------------ */

/** Pixels with no pixels in them. Only width and height are ever read here. */
function fakePixels(width, height) {
    return { width, height, data: new Uint8ClampedArray(4) };
}

/** The size a shrink step lands on, computed the way the module must compute it. */
function stepSize(width, height, step) {
    return {
        width: Math.max(1, Math.round(width * FIT_SCALE_STEP ** step)),
        height: Math.max(1, Math.round(height * FIT_SCALE_STEP ** step)),
    };
}

/**
 * A resize seam that records what it was asked for, so "resampled from the
 * ORIGINAL, never from the previous step" is an assertion about the inputs
 * rather than a claim about the code. Compounding a resample eight times is
 * eight rounds of blur, and the output looks it.
 */
function recordingResize() {
    const calls = [];
    const resize = async (imageData, { width, height }) => {
        calls.push({ from: imageData, width, height });
        return fakePixels(width, height);
    };
    return { calls, resize };
}

/** An encode seam that records every probe and answers from a byte function. */
function recordingEncode(bytesFor) {
    const calls = [];
    const encode = async (imageData, options) => {
        calls.push({ imageData, ...options });
        return {
            blob: null,
            bytes: bytesFor(imageData, options),
            format: options.format,
            type: `image/${options.format}`,
            quality: options.quality ?? null,
            qualityApplied: options.format !== 'png',
            targetRequested: options.targetBytes ?? null,
        };
    };
    return { calls, encode };
}

const NEVER_DEADLINE = { deadline: Number.MAX_SAFE_INTEGER, now: () => 0 };

/**
 * The one promise the whole policy rests on: a met target is never over the
 * number the person typed. Asserted on every case in this file, synthetic and
 * real, because "close enough" is what a portal rejects.
 */
function expectNeverOverTarget(outcome, targetBytes) {
    if (!outcome.targetMet) return;
    expect(outcome.fit).not.toBeNull();
    expect(outcome.fitBytes).toBeLessThanOrEqual(targetBytes);
    expect(outcome.fit.bytes).toBeLessThanOrEqual(targetBytes);
}

/* ------------------------------------------------------------------ *
 * 1. The target is reached at full size whenever it can be
 * ------------------------------------------------------------------ */

describe('a target the quality dial can reach costs no pixels', () => {
    it('stays at the source size and says so', async () => {
        const target = 10 * KB;
        const { calls, resize } = recordingResize();
        const encoder = recordingEncode((_pixels, { quality }) => quality * 200);

        const outcome = await fitUnderTargetBytes({
            imageData: fakePixels(400, 300),
            format: 'jpeg',
            targetBytes: target,
            ...NEVER_DEADLINE,
            encode: encoder.encode,
            resize,
        });

        expect(outcome.targetMet).toBe(true);
        expect(outcome.resized).toBe(false);
        expect(outcome.steps).toBe(0);
        expect({ width: outcome.width, height: outcome.height }).toEqual({ width: 400, height: 300 });
        expect(outcome.scalePercent).toBe(100);
        expect(outcome.strategy).toBe(SEARCH);
        // Nothing was resampled, so nothing asked the resizer for anything.
        expect(calls).toEqual([]);
        expectNeverOverTarget(outcome, target);
    });

    it('decorates the winning payload with the size it was encoded at', async () => {
        const target = 10 * KB;
        const outcome = await fitUnderTargetBytes({
            imageData: fakePixels(400, 300),
            format: 'jpeg',
            targetBytes: target,
            ...NEVER_DEADLINE,
            encode: recordingEncode((_pixels, { quality }) => quality * 200).encode,
            resize: recordingResize().resize,
        });

        expect(outcome.fit.width).toBe(400);
        expect(outcome.fit.height).toBe(300);
        expect(outcome.fit.scalePercent).toBe(100);
        expect(outcome.quality).toBe(outcome.fit.quality);
    });
});

/* ------------------------------------------------------------------ *
 * 2. Locked dimensions: the other policy never resizes
 * ------------------------------------------------------------------ */

describe('the keep-dimensions policy never reaches for the pixels', () => {
    it('hands every probe the same surface it was given', async () => {
        const source = fakePixels(400, 300);
        const encoder = recordingEncode(() => 90_000);

        const outcome = await compressToTargetBytes({
            imageData: source,
            format: 'jpeg',
            targetBytes: 10 * KB,
            ...NEVER_DEADLINE,
            encode: encoder.encode,
        });

        expect(encoder.calls.length).toBeGreaterThan(1);
        expect(encoder.calls.every((call) => call.imageData === source)).toBe(true);
        expect(outcome.fit).toBeNull();
        expect(outcome.targetMet).toBe(false);
    });

    it('refuses out loud rather than shrinking, on a real image no quality can save', async () => {
        const source = await noiseJpeg({ width: 2400, height: 1800 });

        const error = await runOperation('compress', source, { targetBytes: String(10 * KB), policy: 'keep' }).then(
            (result) => { throw new Error(`expected a refusal, got ${result.resultBytes} bytes`); },
            (thrown) => thrown,
        );

        expect(error).toBeInstanceOf(JobError);
        expect(error.code).toBe('target-unreachable');
        expect(error.message).toMatch(/Cannot reach 10 KB for this image/);
    }, 180_000);
});

/* ------------------------------------------------------------------ *
 * 3. The fallback: drop pixels, from the original, one step at a time
 * ------------------------------------------------------------------ */

describe('when quality cannot get there, the picture shrinks', () => {
    /**
     * An encoder whose bytes depend ONLY on the pixel count. Quality is inert,
     * so every byte saved in this describe was saved by dropping pixels — which
     * is the only way to prove the fallback is what ran.
     */
    const byPixelCount = (imageData) => imageData.width * imageData.height;

    it('lands on the first step that fits, sized off the ORIGINAL each time', async () => {
        const target = 60_000;
        const { calls, resize } = recordingResize();
        const source = fakePixels(1000, 800);

        const outcome = await fitUnderTargetBytes({
            imageData: source,
            format: 'jpeg',
            targetBytes: target,
            ...NEVER_DEADLINE,
            encode: recordingEncode(byPixelCount).encode,
            resize,
        });

        // 1000x800 shrinks by 0.8 a side per step; step 6 is the first under
        // 60 000 pixels, and 262x210 is 0.8^6 of each side rounded ONCE.
        expect(outcome.steps).toBe(6);
        expect({ width: outcome.width, height: outcome.height }).toEqual(stepSize(1000, 800, 6));
        expect({ width: outcome.width, height: outcome.height }).toEqual({ width: 262, height: 210 });
        expect(outcome.resized).toBe(true);
        expect(outcome.targetMet).toBe(true);
        expect(outcome.scalePercent).toBe(26);
        expectNeverOverTarget(outcome, target);

        // THE COMPOUNDING BUG THIS EXISTS TO STOP: every resample reads the
        // surface the caller handed in, never the output of the step before.
        expect(calls.every((call) => call.from === source)).toBe(true);
        expect(calls.map((call) => ({ width: call.width, height: call.height })))
            .toEqual([1, 2, 3, 4, 5, 6].map((step) => stepSize(1000, 800, step)));
    });

    it('reports the winning size on the payload, not just on the result', async () => {
        const outcome = await fitUnderTargetBytes({
            imageData: fakePixels(1000, 800),
            format: 'jpeg',
            targetBytes: 60_000,
            ...NEVER_DEADLINE,
            encode: recordingEncode(byPixelCount).encode,
            resize: recordingResize().resize,
        });

        expect(outcome.fit.width).toBe(262);
        expect(outcome.fit.height).toBe(210);
        expect(outcome.fit.scalePercent).toBe(26);
    });
});

/* ------------------------------------------------------------------ *
 * 4. It always stops
 * ------------------------------------------------------------------ */

describe('the search is bounded on both axes', () => {
    const alwaysOver = (targetBytes) => () => targetBytes + 1;

    it('terminates with an honest miss when nothing ever fits', async () => {
        const target = 50_000;
        const encoder = recordingEncode(alwaysOver(target));

        const outcome = await fitUnderTargetBytes({
            imageData: fakePixels(1000, 800),
            format: 'jpeg',
            targetBytes: target,
            ...NEVER_DEADLINE,
            encode: encoder.encode,
            resize: recordingResize().resize,
        });

        expect(outcome.fit).toBeNull();
        expect(outcome.targetMet).toBe(false);
        expect(outcome.floorBytes).toBe(target + 1);
        expect(outcome.steps).toBe(FIT_MAX_STEPS);
        // The smallest attempt is what the refusal quotes back, so it has to be
        // described rather than left null.
        expect({ width: outcome.width, height: outcome.height }).toEqual(stepSize(1000, 800, FIT_MAX_STEPS));
    });

    it('never pays for more encodes than the budget allows', async () => {
        const target = 50_000;
        const encoder = recordingEncode(alwaysOver(target));

        const outcome = await fitUnderTargetBytes({
            imageData: fakePixels(1000, 800),
            format: 'jpeg',
            targetBytes: target,
            ...NEVER_DEADLINE,
            encode: encoder.encode,
            resize: recordingResize().resize,
        });

        expect(outcome.steps).toBeLessThanOrEqual(FIT_MAX_STEPS);
        expect(encoder.calls.length).toBeLessThanOrEqual(FIT_MAX_STEPS * (TARGET_SEARCH_ITERATIONS + 1));
        expect(outcome.iterations).toBe(encoder.calls.length);
    });

    it('stops before the picture becomes a postage stamp', async () => {
        const target = 50_000;
        const { calls, resize } = recordingResize();

        // 40x30 shrinks to 32x24 in one step, and 24 is under the floor — so
        // there is no legal step to take and the source size is the whole story.
        const outcome = await fitUnderTargetBytes({
            imageData: fakePixels(40, 30),
            format: 'jpeg',
            targetBytes: target,
            ...NEVER_DEADLINE,
            encode: recordingEncode(alwaysOver(target)).encode,
            resize,
        });

        expect(Math.round(30 * FIT_SCALE_STEP)).toBeLessThan(FIT_MIN_DIMENSION);
        expect(outcome.steps).toBe(0);
        expect(calls).toEqual([]);
        expect(outcome.targetMet).toBe(false);
    });

    it('stops at the deadline instead of working through the steps', async () => {
        const target = 50_000;
        const encoder = recordingEncode(alwaysOver(target));
        let clock = 0;

        const outcome = await fitUnderTargetBytes({
            imageData: fakePixels(1000, 800),
            format: 'jpeg',
            targetBytes: target,
            deadline: 100,
            now: () => { clock += 30; return clock; },
            encode: encoder.encode,
            resize: recordingResize().resize,
        });

        expect(outcome.steps).toBeLessThan(FIT_MAX_STEPS);
        expect(outcome.targetMet).toBe(false);
    });
});

/* ------------------------------------------------------------------ *
 * 4b. One encode decides whether a size is worth searching
 * ------------------------------------------------------------------ */

/**
 * WHY THE FLOOR IS PROBED FIRST
 *
 * Output size rises with quality, so if the LOWEST quality this policy will
 * accept still misses the target, no quality above it can hit it either. One
 * encode settles that, where a binary search spends eight to reach the same
 * conclusion — and it spends them at the largest size, before any shrinking has
 * happened. On a 12-megapixel phone photo eight MozJPEG encodes can burn the
 * whole 20-second deadline before the first shrink step, turning a target that
 * was reachable into a false "cannot reach".
 */
describe('a step that cannot work is never searched', () => {
    const byPixelCount = (imageData) => imageData.width * imageData.height;

    it('costs one encode per hopeless step, and searches only the step that fits', async () => {
        const target = 60_000;
        const encoder = recordingEncode(byPixelCount);

        const outcome = await fitUnderTargetBytes({
            imageData: fakePixels(1000, 800),
            format: 'jpeg',
            targetBytes: target,
            ...NEVER_DEADLINE,
            encode: encoder.encode,
            resize: recordingResize().resize,
        });

        expect(outcome.steps).toBe(6);

        // Steps 0 to 5 cannot fit at any quality and one encode at the floor is
        // what says so. Step 6's floor probe is the seventh, and only after it
        // fits does anything above the floor get encoded.
        const floorProbes = 7;
        expect(encoder.calls.slice(0, floorProbes).every((call) => call.quality === FIT_MIN_QUALITY)).toBe(true);
        expect(encoder.calls.slice(floorProbes).every((call) => call.quality > FIT_MIN_QUALITY)).toBe(true);

        // Seven floor probes and one bounded search, which converges in six.
        expect(encoder.calls.length).toBe(13);
        expect(encoder.calls.length).toBeLessThanOrEqual(floorProbes + TARGET_SEARCH_ITERATIONS);
        expect(outcome.iterations).toBe(encoder.calls.length);
        expectNeverOverTarget(outcome, target);
    });

    it('reuses the floor probe rather than encoding it twice when it is the only fit', async () => {
        // Exactly the boundary: quality 50 lands on the target and 51 is over,
        // so the search above the floor finds nothing and the floor's own
        // encode is the answer.
        const target = FIT_MIN_QUALITY * 200;
        const encoder = recordingEncode((_pixels, { quality }) => quality * 200);

        const outcome = await fitUnderTargetBytes({
            imageData: fakePixels(400, 300),
            format: 'jpeg',
            targetBytes: target,
            ...NEVER_DEADLINE,
            encode: encoder.encode,
            resize: recordingResize().resize,
        });

        expect(outcome.targetMet).toBe(true);
        expect(outcome.fitBytes).toBe(target);
        expect(outcome.fit.quality).toBe(FIT_MIN_QUALITY);
        expect(outcome.resized).toBe(false);

        // The floor is probed FIRST and encoded ONCE. A search that walked down
        // to it would re-encode a size it had already measured.
        expect(encoder.calls[0].quality).toBe(FIT_MIN_QUALITY);
        expect(encoder.calls.filter((call) => call.quality === FIT_MIN_QUALITY)).toHaveLength(1);
        expectNeverOverTarget(outcome, target);
    });
});

/* ------------------------------------------------------------------ *
 * 4c. WebP gives up its native lane under this policy, and only this one
 * ------------------------------------------------------------------ */

/**
 * THE FLOOR IS A PROMISE, AND target_size CANNOT KEEP IT.
 *
 * Under the keep policy libwebp's own rate controller is the right first move:
 * one encode instead of eight, measured at 47.8 s against 66.6 s over 84
 * image/target pairs. But it reaches a byte count by choosing a quality itself,
 * in float, with NO lower bound — @jsquash/webp exposes no qmin or qmax to give
 * it one. So a WebP asked for 20 KB can come back at an effective quality in
 * the teens, which is precisely the trade FIT_MIN_QUALITY exists to refuse.
 *
 * Under fit the floor is the whole point of the policy: below it the smaller
 * picture is the better answer, and the tool is allowed to make the picture
 * smaller. So this lane trades one encode's worth of speed for the guarantee,
 * and WebP is probed exactly as JPEG is.
 */
describe('a WebP source under the fit policy', () => {
    it('never hands libwebp a target size, because its rate control has no floor', async () => {
        const target = 40_000;
        const encoder = recordingEncode(() => target + 1);

        const outcome = await fitUnderTargetBytes({
            imageData: fakePixels(1000, 800),
            format: 'webp',
            targetBytes: target,
            ...NEVER_DEADLINE,
            encode: encoder.encode,
            resize: recordingResize().resize,
        });

        expect(encoder.calls.every((call) => call.targetBytes === undefined)).toBe(true);

        const qualities = encoder.calls.map((call) => call.quality);
        expect(qualities.every((value) => typeof value === 'number')).toBe(true);
        expect(Math.min(...qualities)).toBeGreaterThanOrEqual(FIT_MIN_QUALITY);
        expect(outcome.strategy).toBe(SEARCH);
    });

    it('lands on a quality at or above the floor when the floor is the only fit', async () => {
        const target = 40_000;
        const encoder = recordingEncode((_pixels, { quality }) => (
            quality <= FIT_MIN_QUALITY ? target : target + 1
        ));

        const outcome = await fitUnderTargetBytes({
            imageData: fakePixels(400, 300),
            format: 'webp',
            targetBytes: target,
            ...NEVER_DEADLINE,
            encode: encoder.encode,
            resize: recordingResize().resize,
        });

        expect(outcome.targetMet).toBe(true);
        expect(outcome.quality).toBe(FIT_MIN_QUALITY);
        expect(outcome.fit.quality).toBeGreaterThanOrEqual(FIT_MIN_QUALITY);
        expect(outcome.resized).toBe(false);
        expect(encoder.calls.every((call) => call.targetBytes === undefined)).toBe(true);
        expectNeverOverTarget(outcome, target);
    });

    /** The keep policy keeps its 47.8 s lane. Only fit gives it up. */
    it('leaves the keep policy native lane exactly where it was', async () => {
        const target = 40_000;
        const encoder = recordingEncode(() => target - 1_000);

        const outcome = await compressToTargetBytes({
            imageData: fakePixels(400, 300),
            format: 'webp',
            targetBytes: target,
            ...NEVER_DEADLINE,
            encode: encoder.encode,
        });

        expect(encoder.calls[0].targetBytes).toBe(target);
        expect(outcome.strategy).toBe(NATIVE);
        expect(outcome.iterations).toBe(1);
    });
});

/* ------------------------------------------------------------------ *
 * 4d. The number the progress bar is measured against
 * ------------------------------------------------------------------ */

/**
 * The total has to be a total this format can actually reach.
 *
 * It is stated up front rather than grown as steps are added, because a total
 * that grew would walk the bar backwards. But a worst case that includes a
 * search PNG can never run leaves the bar stuck at 9 of 17 — 53% — on a job
 * that ran to completion and did everything it was ever going to do. A bar that
 * stops there reads as a hang, which on the one tool with no server to blame is
 * the worst thing it could read as.
 */
describe('the probe total each format is measured against', () => {
    function progressOf(format, target) {
        const seen = [];

        return fitUnderTargetBytes({
            imageData: fakePixels(1000, 800),
            format,
            targetBytes: target,
            ...NEVER_DEADLINE,
            encode: recordingEncode(() => target + 1).encode,
            resize: recordingResize().resize,
            onIteration: (index, total) => seen.push({ index, total }),
        }).then((outcome) => ({ outcome, seen, last: seen[seen.length - 1] }));
    }

    it('lets a PNG reach the top, because a PNG never runs the quality search', async () => {
        const { outcome, seen, last } = await progressOf('png', 20_000);

        expect(outcome.steps).toBe(FIT_MAX_STEPS);
        expect(seen).toHaveLength(FIT_MAX_STEPS + 1);
        expect(last.total).toBe(FIT_MAX_STEPS + 1);
        expect(last.index).toBe(last.total);
    });

    it('keeps room on the bar for the one search a JPEG can still run', async () => {
        const { last } = await progressOf('jpeg', 20_000);

        expect(last.total).toBe(FIT_MAX_STEPS + 1 + TARGET_SEARCH_ITERATIONS);
    });

    it('counts WebP the same as JPEG, now that it has no native attempt to pay for', async () => {
        const { last } = await progressOf('webp', 20_000);

        expect(last.total).toBe(FIT_MAX_STEPS + 1 + TARGET_SEARCH_ITERATIONS);
    });

    it('never reports an index past the total, whatever the format', async () => {
        for (const format of ['png', 'jpeg', 'webp']) {
            const { seen } = await progressOf(format, 20_000);
            const indexes = seen.map((entry) => entry.index);

            expect(seen.every((entry) => entry.index <= entry.total)).toBe(true);
            expect(indexes).toEqual([...indexes].sort((a, b) => a - b));
        }
    });
});

/* ------------------------------------------------------------------ *
 * 5. Boundaries
 * ------------------------------------------------------------------ */

describe('the boundary between met and missed', () => {
    it('counts bytes exactly equal to the target as met', async () => {
        const target = 40_000;
        const outcome = await fitUnderTargetBytes({
            imageData: fakePixels(400, 300),
            format: 'jpeg',
            targetBytes: target,
            ...NEVER_DEADLINE,
            encode: recordingEncode(() => target).encode,
            resize: recordingResize().resize,
        });

        expect(outcome.targetMet).toBe(true);
        expect(outcome.fitBytes).toBe(target);
        expect(outcome.resized).toBe(false);
        expectNeverOverTarget(outcome, target);
    });

    it('counts one byte over as missed', async () => {
        const target = 40_000;
        const { calls, resize } = recordingResize();

        const outcome = await fitUnderTargetBytes({
            imageData: fakePixels(400, 300),
            format: 'jpeg',
            targetBytes: target,
            ...NEVER_DEADLINE,
            encode: recordingEncode(() => target + 1).encode,
            resize,
        });

        expect(outcome.targetMet).toBe(false);
        expect(outcome.fit).toBeNull();
        expect(outcome.floorBytes).toBe(target + 1);
        // And it did try to shrink rather than giving up at the source size.
        expect(calls.length).toBeGreaterThan(0);
    });

    it('never probes below the quality floor', async () => {
        const target = 40_000;
        const encoder = recordingEncode(() => target + 1);

        await fitUnderTargetBytes({
            imageData: fakePixels(400, 300),
            format: 'jpeg',
            targetBytes: target,
            ...NEVER_DEADLINE,
            encode: encoder.encode,
            resize: recordingResize().resize,
        });

        const qualities = encoder.calls.map((call) => call.quality).filter((value) => typeof value === 'number');
        expect(qualities.length).toBeGreaterThan(0);
        expect(Math.min(...qualities)).toBeGreaterThanOrEqual(FIT_MIN_QUALITY);
    });

    it('honours a caller that lowers the floor', async () => {
        const target = 40_000;
        const encoder = recordingEncode(() => target + 1);

        await fitUnderTargetBytes({
            imageData: fakePixels(400, 300),
            format: 'jpeg',
            targetBytes: target,
            ...NEVER_DEADLINE,
            encode: encoder.encode,
            resize: recordingResize().resize,
            minQuality: 10,
            maxSteps: 0,
        });

        const qualities = encoder.calls.map((call) => call.quality).filter((value) => typeof value === 'number');
        expect(Math.min(...qualities)).toBeGreaterThanOrEqual(10);
        expect(Math.min(...qualities)).toBeLessThan(FIT_MIN_QUALITY);
    });
});

/* ------------------------------------------------------------------ *
 * 6. The real codecs
 * ------------------------------------------------------------------ */

const cache = new Map();
function memo(key, build) {
    if (!cache.has(key)) cache.set(key, build());
    return cache.get(key);
}

/** The fixture compress-target.test.js measures against, generated the same way. */
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

const noisyJpeg = () => memo('jpeg:400x300', () => noisyPixels(400, 300).jpeg({ quality: 95 }).toBuffer());
const noisyPng = () => memo('png:400x300', () => noisyPixels(400, 300).png().toBuffer());

describe('the policies against MozJPEG, on the same picture', () => {
    /**
     * The measured numbers this pair turns on: at the quality floor the full
     * 400x300 frame is 15 367 bytes, and one step down (320x240) it is 7 952.
     * So 10 KB is out of reach without dropping pixels and comfortably within
     * reach with one step of them.
     */
    it('fit gets under 10 KB by giving up one step of pixels', async () => {
        const target = 10 * KB;
        const result = await runOperation('compress', await noisyJpeg(), {
            targetBytes: String(target),
            policy: 'fit',
        });

        expect(result.targetMet).toBe(true);
        expect(result.resultBytes).toBeLessThanOrEqual(target);
        expect(result.resized).toBe(true);
        expect({ width: result.width, height: result.height }).toEqual({ width: 320, height: 240 });
        expect(result.scalePercent).toBe(80);
        expect(result.steps).toBe(1);
        expect(result.policy).toBe('fit');
        expect(result.originalWidth).toBe(400);
        expect(result.originalHeight).toBe(300);
    }, 120_000);

    it('keep gets under 10 KB too, and does it without touching the picture', async () => {
        const target = 10 * KB;
        const result = await runOperation('compress', await noisyJpeg(), {
            targetBytes: String(target),
            policy: 'keep',
        });

        expect(result.resultBytes).toBeLessThanOrEqual(target);
        expect({ width: result.width, height: result.height }).toEqual({ width: 400, height: 300 });
        expect(result.scalePercent).toBe(100);
        expect(result.resized).toBe(false);
        expect(result.steps).toBe(0);
        expect(result.policy).toBe('keep');
    }, 120_000);

    it('defaults to keep when the page sends no policy at all', async () => {
        const result = await runOperation('compress', await noisyJpeg(), { targetBytes: String(20 * KB) });

        expect(result.policy).toBe('keep');
        expect(result.resized).toBe(false);
        expect({ width: result.width, height: result.height }).toEqual({ width: 400, height: 300 });
    }, 120_000);

    it('refuses a policy it does not have', async () => {
        const error = await runOperation('compress', await noisyJpeg(), {
            targetBytes: String(20 * KB),
            policy: 'shrink',
        }).then(
            (result) => { throw new Error(`expected a refusal, got ${result.resultBytes} bytes`); },
            (thrown) => thrown,
        );

        expect(error).toBeInstanceOf(JobError);
        expect(error.code).toBe('invalid-policy');
    }, 120_000);
});

/**
 * PNG is the format the keep policy cannot help at all — there is no quantiser
 * in this build, so one lossless encode is the entire answer. Under `fit` the
 * pixels are the only lever there has ever been, and now the visitor is the one
 * who chose to pull it.
 */
describe('a PNG under the fit policy', () => {
    it('shrinks losslessly, and still reports that no quality dial was turned', async () => {
        const target = 20 * KB;
        const result = await runOperation('compress', await noisyPng(), {
            targetBytes: String(target),
            policy: 'fit',
        });

        expect(result.format).toBe('png');
        expect(result.targetMet).toBe(true);
        expect(result.resultBytes).toBeLessThanOrEqual(target);
        expect(result.resized).toBe(true);
        expect(result.qualityApplied).toBe(false);
        // Measured: 105x79 is 21 803 bytes and 84x63 is 13 160.
        expect({ width: result.width, height: result.height }).toEqual({ width: 84, height: 63 });
        expect(result.steps).toBe(7);
        expect(result.scalePercent).toBe(21);
    }, 120_000);

    it('takes one lossless encode per step and no quality probes', async () => {
        const target = 20 * KB;
        const encoder = recordingEncode((imageData) => imageData.width * imageData.height * 3);

        const outcome = await fitUnderTargetBytes({
            imageData: fakePixels(400, 300),
            format: 'png',
            targetBytes: target,
            ...NEVER_DEADLINE,
            encode: encoder.encode,
            resize: recordingResize().resize,
        });

        expect(outcome.strategy).toBe(LOSSLESS);
        expect(encoder.calls.every((call) => call.quality === undefined)).toBe(true);
        expect(encoder.calls.every((call) => call.targetBytes === undefined)).toBe(true);
        expect(encoder.calls.length).toBe(outcome.steps + 1);
        expectNeverOverTarget(outcome, target);
    });
});

/**
 * The pair that is the whole argument for the policy existing: ONE image, ONE
 * target, two answers. 2 400x1 800 of pure noise cannot reach 10 KB at any
 * quality MozJPEG has — quality 1 measures 13 178 bytes — so the keep policy
 * has nothing to offer but a refusal. Spending pixels reaches it.
 */
describe('the target keep cannot reach', () => {
    const hopeless = () => noiseJpeg({ width: 2400, height: 1800 });

    it('is delivered by fit, and it says what that cost', async () => {
        const target = 10 * KB;
        const result = await runOperation('compress', await hopeless(), {
            targetBytes: String(target),
            policy: 'fit',
        });

        expect(result.targetMet).toBe(true);
        expect(result.resultBytes).toBeLessThanOrEqual(target);
        expect(result.resized).toBe(true);
        expect(result.steps).toBeGreaterThan(0);
        expect(result.originalWidth).toBe(2400);
        expect(result.originalHeight).toBe(1800);
        // The size it landed on is one of the steps, not an arbitrary number.
        const legal = [1, 2, 3, 4, 5, 6, 7, 8].map((step) => stepSize(2400, 1800, step));
        expect(legal).toContainEqual({ width: result.width, height: result.height });
        expect(result.width).toBeLessThan(2400);
    }, 300_000);
});

/**
 * The floor is load-bearing, and this is the shape of image that proves it: a
 * 8 000x40 banner is already 40 pixels tall, so ONE step takes it to 32 and a
 * second would take it under FIT_MIN_DIMENSION. The policy runs out of room
 * before it runs out of steps, and has to say so.
 */
describe('a target the picture cannot shrink far enough to reach', () => {
    it('refuses, and the suggestion names the smallest size it could try', async () => {
        const source = await noiseJpeg({ width: 8000, height: 40 });

        const error = await runOperation('compress', source, {
            targetBytes: String(10 * KB),
            policy: 'fit',
        }).then(
            (result) => { throw new Error(`expected a refusal, got ${result.resultBytes} bytes`); },
            (thrown) => thrown,
        );

        expect(error).toBeInstanceOf(JobError);
        expect(error.code).toBe('target-unreachable');
        expect(error.message).toMatch(/Cannot reach 10 KB for this image/);
        expect(error.suggestion).toContain('6400×32 pixels');
        expect(stepSize(8000, 40, 2).height).toBeLessThan(FIT_MIN_DIMENSION);
    }, 300_000);
});

/* ------------------------------------------------------------------ *
 * 7. The fields every other op has to keep answering
 * ------------------------------------------------------------------ */

describe('the new result fields', () => {
    it('are null or false on an op that has no policy', async () => {
        const result = await runOperation('convert', await noisyPng(), { format: 'jpeg' });

        expect(result.policy).toBeNull();
        expect(result.resized).toBe(false);
        expect(result.originalWidth).toBeNull();
        expect(result.originalHeight).toBeNull();
        expect(result.steps).toBeNull();
    }, 120_000);
});
