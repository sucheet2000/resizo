/**
 * The print-sheet layout model.
 *
 * ONE MODEL, FOUR RENDERERS. The SVG preview on the page, the raster
 * compositor, the PDF writer and the validator all read the same object this
 * module returns. So every number below is pinned here rather than in the
 * renderer that happens to consume it: a preview that disagrees with the file
 * someone prints is the one failure this tool cannot recover from, because the
 * person only finds out after they have cut the paper.
 *
 * THE ROUNDING POLICY IS THE CONTRACT. Every physical length becomes pixels
 * through lib/format/physical.js pixelsFor — independently, once, rounded once.
 * Nothing is derived from another rounded number, which is why 5 mm at 300 DPI
 * is 59 px on both axes and 3 mm is 35 px whether it is a gap or a corner tick.
 * The page points for the PDF are NOT taken from those pixels: they come
 * straight off the millimetres, so a 4 x 6 in page is 288 x 432 pt at every DPI.
 *
 * WHAT THE NUMBERS SAY ABOUT THE DEFAULTS, and it is worth reading twice: a
 * 2 x 2 in photo on 4 x 6 in paper with a 5 mm margin and a 3 mm gap fits TWO
 * copies, not six. Six 2 x 2 in photos tile a 4 x 6 in sheet EXACTLY (2 across
 * by 3 down, 101.6 x 152.4 mm of photo on 101.6 x 152.4 mm of paper), so the
 * six-up arrangement every photo counter prints needs a zero margin and a zero
 * gap. Both cases are pinned below, because the difference between them is the
 * whole reason the capacity is computed rather than typed.
 */
import { describe, expect, it } from 'vitest';

import {
    CORNER_MARK_MM,
    DEFAULT_GAP_MM,
    DEFAULT_MARGIN_MM,
    DEFAULT_SHEET_DPI,
    GUIDE_STYLES,
    MAX_SHEET_DPI,
    MIN_PHOTO_MM,
    MIN_SHEET_DPI,
    ORIENTATIONS,
    REFERENCE_MM,
    describeLayout,
    describeSheetSize,
    guideRects,
    layoutSheet,
    maxSheetDpi,
    referenceRects,
    sheetFilenameSuffix,
    sourceEnlargement,
} from '@/lib/format/print-sheet';
import { pixelsFor } from '@/lib/format/physical';

/** The four papers the registry offers, in millimetres. */
const FOUR_BY_SIX = { paperWidthMm: 101.6, paperHeightMm: 152.4 };
const A4 = { paperWidthMm: 210, paperHeightMm: 297 };
const LETTER = { paperWidthMm: 215.9, paperHeightMm: 279.4 };

/** 2 x 2 in, the United States passport size. */
const US = { photoWidthMm: 50.8, photoHeightMm: 50.8 };
/** 35 x 45 mm, the United Kingdom size. */
const UK = { photoWidthMm: 35, photoHeightMm: 45 };

function sheet(overrides = {}) {
    return layoutSheet({ ...FOUR_BY_SIX, ...US, ...overrides });
}

function ok(overrides = {}) {
    const result = sheet(overrides);
    expect(result.ok, result.error).toBe(true);
    return result;
}

/* ------------------------------------------------------------- constants */

describe('the module states its own defaults', () => {
    it('carries the print defaults the tool is built on', () => {
        expect(DEFAULT_SHEET_DPI).toBe(300);
        expect(DEFAULT_MARGIN_MM).toBe(5);
        expect(DEFAULT_GAP_MM).toBe(3);
        expect(REFERENCE_MM).toBe(50);
        expect(CORNER_MARK_MM).toBe(3);
        expect(MIN_PHOTO_MM).toBe(10);
        expect(MIN_SHEET_DPI).toBe(72);
        expect(MAX_SHEET_DPI).toBe(1200);
        expect(GUIDE_STYLES).toEqual(['none', 'corners', 'lines']);
        expect(ORIENTATIONS).toEqual(['auto', 'portrait', 'landscape']);
    });
});

/* ------------------------------------------------------------- rounding */

describe('every length becomes pixels through pixelsFor, once', () => {
    it('rounds each side of the paper and the photo independently', () => {
        const layout = ok({ orientation: 'portrait' });

        expect(layout.paper.widthPx).toBe(pixelsFor(101.6, 'mm', 300));
        expect(layout.paper.heightPx).toBe(pixelsFor(152.4, 'mm', 300));
        expect(layout.paper.widthPx).toBe(1200);
        expect(layout.paper.heightPx).toBe(1800);

        expect(layout.photo.widthPx).toBe(600);
        expect(layout.photo.heightPx).toBe(600);
    });

    it('rounds the margin and the gap the same way, and they are not derived from each other', () => {
        const layout = ok();

        // 5 mm is 59.055 px at 300 DPI and 3 mm is 35.433 px. Both round DOWN,
        // which is what makes a "5 mm margin" 4.99 mm of real paper.
        expect(layout.marginPx).toBe(59);
        expect(layout.gapPx).toBe(35);
        expect(layout.marginPx).toBe(pixelsFor(DEFAULT_MARGIN_MM, 'mm', 300));
        expect(layout.gapPx).toBe(pixelsFor(DEFAULT_GAP_MM, 'mm', 300));
    });

    it('treats a zero margin and a zero gap as zero pixels rather than throwing', () => {
        const layout = ok({ marginMm: 0, gapMm: 0 });

        expect(layout.marginPx).toBe(0);
        expect(layout.gapPx).toBe(0);
    });

    it('takes the page points off the millimetres, so they do not move with the DPI', () => {
        const low = ok({ dpi: 72, orientation: 'portrait' });
        const high = ok({ dpi: 600, orientation: 'portrait' });

        expect(low.paper.widthPt).toBeCloseTo(288, 6);
        expect(low.paper.heightPt).toBeCloseTo(432, 6);
        expect(high.paper.widthPt).toBeCloseTo(288, 6);
        expect(high.paper.heightPt).toBeCloseTo(432, 6);
    });
});

/* ------------------------------------------------------------ capacity */

describe('capacity', () => {
    it('fits two 2 x 2 in photos on 4 x 6 in paper at the default margin and gap', () => {
        // 101.6 - 2 x 5 = 91.6 mm of usable width; two photos need
        // 50.8 x 2 + 3 = 104.6 mm. One column, and the long side takes two.
        const layout = ok({ orientation: 'portrait' });

        expect(layout.columns).toBe(1);
        expect(layout.rows).toBe(2);
        expect(layout.capacity).toBe(2);
    });

    it('fits six of them once the margin and the gap are zero, because they tile the sheet exactly', () => {
        const layout = ok({ marginMm: 0, gapMm: 0, orientation: 'portrait' });

        expect(layout.columns).toBe(2);
        expect(layout.rows).toBe(3);
        expect(layout.capacity).toBe(6);
    });

    it('fits thirty 35 x 45 mm photos on A4 at the defaults', () => {
        const layout = layoutSheet({ ...A4, ...UK });

        expect(layout.ok).toBe(true);
        expect(layout.columns).toBe(5);
        expect(layout.rows).toBe(6);
        expect(layout.capacity).toBe(30);
    });

    it('counts a whole photo plus a whole gap per step, so the trailing gap is never charged', () => {
        // floor((paperPx - 2 x marginPx + gapPx) / (photoPx + gapPx)).
        const layout = layoutSheet({ ...LETTER, ...US });
        const usable = (side) => Math.floor(
            (side - 2 * layout.marginPx + layout.gapPx) / (600 + layout.gapPx),
        );

        expect(layout.columns).toBe(usable(layout.paper.widthPx));
        expect(layout.rows).toBe(usable(layout.paper.heightPx));
    });
});

/* --------------------------------------------------------- orientation */

describe('orientation', () => {
    it('portrait puts the short side across and landscape puts the long side across', () => {
        expect(ok({ orientation: 'portrait' }).paper.widthPx).toBe(1200);
        expect(ok({ orientation: 'portrait' }).paper.heightPx).toBe(1800);
        expect(ok({ orientation: 'landscape' }).paper.widthPx).toBe(1800);
        expect(ok({ orientation: 'landscape' }).paper.heightPx).toBe(1200);
    });

    it('auto takes the orientation that fits more, and says which was asked for', () => {
        const layout = layoutSheet({ ...A4, ...UK, orientation: 'auto' });

        // A4 portrait fits 5 x 6 = 30; landscape fits 7 x 4 = 28.
        expect(layout.orientation).toBe('portrait');
        expect(layout.capacity).toBe(30);
        expect(layout.requestedOrientation).toBe('auto');
    });

    it('auto takes landscape when landscape genuinely fits more', () => {
        // 90 x 40 mm photos on A4: portrait fits 2 x 6 = 12, landscape 3 x 4 = 12...
        // so use a shape where the answer is not a tie.
        const layout = layoutSheet({
            ...A4,
            photoWidthMm: 130,
            photoHeightMm: 60,
            orientation: 'auto',
        });

        // Portrait (210 wide): 1 column, 4 rows = 4. Landscape (297 wide): 2 columns, 3 rows = 6.
        expect(layout.orientation).toBe('landscape');
        expect(layout.capacity).toBe(6);
    });

    it('breaks a tie towards portrait', () => {
        // 2 x 2 in on 4 x 6 in fits two either way.
        const layout = ok({ orientation: 'auto' });

        expect(layout.orientation).toBe('portrait');
        expect(layout.capacity).toBe(2);
    });

    it('honours an explicit orientation even when the other one fits more', () => {
        const layout = layoutSheet({
            ...A4,
            photoWidthMm: 130,
            photoHeightMm: 60,
            orientation: 'portrait',
        });

        expect(layout.orientation).toBe('portrait');
        expect(layout.capacity).toBe(4);
    });
});

/* --------------------------------------------------------------- cells */

describe('cells', () => {
    it('centres the block and lays the copies out row-major in whole pixels', () => {
        const layout = ok({ orientation: 'portrait' });

        // usedHeight = 2 x 600 + 35 = 1235; leftover = 1800 - 118 - 1235 = 447.
        // yOffset = 59 + floor(447 / 2) = 282. xOffset = 59 + floor(482 / 2) = 300.
        expect(layout.cells).toEqual([
            { index: 0, column: 0, row: 0, x: 300, y: 282, width: 600, height: 600 },
            { index: 1, column: 0, row: 1, x: 300, y: 917, width: 600, height: 600 },
        ]);
    });

    it('lays a full six-up sheet out in three columns and two rows', () => {
        const layout = ok({ marginMm: 0, gapMm: 0, orientation: 'landscape' });

        expect(layout.paper.widthPx).toBe(1800);
        expect(layout.paper.heightPx).toBe(1200);
        expect(layout.cells).toHaveLength(6);
        expect(layout.cells.map((cell) => [cell.x, cell.y])).toEqual([
            [0, 0], [600, 0], [1200, 0],
            [0, 600], [600, 600], [1200, 600],
        ]);
    });

    it('gives every cell the photo pixel size and keeps every one on the paper', () => {
        const layout = layoutSheet({ ...A4, ...UK });

        for (const cell of layout.cells) {
            expect(cell.width).toBe(layout.photo.widthPx);
            expect(cell.height).toBe(layout.photo.heightPx);
            expect(cell.x).toBeGreaterThanOrEqual(0);
            expect(cell.y).toBeGreaterThanOrEqual(0);
            expect(cell.x + cell.width).toBeLessThanOrEqual(layout.paper.widthPx);
            expect(cell.y + cell.height).toBeLessThanOrEqual(layout.paper.heightPx);
        }
    });

    it('never overlaps two cells', () => {
        const layout = layoutSheet({ ...A4, ...UK });

        for (let a = 0; a < layout.cells.length; a += 1) {
            for (let b = a + 1; b < layout.cells.length; b += 1) {
                const one = layout.cells[a];
                const two = layout.cells[b];
                const apart = one.x + one.width <= two.x
                    || two.x + two.width <= one.x
                    || one.y + one.height <= two.y
                    || two.y + two.height <= one.y;
                expect(apart, `cells ${a} and ${b} overlap`).toBe(true);
            }
        }
    });
});

/* -------------------------------------------------------------- copies */

describe('copies', () => {
    it('fills the sheet when the count is auto', () => {
        const layout = layoutSheet({ ...A4, ...UK, copies: 'auto' });

        expect(layout.requested).toBe('auto');
        expect(layout.copies).toBe(30);
        expect(layout.cells).toHaveLength(30);
        expect(layout.clamped).toBe(false);
        expect(layout.notice).toBeNull();
    });

    it('honours a smaller count and lays it out row-major from the first cell', () => {
        const layout = layoutSheet({ ...A4, ...UK, copies: 7 });

        expect(layout.copies).toBe(7);
        expect(layout.cells).toHaveLength(7);
        expect(layout.cells[5].row).toBe(1);
        expect(layout.cells[5].column).toBe(0);
        expect(layout.clamped).toBe(false);
    });

    it('clamps a count over capacity and says so in a sentence a person can act on', () => {
        const layout = ok({ copies: 9, orientation: 'portrait' });

        expect(layout.capacity).toBe(2);
        expect(layout.copies).toBe(2);
        expect(layout.requested).toBe(9);
        expect(layout.clamped).toBe(true);
        expect(layout.notice).toBe(
            'Only 2 photos fit on this sheet with the current size and spacing.',
        );
    });
});

/* ------------------------------------------------------------- refusals */

describe('refusals', () => {
    it('refuses a photo that does not fit at all, naming the photo, the paper and the margin', () => {
        const layout = layoutSheet({ ...FOUR_BY_SIX, photoWidthMm: 120, photoHeightMm: 120 });

        expect(layout.ok).toBe(false);
        expect(layout.error).toBe(
            'A 120 × 120 mm photo does not fit on 4 × 6 in paper with a 5 mm margin.',
        );
    });

    it('refuses a photo that only fails because of the margin, and still names the margin', () => {
        // 100 x 100 mm fits on 101.6 x 152.4 mm paper with no margin and not with 5 mm.
        expect(layoutSheet({ ...FOUR_BY_SIX, photoWidthMm: 100, photoHeightMm: 100, marginMm: 0 }).ok)
            .toBe(true);

        const refused = layoutSheet({ ...FOUR_BY_SIX, photoWidthMm: 100, photoHeightMm: 100 });
        expect(refused.ok).toBe(false);
        expect(refused.error).toContain('with a 5 mm margin');
    });

    it('refuses a photo too small to be a photo, which is what freezes a tab', () => {
        // A 1 mm photo with no margin and no gap lays out 2.16 million cells on
        // A4 at 300 DPI: the layout returns, and the tab never does. The floor
        // is stated in the unit somebody typed rather than in cells.
        expect(sheet({ photoWidthMm: 9.9 }).error)
            .toBe('The photo must be at least 10 mm on each side.');
        expect(sheet({ photoHeightMm: 9.9 }).error)
            .toBe('The photo must be at least 10 mm on each side.');
        expect(sheet({ photoWidthMm: MIN_PHOTO_MM, photoHeightMm: MIN_PHOTO_MM }).ok).toBe(true);
    });

    it.each([
        ['paperWidthMm', 0, 'The paper width must be a positive number of millimetres.'],
        ['paperHeightMm', -5, 'The paper height must be a positive number of millimetres.'],
        ['photoWidthMm', 'abc', 'The photo width must be a positive number of millimetres.'],
        ['photoHeightMm', '', 'The photo height must be a positive number of millimetres.'],
        ['marginMm', -1, 'The margin must be zero or a positive number of millimetres.'],
        ['gapMm', -0.5, 'The spacing must be zero or a positive number of millimetres.'],
        ['dpi', 71, 'The DPI must be a whole number between 72 and 1200.'],
        ['dpi', 1201, 'The DPI must be a whole number between 72 and 1200.'],
        ['dpi', 300.5, 'The DPI must be a whole number between 72 and 1200.'],
        ['copies', 0, 'The number of copies must be a whole number of one or more.'],
        ['copies', 2.5, 'The number of copies must be a whole number of one or more.'],
        ['orientation', 'sideways', 'Orientation must be auto, portrait, or landscape.'],
        ['guides', 'dotted', 'Cut guides must be none, corners, or lines.'],
    ])('refuses %s = %p in words', (field, value, error) => {
        const layout = sheet({ [field]: value });

        expect(layout.ok).toBe(false);
        expect(layout.error).toBe(error);
    });

    it('accepts the numbers as strings, because a form posts strings', () => {
        const layout = layoutSheet({
            paperWidthMm: '101.6',
            paperHeightMm: '152.4',
            photoWidthMm: '50.8',
            photoHeightMm: '50.8',
            dpi: '300',
            marginMm: '5',
            gapMm: '3',
            copies: '2',
            orientation: 'portrait',
        });

        expect(layout.ok).toBe(true);
        expect(layout.copies).toBe(2);
        expect(layout.paper.widthPx).toBe(1200);
    });
});

/* -------------------------------------------------------------- guides */

describe('cut guides', () => {
    it('draws nothing when they are off', () => {
        const layout = ok({ guides: 'none' });

        expect(layout.guides.style).toBe('none');
        expect(layout.guides.marks).toEqual([]);
    });

    it('draws four corner ticks per cell, every one of them outside the cell', () => {
        const layout = ok({ guides: 'corners', orientation: 'portrait' });
        const tick = pixelsFor(CORNER_MARK_MM, 'mm', 300);

        expect(tick).toBe(35);
        expect(layout.guides.marks).toHaveLength(4 * layout.cells.length);

        const first = layout.guides.marks.slice(0, 4);
        expect(first).toEqual([
            // Alternating around the cell, so all four cut lines are marked
            // with four ticks: top edge, right edge, bottom edge, left edge.
            { x1: 265, y1: 282, x2: 300, y2: 282 },
            { x1: 900, y1: 247, x2: 900, y2: 282 },
            { x1: 900, y1: 882, x2: 935, y2: 882 },
            { x1: 300, y1: 882, x2: 300, y2: 917 },
        ]);
    });

    it('shortens a tick rather than letting it run into the neighbouring photo', () => {
        // A 1 mm gap is 12 px at 300 DPI, shorter than the 35 px tick.
        const layout = ok({ guides: 'corners', gapMm: 1, orientation: 'portrait' });

        expect(layout.gapPx).toBe(12);

        const lengths = layout.guides.marks.map((mark) => (
            Math.abs(mark.x2 - mark.x1) + Math.abs(mark.y2 - mark.y1)
        ));
        expect(Math.max(...lengths)).toBe(35);
        expect(lengths).toContain(12);
    });

    it('draws full-sheet lines along every cell edge, and none of them crosses a photo', () => {
        const layout = ok({ guides: 'lines', orientation: 'portrait' });

        expect(layout.guides.marks).toEqual([
            { x1: 299, y1: 0, x2: 299, y2: 1800 },
            { x1: 900, y1: 0, x2: 900, y2: 1800 },
            { x1: 0, y1: 281, x2: 1200, y2: 281 },
            { x1: 0, y1: 882, x2: 1200, y2: 882 },
            { x1: 0, y1: 916, x2: 1200, y2: 916 },
            { x1: 0, y1: 1517, x2: 1200, y2: 1517 },
        ]);
    });

    it('drops a line that would have to run through a photo, which is what a zero gap means', () => {
        const layout = ok({ guides: 'lines', marginMm: 0, gapMm: 0, orientation: 'landscape' });

        // Six cells covering the paper edge to edge: every inside line would
        // cross a photo, and every outside one would paint its own thickness
        // past the edge of the sheet. So there is no line to draw at all — a
        // mark kept here is invisible on the JPEG and visible in the PDF and
        // the preview, which is three renderers disagreeing about one sheet.
        expect(layout.guides.marks).toEqual([]);
    });

    it('drops a line whose own thickness would land off the paper, and keeps the rest', () => {
        // 600 x 500 px photos on an 1800 x 1200 px sheet with no margin and no
        // gap: the columns fill the width exactly, so the line at x = 1800
        // would paint its single pixel at 1800 — off the paper — while the
        // rows leave 100 px top and bottom for two real lines.
        const layout = ok({ guides: 'lines', photoHeightMm: 42.33, marginMm: 0, gapMm: 0, orientation: 'landscape' });

        expect(layout.photo.heightPx).toBe(500);
        expect(layout.cells).toHaveLength(6);
        expect(layout.guides.marks).toEqual([
            { x1: 0, y1: 99, x2: 1800, y2: 99 },
            { x1: 0, y1: 1100, x2: 1800, y2: 1100 },
        ]);
    });

    it('thickens the line at high resolutions so a guide is still visible on paper', () => {
        expect(ok({ dpi: 300 }).guides.thicknessPx).toBe(1);
        expect(ok({ dpi: 399 }).guides.thicknessPx).toBe(1);
        expect(ok({ dpi: 400 }).guides.thicknessPx).toBe(2);
        expect(ok({ dpi: 600 }).guides.thicknessPx).toBe(2);
    });
});

/* ----------------------------------------------------------- reference */

describe('the 50 mm reference line', () => {
    it('sits centred in the bottom margin with end ticks, below every photo', () => {
        const layout = ok({ orientation: 'portrait' });
        const length = pixelsFor(REFERENCE_MM, 'mm', 300);

        expect(length).toBe(591);
        expect(layout.reference).toEqual({
            x1: 305,
            y1: 1770,
            x2: 896,
            y2: 1770,
            lengthMm: 50,
            lengthPx: 591,
            tickPx: 35,
        });

        const lowestCell = Math.max(...layout.cells.map((cell) => cell.y + cell.height));
        expect(layout.reference.y1).toBeGreaterThan(lowestCell);
        expect(layout.reference.y1).toBeLessThan(layout.paper.heightPx);
    });

    it('is exactly 50 mm of real paper at whatever DPI is asked for', () => {
        for (const dpi of [72, 150, 300, 600, 1200]) {
            const layout = ok({ dpi, orientation: 'portrait' });
            const mm = (layout.reference.x2 - layout.reference.x1) / dpi * 25.4;
            expect(mm).toBeCloseTo(50, 0);
        }
    });

    it('is left out when it is not asked for', () => {
        expect(ok({ reference: false }).reference).toBeNull();
    });

    it('is left out when the margin is too thin to hold it', () => {
        expect(ok({ marginMm: 3.9 }).reference).toBeNull();
        expect(ok({ marginMm: 4 }).reference).not.toBeNull();
    });

    it('is left out on paper too narrow to carry 50 mm', () => {
        const narrow = layoutSheet({
            paperWidthMm: 59,
            paperHeightMm: 200,
            photoWidthMm: 20,
            photoHeightMm: 20,
        });

        expect(narrow.ok).toBe(true);
        expect(narrow.reference).toBeNull();
    });
});

/* ---------------------------------------------------------------- rects */

/**
 * The rectangles are the contract between the four renderers. A mark is a
 * segment with no thickness of its own, so before this pair of helpers the
 * compositor grew it rightward and downward into a rectangle while the PDF
 * writer centred a stroke on it — the same measuring line coming out 50.04 mm
 * on the JPEG and 50.4 mm on the PDF, on the one page that tells people to
 * check it with a ruler.
 */
describe('the rectangles every renderer paints', () => {
    function onPaper(rect, layout) {
        return rect.x >= 0 && rect.y >= 0
            && rect.x + rect.width <= layout.paper.widthPx
            && rect.y + rect.height <= layout.paper.heightPx;
    }

    function meetsACell(rect, layout) {
        return layout.cells.some((cell) => (
            rect.x < cell.x + cell.width && rect.x + rect.width > cell.x
            && rect.y < cell.y + cell.height && rect.y + rect.height > cell.y
        ));
    }

    it('turns every mark into the rectangle the compositor fills', () => {
        const layout = ok({ guides: 'lines', orientation: 'portrait' });

        expect(guideRects(layout)).toEqual([
            { x: 299, y: 0, width: 1, height: 1800 },
            { x: 900, y: 0, width: 1, height: 1800 },
            { x: 0, y: 281, width: 1200, height: 1 },
            { x: 0, y: 882, width: 1200, height: 1 },
            { x: 0, y: 916, width: 1200, height: 1 },
            { x: 0, y: 1517, width: 1200, height: 1 },
        ]);
    });

    it('grows a thick guide rightward and downward, up to the photo and not into it', () => {
        const layout = ok({ guides: 'lines', orientation: 'portrait', dpi: 600 });
        const [left] = guideRects(layout);

        expect(layout.guides.thicknessPx).toBe(2);
        expect(left).toEqual({ x: 598, y: 0, width: 2, height: 3600 });
        expect(left.x + left.width).toBe(layout.cells[0].x);
    });

    it('draws the measuring line as a bar with a tick standing inside each end', () => {
        const layout = ok({ orientation: 'portrait' });

        expect(referenceRects(layout)).toEqual([
            { x: 305, y: 1770, width: 591, height: 2 },
            { x: 305, y: 1753, width: 2, height: 35 },
            { x: 894, y: 1753, width: 2, height: 35 },
        ]);
    });

    it('measures 50 mm outer edge to outer edge, at every resolution', () => {
        for (const dpi of [72, 150, 300, 600, 1200]) {
            const layout = ok({ dpi, orientation: 'portrait' });
            const [, first, last] = referenceRects(layout);

            // What a ruler laid across the printed line actually spans.
            expect(last.x + last.width - first.x).toBe(layout.reference.lengthPx);
            expect(layout.reference.lengthPx).toBe(pixelsFor(REFERENCE_MM, 'mm', dpi));
        }
    });

    it('keeps every rectangle on the paper and off every photo', () => {
        for (const guides of GUIDE_STYLES) {
            for (const dpi of [72, 150, 300, 600]) {
                for (const extra of [{}, { marginMm: 0, gapMm: 0 }, { copies: 1 }, { gapMm: 1 }]) {
                    const layout = ok({ guides, dpi, ...extra });
                    const rects = [...guideRects(layout), ...referenceRects(layout)];
                    const where = `${guides} at ${dpi} DPI ${JSON.stringify(extra)}`;

                    for (const rect of rects) {
                        expect(rect.width > 0 && rect.height > 0, where).toBe(true);
                        expect(onPaper(rect, layout), `${where}: ${JSON.stringify(rect)}`).toBe(true);
                        expect(meetsACell(rect, layout), `${where}: ${JSON.stringify(rect)}`).toBe(false);
                    }
                }
            }
        }
    });

    it('has nothing to paint without a layout, without guides and without a line', () => {
        expect(guideRects(null)).toEqual([]);
        expect(guideRects(sheet({ photoWidthMm: 120, photoHeightMm: 120 }))).toEqual([]);
        expect(guideRects(ok({ guides: 'none' }))).toEqual([]);
        expect(referenceRects(null)).toEqual([]);
        expect(referenceRects(ok({ reference: false }))).toEqual([]);
    });
});

/* -------------------------------------------------------------- summary */

describe('the summary and the sentences built from it', () => {
    it('names the sheet, the pixels, the DPI, the photo, the copies and the orientation', () => {
        const layout = ok({ orientation: 'landscape', marginMm: 0, gapMm: 0 });

        expect(layout.summary).toEqual({
            paper: '4 × 6 in',
            pixels: '1800 × 1200 px',
            dpi: 300,
            photo: '2 × 2 in',
            copies: 6,
            orientation: 'Landscape',
        });
    });

    it('names a sheet in inches only when both sides are exact eighths of an inch', () => {
        expect(describeSheetSize(101.6, 152.4)).toBe('4 × 6 in');
        expect(describeSheetSize(215.9, 279.4)).toBe('8.5 × 11 in');
        expect(describeSheetSize(210, 297)).toBe('210 × 297 mm');
        expect(describeSheetSize(35, 45)).toBe('35 × 45 mm');
        expect(describeSheetSize(50.8, 50.8)).toBe('2 × 2 in');
    });

    it('reads the sheet out as one accessible sentence', () => {
        expect(describeLayout(ok({ orientation: 'landscape', marginMm: 0, gapMm: 0 }))).toBe(
            '4 × 6 in sheet, landscape, 6 copies of a 2 × 2 in photo in 3 columns and 2 rows at 300 DPI.',
        );
    });

    it('says one copy, one column and one row without an s on them', () => {
        const layout = layoutSheet({ ...FOUR_BY_SIX, photoWidthMm: 80, photoHeightMm: 120 });

        expect(describeLayout(layout)).toBe(
            '4 × 6 in sheet, portrait, 1 copy of a 80 × 120 mm photo in 1 column and 1 row at 300 DPI.',
        );
    });

    it('builds a download suffix with no dots in it', () => {
        expect(sheetFilenameSuffix(ok())).toBe('4x6in-300dpi');
        expect(sheetFilenameSuffix(layoutSheet({ ...A4, ...UK }))).toBe('210x297mm-300dpi');
        expect(sheetFilenameSuffix(layoutSheet({ ...LETTER, ...US, dpi: 600 }))).toBe('216x279mm-600dpi');
    });
});

/* ---------------------------------------------------------- enlargement */

describe('sourceEnlargement', () => {
    it('reports the blow-up when the kept source region is smaller than the printed photo', () => {
        expect(sourceEnlargement({
            keptWidth: 300,
            keptHeight: 300,
            photoWidthPx: 600,
            photoHeightPx: 600,
        })).toEqual({ from: { width: 300, height: 300 }, to: { width: 600, height: 600 } });
    });

    it('reports nothing when the source is at least as big on both sides', () => {
        expect(sourceEnlargement({
            keptWidth: 1200,
            keptHeight: 1200,
            photoWidthPx: 600,
            photoHeightPx: 600,
        })).toBeNull();

        expect(sourceEnlargement({
            keptWidth: 600,
            keptHeight: 600,
            photoWidthPx: 600,
            photoHeightPx: 600,
        })).toBeNull();
    });

    it('reports it when only one side is short', () => {
        expect(sourceEnlargement({
            keptWidth: 900,
            keptHeight: 400,
            photoWidthPx: 600,
            photoHeightPx: 600,
        })).toEqual({ from: { width: 900, height: 400 }, to: { width: 600, height: 600 } });
    });

    it('reports nothing for numbers it cannot use', () => {
        expect(sourceEnlargement({ keptWidth: 0, keptHeight: 300, photoWidthPx: 600, photoHeightPx: 600 }))
            .toBeNull();
        expect(sourceEnlargement()).toBeNull();
    });
});

/* ---------------------------------------------------------- determinism */

describe('determinism', () => {
    it('returns a deep-equal layout for the same request twice', () => {
        expect(layoutSheet({ ...A4, ...UK })).toEqual(layoutSheet({ ...A4, ...UK }));
    });
});

/* ------------------------------------------------------ partial fills */

describe('a partial fill is centred as the block it actually uses', () => {
    it('centres a single copy on the sheet', () => {
        const layout = ok({ copies: 1 });
        expect(layout.cells).toHaveLength(1);
        expect(layout.cells[0]).toMatchObject({ x: 300, y: 600 });
    });

    it('centres the rows a partial fill uses and fills them row-major', () => {
        const layout = ok({ ...UK, copies: 4 });
        expect(layout.orientation).toBe('portrait');
        expect(layout.cells.map(({ x, y }) => [x, y])).toEqual([
            [169, 351], [617, 351],
            [169, 917], [617, 917],
        ]);
    });
});

describe('sourceEnlargement under Fit inside', () => {
    it('does not warn when the source is larger than the size it will be drawn at', () => {
        expect(sourceEnlargement({
            keptWidth: 500, keptHeight: 500, photoWidthPx: 413, photoHeightPx: 531, fit: 'contain',
        })).toBeNull();
    });

    it('reports the drawn size, not the cell, when the source must be enlarged', () => {
        expect(sourceEnlargement({
            keptWidth: 300, keptHeight: 300, photoWidthPx: 413, photoHeightPx: 531, fit: 'contain',
        })).toEqual({ from: { width: 300, height: 300 }, to: { width: 413, height: 413 } });
    });
});

/* ------------------------------------------------- thick lines, ceilings */

describe('a thick line sits entirely outside the photo', () => {
    it('moves the left and top lines out by their own thickness at 600 DPI', () => {
        const layout = ok({ guides: 'lines', orientation: 'portrait', dpi: 600 });

        expect(layout.guides.thicknessPx).toBe(2);
        expect(layout.cells.map(({ x, y }) => [x, y])).toEqual([[600, 564], [600, 1835]]);
        expect(layout.guides.marks).toEqual([
            { x1: 598, y1: 0, x2: 598, y2: 3600 },
            { x1: 1800, y1: 0, x2: 1800, y2: 3600 },
            { x1: 0, y1: 562, x2: 2400, y2: 562 },
            { x1: 0, y1: 1764, x2: 2400, y2: 1764 },
            { x1: 0, y1: 1833, x2: 2400, y2: 1833 },
            { x1: 0, y1: 3035, x2: 2400, y2: 3035 },
        ]);
    });
});

describe('maxSheetDpi', () => {
    const LIMITS = { maxDimension: 8000, maxPixels: 40_000_000 };

    it('is the highest DPI whose sheet stays under both the long-side and the pixel budgets', () => {
        expect(maxSheetDpi(FOUR_BY_SIX, LIMITS)).toBe(1290);
        expect(maxSheetDpi({ paperWidthMm: 127, paperHeightMm: 177.8 }, LIMITS)).toBe(1069);
        expect(maxSheetDpi(LETTER, LIMITS)).toBe(654);
        expect(maxSheetDpi(A4, LIMITS)).toBe(643);
    });

    it('lays out within the budgets at the ceiling and past them one DPI above', () => {
        // 4 x 6 is left out: its ceiling (1290) is above MAX_SHEET_DPI, so no
        // layout exists one DPI above it to compare against.
        for (const paper of [A4, LETTER]) {
            const ceiling = maxSheetDpi(paper, LIMITS);
            const at = layoutSheet({ ...paper, ...US, dpi: ceiling });
            const above = layoutSheet({ ...paper, ...US, dpi: ceiling + 1 });
            expect(Math.max(at.paper.widthPx, at.paper.heightPx)).toBeLessThanOrEqual(8000);
            expect(at.paper.widthPx * at.paper.heightPx).toBeLessThanOrEqual(40_000_000);
            expect(
                Math.max(above.paper.widthPx, above.paper.heightPx) > 8000
                    || above.paper.widthPx * above.paper.heightPx > 40_000_000,
            ).toBe(true);
        }
    });

    it('returns null without a paper', () => {
        expect(maxSheetDpi({}, LIMITS)).toBeNull();
    });
});

describe('a refusal names the field it belongs to', () => {
    it.each([
        ['dpi', { dpi: 5000 }],
        ['margin', { marginMm: -1 }],
        ['gap', { gapMm: 'abc' }],
        ['copies', { copies: 0 }],
        ['photo', { photoWidthMm: 0 }],
        ['photo', { photoWidthMm: 9.9 }],
        ['photo', { photoWidthMm: 120, photoHeightMm: 120 }],
        ['paper', { paperWidthMm: -5 }],
        ['orientation', { orientation: 'sideways' }],
        ['guides', { guides: 'dots' }],
    ])('%s', (field, overrides) => {
        const layout = sheet(overrides);
        expect(layout.ok).toBe(false);
        expect(layout.field).toBe(field);
    });
});
