const path = require('node:path');

const sharp = require('sharp');

const { test, expect } = require('../fixtures/resizo');
const { portrait, transparentPng } = require('../fixtures/files');
const { inspect } = require('../helpers/output');

/**
 * /image-size-fitter, driven the way somebody with a portal's rules in front of
 * them drives it: type the pixels, the format and the ceiling the form states,
 * put the picture where you want it inside the frame, and get one file back
 * that either meets every rule or is refused in words.
 *
 * WHY THIS PAGE NEEDS ITS OWN FLOWS WHEN /passport-photo ALREADY HAS EIGHT.
 * They share an engine op, a validator, a frame and a byte search — and share
 * nothing else that matters here. The passport page is driven by verified
 * presets whose numbers come from an authority; this one is driven by numbers a
 * stranger's upload form invented, which means every field is typed, the
 * advanced half is behind a disclosure, and the interesting requirements are
 * combinations no preset would ever state: a physical size with a DPI, a
 * transparent source flattened onto a colour the visitor picked, a WebP with a
 * quality search and no density record to write.
 *
 * THE RULE EVERY FLOW HERE OBEYS: a byte ceiling is never checked without the
 * dimensions being re-checked in the same breath. A 10 KB file at 400×400 meets
 * the ceiling and fails the form, and it is exactly what a search allowed to
 * spend pixels would hand back. Nothing on this page may spend pixels.
 *
 * AND NOTHING BELIEVES THE PANEL. The requirement summary is produced by
 * validateOutput reading the finished bytes, so it is already a second opinion
 * rather than an echo of the form — but it is still the product's own opinion.
 * Every value it prints is checked against sharp, the repo's independent
 * libvips reference (CLAUDE.md > Gotchas), reading the same download.
 *
 * The no-upload guard and the browser-error guard run automatically for all of
 * these (../fixtures/resizo.js), so every flow below re-proves from the request
 * log that the picture never left the device.
 */

const ROUTE = '/image-size-fitter';
const H1 = 'Fit an Image to Exact Dimensions and File Size';

/** The page's own "no image to hand?" file, and the source most flows use. */
const SAMPLE = path.join(__dirname, '..', '..', '..', 'public', 'samples', 'landscape-1600x1067.jpg');

const KB = 1024;

/** A WASM codec fetch plus a multi-encode byte search wants more than the default. */
const SLOW = 90_000;
const SLOW_TEST = 150_000;

/**
 * The engine's own refusal for a ceiling no quality can reach, curly
 * apostrophe included (lib/image-client/operations.js runFit).
 *
 * MEASURED, NOT GUESSED. A centred 1:1 crop of the sample at 600×600 is 11.3 KB
 * through libvips' MozJPEG at quality 50 — the floor the fit op stops at
 * (FIT_MIN_QUALITY in lib/limits.js) — and 1.6 KB at quality 1. So 10 KB at 800 × 800 is
 * genuinely out of reach with the floor in place and genuinely reachable once
 * "Allow lower quality" lifts it: neither half of this flow is a lucky number.
 */
const NO_JPEG_UNDER_10KB = 'Resizo couldn’t produce a JPEG under 10 KB at 800 × 800 pixels.';

/** The custom fill colour flow 5 asks for, and what libvips must read back. */
const CUSTOM_BACKGROUND = '#2f6fed';
const CUSTOM_RGB = { r: 0x2f, g: 0x6f, b: 0xed };

/* ------------------------------------------------------------------ *
 * Driving the form
 * ------------------------------------------------------------------ */

/**
 * The advanced half, opened once and only if it is shut.
 *
 * Pressed blindly it would be a toggle, and a flow that opened the panel twice
 * would close it and then fill fields nobody can see. The disclosure states its
 * own state, so it is read before it is pressed — the same shape the bulk flows
 * use on a PresetChips chip that is already active.
 */
async function openAdvanced(page) {
    const toggle = page.locator('#fit-advanced');
    if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('#fit-advanced-panel')).toBeVisible();
}

/**
 * Types a requirement the way a form states it.
 *
 * THE UNIT AND THE FORMAT ARE SET WHENEVER THEY MATTER, never left to whatever
 * the page happens to open on. A flow that typed 35 into Width while the unit
 * sat on pixels would be asking for thirty-five PIXELS — a wrong test that
 * still passes on the day the default suits it.
 *
 * Anything under `Advanced options` opens the disclosure first, because a field
 * inside a collapsed panel cannot be filled and the failure reads as a missing
 * element rather than as a shut drawer.
 */
function requirement(page, {
    width,
    height,
    unit,
    dpi,
    maxKb,
    minKb,
    format,
    geometry,
    background,
    lowerQuality,
} = {}) {
    const advanced = [unit, dpi, minKb, geometry, background, lowerQuality]
        .some((value) => value !== undefined);

    return async () => {
        if (advanced) await openAdvanced(page);

        if (unit !== undefined) await page.getByLabel('Unit', { exact: true }).selectOption(unit);
        if (width !== undefined) await page.getByLabel('Width', { exact: true }).fill(String(width));
        if (height !== undefined) await page.getByLabel('Height', { exact: true }).fill(String(height));
        if (dpi !== undefined) await page.getByLabel(/^DPI/).fill(String(dpi));

        // Substring names on purpose: "Crop to fill" also finds "Crop to fill
        // (recommended)", which is the label the shared fieldset carries today.
        if (geometry !== undefined) await page.getByRole('radio', { name: geometry }).check();
        if (format !== undefined) await page.getByRole('radio', { name: format, exact: true }).check();

        if (maxKb !== undefined) await page.getByLabel('Maximum file size (KB)').fill(String(maxKb));
        if (minKb !== undefined) await page.getByLabel('Minimum file size (KB)').fill(String(minKb));

        if (background !== undefined) {
            await page.getByRole('radio', { name: 'Custom', exact: true }).check();
            await page.getByLabel('Custom colour').fill(background);
        }

        if (lowerQuality) await page.locator('#fit-lower-quality').check();
    };
}

/**
 * The requirement summary, read out of the DOM as a person reads it: the row's
 * name, what was asked for, what the file actually is, and the word — never the
 * colour — that says whether the two agree.
 *
 * A near-copy of the reader in passport.spec.js, and deliberately not shared
 * with it: that file is the extraction guard for this work and has to pass
 * untouched, so nothing here edits it. The two will diverge the day the two
 * pages render different summaries, which is information rather than drift.
 */
function summaryRows(page) {
    return page.evaluate(() => {
        const heading = [...document.querySelectorAll('h3')]
            .find((element) => (element.textContent || '').startsWith('What was checked'));
        const list = heading?.parentElement?.querySelector('dl');
        if (!list) return [];

        return [...list.querySelectorAll(':scope > div')].map((row) => {
            // The visible text of each cell: the direct spans only, and only
            // their own text nodes, so the sr-only column names a screen reader
            // hears ("required", "actual") stay out of the comparison.
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

/**
 * The top-left pixel of a file, as RGBA, from sharp's own raw decode.
 *
 * The corner is the one place a fill colour can be read without argument: the
 * fixture's shape is inset, so that pixel is transparent in the source by
 * construction rather than by luck, and whatever colour it holds afterwards can
 * only be the colour the flatten put there.
 */
async function cornerPixel(file) {
    const { data } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    return { r: data[0], g: data[1], b: data[2], a: data[3] };
}

/** Viewport height and the widths that decide whether the page scrolls sideways. */
function metrics(page) {
    return page.evaluate(() => ({
        innerWidth: window.innerWidth,
        scrollWidth: document.scrollingElement.scrollWidth,
    }));
}

/* ------------------------------------------------------------------ *
 * 1 · Two numbers off a form, one exact file back — and a frame that
 *     invalidates the file the moment it moves
 * ------------------------------------------------------------------ */

test('a 600×600 requirement crops the sample to fill and hands back exactly 600×600', async ({ tool, page }) => {
    test.setTimeout(SLOW_TEST);

    await tool.open(ROUTE, { h1: H1 });

    // Nothing to fit yet: the action says so rather than failing on a press.
    await expect(page.getByRole('button', { name: 'Fit image' })).toBeDisabled();

    // Every number a form states is knowable before there is a picture, and the
    // page puts the requirement above the drop zone for exactly that reason.
    await requirement(page, { width: 600, height: 600 })();

    // The contracted ids and the visible labels have to be the same controls.
    // Filling by label proves the labelling; this proves the id a page test, a
    // benchmark run and this file all address the field by.
    for (const [label, id] of [['Width', 'fit-width'], ['Height', 'fit-height']]) {
        await expect(page.getByLabel(label, { exact: true })).toHaveAttribute('id', id);
    }
    await expect(page.getByLabel('Maximum file size (KB)')).toHaveAttribute('id', 'fit-max-kb');

    // The page's own sample, fetched by the page from /samples — the same file
    // the benchmark feeds this tool, so the figure on the page and the picture
    // a visitor tries are one file. The guard is flagged by hand because
    // nothing went through tool.pick here.
    tool.network.processed = true;
    await page.getByRole('button', { name: 'Try the sample photo' }).click();

    // Crop to fill is the default, so a square target means a square frame.
    const frame = page.locator('#fit-frame');
    await expect(frame).toBeVisible();

    // And the frame's own commentary says which picture is under it: a centred
    // 1:1 cover crop of a 1600×1067 landscape is the full 1067 of its height.
    // The left edge is deliberately not asserted — where the crop starts is a
    // rounding choice — but the height is arithmetic, and it is how this flow
    // knows the sample button loaded the landscape rather than something else.
    await expect(page.getByText(/^Keeping 1067×1067 pixels from/)).toBeVisible();

    await tool.run('Fit image', { download: 'Download image', timeout: SLOW });
    const saved = await tool.download('Download image');

    const out = await inspect(saved.file);
    expect(out.format).toBe('jpeg');
    // Exact, not "at most": a portal that says 600×600 rejects 600×599.
    expect(out.width).toBe(600);
    expect(out.height).toBe(600);

    // The download is a file the visitor keeps, so its name is part of the
    // product: the fit op's own prefix, and an extension that follows the
    // format actually written.
    expect(saved.filename).toMatch(/^resizo-[\w-]+\.jpg$/);

    await expect(page.getByRole('heading', { name: 'All requirements met' })).toBeVisible();

    // A move after a result is a new job. The zoom slider is a frame move with
    // no pointer arithmetic in it, and the rectangle's own running commentary
    // is the self-check: without it, a slider that did nothing would leave
    // every assertion below passing for the wrong reason.
    const position = page.getByText(/^Keeping \d+×\d+ pixels from/);
    const before = await position.textContent();
    await page.locator('#fit-frame-zoom').fill('2');
    expect(await position.textContent(), 'the frame did not move under the zoom').not.toBe(before);

    // The old file may not be handed over as if it were this crop, and the
    // button to run the new one is back.
    await expect(page.getByRole('button', { name: 'Download image' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Fit image' })).toBeVisible();
});

/* ------------------------------------------------------------------ *
 * 2 · Pixels and bytes at the same time, and a summary that agrees
 *     with libvips about the file it is describing
 * ------------------------------------------------------------------ */

test('a 100 KB ceiling is met without giving up a pixel, and the summary matches the bytes', async ({ tool, page }) => {
    test.setTimeout(SLOW_TEST);

    const saved = await tool.process({
        route: ROUTE,
        h1: H1,
        file: SAMPLE,
        before: requirement(page, { width: 600, height: 600, format: 'JPEG', maxKb: 100 }),
        button: 'Fit image',
        download: 'Download image',
        timeout: SLOW,
    });

    const out = await inspect(saved.file);
    expect(out.format).toBe('jpeg');
    expect(out.bytes).toBeLessThanOrEqual(100 * KB);
    // The half a byte search can quietly spend to reach a ceiling. /compress is
    // allowed to trade pixels for bytes because its own policy says so; this
    // page never is, and a 100 KB file at 512×512 would pass the line above
    // and fail the form.
    expect(out.width).toBe(600);
    expect(out.height).toBe(600);

    const rows = await summaryRows(page);

    // Six rows, always, whether or not the requirement asked for them — a check
    // nobody asked for still reports what the file holds. Asserted first,
    // because every comparison below is satisfied by an empty list.
    expect(rows.map((row) => row.label)).toEqual([
        'Dimensions',
        'Format',
        'Maximum file size',
        'Minimum file size',
        'Resolution',
        'Transparency',
    ]);

    // bytesToKb: whole kilobytes, rounded, never below 1.
    const kilobytes = Math.max(1, Math.round(out.bytes / KB));

    expect(rowNamed(rows, 'Dimensions').required).toBe('600 × 600 px');
    expect(rowNamed(rows, 'Dimensions').actual).toBe(`${out.width} × ${out.height} px`);
    expect(rowNamed(rows, 'Format').actual).toBe('JPEG');
    expect(rowNamed(rows, 'Maximum file size').required).toBe('100 KB or less');
    expect(rowNamed(rows, 'Maximum file size').actual).toBe(`${kilobytes} KB`);

    expect(rowNamed(rows, 'Dimensions').status).toBe('Meets');
    expect(rowNamed(rows, 'Format').status).toBe('Meets');
    expect(rowNamed(rows, 'Maximum file size').status).toBe('Meets');
    // A row nobody asked for says so in words rather than leaving a gap that
    // reads as an oversight.
    expect(rowNamed(rows, 'Minimum file size').required).toBe('Not required');
    expect(rowNamed(rows, 'Resolution').required).toBe('Not required');
});

/* ------------------------------------------------------------------ *
 * 3 · A requirement no encoder can meet
 * ------------------------------------------------------------------ */

test('an unreachable 10 KB ceiling is refused in words, with no file offered and no pixels spent', async ({ tool, page }) => {
    test.setTimeout(SLOW_TEST);

    await tool.open(ROUTE, { h1: H1 });
    await requirement(page, { width: 800, height: 800, format: 'JPEG', maxKb: 10 })();
    await tool.pick(SAMPLE);

    await page.getByRole('button', { name: 'Fit image' }).click();

    // A refusal is the end of the story: there is no server to post the job to,
    // so it has to arrive as a sentence somebody can act on.
    await expect(page.getByText(NO_JPEG_UNDER_10KB)).toBeVisible({ timeout: SLOW });

    // The half of the refusal that says what was NOT traded away. A search
    // allowed to spend pixels would have met 10 KB by handing back a smaller
    // picture, and this sentence is the product promising it did not.
    await expect(page.getByText('The dimensions were kept as you asked.')).toBeVisible();

    // Nothing may be downloadable. A panel offering a file after a refusal is
    // offering the previous file, or none.
    await expect(page.getByRole('button', { name: 'Download image' })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'All requirements met' })).toHaveCount(0);

    // The refusal takes focus, because a message nobody is moved to is a
    // message a keyboard or screen-reader visitor never learns about.
    const recovery = page.locator('#fit-recovery');
    await expect(recovery).toBeVisible();
    await expect(recovery).toBeFocused();

    // The ways out this format actually has. WebP is offered because the
    // request was JPEG; a request already in WebP is not told to choose it.
    await expect(page.getByRole('button', { name: 'Allow lower quality' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Switch to WebP' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Change the limit' })).toBeVisible();

    // And the request itself is untouched: a refusal does not quietly rewrite
    // the numbers that caused it.
    await expect(page.getByLabel('Width', { exact: true })).toHaveValue('600');
    await expect(page.getByLabel('Height', { exact: true })).toHaveValue('600');
});

/* ------------------------------------------------------------------ *
 * 4 · A size in millimetres, which is only a pixel count after a DPI
 * ------------------------------------------------------------------ */

test('35 × 45 mm at 300 DPI becomes 413×531 pixels with the density written into the file', async ({ tool, page }) => {
    test.setTimeout(SLOW_TEST);

    const saved = await tool.process({
        route: ROUTE,
        h1: H1,
        file: await portrait(),
        // Nothing here types a pixel count: the pixel count is the conversion's
        // output, and typing it would test this test rather than the page.
        before: requirement(page, { width: 35, height: 45, unit: 'mm', dpi: 300, format: 'JPEG' }),
        button: 'Fit image',
        download: 'Download image',
        timeout: SLOW,
    });

    const out = await inspect(saved.file);
    expect(out.format).toBe('jpeg');
    // 35 / 25.4 × 300 = 413.4 and 45 / 25.4 × 300 = 531.5. Both round.
    expect(out.width).toBe(413);
    expect(out.height).toBe(531);
    // The DPI record is the whole reason a physical unit exists here: 413
    // pixels means nothing to a printer without the number that makes it 35 mm.
    expect(out.density).toBe(300);

    const rows = await summaryRows(page);
    expect(rowNamed(rows, 'Dimensions').actual).toBe('413 × 531 px');
    expect(rowNamed(rows, 'Resolution').required).toBe('300 DPI');
    expect(rowNamed(rows, 'Resolution').actual).toBe(`${out.density} DPI`);
    expect(rowNamed(rows, 'Resolution').status).toBe('Meets');
});

/* ------------------------------------------------------------------ *
 * 5 · A transparent source, a JPEG target, and a colour somebody chose
 * ------------------------------------------------------------------ */

test('a transparent PNG becomes a 300×300 JPEG filled with the chosen colour and no alpha channel', async ({ tool, page }) => {
    test.setTimeout(SLOW_TEST);

    const saved = await tool.process({
        route: ROUTE,
        h1: H1,
        file: await transparentPng(),
        before: requirement(page, {
            width: 300,
            height: 300,
            format: 'JPEG',
            background: CUSTOM_BACKGROUND,
        }),
        button: 'Fit image',
        download: 'Download image',
        timeout: SLOW,
    });

    const out = await inspect(saved.file);
    expect(out.format).toBe('jpeg');
    expect(out.width).toBe(300);
    expect(out.height).toBe(300);
    // A JPEG cannot carry transparency, so the question is never whether the
    // alpha survived — it is what took its place.
    expect(out.hasAlpha).toBe(false);

    const corner = await cornerPixel(saved.file);

    // The fixture's rounded rectangle is inset, so this pixel is clear over
    // NOTHING in the source: whatever colour it holds now was put there by the
    // flatten. Measured through libvips on the same pipeline, a flat field of
    // one colour survives a JPEG round trip exactly — the corner reads
    // rgb(47,111,237) to the last level — so 10 is roughly ten times the
    // codec's own drift here and a twentieth of the distance to white or black,
    // which are the two colours a flatten that ignored the picker would use.
    for (const channel of ['r', 'g', 'b']) {
        expect(
            Math.abs(corner[channel] - CUSTOM_RGB[channel]),
            `the ${channel} channel of the corner is ${corner[channel]}, not ${CUSTOM_RGB[channel]} — `
            + 'the custom colour was not the fill',
        ).toBeLessThanOrEqual(10);
    }
    expect(corner.a).toBe(255);

    const rows = await summaryRows(page);
    expect(rowNamed(rows, 'Transparency').required).toBe('Removed');
    expect(rowNamed(rows, 'Transparency').actual).toBe('No alpha channel');
    expect(rowNamed(rows, 'Transparency').status).toBe('Meets');
});

/* ------------------------------------------------------------------ *
 * 6 · WebP: a real quality search, and a DPI that cannot be written
 * ------------------------------------------------------------------ */

test('a WebP requirement runs a real quality search and says up front that no DPI will be written', async ({ tool, page }) => {
    test.setTimeout(SLOW_TEST);

    await tool.open(ROUTE, { h1: H1 });

    // 20 KB is a ceiling with a search behind it, measured through libvips at
    // 600×600 on this sample: 7.7 KB at quality 50 — the floor the fit op stops
    // at — and 32.5 KB at quality 100. So the ceiling is reachable without
    // lifting the floor and unreachable without searching, which is the only
    // shape in which "it landed under the ceiling" says anything at all.
    await requirement(page, { width: 600, height: 600, format: 'WebP', maxKb: 20, dpi: 300 })();

    // The note is a promise made BEFORE the work, not an apology after it: a
    // WebP container has no density field, so a visitor who needs 300 DPI has
    // to learn that here rather than from a file that quietly lacks it.
    await expect(page.getByText(
        'WebP carries no print-resolution record, so no DPI is written into a WebP file.',
    )).toBeVisible();

    await tool.pick(SAMPLE);
    await tool.run('Fit image', { download: 'Download image', timeout: SLOW });
    const saved = await tool.download('Download image');

    const out = await inspect(saved.file);
    // A `.webp` name on a file that is not one is the failure this catches: it
    // downloads, it looks like a success, and it opens in nothing.
    expect(out.format).toBe('webp');
    expect(out.width).toBe(600);
    expect(out.height).toBe(600);
    expect(out.bytes).toBeLessThanOrEqual(20 * KB);
    expect(saved.filename).toMatch(/^resizo-[\w-]+\.webp$/);

    const rows = await summaryRows(page);
    expect(rowNamed(rows, 'Format').actual).toBe('WebP');
    expect(rowNamed(rows, 'Maximum file size').required).toBe('20 KB or less');
    expect(rowNamed(rows, 'Maximum file size').status).toBe('Meets');
    // The DPI was dropped rather than failed. A "Fails" here would be the page
    // blaming the visitor for a limit of the container it was asked to write.
    expect(rowNamed(rows, 'Resolution').required).toBe('Not required');
});

/* ------------------------------------------------------------------ *
 * 7 · The whole workflow at a phone width, in the project that runs
 *     everything
 * ------------------------------------------------------------------ */

/**
 * tests/e2e/browser/mobile.spec.js runs one small fit on the Pixel 7 and
 * iPhone 14 profiles; this holds the layout rule at 390px in chromium-full,
 * where the whole flow suite already runs. A rule that only holds on a phone
 * profile is a rule the desktop build can quietly break.
 */
test.describe('on a 390 px screen', () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test('the fields, the frame and the summary all fit a phone, and the file still lands exactly', async ({ tool, page }) => {
        test.setTimeout(SLOW_TEST);

        await tool.open(ROUTE, { h1: H1 });

        // A phone has no horizontal scrollbar to warn you: an element wider
        // than the screen just cuts the page off at the right edge.
        const empty = await metrics(page);
        expect(empty.scrollWidth, 'the page is wider than the screen before anything is typed')
            .toBeLessThanOrEqual(empty.innerWidth);

        // The advanced half is the widest thing on this page — two number
        // fields, a select, three radio rows and a colour swatch — so it is
        // measured open rather than shut.
        await requirement(page, { width: 600, height: 600, format: 'JPEG', maxKb: 100, geometry: 'Crop to fill' })();

        const configured = await metrics(page);
        expect(configured.scrollWidth, 'the advanced fields push the page wider than the screen')
            .toBeLessThanOrEqual(configured.innerWidth);

        await tool.pick(SAMPLE);

        // The frame is a fixed-aspect box on a 390px screen, which makes it the
        // element most likely to widen the document.
        await expect(page.locator('#fit-frame')).toBeVisible();
        const framed = await metrics(page);
        expect(framed.scrollWidth, 'the crop frame is wider than the screen')
            .toBeLessThanOrEqual(framed.innerWidth);

        await tool.run('Fit image', { download: 'Download image', timeout: SLOW });
        const saved = await tool.download('Download image');

        const out = await inspect(saved.file);
        expect(out.format).toBe('jpeg');
        expect(out.width).toBe(600);
        expect(out.height).toBe(600);
        expect(out.bytes).toBeLessThanOrEqual(100 * KB);

        // The summary is a three-column comparison, and three columns is
        // exactly the shape that overflows a 390px screen if it stays a table.
        const rows = await summaryRows(page);
        expect(rows.length, 'the summary reported nothing to measure').toBeGreaterThan(0);

        const withResult = await metrics(page);
        expect(withResult.scrollWidth, 'the result and its summary push the page wider than the screen')
            .toBeLessThanOrEqual(withResult.innerWidth);
    });
});
