/**
 * The `sheet` op — several copies of one photo, at an exact physical size, on
 * one piece of paper.
 *
 * WHY THIS TOOL IS ALL ABOUT VERIFICATION. Every other output on this site is
 * judged on a screen: a resize that came out 601 px wide looks the same as one
 * that came out 600. A print sheet is judged with a ruler and a pair of
 * scissors, after the paper has left the printer, and by then nothing can be
 * fixed. So the op is not allowed to report a sheet as correct because it
 * finished without throwing. validateSheet reopens the bytes it produced —
 * with libvips' own header parsers for a JPEG and with pdf-lib for a PDF — and
 * re-checks the layout with code that did not lay it out.
 *
 * THE SIX WAYS THIS CAN GO WRONG SILENTLY, all proved below against a
 * hand-built bad layout or bad bytes rather than assumed:
 *
 *   1. a cell one pixel off the paper       a photo with a white bite out of it
 *   2. two cells on top of each other       one photo printed over another
 *   3. a paper canvas of the wrong size     everything the wrong size on paper
 *   4. a PDF page one point off             "print at 100 %" scaled anyway
 *   5. a copy count that is not the cells   the sheet claims copies it lacks
 *   6. a DPI record that is not the layout  the print dialog picks its own size
 *
 * Each of those must make validateSheet say no, and each has its own test.
 *
 * WHAT THE NUMBERS SAY ABOUT THE DEFAULTS. A 2 x 2 in photo on 4 x 6 in paper
 * fits SIX copies only when the margin and the gap are zero — six 2 x 2 in
 * photos tile a 4 x 6 in sheet exactly. At the 5 mm / 3 mm defaults the same
 * paper fits TWO. Both are exercised: the six-up sheet for the geometry, the
 * two-up default for the white margins there is no room for on the six-up.
 *
 * sharp is the independent reference, as everywhere else in this suite. It is
 * a fixture tool and an oracle; it is never on the path under test.
 */
import sharp from 'sharp';
import { beforeAll, describe, expect, it } from 'vitest';

import { layoutSheet, referenceTickRange } from '@/lib/format/print-sheet';
import { optionsFromFormData } from '@/lib/image-client/form-options';
import { installBrowserEnv } from './helpers/browser-env';
import { makeFile } from './helpers/fixtures';

let runOperation;
let JobError;
let composeSheet;
let validateSheet;
let SHEET_JPEG_QUALITY;
let PDFDocument;

beforeAll(async () => {
    installBrowserEnv();
    ({ runOperation, JobError } = await import('@/lib/image-client/operations'));
    ({ composeSheet, validateSheet, SHEET_JPEG_QUALITY } = await import('@/lib/image-client/sheet'));
    ({ PDFDocument } = await import('@cantoo/pdf-lib'));
}, 60_000);

/* ------------------------------------------------------------- fixtures */

const SOURCE_WIDTH = 900;
const SOURCE_HEIGHT = 1200;

/**
 * Four quadrants in colours a lossy encoder cannot confuse.
 *
 * The shape is the point twice over. The source is 3:4 and every photo below
 * is 1:1, so a cover keeps the middle and the quadrant seam stays dead centre —
 * which means a blit that transposed the rows, read the buffer as BGRA or
 * placed a cell at the wrong offset shows up as a quadrant in the wrong corner
 * rather than as a number being slightly off.
 */
const QUADRANTS = [
    { name: 'red', rgb: [220, 30, 40] },
    { name: 'green', rgb: [30, 170, 60] },
    { name: 'blue', rgb: [40, 60, 200] },
    { name: 'yellow', rgb: [235, 200, 40] },
];

const WHITE = [255, 255, 255];

function quadrantPng({ width = SOURCE_WIDTH, height = SOURCE_HEIGHT } = {}) {
    const half = { width: Math.round(width / 2), height: Math.round(height / 2) };
    const at = [
        { left: 0, top: 0 },
        { left: half.width, top: 0 },
        { left: 0, top: half.height },
        { left: half.width, top: half.height },
    ];

    return sharp({
        create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } },
    })
        .composite(QUADRANTS.map((quadrant, index) => ({
            input: {
                create: {
                    width: half.width,
                    height: half.height,
                    channels: 4,
                    background: {
                        r: quadrant.rgb[0], g: quadrant.rgb[1], b: quadrant.rgb[2], alpha: 1,
                    },
                },
            },
            ...at[index],
        })))
        .png()
        .toBuffer();
}

async function quadrantFile(size) {
    return makeFile(await quadrantPng(size), { name: 'portrait.png', type: 'image/png' });
}

const DEFAULT_OPTIONS = {
    paperWidthMm: '101.6',
    paperHeightMm: '152.4',
    photoWidthMm: '50.8',
    photoHeightMm: '50.8',
    dpi: '300',
    marginMm: '5',
    gapMm: '3',
};

/**
 * The op, driven with the option keys runOperation takes and the STRINGS a
 * form posts, because both halves of that are load-bearing: a page reaches this
 * through optionsFromFormData, and the parsers have to see '5' and '' and
 * 'abc' exactly as they arrived.
 */
async function sheetJob(options = {}, { size } = {}) {
    return runOperation('sheet', await quadrantFile(size), { ...DEFAULT_OPTIONS, ...options });
}

/** The output reopened by libvips, with a pixel accessor in image space. */
async function readBack(blob) {
    const buffer = Buffer.from(await blob.arrayBuffer());
    const meta = await sharp(buffer).metadata();
    const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });

    return {
        format: meta.format,
        density: meta.density,
        width: info.width,
        height: info.height,
        raw: data,
        at(x, y) {
            const offset = (y * info.width + x) * 4;
            return Array.from(data.slice(offset, offset + 4));
        },
    };
}

function distance(pixel, rgb) {
    return Math.abs(pixel[0] - rgb[0]) + Math.abs(pixel[1] - rgb[1]) + Math.abs(pixel[2] - rgb[2]);
}

/** Which of the four quadrant colours (or white) a pixel reads as. */
function colourAt(output, x, y) {
    const pixel = output.at(x, y);
    const candidates = [...QUADRANTS, { name: 'white', rgb: WHITE }];
    return candidates.reduce((best, candidate) => (
        distance(pixel, candidate.rgb) < distance(pixel, best.rgb) ? candidate : best
    )).name;
}

/**
 * The four colours a cell reads as, sampled a quarter in from each corner.
 *
 * The two axes are measured separately on purpose: the contain case below
 * hands this a region that is 360 wide and 600 tall, and taking the vertical
 * offsets off the WIDTH put both rows in the top half of the picture — which
 * read as a passing test twice over.
 */
function quadrantsOf(output, cell) {
    const across = (share) => Math.floor(cell.width * share);
    const down = (share) => Math.floor(cell.height * share);
    return [
        colourAt(output, cell.x + across(0.25), cell.y + down(0.25)),
        colourAt(output, cell.x + across(0.75), cell.y + down(0.25)),
        colourAt(output, cell.x + across(0.25), cell.y + down(0.75)),
        colourAt(output, cell.x + across(0.75), cell.y + down(0.75)),
    ];
}

/** Mean absolute RGB difference between two cell regions of one sheet. */
function cellDifference(output, one, two) {
    let total = 0;
    let counted = 0;

    for (let y = 0; y < one.height; y += 7) {
        for (let x = 0; x < one.width; x += 7) {
            const a = output.at(one.x + x, one.y + y);
            const b = output.at(two.x + x, two.y + y);
            total += Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
            counted += 3;
        }
    }

    return total / counted;
}

/** The same region of the sheet against an independent libvips resample. */
async function differenceFromReference(output, cell, referenceBuffer) {
    const { data } = await sharp(referenceBuffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });

    let total = 0;
    let counted = 0;

    for (let y = 0; y < cell.height; y += 7) {
        for (let x = 0; x < cell.width; x += 7) {
            const sheetPixel = output.at(cell.x + x, cell.y + y);
            const offset = (y * cell.width + x) * 4;
            total += Math.abs(sheetPixel[0] - data[offset])
                + Math.abs(sheetPixel[1] - data[offset + 1])
                + Math.abs(sheetPixel[2] - data[offset + 2]);
            counted += 3;
        }
    }

    return total / counted;
}

async function pagesOf(blob) {
    const loaded = await PDFDocument.load(Buffer.from(await blob.arrayBuffer()), { updateMetadata: false });
    return loaded.getPages().map((page) => ({ widthPt: page.getWidth(), heightPt: page.getHeight() }));
}

function rowOf(checks, key) {
    return checks.find((check) => check.key === key);
}

/* -------------------------------------------------------------------- *
 * 1. The validator refuses six ways, each proved against a broken input
 * -------------------------------------------------------------------- */

describe('validateSheet refuses what a renderer cannot see', () => {
    /** A real 6-up landscape sheet, and the real bytes for it. */
    const layout = layoutSheet({
        paperWidthMm: 101.6,
        paperHeightMm: 152.4,
        photoWidthMm: 50.8,
        photoHeightMm: 50.8,
        orientation: 'landscape',
        marginMm: 0,
        gapMm: 0,
        guides: 'none',
    });

    let bytes;

    beforeAll(async () => {
        expect(layout.ok).toBe(true);
        expect(layout.copies).toBe(6);

        const result = await sheetJob({
            orientation: 'landscape',
            marginMm: '0',
            gapMm: '0',
            guides: 'none',
        });
        bytes = new Uint8Array(await result.blob.arrayBuffer());
    }, 60_000);

    it('passes the sheet it was actually given', async () => {
        const report = await validateSheet(bytes, layout, { output: 'jpeg' });

        expect(report.verified).toBe(true);
        expect(report.checks.map((check) => check.key)).toEqual([
            'paper', 'pixels', 'dpi', 'photo', 'copies', 'output',
        ]);
        for (const check of report.checks) {
            expect(check.ok, `${check.key}: ${check.required} vs ${check.actual}`).toBe(true);
        }
    });

    it('refuses a cell that hangs one pixel off the paper', async () => {
        const broken = structuredClone(layout);
        const last = broken.cells[broken.cells.length - 1];
        last.y = broken.paper.heightPx - last.height + 1;

        const report = await validateSheet(bytes, broken, { output: 'jpeg' });

        expect(rowOf(report.checks, 'photo').ok).toBe(false);
        expect(report.verified).toBe(false);
    });

    it('refuses two cells laid on top of each other', async () => {
        const broken = structuredClone(layout);
        broken.cells[1].x = broken.cells[0].x;
        broken.cells[1].y = broken.cells[0].y;

        const report = await validateSheet(bytes, broken, { output: 'jpeg' });

        expect(rowOf(report.checks, 'photo').ok).toBe(false);
        expect(report.verified).toBe(false);
    });

    it('refuses a paper pixel size the file does not have', async () => {
        const broken = structuredClone(layout);
        broken.paper.widthPx += 1;

        const report = await validateSheet(bytes, broken, { output: 'jpeg' });

        expect(rowOf(report.checks, 'pixels').ok).toBe(false);
        expect(rowOf(report.checks, 'pixels').actual).toBe('1800 × 1200 px');
        expect(report.verified).toBe(false);
    });

    it('refuses a copy count the cells do not back up', async () => {
        const broken = structuredClone(layout);
        broken.copies = 7;

        const report = await validateSheet(bytes, broken, { output: 'jpeg' });

        expect(rowOf(report.checks, 'copies').ok).toBe(false);
        expect(rowOf(report.checks, 'copies').actual).toBe('6');
        expect(report.verified).toBe(false);
    });

    it('refuses a DPI record that is not the one the layout asked for', async () => {
        const broken = structuredClone(layout);
        broken.dpi = 600;

        const report = await validateSheet(bytes, broken, { output: 'jpeg' });

        expect(rowOf(report.checks, 'dpi').ok).toBe(false);
        expect(report.verified).toBe(false);
    });

    it('refuses a PDF page one point off the layout', async () => {
        const result = await sheetJob({
            orientation: 'landscape',
            marginMm: '0',
            gapMm: '0',
            guides: 'none',
            output: 'pdf',
        });
        const pdfBytes = new Uint8Array(await result.blob.arrayBuffer());

        const honest = await validateSheet(pdfBytes, layout, { output: 'pdf' });
        expect(honest.verified).toBe(true);

        const broken = structuredClone(layout);
        broken.paper.widthPt += 1;

        const report = await validateSheet(pdfBytes, broken, { output: 'pdf' });
        expect(rowOf(report.checks, 'pixels').ok).toBe(false);
        expect(report.verified).toBe(false);
    }, 60_000);

    it('refuses bytes that are not the format the sheet claims', async () => {
        const report = await validateSheet(bytes, layout, { output: 'pdf' });

        expect(report.verified).toBe(false);
        expect(rowOf(report.checks, 'output').ok).toBe(false);
    });
});

/* -------------------------------------------------------------------- *
 * 2. composeSheet
 * -------------------------------------------------------------------- */

describe('composeSheet', () => {
    const layout = layoutSheet({
        paperWidthMm: 101.6,
        paperHeightMm: 152.4,
        photoWidthMm: 50.8,
        photoHeightMm: 50.8,
        orientation: 'portrait',
        guides: 'corners',
    });

    function photoPixels(rgb = [10, 20, 30]) {
        const data = new Uint8ClampedArray(layout.photo.widthPx * layout.photo.heightPx * 4);
        for (let offset = 0; offset < data.length; offset += 4) {
            data[offset] = rgb[0];
            data[offset + 1] = rgb[1];
            data[offset + 2] = rgb[2];
            data[offset + 3] = 255;
        }
        return new ImageData(data, layout.photo.widthPx, layout.photo.heightPx);
    }

    function pixelAt(canvas, x, y) {
        const offset = (y * canvas.width + x) * 4;
        return Array.from(canvas.data.slice(offset, offset + 4));
    }

    it('paints a paper-sized opaque white canvas and blits the photo at every cell', () => {
        const canvas = composeSheet(layout, photoPixels());

        expect(canvas.width).toBe(layout.paper.widthPx);
        expect(canvas.height).toBe(layout.paper.heightPx);

        for (const cell of layout.cells) {
            expect(pixelAt(canvas, cell.x, cell.y)).toEqual([10, 20, 30, 255]);
            expect(pixelAt(canvas, cell.x + cell.width - 1, cell.y + cell.height - 1))
                .toEqual([10, 20, 30, 255]);
        }

        // A pixel just inside the top-left margin is paper, and fully opaque.
        expect(pixelAt(canvas, 2, 2)).toEqual([255, 255, 255, 255]);
    });

    it('draws the corner guides in the margin and never on a photo', () => {
        const canvas = composeSheet(layout, photoPixels());
        const cell = layout.cells[0];

        // The tick that runs left from the cell's top-left corner.
        expect(pixelAt(canvas, cell.x - 1, cell.y)[0]).toBeLessThan(200);
        // The photo's own top-left pixel is untouched by it.
        expect(pixelAt(canvas, cell.x, cell.y)).toEqual([10, 20, 30, 255]);
    });

    it('leaves the paper clean when the guides are off', () => {
        const plain = layoutSheet({
            paperWidthMm: 101.6,
            paperHeightMm: 152.4,
            photoWidthMm: 50.8,
            photoHeightMm: 50.8,
            orientation: 'portrait',
            guides: 'none',
            reference: false,
        });
        const canvas = composeSheet(plain, photoPixels());
        const cell = plain.cells[0];

        expect(pixelAt(canvas, cell.x - 1, cell.y)).toEqual([255, 255, 255, 255]);
    });

    it('draws the reference line and its end ticks in the bottom margin', () => {
        const canvas = composeSheet(layout, photoPixels());
        const line = layout.reference;
        const tick = referenceTickRange(line);

        expect(pixelAt(canvas, line.x1 + 10, line.y1)[0]).toBeLessThan(60);
        expect(pixelAt(canvas, line.x1, tick.top + 1)[0]).toBeLessThan(60);
        expect(pixelAt(canvas, line.x2 - 1, tick.bottom - 2)[0]).toBeLessThan(60);
    });

    it('refuses pixels that are not the photo size, rather than blitting them crookedly', () => {
        const wrong = new ImageData(new Uint8ClampedArray(4 * 4 * 4), 4, 4);

        expect(() => composeSheet(layout, wrong)).toThrow(/photo/i);
    });
});

/* -------------------------------------------------------------------- *
 * 3. The op, end to end, checked with sharp and pdf-lib
 * -------------------------------------------------------------------- */

describe('the sheet op writes a JPEG', () => {
    let result;
    let output;
    let layout;

    beforeAll(async () => {
        result = await sheetJob({
            orientation: 'landscape',
            marginMm: '0',
            gapMm: '0',
            guides: 'none',
            reference: 'off',
        });
        output = await readBack(result.blob);
        layout = result.layout;
    }, 120_000);

    it('lays six 2 x 2 in photos on a 4 x 6 in sheet at 300 DPI', () => {
        expect(layout.copies).toBe(6);
        expect(layout.columns).toBe(3);
        expect(layout.rows).toBe(2);
        expect(result.format).toBe('jpeg');
        expect(result.width).toBe(1800);
        expect(result.height).toBe(1200);
    });

    it('comes back from libvips as an 1800 x 1200 JPEG that says 300 DPI', () => {
        expect(output.format).toBe('jpeg');
        expect(output.width).toBe(1800);
        expect(output.height).toBe(1200);
        expect(output.density).toBe(300);
    });

    it('puts the same photo in all six cells, the right way up', () => {
        for (const cell of layout.cells) {
            expect(quadrantsOf(output, cell)).toEqual(['red', 'green', 'blue', 'yellow']);
        }
    });

    it('makes every copy the same picture, not six slightly different ones', () => {
        for (let index = 1; index < layout.cells.length; index += 1) {
            expect(cellDifference(output, layout.cells[0], layout.cells[index])).toBeLessThan(1);
        }
    });

    it('resamples the way libvips does, within a few levels of it', async () => {
        // The independent reference: the same cover crop and resize done by
        // sharp, which shares no code with the WASM lanczos3 under test.
        const reference = await sharp(await quadrantPng())
            .resize(600, 600, { fit: 'cover', position: 'centre' })
            .png()
            .toBuffer();

        expect(await differenceFromReference(output, layout.cells[0], reference)).toBeLessThan(12);
    }, 60_000);

    it('reports its own verdict from the finished bytes, row by row', () => {
        expect(result.verified).toBe(true);
        expect(result.checks.map((check) => [check.key, check.required, check.actual])).toEqual([
            ['paper', '4 × 6 in, landscape', '4 × 6 in, landscape'],
            ['pixels', '1800 × 1200 px', '1800 × 1200 px'],
            ['dpi', '300 DPI', '300 DPI'],
            ['photo', '2 × 2 in (600 × 600 px)', '2 × 2 in (600 × 600 px)'],
            ['copies', '6', '6'],
            ['output', 'JPEG', 'JPEG'],
        ]);
    });

    it('names the download after the paper and the resolution', () => {
        expect(result.filename).toBe('resizo-print-sheet-4x6in-300dpi.jpg');
    });
});

describe('the sheet op at the defaults', () => {
    let result;
    let output;

    beforeAll(async () => {
        result = await sheetJob();
        output = await readBack(result.blob);
    }, 120_000);

    it('fits two copies on 4 x 6 in paper once a 5 mm margin is asked for', () => {
        expect(result.layout.capacity).toBe(2);
        expect(result.layout.copies).toBe(2);
        expect(result.layout.orientation).toBe('portrait');
        expect(output.width).toBe(1200);
        expect(output.height).toBe(1800);
    });

    it('leaves the margins white', () => {
        expect(colourAt(output, 3, 3)).toBe('white');
        expect(colourAt(output, output.width - 4, 3)).toBe('white');
        expect(colourAt(output, 3, output.height - 4)).toBe('white');
        expect(colourAt(output, Math.floor(output.width / 2), 10)).toBe('white');
    });

    it('puts the photos where the layout says, and nowhere else', () => {
        for (const cell of result.layout.cells) {
            expect(quadrantsOf(output, cell)).toEqual(['red', 'green', 'blue', 'yellow']);
        }

        // The gap between the two photos is paper.
        const gapRow = result.layout.cells[0].y + result.layout.cells[0].height + 10;
        expect(colourAt(output, Math.floor(output.width / 2), gapRow)).toBe('white');
    });

    it('verifies itself', () => {
        expect(result.verified).toBe(true);
    });
});

describe('the sheet op writes a PDF', () => {
    let result;

    beforeAll(async () => {
        result = await sheetJob({
            orientation: 'landscape',
            marginMm: '0',
            gapMm: '0',
            output: 'pdf',
        });
    }, 120_000);

    it('is one page of exactly 432 x 288 points, whatever the DPI did', async () => {
        const pages = await pagesOf(result.blob);

        expect(pages).toHaveLength(1);
        expect(pages[0].widthPt).toBeCloseTo(432, 2);
        expect(pages[0].heightPt).toBeCloseTo(288, 2);
    });

    it('is declared and named as a PDF', () => {
        expect(result.format).toBe('pdf');
        expect(result.type).toBe('application/pdf');
        expect(result.filename).toBe('resizo-print-sheet-4x6in-300dpi.pdf');
        expect(result.pageCount).toBe(1);
    });

    it('carries no name but ours', async () => {
        const loaded = await PDFDocument.load(
            Buffer.from(await result.blob.arrayBuffer()),
            { updateMetadata: false },
        );

        expect(loaded.getProducer()).toBe('Resizo');
        expect(loaded.getAuthor()).toBeUndefined();
    });

    it('verifies itself against the page it actually wrote', () => {
        expect(result.verified).toBe(true);
        expect(rowOf(result.checks, 'pixels').required).toBe('432 × 288 pt');
        expect(rowOf(result.checks, 'copies').actual).toBe('6');
    });

    it('keeps the page size when the DPI changes, because points are not pixels', async () => {
        const finer = await sheetJob({
            orientation: 'landscape',
            marginMm: '0',
            gapMm: '0',
            output: 'pdf',
            dpi: '600',
        });
        const pages = await pagesOf(finer.blob);

        expect(pages[0].widthPt).toBeCloseTo(432, 2);
        expect(pages[0].heightPt).toBeCloseTo(288, 2);
        expect(finer.layout.photo.widthPx).toBe(1200);
    }, 120_000);
});

/* -------------------------------------------------------------------- *
 * 4. Guides, capacity, enlargement and refusals
 * -------------------------------------------------------------------- */

describe('cut guides change the paper and nothing else', () => {
    let none;
    let corners;
    let lines;

    beforeAll(async () => {
        none = await readBack((await sheetJob({ guides: 'none', reference: 'off' })).blob);
        corners = await readBack((await sheetJob({ guides: 'corners', reference: 'off' })).blob);
        lines = await readBack((await sheetJob({ guides: 'lines', reference: 'off' })).blob);
    }, 180_000);

    /** The layout every one of the three sheets was built from. */
    const layout = layoutSheet({
        paperWidthMm: 101.6,
        paperHeightMm: 152.4,
        photoWidthMm: 50.8,
        photoHeightMm: 50.8,
        guides: 'corners',
        reference: false,
    });

    it('marks the corner positions the layout named, and leaves them clean when off', () => {
        const mark = layout.guides.marks[0];
        const x = Math.floor((mark.x1 + mark.x2) / 2);
        const y = Math.floor((mark.y1 + mark.y2) / 2);

        expect(colourAt(none, x, y)).toBe('white');
        expect(corners.at(x, y)[0]).toBeLessThan(200);
    });

    it('draws a full-height line where corner marks draw nothing', () => {
        // A point on the left cut line, far above the first cell — inside the
        // top margin, which a corner tick never reaches.
        const cell = layout.cells[0];
        const x = cell.x - 1;
        const y = 4;

        expect(colourAt(none, x, y)).toBe('white');
        expect(colourAt(corners, x, y)).toBe('white');
        expect(lines.at(x, y)[0]).toBeLessThan(200);
    });

    it('never puts a guide pixel on a photo, whichever style is chosen', () => {
        for (const sheet of [corners, lines]) {
            for (const cell of layout.cells) {
                expect(quadrantsOf(sheet, cell)).toEqual(['red', 'green', 'blue', 'yellow']);
            }
        }
    });
});

describe('capacity, enlargement and refusals', () => {
    it('clamps a count over capacity and hands back the sentence with the sheet', async () => {
        const result = await sheetJob({ copies: '9' });

        expect(result.layout.copies).toBe(2);
        expect(result.layout.clamped).toBe(true);
        expect(result.layout.notice).toBe(
            'Only 2 photos fit on this sheet with the current size and spacing.',
        );
        expect(result.layout.cells).toHaveLength(2);
    }, 120_000);

    it('reports the blow-up when the source is smaller than the printed photo', async () => {
        const result = await sheetJob({ copies: '1' }, { size: { width: 300, height: 300 } });

        expect(result.enlargement).toEqual({
            from: { width: 300, height: 300 },
            to: { width: 600, height: 600 },
        });
    }, 120_000);

    it('reports no blow-up when the source is bigger than the printed photo', async () => {
        const result = await sheetJob({ copies: '1' });

        expect(result.enlargement).toBeNull();
    }, 120_000);

    it('lays thirty 35 x 45 mm photos on A4 and verifies the sheet', async () => {
        const result = await sheetJob({
            paperWidthMm: '210',
            paperHeightMm: '297',
            photoWidthMm: '35',
            photoHeightMm: '45',
        });
        const output = await readBack(result.blob);

        expect(result.layout.columns).toBe(5);
        expect(result.layout.rows).toBe(6);
        expect(result.layout.copies).toBe(30);
        expect(output.width).toBe(2480);
        expect(output.height).toBe(3508);
        expect(output.density).toBe(300);
        expect(result.verified).toBe(true);
        expect(quadrantsOf(output, result.layout.cells[29]))
            .toEqual(['red', 'green', 'blue', 'yellow']);
    }, 180_000);

    it('refuses a photo that does not fit, in the words the layout model chose', async () => {
        await expect(sheetJob({ photoWidthMm: '120', photoHeightMm: '120' }))
            .rejects.toThrow('A 120 × 120 mm photo does not fit on 4 × 6 in paper with a 5 mm margin.');
    }, 60_000);

    it('refuses a layout with a code the panel can branch on', async () => {
        await expect(sheetJob({ dpi: '5000' })).rejects.toMatchObject({
            name: 'JobError',
            code: 'sheet-layout',
            message: 'The DPI must be a whole number between 72 and 1200.',
        });
    }, 60_000);

    it('refuses an output format it cannot write', async () => {
        await expect(sheetJob({ output: 'tiff' })).rejects.toBeInstanceOf(JobError);
    }, 60_000);

    it('refuses a fill behaviour it does not have', async () => {
        await expect(sheetJob({ fit: 'squash' })).rejects.toBeInstanceOf(JobError);
    }, 60_000);

    it('refuses a paper canvas this device could never hold', async () => {
        // A4 at 1200 DPI is 9921 x 14031 px, past the engine's 8000 px cap.
        await expect(sheetJob({
            paperWidthMm: '210',
            paperHeightMm: '297',
            dpi: '1200',
        })).rejects.toThrow(/8000 pixels/);
    }, 60_000);
});

describe('fit inside', () => {
    it('pads a 3:4 source into a square photo with the background rather than cropping it', async () => {
        const result = await sheetJob({
            copies: '1',
            fit: 'contain',
            background: 'black',
            guides: 'none',
            reference: 'off',
        });
        const output = await readBack(result.blob);
        const cell = result.layout.cells[0];

        // Contained: the whole 3:4 picture sits inside a square, so the left
        // and right edges of the cell are the padding colour and the middle
        // still reads as all four quadrants.
        expect(output.at(cell.x + 2, cell.y + Math.floor(cell.height / 2))[0]).toBeLessThan(40);
        expect(quadrantsOf(output, {
            x: cell.x + Math.floor(cell.width * 0.2),
            y: cell.y,
            width: Math.floor(cell.width * 0.6),
            height: cell.height,
        })).toEqual(['red', 'green', 'blue', 'yellow']);
    }, 120_000);
});

describe('the fields a form posts', () => {
    /**
     * The field names are the page's contract with the engine, and a name that
     * drifts is silent: the option simply goes missing and the sheet comes out
     * at whatever the default was. The bulk `'original'` sentinel converting
     * every PNG to JPEG is what that failure looks like in production.
     */
    it('maps every posted field onto the option the op reads', () => {
        const form = new FormData();
        form.set('paper_width_mm', '210');
        form.set('paper_height_mm', '297');
        form.set('orientation', 'landscape');
        form.set('photo_width_mm', '35');
        form.set('photo_height_mm', '45');
        form.set('dpi', '300');
        form.set('margin_mm', '5');
        form.set('gap_mm', '3');
        form.set('copies', '4');
        form.set('guides', 'lines');
        form.set('reference', 'off');
        form.set('output', 'pdf');
        form.set('fit', 'contain');
        form.set('background', 'black');
        form.set('crop_x', '10');
        form.set('crop_y', '20');
        form.set('crop_width', '300');
        form.set('crop_height', '400');

        expect(optionsFromFormData('sheet', form)).toEqual({
            paperWidthMm: '210',
            paperHeightMm: '297',
            orientation: 'landscape',
            photoWidthMm: '35',
            photoHeightMm: '45',
            dpi: '300',
            marginMm: '5',
            gapMm: '3',
            copies: '4',
            guides: 'lines',
            reference: 'off',
            output: 'pdf',
            fit: 'contain',
            background: 'black',
            x: '10',
            y: '20',
            cropWidth: '300',
            cropHeight: '400',
        });
    });

    it('runs a whole sheet through a real FormData, crop rectangle and all', async () => {
        const form = new FormData();
        form.set('paper_width_mm', '101.6');
        form.set('paper_height_mm', '152.4');
        form.set('photo_width_mm', '50.8');
        form.set('photo_height_mm', '50.8');
        form.set('dpi', '300');
        form.set('copies', '1');
        // Exactly the source's top-left quadrant: 450 x 600 of a 900 x 1200
        // picture, which is red edge to edge.
        form.set('crop_x', '0');
        form.set('crop_y', '0');
        form.set('crop_width', '450');
        form.set('crop_height', '600');

        const result = await runOperation(
            'sheet',
            await quadrantFile(),
            optionsFromFormData('sheet', form),
        );

        // The crop kept the source's top-left quadrant only, so every corner of
        // the printed photo is red rather than four different colours.
        const output = await readBack(result.blob);
        expect(quadrantsOf(output, result.layout.cells[0])).toEqual(['red', 'red', 'red', 'red']);
        expect(result.verified).toBe(true);
    }, 120_000);
});

describe('the encode', () => {
    it('writes the sheet at the quality the module states, and strips every source tag', async () => {
        const result = await sheetJob({ copies: '1' });
        const meta = await sharp(Buffer.from(await result.blob.arrayBuffer())).metadata();

        expect(SHEET_JPEG_QUALITY).toBe(92);
        expect(result.quality).toBe(92);
        expect(meta.exif).toBeUndefined();
        expect(meta.xmp).toBeUndefined();
    }, 120_000);
});

describe('the sheet is a new document, so its name is its own', () => {
    it('names the file after the paper and the DPI, never after the source', async () => {
        const result = await sheetJob({ output: 'jpeg' });
        expect(result.filename).toBe('resizo-print-sheet-4x6in-300dpi.jpg');
    });
});


describe('a two-pixel guide at high resolution keeps both pixels beside a photo', () => {
    it('draws the full line two pixels wide at 600 DPI, with the photo untouched', async () => {
        const result = await sheetJob({ dpi: '600', guides: 'lines' });
        const output = await readBack(result.blob);
        const cell = result.layout.cells[0];
        const y = cell.y + 400;
        const grey = [90, 90, 90];

        expect(distance(output.at(cell.x - 2, y), grey)).toBeLessThan(60);
        expect(distance(output.at(cell.x - 1, y), grey)).toBeLessThan(60);
        expect(distance(output.at(cell.x, y), grey)).toBeGreaterThan(120);
    }, 60_000);
});
