/**
 * The Requirement Contract
 *
 * A form states several things at once — exactly 600 by 600 pixels, or 35 by
 * 45 millimetres at 300 DPI, a JPEG, no more than 100 KB, sometimes at least
 * 20 KB — and every one of them has to be true of the same file. Two pages ask
 * that question now: /passport-photo, where the numbers come from an
 * authority, and /image-size-fitter, where they come from whatever the visitor
 * was told. This module is the half of the answer that happens BEFORE a pixel
 * is touched: reading the typed fields, turning a physical size into pixels,
 * refusing the combinations that cannot work, and handing back exactly the
 * fields the engine's `fit` op takes.
 *
 * WHY IT IS HERE AND NOT IN lib/image-client/
 *
 * `lib/image-client/requirements.js` already parses all of this — strictly,
 * once, inside the job. It is the authority and nothing here replaces it. But
 * it parses a job that is already being run, and a panel has to say what is
 * wrong with a field while somebody is still typing in it, on the main thread,
 * with no file loaded and no worker started. So this module answers the
 * earlier question in the same vocabulary, and the two agree on purpose: every
 * bound below is the engine's own (MAX_DIMENSION, MIN_DPI/MAX_DPI,
 * MAX_TARGET_BYTES), and the one rule that could plausibly differ — a minimum
 * that equals the maximum — is refused here because the engine refuses it
 * there. A panel that green-lights a job the engine will refuse has moved the
 * refusal from a field label to a dead end.
 *
 * PURE, and it has to stay pure: `lib/format/` is imported by the worker, so
 * no React, no `'use client'`, no catalogue. The messages are sentences a
 * person can act on rather than codes, because they are rendered under a field
 * exactly as they are written here.
 */
import { pixelsFor } from '@/lib/format/physical';
import { TARGET_UNREACHABLE_CODE, bytesToKb } from '@/lib/image-client/target-bytes';
import { MAX_DIMENSION, MAX_DPI, MAX_TARGET_BYTES, MIN_DPI, MIN_TARGET_BYTES } from '@/lib/limits';

/**
 * Resizo's own default when a size is given in millimetres, centimetres or
 * inches and nobody stated a resolution. It is NOT an authority's number and
 * no page may present it as one — it is the figure print shops and government
 * PDFs converge on, offered so a physical size has some way to become pixels.
 */
export const DEFAULT_PHYSICAL_DPI = 300;

export const UNITS = ['px', 'mm', 'cm', 'in'];

export const GEOMETRIES = ['cover', 'contain', 'stretch'];

export const FORMATS = ['jpeg', 'png', 'webp'];

const DEFAULT_UNIT = 'px';
const DEFAULT_GEOMETRY = 'cover';
const DEFAULT_FORMAT = 'jpeg';
const DEFAULT_BACKGROUND = 'white';

/**
 * The engine's own code for a byte FLOOR no quality could reach. Its constant
 * lives in `lib/image-client/requirements.js`, which this module deliberately
 * does not import: that file pulls the decoder, the encoder and the resampler
 * behind it, and every page importing a pure helper would carry them.
 */
const MINIMUM_UNREACHABLE_CODE = 'minimum-unreachable';

const FORMAT_LABELS = { jpeg: 'JPEG', png: 'PNG', webp: 'WebP' };

const NOT_REQUIRED = 'Not required';

/** '20480' → '20,480'. Locale-free on purpose: the copy is pinned by tests. */
function withThousands(value) {
    return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

const BYTE_CEILING_KB = withThousands(bytesToKb(MAX_TARGET_BYTES));

/** The smallest minimum worth asking for: a floor under 1 KB is noise the engine would honour to the byte. */
const MIN_FLOOR_BYTES = 1024;

const MESSAGES = {
    unit: `Unit must be ${UNITS.join(', ').replace(/, (?=[^,]*$)/, ' or ')}.`,
    dpiRange: `DPI must be a whole number between ${MIN_DPI} and ${MAX_DPI}.`,
    dpiNeeded: 'A size in mm, cm or in needs a DPI to become pixels.',
    pixelCeiling: `Width and height cannot be more than ${MAX_DIMENSION} pixels.`,
    subPixel: 'That size is smaller than one pixel — raise the size or the DPI.',
    maxPositive: 'Maximum file size must be greater than 0 KB.',
    maxCeiling: `Maximum file size cannot be more than ${BYTE_CEILING_KB} KB.`,
    maxFloor: `Maximum file size cannot be less than ${Math.round(MIN_TARGET_BYTES / 1024)} KB.`,
    minPositive: 'Minimum file size must be greater than 0 KB.',
    minFloor: 'Minimum file size cannot be less than 1 KB.',
    minCeiling: `Minimum file size cannot be more than ${BYTE_CEILING_KB} KB.`,
    minBelowMax: 'Minimum file size must be smaller than the maximum.',
    geometry: 'Fill behaviour must be cover, contain or stretch.',
    format: 'Output format must be JPEG, PNG or WebP.',
};

function textOf(raw) {
    return String(raw ?? '').trim();
}

/** A typed size, in whatever unit the field is in. Null when blank or unusable. */
export function parsePositiveNumber(raw) {
    const value = Number(textOf(raw));
    return Number.isFinite(value) && value > 0 ? value : null;
}

/** A typed resolution, held to the engine's bounds. Null when blank or unusable. */
export function parseDpiValue(raw) {
    const text = textOf(raw);
    if (text === '') return null;

    const value = Number(text);
    if (!Number.isInteger(value) || value < MIN_DPI || value > MAX_DPI) return null;

    return value;
}

/**
 * A byte count from a kilobyte field, 1 KB being 1024 bytes.
 *
 * Null means the field was left empty; ZERO means something was typed that
 * cannot be a size. Collapsing the two would turn a mistyped ceiling into no
 * ceiling at all, which is the one failure a byte limit must never have.
 */
export function parseKbToBytes(raw) {
    const text = textOf(raw);
    if (text === '') return null;

    const value = Number(text);
    if (!Number.isFinite(value) || value <= 0) return 0;

    return Math.round(value * 1024);
}

/**
 * The largest centred rectangle of `aspect` that fits inside the source — the
 * same shape a plain 'cover' fit lands on with nobody dragging anything, so a
 * photo run without ever touching the frame gets exactly the crop the geometry
 * option alone would have produced.
 */
export function centeredCoverRect(sourceWidth, sourceHeight, aspect) {
    if (!(sourceWidth > 0) || !(sourceHeight > 0) || !(aspect > 0)) return null;

    const sourceAspect = sourceWidth / sourceHeight;
    let width;
    let height;

    if (sourceAspect > aspect) {
        height = sourceHeight;
        width = Math.round(height * aspect);
    } else {
        width = sourceWidth;
        height = Math.round(width / aspect);
    }

    width = Math.min(Math.max(width, 1), sourceWidth);
    height = Math.min(Math.max(height, 1), sourceHeight);

    return {
        x: Math.round((sourceWidth - width) / 2),
        y: Math.round((sourceHeight - height) / 2),
        width,
        height,
    };
}

function sideMessage(value, side, isPhysical) {
    // 35.5 mm is a real size; 600.5 px is not a real pixel count. The sentence
    // says which of the two is being asked for rather than one covering both.
    if (value === null || (!isPhysical && !Number.isInteger(value))) {
        return isPhysical
            ? `${side} must be a number greater than 0.`
            : `${side} must be a whole number greater than 0.`;
    }

    return null;
}

/**
 * Every typed field, read once, into the exact form fields the `fit` op takes.
 *
 * Errors are collected rather than short-circuited: somebody who typed two bad
 * numbers should see two messages, not fix one and discover the next.
 *
 * @param {object} input the raw field values, exactly as they were typed
 * @returns {{
 *   ok: boolean,
 *   pixels: {width: number, height: number}|null,
 *   dpi: number|null,
 *   dpiDropped: boolean,
 *   fields: object|null,
 *   errors: object,
 * }}
 */
export function resolveRequirements({
    width,
    height,
    unit,
    dpi,
    format,
    maxKb,
    minKb,
    geometry,
    background,
    allowLowerQuality = false,
} = {}) {
    const errors = {};

    const unitText = textOf(unit).toLowerCase();
    const chosenUnit = unitText === '' ? DEFAULT_UNIT : unitText;
    const knownUnit = UNITS.includes(chosenUnit);
    if (!knownUnit) errors.size = MESSAGES.unit;

    const isPhysical = knownUnit && chosenUnit !== DEFAULT_UNIT;

    const widthValue = parsePositiveNumber(width);
    const heightValue = parsePositiveNumber(height);
    const widthError = sideMessage(widthValue, 'Width', isPhysical);
    const heightError = sideMessage(heightValue, 'Height', isPhysical);
    if (widthError) errors.width = widthError;
    if (heightError) errors.height = heightError;

    const dpiText = textOf(dpi);
    const typedDpi = parseDpiValue(dpi);
    if (dpiText !== '' && typedDpi === null) {
        // A pixel job that mistyped an optional DPI is told the bounds; a
        // physical one is told what it costs, because without a resolution
        // there are no pixels to ask for at all.
        errors.dpi = isPhysical ? MESSAGES.dpiNeeded : MESSAGES.dpiRange;
    }

    const effectiveDpi = typedDpi ?? (isPhysical && dpiText === '' ? DEFAULT_PHYSICAL_DPI : null);

    const geometryText = textOf(geometry).toLowerCase();
    const chosenGeometry = geometryText === '' ? DEFAULT_GEOMETRY : geometryText;
    if (!GEOMETRIES.includes(chosenGeometry)) errors.geometry = MESSAGES.geometry;

    const formatText = textOf(format).toLowerCase();
    const chosenFormat = formatText === '' ? DEFAULT_FORMAT : formatText;
    if (!FORMATS.includes(chosenFormat)) errors.format = MESSAGES.format;

    const backgroundText = textOf(background);
    const chosenBackground = backgroundText === '' ? DEFAULT_BACKGROUND : backgroundText;

    let pixels = null;
    if (!widthError && !heightError && knownUnit && !errors.dpi) {
        pixels = isPhysical
            ? {
                width: pixelsFor(widthValue, chosenUnit, effectiveDpi),
                height: pixelsFor(heightValue, chosenUnit, effectiveDpi),
            }
            : { width: widthValue, height: heightValue };
    }

    if (pixels && (pixels.width < 1 || pixels.height < 1)) {
        errors.size = MESSAGES.subPixel;
        pixels = null;
    } else if (pixels && (pixels.width > MAX_DIMENSION || pixels.height > MAX_DIMENSION)) {
        errors.size = isPhysical
            ? `At ${effectiveDpi} DPI that is larger than ${MAX_DIMENSION} pixels on a side — `
                + 'lower the DPI or the size.'
            : MESSAGES.pixelCeiling;
        pixels = null;
    }

    const maxBytes = parseKbToBytes(maxKb);
    if (maxBytes !== null) {
        if (maxBytes <= 0) errors.maxKb = MESSAGES.maxPositive;
        else if (maxBytes < MIN_TARGET_BYTES) errors.maxKb = MESSAGES.maxFloor;
        else if (maxBytes > MAX_TARGET_BYTES) errors.maxKb = MESSAGES.maxCeiling;
    }

    const minBytes = parseKbToBytes(minKb);
    if (minBytes !== null) {
        if (minBytes <= 0) errors.minKb = MESSAGES.minPositive;
        else if (minBytes < MIN_FLOOR_BYTES) errors.minKb = MESSAGES.minFloor;
        else if (minBytes > MAX_TARGET_BYTES) errors.minKb = MESSAGES.minCeiling;
        // Compared only against a maximum that is itself usable — measuring a
        // minimum against a number already flagged as wrong says nothing.
        else if (!errors.maxKb && maxBytes !== null && minBytes >= maxBytes) errors.minKb = MESSAGES.minBelowMax;
    }

    // WebP's container has no density field, so a DPI can still be needed to
    // turn millimetres into pixels and still be impossible to record in the
    // finished file. Both facts are reported; the field is simply not sent.
    const dpiDropped = chosenFormat === 'webp' && effectiveDpi !== null;

    if (Object.keys(errors).length > 0 || pixels === null) {
        return { ok: false, pixels: null, dpi: effectiveDpi, dpiDropped, fields: null, errors };
    }

    const fields = {
        width: pixels.width,
        height: pixels.height,
        geometry: chosenGeometry,
        format: chosenFormat,
        background: chosenBackground,
    };

    if (maxBytes) fields.targetBytes = maxBytes;
    if (minBytes) fields.minBytes = minBytes;
    if (allowLowerQuality) fields.minQuality = 1;
    if (effectiveDpi !== null && chosenFormat !== 'webp') fields.dpi = effectiveDpi;

    return { ok: true, pixels, dpi: effectiveDpi, dpiDropped, fields, errors };
}

/**
 * Whether the job will make the picture bigger than the part of it being kept
 * — the crop rectangle under 'cover', the whole photo under 'contain' and
 * 'stretch'.
 *
 * Exact dimensions are always reachable, so nothing here refuses anything: the
 * point is that "600 × 600 exact" and "600 × 600 with detail" are different
 * claims, and only the page saying so keeps the second one from being implied.
 *
 * @returns {{from: {width, height}, to: {width, height}}|null}
 */
export function enlargementFor({ sourceWidth, sourceHeight, keptRect, pixels } = {}) {
    if (!pixels || !(pixels.width > 0) || !(pixels.height > 0)) return null;

    const kept = keptRect ?? (sourceWidth > 0 && sourceHeight > 0
        ? { width: sourceWidth, height: sourceHeight }
        : null);

    if (!kept || !(kept.width > 0) || !(kept.height > 0)) return null;
    if (pixels.width <= kept.width && pixels.height <= kept.height) return null;

    return {
        from: { width: kept.width, height: kept.height },
        to: { width: pixels.width, height: pixels.height },
    };
}

/**
 * The levers this failure and this format actually have.
 *
 * Only two engine failures have any: a ceiling nothing could fit under, and a
 * floor nothing could climb to. Everything else — a memory refusal, a decode
 * that failed — is a refusal with no button behind it, and offering one would
 * be inviting somebody to press the same job again.
 *
 * `isCustom` is false when the numbers belong to an authority rather than the
 * visitor: /passport-photo under a preset shows no minimum field to change and
 * cannot silently switch a stated JPEG to WebP.
 *
 * @param {string|{code: string}|null} error the engine's failure code
 * @returns {string[]} 'lower-quality' | 'webp' | 'limit' | 'png' | 'size' | 'minimum'
 */
export function recoveryFor(error, { format, isCustom = true, allowLowerQuality = false } = {}) {
    const code = typeof error === 'string' ? error : (error?.code ?? null);
    const chosenFormat = textOf(format).toLowerCase();

    if (code === TARGET_UNREACHABLE_CODE) {
        return [
            // PNG has no quality dial in this build, so there is nothing to
            // lower — and once lower quality is already allowed, offering it
            // again would only rerun the search that just failed.
            ...(chosenFormat === 'png' || allowLowerQuality ? [] : ['lower-quality']),
            ...(isCustom && chosenFormat !== 'webp' ? ['webp'] : []),
            'limit',
        ];
    }

    if (code === MINIMUM_UNREACHABLE_CODE) {
        return [
            ...(chosenFormat === 'png' ? [] : ['png']),
            'size',
            ...(isCustom ? ['minimum'] : []),
        ];
    }

    return [];
}

function describeSize(fields, unit, physical, dpi) {
    const inPixels = `${fields.width} × ${fields.height} px`;
    if (!physical || unit === DEFAULT_UNIT || !dpi) return inPixels;

    return `${physical.width} × ${physical.height} ${unit} at ${dpi} DPI = ${inPixels}`;
}

/**
 * What was ASKED for, row by row, in the order and under the labels
 * `validateOutput` reports what was DELIVERED — so a summary can put the two
 * columns side by side without either side knowing about the other.
 *
 * @param {object} fields   from resolveRequirements
 * @param {{unit: string, physical: {width, height}|null, dpi: number|null}} context
 * @returns {Array<{key: string, label: string, requested: string}>}
 */
export function describeRequested(fields = {}, { unit = DEFAULT_UNIT, physical = null, dpi = null } = {}) {
    return [
        {
            key: 'dimensions',
            label: 'Dimensions',
            requested: describeSize(fields, unit, physical, dpi),
        },
        {
            key: 'format',
            label: 'Format',
            requested: FORMAT_LABELS[fields.format] ?? String(fields.format ?? '').toUpperCase(),
        },
        {
            key: 'maxBytes',
            label: 'Maximum file size',
            requested: fields.targetBytes ? `≤ ${bytesToKb(fields.targetBytes)} KB` : NOT_REQUIRED,
        },
        {
            key: 'minBytes',
            label: 'Minimum file size',
            requested: fields.minBytes ? `≥ ${bytesToKb(fields.minBytes)} KB` : NOT_REQUIRED,
        },
        {
            // Reads the FIELD rather than the context: a WebP job can need a
            // DPI to reach its pixels and still record none, and this row is
            // about what the finished file will state.
            key: 'dpi',
            label: 'Resolution',
            requested: fields.dpi ? `${fields.dpi} DPI` : NOT_REQUIRED,
        },
        {
            // JPEG is the one output format here with no alpha channel; PNG
            // and WebP both keep what the picture had. The finished file is
            // checked by validateOutput either way — this is the request.
            key: 'transparency',
            label: 'Transparency',
            requested: fields.format === 'jpeg' ? 'No transparency' : 'Kept where the format allows',
        },
    ];
}
