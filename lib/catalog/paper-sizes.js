/**
 * Paper sizes — the sheet a print layout is laid out on.
 *
 * Four entries: the two photo-lab sheets a print kiosk takes, and the two
 * office papers a home printer already has loaded. They are the options in the
 * paper select on /passport-photo-print, and each one exists because somebody
 * can actually print on it, not because it rounds out a list.
 *
 * WHY THE MILLIMETRES ARE DERIVED AND NEVER TYPED
 *
 * A 4 × 6 photo sheet is four inches by six, and six inches is 152.4 mm
 * exactly. An entry that stated "152" beside "6 in" would be a tenth of a
 * millimetre short, which is one pixel at 300 DPI on every sheet laid out on
 * it — and the layout would then centre a block of photos inside a paper it
 * had described slightly wrong. So the width and the height are stored in the
 * unit the size is named in, and both millimetre figures come out of
 * lib/format/physical.js `toMillimetres`. It is the same lesson
 * lib/catalog/application-presets/ took from "2 x 2 inches (51 x 51 mm)": the
 * arithmetic runs on the stated unit, and no second copy of the number is
 * allowed to drift away from it.
 *
 * The conversion is rounded to four decimal places, a ten-thousandth of a
 * millimetre. That is not a tolerance on the paper — no sheet is cut that
 * finely — it is there so 6 × 25.4 stores as 152.4 rather than as
 * 152.39999999999998, which is what binary floating point makes of it and what
 * a page would otherwise print. lib/catalog/validate.js `validatePaperSizes`
 * holds every entry to its own conversion, so a hand-edited figure fails the
 * build rather than shipping.
 *
 * Every entry is stored portrait — the height is the longer side. Which way a
 * sheet is fed is the layout's decision, made from how many photos fit each
 * way round, and a registry that pre-rotated one of these would take that
 * decision away from it.
 *
 * THIS FILE IS A LEAF ON PURPOSE. The print sheet's panel is a client
 * component and reads this list directly rather than through @/lib/catalog, so
 * it must stay small and must never pull the barrel — see CLAUDE.md rule 6.
 * It reads lib/format/physical.js for the one conversion and nothing else.
 */
import { toMillimetres } from '@/lib/format/physical';

/** Four decimal places: enough to keep 152.4 from becoming 152.39999999999998. */
const MM_PRECISION = 1e4;

/**
 * A length in the unit it was named in, as the millimetres this registry
 * stores. Exported because lib/catalog/validate.js holds every entry to it —
 * one definition of how finely paper is measured here, checked in one place.
 */
export function paperMillimetres(value, unit) {
    return Math.round(toMillimetres(value, unit) * MM_PRECISION) / MM_PRECISION;
}

function paper(id, label, width, height, unit) {
    return {
        id,
        label,
        width,
        height,
        unit,
        widthMm: paperMillimetres(width, unit),
        heightMm: paperMillimetres(height, unit),
    };
}

export const PAPER_SIZES = [
    // The photo-lab standard, and the one a 2 × 2 in or 35 × 45 mm photo is
    // usually printed on: six 35 × 45 mm passport photos fit a single sheet at the default margins, and six 2 × 2 in photos only when it is printed borderless.
    paper('4x6', '4 × 6 in', 4, 6, 'in'),
    paper('5x7', '5 × 7 in', 5, 7, 'in'),
    // The two office sizes, for a printer that has no photo paper in it. Both
    // are named the way a print dialog names them, so the option on the page
    // and the option in the dialog read as the same thing.
    paper('letter', 'Letter (8.5 × 11 in)', 8.5, 11, 'in'),
    paper('a4', 'A4 (210 × 297 mm)', 210, 297, 'mm'),
];

export function paperSize(id) {
    return PAPER_SIZES.find((entry) => entry.id === id) ?? null;
}
