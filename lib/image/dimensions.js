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
