/**
 * Dimension and Scale Parsing
 *
 * Strict parsers that replace parseInt/parseFloat. parseInt silently accepts
 * '8000abc' as 8000 and '1e10' as 1, so a malformed request used to succeed
 * with a surprising value instead of returning 400.
 *
 * Every parser returns { ok: true, value } or { ok: false, absent, error }.
 * `absent` is true only when the caller supplied nothing at all, which lets a
 * route tell "not provided" apart from "provided and invalid".
 */
import { MAX_DIMENSION, MAX_PIXELS, MAX_SCALE_PERCENT } from '@/lib/constants';

const INTEGER_PATTERN = /^[0-9]+$/;
const DECIMAL_PATTERN = /^[0-9]+(\.[0-9]+)?$/;

const DIMENSION_ERROR = 'Dimensions exceed maximum allowed values.';

function absent(error) {
    return { ok: false, absent: true, error };
}

function invalid(error) {
    return { ok: false, absent: false, error };
}

function isPositiveFinite(value) {
    return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

/**
 * Strict whole-number parser. Accepts a digits-only string (trimmed) or a
 * number that is already an integer — the bulk route's JSON config supplies
 * real numbers, the form paths supply strings.
 */
export function parsePositiveInt(raw, { max, min = 1 } = {}) {
    if (raw === null || raw === undefined) return absent('Value is required.');

    let value;

    if (typeof raw === 'number') {
        if (!Number.isInteger(raw)) return invalid('Value must be a whole number.');
        if (!Number.isSafeInteger(raw)) return invalid('Value is out of range.');
        value = raw;
    } else if (typeof raw === 'string') {
        const trimmed = raw.trim();
        if (trimmed === '') return absent('Value is required.');
        if (!INTEGER_PATTERN.test(trimmed)) return invalid('Value must be a whole number.');
        value = Number(trimmed);
        if (!Number.isSafeInteger(value)) return invalid('Value is out of range.');
    } else {
        return invalid('Value must be a whole number.');
    }

    if (value < min) return invalid('Value is out of range.');
    if (max !== undefined && value > max) return invalid('Value is out of range.');

    return { ok: true, value };
}

/**
 * Strict percentage parser: 0 < scale <= 400, decimals allowed.
 */
export function parseScale(raw, { max = MAX_SCALE_PERCENT } = {}) {
    if (raw === null || raw === undefined) return absent('Scale is required.');

    let value;

    if (typeof raw === 'number') {
        if (!Number.isFinite(raw)) return invalid('Scale must be a number.');
        value = raw;
    } else if (typeof raw === 'string') {
        const trimmed = raw.trim();
        if (trimmed === '') return absent('Scale is required.');
        if (!DECIMAL_PATTERN.test(trimmed)) return invalid('Scale must be a number.');
        value = Number(trimmed);
    } else {
        return invalid('Scale must be a number.');
    }

    if (!(value > 0) || value > max) return invalid(`Scale must be greater than 0 and at most ${max}.`);

    return { ok: true, value };
}

/**
 * True when width * height fits the total-pixel budget. Guards the decode and
 * the output separately from the per-side MAX_DIMENSION cap.
 */
export function withinPixelBudget(width, height, budget = MAX_PIXELS) {
    if (!isPositiveFinite(width) || !isPositiveFinite(height)) return false;
    return width * height <= budget;
}

/**
 * Applies a percentage to source dimensions. Rounds, clamps each side to a
 * minimum of 1 (so a tiny scale returns 1x1 instead of asking sharp for 0x0)
 * and rejects results past MAX_DIMENSION or the pixel budget — the scale path
 * previously had no ceiling at all.
 */
export function scaleDimensions(width, height, percent) {
    if (!isPositiveFinite(width) || !isPositiveFinite(height)) {
        return { ok: false, error: 'Unable to determine the source image dimensions.' };
    }
    if (!isPositiveFinite(percent)) {
        return { ok: false, error: 'Invalid scale parameter provided.' };
    }

    const scaledWidth = Math.max(1, Math.round(width * (percent / 100)));
    const scaledHeight = Math.max(1, Math.round(height * (percent / 100)));

    if (scaledWidth > MAX_DIMENSION || scaledHeight > MAX_DIMENSION) {
        return { ok: false, error: 'Dimensions exceed maximum allowed values.' };
    }
    if (!withinPixelBudget(scaledWidth, scaledHeight)) {
        return { ok: false, error: 'Dimensions exceed maximum allowed values.' };
    }

    return { ok: true, width: scaledWidth, height: scaledHeight };
}

/**
 * One side derives the other. This is the aspect-ratio lock, and it had three
 * separate implementations: the client resizer's targetDimensions, the live
 * width/height fields on /resize, and the two route handlers. They did the same
 * arithmetic in a different ORDER — `(h / w) * width` against `h * (width / w)`
 * — which is not the same function in floating point, so the number the field
 * predicted and the number the server produced could differ by a pixel.
 *
 * The order below is the routes' order, because the routes are what sharp is
 * actually asked for and therefore what the output really is. Every other
 * caller now derives through here.
 *
 * `Math.max(1, …)` is not decoration: a 10000×3 source at width 1 rounds to a
 * height of 0, and asking any resampler for a zero-height image is an error.
 */
export function deriveHeight(sourceWidth, sourceHeight, width) {
    return Math.max(1, Math.round(sourceHeight * (width / sourceWidth)));
}

/** The mirror of deriveHeight: the width that keeps the shape at a given height. */
export function deriveWidth(sourceWidth, sourceHeight, height) {
    return Math.max(1, Math.round(sourceWidth * (height / sourceHeight)));
}

/**
 * The size an image ends up at when the caller gave a width, a height, or both.
 *
 * The part that is easy to miss: the caps apply to the side that was DERIVED
 * as well as the side that was supplied. width=8000 on a tall thin source
 * otherwise asks for a height in the hundreds of thousands. This started life
 * as a resize route's resolveExplicitTarget and is now the single copy, used by
 * the engine (lib/image-client/resize.js) and by the batch memory gate
 * (lib/upload/process-file.js). Where the cap lands is walked pixel by pixel in
 * tests/lib/image/dimensions.test.js.
 *
 * Both sides supplied means exactly those two numbers. That is the OUTPUT SIZE
 * and nothing else — how the picture is made to fit them is not decided here.
 * sharp's default `fit: 'cover'` scales until the box is filled and trims the
 * overflow from the centre, keeping the shape; lib/image-client/resize.js does
 * the same in the browser. Neither one stretches, and a reader who takes this
 * function's two numbers for a resample size will write the version that does.
 *
 * @returns {{ ok: true, width: number, height: number }|{ ok: false, error: string }}
 */
export function explicitTargetDimensions(sourceWidth, sourceHeight, { width = null, height = null } = {}) {
    if (!isPositiveFinite(sourceWidth) || !isPositiveFinite(sourceHeight)) {
        return { ok: false, error: 'Unable to determine the source image dimensions.' };
    }

    const hasWidth = isPositiveFinite(width);
    const hasHeight = isPositiveFinite(height);

    if (!hasWidth && !hasHeight) {
        return { ok: false, error: 'Provide a width, a height or a scale.' };
    }

    const targetWidth = hasWidth ? Math.round(width) : deriveWidth(sourceWidth, sourceHeight, height);
    const targetHeight = hasHeight ? Math.round(height) : deriveHeight(sourceWidth, sourceHeight, width);

    if (targetWidth > MAX_DIMENSION || targetHeight > MAX_DIMENSION) {
        return { ok: false, error: DIMENSION_ERROR };
    }
    if (!withinPixelBudget(targetWidth, targetHeight)) {
        return { ok: false, error: DIMENSION_ERROR };
    }

    return { ok: true, width: targetWidth, height: targetHeight };
}
