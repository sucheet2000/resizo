const sharp = require('sharp');

const { test, expect } = require('../fixtures/resizo');
const { exifGpsJpeg, portrait } = require('../fixtures/files');
const { inspect, meanAbsoluteDifference } = require('../helpers/output');

/**
 * /passport-photo, driven the way a person with a form in front of them drives
 * it: type the numbers the form states, or press the chip that already knows
 * them, put the face where you want it, and get one file back.
 *
 * WHAT MAKES THIS PAGE DIFFERENT FROM EVERY OTHER TOOL HERE, AND WHAT THAT
 * COSTS THE TESTS.
 *
 * Every other tool satisfies one requirement. This one satisfies several at
 * once — exact pixels AND a format AND a byte ceiling AND a DPI record — and
 * the interesting failures are the ones where hitting the last requirement
 * quietly gives up an earlier one. A byte search that met 40 KB by dropping to
 * 512×512 would look like a success in the panel and be worthless on the form,
 * so no test here checks a ceiling without also re-checking the dimensions in
 * the same breath.
 *
 * AND THE PAGE GRADES ITSELF, WHICH IS EXACTLY WHY IT NEEDS AN OUTSIDE MARKER.
 * The requirement summary is produced by `validateOutput` reading the finished
 * bytes, so it is already a second opinion about the file rather than an echo
 * of the form. It is still the product's own opinion. Every "actual" it prints
 * is therefore checked against sharp — the repo's independent libvips
 * reference (CLAUDE.md > Gotchas) — reading the same download, so a summary
 * that says "600 × 600 px · Meets" over a 512 px file fails here.
 *
 * The no-upload guard and the browser-error guard run automatically for all of
 * these (../fixtures/resizo.js), so every flow below re-proves from the request
 * log that the photo never left the device.
 */

const ROUTE = '/passport-photo';
const H1 = 'Make a Passport or ID Photo to Exact Size';

/** A WASM codec fetch plus a multi-encode byte search wants more than the default. */
const SLOW = 90_000;
const SLOW_TEST = 150_000;

/** The engine writes the refusal with a curly apostrophe, and so does this. */
const NO_JPEG_UNDER_10KB = 'Resizo couldn’t produce a JPEG under 10 KB at 600 × 600 pixels.';

/**
 * Types the two numbers a form states, in the units it states them in.
 *
 * THE UNIT IS ALWAYS SET, never left to whatever it happens to be. A preset
 * chip moves it to `in` or `mm`, and a flow that then typed 600 into Width
 * would be asking for six hundred INCHES — a wrong test that still passes
 * whenever the page happens to open on pixels, and a confusing red the day it
 * does not. Setting it explicitly costs one line and removes the whole class.
 */
function requirement(page, { width, height, unit = 'px', dpi, maxKb }) {
    return async () => {
        await page.getByLabel('Unit', { exact: true }).selectOption(unit);
        await page.getByLabel('Width', { exact: true }).fill(String(width));
        await page.getByLabel('Height', { exact: true }).fill(String(height));
        if (dpi !== undefined) await page.getByLabel(/^DPI/).fill(String(dpi));
        if (maxKb !== undefined) await page.getByLabel('Maximum file size (KB)').fill(String(maxKb));
    };
}

/**
 * The requirement summary, read out of the DOM as a person reads it: the row's
 * name, what was asked for, what the file actually is, and the word — never the
 * colour — that says whether the two agree.
 */
function summaryRows(page) {
    return page.evaluate(() => {
        const heading = [...document.querySelectorAll('h3')]
            .find((element) => (element.textContent || '').startsWith('What was checked'));
        const list = heading?.parentElement?.querySelector('dl');
        if (!list) return [];

        return [...list.querySelectorAll(':scope > div')].map((row) => {
            const cells = [...row.querySelectorAll('dd span')].map((cell) => cell.textContent.trim());
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
 * The average colour of a 20×20 patch at the centre of a file, from sharp's
 * own raw decode.
 *
 * A patch rather than the single middle pixel: the frame is positioned by a
 * pointer drag in CSS pixels, so where it lands is exact to a pixel or two and
 * not to a pixel. Twenty rows of average is still local enough to be "the
 * middle of the picture" and wide enough that a rounding step cannot decide
 * the assertion.
 */
async function centrePatch(file) {
    const { width, height } = await sharp(file).metadata();
    const size = 20;
    const data = await sharp(file)
        .extract({
            left: Math.round(width / 2) - size / 2,
            top: Math.round(height / 2) - size / 2,
            width: size,
            height: size,
        })
        .removeAlpha()
        .raw()
        .toBuffer();

    const totals = [0, 0, 0];
    for (let index = 0; index < data.length; index += 3) {
        totals[0] += data[index];
        totals[1] += data[index + 1];
        totals[2] += data[index + 2];
    }

    const pixels = data.length / 3;
    return totals.map((total) => Math.round(total / pixels));
}

/** The frame's own running commentary — the proof an interaction registered. */
const framePosition = (page) => page.getByText(/^Keeping \d+×\d+ pixels from/);

/* ------------------------------------------------------------------ *
 * 1 · The custom path: two numbers off a form, one exact file back
 * ------------------------------------------------------------------ */

test('a custom 600×600 requirement produces a JPEG that is exactly 600×600', async ({ tool, page }) => {
    test.setTimeout(SLOW_TEST);

    const saved = await tool.process({
        route: ROUTE,
        h1: H1,
        file: await portrait(),
        // Every number a passport form states is knowable before there is a
        // photo, and the page puts the requirement above the drop zone for
        // exactly that reason — a file lands already configured.
        before: requirement(page, { width: 600, height: 600 }),
        button: 'Make photo',
        download: 'Download photo',
        timeout: SLOW,
    });

    const out = await inspect(saved.file);
    expect(out.format).toBe('jpeg');
    // Exact, not "at most": a form that says 600×600 rejects 600×599.
    expect(out.width).toBe(600);
    expect(out.height).toBe(600);

    // The download is a file the visitor keeps, so its name is part of the
    // product: the fit op's own prefix, and an extension that follows the
    // format actually written.
    expect(saved.filename).toMatch(/^resizo-[\w-]+\.jpg$/);
});

/* ------------------------------------------------------------------ *
 * 2 · Pixels and bytes at the same time
 * ------------------------------------------------------------------ */

test('a 40 KB ceiling is met without giving up a single pixel of the size asked for', async ({ tool, page }) => {
    test.setTimeout(SLOW_TEST);

    const saved = await tool.process({
        route: ROUTE,
        h1: H1,
        file: await portrait(),
        before: requirement(page, { width: 600, height: 600, maxKb: 40 }),
        button: 'Make photo',
        download: 'Download photo',
        timeout: SLOW,
    });

    const out = await inspect(saved.file);
    expect(out.bytes).toBeLessThanOrEqual(40 * 1024);
    // The half a byte search can quietly spend to reach a ceiling. /compress
    // is allowed to trade pixels for bytes because its own policy says so;
    // this page never is, and a 40 KB file at 512×512 would pass the line
    // above and fail the form.
    expect(out.width).toBe(600);
    expect(out.height).toBe(600);

    const maximum = rowNamed(await summaryRows(page), 'Maximum file size');
    expect(maximum.required).toBe('40 KB or less');
    expect(maximum.status).toBe('Meets');
});

/* ------------------------------------------------------------------ *
 * 3 · The verified presets, whose pixels are arithmetic rather than copy
 * ------------------------------------------------------------------ */

test('the United States printed preset writes 600×600 at 300 DPI, read back from the file', async ({ tool, page }) => {
    test.setTimeout(SLOW_TEST);

    const saved = await tool.process({
        route: ROUTE,
        h1: H1,
        file: await portrait(),
        // 2 inches at 300 DPI. The chip fills the fields; nothing here types a
        // pixel count, because the pixel count is the conversion's output and
        // typing it would test this test rather than the page.
        before: () => page.getByRole('button', { name: 'United States Printed' }).click(),
        button: 'Make photo',
        download: 'Download photo',
        timeout: SLOW,
    });

    const out = await inspect(saved.file);
    expect(out.format).toBe('jpeg');
    expect(out.width).toBe(600);
    expect(out.height).toBe(600);
    // The DPI record is the whole reason a print preset exists: 600 pixels
    // means nothing to a printer without the number that makes it 2 inches.
    expect(out.density).toBe(300);
});

test('the United Kingdom printed preset writes 413×531 — 35 × 45 mm at 300 DPI', async ({ tool, page }) => {
    test.setTimeout(SLOW_TEST);

    const saved = await tool.process({
        route: ROUTE,
        h1: H1,
        file: await portrait(),
        before: () => page.getByRole('button', { name: 'United Kingdom Printed' }).click(),
        button: 'Make photo',
        download: 'Download photo',
        timeout: SLOW,
    });

    const out = await inspect(saved.file);
    expect(out.format).toBe('jpeg');
    // 35 / 25.4 × 300 = 413.4 and 45 / 25.4 × 300 = 531.5. Both round, and the
    // page shows the arithmetic rather than a number somebody typed.
    expect(out.width).toBe(413);
    expect(out.height).toBe(531);
    expect(out.density).toBe(300);
});

/* ------------------------------------------------------------------ *
 * 4 · The frame: does moving it actually move the picture?
 * ------------------------------------------------------------------ */

test('dragging and zooming the frame changes which part of the photo the file holds', async ({ tool, page }) => {
    test.setTimeout(SLOW_TEST);

    const file = await portrait();

    // Run one: nobody touches the frame. This is the centred cover crop the
    // geometry alone would produce, and it is the control.
    const untouched = await tool.process({
        route: ROUTE,
        h1: H1,
        file,
        before: requirement(page, { width: 600, height: 600 }),
        button: 'Make photo',
        download: 'Download photo',
        timeout: SLOW,
    });

    // Run two: same file, same numbers, a fresh page, so the control run and
    // the moved run share nothing but the fixture. Re-running in place after a
    // result is its own test below.
    await tool.open(ROUTE, { h1: H1 });
    await requirement(page, { width: 600, height: 600 })();
    await tool.pick(file);

    const frame = page.locator('#passport-frame');
    await expect(frame).toBeVisible();
    await frame.scrollIntoViewIfNeeded();

    const before = await framePosition(page).textContent();
    const box = await frame.boundingBox();
    expect(box, 'the frame has no box to drag').not.toBeNull();

    // Dragging moves the PHOTO, not the window: pulling down-right reveals the
    // top-left of the source, which is where the head is.
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.95, box.y + box.height * 0.95, { steps: 12 });
    await page.mouse.up();

    await page.locator('#passport-frame-zoom').fill('2.5');

    // The self-check, and it is not decoration: a drag that silently did
    // nothing would leave both runs identical and make every assertion below
    // pass by describing one picture twice.
    const after = await framePosition(page).textContent();
    expect(after, 'the frame reports the same rectangle after a drag and a zoom').not.toBe(before);

    await tool.run('Make photo', { download: 'Download photo', timeout: SLOW });
    const moved = await tool.download('Download photo');

    const control = await inspect(untouched.file);
    const zoomed = await inspect(moved.file);
    expect(control.width).toBe(600);
    expect(zoomed.width).toBe(600);
    expect(zoomed.height).toBe(600);

    // Two different crops of one picture are two different pictures. Measured
    // on this fixture through libvips: the two framings are 58.98 apart, and a
    // re-encode of ONE of them at a different quality is 0.35 apart — so 8 is
    // seven times the codec's own noise and a seventh of the real signal, and
    // moving either number would not change the verdict. Proved red both ways:
    // with the drag removed this reads 0.00.
    const difference = await meanAbsoluteDifference(untouched.file, moved.file, { width: 600, height: 600 });
    expect(difference, 'the two crops are the same picture — the frame did not move').toBeGreaterThan(8);

    const [controlRed] = await centrePatch(untouched.file);
    const [zoomedRed] = await centrePatch(moved.file);
    expect(Math.abs(zoomedRed - controlRed), 'the middle of the frame holds the same thing in both runs')
        .toBeGreaterThan(60);
});

/* ------------------------------------------------------------------ *
 * 4b · A move after a result is a new job, on the same photo
 * ------------------------------------------------------------------ */

test('moving the frame after a result brings Make photo back, and the next file is the new crop', async ({ tool, page }) => {
    test.setTimeout(SLOW_TEST);

    const first = await tool.process({
        route: ROUTE,
        h1: H1,
        file: await portrait(),
        before: requirement(page, { width: 600, height: 600 }),
        button: 'Make photo',
        download: 'Download photo',
        timeout: SLOW,
    });

    // The result is on screen and the submit control has gone with it.
    await expect(page.getByRole('button', { name: 'Download photo' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Make photo' })).toHaveCount(0);

    const frame = page.locator('#passport-frame');
    await frame.scrollIntoViewIfNeeded();
    const box = await frame.boundingBox();
    expect(box, 'the frame is gone once a result exists').not.toBeNull();

    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.95, box.y + box.height * 0.95, { steps: 12 });
    await page.mouse.up();

    // A move is a new job: the old download may not be handed over as if it
    // were this crop, and the button to run the new one is back.
    await expect(page.getByRole('button', { name: 'Download photo' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Make photo' })).toBeVisible();

    await tool.run('Make photo', { download: 'Download photo', timeout: SLOW });
    const second = await tool.download('Download photo');

    const one = await inspect(first.file);
    const two = await inspect(second.file);
    expect(one.width).toBe(600);
    expect(two.width).toBe(600);
    expect(two.height).toBe(600);

    const [firstRed] = await centrePatch(first.file);
    const [secondRed] = await centrePatch(second.file);
    expect(Math.abs(secondRed - firstRed), 'the second file is the first crop again').toBeGreaterThan(60);
});

/* ------------------------------------------------------------------ *
 * 5 · The summary is about the file, not about the form
 * ------------------------------------------------------------------ */

test('every value the summary reports is what libvips reads out of the same download', async ({ tool, page }) => {
    test.setTimeout(SLOW_TEST);

    const saved = await tool.process({
        route: ROUTE,
        h1: H1,
        file: await portrait(),
        // A requirement that exercises every applicable row at once: exact
        // pixels, a format, a ceiling, and a DPI record.
        before: requirement(page, { width: 600, height: 600, dpi: 300, maxKb: 60 }),
        button: 'Make photo',
        download: 'Download photo',
        timeout: SLOW,
    });

    const rows = await summaryRows(page);

    // Six rows, always, whether or not the requirement asked for them — a
    // check nobody asked for still reports what the file holds. Asserted
    // first, because every comparison below is satisfied by an empty list.
    expect(rows.map((row) => row.label)).toEqual([
        'Dimensions',
        'Format',
        'Maximum file size',
        'Minimum file size',
        'Resolution',
        'Transparency',
    ]);

    const out = await inspect(saved.file);
    // bytesToKb: whole kilobytes, rounded, never below 1.
    const kilobytes = Math.max(1, Math.round(out.bytes / 1024));

    expect(rowNamed(rows, 'Dimensions').actual).toBe(`${out.width} × ${out.height} px`);
    expect(rowNamed(rows, 'Format').actual).toBe('JPEG');
    expect(out.format).toBe('jpeg');
    expect(rowNamed(rows, 'Maximum file size').actual).toBe(`${kilobytes} KB`);
    expect(rowNamed(rows, 'Minimum file size').actual).toBe(`${kilobytes} KB`);
    expect(rowNamed(rows, 'Resolution').actual).toBe(`${out.density} DPI`);
    expect(out.density).toBe(300);
    expect(rowNamed(rows, 'Transparency').actual).toBe(out.hasAlpha ? 'Alpha channel present' : 'No alpha channel');

    // And the verdicts, which are the part a visitor acts on. A row nobody
    // asked for says so in words rather than leaving a gap that reads as an
    // oversight.
    expect(rowNamed(rows, 'Dimensions').status).toBe('Meets');
    expect(rowNamed(rows, 'Format').status).toBe('Meets');
    expect(rowNamed(rows, 'Maximum file size').status).toBe('Meets');
    expect(rowNamed(rows, 'Resolution').status).toBe('Meets');
    expect(rowNamed(rows, 'Minimum file size').status).toBe('Not required');
    expect(rowNamed(rows, 'Minimum file size').required).toBe('Not required');
});

/* ------------------------------------------------------------------ *
 * 6 · A requirement no encoder can meet, and the way back from it
 * ------------------------------------------------------------------ */

test('an unreachable byte ceiling is refused in words, with no file offered, and recovered from', async ({ tool, page }) => {
    test.setTimeout(SLOW_TEST);

    // Gaussian noise is the hardest thing a JPEG encoder can be handed: there
    // is no structure to throw away. Measured through libvips at 600×600, it
    // is ~40 KB at the quality floor of 50 and ~1.4 KB once the floor is
    // lifted, so this requirement is genuinely out of reach and genuinely
    // reachable after the recovery — neither half is a lucky number.
    await tool.open(ROUTE, { h1: H1 });
    await requirement(page, { width: 600, height: 600, maxKb: 10 })();
    await tool.pick(await exifGpsJpeg());

    await page.getByRole('button', { name: 'Make photo' }).click();

    // A refusal is the end of the story: there is no server to post the job
    // to, so it has to arrive as a sentence somebody can act on.
    await expect(page.getByText(NO_JPEG_UNDER_10KB)).toBeVisible({ timeout: SLOW });
    await expect(page.getByText('The dimensions were kept as you asked.')).toBeVisible();

    // And nothing may be downloadable. A panel offering a file after a refusal
    // is offering the previous file, or none.
    await expect(page.getByRole('button', { name: 'Download photo' })).toHaveCount(0);

    // The way out, taken the way a visitor takes it.
    await tool.run('Allow lower quality', { download: 'Download photo', timeout: SLOW });
    const saved = await tool.download('Download photo');

    const out = await inspect(saved.file);
    expect(out.bytes).toBeLessThanOrEqual(10 * 1024);
    // The recovery spends quality, never pixels. A 10 KB file at 300×300 would
    // meet the ceiling and miss the requirement.
    expect(out.width).toBe(600);
    expect(out.height).toBe(600);

    const maximum = rowNamed(await summaryRows(page), 'Maximum file size');
    expect(maximum.required).toBe('10 KB or less');
    expect(maximum.status).toBe('Meets');
});
