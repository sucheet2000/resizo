/**
 * Exact-Size Targeting
 *
 * "Compress this to 100 KB" is the request behind every job-portal and
 * government-form upload, and no quality slider answers it: quality is a
 * perceptual dial, not a byte count, and the mapping from one to the other
 * depends entirely on the picture.
 *
 * So we measure instead of guess. The encoder runs at a probe quality, the real
 * output length is read back, and a binary search over the 1-100 range walks to
 * the highest quality whose output still fits the target. Output size is
 * monotonic in quality for JPEG and WebP, which is what makes the search valid;
 * the cost is bounded at TARGET_SEARCH_ITERATIONS encodes per phase.
 *
 * PNG is lossless, so quality does nothing to it. It gets the two levers that
 * do work, in order of least damage: palette quantisation first, then a
 * dimension downscale, and only if the palette alone could not reach the target.
 *
 * When even the smallest encode overshoots, the caller gets the measured floor
 * back rather than a wrong file — an approximate answer to "exactly 40 KB" is
 * not an answer.
 *
 * sharp is never imported here; every encode goes through lib/image/pipeline.js.
 */
import { MAX_TARGET_BYTES, MIN_TARGET_BYTES, TARGET_SEARCH_ITERATIONS } from '@/lib/constants';
import { applyOutputFormat, createPipeline } from '@/lib/image/pipeline';

const INTEGER_PATTERN = /^[0-9]+$/;

// Wall-clock ceiling for the whole search. Each probe re-encodes the source, so
// a pathological input can otherwise run 16 encodes straight into a 504. When
// the deadline passes the search stops and returns the best fit found so far.
const SEARCH_DEADLINE_MS = 35_000;

// Floor for the PNG downscale phase. Below this the image is a thumbnail of
// itself, and handing back a 5%-scale PNG is not honouring the request either.
const MIN_SCALE_PERCENT = 10;

const MAX_SCALE_PERCENT = 99;

/** Formats a byte count as whole kilobytes for a user-facing message. */
export function bytesToKb(bytes, round = Math.round) {
    if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes <= 0) return 0;
    return Math.max(1, round(bytes / 1024));
}

function bytesToMb(bytes) {
    return Math.round(bytes / (1024 * 1024));
}

/**
 * The 400 body for a target no encoder can reach. The floor is rounded UP so
 * the number quoted back is one the user can actually retry with.
 */
export function impossibleTargetMessage(targetBytes, smallestBytes) {
    return `Cannot reach ${bytesToKb(targetBytes)} KB for this image. `
        + `Smallest achievable is ${bytesToKb(smallestBytes, Math.ceil)} KB. Raise the target.`;
}

/**
 * Strict byte parser for the `targetBytes` form field, bounded by
 * MIN_TARGET_BYTES..MAX_TARGET_BYTES.
 *
 * Returns { ok: true, value } / { ok: false, absent: true } when the field was
 * not supplied at all, so the route can tell "no target requested" apart from
 * "target requested and malformed". A File posted under the field name, an
 * empty string and '1e5' are all malformed, never absent.
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

function isPositiveInteger(value) {
    return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

// The source is decoded once into a base pipeline; each probe clones it rather
// than rebuilding a fresh sharp instance around the buffer per iteration.
function encode(base, format, quality) {
    return applyOutputFormat(base.clone(), format, { quality }).toBuffer();
}

/**
 * Binary search over the 1-100 quality range.
 *
 * Tracks two results: `fit`, the LARGEST output that still fits the target (the
 * best-looking file that satisfies the request), and `floor`, the smallest
 * output the search ever produced (the honest answer when nothing fits).
 *
 * Stops early once `deadline` passes, returning the best fit found so far.
 */
async function searchQuality({ base, format, targetBytes, maxIterations, deadline, now }) {
    let low = 1;
    let high = 100;
    let fit = null;
    let fitQuality = null;
    let floor = null;
    let iterations = 0;

    while (low <= high && iterations < maxIterations) {
        if (now() >= deadline) break;

        const quality = Math.floor((low + high) / 2);
        const output = await encode(base, format, quality);
        iterations += 1;

        if (floor === null || output.length < floor.length) floor = output;

        if (output.length <= targetBytes) {
            if (fit === null || output.length > fit.length) {
                fit = output;
                fitQuality = quality;
            }
            low = quality + 1;
        } else {
            high = quality - 1;
        }
    }

    return { fit, fitQuality, floor, iterations };
}

/**
 * PNG-only second phase: the palette is already as small as it goes, so the
 * only lever left is pixels. Binary-searches the largest whole-percent scale
 * whose quantised output still fits.
 */
async function searchScale({ base, targetBytes, quality, maxIterations, deadline, now }) {
    let metadata;
    try {
        metadata = await base.clone().metadata();
    } catch {
        return { fit: null, floor: null, iterations: 0 };
    }

    const { width, height } = metadata ?? {};
    if (!isPositiveInteger(width) || !isPositiveInteger(height)) {
        return { fit: null, floor: null, iterations: 0 };
    }

    let low = MIN_SCALE_PERCENT;
    let high = MAX_SCALE_PERCENT;
    let fit = null;
    let fitScale = null;
    let floor = null;
    let iterations = 0;

    while (low <= high && iterations < maxIterations) {
        if (now() >= deadline) break;

        const percent = Math.floor((low + high) / 2);
        const resized = base.clone().resize({
            width: Math.max(1, Math.round((width * percent) / 100)),
            height: Math.max(1, Math.round((height * percent) / 100)),
        });
        const output = await applyOutputFormat(resized, 'png', { quality }).toBuffer();
        iterations += 1;

        if (floor === null || output.length < floor.length) floor = output;

        if (output.length <= targetBytes) {
            if (fit === null || output.length > fit.length) {
                fit = output;
                fitScale = percent;
            }
            low = percent + 1;
        } else {
            high = percent - 1;
        }
    }

    return { fit, fitScale, floor, iterations };
}

function smaller(a, b) {
    if (!a) return b;
    if (!b) return a;
    return a.length <= b.length ? a : b;
}

/**
 * Compresses `buffer` to at most `targetBytes`, as close to it as the encoder
 * can get.
 *
 * Resolves to { ok: true, buffer, quality, scalePercent, iterations } or
 * { ok: false, error, smallestBytes, iterations } when the target is below what
 * the format can produce for this image.
 */
export async function compressToTarget({
    buffer,
    format,
    targetBytes,
    maxIterations = TARGET_SEARCH_ITERATIONS,
    deadlineMs = SEARCH_DEADLINE_MS,
    now = Date.now,
}) {
    const base = createPipeline(buffer);
    const deadline = now() + deadlineMs;

    const quality = await searchQuality({ base, format, targetBytes, maxIterations, deadline, now });

    if (quality.fit) {
        return {
            ok: true,
            buffer: quality.fit,
            quality: quality.fitQuality,
            scalePercent: 100,
            iterations: quality.iterations,
        };
    }

    if (format !== 'png') {
        return {
            ok: false,
            error: impossibleTargetMessage(targetBytes, quality.floor?.length ?? buffer.length),
            smallestBytes: quality.floor?.length ?? buffer.length,
            iterations: quality.iterations,
        };
    }

    // PNG only: quantisation alone missed, so drop pixels at the smallest
    // palette the first phase reached.
    const scale = await searchScale({ base, targetBytes, quality: 1, maxIterations, deadline, now });
    const iterations = quality.iterations + scale.iterations;

    if (scale.fit) {
        return {
            ok: true,
            buffer: scale.fit,
            quality: 1,
            scalePercent: scale.fitScale,
            iterations,
        };
    }

    const floor = smaller(quality.floor, scale.floor);
    const smallestBytes = floor?.length ?? buffer.length;

    return {
        ok: false,
        error: impossibleTargetMessage(targetBytes, smallestBytes),
        smallestBytes,
        iterations,
    };
}
