/**
 * The Print Sheet Layout Model
 *
 * One deterministic answer to "where does each photo go on this piece of
 * paper", used by everything that draws the sheet: the SVG preview on the page,
 * the raster compositor, the PDF writer and the validator that checks the
 * finished file. There is exactly one model because a preview that disagrees
 * with the file someone prints is the failure this tool cannot recover from —
 * the person finds out after they have cut the paper.
 *
 * Pure and DOM-free like the rest of lib/format/: the worker imports this,
 * so it must never reach React or the catalogue.
 *
 * THE ROUNDING POLICY, WHICH IS THE WHOLE CONTRACT
 *
 * Every physical length becomes pixels through lib/format/physical.js
 * `pixelsFor` — Math.round(mm / 25.4 x dpi) — INDEPENDENTLY per length (paper
 * width, paper height, photo width, photo height, margin, gap, tick) and
 * rounded exactly once. Nothing is derived from another rounded number, because
 * that is how a 3 mm gap becomes 34 px on one axis and 35 px on the other and
 * the columns stop lining up. Placement is then integer pixels throughout:
 *
 *   capacity per axis = floor((paperPx - 2 x marginPx + gapPx) / (photoPx + gapPx))
 *   leftover          = paperPx - 2 x marginPx - n x photoPx - (n - 1) x gapPx  (>= 0)
 *   block offset      = marginPx + floor(leftover / 2)
 *
 * The margin is a MINIMUM: whatever the grid does not use is split evenly and
 * the block sits in the middle of the sheet, so an off-centre print is always a
 * printer's own margin and never this model's arithmetic.
 *
 * THE PDF PAGE IS NOT MEASURED IN PIXELS. Page points come straight off the
 * millimetres (mm / 25.4 x 72), so a 4 x 6 in page is 288 x 432 pt at 72 DPI
 * and at 1200 DPI. Only the cells inside it are converted from the integer
 * pixel layout (px / dpi x 72), so the raster and the PDF place the photos in
 * the same physical spots.
 *
 * A GUIDE NEVER TOUCHES A PHOTO AND NEVER LEAVES THE PAPER. A mark is stored
 * as a segment, but what a renderer paints is the RECTANGLE `guideRects` and
 * `referenceRects` hand back: thickness grows rightward for a vertical mark
 * and downward for a horizontal one. That rectangle — not the segment — is
 * what is tested against every cell and against the edges of the sheet before
 * the mark is kept, so a mark with nowhere to go is dropped rather than drawn.
 * A zero gap means exactly that: no room between two photos, so no cut line,
 * and on a sheet the photos cover edge to edge, no cut line anywhere.
 *
 * SO THE RENDERERS COPY RECTANGLES; THEY DO NOT INTERPRET SEGMENTS. The
 * compositor fills them, the PDF writer converts them to points, the preview
 * draws them. What none of them may do is centre a stroke on a mark: that is
 * half a thickness wider at each end than the rectangle, which is how one
 * 50 mm measuring line came out 50.04 mm on the JPEG and 50.4 mm on the PDF.
 * The compositor still masks every guide pixel against the cells, as a second
 * guard rather than as the first one.
 */
import { pixelsFor } from '@/lib/format/physical';

export const DEFAULT_SHEET_DPI = 300;
export const DEFAULT_MARGIN_MM = 5;
export const DEFAULT_GAP_MM = 3;

/**
 * The DPI window. The floor is screen resolution, below which "print at actual
 * size" stops meaning anything; the ceiling is well past what a consumer
 * printer resolves and is where the paper canvas starts costing more memory
 * than a phone has. A request outside it is refused in words rather than
 * clamped, because a clamped DPI silently changes the pixel count someone
 * asked for.
 */
export const MIN_SHEET_DPI = 72;
export const MAX_SHEET_DPI = 1200;

export const GUIDE_STYLES = ['none', 'corners', 'lines'];
export const ORIENTATIONS = ['auto', 'portrait', 'landscape'];

/** The printed length of the measuring line, and its end ticks. */
export const REFERENCE_MM = 50;
export const REFERENCE_TICK_MM = 3;

/** One corner tick. Three millimetres is long enough to line a blade up on. */
export const CORNER_MARK_MM = 3;

/**
 * The smallest side a printed photo may have.
 *
 * Not a print-quality opinion — a floor under the size of the answer. Every
 * copy is one entry in the cells array, and nothing in the arithmetic stops
 * that array being enormous: a 1 mm photo with no margin and no gap fills A4
 * at 300 DPI with 2,160,000 cells, which is not a slow sheet but a tab that
 * never comes back. At 10 mm the same borderless A4 sheet is 21 x 29 = 609,
 * and the smallest photo any requirement on this site asks for — 35 x 45 mm —
 * is three and a half times clear of it.
 */
export const MIN_PHOTO_MM = 10;

/**
 * A reference line needs somewhere to live and something to be shorter than.
 * Below these it would sit on top of a photo or run off the sheet, and a
 * measuring line that is not exactly 50 mm is worse than none at all.
 */
export const REFERENCE_MIN_MARGIN_MM = 4;
export const REFERENCE_MIN_PAPER_MM = 60;

/** Above this the sheet is dense enough that a single pixel line disappears. */
const THICK_GUIDE_DPI = 400;

const MM_PER_INCH = 25.4;
const POINTS_PER_INCH = 72;

/* ------------------------------------------------------------- parsing */

/** A refusal, with the field it belongs to so a page can mark that control. */
function fail(error, field) {
    return { ok: false, field, error };
}

/**
 * A number out of whatever a caller is holding. A form posts strings, the page
 * holds numbers, and both have to be judged by the same rule — including the
 * rule that '' and 'abc' are not zero.
 */
function toNumber(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value !== 'string') return null;
    const text = value.trim();
    if (text === '') return null;
    const parsed = Number(text);
    return Number.isFinite(parsed) ? parsed : null;
}

function positiveMm(value) {
    const number = toNumber(value);
    return number !== null && number > 0 ? number : null;
}

function zeroOrMoreMm(value) {
    const number = toNumber(value);
    return number !== null && number >= 0 ? number : null;
}

/**
 * Whole pixels for a physical length, with zero allowed.
 *
 * physical.js throws on a non-positive length on purpose — a zero-width photo
 * is a bug nobody should be handed silently — but a zero margin and a zero gap
 * are both legitimate requests here (six 2 x 2 in photos tile a 4 x 6 in sheet
 * only when both are zero), so zero is answered here and everything else goes
 * through the one conversion.
 */
function lengthPx(mm, dpi) {
    return mm === 0 ? 0 : pixelsFor(mm, 'mm', dpi);
}

/* ---------------------------------------------------------- describing */

/** Trims a float to at most two decimals without leaving '4.00' behind. */
function trimNumber(value) {
    return String(Number(value.toFixed(2)));
}

/**
 * True when a millimetre length is an exact eighth of an inch, which is what
 * separates paper described in inches (4 x 6, 8.5 x 11) from paper described in
 * millimetres (210 x 297). 101.6 mm is 4 in exactly; 210 mm is 8.2677 in and
 * calling it "8.27 in" would be a number nobody printed.
 */
function isInchLength(mm) {
    const eighths = (mm / MM_PER_INCH) * 8;
    return Math.abs(eighths - Math.round(eighths)) < 1e-6;
}

/**
 * '4 × 6 in' or '210 × 297 mm'. Never sorts its arguments: a 35 × 45 mm photo
 * and a 45 × 35 mm photo are different photos.
 */
export function describeSheetSize(widthMm, heightMm) {
    if (isInchLength(widthMm) && isInchLength(heightMm)) {
        return `${trimNumber(widthMm / MM_PER_INCH)} × ${trimNumber(heightMm / MM_PER_INCH)} in`;
    }
    return `${trimNumber(widthMm)} × ${trimNumber(heightMm)} mm`;
}

function plural(count, one, many) {
    return `${count} ${count === 1 ? one : many}`;
}

/** The accessible sentence the preview carries as its label. */
export function describeLayout(layout) {
    if (!layout || layout.ok !== true) return '';

    return `${layout.summary.paper} sheet, ${layout.orientation}, `
        + `${plural(layout.copies, 'copy', 'copies')} of a ${layout.summary.photo} photo `
        + `in ${plural(layout.columns, 'column', 'columns')} `
        + `and ${plural(layout.rows, 'row', 'rows')} `
        + `at ${layout.dpi} DPI.`;
}

/**
 * The download-name fragment: '4x6in-300dpi'.
 *
 * Millimetres unless BOTH sides are whole inches, because lib/image/filename.js
 * strips a '.' out of a filename token and 'Letter' would come back as
 * '85x11' — a sheet size that does not exist.
 */
export function sheetFilenameSuffix(layout) {
    if (!layout || layout.ok !== true) return '';

    const shortMm = Math.min(layout.paper.widthMm, layout.paper.heightMm);
    const longMm = Math.max(layout.paper.widthMm, layout.paper.heightMm);

    const inches = [shortMm, longMm].map((mm) => mm / MM_PER_INCH);
    const whole = inches.every((value) => Math.abs(value - Math.round(value)) < 1e-6);

    const size = whole
        ? `${Math.round(inches[0])}x${Math.round(inches[1])}in`
        : `${Math.round(shortMm)}x${Math.round(longMm)}mm`;

    return `${size}-${layout.dpi}dpi`;
}

/* ------------------------------------------------------------ geometry */

/** How many whole photos fit along one axis, gaps between them and not after. */
function capacityAlong(paperPx, photoPx, marginPx, gapPx) {
    const usable = paperPx - 2 * marginPx + gapPx;
    const step = photoPx + gapPx;
    if (step <= 0 || usable <= 0) return 0;
    return Math.max(0, Math.floor(usable / step));
}

/** The centred start of a block of `count` photos along one axis. */
function blockOffset(paperPx, photoPx, marginPx, gapPx, count) {
    const used = count * photoPx + (count - 1) * gapPx;
    const leftover = paperPx - 2 * marginPx - used;
    return marginPx + Math.floor(leftover / 2);
}

function buildCells({ columns, rows, copies, photoWidthPx, photoHeightPx, xOffset, yOffset, gapPx }) {
    const cells = [];

    for (let index = 0; index < copies; index += 1) {
        const column = index % columns;
        const row = Math.floor(index / columns);
        if (row >= rows) break;

        cells.push({
            index,
            column,
            row,
            x: xOffset + column * (photoWidthPx + gapPx),
            y: yOffset + row * (photoHeightPx + gapPx),
            width: photoWidthPx,
            height: photoHeightPx,
        });
    }

    return cells;
}

/**
 * The pixels a mark paints: a column or a row, half-open at the far edge, with
 * its thickness growing in the positive direction — right for a vertical mark,
 * down for a horizontal one — so a mark placed at a cell's outer edge stays
 * outside the cell. Only axis-aligned segments are ever produced here.
 */
function markRectangle(mark, thicknessPx) {
    const left = Math.min(mark.x1, mark.x2);
    const right = Math.max(mark.x1, mark.x2);
    const top = Math.min(mark.y1, mark.y2);
    const bottom = Math.max(mark.y1, mark.y2);

    return right === left
        ? { x: left, y: top, width: thicknessPx, height: bottom - top }
        : { x: left, y: top, width: right - left, height: thicknessPx };
}

function rectMeetsCell(rect, cell) {
    return rect.x < cell.x + cell.width && rect.x + rect.width > cell.x
        && rect.y < cell.y + cell.height && rect.y + rect.height > cell.y;
}

/**
 * A mark survives only if the rectangle it paints stays wholly on the paper
 * and off every photo.
 *
 * The rectangle rather than the segment, because they are not the same shape:
 * a vertical line at x = the paper width is a segment on the edge of the sheet
 * and a rectangle one pixel past it. The raster clipped those to nothing while
 * the PDF and the preview drew them, so a zero-margin sheet had two marks that
 * existed in two renderers out of three.
 */
function keepMark(mark, cells, paperWidthPx, paperHeightPx, thicknessPx) {
    const rect = markRectangle(mark, thicknessPx);

    if (rect.width <= 0 || rect.height <= 0) return false;
    if (rect.x < 0 || rect.y < 0) return false;
    if (rect.x + rect.width > paperWidthPx || rect.y + rect.height > paperHeightPx) return false;

    return !cells.some((cell) => rectMeetsCell(rect, cell));
}

/**
 * Four ticks per cell, one at each corner, alternating direction around it so
 * all four cut lines get marked: the top-left tick runs left along the top
 * edge, the top-right tick runs up the right edge, the bottom-right tick runs
 * right along the bottom edge and the bottom-left tick runs down the left edge.
 * Every one of them sits in the gap or the margin, never on a photo, and is
 * shortened rather than allowed to reach the photo next door.
 */
function cornerMarks(cells, { paperWidthPx, paperHeightPx, gapPx, tickPx }) {
    const occupied = new Set(cells.map((cell) => `${cell.row},${cell.column}`));
    const has = (row, column) => occupied.has(`${row},${column}`);
    const marks = [];

    for (const cell of cells) {
        const right = cell.x + cell.width;
        const bottom = cell.y + cell.height;

        const spaceLeft = has(cell.row, cell.column - 1) ? gapPx : cell.x;
        const spaceRight = has(cell.row, cell.column + 1) ? gapPx : paperWidthPx - right;
        const spaceAbove = has(cell.row - 1, cell.column) ? gapPx : cell.y;
        const spaceBelow = has(cell.row + 1, cell.column) ? gapPx : paperHeightPx - bottom;

        const left = Math.min(tickPx, spaceLeft);
        const up = Math.min(tickPx, spaceAbove);
        const out = Math.min(tickPx, spaceRight);
        const down = Math.min(tickPx, spaceBelow);

        if (left > 0) marks.push({ x1: cell.x - left, y1: cell.y, x2: cell.x, y2: cell.y });
        if (up > 0) marks.push({ x1: right, y1: cell.y - up, x2: right, y2: cell.y });
        if (out > 0) marks.push({ x1: right, y1: bottom, x2: right + out, y2: bottom });
        if (down > 0) marks.push({ x1: cell.x, y1: bottom, x2: cell.x, y2: bottom + down });
    }

    return marks;
}

/**
 * A line along every cell edge, running the full height or width of the sheet
 * so it passes through the margins and the gaps and can be followed with a
 * guillotine. Each line sits just OUTSIDE the photo it belongs to, by its own
 * thickness — the compositor thickens a line rightward and downward, so a
 * left or top edge starts `thicknessPx` before the photo — which is what lets
 * it be drawn without touching a single pixel of the picture.
 */
function edgeLines(cells, { paperWidthPx, paperHeightPx, thicknessPx }) {
    const verticals = new Set();
    const horizontals = new Set();

    for (const cell of cells) {
        verticals.add(cell.x - thicknessPx);
        verticals.add(cell.x + cell.width);
        horizontals.add(cell.y - thicknessPx);
        horizontals.add(cell.y + cell.height);
    }

    const marks = [];
    for (const x of [...verticals].sort((a, b) => a - b)) {
        marks.push({ x1: x, y1: 0, x2: x, y2: paperHeightPx });
    }
    for (const y of [...horizontals].sort((a, b) => a - b)) {
        marks.push({ x1: 0, y1: y, x2: paperWidthPx, y2: y });
    }

    return marks;
}

/**
 * The measuring line: exactly 50 mm of paper with a tick at each end, laid
 * across the bottom margin so it can be checked with a ruler after printing.
 * If it comes out anything other than 50 mm the print was scaled, which is the
 * single most common way a passport photo sheet goes wrong.
 */
function referenceLine({ paperWidthPx, paperWidthMm, paperHeightPx, marginPx, marginMm, dpi }) {
    if (marginMm < REFERENCE_MIN_MARGIN_MM) return null;
    if (paperWidthMm < REFERENCE_MIN_PAPER_MM) return null;

    const lengthPixels = lengthPx(REFERENCE_MM, dpi);
    if (lengthPixels + 2 > paperWidthPx) return null;

    const tick = Math.max(2, Math.min(lengthPx(REFERENCE_TICK_MM, dpi), marginPx - 2));
    const x1 = Math.round((paperWidthPx - lengthPixels) / 2);
    const y = paperHeightPx - Math.round(marginPx / 2);

    return {
        x1,
        y1: y,
        x2: x1 + lengthPixels,
        y2: y,
        lengthMm: REFERENCE_MM,
        lengthPx: lengthPixels,
        tickPx: tick,
    };
}

/**
 * The rows a reference line's end ticks occupy, half-open at the bottom.
 *
 * Exported rather than recomputed because four renderers draw this line — the
 * SVG preview, the raster compositor, the PDF writer and the test that checks
 * it never lands on a photo — and a tick that is centred in one of them and
 * hung from the line in another is a difference nobody would notice until the
 * paper came out of the printer.
 */
export function referenceTickRange(reference) {
    if (!reference) return { top: 0, bottom: 0 };
    const top = reference.y1 - Math.floor(reference.tickPx / 2);
    return { top, bottom: top + reference.tickPx };
}

/**
 * The cut guides as the rectangles they are painted as, in paper pixels.
 *
 * Exported because the compositor, the PDF writer and the SVG preview must
 * paint the SAME pixels, and a segment is not enough to say which those are:
 * one renderer growing the thickness downward while another centres a stroke
 * on the line is two sheets that do not match, discovered after the paper is
 * cut. The PDF converts these to points (px / dpi x 72); the preview scales
 * them with its viewBox; the compositor fills them as they stand.
 */
export function guideRects(layout) {
    if (!layout || layout.ok !== true) return [];

    const thickness = layout.guides.thicknessPx;
    return layout.guides.marks.map((mark) => markRectangle(mark, thickness));
}

/**
 * The measuring line as three rectangles: the bar, and one tick standing at
 * each end INSIDE it.
 *
 * Inside, not centred on the ends, and that is the whole point of this
 * function existing: the distance a ruler measures is the outer edge of one
 * tick to the outer edge of the other, and with the ticks inside the bar that
 * distance is exactly `reference.lengthPx` — the pixels 50 mm comes to at this
 * DPI. A tick centred on each end would be one thickness longer, which is the
 * PDF measuring 50.4 mm against the JPEG's 50.04 on the one page that asks
 * people to check it with a ruler.
 */
export function referenceRects(layout) {
    if (!layout || layout.ok !== true || !layout.reference) return [];

    const line = layout.reference;
    const weight = layout.guides.thicknessPx * 2;
    const tick = referenceTickRange(line);

    return [
        { x: line.x1, y: line.y1, width: line.x2 - line.x1, height: weight },
        ...[line.x1, line.x2 - weight].map((x) => ({
            x,
            y: tick.top,
            width: weight,
            height: tick.bottom - tick.top,
        })),
    ];
}

/* --------------------------------------------------------------- model */

/**
 * Where every photo goes on one sheet of paper.
 *
 * Numbers may arrive as numbers or as the strings a form posts; both are
 * judged by the same rule and a bad one comes back as a sentence rather than a
 * throw, because every one of these is a field somebody typed into.
 *
 * @param {object} input
 * @param {number|string} input.paperWidthMm
 * @param {number|string} input.paperHeightMm
 * @param {string} [input.orientation]   'auto' | 'portrait' | 'landscape'
 * @param {number|string} input.photoWidthMm
 * @param {number|string} input.photoHeightMm
 * @param {number|string} [input.dpi]
 * @param {number|string} [input.marginMm]
 * @param {number|string} [input.gapMm]
 * @param {number|string} [input.copies]  a whole number, or 'auto' to fill it
 * @param {string} [input.guides]         one of GUIDE_STYLES
 * @param {boolean} [input.reference]
 * @returns {{ ok: true, ... }|{ ok: false, field: string, error: string }}
 */
export function layoutSheet({
    paperWidthMm,
    paperHeightMm,
    orientation = 'auto',
    photoWidthMm,
    photoHeightMm,
    dpi = DEFAULT_SHEET_DPI,
    marginMm = DEFAULT_MARGIN_MM,
    gapMm = DEFAULT_GAP_MM,
    copies = 'auto',
    guides = 'corners',
    reference = true,
} = {}) {
    const paperW = positiveMm(paperWidthMm);
    if (paperW === null) return fail('The paper width must be a positive number of millimetres.', 'paper');

    const paperH = positiveMm(paperHeightMm);
    if (paperH === null) return fail('The paper height must be a positive number of millimetres.', 'paper');

    const photoW = positiveMm(photoWidthMm);
    if (photoW === null) return fail('The photo width must be a positive number of millimetres.', 'photo');

    const photoH = positiveMm(photoHeightMm);
    if (photoH === null) return fail('The photo height must be a positive number of millimetres.', 'photo');

    if (photoW < MIN_PHOTO_MM || photoH < MIN_PHOTO_MM) {
        return fail(`The photo must be at least ${MIN_PHOTO_MM} mm on each side.`, 'photo');
    }

    const margin = zeroOrMoreMm(marginMm);
    if (margin === null) return fail('The margin must be zero or a positive number of millimetres.', 'margin');

    const gap = zeroOrMoreMm(gapMm);
    if (gap === null) return fail('The spacing must be zero or a positive number of millimetres.', 'gap');

    const resolution = toNumber(dpi);
    if (resolution === null
        || !Number.isInteger(resolution)
        || resolution < MIN_SHEET_DPI
        || resolution > MAX_SHEET_DPI) {
        return fail(`The DPI must be a whole number between ${MIN_SHEET_DPI} and ${MAX_SHEET_DPI}.`, 'dpi');
    }

    const wantsAll = copies === 'auto' || copies === null || copies === undefined;
    const requested = wantsAll ? 'auto' : toNumber(copies);
    if (!wantsAll && (requested === null || !Number.isInteger(requested) || requested < 1)) {
        return fail('The number of copies must be a whole number of one or more.', 'copies');
    }

    if (!ORIENTATIONS.includes(orientation)) {
        return fail('Orientation must be auto, portrait, or landscape.', 'orientation');
    }

    if (!GUIDE_STYLES.includes(guides)) {
        return fail('Cut guides must be none, corners, or lines.', 'guides');
    }

    const shortMm = Math.min(paperW, paperH);
    const longMm = Math.max(paperW, paperH);
    const paperName = describeSheetSize(shortMm, longMm);
    const photoName = describeSheetSize(photoW, photoH);

    const marginPx = lengthPx(margin, resolution);
    const gapPx = lengthPx(gap, resolution);
    const photoWidthPx = lengthPx(photoW, resolution);
    const photoHeightPx = lengthPx(photoH, resolution);

    const shortPx = lengthPx(shortMm, resolution);
    const longPx = lengthPx(longMm, resolution);

    const option = (name) => {
        const widthPx = name === 'portrait' ? shortPx : longPx;
        const heightPx = name === 'portrait' ? longPx : shortPx;
        const columns = capacityAlong(widthPx, photoWidthPx, marginPx, gapPx);
        const rows = capacityAlong(heightPx, photoHeightPx, marginPx, gapPx);

        return {
            name,
            widthMm: name === 'portrait' ? shortMm : longMm,
            heightMm: name === 'portrait' ? longMm : shortMm,
            widthPx,
            heightPx,
            columns,
            rows,
            capacity: columns * rows,
        };
    };

    const portrait = option('portrait');
    const landscape = option('landscape');

    // 'auto' takes whichever fits more; a tie goes to portrait, which is how
    // every one of these papers is named and how the preview is shaped.
    let chosen = portrait;
    if (orientation === 'landscape') chosen = landscape;
    else if (orientation === 'auto' && landscape.capacity > portrait.capacity) chosen = landscape;

    if (chosen.capacity < 1) {
        return fail(
            `A ${photoName} photo does not fit on ${paperName} paper with a ${trimNumber(margin)} mm margin.`,
            'photo',
        );
    }

    const count = wantsAll ? chosen.capacity : Math.min(requested, chosen.capacity);
    const clamped = !wantsAll && requested > chosen.capacity;

    // The block that is centred is the one the copies actually use, so a
    // single copy sits in the middle of the sheet rather than in the corner
    // the full grid would have given it. Row-major order is unchanged.
    const columnsUsed = Math.min(count, chosen.columns);
    const rowsUsed = Math.ceil(count / chosen.columns);

    const cells = buildCells({
        columns: chosen.columns,
        rows: chosen.rows,
        copies: count,
        photoWidthPx,
        photoHeightPx,
        xOffset: blockOffset(chosen.widthPx, photoWidthPx, marginPx, gapPx, columnsUsed),
        yOffset: blockOffset(chosen.heightPx, photoHeightPx, marginPx, gapPx, rowsUsed),
        gapPx,
    });

    const tickPx = lengthPx(CORNER_MARK_MM, resolution);
    const thicknessPx = resolution >= THICK_GUIDE_DPI ? 2 : 1;
    const raw = guides === 'corners'
        ? cornerMarks(cells, {
            paperWidthPx: chosen.widthPx,
            paperHeightPx: chosen.heightPx,
            gapPx,
            tickPx,
        })
        : (guides === 'lines'
            ? edgeLines(cells, { paperWidthPx: chosen.widthPx, paperHeightPx: chosen.heightPx, thicknessPx })
            : []);

    const marks = raw.filter((mark) => (
        keepMark(mark, cells, chosen.widthPx, chosen.heightPx, thicknessPx)
    ));

    return {
        ok: true,
        orientation: chosen.name,
        requestedOrientation: orientation,
        dpi: resolution,
        paper: {
            widthMm: chosen.widthMm,
            heightMm: chosen.heightMm,
            widthPx: chosen.widthPx,
            heightPx: chosen.heightPx,
            widthPt: (chosen.widthMm / MM_PER_INCH) * POINTS_PER_INCH,
            heightPt: (chosen.heightMm / MM_PER_INCH) * POINTS_PER_INCH,
        },
        photo: {
            widthMm: photoW,
            heightMm: photoH,
            widthPx: photoWidthPx,
            heightPx: photoHeightPx,
        },
        marginMm: margin,
        gapMm: gap,
        marginPx,
        gapPx,
        columns: chosen.columns,
        rows: chosen.rows,
        capacity: chosen.capacity,
        copies: count,
        requested: wantsAll ? 'auto' : requested,
        clamped,
        notice: clamped
            ? `Only ${chosen.capacity} photos fit on this sheet with the current size and spacing.`
            : null,
        cells,
        guides: {
            style: guides,
            thicknessPx,
            marks,
        },
        reference: reference === true
            ? referenceLine({
                paperWidthPx: chosen.widthPx,
                paperWidthMm: chosen.widthMm,
                paperHeightPx: chosen.heightPx,
                marginPx,
                marginMm: margin,
                dpi: resolution,
            })
            : null,
        summary: {
            paper: paperName,
            pixels: `${chosen.widthPx} × ${chosen.heightPx} px`,
            dpi: resolution,
            photo: photoName,
            copies: count,
            orientation: chosen.name === 'portrait' ? 'Portrait' : 'Landscape',
        },
    };
}

/**
 * The highest DPI at which this paper can be laid out inside the engine's
 * limits — the long side at or under `maxDimension` and the area at or under
 * `maxPixels` — so the page can name the DPI to use instead of relaying a
 * refusal about a pixel size the visitor never typed. The float estimate is
 * stepped down until the ROUNDED pixel sizes really fit.
 */
export function maxSheetDpi({ paperWidthMm, paperHeightMm } = {}, { maxDimension, maxPixels } = {}) {
    const usable = (value) => Number.isFinite(value) && value > 0;
    if (![paperWidthMm, paperHeightMm, maxDimension, maxPixels].every(usable)) return null;

    const widthIn = paperWidthMm / MM_PER_INCH;
    const heightIn = paperHeightMm / MM_PER_INCH;
    const fits = (dpi) => {
        const width = lengthPx(paperWidthMm, dpi);
        const height = lengthPx(paperHeightMm, dpi);
        return Math.max(width, height) <= maxDimension && width * height <= maxPixels;
    };

    let dpi = Math.floor(Math.min(
        maxDimension / Math.max(widthIn, heightIn),
        Math.sqrt(maxPixels / (widthIn * heightIn)),
    ));
    while (dpi > 0 && !fits(dpi)) dpi -= 1;

    return dpi > 0 ? dpi : null;
}

/**
 * Whether the source region being printed is smaller than the printed photo,
 * and by how much.
 *
 * A blow-up is not an error and is not refused — a 300 x 300 selfie printed at
 * 2 x 2 in really is 150 DPI of real detail, which some people accept — but it
 * is the reason a printed sheet comes back soft, so it is said out loud before
 * the job runs rather than explained afterwards.
 */
export function sourceEnlargement({
    keptWidth, keptHeight, photoWidthPx, photoHeightPx, fit = 'cover',
} = {}) {
    const usable = (value) => Number.isFinite(value) && value > 0;

    if (![keptWidth, keptHeight, photoWidthPx, photoHeightPx].every(usable)) return null;

    // Crop to fill scales the source until it covers the cell; Fit inside
    // scales it until it touches the cell on one side, so a source that is
    // shorter than the cell on the other side is not enlarged at all.
    const ratios = [photoWidthPx / keptWidth, photoHeightPx / keptHeight];
    const scale = fit === 'contain' ? Math.min(...ratios) : Math.max(...ratios);
    if (scale <= 1) return null;

    return {
        from: { width: keptWidth, height: keptHeight },
        to: fit === 'contain'
            ? { width: Math.round(keptWidth * scale), height: Math.round(keptHeight * scale) }
            : { width: photoWidthPx, height: photoHeightPx },
    };
}
