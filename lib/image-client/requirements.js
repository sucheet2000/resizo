/**
 * Output Requirements — reading them, solving the geometry, and checking the
 * file that came out.
 *
 * A passport portal, a university application form and a visa upload page all
 * ask the same shape of question, and it is not the question any existing tool
 * here answers. They ask for several things AT ONCE — exactly 600 by 750
 * pixels, a JPEG, at least 50 KB and no more than 10 MB, 300 DPI — and they
 * reject the upload if any single one of them is off. Answering that with
 * /resize then /convert then /compress is three round trips with a guess in the
 * middle, and the guess is usually wrong because the last stage undoes the
 * first: a byte target reached by shrinking the picture is a picture that no
 * longer has the pixel count the form demanded.
 *
 * THREE THINGS LIVE HERE AND NOTHING ELSE
 *
 *  1. parseRequirements — every option, parsed strictly, before a pixel is
 *     touched. Nothing is coerced and nothing is guessed: a malformed value is
 *     a sentence a person can act on, not a silent default.
 *  2. fitGeometry — the integer arithmetic that puts a picture of one shape
 *     into a box of another. It composes coverDimensions, centreCropRect and
 *     targetDimensions and derives nothing of its own, so a cover here and a
 *     cover on /resize are the same crop.
 *  3. readImageSize + validateOutput — the independent check.
 *
 * WHY THE VALIDATOR READS THE BYTES BACK INSTEAD OF TRUSTING THE PIPELINE
 *
 * This is the one place in the engine where a plausible wrong answer is worse
 * than a refusal. Every other tool hands back a picture the visitor can look
 * at; this one hands back a file whose whole value is a claim about numbers
 * they cannot see, and the cost of the claim being wrong is a rejected passport
 * application days later. So the claim is not made by the code that produced
 * the file. validateOutput opens the finished bytes with its own header parser,
 * measures their length, sniffs their format and reads their density, and
 * reports what it found against what was asked for. It shares no code with the
 * encoder, the resampler or the DPI writer, which is what makes it evidence
 * rather than an echo — a resize that silently produced 599 pixels, an encoder
 * that fell back to a different format, a DPI write that landed in the wrong
 * block: each one is caught by a reader that never saw the request.
 *
 * PURE, AND IT HAS TO STAY PURE. No DOM, no ImageData, no codec. The parser and
 * the validator both run on the main thread — the panel needs to say what will
 * be asked for before the job starts, and what was delivered after it ends —
 * and they run again inside the worker. Two calls on the same bytes return
 * deep-equal reports and neither touches the buffer.
 */
import {
    FIT_OUTPUT_FORMATS,
    FIT_MIN_QUALITY,
    MAX_DIMENSION,
    MAX_DPI,
    MAX_TARGET_BYTES,
    MIN_DPI,
} from '@/lib/limits';
import { formatLabel } from '@/lib/format/upload-helpers';
import { parsePositiveInt, withinPixelBudget } from '@/lib/image/dimensions';
import { sniffImageType } from '@/lib/image/magic-bytes';
import { readResolution } from '@/lib/image-client/dpi';
import { readImageSize } from '@/lib/image-client/image-size';
import { normaliseFormat } from '@/lib/image-client/encode';
import { formatKeepsAlpha, parseBackground } from '@/lib/image-client/flatten';
import { centreCropRect, coverDimensions, targetDimensions } from '@/lib/image-client/resize';
import { bytesToKb, parseTargetBytes } from '@/lib/image-client/target-bytes';

/**
 * The three answers to "this picture is not the shape of that box".
 *
 * cover is the default because it is the only one of the three that neither
 * distorts the picture nor puts a border round it, and a portal that checks a
 * face against a frame is checking the picture rather than the margins.
 * stretch is last, is never a default anywhere, and the page that offers it
 * says out loud what it does.
 */
export const GEOMETRIES = ['cover', 'contain', 'stretch'];

export const DEFAULT_GEOMETRY = 'cover';

export const DEFAULT_FIT_FORMAT = 'jpeg';

/** White, stated rather than inherited — see lib/image-client/flatten.js. */
export const DEFAULT_FIT_BACKGROUND = 'white';

/**
 * The qualities the byte FLOOR climbs, in order, and the reason there are four
 * of them rather than a search.
 *
 * A minimum is not a target: nothing is being fitted to, so there is no
 * best-looking answer to find and no reason to spend eight encodes finding one.
 * The first quality that clears the floor is the right answer, because it is
 * also the smallest file that clears it — which is what keeps a maximum on the
 * other side reachable. The four rungs cover the range where MozJPEG's output
 * actually grows steeply (measured on 300x300 noise: 39 KB at 80, 47 KB at 85,
 * 99 KB at 92, 138 KB at 96, 207 KB at 100), so four encodes reach anything a
 * form asks for that the picture can reach at all.
 */
export const MINIMUM_QUALITY_LADDER = [85, 92, 96, 100];

/** The failure code for a byte FLOOR no quality can reach. */
export const MINIMUM_UNREACHABLE_CODE = 'minimum-unreachable';

const INVALID_REQUIREMENTS = 'invalid-requirements';
const INVALID_DIMENSIONS = 'invalid-dimensions';
const INVALID_FORMAT = 'invalid-format';

const NOT_REQUIRED = 'Not required';
const UNKNOWN = 'Could not be read';

function fail(code, error) {
    return { ok: false, code, error };
}

/** 'jpeg, png, or webp' — the shape every refusal in this engine has. */
function joinOr(values) {
    if (values.length <= 1) return values.join('');
    if (values.length === 2) return `${values[0]} or ${values[1]}`;
    return `${values.slice(0, -1).join(', ')}, or ${values[values.length - 1]}`;
}

function isAbsent(value) {
    return value === null || value === undefined || (typeof value === 'string' && value.trim() === '');
}

/** '600 × 600 px', the one way this module writes a pair of dimensions. */
export function describeDimensions(width, height) {
    return `${width} × ${height} px`;
}

function describeBytes(bytes) {
    return `${bytesToKb(bytes)} KB`;
}

/* --------------------------------------------------------------- parsing */

function parseDimension(raw, side) {
    const parsed = parsePositiveInt(raw, { max: MAX_DIMENSION });

    if (parsed.absent) {
        return fail(INVALID_DIMENSIONS, `Give a ${side} in pixels — the form states one.`);
    }
    if (!parsed.ok) {
        return fail(
            INVALID_DIMENSIONS,
            `The ${side} must be a whole number of pixels between 1 and ${MAX_DIMENSION}.`,
        );
    }

    return { ok: true, value: parsed.value };
}

function parseGeometry(raw) {
    if (isAbsent(raw)) return { ok: true, value: DEFAULT_GEOMETRY };

    const value = String(raw).trim().toLowerCase();
    if (!GEOMETRIES.includes(value)) {
        return fail(INVALID_REQUIREMENTS, `Invalid fill behaviour. Must be ${joinOr(GEOMETRIES)}.`);
    }

    return { ok: true, value };
}

/**
 * FIT_OUTPUT_FORMATS, not ALLOWED_OUTPUT_FORMATS.
 *
 * The build can write AVIF and this tool still cannot offer it, for two
 * independent reasons: a requirement usually carries a byte ceiling, which
 * means a search of up to eight encodes against a 20 s deadline and libavif has
 * no rate controller to shortcut it — and no authority in
 * lib/catalog/application-presets/ accepts an AVIF anyway. Reading the wider
 * list here would have let a form ask for a file it cannot upload.
 */
function parseFormat(raw) {
    if (isAbsent(raw)) return { ok: true, value: DEFAULT_FIT_FORMAT };

    const value = normaliseFormat(raw);
    if (!value || !FIT_OUTPUT_FORMATS.includes(value)) {
        return fail(INVALID_FORMAT, `Invalid output format. Must be ${joinOr(FIT_OUTPUT_FORMATS)}.`);
    }

    return { ok: true, value };
}

/**
 * The byte ceiling, on the same bounds /compress uses. A form asking for less
 * than the floor of that range is asking for something no encoder in this build
 * can produce from a photograph, and saying so at parse time is cheaper and
 * clearer than eight encodes ending in a refusal.
 */
function parseMaximumBytes(raw) {
    if (isAbsent(raw)) return { ok: true, value: null };

    const parsed = parseTargetBytes(raw);
    if (!parsed.ok) return fail(INVALID_REQUIREMENTS, parsed.error);

    return { ok: true, value: parsed.value };
}

/**
 * The byte FLOOR, which is deliberately NOT held to the ceiling's lower bound.
 * "At least 20 KB" is a real thing a form says, and refusing it because the
 * exact-size search would not aim that low would be a refusal about the wrong
 * feature.
 */
function parseMinimumBytes(raw) {
    if (isAbsent(raw)) return { ok: true, value: null };

    const parsed = parseTargetBytes(raw, { min: 1, max: MAX_TARGET_BYTES });
    if (!parsed.ok) {
        return fail(
            INVALID_REQUIREMENTS,
            `The minimum file size must be a whole number of bytes, up to ${bytesToKb(MAX_TARGET_BYTES)} KB.`,
        );
    }

    return { ok: true, value: parsed.value };
}

function parseMinimumQuality(raw) {
    if (isAbsent(raw)) return { ok: true, value: FIT_MIN_QUALITY };

    const parsed = parsePositiveInt(raw, { min: 1, max: 100 });
    if (!parsed.ok) {
        return fail(INVALID_REQUIREMENTS, 'The lowest quality must be a whole number between 1 and 100.');
    }

    return { ok: true, value: parsed.value };
}

function parseRequiredDpi(raw, format) {
    if (isAbsent(raw)) return { ok: true, value: null };

    const parsed = parsePositiveInt(raw, { min: MIN_DPI, max: MAX_DPI });
    if (!parsed.ok) {
        return fail(
            INVALID_REQUIREMENTS,
            `The resolution must be a whole number between ${MIN_DPI} and ${MAX_DPI} DPI.`,
        );
    }

    // WebP has no density field in its container at all, so writeResolution
    // refuses it. Refusing here instead means the visitor is told before the
    // work rather than after it, and told the actual choice they have.
    if (format === 'webp') {
        return fail(
            INVALID_REQUIREMENTS,
            'WebP files cannot store a DPI record. Choose JPG or PNG, or leave the DPI blank.',
        );
    }

    return { ok: true, value: parsed.value };
}

/**
 * Every option a `fit` job takes, read strictly and once.
 *
 * The values arrive as raw form strings, exactly as they were typed, because
 * the strict parsers need to see '' and '10.9' and 'abc' as they came to tell
 * "not supplied" apart from "supplied and wrong".
 *
 * @param {object} options
 * @returns {{ ok: true, requirement: object }|{ ok: false, error: string, code: string }}
 */
export function parseRequirements(options = {}) {
    const width = parseDimension(options.width, 'width');
    if (!width.ok) return width;

    const height = parseDimension(options.height, 'height');
    if (!height.ok) return height;

    if (!withinPixelBudget(width.value, height.value)) {
        return fail(
            INVALID_DIMENSIONS,
            `${describeDimensions(width.value, height.value)} is more than one browser tab can hold. Ask for a smaller picture.`,
        );
    }

    const geometry = parseGeometry(options.geometry);
    if (!geometry.ok) return geometry;

    const format = parseFormat(options.format);
    if (!format.ok) return format;

    const maxBytes = parseMaximumBytes(options.targetBytes);
    if (!maxBytes.ok) return maxBytes;

    const minBytes = parseMinimumBytes(options.minBytes);
    if (!minBytes.ok) return minBytes;

    if (maxBytes.value !== null && minBytes.value !== null && minBytes.value >= maxBytes.value) {
        return fail(
            INVALID_REQUIREMENTS,
            'The minimum file size must be smaller than the maximum.',
        );
    }

    const minQuality = parseMinimumQuality(options.minQuality);
    if (!minQuality.ok) return minQuality;

    const dpi = parseRequiredDpi(options.dpi, format.value);
    if (!dpi.ok) return dpi;

    const background = isAbsent(options.background) ? DEFAULT_FIT_BACKGROUND : String(options.background).trim();
    const colour = parseBackground(background);

    return {
        ok: true,
        requirement: {
            width: width.value,
            height: height.value,
            geometry: geometry.value,
            format: format.value,
            background: { r: colour.r, g: colour.g, b: colour.b, value: background },
            maxBytes: maxBytes.value,
            minBytes: minBytes.value,
            minQuality: minQuality.value,
            dpi: dpi.value,
            transparency: formatKeepsAlpha(format.value) ? 'kept' : 'removed',
        },
    };
}

/* -------------------------------------------------------------- geometry */

/**
 * How a source of one shape reaches a box of another, as three integers-only
 * instructions: what to resample to, what to trim off it, and where to sit it
 * on the canvas.
 *
 * Exactly one of `trim` and `pad` is ever non-null, and both are null for a
 * stretch and for the case where the source already has the box's shape. The
 * caller runs them in that order — resample, then trim or pad — and nothing
 * else, which is why this returns instructions rather than doing the work: the
 * memory gate has to be told the resampled size BEFORE the surface exists.
 *
 * @returns {{ ok: true, resampleTo: {width, height}, trim: object|null, pad: {x, y}|null }
 *          |{ ok: false, error: string }}
 */
export function fitGeometry({ sourceWidth, sourceHeight, width, height, geometry = DEFAULT_GEOMETRY } = {}) {
    const usable = (value) => Number.isFinite(value) && value > 0;

    if (!usable(sourceWidth) || !usable(sourceHeight) || !usable(width) || !usable(height)) {
        return { ok: false, error: 'Unable to determine the source image dimensions.' };
    }

    if (geometry === 'stretch') {
        return { ok: true, resampleTo: { width, height }, trim: null, pad: null };
    }

    if (geometry === 'contain') {
        // Which side of the box the source runs out of first, by integer
        // cross-product rather than a float division — the same test
        // centeredRectForRatio and signatureTargetSize use. The binding side is
        // held exactly and the other is derived off the source's own ratio.
        const bindsOnWidth = sourceWidth * height >= width * sourceHeight;
        const inside = targetDimensions(sourceWidth, sourceHeight, bindsOnWidth ? { width } : { height });
        if (!inside.ok) return inside;

        // The derived side can round one pixel past the box on a source whose
        // ratio is very close to the box's. Clamping keeps padImageData's
        // "larger than its canvas" assertion an assertion about bugs rather
        // than about rounding.
        const resampleTo = {
            width: Math.min(width, inside.width),
            height: Math.min(height, inside.height),
        };

        return {
            ok: true,
            resampleTo,
            trim: null,
            pad: {
                x: Math.floor((width - resampleTo.width) / 2),
                y: Math.floor((height - resampleTo.height) / 2),
            },
        };
    }

    const cover = coverDimensions(sourceWidth, sourceHeight, width, height);
    const trim = (cover.width === width && cover.height === height)
        ? null
        : centreCropRect(cover.width, cover.height, width, height);

    return { ok: true, resampleTo: cover, trim, pad: null };
}

/* ------------------------------------------------- reading a file's header */

/**
 * The independent reading validateOutput checks the pipeline against.
 *
 * It lives in its own leaf module because of what importing it USED to cost:
 * this file statically reaches encode, resize, flatten and target-bytes, and
 * through them capability and codecs, so a page that only wanted a file's
 * declared width downloaded the whole pixel engine to get it. Re-exported here
 * so every caller that already imports it from this module is unchanged.
 *
 * Re-exported from the imported binding rather than with `export ... from`,
 * because that form creates no local name and validateOutput below calls it.
 */
export { readImageSize };

/**
 * Kept local rather than imported from the leaf: validateOutput needs the same
 * adapter, and exporting a five-line input coercion so one caller can share it
 * would make it look like an interface.
 */
function toBytes(input) {
    if (input instanceof Uint8Array) return input;
    if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
    if (input instanceof ArrayBuffer) return new Uint8Array(input);
    return null;
}

/* ------------------------------------------------------------- validating */

function check(key, label, required, actual, ok) {
    return { key, label, required, actual, ok };
}

function dimensionsCheck(size, requirement) {
    return check(
        'dimensions',
        'Dimensions',
        describeDimensions(requirement.width, requirement.height),
        size ? describeDimensions(size.width, size.height) : UNKNOWN,
        Boolean(size) && size.width === requirement.width && size.height === requirement.height,
    );
}

function formatCheck(bytes, requirement) {
    const sniffed = sniffImageType(bytes);

    return check(
        'format',
        'Format',
        formatLabel(requirement.format),
        sniffed ? formatLabel(sniffed) : UNKNOWN,
        sniffed === requirement.format,
    );
}

function maxBytesCheck(length, requirement) {
    if (requirement.maxBytes === null) {
        return check('maxBytes', 'Maximum file size', NOT_REQUIRED, describeBytes(length), null);
    }

    return check(
        'maxBytes',
        'Maximum file size',
        `${describeBytes(requirement.maxBytes)} or less`,
        describeBytes(length),
        length <= requirement.maxBytes,
    );
}

function minBytesCheck(length, requirement) {
    if (requirement.minBytes === null) {
        return check('minBytes', 'Minimum file size', NOT_REQUIRED, describeBytes(length), null);
    }

    return check(
        'minBytes',
        'Minimum file size',
        `${describeBytes(requirement.minBytes)} or more`,
        describeBytes(length),
        length >= requirement.minBytes,
    );
}

/**
 * The density the finished file states, read through the same walker
 * /change-image-dpi reads with.
 *
 * readResolution refuses a format that has no density field by throwing, and
 * "this container cannot state one" is a perfectly good ANSWER for a report
 * whose job is to say what is there — so the throw is caught and becomes
 * "None recorded" rather than taking the whole report down.
 */
function dpiCheck(bytes, requirement, dpiRead) {
    let reading = null;
    try {
        reading = dpiRead(bytes);
    } catch {
        reading = null;
    }

    const actual = reading?.dpi ? `${reading.dpi.x} DPI` : 'None recorded';

    if (requirement.dpi === null) {
        return check('dpi', 'Resolution', NOT_REQUIRED, actual, null);
    }

    return check(
        'dpi',
        'Resolution',
        `${requirement.dpi} DPI`,
        actual,
        Boolean(reading?.dpi) && reading.dpi.x === requirement.dpi && reading.dpi.y === requirement.dpi,
    );
}

/**
 * Transparency is only ever CHECKABLE in one direction.
 *
 * "Removed" is a real assertion about the bytes: a file that still declares an
 * alpha channel when the requirement said the format could not carry one means
 * the format fell back somewhere, and that is worth catching. "Kept" is not the
 * mirror of it — an opaque source encoded to WebP comes out as a simple lossy
 * VP8 with no alpha flag, and nothing about that is wrong. So the kept row
 * reports what is in the file and passes, rather than inventing a failure for
 * pictures that had no transparency to begin with.
 */
function transparencyCheck(size, requirement) {
    const actual = size === null
        ? UNKNOWN
        : (size.hasAlpha ? 'Alpha channel present' : 'No alpha channel');

    if (requirement.transparency === 'removed') {
        return check('transparency', 'Transparency', 'Removed', actual, size !== null && size.hasAlpha === false);
    }

    return check('transparency', 'Transparency', 'Kept where the format allows', actual, true);
}

/**
 * What the finished file actually is, measured against what was asked for.
 *
 * Six rows, always, in this order, so a panel can render them without knowing
 * which requirements a preset happens to set: a row whose requirement was not
 * asked for still reports what the file holds, with `ok` null and `required`
 * reading 'Not required'.
 *
 * `verified` is true only when every row that WAS asked for passed. A report
 * with no applicable rows is verified, because nothing was claimed.
 *
 * @param {Uint8Array|ArrayBuffer} input   the finished file, untouched
 * @param {object} requirement             from parseRequirements
 * @param {{ dpiRead?: function }} [seams] readResolution, swappable for tests
 * @returns {{ verified: boolean, checks: Array<{key, label, required, actual, ok}> }}
 */
export function validateOutput(input, requirement, { dpiRead = readResolution } = {}) {
    const bytes = toBytes(input);
    const length = bytes ? bytes.byteLength : 0;
    const size = readImageSize(bytes);

    const checks = [
        dimensionsCheck(size, requirement),
        formatCheck(bytes, requirement),
        maxBytesCheck(length, requirement),
        minBytesCheck(length, requirement),
        dpiCheck(bytes, requirement, dpiRead),
        transparencyCheck(size, requirement),
    ];

    return {
        verified: checks.every((row) => row.ok !== false),
        checks,
    };
}
