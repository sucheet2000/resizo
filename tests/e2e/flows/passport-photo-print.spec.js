const sharp = require('sharp');

const { test, expect } = require('../fixtures/resizo');
const { lowResPortrait, portrait } = require('../fixtures/files');
const { inspect } = require('../helpers/output');
const { readPdf } = require('../helpers/pdf');

/**
 * /passport-photo-print, driven the way somebody with a photo and a packet of
 * 4 × 6 paper drives it: choose the size the form states, choose the paper in
 * the tray, and get one file back that prints at exactly that size.
 *
 * WHAT IS DIFFERENT ABOUT THIS PAGE, AND WHAT IT COSTS THE TESTS.
 *
 * Every other tool here produces a picture, and a picture can be judged by
 * opening it. This one produces a PHYSICAL OBJECT — a sheet whose only real
 * claim is about inches — and the file is merely how that object is described
 * to a printer. So the failures worth catching are the ones where the file
 * looks perfect and prints wrong: a paper canvas at the wrong pixel count, a
 * DPI record that disagrees with it, a PDF page box built from the wrong axis,
 * a photo resampled to a size nobody asked for, a cell placed half off the
 * page. Every one of those downloads happily and opens happily.
 *
 * SO NOTHING HERE IS HARD-CODED, AND NOTHING HERE IMPORTS THE PRODUCT'S OWN
 * LAYOUT MODULE EITHER.
 *
 * The numbers below are re-derived from the paper size, the photo size and the
 * rounding rule, by arithmetic written out in this file. That is deliberate and
 * it is the same position benchmarks/run.js already takes about
 * lib/format/physical.js: "importing the product's converter would make a
 * drifted conversion agree with itself". A spec that asked layoutSheet where
 * the cells are and then checked the sheet against that answer would pass on
 * any layout the engine and the module agreed about, including a wrong one.
 * Re-deriving costs thirty lines and makes a disagreement between the product
 * and the arithmetic a red test rather than a shared assumption.
 *
 * lib/format/print-sheet.js is still the one implementation the PRODUCT uses,
 * and tests/lib/format/print-sheet.properties.test.js is where its invariants
 * are proved. This file's job is the other half: that the page, the engine, the
 * compositor and the encoder together put the photo where the arithmetic says.
 *
 * THE TWO AGREED TO THE LAST PIXEL when this was written, which is the outcome
 * worth recording. Asked for the page's defaults, layoutSheet and the arithmetic
 * below both answered: a portrait 1200 × 1800 sheet, one column of two 600 px
 * photos, a 59 px margin and a 35 px gap, cells at (300, 282) and (300, 917),
 * and a PDF page of 288 × 432 pt. Two people wrote those separately and got the
 * same numbers, which is a much better reason to believe them than one person
 * writing them once.
 *
 * AND THE PAGE GRADES ITSELF, WHICH IS WHY IT NEEDS AN OUTSIDE MARKER. The
 * result summary comes from validateSheet reading the finished bytes, so it is
 * already a second opinion rather than an echo of the form. It is still the
 * product's own opinion. Every value it prints is checked against sharp — the
 * repository's independent libvips reference (CLAUDE.md > Gotchas) — reading
 * the same download, and the PDF page box against pdf-lib re-parsing it.
 *
 * The no-upload guard and the browser-error guard run automatically for all of
 * these (../fixtures/resizo.js), so every flow below re-proves from the request
 * log that the photo never left the device.
 */

const ROUTE = '/passport-photo-print';
const H1 = 'Create a Passport Photo Print Sheet';

/** A source decode, a resample, a paper-sized composite and one full encode. */
const SLOW = 90_000;
const SLOW_TEST = 180_000;

/* ------------------------------------------------------------------ *
 * The arithmetic, written out
 *
 * ROUNDING POLICY, restated here because this file has to apply it
 * rather than trust it: every physical length becomes pixels
 * INDEPENDENTLY through Math.round(mm / 25.4 × dpi) — paper width,
 * paper height, photo width, photo height, margin and gap are each
 * converted and each rounded once. Points for a PDF page come from the
 * millimetres and never from the pixels.
 * ------------------------------------------------------------------ */

const MM_PER_INCH = 25.4;
const POINTS_PER_INCH = 72;

const toMillimetres = (value, unit) => {
    if (unit === 'mm') return value;
    if (unit === 'cm') return value * 10;
    if (unit === 'in') return value * MM_PER_INCH;
    throw new Error(`unrecognised unit "${unit}"`);
};

const pixelsFor = (mm, dpi) => Math.round((mm / MM_PER_INCH) * dpi);
const pointsFor = (mm) => (mm / MM_PER_INCH) * POINTS_PER_INCH;

/**
 * The paper fragment a download is named after: the sheet's two edges, short
 * side first, in whole inches when BOTH are whole inches and in whole
 * millimetres otherwise.
 *
 * Orientation-independent on purpose — a sheet fed sideways is the same piece
 * of paper — and millimetres for anything that is not a whole inch because a
 * filename token has its dots stripped, so Letter's 8.5 would come back as
 * "85x11", a paper size that does not exist.
 */
function paperToken(paper) {
    const short = Math.min(toMillimetres(paper.width, paper.unit), toMillimetres(paper.height, paper.unit));
    const long = Math.max(toMillimetres(paper.width, paper.unit), toMillimetres(paper.height, paper.unit));

    const inches = [short, long].map((mm) => mm / MM_PER_INCH);
    const whole = inches.every((value) => Math.abs(value - Math.round(value)) < 1e-6);

    return whole
        ? `${Math.round(inches[0])}x${Math.round(inches[1])}in`
        : `${Math.round(short)}x${Math.round(long)}mm`;
}

/**
 * How many photos fit along one axis.
 *
 * n photos need n·photo + (n−1)·gap inside paper − 2·margin, which rearranges
 * to n ≤ (paper − 2·margin + gap) / (photo + gap). Floor it, and never below
 * zero — a photo wider than the paper is a refusal, not a negative count.
 */
const fitsAlong = (paperPx, marginPx, gapPx, photoPx) => Math.max(
    0,
    Math.floor((paperPx - 2 * marginPx + gapPx) / (photoPx + gapPx)),
);

/**
 * The four papers the select offers, as the registry states them.
 *
 * Written width-by-height in the orientation each is NAMED in, which is
 * portrait for all four: "4 × 6 in" is four across and six down. Landscape is
 * that pair swapped, and nothing here assumes which one wins.
 */
const PAPERS = {
    '4x6': { id: '4x6', label: '4 × 6 in', width: 4, height: 6, unit: 'in' },
    '5x7': { id: '5x7', label: '5 × 7 in', width: 5, height: 7, unit: 'in' },
    letter: {
        id: 'letter', label: 'Letter (8.5 × 11 in)', width: 8.5, height: 11, unit: 'in',
    },
    a4: {
        id: 'a4', label: 'A4 (210 × 297 mm)', width: 210, height: 297, unit: 'mm',
    },
};

/** The three verified presets the Photo size chips offer, by their chip label. */
const PHOTO_PRESETS = {
    us: {
        chip: 'United States 2 × 2 in', width: 2, height: 2, unit: 'in',
    },
    uk: {
        chip: 'United Kingdom 35 × 45 mm', width: 35, height: 45, unit: 'mm',
    },
    india: {
        chip: 'India 3.5 × 4.5 cm', width: 3.5, height: 4.5, unit: 'cm',
    },
};

/**
 * The whole layout, from the numbers a visitor chose.
 *
 * COVERS THE FULL-GRID CASE ONLY, and every flow in this file stays inside it:
 * `copies` is either the sheet's own capacity or a request the page clamps back
 * to it. How a partly-filled grid is positioned is a question this file does
 * not answer and does not need to — asking for fewer copies than fit is a case
 * for the unit tests, where the layout module can be asked directly.
 */
function deriveSheet({
    paper,
    photo,
    dpi = 300,
    marginMm = 5,
    gapMm = 3,
    orientation = 'auto',
}) {
    const paperWidthMm = toMillimetres(paper.width, paper.unit);
    const paperHeightMm = toMillimetres(paper.height, paper.unit);
    const photoWidthMm = toMillimetres(photo.width, photo.unit);
    const photoHeightMm = toMillimetres(photo.height, photo.unit);

    const marginPx = pixelsFor(marginMm, dpi);
    const gapPx = pixelsFor(gapMm, dpi);
    const photoWidthPx = pixelsFor(photoWidthMm, dpi);
    const photoHeightPx = pixelsFor(photoHeightMm, dpi);

    const shape = (widthMm, heightMm, name) => {
        const widthPx = pixelsFor(widthMm, dpi);
        const heightPx = pixelsFor(heightMm, dpi);
        const columns = fitsAlong(widthPx, marginPx, gapPx, photoWidthPx);
        const rows = fitsAlong(heightPx, marginPx, gapPx, photoHeightPx);
        return {
            name,
            widthMm,
            heightMm,
            widthPx,
            heightPx,
            columns,
            rows,
            capacity: columns * rows,
        };
    };

    const upright = shape(paperWidthMm, paperHeightMm, 'portrait');
    const sideways = shape(paperHeightMm, paperWidthMm, 'landscape');

    // 'auto' takes the larger capacity, and a tie goes to portrait.
    let chosen = upright;
    if (orientation === 'landscape') chosen = sideways;
    else if (orientation === 'auto' && sideways.capacity > upright.capacity) chosen = sideways;

    const leftoverX = chosen.widthPx - 2 * marginPx - chosen.columns * photoWidthPx
        - (chosen.columns - 1) * gapPx;
    const leftoverY = chosen.heightPx - 2 * marginPx - chosen.rows * photoHeightPx
        - (chosen.rows - 1) * gapPx;

    const offsetX = marginPx + Math.floor(leftoverX / 2);
    const offsetY = marginPx + Math.floor(leftoverY / 2);

    const cells = [];
    for (let row = 0; row < chosen.rows; row += 1) {
        for (let column = 0; column < chosen.columns; column += 1) {
            cells.push({
                index: cells.length,
                column,
                row,
                left: offsetX + column * (photoWidthPx + gapPx),
                top: offsetY + row * (photoHeightPx + gapPx),
                width: photoWidthPx,
                height: photoHeightPx,
            });
        }
    }

    return {
        dpi,
        orientation: chosen.name,
        /** What a download made from this sheet is named after. */
        filename: `resizo-print-sheet-${paperToken(paper)}-${dpi}dpi`,
        paper: {
            id: paper.id,
            widthPx: chosen.widthPx,
            heightPx: chosen.heightPx,
            widthPt: pointsFor(chosen.widthMm),
            heightPt: pointsFor(chosen.heightMm),
        },
        photo: { widthPx: photoWidthPx, heightPx: photoHeightPx },
        marginPx,
        gapPx,
        columns: chosen.columns,
        rows: chosen.rows,
        capacity: chosen.capacity,
        cells,
    };
}

/** The page's own defaults, derived: US 2 × 2 in on 4 × 6 in paper at 300 DPI. */
const DEFAULTS = deriveSheet({ paper: PAPERS['4x6'], photo: PHOTO_PRESETS.us });

/* ------------------------------------------------------------------ *
 * Driving the form
 * ------------------------------------------------------------------ */

/**
 * One radio, named by its own label and pinned to its own group.
 *
 * The label alone is not enough on this page — "PDF", "Off" and "Portrait" are
 * all words the surrounding prose uses — and the group's `name` attribute is
 * the thing the contract actually fixes. `and()` intersects the two, so a
 * radio that moved out of its fieldset fails here rather than matching a
 * paragraph.
 */
const radio = (page, group, label, exact = true) => page
    .getByRole('radio', { name: label, exact })
    .and(page.locator(`input[name="${group}"]`));

/**
 * The advanced half, opened once and only if it is shut.
 *
 * Pressed blindly it is a toggle, and a second press would close the drawer the
 * next line fills. The disclosure states its own state, so it is read before it
 * is pressed — the same shape image-size-fitter.spec.js uses. What is waited
 * for afterwards is a FIELD rather than a panel id: the margin input is a
 * string this file already depends on, and waiting for it proves the drawer is
 * open without inventing a second selector to prove it with.
 */
async function openAdvanced(page) {
    const toggle = page.locator('#sheet-advanced');
    if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('#sheet-margin')).toBeVisible();
}

/**
 * A PresetChips chip, confirmed rather than pressed.
 *
 * PresetChips reads a press on the ALREADY-ACTIVE chip as "unselect", and the
 * United States chip is this page's default — so a flow that pressed it would
 * turn the default off and then measure a page with no photo size at all.
 */
async function chooseChip(page, name) {
    const chip = page.getByRole('button', { name, exact: true });
    if ((await chip.getAttribute('aria-pressed')) !== 'true') await chip.click();
    await expect(chip).toHaveAttribute('aria-pressed', 'true');
}

/**
 * Sets the form to a described sheet.
 *
 * Everything a visitor with a simple job touches is out in the open — paper,
 * photo size, DPI, copies, output — and everything else is behind the
 * disclosure, so the drawer is opened only when something inside it is being
 * changed. A flow that opened it unconditionally would be measuring a page no
 * visitor with default margins ever sees.
 */
function configure(page, {
    paper, photo, dpi, copies, marginMm, gapMm, guides, reference, fit, output,
} = {}) {
    const advanced = [marginMm, gapMm, guides, reference, fit]
        .some((value) => value !== undefined);

    return async () => {
        if (paper !== undefined) await page.locator('#sheet-paper').selectOption({ label: paper.label });
        if (photo !== undefined) await chooseChip(page, photo.chip);
        if (dpi !== undefined) await page.locator('#sheet-dpi').fill(String(dpi));

        if (copies !== undefined) {
            await radio(page, 'sheet-copies-mode', 'Number of copies').check();
            await page.locator('#sheet-copies').fill(String(copies));
        }

        if (advanced) await openAdvanced(page);

        if (marginMm !== undefined) await page.locator('#sheet-margin').fill(String(marginMm));
        if (gapMm !== undefined) await page.locator('#sheet-gap').fill(String(gapMm));
        if (guides !== undefined) await radio(page, 'sheet-guides', guides).check();
        if (fit !== undefined) await radio(page, 'sheet-fit', fit, false).check();

        if (reference !== undefined) {
            const box = page.locator('#sheet-reference');
            if (reference) await box.check();
            else await box.uncheck();
        }

        if (output !== undefined) await radio(page, 'sheet-output', output).check();
    };
}

/** The result section, which is where every self-reported number lives. */
const resultSection = (page) => page.locator('section[aria-labelledby="sheet-result-heading"]');

/**
 * The summary as a person reads it: the row's name, what was asked for, what
 * the file actually is, and the word — never the colour — that says whether the
 * two agree.
 *
 * Scoped to the result section and taken from its first `dl`, so it does not
 * depend on the heading text above the list. The cell reader is the one
 * passport.spec.js and image-size-fitter.spec.js already use: the direct spans'
 * own text nodes only, so the sr-only column names a screen reader hears
 * ("Requested", "Result") stay out of the comparison.
 */
function summaryRows(page) {
    return resultSection(page).evaluate((section) => {
        const list = section.querySelector('dl');
        if (!list) return [];

        return [...list.querySelectorAll(':scope > div')].map((row) => {
            const cells = [...row.querySelectorAll(':scope > dd > span')].map((cell) => [...cell.childNodes]
                .filter((node) => node.nodeType === Node.TEXT_NODE)
                .map((node) => node.textContent)
                .join('')
                .trim());
            return {
                label: row.querySelector('dt')?.textContent.trim() ?? '',
                required: cells[0] ?? '',
                actual: cells[1] ?? '',
                status: cells[2] ?? '',
            };
        });
    });
}

/** One row by its visible name, or a failure that says which rows there were. */
function rowNamed(rows, label) {
    const found = rows.find((row) => row.label === label);
    expect(found, `no "${label}" row — the summary listed ${rows.map((row) => row.label).join(', ')}`)
        .toBeTruthy();
    return found;
}

/* ------------------------------------------------------------------ *
 * Reading the sheet back
 * ------------------------------------------------------------------ */

/**
 * MEASURED ANCHORS, so no threshold in this file is a number somebody liked.
 * All four are libvips readings of the 1200×1600 portrait fixture, taken on
 * this machine (the scratch measurement is quoted, not the tool's opinion):
 *
 *   the same crop, worst resampler pair + JPEG q92    0.44
 *   the same crop, JPEG q92 round trip alone          0.19
 *   a DIFFERENT crop of the same photo               32.2 – 36.7
 *   a blank white cell                               93.1
 *
 * So SAME_PICTURE at 6 is fourteen times the worst same-crop reading and a
 * fifth of the smallest wrong-crop signal: moving it either way by a factor of
 * three would not change a verdict. IDENTICAL at 2 is for two cells of ONE
 * sheet, which hold the same resampled bytes and differ only by where the JPEG
 * block grid falls across them.
 */
const SAME_PICTURE = 6;
const IDENTICAL = 2;

/** Paper. A flat white field survives JPEG q92 exactly; 250 allows for drift. */
const PAPER_WHITE = 250;

/** Ink. The guide grey and the reference black are both far below this. */
const INK = 200;

/** One DCT block. JPEG ringing reaches this far past a hard edge and no further. */
const BLOCK = 8;

const mean = (a, b) => {
    expect(a.length, 'two buffers of different lengths were compared').toBe(b.length);
    let total = 0;
    for (let i = 0; i < a.length; i += 1) total += Math.abs(a[i] - b[i]);
    return total / a.length;
};

/** One rectangle of a saved image as raw RGB, alpha dropped. */
const patch = (file, box) => sharp(file)
    .extract({
        left: box.left, top: box.top, width: box.width, height: box.height,
    })
    .removeAlpha()
    .raw()
    .toBuffer();

/**
 * The photo as it should appear in a cell: the centred crop-to-fill region of
 * the source, resampled to the cell's own pixel size.
 *
 * This is libvips doing what the browser engine does, which is the point — two
 * implementations of one instruction. They will not agree to the last level and
 * are not asked to; SAME_PICTURE is set from what that disagreement actually
 * measures.
 */
async function expectedPhoto(source, { widthPx, heightPx }) {
    const { width, height } = await sharp(source).metadata();

    // Crop to fill keeps the largest centred rectangle of the source that has
    // the photo's aspect ratio.
    const scale = Math.max(widthPx / width, heightPx / height);
    const keepWidth = Math.min(width, Math.round(widthPx / scale));
    const keepHeight = Math.min(height, Math.round(heightPx / scale));

    return sharp(source)
        .extract({
            left: Math.floor((width - keepWidth) / 2),
            top: Math.floor((height - keepHeight) / 2),
            width: keepWidth,
            height: keepHeight,
        })
        .resize(widthPx, heightPx, { fit: 'fill' })
        .removeAlpha()
        .raw()
        .toBuffer();
}

/** Every pixel of a saved image, plus its shape, for a whole-sheet scan. */
async function rasterOf(file) {
    const { data, info } = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    return { data, width: info.width, height: info.height, channels: info.channels };
}

const pixelAt = (raster, x, y) => {
    const at = (y * raster.width + x) * raster.channels;
    return [raster.data[at], raster.data[at + 1], raster.data[at + 2]];
};

const isPaper = (rgb) => rgb.every((channel) => channel >= PAPER_WHITE);
const isInk = (rgb) => rgb.every((channel) => channel <= INK);

/** Grows a cell by one JPEG block, which is how far a hard edge can ring. */
const withBleed = (cell, bleed = BLOCK) => ({
    left: cell.left - bleed,
    top: cell.top - bleed,
    right: cell.left + cell.width + bleed,
    bottom: cell.top + cell.height + bleed,
});

const inside = (box, x, y) => x >= box.left && x < box.right && y >= box.top && y < box.bottom;

/* ------------------------------------------------------------------ *
 * 1 · The default sheet: one photo size, one paper, one file whose
 *     every number is the arithmetic's rather than the panel's
 * ------------------------------------------------------------------ */

test('the default 2 × 2 in sheet on 4 × 6 paper is the paper size in pixels, at the DPI asked for', async ({ tool, page }) => {
    test.setTimeout(SLOW_TEST);

    const sheet = DEFAULTS;

    await tool.open(ROUTE, { h1: H1 });

    // Nothing to lay out yet: the action says so rather than failing on a press.
    const create = page.getByRole('button', { name: 'Create sheet' });
    await expect(create).toBeDisabled();

    // The defaults are a contract of their own — a page that opened on A4 would
    // produce a perfectly correct sheet nobody asked for. Read from the option
    // that is selected rather than from the select's value, because whether
    // that value is the registry's id or its label is not a promise the page
    // makes and not one this file should hold it to.
    const paperChosen = await page.locator('#sheet-paper option:checked').textContent();
    expect(paperChosen.trim(), 'the paper select does not open on 4 × 6 in')
        .toBe(PAPERS['4x6'].label);
    await expect(page.getByRole('button', { name: PHOTO_PRESETS.us.chip, exact: true }))
        .toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#sheet-dpi')).toHaveValue(String(sheet.dpi));

    // The orientation Auto resolves to, shown on the radio that is already
    // chosen. Read from whichever radio is checked rather than from a position
    // in the group, and compared against the arithmetic rather than a string.
    const auto = page.locator('input[name="sheet-orientation"]:checked');
    const autoLabel = await auto.evaluate((element) => element.labels?.[0]?.textContent ?? '');
    expect(autoLabel.toLowerCase(), 'the Auto radio does not say which orientation it resolved to')
        .toContain(sheet.orientation);
    expect(autoLabel, `Auto should say ${sheet.capacity} photos fit`).toContain(String(sheet.capacity));

    await tool.pick(await portrait());

    // The preview is drawn from the same layout the download will be, and it
    // says so out loud for a screen reader: the sentence carries the resolved
    // orientation, the copy count and the grid.
    const preview = page.locator('figure').filter({ hasText: 'Preview — the file you download' });
    await expect(preview).toBeVisible();
    const described = await preview.locator('[aria-label]').first().getAttribute('aria-label');
    expect(described, 'the preview has no spoken description').toBeTruthy();
    expect(described).toContain(sheet.orientation);
    expect(described).toContain(`${sheet.columns} column`);
    expect(described).toContain(`${sheet.rows} row`);

    await tool.run('Create sheet', { download: 'Download JPEG', timeout: SLOW });
    const saved = await tool.download('Download JPEG');

    const out = await inspect(saved.file);
    expect(out.format).toBe('jpeg');
    // The whole product, in two numbers. 4 in at 300 DPI is 1200 px and 6 in is
    // 1800; which of them is the width depends on the orientation Auto picked,
    // and both come from the arithmetic above rather than from this sentence.
    expect(out.width, `the sheet is not ${sheet.paper.widthPx} px across`).toBe(sheet.paper.widthPx);
    expect(out.height, `the sheet is not ${sheet.paper.heightPx} px down`).toBe(sheet.paper.heightPx);
    // And the record that makes those pixels inches. A 1200×1800 JPEG with no
    // density in it prints at whatever the printer guesses.
    expect(out.density).toBe(sheet.dpi);

    // The download is a file the visitor keeps, so its name is part of the
    // product: the paper it was laid out for and the DPI it was written at.
    expect(saved.filename).toBe(`${sheet.filename}.jpg`);

    // The summary, which is the product's own reading of the same bytes. Every
    // row is compared against libvips or against the arithmetic, never taken.
    const rows = await summaryRows(page);
    expect(rows.length, 'the summary reported nothing to check').toBeGreaterThan(0);

    // The row names follow the fitter's summary: the DPI record is
    // "Resolution" there too, and the pixel size of the sheet is "Pixels".
    expect(rowNamed(rows, 'Pixels').actual).toBe(`${out.width} × ${out.height} px`);
    expect(rowNamed(rows, 'Resolution').actual).toBe(`${out.density} DPI`);
    expect(rowNamed(rows, 'Copies').actual).toBe(String(sheet.capacity));
    expect(rowNamed(rows, 'Output').actual).toBe('JPEG');

    for (const label of ['Paper', 'Pixels', 'Resolution', 'Photo size', 'Copies', 'Output']) {
        expect(rowNamed(rows, label).status, `the ${label} row does not say it was met`).toBe('Meets');
    }

    // The sentence that decides whether any of the above survives contact with
    // a printer. Everything else on this page is undone by a Fit to Page box.
    const note = page.locator('#sheet-print-note');
    await expect(note).toBeVisible();
    await expect(note).toContainText('Actual Size');
});

/* ------------------------------------------------------------------ *
 * 2 · Where the photos actually are
 * ------------------------------------------------------------------ */

test('every cell the arithmetic predicts holds the same photo, and the margins are bare paper', async ({ tool }) => {
    test.setTimeout(SLOW_TEST);

    const sheet = DEFAULTS;
    const source = await portrait();

    // The self-check that keeps everything below from being vacuous: a layout
    // with no cells has no cell in the wrong place.
    expect(sheet.capacity, 'the arithmetic says nothing fits on this sheet').toBeGreaterThan(0);
    expect(sheet.cells.length).toBe(sheet.capacity);

    const saved = await tool.process({
        route: ROUTE,
        h1: H1,
        file: source,
        button: 'Create sheet',
        download: 'Download JPEG',
        timeout: SLOW,
    });

    const out = await inspect(saved.file);
    expect(out.width).toBe(sheet.paper.widthPx);
    expect(out.height).toBe(sheet.paper.heightPx);

    // Every cell has to be ON the paper before it can be right. A cell hanging
    // off the edge would make sharp's extract throw, which is a worse failure
    // message than this one.
    for (const cell of sheet.cells) {
        expect(cell.left, `cell ${cell.index} starts left of the paper`).toBeGreaterThanOrEqual(0);
        expect(cell.top, `cell ${cell.index} starts above the paper`).toBeGreaterThanOrEqual(0);
        expect(cell.left + cell.width, `cell ${cell.index} runs off the right edge`)
            .toBeLessThanOrEqual(out.width);
        expect(cell.top + cell.height, `cell ${cell.index} runs off the bottom edge`)
            .toBeLessThanOrEqual(out.height);
    }

    // The picture each cell should hold, produced by libvips from the same
    // instruction the engine was given.
    const expected = await expectedPhoto(source, sheet.photo);

    const cells = [];
    for (const cell of sheet.cells) {
        // Sequential rather than Promise.all: a failure names one cell, and
        // decoding a 2 MP sheet several times at once buys nothing here.
        cells.push(await patch(saved.file, cell));
    }

    for (const [index, actual] of cells.entries()) {
        const difference = mean(actual, expected);
        expect(
            difference,
            `cell ${index} holds a different picture from the one crop-to-fill should produce `
            + `(${difference.toFixed(3)} against a ceiling of ${SAME_PICTURE}; a wrong crop of this `
            + 'fixture measures 32 and blank paper measures 93)',
        ).toBeLessThan(SAME_PICTURE);
    }

    // And every copy is the SAME copy. One cell right and the rest blank would
    // pass the loop above only if the blank one were also compared, so this is
    // the assertion that says the sheet is a sheet rather than one photo and
    // some luck.
    for (let index = 1; index < cells.length; index += 1) {
        const difference = mean(cells[0], cells[index]);
        expect(
            difference,
            `cell ${index} is not the same photo as cell 0 (${difference.toFixed(3)})`,
        ).toBeLessThan(IDENTICAL);
    }

    // The margin is paper. Sampled in the middle of the top margin band, half a
    // cell away from the nearest corner mark, so a guide tick cannot answer for
    // it. A JPEG q92 flat white field is 255 to the level.
    const raster = await rasterOf(saved.file);
    const marginSample = pixelAt(
        raster,
        sheet.cells[0].left + Math.round(sheet.cells[0].width / 2),
        Math.max(1, Math.round(sheet.marginPx / 2)),
    );
    expect(isPaper(marginSample), `the top margin reads rgb(${marginSample.join(',')}), not paper`).toBe(true);
});

/* ------------------------------------------------------------------ *
 * 3 · The PDF, whose only claim is a number in points
 * ------------------------------------------------------------------ */

test('the PDF is one page whose box is the paper size in points, not a picture of one', async ({ tool, page }) => {
    test.setTimeout(SLOW_TEST);

    const sheet = DEFAULTS;

    const saved = await tool.process({
        route: ROUTE,
        h1: H1,
        file: await portrait(),
        before: configure(page, { output: 'PDF' }),
        button: 'Create sheet',
        download: 'Download PDF',
        timeout: SLOW,
    });

    expect(saved.filename).toBe(`${sheet.filename}.pdf`);
    expect(saved.bytes, 'the PDF is empty').toBeGreaterThan(0);

    const document = await readPdf(saved.file);

    // One sheet, one page. A second page is a second piece of paper coming out
    // of the printer, which nobody asked for and nothing on screen would show.
    expect(document.pageCount, 'the sheet came back as more than one page').toBe(1);

    // THE ONE ASSERTION THIS FLOW EXISTS FOR. A PDF page's size is what the
    // printer scales to, and it is in points — 72 to the inch — derived from
    // the paper's millimetres and never from its pixel count. A page box built
    // from the pixels instead would be 1200 × 1800 and print four times too
    // big, while looking correct in every viewer.
    const [first] = document.pages;
    expect(
        Math.abs(first.widthPt - sheet.paper.widthPt),
        `the page is ${first.widthPt.toFixed(3)} pt across, not ${sheet.paper.widthPt.toFixed(3)}`,
    ).toBeLessThan(0.01);
    expect(
        Math.abs(first.heightPt - sheet.paper.heightPt),
        `the page is ${first.heightPt.toFixed(3)} pt down, not ${sheet.paper.heightPt.toFixed(3)}`,
    ).toBeLessThan(0.01);

    // The page box and the raster agree about which way up the sheet is. A
    // writer that set the box from the wrong axis passes both lines above the
    // day the paper is square and fails this one always.
    expect(first.widthPt < first.heightPt).toBe(sheet.paper.widthPx < sheet.paper.heightPx);

    const rows = await summaryRows(page);
    expect(rowNamed(rows, 'Output').actual).toBe('PDF');
    expect(rowNamed(rows, 'Output').status).toBe('Meets');

    // A PDF carries its size in points instead of a DPI record, and the page
    // says so rather than reporting a density nothing wrote.
    await expect(page.locator('#sheet-print-note')).toContainText('Actual Size');
});

/* ------------------------------------------------------------------ *
 * 4 · Cut guides: ink outside the photo, and paper when they are off
 * ------------------------------------------------------------------ */

test('corner marks put ink in the margin beside a cell, and turning them off takes it away', async ({ tool, page }) => {
    test.setTimeout(SLOW_TEST);

    const sheet = DEFAULTS;
    const cell = sheet.cells[0];

    // A 3 mm tick, in the pixels of this sheet. The region searched is the
    // square of that side centred on the cell's top-left corner, MINUS the part
    // that is inside the cell — a mark drawn inside the photo is a defect, and
    // counting the photo's own dark pixels as a mark would hide it.
    const tick = pixelsFor(3, sheet.dpi);
    const corner = {
        left: Math.max(0, cell.left - tick),
        top: Math.max(0, cell.top - tick),
        width: Math.min(tick * 2, cell.width),
        height: Math.min(tick * 2, cell.height),
    };

    const inkOutsideTheCell = (raster) => {
        let seen = 0;
        let dark = 0;
        for (let y = corner.top; y < corner.top + corner.height; y += 1) {
            for (let x = corner.left; x < corner.left + corner.width; x += 1) {
                if (x >= cell.left && y >= cell.top) continue;
                seen += 1;
                if (isInk(pixelAt(raster, x, y))) dark += 1;
            }
        }
        return { seen, dark };
    };

    await tool.open(ROUTE, { h1: H1 });
    await configure(page, { guides: 'Corner marks' })();
    await tool.pick(await portrait());
    await tool.run('Create sheet', { download: 'Download JPEG', timeout: SLOW });
    const marked = await tool.download('Download JPEG');

    const withMarks = await rasterOf(marked.file);
    const found = inkOutsideTheCell(withMarks);

    // The self-check. An empty search region contains no mark, so without this
    // the assertion below would pass on a cell flush against the paper's edge.
    expect(found.seen, 'no pixels outside the cell were examined').toBeGreaterThan(0);
    expect(found.dark, 'no cut mark was drawn beside the first cell').toBeGreaterThan(0);

    // The control: the middle of the same margin band, half a cell from the
    // nearest corner and therefore nowhere near a 3 mm tick. Ink here would
    // mean the "mark" found above is something else entirely.
    const clean = pixelAt(
        withMarks,
        cell.left + Math.round(cell.width / 2),
        Math.max(1, Math.round(sheet.marginPx / 2)),
    );
    expect(isPaper(clean), `the margin between the marks reads rgb(${clean.join(',')})`).toBe(true);

    // Changing the guides after a result is a new job: the old file may not be
    // handed over as if it were this sheet, and the button to run the new one
    // comes back.
    await configure(page, { guides: 'Off' })();
    await expect(page.getByRole('button', { name: 'Download JPEG' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Create sheet' })).toBeVisible();

    await tool.run('Create sheet', { download: 'Download JPEG', timeout: SLOW });
    const plain = await tool.download('Download JPEG');

    // And the same square is bare paper. This is what turns the count above
    // into evidence about the guides rather than about the fixture: the two
    // sheets differ in one setting and in nothing else.
    const withoutMarks = await rasterOf(plain.file);
    const gone = inkOutsideTheCell(withoutMarks);
    expect(gone.seen).toBe(found.seen);
    expect(gone.dark, 'ink is still beside the cell with the cut guides turned off').toBe(0);
});

/* ------------------------------------------------------------------ *
 * 5 · Asking for more copies than the paper holds
 * ------------------------------------------------------------------ */

test('a copy count over capacity is clamped, said in words, and the sheet holds exactly what fits', async ({ tool, page }) => {
    test.setTimeout(SLOW_TEST);

    const sheet = DEFAULTS;
    const asked = sheet.capacity + 6;

    await tool.open(ROUTE, { h1: H1 });

    // Guides and the reference line are turned off for this one, and only this
    // one: the question here is how many photos are on the paper, and the
    // answer is read from every pixel that is not paper. A cut mark is a pixel
    // that is not paper, so leaving them on would make the scan below argue
    // with the decoration instead of counting photos.
    await configure(page, {
        copies: asked, guides: 'Off', reference: false,
    })();

    await tool.pick(await portrait());

    const notice = page.locator('#sheet-capacity');
    await expect(notice).toBeVisible();
    await expect(notice).toHaveText(
        `Only ${sheet.capacity} photos fit on this sheet with the current size and spacing.`,
    );

    await tool.run('Create sheet', { download: 'Download JPEG', timeout: SLOW });
    const saved = await tool.download('Download JPEG');

    // The sentence stays up after the run: a visitor who scrolled to the result
    // has to still be able to learn why they got two and asked for eight.
    await expect(notice).toBeVisible();
    expect(rowNamed(await summaryRows(page), 'Copies').actual).toBe(String(sheet.capacity));

    const out = await inspect(saved.file);
    expect(out.width).toBe(sheet.paper.widthPx);
    expect(out.height).toBe(sheet.paper.heightPx);

    // Now count what is actually on the paper, rather than believing either the
    // sentence or the summary. With no guides and no reference line, every
    // pixel that is not paper belongs to a photo — so a photo anywhere the
    // arithmetic did not put one is a stray copy, and the scan names where.
    const raster = await rasterOf(saved.file);
    const boxes = sheet.cells.map((cell) => withBleed(cell));

    let sampled = 0;
    let ink = 0;
    let strays = 0;
    let firstStray = null;

    // Every seventh pixel each way: fine enough that a whole extra 600 px photo
    // cannot hide between samples, coarse enough to scan a 2 MP sheet quickly.
    for (let y = 0; y < raster.height; y += 7) {
        for (let x = 0; x < raster.width; x += 7) {
            sampled += 1;
            if (isPaper(pixelAt(raster, x, y))) continue;
            ink += 1;
            if (boxes.some((box) => inside(box, x, y))) continue;
            strays += 1;
            if (!firstStray) firstStray = `${x},${y}`;
        }
    }

    // The self-check, and it is the whole difference between this test and one
    // that passes on a blank page: a sheet with nothing drawn on it has no
    // stray photo on it either.
    expect(sampled, 'the sheet was never scanned').toBeGreaterThan(0);
    expect(ink, 'nothing but paper was found on the sheet — no photo was drawn at all')
        .toBeGreaterThan(sheet.capacity * 1000);
    expect(
        strays,
        `${strays} of ${ink} non-paper samples are outside every cell the arithmetic predicts, `
        + `the first at ${firstStray} — the sheet holds more than the ${sheet.capacity} that fit`,
    ).toBe(0);
});

/* ------------------------------------------------------------------ *
 * 6 · A source too small for the size it is being printed at
 * ------------------------------------------------------------------ */

test('a 300 × 300 source is warned about before the run, in the pixels it will be enlarged to', async ({ tool, page }) => {
    test.setTimeout(SLOW_TEST);

    const sheet = DEFAULTS;

    // The fixture is square and 300 px on a side, so crop-to-fill keeps all of
    // it and the sentence's first pair is the whole file rather than a crop.
    const source = await lowResPortrait();
    const { width, height } = await sharp(source).metadata();
    expect([width, height], 'the low-resolution fixture is not the 300 × 300 this flow reads')
        .toEqual([300, 300]);
    expect(width, 'the fixture is not smaller than the printed photo, so nothing would be enlarged')
        .toBeLessThan(sheet.photo.widthPx);

    await tool.open(ROUTE, { h1: H1 });
    await tool.pick(source);

    // BEFORE the run, not after it. A visitor who is going to get a soft print
    // deserves to hear so while they can still choose a smaller photo size or a
    // better source, not once the file is already on their disk.
    await expect(page.getByRole('button', { name: 'Create sheet' })).toBeEnabled();
    await expect(page.getByText(
        `Your source will be enlarged from ${width} × ${height} to `
        + `${sheet.photo.widthPx} × ${sheet.photo.heightPx} pixels. Printing it may look softer.`,
    )).toBeVisible();

    // And it is a warning, not a refusal: the sheet is still made, at the size
    // the paper and the photo size demand.
    await tool.run('Create sheet', { download: 'Download JPEG', timeout: SLOW });
    const saved = await tool.download('Download JPEG');

    const out = await inspect(saved.file);
    expect(out.format).toBe('jpeg');
    expect(out.width).toBe(sheet.paper.widthPx);
    expect(out.height).toBe(sheet.paper.heightPx);
    expect(out.density).toBe(sheet.dpi);

    // The enlargement is real: the cell is the printed size, not the source's.
    const cell = await patch(saved.file, sheet.cells[0]);
    expect(cell.length).toBe(sheet.photo.widthPx * sheet.photo.heightPx * 3);

    const expected = await expectedPhoto(source, sheet.photo);
    const difference = mean(cell, expected);
    expect(
        difference,
        `the enlarged cell is not the source enlarged (${difference.toFixed(3)})`,
    ).toBeLessThan(SAME_PICTURE);
});

/* ------------------------------------------------------------------ *
 * 7 · The whole workflow at a phone width, in the project that runs
 *     everything
 * ------------------------------------------------------------------ */

/**
 * tests/e2e/browser/mobile.spec.js runs one small sheet on the Pixel 7 and
 * iPhone 14 profiles; this holds the layout rule at 390px in chromium-full,
 * where the whole flow suite already runs. A rule that only holds on a phone
 * profile is a rule the desktop build can quietly break.
 */
test.describe('on a 390 px screen', () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test('the preview fits the screen, and the sheet still lands at the paper size', async ({ tool, page }) => {
        test.setTimeout(SLOW_TEST);

        const sheet = DEFAULTS;

        const metrics = () => page.evaluate(() => ({
            innerWidth: window.innerWidth,
            scrollWidth: document.scrollingElement.scrollWidth,
        }));

        await tool.open(ROUTE, { h1: H1 });

        // A phone has no horizontal scrollbar to warn you: an element wider than
        // the screen just cuts the page off at the right edge.
        const empty = await metrics();
        expect(empty.scrollWidth, 'the page is wider than the screen before anything is chosen')
            .toBeLessThanOrEqual(empty.innerWidth);

        // The advanced drawer holds two number fields, two radio rows and a
        // checkbox, so it is measured open rather than shut.
        await openAdvanced(page);
        const opened = await metrics();
        expect(opened.scrollWidth, 'the advanced fields push the page wider than the screen')
            .toBeLessThanOrEqual(opened.innerWidth);

        await tool.pick(await portrait());

        // THE ELEMENT THIS TEST EXISTS FOR. The preview is an SVG whose viewBox
        // is the paper in pixels — 1200 across at the least — and a drawing
        // that honoured its own coordinates on a 390 px screen would run a
        // thousand pixels off the right edge.
        const preview = page.locator('figure').filter({ hasText: 'Preview — the file you download' });
        await expect(preview).toBeVisible();
        await preview.scrollIntoViewIfNeeded();

        const box = await preview.boundingBox();
        expect(box, 'the preview has no box to measure').not.toBeNull();
        expect(box.width, `the preview is ${Math.round(box.width)}px wide on a ${empty.innerWidth}px screen`)
            .toBeLessThanOrEqual(empty.innerWidth);
        expect(box.x, 'the preview starts left of the screen').toBeGreaterThanOrEqual(-1);

        const framed = await metrics();
        expect(framed.scrollWidth, 'the preview pushes the page wider than the screen')
            .toBeLessThanOrEqual(framed.innerWidth);

        await tool.run('Create sheet', { download: 'Download JPEG', timeout: SLOW });
        const saved = await tool.download('Download JPEG');

        // A preview that fits a phone is worth nothing if it made a sheet that
        // fits a phone too. The file is the paper, whatever the screen was.
        const out = await inspect(saved.file);
        expect(out.format).toBe('jpeg');
        expect(out.width).toBe(sheet.paper.widthPx);
        expect(out.height).toBe(sheet.paper.heightPx);
        expect(out.density).toBe(sheet.dpi);

        // The summary is a three-column comparison, which is exactly the shape
        // that overflows a 390px screen if it stays a table.
        const rows = await summaryRows(page);
        expect(rows.length, 'the summary reported nothing to measure').toBeGreaterThan(0);

        const withResult = await metrics();
        expect(withResult.scrollWidth, 'the result and its summary push the page wider than the screen')
            .toBeLessThanOrEqual(withResult.innerWidth);
    });
});
