const fs = require('node:fs');
const path = require('node:path');

const { test, expect } = require('../fixtures/resizo');
const {
    FIXTURE_DIR,
    bulkNoisePng,
    bulkPhoto,
    bulkPhotos,
    notesText,
    transparent,
    transparentPng,
} = require('../fixtures/files');
const { inspect, transparentShare } = require('../helpers/output');
const { readZip } = require('../helpers/zip');

/**
 * /bulk-image-compressor, driven as a person drives it.
 *
 * WHAT A BATCH CAN GET WRONG THAT ONE FILE CANNOT. Every other flow in this
 * directory ends at one download and one `inspect`. A batch adds four failure
 * modes that no single-file test can reach:
 *
 *   1. One file's outcome leaking into another's. The ceiling is PER FILE, so
 *      three files under 200 KB is three assertions, not one.
 *   2. A failure disappearing. A file the tool could not compress must be
 *      reported by name and must NOT be in the archive — the quiet version of
 *      this bug hands the visitor a ZIP that is short by one and says nothing.
 *   3. The archive disagreeing with the panel. The result list saying "3
 *      succeeded" and the ZIP holding two is exactly the sort of thing only
 *      opening the file catches, which is what ../helpers/zip.js is for.
 *   4. A format quietly changing. A batch that turned every PNG into a JPEG
 *      would look like a smaller download and be a destroyed alpha channel.
 *
 * So nothing here believes the page. Every success is re-opened with sharp —
 * the repo's independent libvips reference (CLAUDE.md > Gotchas) — and every
 * ZIP is unzipped and its entries counted, named and measured.
 *
 * THE FIXTURES ARE TUNED TO THE ENGINE'S OWN POLICY, not to round numbers.
 * `preserve` maps to the keep policy, whose quality search may go all the way
 * down to 1; `fit` stops turning quality at FIT_MIN_QUALITY (50) and starts
 * spending pixels instead (lib/image-client/compress-target.js). Measured on
 * the three batch photos, re-encoded at 1600×1067: quality 50 lands at 79–85 KB
 * and quality 1 at 8–9 KB. That is why 30 KB under `fit` cannot be met at full
 * size and must cost dimensions, while 50 KB under `preserve` is comfortably
 * reachable without touching a pixel dimension. Both margins are wide enough
 * that a codec rebuild moves the numbers without flipping an assertion.
 *
 * The no-upload guard and the browser-error guard run automatically here; a
 * batch that posted anything anywhere fails at teardown (../fixtures/resizo.js).
 */
const ROUTE = '/bulk-image-compressor';
const H1 = 'Compress Many Images to a Maximum File Size';

/** The site's kilobyte, everywhere: 1 KB = 1024 bytes. */
const KB = 1024;

/**
 * How long the queue itself may take: three real target searches, each up to
 * eight full encodes of a 1.7 MP frame, plus the ZIP the tab assembles.
 */
const RUN_WAIT = 120_000;

/**
 * The test's own budget, which has to be bigger than the wait above or the
 * test dies before its own assertion can report what went wrong. The extra
 * hour of the clock goes on the downloads and on sharp reopening each one.
 */
const TEST_BUDGET = 180_000;

/**
 * NAMES ARE MATCHED AS SUBSTRINGS, not exactly, and that is deliberate. A
 * preset chip renders its label and an optional detail inside one button
 * (components/tools/PresetChips.js), and a radio's accessible name can pick up
 * the hint sentence rendered with it — so an exact match would be an assertion
 * about a layout decision rather than about the control. Every name below is
 * still unique on the page: "50 KB" is not a substring of "500 KB", and no
 * other button carries a ceiling in its text.
 */
const results = (page) => page.locator('ul[aria-label="Results"] > li');
const rowFor = (page, name) => page.locator(`ul[aria-label="Results"] > li[data-name="${name}"]`);
const cell = (row, field) => row.locator(`[data-field="${field}"]`);
const zipButton = (page) => page.getByRole('button', { name: /Download all as ZIP \(\d+\)/ });
const rowDownload = (row) => row.getByRole('button', { name: /^Download .+-compressed\./ });

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
 * Chooses a ceiling by its chip.
 *
 * A chip that is ALREADY the active one is left alone. PresetChips reads a
 * press on the active chip as "unselect" (components/tools/PresetChips.js), so
 * pressing the default would clear the ceiling rather than confirm it — and
 * the run that followed would be measuring whatever the page fell back to.
 */
async function chooseLimit(page, label) {
    const chip = page.getByRole('button', { name: label });
    if ((await chip.getAttribute('aria-pressed')) !== 'true') await chip.click();
    await expect(chip).toHaveAttribute('aria-pressed', 'true');
}

/** Presses a download affordance and hands back the file the browser saved. */
async function save(page, locator) {
    const [download] = await Promise.all([page.waitForEvent('download'), locator.click()]);
    const file = await download.path();
    expect(file, 'the download produced no file').toBeTruthy();
    return { file, filename: download.suggestedFilename(), bytes: fs.statSync(file).size };
}

/** The batch summary, as { 'Selected': '3', 'Successful': '2', … }. */
async function readSummary(page) {
    const section = page.locator('section[aria-labelledby="bulk-compress-summary-heading"]');
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
 * Open, configure, select, compress — and wait for the run to finish.
 *
 * Settings go in BEFORE the files, which is the order the page lays them out
 * and the order a person meets them in: a file lands already configured.
 * Waiting on the ZIP button is waiting on the whole batch: it is the one
 * affordance that cannot appear until every file has settled.
 */
async function runBatch(tool, page, {
    files,
    preset = null,
    customKb = null,
    mode = 'Preserve dimensions',
    timeout = RUN_WAIT,
    // The action counts the files that will actually run. A file the intake
    // refuses is a row in the Results list, not a number on the button.
    runnable = files.length,
}) {
    await tool.open(ROUTE, { h1: H1 });

    const policy = page.getByRole('radio', { name: mode });
    await policy.check();
    await expect(policy).toBeChecked();

    if (preset !== null) await chooseLimit(page, preset);

    if (customKb !== null) {
        const limit = page.getByLabel('Custom limit (KB)');
        await limit.fill(String(customKb));
        // A value typed before React attached would be reverted by the
        // controlled input. Reading it back is what tells the two apart.
        await expect(limit).toHaveValue(String(customKb));
    }

    await select(tool, files);

    // The count in the label is the page's own answer to "what did I just
    // hand you", so it is asserted rather than matched loosely.
    const compress = page.getByRole('button', {
        name: `Compress ${runnable} image${runnable === 1 ? '' : 's'}`,
    });
    await expect(compress).toBeEnabled({ timeout: 20_000 });
    await compress.click();

    await expect(zipButton(page)).toBeVisible({ timeout });
}

/** Every successful row's own file, opened and measured. */
async function saveRow(page, name) {
    const row = rowFor(page, name);
    await expect(row).toHaveAttribute('data-status', 'success');
    await expect(cell(row, 'status')).toHaveText('Success');

    const saved = await save(page, rowDownload(row));
    return { ...saved, out: await inspect(saved.file) };
}

test('three photos each come back under a 200 KB ceiling, at full size, and in one archive', async ({ tool, page }) => {
    test.setTimeout(TEST_BUDGET);

    const photos = await bulkPhotos();
    await runBatch(tool, page, { files: photos, preset: '200 KB' });

    await expect(results(page)).toHaveCount(3);

    for (const [index, source] of photos.entries()) {
        const saved = await saveRow(page, path.basename(source));

        // The download is a file the visitor keeps, so its name is part of the
        // product: the source's own name plus what was done to it.
        expect(saved.filename).toBe(`bulk-photo-${index + 1}-compressed.jpg`);

        expect(saved.out.format).toBe('jpeg');
        // "Preserve dimensions" is the whole claim of this run. A smaller
        // picture would also be under 200 KB, and would be the wrong answer.
        expect(saved.out.width).toBe(1600);
        expect(saved.out.height).toBe(1067);
        expect(saved.out.bytes, `${saved.filename} is over the 200 KB ceiling`)
            .toBeLessThanOrEqual(200 * KB);
    }

    // The row states the saving in the page's own words; the file above states
    // it in bytes. Both, because a percentage nobody derived from the file is
    // exactly the number that goes stale.
    await expect(cell(rowFor(page, 'bulk-photo-1.jpg'), 'reduction')).toHaveText(/[-−]\d+%/);

    const summary = await readSummary(page);
    expect(countOf(summary, 'Selected')).toBe(3);
    expect(countOf(summary, 'Successful')).toBe(3);

    const zip = await save(page, zipButton(page));
    expect(zip.filename).toBe('resizo-compressed-images.zip');

    const entries = await readZip(zip.file);
    // Order, not just membership: a batch comes back in the order it went in.
    expect(entries.map((entry) => entry.name)).toEqual([
        'bulk-photo-1-compressed.jpg',
        'bulk-photo-2-compressed.jpg',
        'bulk-photo-3-compressed.jpg',
    ]);

    for (const entry of entries) {
        expect(entry.bytes, `${entry.name} is over the ceiling inside the archive`)
            .toBeLessThanOrEqual(200 * KB);
    }
});

test('fit under limit spends pixels when the ceiling needs them and keeps them when it does not', async ({ tool, page }) => {
    // Two runs in one test, so two budgets.
    test.setTimeout(2 * TEST_BUDGET);

    const photos = [await bulkPhoto(1), await bulkPhoto(2)];
    const names = photos.map((file) => path.basename(file));

    // 30 KB is out of reach at 1600×1067: the fit policy stops turning quality
    // at 50, and these photos are 79–85 KB there. So the only way under the
    // ceiling is a smaller picture, which is the trade this mode exists to make.
    await runBatch(tool, page, { files: photos, customKb: 30, mode: 'Fit under limit' });

    for (const name of names) {
        const saved = await saveRow(page, name);

        expect(saved.out.format).toBe('jpeg');
        expect(saved.out.bytes, `${saved.filename} is over the 30 KB ceiling`).toBeLessThanOrEqual(30 * KB);
        expect(saved.out.width, `${saved.filename} kept its width at a ceiling it cannot meet at full size`)
            .toBeLessThan(1600);

        // The shape survives the shrink. Cross-multiplying compares the two
        // ratios without floating point, and the tolerance is the long side —
        // one pixel of rounding on either dimension, no more.
        const drift = Math.abs(saved.out.width * 1067 - saved.out.height * 1600);
        expect(drift, `${saved.out.width}×${saved.out.height} is not the shape of 1600×1067`)
            .toBeLessThanOrEqual(1600);

        // And the row says so, rather than leaving the visitor to discover a
        // smaller picture when they open the file.
        await expect(cell(rowFor(page, name), 'dimensions'))
            .toHaveText(/1600\s*×\s*1067\s*→\s*\d+\s*×\s*\d+/);
    }

    // The control: the same files, the same policy, a ceiling they clear at
    // full size. Nothing may shrink. Without this half, "fit shrank them"
    // would be indistinguishable from "fit always shrinks".
    await runBatch(tool, page, { files: photos, preset: '500 KB', mode: 'Fit under limit' });

    for (const name of names) {
        const saved = await saveRow(page, name);

        expect(saved.out.bytes).toBeLessThanOrEqual(500 * KB);
        expect(saved.out.width, `${saved.filename} was shrunk to reach a ceiling it already met`).toBe(1600);
        expect(saved.out.height).toBe(1067);

        await expect(cell(rowFor(page, name), 'dimensions')).not.toHaveText(/→/);
    }
});

test('a mixed batch gives every file back in the format it arrived in, transparency included', async ({ tool, page }) => {
    test.setTimeout(TEST_BUDGET);

    const files = [await bulkPhoto(1), await transparentPng(), await transparent()];
    await runBatch(tool, page, { files, preset: '500 KB' });

    await expect(results(page)).toHaveCount(3);

    const photo = await saveRow(page, 'bulk-photo-1.jpg');
    expect(photo.filename).toBe('bulk-photo-1-compressed.jpg');
    expect(photo.out.format).toBe('jpeg');
    expect(photo.out.bytes).toBeLessThanOrEqual(500 * KB);

    const png = await saveRow(page, 'transparent-480x320.png');
    expect(png.filename).toBe('transparent-480x320-compressed.png');
    expect(png.out.format).toBe('png');
    expect(png.out.width).toBe(480);
    expect(png.out.height).toBe(320);

    const webp = await saveRow(page, 'transparent-320x240.webp');
    expect(webp.filename).toBe('transparent-320x240-compressed.webp');
    expect(webp.out.format).toBe('webp');
    expect(webp.out.width).toBe(320);
    expect(webp.out.height).toBe(240);

    // hasAlpha alone passes on a channel that is fully opaque, which is exactly
    // what a JPEG round trip or a flatten leaves behind. Both fixtures are a
    // shape on an empty field, so a real see-through area has to survive.
    expect(await transparentShare(png.file), 'the PNG came back with nothing see-through in it')
        .toBeGreaterThan(0.1);
    expect(await transparentShare(webp.file), 'the WebP came back with nothing see-through in it')
        .toBeGreaterThan(0.1);
});

test('a file that cannot meet the ceiling is named, explained, and left out of the archive', async ({ tool, page }) => {
    test.setTimeout(TEST_BUDGET);

    // The noise PNG is the impossible one and it is deliberately in the MIDDLE:
    // a failure at the end of a batch is the easy case, and one in the middle
    // is where a shared accumulator would take the following file down with it.
    const files = [await bulkPhoto(1), await bulkNoisePng(), await bulkPhoto(2)];
    await runBatch(tool, page, { files, preset: '50 KB' });

    await expect(results(page)).toHaveCount(3);

    const failed = rowFor(page, 'bulk-noise.png');
    await expect(failed).toHaveAttribute('data-status', 'unmet');
    await expect(cell(failed, 'status')).toHaveText('Could not meet target');

    // A refusal is the end of the story, so it has to reach the visitor as a
    // sentence they can act on — here, the one lever that would have worked.
    await expect(failed).toContainText(/reduce bulk-noise\.png below 50 KB/);
    await expect(failed).toContainText(/PNG has no quality setting/);
    await expect(failed).toContainText(/Fit under limit/);

    // Nothing to download from a row that produced nothing.
    await expect(rowDownload(failed)).toHaveCount(0);
    await expect(cell(failed, 'target')).toContainText('✗');

    for (const name of ['bulk-photo-1.jpg', 'bulk-photo-2.jpg']) {
        const saved = await saveRow(page, name);
        expect(saved.out.bytes, `${saved.filename} is over the 50 KB ceiling`).toBeLessThanOrEqual(50 * KB);
        // The neighbour of a failure is untouched by it — same policy, same
        // full size, its own result.
        expect(saved.out.width).toBe(1600);
        expect(saved.out.height).toBe(1067);
        await expect(cell(rowFor(page, name), 'target')).toContainText('✓');
    }

    const summary = await readSummary(page);
    expect(countOf(summary, 'Selected')).toBe(3);
    expect(countOf(summary, 'Successful')).toBe(2);
    expect(countOf(summary, 'Could not meet target')).toBe(1);

    const zip = await save(page, zipButton(page));
    const entries = await readZip(zip.file);

    expect(entries.map((entry) => entry.name)).toEqual([
        'bulk-photo-1-compressed.jpg',
        'bulk-photo-2-compressed.jpg',
    ]);
    expect(entries.some((entry) => entry.name.includes('bulk-noise')), 'the failed file is inside the ZIP')
        .toBe(false);
});

test('a file the tool cannot read at all is reported as unsupported and the rest still run', async ({ tool, page }) => {
    test.setTimeout(TEST_BUDGET);

    const files = [await bulkPhoto(1), await notesText(), await bulkPhoto(2)];
    await runBatch(tool, page, { files, preset: '200 KB', runnable: 2 });

    // Three rows for three chosen files. Silently dropping the one it cannot
    // read would leave a visitor counting two results against three files and
    // no explanation anywhere on the page.
    await expect(results(page)).toHaveCount(3);

    const rejected = rowFor(page, 'notes.txt');
    await expect(rejected).toHaveAttribute('data-status', 'unsupported');
    await expect(cell(rejected, 'status')).toHaveText('Unsupported');
    await expect(rowDownload(rejected)).toHaveCount(0);

    for (const name of ['bulk-photo-1.jpg', 'bulk-photo-2.jpg']) {
        const saved = await saveRow(page, name);
        expect(saved.out.format).toBe('jpeg');
        expect(saved.out.bytes).toBeLessThanOrEqual(200 * KB);
    }

    const summary = await readSummary(page);
    expect(countOf(summary, 'Unsupported')).toBe(1);
    expect(countOf(summary, 'Successful')).toBe(2);

    const zip = await save(page, zipButton(page));
    const entries = await readZip(zip.file);

    expect(entries).toHaveLength(2);
    expect(entries.some((entry) => entry.name.includes('notes')), 'a text file reached the archive').toBe(false);
});

/**
 * The phone width, in the project that runs everything.
 *
 * `tests/e2e/browser/mobile.spec.js` runs the same workflow on the Pixel 7 and
 * iPhone 14 profiles; this one holds the layout rule at 390px in chromium-full,
 * where the whole flow suite already runs. A rule that only holds on a phone
 * profile is a rule the desktop build can quietly break.
 */
test.describe('on a 390 px screen', () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test('a batch can be chosen, compressed and saved without the page overflowing sideways', async ({ tool, page }) => {
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

        // One of the two carries the kind of name a phone camera writes. It
        // is the name, not the bytes, that has widened pages before.
        const longName = path.join(FIXTURE_DIR, 'IMG_20260910_073951_HDR_PORTRAIT_ORIGINAL_EDITED_COPY_FINAL.jpg');
        fs.copyFileSync(await bulkPhoto(2), longName);
        const photos = [await bulkPhoto(1), longName];
        await runBatch(tool, page, { files: photos, preset: '200 KB' });
        const selectedWidths = await widths();
        expect(selectedWidths.scrollWidth, 'a long file name pushes the page wider than the screen')
            .toBeLessThanOrEqual(selectedWidths.innerWidth);

        // The result rows carry the widest content on this page — a file name,
        // a byte pair, two dimension pairs and a button — so the measurement
        // that matters is the one taken with the results on screen.
        const after = await widths();
        expect(after.scrollWidth, 'the results push the page wider than the screen')
            .toBeLessThanOrEqual(after.innerWidth);

        const saved = await saveRow(page, 'bulk-photo-1.jpg');
        expect(saved.out.format).toBe('jpeg');
        expect(saved.out.width).toBe(1600);
        expect(saved.out.bytes).toBeLessThanOrEqual(200 * KB);

        const zip = await save(page, zipButton(page));
        const entries = await readZip(zip.file);
        expect(entries.map((entry) => entry.name)).toEqual([
            'bulk-photo-1-compressed.jpg',
            'bulk-photo-2-compressed.jpg',
        ]);
    });
});
