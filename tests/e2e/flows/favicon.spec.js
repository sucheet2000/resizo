const fs = require('node:fs');
const path = require('node:path');

const sharp = require('sharp');

const { test, expect } = require('../fixtures/resizo');
const { logoMark, lowResLogo, panorama } = require('../fixtures/files');
const { inspect, transparentShare } = require('../helpers/output');
const { readZip } = require('../helpers/zip');
const { assertPngIco } = require('../../helpers/ico');

/**
 * /favicon-generator, driven the way somebody with a logo and a website drives
 * it: hand over a mark, choose whether to crop it or pad it, choose what sits
 * behind it, and get back the seven files a site root is supposed to hold.
 *
 * WHAT THIS TOOL CAN GET WRONG THAT NO OTHER TOOL ON THIS SITE CAN. Everywhere
 * else a run produces one file, and a flow that reopens that file has checked
 * everything there is to check. Here a run produces a PACKAGE, and the
 * interesting failures are failures of AGREEMENT between its parts:
 *
 *   1. A container that opens in nothing. favicon.ico is not an image format —
 *      it is a directory of offsets with images behind them, and an offset
 *      counted from the first entry instead of from the file produces a file
 *      that downloads, weighs the right amount and renders as a broken square
 *      in the one place everybody sees it. So the ICO here is taken apart by
 *      ../../helpers/ico.js, which is written from Microsoft's own structure
 *      and never imports the engine's reader, AND then handed to the browser
 *      as an <img>: the parser proves the bytes are laid out correctly, and
 *      the decode proves this browser will actually draw them.
 *   2. A manifest naming a file nobody generated. `site.webmanifest` refers to
 *      the 192 and the 512 BY PATH, so a renamed output leaves a manifest that
 *      is valid JSON, passes every schema and 404s on the day somebody installs
 *      the site. The manifest here is parsed and every src looked up in the
 *      package that was actually downloaded.
 *   3. A snippet pointing at the same hole. Four <link> hrefs, same argument.
 *   4. A ZIP missing an entry or holding one twice. The archive is the whole
 *      deliverable and nothing on the page describes what is in it — the list
 *      above it is the panel talking about itself. So it is opened with the
 *      same reader the bulk flows use and its entries are read in order.
 *   5. A transparent mark quietly flattened, or a chosen colour quietly
 *      ignored. Both look like success in a preview and are measured here at
 *      the corner pixel of the downloaded PNGs, where the source is clear over
 *      NOTHING by construction (../fixtures/files.js logoMark).
 *   6. A square that is not square, or a fit that stretched instead of padding.
 *
 * NOTHING HERE BELIEVES THE PANEL. Every downloaded raster is reopened with
 * sharp — the repo's independent libvips reference (CLAUDE.md > Gotchas) — and
 * asked what it is. The "Verified" mark the page prints beside each file is
 * asserted as a sentence the page said, never as evidence about the bytes.
 *
 * The no-upload guard and the browser-error guard run automatically for every
 * test below (../fixtures/resizo.js), so each flow re-proves from the request
 * log that the logo never left the device.
 */

const ROUTE = '/favicon-generator';
const H1 = 'Generate Favicons and App Icons';

/**
 * The package, in the order `ICON_ASSETS` states it — which is the package
 * order, the ZIP order and the order of the list on the page.
 *
 * Written out here rather than imported from `lib/format/icon-package.js`,
 * because this is the contract the SITE makes rather than a value the code
 * happens to hold: a renamed output should fail here and make somebody decide,
 * not quietly re-point every assertion at the new name.
 * `tests/lib/image-client/icons.properties.test.js` pins these same seven names
 * to the registry from the other side.
 */
const PACKAGE = [
    'favicon.ico',
    'favicon-16x16.png',
    'favicon-32x32.png',
    'apple-touch-icon.png',
    'android-chrome-192x192.png',
    'android-chrome-512x512.png',
    'site.webmanifest',
];

/** The six rasters and the exact square each one has to be. */
const RASTERS = {
    'favicon-16x16.png': 16,
    'favicon-32x32.png': 32,
    'apple-touch-icon.png': 180,
    'android-chrome-192x192.png': 192,
    'android-chrome-512x512.png': 512,
};

/** The three sizes inside favicon.ico. The 48 exists nowhere else. */
const ICO_SIZES = [16, 32, 48];

const ZIP_NAME = 'resizo-favicon-package.zip';

/** The page's own "no logo to hand?" file — the one the benchmark feeds it too. */
const SAMPLE = path.join(__dirname, '..', '..', '..', 'public', 'samples', 'logo-mark-640x400.png');

/** Six PNG encodes behind a codec the browser fetches on first use. */
const SLOW = 90_000;
const SLOW_TEST = 180_000;

const CUSTOM_BACKGROUND = '#2f6fed';
const CUSTOM_RGB = { r: 0x2f, g: 0x6f, b: 0xed };

/* ------------------------------------------------------------------ *
 * Driving the page
 * ------------------------------------------------------------------ */

/** The sample the page fetches for itself, with the guard flagged by hand. */
async function pickSample(tool, page) {
    tool.network.processed = true;
    await page.getByRole('button', { name: 'Try the sample logo' }).click();
}

/** Presses Generate and waits for the result section to arrive. */
async function generate(tool, page, { timeout = SLOW } = {}) {
    tool.network.processed = true;
    await page.getByRole('button', { name: 'Generate icons' }).click();
    await expect(page.getByRole('heading', { name: 'Icons ready' })).toBeVisible({ timeout });
}

/** Presses a download affordance and hands back the file the browser saved. */
async function save(page, locator) {
    const [download] = await Promise.all([page.waitForEvent('download'), locator.click()]);
    const file = await download.path();
    expect(file, 'the download produced no file').toBeTruthy();
    return { file, filename: download.suggestedFilename(), bytes: fs.statSync(file).size };
}

/**
 * The optional manifest fields, opened once and only if they are shut.
 *
 * Pressed blindly a disclosure is a toggle, and a flow that opened it twice
 * would close it and then fill fields nobody can see. The control states its
 * own state, so it is read before it is pressed — the same shape
 * ./image-size-fitter.spec.js uses on the advanced panel.
 */
async function openManifestFields(page) {
    const toggle = page.locator('#icon-manifest-fields');
    if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
}

/** One package entry, by the aria-label its Download button carries. */
function downloadOf(page, filename) {
    return page.getByRole('button', { name: `Download ${filename}`, exact: true });
}

/** Saves one named entry out of the result list. */
function saveAsset(page, filename) {
    return save(page, downloadOf(page, filename));
}

/**
 * Hands the file to the browser as a data: URL and asks whether it can draw it.
 *
 * THE ONE QUESTION A PARSER CANNOT ANSWER. `../../helpers/ico.js` proves the
 * container is laid out the way Microsoft's document says; it cannot prove
 * that a browser accepts a PNG inside an ICO, which is a convention rather
 * than anything that 1995 document describes. Only a decode settles that, and
 * only in the browser doing the decoding — which is why this is repeated in
 * ../browser/compat.spec.js for Firefox and WebKit.
 *
 * A data: URL rather than a blob or a fetch: it is the visitor's own bytes
 * handed to their own browser, so the no-upload guard treats it as local, and
 * next.config's CSP allows `img-src data:`.
 */
async function decodesInBrowser(page, file, mime) {
    const base64 = fs.readFileSync(file).toString('base64');

    return page.evaluate(([data, type]) => new Promise((resolve) => {
        const image = new window.Image();
        image.onload = () => resolve({ ok: true, width: image.naturalWidth, height: image.naturalHeight });
        image.onerror = () => resolve({ ok: false, width: 0, height: 0 });
        image.src = `data:${type};base64,${data}`;
    }), [base64, mime]);
}

/** The top-left pixel of a file, as RGBA, from sharp's own raw decode. */
async function cornerPixel(file) {
    const { data } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    return {
        r: data[0], g: data[1], b: data[2], a: data[3],
    };
}

/** Viewport width and the width the document actually wants. */
function metrics(page) {
    return page.evaluate(() => ({
        innerWidth: window.innerWidth,
        scrollWidth: document.scrollingElement.scrollWidth,
    }));
}

/** Every `<li>` of the asset list, as text, in the order the page renders them. */
const assetRows = (page) => page.locator('#icon-assets > li');

/* ------------------------------------------------------------------ *
 * 1 · The default package, every file opened
 * ------------------------------------------------------------------ */

test('the sample logo becomes seven files, each the size it claims, and an ICO this browser can draw', async ({ tool, page }, testInfo) => {
    test.setTimeout(SLOW_TEST);

    await tool.open(ROUTE, { h1: H1 });

    // Nothing to generate yet: the action says so rather than failing on a press.
    await expect(page.getByRole('button', { name: 'Generate icons' })).toBeDisabled();
    await expect(page.getByText('Add a logo to turn this on.')).toBeVisible();

    await pickSample(tool, page);

    // Crop to square is the default, so a square frame appears over the mark,
    // and its own running commentary says which picture is under it: a centred
    // 1:1 cover crop of a 640×400 is the full 400 of its height. Where the crop
    // starts is a rounding choice and is deliberately not asserted.
    await expect(page.locator('#icon-frame')).toBeVisible();
    await expect(page.getByText(/^Keeping 400×400 pixels from/)).toBeVisible();

    // Transparent is the default, and Apple's own guidance argues against it
    // for a home-screen icon — so the page says so where the choice is made
    // rather than in a paragraph further down.
    await expect(page.locator('#icon-apple-note')).toBeVisible();
    await expect(page.locator('#icon-apple-note')).toHaveAttribute('role', 'note');

    await generate(tool, page);

    // The result takes focus: a package that appeared below the fold is a
    // package a keyboard or screen-reader visitor never learns about.
    await expect(page.getByRole('heading', { name: 'Icons ready' })).toBeFocused();
    // And nothing is complaining beside it. A refusal left over from an
    // earlier attempt, rendered next to a result, describes neither.
    await expect(page.locator('#icon-error')).toHaveCount(0);

    // The benchmark reads this attribute to record what a generation cost.
    const generateMs = await page.locator('section[aria-labelledby="icon-result-heading"]')
        .getAttribute('data-generate-ms');
    expect(Number(generateMs), 'the result carries no generation time for the benchmark to read')
        .toBeGreaterThan(0);

    // The list is the package, in the package's order, one row per file.
    const rows = await assetRows(page).allInnerTexts();
    expect(rows).toHaveLength(PACKAGE.length);
    PACKAGE.forEach((filename, index) => {
        expect(rows[index], `row ${index} is not ${filename}`).toContain(filename);
        // The engine reopened each file it wrote and the row says so. This is
        // the page's own word, asserted as such; the bytes are judged below.
        expect(rows[index], `${filename} is not marked verified`).toContain('Verified');
    });

    // What each row says a file IS, which is the part a visitor uses to decide
    // where it goes. The ICO is the only row holding three sizes, and the
    // manifest is the only row that is not a picture at all.
    expect(rows[0]).toContain('ICO: 16, 32, 48');
    expect(rows[2]).toContain('32 × 32');
    expect(rows[2]).toContain('PNG');
    expect(rows[PACKAGE.length - 1]).toContain('Web app manifest');
    expect(rows[PACKAGE.length - 1]).toContain('JSON');

    // The multi-size preview shows the REAL generated files rather than a
    // scaled copy of one of them, and the two smallest are repeated at 4×
    // because a 16 px square on a modern screen is too small to judge.
    await expect(page.locator('#icon-sizes')).toBeVisible();
    for (const size of [16, 32, 192, 512]) {
        await expect(page.getByAltText(`Generated ${size} × ${size} icon`).first()).toBeVisible();
    }
    await expect(page.getByText('enlarged to check').first()).toBeVisible();
    await expect(page.getByText('Very small details may disappear at 16 × 16. Check the favicon preview before downloading.')).toBeVisible();

    // Every preview image actually decoded. A blob URL that was revoked before
    // the browser read it renders as nothing and reports naturalWidth 0.
    const drawn = await page.locator('#icon-sizes img').evaluateAll(
        (images) => images.map((image) => image.naturalWidth),
    );
    expect(drawn.length, 'the size preview rendered no images').toBeGreaterThan(0);
    expect(Math.min(...drawn), 'a preview image never decoded').toBeGreaterThan(0);

    /* ---------------------------------------------------------- rasters */

    for (const [filename, size] of Object.entries(RASTERS)) {
        const saved = await saveAsset(page, filename);
        expect(saved.filename, `${filename} downloaded under another name`).toBe(filename);

        const out = await inspect(saved.file);
        expect(out.format, filename).toBe('png');
        // Exact, not "about": every consumer of these files picks one by its
        // stated size and then draws whatever is inside it.
        expect(out.width, filename).toBe(size);
        expect(out.height, filename).toBe(size);

        // Transparent was never changed, and the mark is inset, so this pixel
        // is clear over NOTHING in the source: an opaque corner here could
        // only be a background the tool added uninvited.
        const pixel = await cornerPixel(saved.file);
        expect(pixel.a, `${filename} corner alpha`).toBe(0);
    }

    /* -------------------------------------------------------------- ICO */

    const ico = await saveAsset(page, 'favicon.ico');
    expect(ico.filename).toBe('favicon.ico');

    // Taken apart by a reader written from Microsoft's structure: three
    // entries at 16, 32 and 48, every payload a PNG whose own IHDR agrees with
    // the directory, every payload inside the file, and none overlapping.
    // Each of those is a throw inside the helper rather than an assertion here.
    const read = assertPngIco(fs.readFileSync(ico.file), { sizes: ICO_SIZES });
    expect(read.header.count).toBe(ICO_SIZES.length);
    expect(read.entries.map((entry) => entry.width)).toEqual(ICO_SIZES);

    for (const entry of read.entries) {
        expect(entry.offset, `entry ${entry.index} starts inside the directory`)
            .toBeGreaterThanOrEqual(6 + 16 * ICO_SIZES.length);
        expect(entry.offset + entry.bytes, `entry ${entry.index} runs past the end`)
            .toBeLessThanOrEqual(read.bytes);

        // And libvips agrees with the directory about the picture behind it.
        const file = testInfo.outputPath(`ico-${entry.width}.png`);
        fs.writeFileSync(file, entry.data);
        const out = await inspect(file);
        expect(out.format).toBe('png');
        expect(out.width).toBe(entry.width);
        expect(out.height).toBe(entry.height);
    }

    // THE HALF A PARSER CANNOT PROVE: this browser will draw it. A PNG inside
    // an ICO is a convention rather than anything the 1995 document describes,
    // and the only honest evidence is a decode in the engine under test.
    const decoded = await decodesInBrowser(page, ico.file, 'image/x-icon');
    expect(decoded.ok, 'the browser refused to decode the generated favicon.ico').toBe(true);
    expect(decoded.width, 'the browser decoded the ICO to nothing').toBeGreaterThanOrEqual(16);
});

/* ------------------------------------------------------------------ *
 * 2 · The archive, the manifest and the snippet — the three things
 *     that describe each other
 * ------------------------------------------------------------------ */

test('the ZIP holds the whole package once each, and the manifest and snippet name only files inside it', async ({ tool, page }) => {
    test.setTimeout(SLOW_TEST);

    await tool.open(ROUTE, { h1: H1 });
    await tool.pick(await logoMark());

    // The optional half, which is the only place a visitor's own words reach a
    // generated file. The page says so where they are typed.
    await openManifestFields(page);
    await expect(page.getByText('Only what you type here goes into site.webmanifest; leave a field empty to leave it out.')).toBeVisible();

    // A name with a quote, a tag and a closing script in it. Not a trick: it is
    // what a real brand name with punctuation does to a document assembled by
    // concatenation, and the manifest is JSON that the page also PRINTS on
    // screen. It has to come back out of JSON.parse as the same string.
    const APP_NAME = 'Acme "Icons" </script> & Co';
    await page.locator('#icon-app-name').fill(APP_NAME);
    await page.locator('#icon-short-name').fill('Acme');
    await page.locator('#icon-theme-color').fill('#101828');

    await generate(tool, page);

    const archive = await save(page, page.getByRole('button', { name: 'Download all as ZIP' }));
    expect(archive.filename).toBe(ZIP_NAME);

    // The archive is built in the tab out of blobs the codecs wrote, and
    // nothing on the page describes what is in it — the list above the button
    // is the panel talking about itself. So it is opened and read in order.
    const entries = await readZip(archive.file);
    expect(entries.map((entry) => entry.name)).toEqual(PACKAGE);
    expect(new Set(entries.map((entry) => entry.name)).size).toBe(PACKAGE.length);
    for (const entry of entries) {
        expect(entry.bytes, `${entry.name} is empty inside the archive`).toBeGreaterThan(0);
    }

    const inZip = new Map(entries.map((entry) => [entry.name, entry.buffer]));
    const names = new Set(entries.map((entry) => entry.name));

    /* --------------------------------------------------------- manifest */

    const manifest = JSON.parse(inZip.get('site.webmanifest').toString('utf8'));

    // The self-check first: a manifest with no icons has no missing ones
    // either, and an assertion that only looked for holes would call that a
    // pass — on a file whose entire purpose is those two icons.
    expect(manifest.icons.length, 'the manifest lists no icons at all').toBeGreaterThanOrEqual(2);
    for (const icon of manifest.icons) {
        expect(names.has(icon.src.replace(/^\//, '')), `the manifest names ${icon.src}, which is not in the package`)
            .toBe(true);
    }
    expect(manifest.icons.map((icon) => icon.src)).toContain('/android-chrome-192x192.png');
    expect(manifest.icons.map((icon) => icon.src)).toContain('/android-chrome-512x512.png');

    // What the visitor typed, unchanged — through JSON, never through HTML
    // escaping, which would turn a legitimate ampersand into "&amp;" in the
    // name a phone shows under the home-screen icon.
    expect(manifest.name).toBe(APP_NAME);
    expect(manifest.short_name).toBe('Acme');
    expect(manifest.theme_color).toBe('#101828');
    // Nothing was typed here, so nothing is written: an empty string in a
    // manifest is a value, and a wrong one.
    expect('background_color' in manifest).toBe(false);

    /* ---------------------------------------------------------- snippet */

    const snippet = await page.locator('#icon-html code').innerText();
    const hrefs = [...snippet.matchAll(/href="([^"]+)"/g)].map((match) => match[1]);

    expect(hrefs.length, 'the snippet has no hrefs — nothing was checked').toBeGreaterThanOrEqual(4);
    for (const href of hrefs) {
        expect(names.has(href.replace(/^\//, '')), `the snippet points at ${href}, which is not in the package`)
            .toBe(true);
    }
    expect(hrefs).toContain('/site.webmanifest');
    await expect(page.getByText('Example HTML for these generated files.')).toBeVisible();

    // The two <pre> blocks are what a visitor copies, so they have to be the
    // files themselves rather than a second rendering of the same idea.
    const printed = await page.locator('#icon-manifest code').innerText();
    expect(JSON.parse(printed)).toEqual(manifest);

    /* ------------------------------------------------------------- copy */

    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.getByRole('button', { name: 'Copy HTML' }).click();

    // ONE live region for both buttons, so a screen reader hears "Copied" once
    // rather than hunting for which of two regions spoke. Counted as regions
    // rather than as occurrences of the word: the button that was pressed also
    // says "Copied" for a moment, and that is feedback for the eye.
    await expect(page.getByRole('status').filter({ hasText: 'Copied' })).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Copy manifest' })).toBeVisible();
});

/* ------------------------------------------------------------------ *
 * 3 · A background somebody chose
 * ------------------------------------------------------------------ */

test('a custom colour fills every icon and the ICO with it, and leaves nothing see-through', async ({ tool, page }) => {
    test.setTimeout(SLOW_TEST);

    await tool.open(ROUTE, { h1: H1 });
    await tool.pick(await logoMark());

    // Apple's guidance is the reason this control exists, so the note that
    // argues for a background has to stop arguing once there is one.
    await expect(page.locator('#icon-apple-note')).toBeVisible();

    await page.getByRole('radio', { name: 'Custom', exact: true }).check();
    await page.locator('#icon-background-custom').fill(CUSTOM_BACKGROUND);
    await expect(page.locator('#icon-apple-note')).toBeHidden();

    await generate(tool, page);

    for (const [filename, size] of Object.entries(RASTERS)) {
        const saved = await saveAsset(page, filename);
        const out = await inspect(saved.file);
        expect(out.width, filename).toBe(size);
        expect(out.height, filename).toBe(size);

        const pixel = await cornerPixel(saved.file);
        // Nothing may be left see-through: a "solid" icon with a transparent
        // corner is drawn over a white circle on Android and over black in a
        // dark tab bar, which is the failure this control exists to prevent.
        expect(pixel.a, `${filename} corner alpha`).toBe(255);

        // The fixture's mark is inset, so this pixel is clear over NOTHING in
        // the source: whatever colour it holds was put there by the fill, and
        // PNG is lossless, so the match is exact rather than approximate.
        for (const channel of ['r', 'g', 'b']) {
            expect(
                Math.abs(pixel[channel] - CUSTOM_RGB[channel]),
                `${filename}: the ${channel} of the corner is ${pixel[channel]}, not ${CUSTOM_RGB[channel]} — `
                + 'the chosen colour was not the fill',
            ).toBeLessThanOrEqual(2);
        }
    }

    // The container carries the same decision. Three transparent icons inside
    // a file sitting beside five opaque ones is the mismatch nobody looks for.
    const ico = await saveAsset(page, 'favicon.ico');
    const read = assertPngIco(fs.readFileSync(ico.file), { sizes: ICO_SIZES });

    for (const entry of read.entries) {
        const { data } = await sharp(entry.data).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
        expect(data[3], `favicon.ico's ${entry.width} is still transparent`).toBe(255);
        expect(Math.abs(data[0] - CUSTOM_RGB.r), `favicon.ico's ${entry.width} corner`).toBeLessThanOrEqual(2);
    }
});

/* ------------------------------------------------------------------ *
 * 4 · A logo that is smaller than the icons it has to become
 * ------------------------------------------------------------------ */

test('a 128 px logo is told it will be enlarged, in its own numbers, and still lands a real 512', async ({ tool, page }) => {
    test.setTimeout(SLOW_TEST);

    await tool.open(ROUTE, { h1: H1 });
    await tool.pick(await lowResLogo());

    // BEFORE the work, not after it. A visitor whose mark is too small for a
    // 512 needs to know while they can still go and find a bigger file.
    const note = page.locator('#icon-enlargement');
    await expect(note).toBeVisible();
    await expect(note).toHaveText(
        'Your source is 128 × 128 and will be enlarged for the 512 × 512 icon. '
        + 'Enlargement increases dimensions but cannot restore missing detail.',
    );

    await generate(tool, page);

    // Enlargement is a warning, not a refusal: the form still gets its 512.
    const saved = await saveAsset(page, 'android-chrome-512x512.png');
    const out = await inspect(saved.file);
    expect(out.format).toBe('png');
    expect(out.width).toBe(512);
    expect(out.height).toBe(512);

    // And the 16, which is the one size a 128 px source is comfortably big
    // enough for — so the warning is about the 512 and says so.
    const small = await inspect((await saveAsset(page, 'favicon-16x16.png')).file);
    expect(small.width).toBe(16);
});

/* ------------------------------------------------------------------ *
 * 5 · A picture no square can hold: the frame, and the other geometry
 * ------------------------------------------------------------------ */

test('a 1600×300 panorama is cropped where the frame is put, and padded rather than squashed when fitted inside', async ({ tool, page }) => {
    test.setTimeout(SLOW_TEST);

    await tool.open(ROUTE, { h1: H1 });
    await tool.pick(await panorama());

    // Better than five to one, so the page says plainly that the two
    // geometries will give very different pictures.
    await expect(page.getByText(
        'This image is far from square. Crop to square keeps the part inside the frame; '
        + 'Fit inside square keeps all of it and pads the rest.',
    )).toBeVisible();

    const frame = page.locator('#icon-frame');
    await expect(frame).toBeVisible();
    // A centred 1:1 cover crop of a 1600×300 is the full 300 of its height.
    await expect(page.getByText(/^Keeping 300×300 pixels from/)).toBeVisible();

    await generate(tool, page);
    const centred = await saveAsset(page, 'android-chrome-512x512.png');
    const centredOut = await inspect(centred.file);
    expect(centredOut.width).toBe(512);
    expect(centredOut.height).toBe(512);

    /* ------------------------------------------------- the frame moves */

    // The keyboard path, because it is the one a pointer test cannot stand in
    // for: the frame is a focusable group with arrow-key shortcuts, and a
    // visitor who cannot drag has no other way to choose which part of a
    // panorama becomes their icon.
    const position = page.getByText(/^Keeping \d+×\d+ pixels from/);
    const before = await position.textContent();

    await frame.focus();
    for (let press = 0; press < 6; press += 1) {
        await page.keyboard.press('Shift+ArrowLeft');
    }

    // The self-check: without this, a key handler that did nothing would leave
    // every assertion below comparing a file with itself and passing.
    expect(await position.textContent(), 'the frame did not move under the arrow keys').not.toBe(before);

    // A frame that moved after a result invalidates the result: the package on
    // screen describes a crop that is no longer the one selected.
    await expect(page.getByRole('button', { name: 'Download all as ZIP' })).toHaveCount(0);

    await generate(tool, page);
    const moved = await saveAsset(page, 'android-chrome-512x512.png');

    // The bands in this fixture are far apart in colour on purpose, so a frame
    // that really moved lands on a different part of the picture and the two
    // files cannot be the same bytes.
    expect(
        fs.readFileSync(moved.file).equals(fs.readFileSync(centred.file)),
        'the moved frame produced the same 512 as the centred one',
    ).toBe(false);

    /* --------------------------------------------- the other geometry */

    await page.getByRole('radio', { name: 'Fit inside square' }).check();
    // The frame belongs to the crop: fitting inside keeps everything, so there
    // is nothing to position and the control goes away rather than lying.
    await expect(frame).toBeHidden();

    await generate(tool, page);
    const fitted = await saveAsset(page, 'android-chrome-512x512.png');

    const fittedOut = await inspect(fitted.file);
    expect(fittedOut.width).toBe(512);
    expect(fittedOut.height).toBe(512);

    // 1600×300 fitted inside a square is drawn 512×96, so five sixths of the
    // file is padding — and the background is still Transparent, so that
    // padding is clear rather than a colour nobody chose.
    expect(await transparentShare(fitted.file), 'the fit-inside 512 has no padding — the panorama was stretched')
        .toBeGreaterThan(0.5);
    // The cropped one is a slice of an opaque JPEG and has none.
    expect(await transparentShare(moved.file)).toBeLessThan(0.01);

    expect(
        fs.readFileSync(fitted.file).equals(fs.readFileSync(moved.file)),
        'fit-inside produced the same file as crop-to-square',
    ).toBe(false);
});

/* ------------------------------------------------------------------ *
 * 6 · A package that no longer describes the settings on screen
 * ------------------------------------------------------------------ */

test('changing anything after a result takes the stale package away, and Start over puts the cursor back', async ({ tool, page }) => {
    test.setTimeout(SLOW_TEST);

    await tool.open(ROUTE, { h1: H1 });
    // The committed sample, picked off disk rather than through the page's own
    // button: the file scripts/generate-samples.js writes has to be a file this
    // tool accepts, and nothing else in this suite proves that from the outside.
    await tool.pick(SAMPLE);
    await generate(tool, page);

    const zip = page.getByRole('button', { name: 'Download all as ZIP' });
    const heading = page.getByRole('heading', { name: 'Icons ready' });
    await expect(zip).toBeVisible();

    // EVERY control that changes what the package would be has to invalidate
    // the package that is on screen. A visitor who changes the background and
    // then presses Download has every reason to think they are downloading
    // what they are looking at.
    const changes = [
        ['the background', async () => page.getByRole('radio', { name: 'White', exact: true }).check()],
        ['the geometry', async () => page.getByRole('radio', { name: 'Fit inside square' }).check()],
        ['a manifest field', async () => {
            await openManifestFields(page);
            await page.locator('#icon-app-name').fill('Renamed');
        }],
    ];

    for (const [what, change] of changes) {
        await change();
        await expect(zip, `changing ${what} left the old package on screen`).toHaveCount(0);
        await expect(heading, `changing ${what} left the old result heading`).toHaveCount(0);
        await expect(page.getByRole('button', { name: 'Generate icons' })).toBeVisible();

        await generate(tool, page);
        await expect(zip).toBeVisible();
    }

    // Start over is the way back to the beginning, and it has to land the
    // cursor somewhere a keyboard visitor can carry on from.
    await page.getByRole('button', { name: 'Start over' }).click();
    await expect(page.locator('#icon-file-browse')).toBeFocused();
    await expect(zip).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Generate icons' })).toBeDisabled();
});

/* ------------------------------------------------------------------ *
 * 7 · The whole thing on a phone
 * ------------------------------------------------------------------ */

/**
 * ../browser/mobile.spec.js runs one generation on the Pixel 7 and iPhone 14
 * profiles; this holds the layout rule at 390px inside chromium-full, where the
 * whole flow suite already runs. A rule that only holds on a phone profile is a
 * rule the desktop build can quietly break.
 *
 * THE TWO `<pre>` BLOCKS ARE WHY THIS PAGE NEEDS ITS OWN PHONE TEST. An HTML
 * snippet line is about eighty unbreakable characters and a manifest line is
 * an indented JSON path; both are wider than a phone and neither may be
 * allowed to widen the document underneath them. A phone has no horizontal
 * scrollbar to warn anyone that it did.
 */
test.describe('on a 390 px screen', () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test('the controls, the previews and the code blocks stay inside the screen, and the ZIP still saves', async ({ tool, page }) => {
        test.setTimeout(SLOW_TEST);

        await tool.open(ROUTE, { h1: H1 });

        const empty = await metrics(page);
        expect(empty.scrollWidth, 'the page is wider than the screen before anything is chosen')
            .toBeLessThanOrEqual(empty.innerWidth);

        await tool.pick(await logoMark());

        // The crop frame is a fixed-aspect box, which makes it the control most
        // likely to widen a narrow document.
        await expect(page.locator('#icon-frame')).toBeVisible();
        await expect(page.getByText('Preview — how the composition looks; browsers and devices draw their own frames.')).toBeVisible();

        // The mask guide draws a circle and a rounded square over the preview —
        // an overlay is the other thing that escapes its box.
        await page.locator('#icon-guide').check();

        const framed = await metrics(page);
        expect(framed.scrollWidth, 'the frame or the preview guide is wider than the screen')
            .toBeLessThanOrEqual(framed.innerWidth);

        await generate(tool, page);

        // Six preview images at their natural size, the two smallest repeated
        // at 4× — 512 + 192 + 128 + 64 of picture, which only fits a 390 px
        // screen if the row wraps.
        const withResult = await metrics(page);
        expect(withResult.scrollWidth, 'the size preview pushes the page wider than the screen')
            .toBeLessThanOrEqual(withResult.innerWidth);

        for (const id of ['#icon-html', '#icon-manifest']) {
            const block = page.locator(id);
            await expect(block).toBeVisible();

            // The block scrolls INSIDE ITSELF rather than growing the document.
            const overflow = await block.evaluate((element) => getComputedStyle(element).overflowX);
            expect(['auto', 'scroll'], `${id} does not scroll inside itself`).toContain(overflow);

            const box = await block.boundingBox();
            expect(box, `${id} has no box to measure`).not.toBeNull();
            expect(Math.round(box.x + box.width), `${id} runs off the right edge`)
                .toBeLessThanOrEqual(withResult.innerWidth);
        }

        const after = await metrics(page);
        expect(after.scrollWidth, 'the code blocks push the page wider than the screen')
            .toBeLessThanOrEqual(after.innerWidth);

        // And the whole point of the page still works at this width.
        const archive = await save(page, page.getByRole('button', { name: 'Download all as ZIP' }));
        expect(archive.filename).toBe(ZIP_NAME);

        const entries = await readZip(archive.file);
        expect(entries.map((entry) => entry.name)).toEqual(PACKAGE);

        // A filename is the longest unbreakable string on this page, and a row
        // that refused to break it would push the list off the screen.
        const rows = await assetRows(page).count();
        expect(rows).toBe(PACKAGE.length);
    });
});

/* ------------------------------------------------------------------ *
 * A note on what is NOT here
 * ------------------------------------------------------------------ *
 *
 * The ICO's own structure — offsets, overlaps, the IHDR against the directory —
 * is proved in ../../lib/image-client/ico-parser.test.js against bytes built by
 * hand, and the package's properties in
 * ../../lib/image-client/icons.properties.test.js against the op. What is here
 * is what only a browser can answer: that the page produces those files at all,
 * that this engine draws the container, and that nothing left the device.
 */
