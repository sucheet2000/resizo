/**
 * The Print Sheet — painting one, and checking the one that came out
 *
 * lib/format/print-sheet.js decides WHERE every photo goes. This module does
 * the two things that need pixels and bytes: it paints the paper, and it
 * reopens the finished file and says whether the sheet on it is the sheet that
 * was asked for.
 *
 * WHY A VALIDATOR AT ALL, when no other tool but /passport-photo has one.
 * Every other output on this site is judged on a screen and can be judged
 * again: a resize that came out 601 px wide can be redone in ten seconds. A
 * print sheet is judged with a ruler and a pair of scissors, after the ink is
 * dry, and the person finds out it was wrong when the photo they cut out is
 * 48 mm instead of 50. So "it did not throw" is not evidence. validateSheet
 * reads the produced bytes with header parsers that never touched the pipeline
 * — readImageSize, readResolution, sniffImageType, and pdf-lib for a document —
 * and re-checks the layout's own invariants with code that did not lay it out.
 *
 * WHAT IT CAN AND CANNOT SEE, said plainly rather than implied. From a JPEG it
 * genuinely reads back the pixel size, the resolution record and the format,
 * and the physical size of the paper falls out of the first two. From a PDF it
 * genuinely reads back the page count and the page size in points. What NEITHER
 * can tell it is how many photos are on the sheet or where they sit — that
 * would mean decoding the page and finding faces — so the copies row and the
 * photo row re-derive the geometry from the layout object with an independent
 * pass. That pass is what catches a cell off the paper, two cells on top of
 * each other and a copy count nothing backs up, which are the three failures a
 * renderer cannot see.
 *
 * A GUIDE MAY NEVER LAND ON A PHOTO. The layout already drops any mark that
 * would, but the compositor masks every guide pixel against the cells anyway.
 * Two independent guards, because a grey line through somebody's face is not a
 * cosmetic defect — it is a photo they cannot use, printed on paper they paid
 * for.
 *
 * THE PAPER IS OPAQUE WHITE, ALWAYS, the same product decision lib/image-client/
 * pad.js makes and for the same reason: a transparent sheet prints as whatever
 * the printer's default happens to be.
 *
 * Errors here are plain Errors carrying a `code`, exactly as dpi.js and pdf.js
 * do. JobError lives in operations.js, which imports this module, so importing
 * it back would close a cycle; the op wrapper rebuilds them.
 */
import { formatLabel } from '@/lib/format/upload-helpers';
import { describeSheetSize, referenceTickRange } from '@/lib/format/print-sheet';
import { isPdfSignature, sniffImageType } from '@/lib/image/magic-bytes';
import { readResolution } from '@/lib/image-client/dpi';
import { loadPdfWriter, POINTS_PER_INCH } from '@/lib/image-client/pdf';
import { readImageSize } from '@/lib/image-client/requirements';

const MM_PER_INCH = 25.4;

/**
 * The sheet's own encode quality.
 *
 * Higher than DEFAULT_QUALITY because this file exists to be printed rather
 * than looked at: JPEG ringing that is invisible at 100 % on a screen is a
 * visible halo around a head at 300 DPI on paper, and the sheet is written once
 * and thrown away rather than stored. Measured against 88 (what a PDF page
 * gets) on the 4 x 6 in six-up sheet: 92 costs about a fifth more bytes for a
 * file nobody keeps.
 */
export const SHEET_JPEG_QUALITY = 92;

/** Paper. Opaque, always — see the header. */
export const SHEET_BACKGROUND = { r: 255, g: 255, b: 255 };

/**
 * Cut guides are grey, not black: a black line beside a photo reads as part of
 * the photo when the cut is a millimetre out, and a mid grey is unmistakably a
 * mark. The measuring line IS black, because it is meant to be measured.
 */
export const GUIDE_COLOUR = { r: 90, g: 90, b: 90 };
export const REFERENCE_COLOUR = { r: 0, g: 0, b: 0 };

const UNKNOWN = 'Could not be read';

/* --------------------------------------------------------- compositing */

function insideCell(x, y, cell) {
    return x >= cell.x && x < cell.x + cell.width && y >= cell.y && y < cell.y + cell.height;
}

/**
 * Fills a rectangle, skipping every pixel that belongs to a photo.
 *
 * The mask is the second of the two guards described in the header. It is
 * cheap — a guide covers a few thousand pixels of a multi-megapixel sheet — and
 * it means a future change to the mark geometry cannot put ink on a face
 * without the layout's filter also having to agree to it.
 */
function fillMasked(canvas, { x, y, width, height }, colour, cells) {
    const left = Math.max(0, x);
    const top = Math.max(0, y);
    const right = Math.min(canvas.width, x + width);
    const bottom = Math.min(canvas.height, y + height);

    for (let row = top; row < bottom; row += 1) {
        for (let column = left; column < right; column += 1) {
            if (cells.some((cell) => insideCell(column, row, cell))) continue;
            const offset = (row * canvas.width + column) * 4;
            canvas.data[offset] = colour.r;
            canvas.data[offset + 1] = colour.g;
            canvas.data[offset + 2] = colour.b;
            canvas.data[offset + 3] = 255;
        }
    }
}

/**
 * One mark as a rectangle. A segment is always axis-aligned, and its thickness
 * grows in the positive direction — down for a horizontal line, right for a
 * vertical one — so a line drawn at a cell's outside edge stays outside it.
 */
function markRect(mark, thickness) {
    const left = Math.min(mark.x1, mark.x2);
    const right = Math.max(mark.x1, mark.x2);
    const top = Math.min(mark.y1, mark.y2);
    const bottom = Math.max(mark.y1, mark.y2);

    return right === left
        ? { x: left, y: top, width: thickness, height: bottom - top }
        : { x: left, y: top, width: right - left, height: thickness };
}

/**
 * The paper, with a copy of the photo at every cell.
 *
 * The photo must already be exactly the cell size. Resampling it here would
 * hide a geometry bug behind a plausible-looking sheet, which is the same
 * argument padImageData makes for refusing an image bigger than its canvas.
 *
 * @param {object} layout                 from layoutSheet, ok: true
 * @param {ImageData} photo               exactly layout.photo.widthPx x heightPx
 * @returns {ImageData}                   layout.paper.widthPx x heightPx, opaque
 */
export function composeSheet(layout, photo) {
    if (!layout || layout.ok !== true) {
        const error = new Error('There is no sheet layout to draw.');
        error.code = 'sheet-layout';
        throw error;
    }

    if (!photo || !photo.data || photo.width !== layout.photo.widthPx
        || photo.height !== layout.photo.heightPx) {
        const error = new Error(
            `The photo must be ${layout.photo.widthPx} × ${layout.photo.heightPx} pixels for this sheet.`,
        );
        error.code = 'sheet-photo-size';
        throw error;
    }

    const { widthPx, heightPx } = layout.paper;
    const data = new Uint8ClampedArray(widthPx * heightPx * 4);

    for (let offset = 0; offset < data.length; offset += 4) {
        data[offset] = SHEET_BACKGROUND.r;
        data[offset + 1] = SHEET_BACKGROUND.g;
        data[offset + 2] = SHEET_BACKGROUND.b;
        data[offset + 3] = 255;
    }

    const canvas = new ImageData(data, widthPx, heightPx);

    const photoStride = photo.width * 4;
    const sheetStride = widthPx * 4;

    for (const cell of layout.cells) {
        for (let row = 0; row < photo.height; row += 1) {
            const from = row * photoStride;
            data.set(
                photo.data.subarray(from, from + photoStride),
                (cell.y + row) * sheetStride + cell.x * 4,
            );
        }
    }

    const thickness = layout.guides.thicknessPx;
    for (const mark of layout.guides.marks) {
        fillMasked(canvas, markRect(mark, thickness), GUIDE_COLOUR, layout.cells);
    }

    const line = layout.reference;
    if (line) {
        const weight = thickness * 2;
        const tick = referenceTickRange(line);

        fillMasked(
            canvas,
            { x: line.x1, y: line.y1, width: line.x2 - line.x1, height: weight },
            REFERENCE_COLOUR,
            layout.cells,
        );

        for (const x of [line.x1, line.x2 - weight]) {
            fillMasked(
                canvas,
                { x, y: tick.top, width: weight, height: tick.bottom - tick.top },
                REFERENCE_COLOUR,
                layout.cells,
            );
        }
    }

    return canvas;
}

/* ---------------------------------------------------------- validating */

function toBytes(input) {
    if (input instanceof Uint8Array) return input;
    if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
    if (input instanceof ArrayBuffer) return new Uint8Array(input);
    return null;
}

function check(key, label, required, actual, ok) {
    return { key, label, required, actual, ok };
}

/** Trims a measurement to two decimals without leaving '432.00' behind. */
function trim(value) {
    return String(Number(value.toFixed(2)));
}

/**
 * The layout re-checked from scratch: the counts against each other, and every
 * cell against the paper and against every other cell.
 *
 * Deliberately NOT the code that built the cells. The whole point is that a
 * layout which produced a plausible sheet can still be wrong, and a checker
 * sharing the builder's arithmetic would agree with it by construction.
 *
 * @returns {string|null} the first problem found, in words, or null
 */
export function sheetGeometryProblem(layout) {
    if (!layout || layout.ok !== true) return 'there is no layout to check';

    const { cells, paper, photo } = layout;

    if (!Array.isArray(cells) || cells.length === 0) return 'the sheet has no photos on it';
    if (layout.capacity !== layout.columns * layout.rows) return 'the capacity is not columns × rows';
    if (layout.copies > layout.capacity) {
        return `${layout.copies} copies on a sheet that holds ${layout.capacity}`;
    }
    if (cells.length !== layout.copies) {
        return `${cells.length} photos laid out for ${layout.copies} copies`;
    }

    for (const cell of cells) {
        if (cell.width !== photo.widthPx || cell.height !== photo.heightPx) {
            return `a photo is ${cell.width} × ${cell.height} px, not ${photo.widthPx} × ${photo.heightPx} px`;
        }
        if (cell.x < 0 || cell.y < 0
            || cell.x + cell.width > paper.widthPx
            || cell.y + cell.height > paper.heightPx) {
            return 'a photo runs off the paper';
        }
    }

    for (let a = 0; a < cells.length; a += 1) {
        for (let b = a + 1; b < cells.length; b += 1) {
            const one = cells[a];
            const two = cells[b];
            const apart = one.x + one.width <= two.x
                || two.x + two.width <= one.x
                || one.y + one.height <= two.y
                || two.y + two.height <= one.y;
            if (!apart) return 'two photos overlap';
        }
    }

    return null;
}

/** '4 × 6 in, landscape' — the sheet named the way a person would name it. */
function describePaper(widthMm, heightMm) {
    const name = describeSheetSize(Math.min(widthMm, heightMm), Math.max(widthMm, heightMm));
    return `${name}, ${widthMm >= heightMm ? 'landscape' : 'portrait'}`;
}

/** The page sizes in a PDF, or null when the bytes are not a PDF at all. */
async function readPdfPages(bytes) {
    if (!isPdfSignature(bytes)) return null;

    try {
        const PDFDocument = await loadPdfWriter();
        const loaded = await PDFDocument.load(bytes, { updateMetadata: false });
        return loaded.getPages().map((page) => ({ widthPt: page.getWidth(), heightPt: page.getHeight() }));
    } catch {
        // A document that cannot be reopened reads as "cannot be read", which
        // is what the report says. It is never a throw: the validator's job is
        // to report on a file it was given no promises about.
        return null;
    }
}

function geometryRows(layout, problem) {
    const photoRequired = `${layout.summary.photo} (${layout.photo.widthPx} × ${layout.photo.heightPx} px)`;

    return [
        check('photo', 'Photo size', photoRequired, problem ?? photoRequired, problem === null),
        check(
            'copies',
            'Copies',
            String(layout.copies),
            String(Array.isArray(layout.cells) ? layout.cells.length : 0),
            problem === null,
        ),
    ];
}

function rasterChecks(bytes, layout) {
    const size = readImageSize(bytes);
    const resolution = readResolution(bytes);
    const dpi = resolution?.dpi ?? null;
    const sniffed = sniffImageType(bytes);
    const problem = sheetGeometryProblem(layout);

    const paperRequired = describePaper(layout.paper.widthMm, layout.paper.heightMm);

    // The physical size of the paper is not stored anywhere in a JPEG: it is
    // the pixel count divided by the resolution record, which is exactly what a
    // print dialog does with it. Both readings come from the file.
    let paperActual = UNKNOWN;
    let paperOk = false;
    if (size && dpi && dpi.x > 0 && dpi.y > 0) {
        const widthMm = (size.width / dpi.x) * MM_PER_INCH;
        const heightMm = (size.height / dpi.y) * MM_PER_INCH;
        const tolerance = MM_PER_INCH / Math.min(dpi.x, dpi.y);
        paperOk = Math.abs(widthMm - layout.paper.widthMm) <= tolerance
            && Math.abs(heightMm - layout.paper.heightMm) <= tolerance;
        paperActual = paperOk ? paperRequired : describePaper(widthMm, heightMm);
    }

    return [
        check('paper', 'Paper', paperRequired, paperActual, paperOk),
        check(
            'pixels',
            'Pixels',
            `${layout.paper.widthPx} × ${layout.paper.heightPx} px`,
            size ? `${size.width} × ${size.height} px` : UNKNOWN,
            Boolean(size) && size.width === layout.paper.widthPx && size.height === layout.paper.heightPx,
        ),
        check(
            'dpi',
            'Resolution',
            `${layout.dpi} DPI`,
            dpi ? `${dpi.x} DPI` : UNKNOWN,
            Boolean(dpi) && dpi.x === layout.dpi && dpi.y === layout.dpi,
        ),
        ...geometryRows(layout, problem),
        check('output', 'Output', 'JPEG', sniffed ? formatLabel(sniffed) : UNKNOWN, sniffed === 'jpeg'),
    ];
}

function pdfChecks(bytes, layout, pages) {
    const page = pages && pages.length === 1 ? pages[0] : null;
    const problem = sheetGeometryProblem(layout);

    const paperRequired = describePaper(layout.paper.widthMm, layout.paper.heightMm);
    const pointsRequired = `${trim(layout.paper.widthPt)} × ${trim(layout.paper.heightPt)} pt`;

    let paperActual = UNKNOWN;
    let paperOk = false;
    if (page) {
        const widthMm = (page.widthPt / POINTS_PER_INCH) * MM_PER_INCH;
        const heightMm = (page.heightPt / POINTS_PER_INCH) * MM_PER_INCH;
        paperOk = Math.abs(page.widthPt - layout.paper.widthPt) <= 0.01
            && Math.abs(page.heightPt - layout.paper.heightPt) <= 0.01;
        paperActual = paperOk ? paperRequired : describePaper(widthMm, heightMm);
    }

    // A PDF stores no resolution: it stores a picture and the size to draw it
    // at, so the resolution of a printed photo is its pixel count over its
    // printed width. That is the number this row reports, and it comes from the
    // layout rather than from the document, which the header says out loud.
    const printed = layout.photo.widthPx / (layout.photo.widthMm / MM_PER_INCH);

    return [
        check('paper', 'Paper', paperRequired, paperActual, paperOk),
        check(
            'pixels',
            'Page size',
            pointsRequired,
            page ? `${trim(page.widthPt)} × ${trim(page.heightPt)} pt` : UNKNOWN,
            paperOk,
        ),
        check(
            'dpi',
            'Resolution',
            `${layout.dpi} DPI`,
            `${Math.round(printed)} DPI`,
            Math.round(printed) === layout.dpi,
        ),
        ...geometryRows(layout, problem),
        check(
            'output',
            'Output',
            'PDF',
            isPdfSignature(bytes) ? 'PDF' : (sniffImageType(bytes) ? formatLabel(sniffImageType(bytes)) : UNKNOWN),
            isPdfSignature(bytes) && pages !== null && pages.length === 1,
        ),
    ];
}

/**
 * The verdict on a finished sheet, taken from the bytes.
 *
 * Six rows in the shape components/tools/fit renders: paper, pixels, dpi,
 * photo, copies, output. `verified` is true only when every row passed —
 * unlike /passport-photo's report there is no "not required" row here, because
 * every one of these was asked for the moment somebody chose a paper size.
 *
 * @param {Uint8Array|ArrayBuffer} input  the finished file, untouched
 * @param {object} layout                 from layoutSheet
 * @param {{ output?: 'jpeg'|'pdf' }} [options]
 * @returns {Promise<{ verified: boolean, checks: Array<{key, label, required, actual, ok}> }>}
 */
export async function validateSheet(input, layout, { output = 'jpeg' } = {}) {
    const bytes = toBytes(input);

    const checks = output === 'pdf'
        ? pdfChecks(bytes, layout, await readPdfPages(bytes))
        : rasterChecks(bytes, layout);

    return { verified: checks.every((row) => row.ok === true), checks };
}
