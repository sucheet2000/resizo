/**
 * The layout model's invariants, over three hundred generated sheets.
 *
 * The example tests next door pin the cases somebody thought of — 2 x 2 in on
 * 4 x 6 in, 35 x 45 mm on A4, a zero margin. These pin the ones nobody did:
 * every paper against every photo shape, DPIs from screen resolution to six
 * hundred, margins and gaps that round to nothing and margins that eat the
 * sheet, copies asked for in numbers nothing can hold.
 *
 * WHY THESE STATEMENTS AND NOT OTHERS. Each one is something a person would
 * notice on paper after they had already printed. A cell off the edge is a
 * photo with a white bite out of it; two cells overlapping is a photo printed
 * on top of another; a guide across a face is a grey line through somebody's
 * passport photo; a sheet whose capacity goes UP when you widen the margin is
 * arithmetic that has stopped meaning anything. None of them can be caught by
 * looking at a number in a panel, which is why they are checked here and again
 * from the finished bytes in tests/lib/image-client/sheet.test.js.
 *
 * NON-VACUITY IS PROVED, NOT ASSUMED. Every structural predicate below is a
 * named function, and the first describe block feeds each one a deliberately
 * broken layout and requires it to say no. A property suite whose predicates
 * cannot fail is three hundred green ticks that mean nothing.
 *
 * No new dependency: the generator is a seeded mulberry32, so a failure here
 * reproduces exactly from the case index printed with it.
 */
import { describe, expect, it } from 'vitest';

import { PAPER_SIZES } from '@/lib/catalog/paper-sizes';
import {
    GUIDE_STYLES,
    MIN_PHOTO_MM,
    ORIENTATIONS,
    layoutSheet,
    referenceTickRange,
} from '@/lib/format/print-sheet';

const RUNS = 300;

/** A seeded PRNG, so every case in this file is reproducible from its index. */
function mulberry32(seed) {
    let a = seed >>> 0;
    return function next() {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function pick(rand, list) {
    return list[Math.floor(rand() * list.length)];
}

function between(rand, low, high) {
    return low + Math.floor(rand() * (high - low + 1));
}

/** Half the lengths land on a half millimetre, which is where rounding bites. */
function millimetres(rand, low, high) {
    const whole = between(rand, low, high);
    return rand() < 0.5 ? whole : whole + 0.5;
}

function generateRequest(rand) {
    const first = millimetres(rand, 60, 320);
    const second = millimetres(rand, 60, 320);

    return {
        paperWidthMm: first,
        paperHeightMm: second,
        photoWidthMm: millimetres(rand, 15, 100),
        photoHeightMm: millimetres(rand, 15, 100),
        dpi: pick(rand, [72, 96, 120, 150, 200, 240, 300, 360, 400, 500, 600]),
        marginMm: millimetres(rand, 0, 15),
        gapMm: millimetres(rand, 0, 10),
        orientation: pick(rand, ORIENTATIONS),
        guides: pick(rand, GUIDE_STYLES),
        copies: rand() < 0.4 ? 'auto' : between(rand, 1, 40),
        reference: rand() < 0.8,
    };
}

/** The three hundred requests, and the layouts they produce, built once. */
const CASES = (() => {
    const rand = mulberry32(20260910);
    const list = [];
    for (let index = 0; index < RUNS; index += 1) {
        const request = generateRequest(rand);
        list.push({ index, request, layout: layoutSheet(request) });
    }
    return list;
})();

const ACCEPTED = CASES.filter((entry) => entry.layout.ok === true);

/** Case `index` printed with every failure, so a red run reproduces exactly. */
function label(entry) {
    return `case ${entry.index}: ${JSON.stringify(entry.request)}`;
}

function forEachAccepted(check) {
    for (const entry of ACCEPTED) {
        const problem = check(entry.layout);
        expect(problem, `${label(entry)} — ${problem}`).toBeNull();
    }
}

/* ------------------------------------------------------- the predicates */

/** Every cell sits wholly on the paper. */
function cellsOnPaper(layout) {
    for (const cell of layout.cells) {
        if (cell.x < 0 || cell.y < 0) return `cell ${cell.index} starts off the paper`;
        if (cell.x + cell.width > layout.paper.widthPx) return `cell ${cell.index} runs off the right edge`;
        if (cell.y + cell.height > layout.paper.heightPx) return `cell ${cell.index} runs off the bottom edge`;
    }
    return null;
}

/** No two cells share a pixel. */
function cellsDisjoint(layout) {
    const cells = layout.cells;
    for (let a = 0; a < cells.length; a += 1) {
        for (let b = a + 1; b < cells.length; b += 1) {
            const one = cells[a];
            const two = cells[b];
            const apart = one.x + one.width <= two.x
                || two.x + two.width <= one.x
                || one.y + one.height <= two.y
                || two.y + two.height <= one.y;
            if (!apart) return `cells ${a} and ${b} overlap`;
        }
    }
    return null;
}

/** Every cell is the photo's size, to the pixel. */
function cellsUniform(layout) {
    for (const cell of layout.cells) {
        if (cell.width !== layout.photo.widthPx || cell.height !== layout.photo.heightPx) {
            return `cell ${cell.index} is ${cell.width} × ${cell.height}, not the photo size`;
        }
    }
    return null;
}

/** The counts agree with each other and with the cells actually laid out. */
function countsAgree(layout) {
    if (!Number.isInteger(layout.capacity) || layout.capacity < 0) return 'capacity is not a whole number';
    if (layout.capacity !== layout.columns * layout.rows) return 'capacity is not columns × rows';
    if (layout.copies > layout.capacity) return `${layout.copies} copies asked of a ${layout.capacity} sheet`;
    if (layout.copies < 1) return 'an accepted layout with no copies';
    if (layout.cells.length !== layout.copies) return 'the cell count is not the copy count';
    return null;
}

/** No guide mark touches a photo, and none runs off the paper. */
function guidesClear(layout) {
    for (const mark of layout.guides.marks) {
        const left = Math.min(mark.x1, mark.x2);
        const right = Math.max(mark.x1, mark.x2);
        const top = Math.min(mark.y1, mark.y2);
        const bottom = Math.max(mark.y1, mark.y2);

        if (left < 0 || top < 0) return 'a guide starts off the paper';
        if (right > layout.paper.widthPx || bottom > layout.paper.heightPx) {
            return 'a guide runs off the paper';
        }

        for (const cell of layout.cells) {
            const overlapsX = left < cell.x + cell.width && Math.max(right, left + 1) > cell.x;
            const overlapsY = top < cell.y + cell.height && Math.max(bottom, top + 1) > cell.y;
            if (overlapsX && overlapsY) return `a guide crosses cell ${cell.index}`;
        }
    }
    return null;
}

/** The measuring line and its end ticks stay on the paper and below every photo. */
function referenceClear(layout) {
    const line = layout.reference;
    if (line === null) return null;

    if (line.x1 < 0 || line.x2 > layout.paper.widthPx) return 'the reference line runs off the paper';

    const tick = referenceTickRange(line);
    if (tick.top < 0 || tick.bottom > layout.paper.heightPx) return 'a reference tick runs off the paper';

    for (const cell of layout.cells) {
        if (tick.top < cell.y + cell.height && tick.bottom > cell.y) {
            return `the reference line overlaps cell ${cell.index}`;
        }
    }
    return null;
}

/* ------------------------------------------ the predicates can say "no" */

describe('the predicates themselves', () => {
    const healthy = layoutSheet({
        paperWidthMm: 101.6,
        paperHeightMm: 152.4,
        photoWidthMm: 50.8,
        photoHeightMm: 50.8,
        guides: 'corners',
    });

    /** A layout with one field bent, built by hand so the mutation is visible. */
    function mutate(change) {
        const copy = structuredClone(healthy);
        change(copy);
        return copy;
    }

    it('found a healthy layout to mutate', () => {
        expect(healthy.ok).toBe(true);
        expect(healthy.cells.length).toBeGreaterThan(1);
        expect(healthy.guides.marks.length).toBeGreaterThan(0);
        expect(healthy.reference).not.toBeNull();
    });

    it('catches a cell pushed one pixel off the paper', () => {
        // The mutation: the last cell moves down by one pixel, so its bottom
        // edge lands one past the last row of the sheet.
        const broken = mutate((layout) => {
            const last = layout.cells[layout.cells.length - 1];
            last.y = layout.paper.heightPx - last.height + 1;
        });

        expect(cellsOnPaper(healthy)).toBeNull();
        expect(cellsOnPaper(broken)).toMatch(/runs off the bottom edge/);
    });

    it('catches two cells laid on top of each other', () => {
        // The mutation: the second cell is moved onto the first.
        const broken = mutate((layout) => {
            layout.cells[1].y = layout.cells[0].y;
            layout.cells[1].x = layout.cells[0].x;
        });

        expect(cellsDisjoint(healthy)).toBeNull();
        expect(cellsDisjoint(broken)).toMatch(/overlap/);
    });

    it('catches a cell that is not the photo size', () => {
        // The mutation: one cell is widened by a pixel.
        const broken = mutate((layout) => { layout.cells[0].width += 1; });

        expect(cellsUniform(healthy)).toBeNull();
        expect(cellsUniform(broken)).toMatch(/not the photo size/);
    });

    it('catches a copy count that does not match the cells', () => {
        // The mutation: a cell is dropped while the sheet still claims it.
        const broken = mutate((layout) => { layout.cells.pop(); });

        expect(countsAgree(healthy)).toBeNull();
        expect(countsAgree(broken)).toMatch(/cell count is not the copy count/);
    });

    it('catches a guide drawn across a photo', () => {
        // The mutation: a mark is dragged into the middle of the first cell.
        const broken = mutate((layout) => {
            const cell = layout.cells[0];
            layout.guides.marks.push({
                x1: cell.x + 10,
                y1: cell.y + 10,
                x2: cell.x + 20,
                y2: cell.y + 10,
            });
        });

        expect(guidesClear(healthy)).toBeNull();
        expect(guidesClear(broken)).toMatch(/crosses cell 0/);
    });

    it('catches a reference line dragged up onto the photos', () => {
        // The mutation: the measuring line moves to the first cell's middle row.
        const broken = mutate((layout) => {
            const cell = layout.cells[0];
            layout.reference.y1 = cell.y + Math.floor(cell.height / 2);
            layout.reference.y2 = layout.reference.y1;
        });

        expect(referenceClear(healthy)).toBeNull();
        expect(referenceClear(broken)).toMatch(/overlaps cell 0/);
    });
});

/* --------------------------------------------- the generator is honest */

describe('the generated sheets', () => {
    it('are a mix of accepted and refused, not three hundred of one kind', () => {
        expect(CASES).toHaveLength(RUNS);
        expect(ACCEPTED.length).toBeGreaterThan(RUNS / 3);
        expect(CASES.length - ACCEPTED.length).toBeGreaterThan(5);
    });

    it('cover every guide style, both orientations and a clamped copy count', () => {
        const styles = new Set(ACCEPTED.map((entry) => entry.layout.guides.style));
        const orientations = new Set(ACCEPTED.map((entry) => entry.layout.orientation));

        expect([...styles].sort()).toEqual(['corners', 'lines', 'none']);
        expect([...orientations].sort()).toEqual(['landscape', 'portrait']);
        expect(ACCEPTED.some((entry) => entry.layout.clamped)).toBe(true);
        expect(ACCEPTED.some((entry) => entry.layout.reference !== null)).toBe(true);
        expect(ACCEPTED.some((entry) => entry.layout.guides.marks.length > 0)).toBe(true);
    });

    it('always answer with either a layout or a sentence, never both and never neither', () => {
        for (const entry of CASES) {
            if (entry.layout.ok) {
                expect(entry.layout.error, label(entry)).toBeUndefined();
            } else {
                expect(typeof entry.layout.error, label(entry)).toBe('string');
                expect(entry.layout.error.endsWith('.'), label(entry)).toBe(true);
            }
        }
    });
});

/* ------------------------------------------------------- the invariants */

describe('every accepted sheet', () => {
    it('keeps every cell on the paper', () => {
        forEachAccepted(cellsOnPaper);
    });

    it('never overlaps two cells', () => {
        forEachAccepted(cellsDisjoint);
    });

    it('gives every cell the same size, and it is the photo size', () => {
        forEachAccepted(cellsUniform);
    });

    it('keeps the capacity, the copies and the cells in agreement', () => {
        forEachAccepted(countsAgree);
    });

    it('keeps every cut guide off every photo and on the paper', () => {
        forEachAccepted(guidesClear);
    });

    it('keeps the measuring line and its ticks in the margin', () => {
        forEachAccepted(referenceClear);
    });

    it('lays out a number of cells a tab can actually build', () => {
        forEachAccepted((layout) => (
            layout.cells.length <= CELL_CEILING ? null : `${layout.cells.length} cells`
        ));
    });

    it('lays the copies out row-major with no gaps in the sequence', () => {
        forEachAccepted((layout) => {
            for (const cell of layout.cells) {
                if (cell.column !== cell.index % layout.columns) return `cell ${cell.index} is in the wrong column`;
                if (cell.row !== Math.floor(cell.index / layout.columns)) return `cell ${cell.index} is in the wrong row`;
            }
            return null;
        });
    });
});

/* ------------------------------------------------------- monotonicity */

/** Capacity, with a refusal read as the zero it is. */
function capacityOf(request) {
    const layout = layoutSheet(request);
    return layout.ok ? layout.capacity : 0;
}

describe('capacity moves the way paper does', () => {
    it('never rises when the margin grows', () => {
        for (const entry of CASES) {
            const wider = { ...entry.request, marginMm: entry.request.marginMm + 2 };
            expect(capacityOf(wider), label(entry)).toBeLessThanOrEqual(capacityOf(entry.request));
        }
    });

    it('never rises when the photo grows', () => {
        for (const entry of CASES) {
            const bigger = {
                ...entry.request,
                photoWidthMm: entry.request.photoWidthMm + 3,
                photoHeightMm: entry.request.photoHeightMm + 3,
            };
            expect(capacityOf(bigger), label(entry)).toBeLessThanOrEqual(capacityOf(entry.request));
        }
    });

    it('never falls when the paper grows', () => {
        for (const entry of CASES) {
            const bigger = {
                ...entry.request,
                paperWidthMm: entry.request.paperWidthMm + 10,
                paperHeightMm: entry.request.paperHeightMm + 10,
            };
            expect(capacityOf(bigger), label(entry)).toBeGreaterThanOrEqual(capacityOf(entry.request));
        }
    });

    it('never falls when the gap shrinks to nothing', () => {
        for (const entry of CASES) {
            const tight = { ...entry.request, gapMm: 0 };
            expect(capacityOf(tight), label(entry)).toBeGreaterThanOrEqual(capacityOf(entry.request));
        }
    });
});

/* ----------------------------------------------------------- resolution */

describe('the same sheet at a different resolution', () => {
    /**
     * The physical request, with the orientation pinned so the comparison is
     * about DPI and not about which way up 'auto' turned the paper.
     */
    function physical(entry, dpi) {
        return layoutSheet({ ...entry.request, orientation: 'portrait', dpi });
    }

    it('describes the same page in points whatever the DPI', () => {
        for (const entry of CASES) {
            const low = physical(entry, 150);
            const high = physical(entry, 600);
            if (!low.ok || !high.ok) continue;

            expect(high.paper.widthPt, label(entry)).toBeCloseTo(low.paper.widthPt, 9);
            expect(high.paper.heightPt, label(entry)).toBeCloseTo(low.paper.heightPt, 9);
        }
    });

    /**
     * Capacity is a floor, and every length either side of it is rounded
     * independently, so doubling the DPI can land one case on the other side of
     * a boundary — 4.999 photos becoming 5.001. It can move by ONE and no more,
     * and this is the statement that says so out loud rather than pretending
     * integer capacity is exactly scale-invariant.
     */
    it('never changes the grid by more than one row or column', () => {
        for (const entry of CASES) {
            const low = physical(entry, 300);
            const high = physical(entry, 600);
            if (!low.ok || !high.ok) continue;

            expect(Math.abs(high.columns - low.columns), label(entry)).toBeLessThanOrEqual(1);
            expect(Math.abs(high.rows - low.rows), label(entry)).toBeLessThanOrEqual(1);
        }
    });

    /**
     * WHY THE TOLERANCE GROWS WITH THE GRID, and why it is derived rather than
     * picked. A cell origin is marginPx + floor(leftover / 2) + k x (photoPx +
     * gapPx), and every one of those pixel values was rounded on its own — so
     * the paper contributes up to half a pixel, the photo and the gap up to
     * half a pixel EACH PER COLUMN either side of the block's centre, and the
     * floor one more. That is (count / 2 + 1.25) pixels at each resolution,
     * and the two resolutions can lean opposite ways:
     *
     *     (count / 2 + 1.25) x 25.4 x (1 / 300 + 1 / 600) millimetres
     *
     * Measured over these three hundred sheets the worst case is 0.381 mm on a
     * wide grid, which is inside that bound and well inside what a home printer
     * registers. A flat one-pixel tolerance would have been wrong and would
     * have hidden the fact that the error is proportional to the column count.
     */
    it('puts the photos in the same physical place when the grid agrees', () => {
        const tolerance = (count) => (count / 2 + 1.25) * 25.4 * (1 / 300 + 1 / 600);
        let compared = 0;
        let worst = 0;

        for (const entry of CASES) {
            const low = physical(entry, 300);
            const high = physical(entry, 600);
            if (!low.ok || !high.ok) continue;
            if (low.columns !== high.columns || low.rows !== high.rows) continue;
            if (low.copies !== high.copies) continue;

            compared += 1;

            for (let index = 0; index < low.cells.length; index += 1) {
                const a = low.cells[index];
                const b = high.cells[index];
                // Millimetres, not pixels: the two sheets have different pixel
                // counts and the same physical arrangement, which is the claim.
                const dx = Math.abs((b.x / 600) * 25.4 - (a.x / 300) * 25.4);
                const dy = Math.abs((b.y / 600) * 25.4 - (a.y / 300) * 25.4);
                worst = Math.max(worst, dx, dy);

                expect(dx, `${label(entry)} — cell ${index} x`).toBeLessThanOrEqual(tolerance(low.columns));
                expect(dy, `${label(entry)} — cell ${index} y`).toBeLessThanOrEqual(tolerance(low.rows));
            }
        }

        expect(compared).toBeGreaterThan(RUNS / 3);
        // Non-vacuity: the comparison found real disagreement to bound, rather
        // than two identical layouts trivially agreeing to zero.
        expect(worst).toBeGreaterThan(0);
        // And the number that matters to a person holding the paper: nothing
        // moved by half a millimetre, at any resolution, on any of the sheets.
        expect(worst).toBeLessThan(0.5);
    });
});

/* ------------------------------------------------------- the cell ceiling */

/**
 * WHY THERE IS A FLOOR UNDER THE PHOTO SIZE. A layout is an array with one
 * entry per copy, and nothing about the arithmetic stops that array being
 * enormous: a 1 x 1 px photo with no margin and no gap laid out 2,160,000
 * cells on A4 at 300 DPI, and the tab that asked for it never came back. The
 * defence is MIN_PHOTO_MM and nothing else, so it is measured here against the
 * biggest sheet anybody can choose rather than assumed to be enough.
 *
 * 2,000 is not a limit the model enforces — it is a statement about how far
 * the smallest accepted photo is from being a problem. The real worst case,
 * A4 borderless at 10 mm, is 609.
 */
const CELL_CEILING = 2000;

describe('the smallest photo the model accepts is nowhere near enough to freeze a tab', () => {
    const largest = [...PAPER_SIZES]
        .sort((one, two) => two.widthMm * two.heightMm - one.widthMm * one.heightMm)[0];

    function borderless(photoMm, dpi = 300) {
        return layoutSheet({
            paperWidthMm: largest.widthMm,
            paperHeightMm: largest.heightMm,
            photoWidthMm: photoMm,
            photoHeightMm: photoMm,
            marginMm: 0,
            gapMm: 0,
            dpi,
            copies: 'auto',
        });
    }

    it('measures against the largest paper the registry offers', () => {
        expect(largest.id).toBe('a4');
        expect([largest.widthMm, largest.heightMm]).toEqual([210, 297]);
    });

    it('fills that sheet with 21 x 29 photos at the floor, and no more', () => {
        const layout = borderless(MIN_PHOTO_MM);

        expect(layout.ok).toBe(true);
        expect([layout.columns, layout.rows]).toEqual([21, 29]);
        expect(layout.cells).toHaveLength(609);
    });

    it('stays under the ceiling for every photo it accepts, at every resolution', () => {
        let accepted = 0;

        for (const dpi of [72, 96, 150, 300, 600, 1200]) {
            for (let photoMm = MIN_PHOTO_MM; photoMm <= 60; photoMm += 0.5) {
                const layout = borderless(photoMm, dpi);
                if (layout.ok !== true) continue;

                accepted += 1;
                expect(layout.cells.length, `${photoMm} mm at ${dpi} DPI`).toBeLessThanOrEqual(CELL_CEILING);
            }
        }

        // A sweep that accepted nothing would be six hundred green ticks about
        // an empty loop, which is the mistake this whole file is written against.
        expect(accepted).toBeGreaterThan(500);
    });

    it('refuses everything under the floor instead of laying it out', () => {
        for (const photoMm of [0.001, 0.1, 1, 5, 9.9, 9.99]) {
            const layout = borderless(photoMm);

            expect(layout.ok, `${photoMm} mm`).toBe(false);
            expect(layout.field).toBe('photo');
            expect(layout.error).toBe(`The photo must be at least ${MIN_PHOTO_MM} mm on each side.`);
        }
    });
});

/* ---------------------------------------------------------- determinism */

describe('determinism', () => {
    it('answers the same request with a deep-equal layout every time', () => {
        for (const entry of CASES) {
            expect(layoutSheet(entry.request), label(entry)).toEqual(entry.layout);
        }
    });
});
