/**
 * Exact-Size Targeting, in the browser
 *
 * "Compress this to 100 KB" is the request behind every job-portal upload, and
 * no quality slider answers it: quality is a perceptual dial, not a byte count,
 * and the mapping between them depends entirely on the picture. So the encoder
 * runs, the real output length is read back, and a binary search walks to the
 * largest output that still fits.
 *
 * This module was for a while a deliberate second copy of a sharp-backed one,
 * because that one could not be imported from a worker without dragging a
 * native Node addon into a browser bundle. That copy is gone and this is now
 * the only implementation, so the parse, the bounds and the two user-facing
 * sentences below have exactly one home again.
 *
 * WHY IT DOES NOT WORK THE WAY THE SHARP VERSION DID
 *
 *  - The search is fed a DECODED ImageData, not a file. The sharp version
 *    re-decoded the source on every probe (it clones a pipeline); here the
 *    source is decoded once and only the encode repeats. Eight probes therefore
 *    cost eight encodes and one decode instead of eight of each.
 *
 *  - PNG skips the quality phase entirely. Phase one used to quantise the
 *    palette and phase two dropped pixels. @jsquash/png has no quantiser at
 *    all, so every quality probe would produce byte-identical output and the
 *    first phase is pure waste — the caller goes straight to the scale search.
 *
 *  - The deadline is shorter. A 35 s ceiling existed to beat a platform 504;
 *    there is no gateway now, only a person holding a phone.
 */
import { MAX_TARGET_BYTES, MIN_TARGET_BYTES, TARGET_SEARCH_ITERATIONS } from '@/lib/limits';

const INTEGER_PATTERN = /^[0-9]+$/;

/**
 * Wall-clock ceiling for one search. MozJPEG measured 1.74-1.88 s on a full
 * 12 MP frame, so the worst legal case — eight probes at full size — is about
 * 15 s. 20 s covers it with headroom and still stops a pathological input from
 * spinning a tab forever.
 */
export const TARGET_SEARCH_DEADLINE_MS = 20_000;

/**
 * The failure code every op throws when no setting can reach the target. It
 * is exported because /compress offers "Shrink to fit instead" on exactly this
 * failure and on nothing else — a memory refusal or a decode crash must not
 * draw that offer — and a page must never re-type a string the engine throws.
 */
export const TARGET_UNREACHABLE_CODE = 'target-unreachable';

/**
 * Floor for the PNG downscale phase, and its ceiling. Below 10% the image is a
 * thumbnail of itself and handing that back is not honouring the request
 * either; above 99% there is nothing to gain. Both match the server.
 */
export const MIN_SCALE_PERCENT = 10;
export const MAX_SCALE_PERCENT = 99;

/** Formats a byte count as whole kilobytes for a user-facing message. */
export function bytesToKb(bytes, round = Math.round) {
    if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes <= 0) return 0;
    return Math.max(1, round(bytes / 1024));
}

function bytesToMb(bytes) {
    return Math.round(bytes / (1024 * 1024));
}

/**
 * The message for a target no encoder can reach. The floor is rounded UP so the
 * number quoted back is one the user can actually retry with.
 */
export function impossibleTargetMessage(targetBytes, smallestBytes) {
    return `Cannot reach ${bytesToKb(targetBytes)} KB for this image. `
        + `Smallest achievable is ${bytesToKb(smallestBytes, Math.ceil)} KB. Raise the target.`;
}

/**
 * Strict byte parser, bounded by MIN_TARGET_BYTES..MAX_TARGET_BYTES.
 *
 * Returns { ok: false, absent: true } when the field was not supplied at all,
 * so the caller can tell "no target requested" apart from "target requested and
 * malformed". An empty string and '1e5' are both malformed, never absent.
 */
export function parseTargetBytes(raw, { min = MIN_TARGET_BYTES, max = MAX_TARGET_BYTES } = {}) {
    const rangeError = `Target size must be a whole number of bytes between ${bytesToKb(min)} KB and ${bytesToMb(max)} MB.`;

    if (raw === null || raw === undefined) {
        return { ok: false, absent: true, error: rangeError };
    }

    let value;

    if (typeof raw === 'number') {
        if (!Number.isSafeInteger(raw)) return { ok: false, absent: false, error: rangeError };
        value = raw;
    } else if (typeof raw === 'string') {
        const trimmed = raw.trim();
        if (trimmed === '') return { ok: false, absent: false, error: rangeError };
        if (!INTEGER_PATTERN.test(trimmed)) return { ok: false, absent: false, error: rangeError };
        value = Number(trimmed);
        if (!Number.isSafeInteger(value)) return { ok: false, absent: false, error: rangeError };
    } else {
        return { ok: false, absent: false, error: rangeError };
    }

    if (value < min || value > max) return { ok: false, absent: false, error: rangeError };

    return { ok: true, value };
}

/**
 * Binary search over an integer range, measuring a real encode at each step.
 *
 * `probe(value)` must return `{ bytes, payload }` — the measured output length
 * and whatever the caller wants back for the winning attempt. The search tracks
 * two of them: `fit`, the LARGEST output that still fits the target (the
 * best-looking file that satisfies the request), and `floor`, the smallest
 * output the search ever produced (the honest answer when nothing fits).
 *
 * Monotonicity is the assumption that makes this valid: output size rises with
 * quality for JPEG and WebP, and with scale for any format.
 *
 * Stops early once the deadline passes, returning the best fit found so far.
 */
async function searchRange({
    probe,
    low: initialLow,
    high: initialHigh,
    targetBytes,
    maxIterations = TARGET_SEARCH_ITERATIONS,
    deadline,
    now = Date.now,
    onIteration = null,
}) {
    let low = initialLow;
    let high = initialHigh;
    let fit = null;
    let fitValue = null;
    let floor = null;
    let floorBytes = null;
    let iterations = 0;

    while (low <= high && iterations < maxIterations) {
        if (now() >= deadline) break;

        const value = Math.floor((low + high) / 2);
        const attempt = await probe(value);
        iterations += 1;
        onIteration?.(iterations, maxIterations);

        if (!attempt) break;

        if (floorBytes === null || attempt.bytes < floorBytes) {
            floor = attempt.payload;
            floorBytes = attempt.bytes;
        }

        if (attempt.bytes <= targetBytes) {
            if (fit === null || attempt.bytes > fit.bytes) {
                fit = attempt;
                fitValue = value;
            }
            low = value + 1;
        } else {
            high = value - 1;
        }
    }

    return {
        fit: fit ? fit.payload : null,
        fitBytes: fit ? fit.bytes : null,
        fitValue,
        floor,
        floorBytes,
        iterations,
    };
}

/**
 * Largest quality whose encode still fits the target.
 *
 * The range is 1-100 unless the caller raises the floor. It raises it when it
 * has a second lever to pull: /compress's "fit under the target" policy stops
 * searching downwards at FIT_MIN_QUALITY and starts dropping pixels instead,
 * because below that number the artefacts cost more than the smaller picture
 * would have. A caller with no second lever leaves the floor at 1, which is
 * every existing one.
 *
 * @param {object} input
 * @param {(quality: number) => Promise<{ bytes: number, payload: * }>} input.probe
 * @param {number} [input.minQuality] the lowest quality the search may probe
 */
export function searchQuality({ probe, targetBytes, maxIterations, deadline, now, onIteration, minQuality = 1 }) {
    const low = Number.isFinite(minQuality) ? Math.min(100, Math.max(1, Math.round(minQuality))) : 1;
    return searchRange({ probe, low, high: 100, targetBytes, maxIterations, deadline, now, onIteration });
}

/**
 * Largest whole-percent scale whose encode still fits the target. PNG's only
 * lever in this build, since there is no quantiser to turn.
 *
 * @param {object} input
 * @param {(percent: number) => Promise<{ bytes: number, payload: * }>} input.probe
 */
export function searchScale({ probe, targetBytes, maxIterations, deadline, now, onIteration }) {
    return searchRange({
        probe,
        low: MIN_SCALE_PERCENT,
        high: MAX_SCALE_PERCENT,
        targetBytes,
        maxIterations,
        deadline,
        now,
        onIteration,
    });
}
