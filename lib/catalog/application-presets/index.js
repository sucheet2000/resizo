/**
 * Application presets — the requirements a government publishes.
 *
 * Four entries, each one a set of numbers an issuing authority states on its
 * own page, with the sentence it stated them in and the day somebody read it.
 * They are the chips on /passport-photo, and they are the highest-stakes copy
 * on this site: a social preset that has gone stale costs a visitor a re-crop,
 * and one of these costs them an application.
 *
 * WHAT A PRESET IS, AND WHAT IT IS NOT
 *
 * It is a set of TECHNICAL requirements — a size, an aspect, a byte window, a
 * format, a print resolution — that a browser can meet and a validator can
 * check afterwards. It is not a compliance claim. Every authority quoted below
 * also asks for things no software can see: an expression, a head that is not
 * tilted, a background free of shadows, a photograph taken recently. Those live
 * in `cannotVerify` on every entry, they are never filtered out of the page,
 * and they are the reason no entry may say "approved", "compliant" or
 * "guaranteed" anywhere.
 *
 * Two of the four go further and quote a rule that Resizo's own output may not
 * satisfy: the United States asks for "the original, unchanged photo" and India
 * refuses a photograph "in computer print". Those sentences are in `notes`
 * rather than being quietly left out, because a preset that hides the rule it
 * fails is worse than no preset.
 *
 * WHY A PHYSICAL SIZE CARRIES ITS OWN UNIT
 *
 * The State Department states "2 x 2 inches (51 x 51 mm)". Two inches is 50.8
 * millimetres, so the metric figure in that sentence is a rounding — and at
 * 300 DPI the two disagree: 600 pixels against 602. The unit the authority
 * published in is therefore stored beside the number, the arithmetic runs on
 * that, and `statedAs` carries the authority's whole sentence including the
 * rounded conversion. lib/catalog/application-presets/validate.js holds
 * `widthMm`/`heightMm` to the converted value so the two can never drift.
 *
 * THIS FILE IS A LEAF ON PURPOSE. /passport-photo's client component imports it
 * directly rather than through @/lib/catalog, so it must stay small and must
 * never pull the barrel — see CLAUDE.md rule 6. It reads lib/format/physical.js
 * for the one conversion and nothing else.
 */
import { pixelsFor } from '@/lib/format/physical';

/**
 * Every field is either a number an authority published or a sentence it wrote.
 *
 *   `use`             'print' when the authority describes a photograph on
 *                     paper, 'digital' when it describes a file being uploaded.
 *                     It decides whether a DPI record is written at all.
 *   `physical`        the size on paper, in the unit the authority used, with
 *                     the millimetre conversion beside it.
 *   `digital`         published pixel minimums, where there are any.
 *   `aspect`          the shape, reduced. Validated against both blocks above,
 *                     so a page can crop to it without re-deriving it.
 *   `head`            the published head-height band, or null where none is
 *                     published — never a number inferred from a picture.
 *   `dpi`             `required` is whether the authority states a resolution
 *                     (none of these four does), `default` is the number
 *                     Resizo converts at and shows its arithmetic for.
 *   `bytes`           the published file-size window, in bytes.
 *   `formats`         what Resizo writes, best first. `formatsStated` says
 *                     whether the authority named a file format at all — all
 *                     four of these are false, and the page says so rather
 *                     than implying JPEG was mandated.
 *   `background`      what the authority asks for, and what Resizo actually
 *                     fills: transparent areas and padding, never the space
 *                     behind a person.
 *   `enforces`        which of the output validator's checks apply here.
 *   `cannotVerify`    the photographic rules the authority also asks for, in
 *                     its own terms. Always rendered, never filtered. Written
 *                     as "eyewear" rather than the everyday word for
 *                     spectacles, which DESIGN.md's rejection clause matches as
 *                     a surface style — same requirement, and the two stay apart.
 *   `notes`           the other caveats, in the authority's own words.
 *   `source`          the authority's own page, and the day it was read.
 */
export const APPLICATION_PRESETS = [
    {
        id: 'uk-passport-digital',
        jurisdiction: 'United Kingdom',
        authority: 'HM Passport Office',
        name: 'UK passport photo (digital, 600 × 750 px)',
        use: 'digital',
        physical: null,
        // "at least 600 pixels wide and 750 pixels tall". No maximum is stated.
        digital: { minWidth: 600, minHeight: 750, maxWidth: null, maxHeight: null },
        aspect: [4, 5],
        // The page states no head height for a digital photo. It asks for the
        // head, shoulders and upper body and crops the picture itself.
        head: null,
        dpi: { required: false, default: null },
        // "at least 50KB and no more than 10MB".
        bytes: { min: 50 * 1024, max: 10 * 1024 * 1024 },
        formats: ['jpeg', 'png'],
        formatsStated: false,
        background: { stated: 'plain light-coloured background', resizoSets: 'transparent-only' },
        enforces: ['dimensions', 'format', 'maxBytes', 'minBytes'],
        cannotVerify: [
            'Facing forwards',
            'A plain expression',
            'Mouth closed',
            'Eyes open and visible',
            'No hair over eyes',
            'No eyewear unless it is necessary',
            'No head covering, apart from religious or medical exceptions',
            'No shadows',
            'No red eye',
            'Taken in the last month',
        ],
        notes: [
            'In colour.',
            'Do not crop your photo - it will be done for you.',
            'Include your head, shoulders and upper body.',
            'Unaltered by computer software.',
        ],
        source: {
            label: 'HM Passport Office, Photos for passports',
            url: 'https://www.gov.uk/photos-for-passports',
            verifiedAt: '2026-09-10',
        },
    },
    {
        id: 'uk-passport-print',
        jurisdiction: 'United Kingdom',
        authority: 'HM Passport Office',
        name: 'UK passport photo (printed 45 × 35 mm)',
        use: 'print',
        // "45 millimetres (mm) high by 35mm wide".
        physical: {
            width: 35,
            height: 45,
            unit: 'mm',
            widthMm: 35,
            heightMm: 45,
            statedAs: '45 millimetres (mm) high by 35mm wide',
        },
        digital: null,
        aspect: [7, 9],
        head: {
            minMm: 29,
            maxMm: 34,
            statedAs: 'The image of you - from the crown of your head to your chin - must be between 29mm and 34mm high',
        },
        dpi: { required: false, default: 300 },
        bytes: { min: null, max: null },
        formats: ['jpeg', 'png'],
        formatsStated: false,
        background: { stated: 'plain cream or light grey background', resizoSets: 'transparent-only' },
        enforces: ['dimensions', 'format', 'dpi'],
        cannotVerify: [
            'Facing forwards',
            'A plain expression',
            'Mouth closed',
            'Eyes open and visible',
            'No hair over eyes',
            'No eyewear unless it is necessary',
            'No head covering, apart from religious or medical exceptions',
            'No shadows',
            'No red eye',
            'Taken in the last month',
        ],
        notes: [
            'Printed to a professional standard.',
            'In colour on plain white photographic paper with no border.',
            'Unaltered by computer software.',
            'You need 2 identical printed photos if you are applying for a passport using a paper form.',
        ],
        source: {
            label: 'HM Passport Office, Photos for passports — photo requirements',
            url: 'https://www.gov.uk/photos-for-passports/photo-requirements',
            verifiedAt: '2026-09-10',
        },
    },
    {
        id: 'us-passport-print',
        jurisdiction: 'United States',
        authority: 'U.S. Department of State',
        name: 'US passport photo (printed 2 × 2 in)',
        use: 'print',
        // "The correct printed size of a passport photo is 2 x 2 inches
        // (51 x 51 mm)." Two inches is 50.8 mm exactly; the parenthesis is a
        // rounding, and the inch figure is what the arithmetic runs on.
        physical: {
            width: 2,
            height: 2,
            unit: 'in',
            widthMm: 50.8,
            heightMm: 50.8,
            statedAs: 'The correct printed size of a passport photo is 2 x 2 inches (51 x 51 mm).',
        },
        digital: null,
        aspect: [1, 1],
        head: {
            minMm: 25,
            maxMm: 35,
            statedAs: 'The size of your head in the printed photo must be between 1 -1 3/8 inches (25 - 35 mm) from the bottom of the chin to the top of the head.',
        },
        dpi: { required: false, default: 300 },
        bytes: { min: null, max: null },
        formats: ['jpeg', 'png'],
        formatsStated: false,
        background: {
            stated: 'plain white or off-white background free of shadows, textures, or objects',
            resizoSets: 'transparent-only',
        },
        enforces: ['dimensions', 'format', 'dpi'],
        cannotVerify: [
            'Eyes open and mouth closed, with no exaggerated expression',
            'Head not tilted',
            'No eyewear',
            'No hat or head covering, apart from the stated exceptions',
            'No shadows',
            'No red eye',
            'Taken in the last 6 months',
        ],
        notes: [
            'Make sure your head and shoulders are centered in the photo.',
            'Print your photo on matte or glossy photo-quality paper.',
            'Do not submit photocopies or digitally scanned photos.',
            'Submit the original, unchanged photo. Do not change your photo using computer software, phone apps or filters, or artificial intelligence.',
            'Do not stretch or compress your image to resize it.',
            'Submit 1 color photo taken in the last 6 months.',
        ],
        source: {
            label: 'U.S. Department of State, Passport Photos (Last Updated: March 24, 2026)',
            url: 'https://travel.state.gov/en/passports/apply/help/photos.html',
            verifiedAt: '2026-09-10',
        },
    },
    {
        id: 'india-passport-print',
        jurisdiction: 'India',
        authority: 'Ministry of External Affairs, Passport Seva',
        name: 'India passport photo (pasted 4.5 × 3.5 cm)',
        use: 'print',
        // "Paste your recent passport size photograph (4.5 cm length x 3.5 cm
        // width) in colour" — length is the tall side.
        physical: {
            width: 3.5,
            height: 4.5,
            unit: 'cm',
            widthMm: 35,
            heightMm: 45,
            statedAs: 'recent passport size photograph (4.5 cm length x 3.5 cm width) in colour',
        },
        digital: null,
        aspect: [7, 9],
        // The booklet publishes no head-height measurement, so none is stated.
        // "Head should be in the centre of the frame" is guidance a page may
        // draw, and it is not an official band.
        head: null,
        dpi: { required: false, default: 300 },
        bytes: { min: null, max: null },
        formats: ['jpeg', 'png'],
        formatsStated: false,
        background: {
            stated: 'plain white, and the dress should be in dark colour',
            resizoSets: 'transparent-only',
        },
        enforces: ['dimensions', 'format', 'dpi'],
        cannotVerify: [
            'Frontal view of the full face should be visible',
            'Head should be in the centre of the frame and both ears should be visible',
            'Do not paste black and white photographs',
            'Photographs cut from group photographs are not acceptable',
        ],
        notes: [
            'Photograph is NOT REQUIRED for applications submitted at Passport Seva Kendra (PSK), Post Office Passport Seva Kendra (POPSK).',
            'Photograph should be printed on good quality photo paper.',
            'Photograph in computer print will not be accepted.',
            'Dimensions of photograph should not be smaller than the box (i.e. 4.5 cm length x 3.5 cm width).',
        ],
        source: {
            label: 'Ministry of External Affairs, Passport Seva — Application Form Instruction Booklet V3.0, section B',
            url: 'https://www.passportindia.gov.in/AppOnlineProject/pdf/ApplicationformInstructionBooklet-V3.0.pdf',
            verifiedAt: '2026-09-10',
        },
    },
];

export function getApplicationPreset(id) {
    return APPLICATION_PRESETS.find((preset) => preset.id === id) ?? null;
}

/**
 * A preset as the requirement the engine's `fit` operation takes.
 *
 * A physical size becomes pixels through lib/format/physical.js — never
 * through arithmetic written here, because a preset that rounds differently
 * from the tool would print a size the output summary then calls wrong. A
 * digital preset already has its pixels published and ignores DPI entirely:
 * the authority stated a pixel count, not a print size, and inventing a
 * resolution for it would write a record nobody asked for.
 *
 * `geometry` is always 'cover'. A passport frame is a shape somebody's face
 * has to sit inside, so padding it out to fit would leave bars where the
 * authority expects a photograph.
 *
 * @param {object} preset      an entry from APPLICATION_PRESETS
 * @param {object} [options]
 * @param {number} [options.dpi]  the resolution to convert at; the preset's own
 *                                default is used when none is given
 * @returns {{ width: number, height: number, geometry: string, format: string,
 *            targetBytes: number|null, minBytes: number|null, dpi: number|null }|null}
 */
export function applicationPresetToRequirement(preset, { dpi } = {}) {
    if (!preset || typeof preset !== 'object') return null;

    const print = preset.use === 'print' && preset.physical;
    const resolution = Number.isFinite(dpi) && dpi > 0 ? dpi : (preset.dpi?.default ?? null);

    const { width, height } = print
        ? {
            width: pixelsFor(preset.physical.width, preset.physical.unit, resolution),
            height: pixelsFor(preset.physical.height, preset.physical.unit, resolution),
        }
        : { width: preset.digital?.minWidth ?? null, height: preset.digital?.minHeight ?? null };

    return {
        width,
        height,
        geometry: 'cover',
        format: preset.formats?.[0] ?? null,
        targetBytes: preset.bytes?.max ?? null,
        minBytes: preset.bytes?.min ?? null,
        dpi: print ? resolution : null,
    };
}
