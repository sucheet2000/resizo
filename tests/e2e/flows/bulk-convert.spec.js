const fs = require('node:fs');
const path = require('node:path');

const sharp = require('sharp');

const { test, expect } = require('../fixtures/resizo');
const {
    FIXTURE_DIR,
    bulkPhoto,
    bulkPhotos,
    notesText,
    transparent,
    transparentPng,
} = require('../fixtures/files');
const { inspect, transparentShare } = require('../helpers/output');
const { readZip } = require('../helpers/zip');

/**
 * /bulk-image-converter, driven as a person drives it.
 *
 * WHAT A CONVERTING BATCH CAN GET WRONG THAT A COMPRESSING ONE CANNOT. The
 * bulk compressor next door keeps every file in the format it arrived in, so
 * its flows can treat the format as a constant and spend their assertions on
 * bytes. This page changes the format on purpose, which puts four failures
 * within reach that ../flows/bulk-compress.spec.js has no way to produce:
 *
 *   1. An alpha channel dropped on the way out. PNG and WebP both carry one,
 *      so a PNG converted to WebP that comes back opaque is a see-through logo
 *      turned into a black or white box, and `hasAlpha` alone will not catch
 *      it — a flattened image still HAS the channel. Every transparency claim
 *      here is measured as a share of see-through pixels.
 *   2. A flatten that used the wrong colour. JPEG has no alpha, so a
 *      transparent pixel becomes SOME colour, and the only honest proof of
 *      which one is the pixel in the file the browser saved. The panel cannot
 *      be asked: a control that reports blue and posts white looks identical
 *      to a working one until the file is opened.
 *   3. A file already in the output format being re-encoded anyway. The
 *      product's promise is that it is handed back UNCHANGED, metadata and
 *      all, and "unchanged" is a byte-for-byte claim rather than a
 *      similar-looking one.
 *   4. A container that lies about its contents. A blob named `.webp` holding
 *      JPEG bytes opens in nothing, and the row that produced it would look
 *      exactly like a success. Every download here is reopened with sharp —
 *      the repo's independent libvips reference (CLAUDE.md > Gotchas) — and
 *      asked what it actually is.
 *
 * So nothing below believes the page. Rows are read for what they SAY, files
 * are opened for what they ARE, and the two are asserted separately.
 *
 * THE FIXTURES ARE CHOSEN FOR THEIR ALPHA, not for their size. The 480×320
 * PNG is a rounded rectangle inset from the frame, so its corner is clear over
 * NOTHING — that pixel can only be the fill colour, where a clear-white corner
 * would come back white even if the flattening never ran (MozJPEG reads RGBA
 * as RGBX and keeps the hidden 255s). The 320×240 WebP is an opaque disc on an
 * empty field, two thirds see-through. Both are small, because a conversion is
 * one encode rather than the eight-step byte search the compressor runs, and
 * the expensive fixtures here would buy nothing but wall time.
 *
 * The no-upload guard and the browser-error guard run automatically; a batch
 * that posted anything anywhere fails at teardown (../fixtures/resizo.js).
 */
const ROUTE = '/bulk-image-converter';
const H1 = 'Convert Many Images to One Format';

/** The archive this page hands back, named for what is in it. */
const ZIP_NAME = 'resizo-converted-images.zip';

/**
 * How long a queue may take: several full-frame encodes, each behind a codec
 * the browser fetches and instantiates on first use, plus the ZIP the tab
 * assembles at the end.
 */
const RUN_WAIT = 120_000;

/**
 * The test's own budget, which has to exceed the wait above or the test dies
 * before its own assertion can report what went wrong. The extra time goes on
 * the downloads and on sharp reopening each one.
 */
const TEST_BUDGET = 180_000;

/**
 * NAMES ARE MATCHED AS SUBSTRINGS, not exactly, and that is deliberate. A
 * preset chip renders its label and an optional detail inside one button
 * (components/tools/PresetChips.js), and a radio's accessible name can pick up
 * the hint sentence rendered with it — so an exact match would be an assertion
 * about a layout decision rather than about the control. The format chips are
 * still looked up inside their own group, because "PNG" and "JPG" are words
 * this page also says in its prose and its file names.
 */
const results = (page) => page.locator('ul[aria-label="Results"] > li');
const rowFor = (page, name) => page.locator(`ul[aria-label="Results"] > li[data-name="${name}"]`);
const cell = (row, field) => row.locator(`[data-field="${field}"]`);
const formats = (page) => page.getByRole('group', { name: 'Output format' });
const zipButton = (page) => page.getByRole('button', { name: /Download all as ZIP \(\d+\)/ });

/**
 * The per-row download. The extension is part of the pattern on purpose: the
 * whole subject of this page is what came out, and a button reading "Download
 * photo.png" on a row that was asked for WebP is the bug this catches before
 * any file is opened.
 */
const rowDownload = (row) => row.getByRole('button', { name: /^Download \S+\.(jpg|png|webp)$/ });

/**
 * Hands the page several files at once.
 *
 * `tool.pick` takes one path and flags the network guard as having processed
 * something; a batch goes through the same input and has to set the same flag,
 * or the guard would pass vacuously on the one page where the most bytes move.
 */
async function select(tool, files) {
    tool.network.processed = true;
    await tool.page.locator('input[type="file"]').first().setInputFiles(files);
}

/**
 * Chooses the output format by its chip.
 *
 * A chip that is ALREADY the active one is left alone. PresetChips reads a
 * press on the active chip as "unselect" (components/tools/PresetChips.js), so
 * pressing WebP — this page's default — would clear the output format rather
 * than confirm it, and the run that followed would be measuring whatever the
 * page fell back to. Reading the state first also asserts the default, which
 * is otherwise a fact no flow here would ever check.
 */
async function chooseFormat(page, label) {
    const chip = formats(page).getByRole('button', { name: label });
    if ((await chip.getAttribute('aria-pressed')) !== 'true') await chip.click();
    await expect(chip).toHaveAttribute('aria-pressed', 'true');
}

/**
 * Chooses what a transparent pixel becomes on the way into a JPEG.
 *
 * A hex goes through the Custom radio, because the colour input only exists
 * once Custom is chosen (components/tools/TransparencyBackground.js) — asking
 * for it first finds nothing and waits for a control the page has no reason
 * to render yet.
 */
async function chooseBackground(page, background) {
    const hex = background.startsWith('#');
    const name = hex ? 'Custom' : background;
    const radio = page.getByRole('radio', { name, exact: true });

    // Waited for by name rather than assumed present. A page that stopped
    // offering the control would otherwise fail as a bare test timeout on the
    // click, instead of saying which control went missing and why it matters.
    await expect(
        radio,
        `the transparency control never offered "${name}" — it is rendered only once a selected file could carry alpha`,
    ).toBeVisible({ timeout: 20_000 });

    await radio.check();
    await expect(radio).toBeChecked();

    if (hex) await page.getByLabel('Custom colour').fill(background);
}

/** Presses a download affordance and hands back the file the browser saved. */
async function save(page, locator) {
    const [download] = await Promise.all([page.waitForEvent('download'), locator.click()]);
    const file = await download.path();
    expect(file, 'the download produced no file').toBeTruthy();
    return { file, filename: download.suggestedFilename(), bytes: fs.statSync(file).size };
}

/** The batch summary, as { 'Selected': '3', 'Converted': '2', … }. */
async function readSummary(page) {
    const section = page.locator('section[aria-labelledby="bulk-convert-summary-heading"]');
    await expect(section).toBeVisible();

    return section.evaluate((element) => {
        const pairs = {};
        for (const term of element.querySelectorAll('dt')) {
            const value = term.nextElementSibling;
            if (value) pairs[term.textContent.trim()] = value.textContent.trim();
        }
        return pairs;
    });
}

/**
 * One count out of the summary, read as a number rather than as a string.
 *
 * The label is the contract; whether the page writes "2" or "2 files" beside
 * it is presentation, and an assertion that broke on the second would be
 * asserting a layout decision.
 */
function countOf(summary, label) {
    const value = summary[label];
    expect(value, `the batch summary has no "${label}" pair — it has ${Object.keys(summary).join(', ')}`)
        .toBeDefined();

    const found = /-?\d+/.exec(value.replace(/,/g, ''));
    expect(found, `the "${label}" value is not a number: ${value}`).not.toBeNull();
    return Number(found[0]);
}

/**
 * Open, choose the format, select, convert — and wait for the run to finish.
 *
 * The FORMAT goes in before the files and the BACKGROUND after them, which is
 * not an inconsistency: the format chips are painted from the first render, so
 * a file lands already configured, while the transparency control only exists
 * once the page can see that a selected file might carry alpha. That is the
 * order a person meets the two controls in as well.
 *
 * Waiting on the ZIP button is waiting on the whole batch: it is the one
 * affordance that cannot appear until every file has settled.
 */
async function runBatch(tool, page, {
    files,
    format = 'WebP',
    background = null,
    timeout = RUN_WAIT,
    // The action counts the files that will actually run. A file the intake
    // refuses is a row in the Results list, not a number on the button.
    runnable = files.length,
}) {
    await tool.open(ROUTE, { h1: H1 });

    await chooseFormat(page, format);
    await select(tool, files);
    if (background !== null) await chooseBackground(page, background);

    // The count in the label is the page's own answer to "what did I just hand
    // you", so it is asserted rather than matched loosely.
    const convert = page.getByRole('button', {
        name: `Convert ${runnable} image${runnable === 1 ? '' : 's'}`,
    });
    await expect(convert).toBeEnabled({ timeout: 20_000 });
    await convert.click();

    await expect(zipButton(page)).toBeVisible({ timeout });
}

/**
 * One row's own file, opened and measured.
 *
 * `status` is the row's own word for what happened — "Converted" for work
 * done, "Already in format" for a file handed back untouched — and it is
 * asserted by the caller rather than here, because which of the two a row
 * should show is the thing most worth getting wrong.
 */
async function saveRow(page, name) {
    const row = rowFor(page, name);
    await expect(row).toHaveAttribute('data-status', 'success');

    const saved = await save(page, rowDownload(row));
    return { ...saved, out: await inspect(saved.file) };
}

/**
 * The top-left pixel of a saved file, as libvips reads it back.
 *
 * `removeAlpha` rather than `ensureAlpha`: this is only ever asked of a JPEG,
 * which has no alpha channel to report, and the question is which three
 * numbers took the transparency's place.
 */
async function cornerPixel(file) {
    const { data } = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    return [data[0], data[1], data[2]];
}

/** A colour, within what a JPEG encode moves a flat field. */
function expectColourNear(actual, expected, label, tolerance = 3) {
    for (let channel = 0; channel < 3; channel += 1) {
        expect(
            Math.abs(actual[channel] - expected[channel]),
            `${label}: the corner read ${actual.join(',')}, expected about ${expected.join(',')}`,
        ).toBeLessThanOrEqual(tolerance);
    }
}

/* ------------------------------------------------------------------ *
 * 1 — the headline: one format for the whole batch
 * ------------------------------------------------------------------ */

test('three photos come back as WebP at their own size, in one archive, in order', async ({ tool, page }, testInfo) => {
    test.setTimeout(TEST_BUDGET);

    const photos = await bulkPhotos();
    await runBatch(tool, page, { files: photos, format: 'WebP' });

    await expect(results(page)).toHaveCount(3);

    for (const [index, source] of photos.entries()) {
        const name = path.basename(source);
        const saved = await saveRow(page, name);

        await expect(cell(rowFor(page, name), 'status')).toHaveText('Converted');

        // The download is a file the visitor keeps, so its name is part of the
        // product: the source's own name, carrying the new extension. No
        // prefix and no suffix — a converted file is still the same picture.
        expect(saved.filename).toBe(`bulk-photo-${index + 1}.webp`);

        expect(saved.out.format).toBe('webp');
        // Converting is not resizing. A batch that quietly shrank to make the
        // files smaller would look like a better result and be the wrong one.
        expect(saved.out.width).toBe(1600);
        expect(saved.out.height).toBe(1067);
    }

    // The row states both sides in the page's own words; the files above state
    // the output in bytes. Both, because a row that stopped naming the format
    // it produced would leave the visitor guessing what they just downloaded.
    const first = rowFor(page, 'bulk-photo-1.jpg');
    await expect(cell(first, 'input')).toContainText('JPEG');
    await expect(cell(first, 'output')).toContainText('WebP');

    const summary = await readSummary(page);
    expect(countOf(summary, 'Selected')).toBe(3);
    expect(countOf(summary, 'Converted')).toBe(3);
    expect(countOf(summary, 'Already in format')).toBe(0);

    const zip = await save(page, zipButton(page));
    expect(zip.filename).toBe(ZIP_NAME);

    const entries = await readZip(zip.file);
    // Order, not just membership: a batch comes back in the order it went in.
    expect(entries.map((entry) => entry.name)).toEqual([
        'bulk-photo-1.webp',
        'bulk-photo-2.webp',
        'bulk-photo-3.webp',
    ]);

    // The archive is assembled in the tab out of blobs the codec wrote, which
    // is a second place the bytes can go wrong after the row download proved
    // them once. So one entry is unpacked and reopened rather than counted.
    const unpacked = testInfo.outputPath(entries[0].name);
    fs.writeFileSync(unpacked, entries[0].buffer);

    const out = await inspect(unpacked);
    expect(out.format, 'the file inside the archive is not a WebP').toBe('webp');
    expect(out.width).toBe(1600);
    expect(out.height).toBe(1067);
});

/* ------------------------------------------------------------------ *
 * 2 — what a transparent pixel becomes in a JPEG
 * ------------------------------------------------------------------ */

test('converting to JPG fills the transparency with white, with black, or with the colour that was picked', async ({ tool, page }) => {
    // Three runs of a 480×320 file. Small work, three times over.
    test.setTimeout(TEST_BUDGET);

    const png = await transparentPng();
    const name = 'transparent-480x320.png';

    /**
     * One run, and the corner of the file it produced. `background` of null is
     * the run that chooses nothing at all — the default the page applies on
     * its own, which is a default nobody would otherwise assert.
     */
    async function convertWith(background) {
        await runBatch(tool, page, { files: [png], format: 'JPG', background });

        const saved = await saveRow(page, name);
        expect(saved.filename).toBe('transparent-480x320.jpg');

        expect(saved.out.format).toBe('jpeg');
        expect(saved.out.width).toBe(480);
        expect(saved.out.height).toBe(320);
        // JPEG cannot carry one, and a file that still claimed alpha would
        // mean the flattening never ran and the encoder dropped the byte.
        expect(saved.out.hasAlpha).toBe(false);

        return { ...saved, corner: await cornerPixel(saved.file) };
    }

    // White without being asked: what a logo or a signature going onto a white
    // page needs, and the colour lib/image-client/flatten.js composites onto.
    const white = await convertWith(null);
    expectColourNear(white.corner, [255, 255, 255], 'the default fill');

    // And the row says what it did, rather than leaving the visitor to
    // discover the fill when they open the file over a dark page.
    await expect(rowFor(page, name)).toContainText(/placed on white/i);

    const black = await convertWith('Black');
    expectColourNear(black.corner, [0, 0, 0], 'a chosen black');
    await expect(rowFor(page, name)).toContainText(/placed on black/i);

    const custom = await convertWith('#2f6fed');
    expectColourNear(custom.corner, [0x2f, 0x6f, 0xed], 'a custom hex');
    await expect(rowFor(page, name)).toContainText('#2f6fed');
});

/* ------------------------------------------------------------------ *
 * 3 and 4 — the two directions that must keep an alpha channel
 * ------------------------------------------------------------------ */

test('a transparent PNG converted to WebP is still see-through afterwards', async ({ tool, page }) => {
    test.setTimeout(TEST_BUDGET);

    await runBatch(tool, page, { files: [await transparentPng()], format: 'WebP' });

    const saved = await saveRow(page, 'transparent-480x320.png');
    expect(saved.filename).toBe('transparent-480x320.webp');
    await expect(cell(rowFor(page, 'transparent-480x320.png'), 'status')).toHaveText('Converted');

    expect(saved.out.format).toBe('webp');
    expect(saved.out.width).toBe(480);
    expect(saved.out.height).toBe(320);
    expect(saved.out.hasAlpha).toBe(true);

    // hasAlpha alone passes on a channel that is fully opaque, which is exactly
    // what a flatten leaves behind. The fixture is a 240×160 shape on a 480×320
    // frame, so three quarters of the source is see-through; a tenth is
    // asserted, which is wide enough that a codec rebuild moves the number
    // without flipping the assertion, and far from the zero a flatten leaves.
    expect(await transparentShare(saved.file), 'the WebP came back with nothing see-through in it')
        .toBeGreaterThan(0.1);

    // Nothing was filled in, so the page must not claim anything was.
    await expect(rowFor(page, 'transparent-480x320.png')).not.toContainText(/placed on/i);
});

test('a transparent WebP converted to PNG opens as a PNG that kept its transparency', async ({ tool, page }) => {
    test.setTimeout(TEST_BUDGET);

    await runBatch(tool, page, { files: [await transparent()], format: 'PNG' });

    const saved = await saveRow(page, 'transparent-320x240.webp');
    expect(saved.filename).toBe('transparent-320x240.png');

    expect(saved.out.format).toBe('png');
    expect(saved.out.width).toBe(320);
    expect(saved.out.height).toBe(240);
    expect(saved.out.hasAlpha).toBe(true);

    // The fixture is an r=90 disc on 320×240, so the disc covers about a third
    // and the transparent field is the other two thirds.
    expect(await transparentShare(saved.file), 'the PNG came back with nothing see-through in it')
        .toBeGreaterThan(0.5);
});

/* ------------------------------------------------------------------ *
 * 5 — three formats in, one format out, and one file that needs no work
 * ------------------------------------------------------------------ */

test('a mixed batch converges on one format and hands back the file that was already in it, untouched', async ({ tool, page }) => {
    test.setTimeout(TEST_BUDGET);

    const photo = await bulkPhoto(1);
    const png = await transparentPng();
    const webp = await transparent();

    await runBatch(tool, page, { files: [photo, png, webp], format: 'WebP' });

    await expect(results(page)).toHaveCount(3);

    const converted = await saveRow(page, 'bulk-photo-1.jpg');
    expect(converted.filename).toBe('bulk-photo-1.webp');
    expect(converted.out.format).toBe('webp');
    expect(converted.out.width).toBe(1600);
    expect(converted.out.height).toBe(1067);
    await expect(cell(rowFor(page, 'bulk-photo-1.jpg'), 'status')).toHaveText('Converted');

    const alpha = await saveRow(page, 'transparent-480x320.png');
    expect(alpha.filename).toBe('transparent-480x320.webp');
    expect(alpha.out.format).toBe('webp');
    expect(alpha.out.hasAlpha).toBe(true);
    expect(await transparentShare(alpha.file)).toBeGreaterThan(0.1);

    // The third file is ALREADY a WebP, and the product's answer to that is to
    // do nothing at all: no re-encode, no strip, the visitor's own file back.
    // "Unchanged" is a byte-for-byte claim, so it is checked as one — a
    // re-encode that happened to land on a similar size would pass anything
    // weaker, and would have silently thrown away the metadata.
    const kept = await saveRow(page, 'transparent-320x240.webp');
    expect(kept.filename).toBe('transparent-320x240.webp');
    await expect(cell(rowFor(page, 'transparent-320x240.webp'), 'status')).toHaveText('Already in format');
    await expect(rowFor(page, 'transparent-320x240.webp')).toContainText(/kept unchanged/i);

    expect(
        fs.readFileSync(kept.file).equals(fs.readFileSync(webp)),
        'the file that was already a WebP came back with different bytes',
    ).toBe(true);

    const summary = await readSummary(page);
    expect(countOf(summary, 'Selected')).toBe(3);
    expect(countOf(summary, 'Converted')).toBe(2);
    expect(countOf(summary, 'Already in format')).toBe(1);

    // The kept file is in the archive too. It is one of the three the visitor
    // chose, and an archive short by the file that needed no work would be the
    // quietest possible way to lose it.
    const zip = await save(page, zipButton(page));
    expect(zip.filename).toBe(ZIP_NAME);

    const entries = await readZip(zip.file);
    expect(entries.map((entry) => entry.name)).toEqual([
        'bulk-photo-1.webp',
        'transparent-480x320.webp',
        'transparent-320x240.webp',
    ]);
});

/* ------------------------------------------------------------------ *
 * 6 — a file that is not an image at all
 * ------------------------------------------------------------------ */

test('a file the tool cannot read is reported as unsupported, kept out of the archive, and the rest still run', async ({ tool, page }) => {
    test.setTimeout(TEST_BUDGET);

    // The refused file is deliberately in the MIDDLE: one at the end of a
    // batch is the easy case, and one in the middle is where a shared
    // accumulator would take the following file down with it.
    const files = [await bulkPhoto(1), await notesText(), await bulkPhoto(2)];
    await runBatch(tool, page, { files, format: 'WebP', runnable: 2 });

    // Three rows for three chosen files. Silently dropping the one it cannot
    // read would leave a visitor counting two results against three files and
    // no explanation anywhere on the page.
    await expect(results(page)).toHaveCount(3);

    const rejected = rowFor(page, 'notes.txt');
    await expect(rejected).toHaveAttribute('data-status', 'unsupported');
    await expect(cell(rejected, 'status')).toHaveText('Unsupported');
    // Nothing to download from a row that produced nothing.
    await expect(rowDownload(rejected)).toHaveCount(0);

    for (const [index, name] of ['bulk-photo-1.jpg', 'bulk-photo-2.jpg'].entries()) {
        const saved = await saveRow(page, name);
        // The neighbour of a refusal is untouched by it — same format, same
        // full size, its own result.
        expect(saved.filename).toBe(`bulk-photo-${index + 1}.webp`);
        expect(saved.out.format).toBe('webp');
        expect(saved.out.width).toBe(1600);
        expect(saved.out.height).toBe(1067);
    }

    const summary = await readSummary(page);
    expect(countOf(summary, 'Selected')).toBe(3);
    expect(countOf(summary, 'Converted')).toBe(2);
    expect(countOf(summary, 'Unsupported')).toBe(1);

    const zip = await save(page, zipButton(page));
    const entries = await readZip(zip.file);

    expect(entries.map((entry) => entry.name)).toEqual(['bulk-photo-1.webp', 'bulk-photo-2.webp']);
    expect(entries.some((entry) => entry.name.includes('notes')), 'a text file reached the archive')
        .toBe(false);
});

/* ------------------------------------------------------------------ *
 * 7 — the same workflow on a phone-width screen
 * ------------------------------------------------------------------ */

/**
 * The phone width, in the project that runs everything.
 *
 * `tests/e2e/browser/mobile.spec.js` runs this workflow on the Pixel 7 and
 * iPhone 14 profiles; this one holds the layout rule at 390px in chromium-full,
 * where the whole flow suite already runs. A rule that only holds on a phone
 * profile is a rule the desktop build can quietly break.
 */
test.describe('on a 390 px screen', () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test('a batch can be chosen, converted and saved without the page overflowing sideways', async ({ tool, page }) => {
        test.setTimeout(TEST_BUDGET);

        const widths = () => page.evaluate(() => ({
            scrollWidth: document.scrollingElement.scrollWidth,
            innerWidth: window.innerWidth,
        }));

        await tool.open(ROUTE, { h1: H1 });

        // A phone has no horizontal scrollbar to warn you: an element wider
        // than the screen just cuts the page off at the right edge.
        const before = await widths();
        expect(before.scrollWidth, 'the page is wider than the screen before any file is chosen')
            .toBeLessThanOrEqual(before.innerWidth);

        // One of the two carries the kind of name a phone camera writes. It is
        // the name, not the bytes, that has widened pages before — and this
        // page prints it twice per row, once as the row's heading and once
        // inside its Download button.
        const longName = path.join(FIXTURE_DIR, 'IMG_20260910_114233_HDR_PANORAMA_CONVERTED_COPY_FINAL.jpg');
        fs.copyFileSync(await bulkPhoto(2), longName);

        await runBatch(tool, page, { files: [await bulkPhoto(1), longName], format: 'WebP' });

        // The result rows carry the widest content on this page — a file name,
        // two format-and-byte lines, a dimensions pair and a button — so the
        // measurement that matters is the one taken with the results on screen.
        const after = await widths();
        expect(after.scrollWidth, 'the results push the page wider than the screen')
            .toBeLessThanOrEqual(after.innerWidth);

        const saved = await saveRow(page, 'bulk-photo-1.jpg');
        expect(saved.filename).toBe('bulk-photo-1.webp');
        expect(saved.out.format).toBe('webp');
        expect(saved.out.width).toBe(1600);
        expect(saved.out.height).toBe(1067);

        const zip = await save(page, zipButton(page));
        expect(zip.filename).toBe(ZIP_NAME);

        const entries = await readZip(zip.file);
        expect(entries.map((entry) => entry.name)).toEqual([
            'bulk-photo-1.webp',
            'IMG_20260910_114233_HDR_PANORAMA_CONVERTED_COPY_FINAL.webp',
        ]);
    });
});
