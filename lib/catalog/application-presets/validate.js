/**
 * The gate on the government presets.
 *
 * lib/catalog/presets.js validates the platform sizes and this is deliberately
 * stricter in three places, because the two registries carry different risk:
 *
 *   1. `source: null` is refused. An Instagram size with no citation is an
 *      honest convention; a passport size with no citation is a guess, and a
 *      guess is what somebody's application would be judged against.
 *   2. A physical size is held to its own unit. "2 inches" and "51 mm" cannot
 *      both be exact — the difference is two pixels at 300 DPI — so the stated
 *      number, its unit and the millimetre conversion are checked against each
 *      other rather than being trusted as three independent facts.
 *   3. A declared aspect ratio is checked against the dimensions beside it, and
 *      a physical size against a pixel minimum where an entry has both. Two
 *      shapes on one entry is a page rendering two different truths.
 *
 * What no validator can check is whether the authority still says this, which
 * is why `staleApplicationPresets` exists: it measures the age of each citation
 * against a clock the caller supplies, so a preset nobody has re-read in a year
 * is a reportable fact rather than a comment somebody has to remember to act on.
 *
 * Problems come back as [{ code, subject, message }] — the same shape
 * lib/catalog/validate.js returns, which is what lets it concatenate the two.
 */
import { toMillimetres } from '@/lib/format/physical';
import { APPLICATION_PRESETS } from './index';
import {
    ALLOWED_OUTPUT_FORMATS,
    MAX_DIMENSION,
    MAX_DPI,
    MAX_TARGET_BYTES,
    MIN_DPI,
    MIN_TARGET_BYTES,
} from '@/lib/limits';

/** The units an authority publishes a photograph size in. */
export const PHYSICAL_UNITS = ['mm', 'cm', 'in'];

/**
 * The checks lib/image-client/requirements.js `validateOutput` can actually
 * run on a finished file. An entry may only claim to enforce one of these:
 * anything else is a promise with nothing behind it.
 */
export const APPLICATION_CHECKS = ['dimensions', 'format', 'maxBytes', 'minBytes', 'dpi', 'transparency'];

/**
 * What Resizo fills, as a value rather than a sentence.
 *
 * There is one entry and that is the point: this build flattens transparency
 * and pads with a colour, and it does not touch the space behind a person. A
 * second value belongs here the day something can genuinely replace a
 * background — not before, and never so that a preset can imply it.
 */
export const BACKGROUND_BEHAVIOURS = ['transparent-only'];

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const todayUtc = () => new Date().toISOString().slice(0, 10);

const isText = (value) => typeof value === 'string' && value.trim() !== '';

const isTextList = (value) => Array.isArray(value) && value.every(isText);

const isSize = (value) => Number.isFinite(value) && value > 0;

const isPixels = (value) => Number.isSafeInteger(value) && value > 0 && value <= MAX_DIMENSION;

/** Two proportions are the same shape when they cross-multiply to the same number. */
function sameShape(width, height, otherWidth, otherHeight) {
    const left = width * otherHeight;
    const right = height * otherWidth;
    return Math.abs(left - right) <= 1e-9 * Math.max(Math.abs(left), Math.abs(right), 1);
}

function sourceProblem(source) {
    if (source === null || source === undefined) {
        return 'a government requirement needs the authority’s own page as its source — null is not an option here';
    }
    if (typeof source !== 'object') return 'a source must be an object';
    if (typeof source.url !== 'string' || !/^https:\/\/\S+$/.test(source.url)) return 'a source needs an https url';
    if (!isText(source.label)) return 'a source needs a label naming the page it came from';
    if (!ISO_DATE.test(source.verifiedAt ?? '') || source.verifiedAt > todayUtc()) {
        return 'a source needs a verifiedAt calendar date that has already happened';
    }
    return null;
}

/** The physical block, or a sentence saying how it is wrong. */
function physicalProblems(physical) {
    const problems = [];

    if (!isSize(physical.width) || !isSize(physical.height)) {
        problems.push(['app-preset-dimensions-invalid', 'a physical size needs a width and a height above zero']);
    }
    if (!isSize(physical.widthMm) || !isSize(physical.heightMm)) {
        problems.push(['app-preset-dimensions-invalid', 'a physical size needs widthMm and heightMm above zero']);
    }
    if (!isText(physical.statedAs)) {
        problems.push(['app-preset-fields-missing', 'a physical size needs statedAs — the authority’s own sentence']);
    }

    if (!PHYSICAL_UNITS.includes(physical.unit)) {
        problems.push([
            'app-preset-unit-invalid',
            `a physical size is published in ${PHYSICAL_UNITS.join(', ')}, not ${JSON.stringify(physical.unit)}`,
        ]);
        return problems;
    }

    if (problems.some(([code]) => code === 'app-preset-dimensions-invalid')) return problems;

    for (const [side, mm] of [['width', 'widthMm'], ['height', 'heightMm']]) {
        const converted = toMillimetres(physical[side], physical.unit);
        if (Math.abs(converted - physical[mm]) > 1e-6 * Math.max(converted, 1)) {
            problems.push([
                'app-preset-unit-invalid',
                `${physical[side]} ${physical.unit} is ${converted} mm, but ${mm} says ${physical[mm]} — `
                    + 'one of the two is a rounding, and the arithmetic runs on the stated unit',
            ]);
        }
    }

    return problems;
}

function digitalProblems(digital) {
    const problems = [];

    for (const side of ['minWidth', 'minHeight']) {
        if (!isPixels(digital[side])) {
            problems.push([
                'app-preset-dimensions-invalid',
                `${side} of ${JSON.stringify(digital[side])} is not a whole number of pixels from 1 to ${MAX_DIMENSION}`,
            ]);
        }
    }

    for (const [side, floor] of [['maxWidth', 'minWidth'], ['maxHeight', 'minHeight']]) {
        const value = digital[side];
        if (value === null || value === undefined) continue;
        if (!isPixels(value) || value < digital[floor]) {
            problems.push([
                'app-preset-dimensions-invalid',
                `${side} of ${JSON.stringify(value)} is not a whole number of pixels at or above ${floor}`,
            ]);
        }
    }

    return problems;
}

function bytesProblems(bytes) {
    if (!bytes || typeof bytes !== 'object') return [['app-preset-fields-missing', 'bytes must be a { min, max } window']];

    const problems = [];

    for (const side of ['min', 'max']) {
        const value = bytes[side];
        if (value === null) continue;
        if (!Number.isSafeInteger(value) || value < MIN_TARGET_BYTES || value > MAX_TARGET_BYTES) {
            problems.push([
                'app-preset-fields-missing',
                `bytes.${side} of ${JSON.stringify(value)} is outside the ${MIN_TARGET_BYTES}–${MAX_TARGET_BYTES} byte range the compressor works in`,
            ]);
        }
    }

    if (bytes.min !== null && bytes.max !== null && problems.length === 0 && bytes.min >= bytes.max) {
        problems.push(['app-preset-fields-missing', `bytes.min ${bytes.min} is not below bytes.max ${bytes.max}`]);
    }

    return problems;
}

/**
 * The DPI block. None of the four authorities publishes a resolution, so
 * `required` is false everywhere today — but a print preset still needs a
 * default, because that is the number a physical size is converted at and the
 * page shows the arithmetic for. A digital preset must NOT carry one: the
 * authority stated pixels, and writing a print-size record it never asked for
 * would be a number Resizo invented.
 */
function dpiProblems(dpi, use) {
    if (!dpi || typeof dpi !== 'object') return [['app-preset-fields-missing', 'dpi must be a { required, default } block']];

    const problems = [];

    if (typeof dpi.required !== 'boolean') {
        problems.push(['app-preset-fields-missing', 'dpi.required must say whether the authority states a resolution']);
    }

    if (use === 'print') {
        if (!Number.isSafeInteger(dpi.default) || dpi.default < MIN_DPI || dpi.default > MAX_DPI) {
            problems.push([
                'app-preset-fields-missing',
                `a printed size is converted at dpi.default, which must be a whole number from ${MIN_DPI} to ${MAX_DPI}`,
            ]);
        }
    } else if (dpi.default !== null) {
        problems.push([
            'app-preset-fields-missing',
            'a digital preset publishes pixels, so dpi.default must be null rather than a resolution nobody asked for',
        ]);
    }

    return problems;
}

/**
 * Every way an application preset can be wrong about itself.
 *
 * @param {Array} [presets]  defaults to the shipped registry
 * @returns {Array<{ code: string, subject: string, message: string }>}
 */
export function validateApplicationPresets(presets = APPLICATION_PRESETS) {
    const problems = [];
    const seen = new Set();

    for (const preset of presets) {
        const subject = preset?.id ?? '(unnamed preset)';
        const problem = (code, message) => problems.push({ code, subject, message: `preset "${subject}": ${message}` });

        if (!preset || typeof preset !== 'object') {
            problems.push({ code: 'app-preset-malformed', subject, message: 'an application preset must be an object' });
            continue;
        }

        if (!isText(preset.id)) problem('app-preset-fields-missing', 'an application preset needs an id');
        if (seen.has(preset.id)) problem('app-preset-id-duplicate', 'this id is declared more than once');
        seen.add(preset.id);

        for (const field of ['jurisdiction', 'authority', 'name']) {
            if (!isText(preset[field])) problem('app-preset-fields-missing', `it states no ${field}`);
        }

        if (preset.use !== 'print' && preset.use !== 'digital') {
            problem('app-preset-fields-missing', `use is ${JSON.stringify(preset.use)}; it must be "print" or "digital"`);
        }

        if (!Array.isArray(preset.formats) || preset.formats.length === 0
            || !preset.formats.every((format) => ALLOWED_OUTPUT_FORMATS.includes(format))) {
            problem('app-preset-fields-missing', `formats must be a non-empty list of ${ALLOWED_OUTPUT_FORMATS.join(', ')}`);
        }

        if (typeof preset.formatsStated !== 'boolean') {
            problem('app-preset-fields-missing', 'formatsStated must say whether the authority named a file format at all');
        }

        if (!Array.isArray(preset.enforces) || preset.enforces.length === 0
            || !preset.enforces.every((check) => APPLICATION_CHECKS.includes(check))) {
            problem('app-preset-fields-missing', `enforces must be a non-empty list of ${APPLICATION_CHECKS.join(', ')}`);
        }

        if (!isTextList(preset.cannotVerify) || preset.cannotVerify.length === 0) {
            problem('app-preset-fields-missing', 'it lists nothing it cannot verify — every one of these authorities asks for something no software can see');
        }

        if (!isTextList(preset.notes)) {
            problem('app-preset-fields-missing', 'notes must be a list of the authority’s own sentences');
        }

        if (!preset.background || typeof preset.background !== 'object' || !isText(preset.background.stated)) {
            problem('app-preset-fields-missing', 'background must state what the authority asks for');
        } else if (!BACKGROUND_BEHAVIOURS.includes(preset.background.resizoSets)) {
            problem(
                'app-preset-fields-missing',
                `background.resizoSets is ${JSON.stringify(preset.background.resizoSets)}; Resizo fills transparent areas and padding and nothing else`,
            );
        }

        if (preset.head !== null && preset.head !== undefined) {
            const { minMm, maxMm, statedAs } = preset.head;
            if (!isSize(minMm) || !isSize(maxMm) || maxMm < minMm || !isText(statedAs)) {
                problem('app-preset-fields-missing', 'head must be null, or a { minMm, maxMm, statedAs } band the authority published');
            }
        }

        for (const [code, message] of bytesProblems(preset.bytes)) problem(code, message);
        for (const [code, message] of dpiProblems(preset.dpi, preset.use)) problem(code, message);

        if (!Object.hasOwn(preset, 'source')) {
            problem('app-preset-source-invalid', 'it declares no source — cite the authority’s own page');
        } else {
            const reason = sourceProblem(preset.source);
            if (reason) problem('app-preset-source-invalid', reason);
        }

        /* -------------------------------------------------------------- *
         * The dimensions, and the one shape they all have to agree on
         * -------------------------------------------------------------- */

        const physical = preset.physical ?? null;
        const digital = preset.digital ?? null;

        if (!physical && !digital) {
            problem('app-preset-dimensions-invalid', 'it states neither a physical size nor a published pixel minimum');
        }

        const physicalFaults = physical ? physicalProblems(physical) : [];
        const digitalFaults = digital ? digitalProblems(digital) : [];
        for (const [code, message] of [...physicalFaults, ...digitalFaults]) problem(code, message);

        const aspect = preset.aspect;
        const aspectStated = Array.isArray(aspect) && aspect.length === 2
            && aspect.every((side) => Number.isSafeInteger(side) && side > 0);
        if (!aspectStated) {
            problem('app-preset-dimensions-invalid', 'aspect must be [width, height] as two whole numbers above zero');
        }

        const physicalUsable = physical && physicalFaults.length === 0;
        const digitalUsable = digital && digitalFaults.length === 0;

        if (aspectStated && physicalUsable && !sameShape(physical.widthMm, physical.heightMm, aspect[0], aspect[1])) {
            problem(
                'app-preset-contradiction',
                `it is ${physical.widthMm} × ${physical.heightMm} mm but declares an aspect of ${aspect[0]}:${aspect[1]}`,
            );
        }

        if (aspectStated && digitalUsable && !sameShape(digital.minWidth, digital.minHeight, aspect[0], aspect[1])) {
            problem(
                'app-preset-contradiction',
                `its published minimum is ${digital.minWidth} × ${digital.minHeight} px but it declares an aspect of ${aspect[0]}:${aspect[1]}`,
            );
        }

        if (physicalUsable && digitalUsable
            && !sameShape(physical.widthMm, physical.heightMm, digital.minWidth, digital.minHeight)) {
            problem(
                'app-preset-contradiction',
                `its printed size is a different shape from its pixel minimum (${physical.widthMm} × ${physical.heightMm} mm against ${digital.minWidth} × ${digital.minHeight} px)`,
            );
        }

        /* -------------------------------------------------------------- *
         * A check it claims to enforce has to have something behind it
         * -------------------------------------------------------------- */

        const enforces = Array.isArray(preset.enforces) ? preset.enforces : [];
        const bytes = preset.bytes ?? {};

        if (enforces.includes('maxBytes') && typeof bytes.max !== 'number') {
            problem('app-preset-contradiction', 'it claims to enforce a maximum file size and states none');
        }
        if (enforces.includes('minBytes') && typeof bytes.min !== 'number') {
            problem('app-preset-contradiction', 'it claims to enforce a minimum file size and states none');
        }
        if (enforces.includes('dpi') && preset.use !== 'print') {
            problem('app-preset-contradiction', 'it claims to enforce a DPI record and is not a printed photograph');
        }
    }

    return problems;
}

/** Whole months from a YYYY-MM-DD calendar day to an instant, both read in UTC. */
function monthsSince(iso, now) {
    const [year, month, day] = iso.split('-').map(Number);
    const months = (now.getUTCFullYear() - year) * 12 + (now.getUTCMonth() + 1 - month);
    return now.getUTCDate() < day ? months - 1 : months;
}

/**
 * How long ago each citation was read, for the entries that are getting old.
 *
 * A validator cannot know whether HM Passport Office still says 45 by 35
 * millimetres. What it can know is that nobody has looked in fourteen months,
 * which is the fact worth surfacing — so this returns a report rather than a
 * pass or a fail, and the clock is an argument so the report itself is
 * provable rather than being true only on the day it is run.
 *
 * @param {Array} [presets]
 * @param {object} [options]
 * @param {Date} [options.now]
 * @param {number} [options.warnAfterMonths]  6 — worth re-reading
 * @param {number} [options.failAfterMonths]  12 — no longer worth trusting
 * @returns {Array<{ id: string, verifiedAt: string, ageMonths: number, level: 'warn'|'fail' }>}
 */
export function staleApplicationPresets(
    presets = APPLICATION_PRESETS,
    { now = new Date(), warnAfterMonths = 6, failAfterMonths = 12 } = {},
) {
    const report = [];

    for (const preset of presets) {
        const verifiedAt = preset?.source?.verifiedAt;
        if (!ISO_DATE.test(verifiedAt ?? '')) continue;

        const ageMonths = monthsSince(verifiedAt, now);
        const level = ageMonths >= failAfterMonths ? 'fail' : ageMonths >= warnAfterMonths ? 'warn' : null;
        if (level) report.push({ id: preset.id, verifiedAt, ageMonths, level });
    }

    return report;
}
