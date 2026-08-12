/**
 * What /convert says out loud about formats, derived from the registry.
 *
 * This file exists because of a specific failure mode. The page used to carry
 * hand-written sentences — "JPEG, PNG, WebP or AVIF", "any of the four", "the
 * smallest of the four" — in the intro, the metadata description, four FAQ
 * answers, a comparison table and a whole content section. AVIF then left
 * lib/constants.js in both directions, and every one of those sentences was
 * still advertising a conversion the tool refuses. Prose cannot be kept in sync
 * with a registry by remembering to; it has to be generated from it.
 *
 * So nothing on this page names a format in prose. The page asks here, and here
 * asks lib/constants.js. A format added to or removed from CONVERT_INPUT_FORMATS
 * or CONVERT_OUTPUT_FORMATS changes the page with it, and a format that is not
 * in either list has no way to appear on it — which is what
 * tests/app/convert-formats.test.js checks by reading this route's source.
 *
 * The one thing that cannot be derived is what each format IS. Those facts live
 * in FORMAT_FACTS below, keyed by the same registry key, and a key with no facts
 * is a build-time error rather than a silently missing table row.
 */
import { CONVERT_INPUT_FORMATS, CONVERT_OUTPUT_FORMATS } from '@/lib/constants';
import { formatLabel, formatProse } from '@/lib/hooks/upload-helpers';

/**
 * Per-format facts, as properties rather than as sentences: the table cells and
 * the FAQ answers are both written from these, so the two can never disagree
 * about whether WebP keeps transparency.
 */
export const FORMAT_FACTS = {
    jpeg: {
        alpha: false,
        lossless: false,
        size: 'Small',
        best: 'Photographs, and anything an upload form insists on',
    },
    png: {
        alpha: true,
        lossless: true,
        size: 'Large for photos',
        best: 'Logos, icons, screenshots, flat graphics',
    },
    webp: {
        alpha: true,
        lossless: 'either',
        size: '25–35% under JPEG',
        best: 'Anything on a website today',
    },
};

/** Every format this tool touches, in registry order, without duplicates. */
export function convertFormats() {
    return Array.from(new Set([...CONVERT_INPUT_FORMATS, ...CONVERT_OUTPUT_FORMATS]));
}

function factsFor(format) {
    const facts = FORMAT_FACTS[format];
    if (!facts) {
        throw new Error(`No copy facts for the ${format} format. Add them to app/(tools)/convert/formats.js.`);
    }
    return facts;
}

/**
 * ['jpeg','png','webp'] -> 'JPEG, PNG and WebP'. The joiner itself lives in
 * lib/hooks/upload-helpers.js, so the sentences on this page and the ones
 * /api/convert puts in an error are built by the same code.
 */
export const formatsProse = formatProse;

/** The formats a file may be dropped as, as prose. */
export function inputFormatsProse(conjunction = 'and') {
    return formatProse(CONVERT_INPUT_FORMATS, conjunction);
}

/** The formats a file may come back as, as prose. */
export function outputFormatsProse(conjunction = 'and') {
    return formatProse(CONVERT_OUTPUT_FORMATS, conjunction);
}

/** The output formats that keep an alpha channel, as prose. */
export function alphaFormatsProse(conjunction = 'and') {
    return formatProse(CONVERT_OUTPUT_FORMATS.filter((format) => factsFor(format).alpha), conjunction);
}

/** The output formats that re-encode the picture rather than storing it exactly. */
export function lossyFormatsProse(conjunction = 'or') {
    return formatProse(CONVERT_OUTPUT_FORMATS.filter((format) => factsFor(format).lossless !== true), conjunction);
}

/** The output formats that throw nothing away. */
export function losslessFormatsProse(conjunction = 'and') {
    return formatProse(CONVERT_OUTPUT_FORMATS.filter((format) => factsFor(format).lossless === true), conjunction);
}

/**
 * The comparison table, one row per format the tool can actually produce. The
 * cells are written from FORMAT_FACTS so a row cannot claim transparency the
 * FAQ denies.
 */
export function formatComparison() {
    return CONVERT_OUTPUT_FORMATS.map((format) => {
        const facts = factsFor(format);
        return {
            format,
            label: formatLabel(format),
            transparency: facts.alpha ? 'Yes' : 'No',
            compression: facts.lossless === 'either'
                ? 'Lossy or lossless'
                : (facts.lossless ? 'Lossless' : 'Lossy'),
            size: facts.size,
            best: facts.best,
        };
    });
}
