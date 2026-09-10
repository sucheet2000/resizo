const fs = require('node:fs');
const path = require('node:path');

const { test, expect } = require('../fixtures/resizo');
const { bulkPhotos, exifGpsJpeg, portrait, transparent } = require('../fixtures/files');
const { inspect, meanAbsoluteDifference, transparentShare } = require('../helpers/output');
const { readZip } = require('../helpers/zip');

/**
 * The compatibility set: one representative job per processing path, run in
 * every browser the site claims to work in.
 *
 * WHY THESE NINE AND NOT THE WHOLE SUITE. Resizo does its image work in the
 * visitor's own browser, so a green Chromium run says nothing about the
 * browser most visitors are holding. What differs between engines is not the
 * page — it is the codec underneath it: canvas encoders, createImageBitmap,
 * OffscreenCanvas, the WebAssembly instantiation path. So the set covers the
 * distinct paths through `lib/image-client/`, not the distinct pages:
 *
 *   decode → resize → encode   a JPEG at a new width          (test 1)
 *   target-byte search         many encodes under a ceiling   (test 2)
 *   an alpha channel           kept across a format change    (test 3)
 *   a lossy re-encode          JPEG in, WebP out              (test 4)
 *   a byte-only rewrite        no pixel decoded at all        (test 5)
 *   a WebAssembly decoder      HEIC, which no browser reads   (test 6)
 *   crop → resize → encode →   the fit op, which is the only  (test 7)
 *   a density rewrite          one that does four in a row
 *   many jobs, then an         the bulk path: a queue, and a  (test 8)
 *   archive built in the tab   ZIP assembled on the device
 *   a queue that changes the   the bulk converter: one encode (test 9)
 *   container on every file    per file, in a format nobody
 *                              chose per file
 *
 * The last two are the only ones whose download is not an image. Every browser
 * has to run the same job several times over without the previous run's memory
 * still held, and then build a container out of the results — so they are also
 * the place where "it worked once" and "it works" are different claims.
 *
 * The ninth is not a spare copy of the eighth. A compressing batch hands every
 * file back in the format it arrived in, so the queue is the only thing under
 * test; a converting batch runs the browser's WebP encoder once per file and
 * writes a container the source never had. An engine whose encoder works on
 * one file and leaks on the third would pass test 8 and fail here.
 *
 * EVERY TEST HERE JUDGES THE FILE, NOT THE PANEL. The result panel and the
 * bytes behind the Download button are exactly the two things that can
 * disagree, so each test reopens the download with sharp — the repo's
 * independent libvips reference (CLAUDE.md > Gotchas). A panel sentence may
 * accompany a byte assertion; it never stands in for one.
 *
 * The no-upload guard and the browser-error guard run automatically for all of
 * these, and a failure carries the browser's own capability report with it.
 * See ../fixtures/resizo.js.
 *
 * TAGS decide which browsers run what: @smoke is Firefox and WebKit, @mobile
 * is the Pixel 7 and iPhone 14 profiles. Only the small jobs carry @mobile —
 * the 96×64 HEIC, the 320×240 WebP, the 800×600 JPEG and the 1.7 MP sample —
 * because a phone profile is where an over-large allocation gets the tab
 * killed, silently, on iOS.
 */
const SAMPLE = path.join(__dirname, '..', '..', '..', 'public', 'samples', 'landscape-1600x1067.jpg');
const ASSETS = path.join(__dirname, '..', 'fixtures', 'assets');
const HEIC = path.join(ASSETS, 'sample-96x64.heic');

/** The PNG the committed HEIC was encoded from — see ../fixtures/assets/README.md. */
const HEIC_SOURCE = path.join(ASSETS, 'sample-96x64.png');

/** A WASM fetch plus a multi-encode search needs more than the 30s default. */
const SLOW = 60_000;
const SLOW_TEST = 120_000;

test('a JPEG resized to 800 px wide comes back a JPEG of the same shape, under a resizo- name', {
    tag: ['@smoke', '@mobile'],
}, async ({ tool }) => {
    const saved = await tool.process({
        route: '/resize',
        h1: 'Resize an Image Online',
        file: SAMPLE,
        after: (page) => page.getByLabel('Width (px)', { exact: true }).fill('800'),
        button: 'Resize image',
        download: 'Download image',
    });

    const out = await inspect(saved.file);
    expect(out.format).toBe('jpeg');
    expect(out.width).toBe(800);
    // 1067 × 800/1600 = 533.5, and which side of it the engine lands on is a
    // rounding choice, not a behaviour. What matters is that the height moved
    // with the width at all: an unlinked ratio would leave 1067 here.
    expect([533, 534]).toContain(out.height);

    // The download is a file the visitor keeps, so its name is part of the
    // product. Every op prefixes its own (lib/image-client/operations.js), and
    // the extension follows the format that was actually written.
    expect(saved.filename).toMatch(/^resizo-[\w-]+\.jpg$/);
});

test('a target-byte compression lands under the ceiling without touching the pixels', {
    tag: ['@smoke'],
}, async ({ tool }) => {
    test.setTimeout(SLOW_TEST);

    const saved = await tool.process({
        route: '/compress-image-to-100kb',
        h1: 'Compress an Image to 100 KB',
        file: SAMPLE,
        button: 'Compress image',
        download: 'Download compressed image',
        timeout: SLOW,
    });

    const out = await inspect(saved.file);
    expect(out.format).toBe('jpeg');
    expect(out.bytes).toBeLessThanOrEqual(100 * 1024);
    // The 100 KB page opens on the policy that never resamples, so a result
    // that is smaller *because it is smaller* would be the wrong answer here.
    expect(out.width).toBe(1600);
    expect(out.height).toBe(1067);
});

test('a transparent WebP converted to PNG keeps its transparent field', {
    tag: ['@smoke', '@mobile'],
}, async ({ tool }) => {
    const fixture = await transparent();

    const saved = await tool.process({
        route: '/webp-to-png',
        h1: 'Convert WebP to PNG',
        file: fixture,
        button: 'Convert to PNG',
        download: 'Download PNG',
    });

    const out = await inspect(saved.file);
    expect(out.format).toBe('png');
    expect(out.hasAlpha).toBe(true);
    expect(out.width).toBe(320);
    expect(out.height).toBe(240);

    // hasAlpha alone passes on a fully opaque alpha channel, which is exactly
    // what a JPEG round trip or a flatten would leave behind. The fixture is an
    // r=90 disc on 320×240, so the disc covers ~33% and the transparent field
    // is the other ~67%.
    expect(await transparentShare(saved.file)).toBeGreaterThan(0.5);
});

test('a JPEG converted to WebP keeps every pixel dimension it arrived with', {
    tag: ['@smoke'],
}, async ({ tool }) => {
    test.setTimeout(SLOW_TEST);

    const saved = await tool.process({
        route: '/jpg-to-webp',
        h1: 'Convert JPG to WebP',
        file: SAMPLE,
        button: 'Convert to WebP',
        download: 'Download WebP',
        timeout: SLOW,
    });

    const out = await inspect(saved.file);
    expect(out.format).toBe('webp');
    // The page promises a lighter file at the same size. The size is the half
    // this test can state as a fact; the weight depends on the encoder build.
    expect(out.width).toBe(1600);
    expect(out.height).toBe(1067);
});

test('stripping metadata rewrites the bytes around a JPEG and leaves the picture alone', {
    tag: ['@smoke', '@mobile'],
}, async ({ tool }) => {
    const fixture = await exifGpsJpeg();
    const sourceBytes = fs.statSync(fixture).size;

    const saved = await tool.process({
        route: '/remove-image-metadata',
        h1: 'Remove Image Metadata',
        file: fixture,
        button: 'Remove metadata',
        download: 'Download clean image',
    });

    const out = await inspect(saved.file);
    expect(out.format).toBe('jpeg');
    // The camera block and the GPS IFD the fixture carries: gone.
    expect(out.hasExif).toBe(false);
    // No pixel is decoded on this path, so the picture has to come through
    // untouched — a resample here would mean the byte-only op is not byte-only.
    expect(out.width).toBe(800);
    expect(out.height).toBe(600);
    expect(out.bytes).toBeLessThan(sourceBytes);
});

test('a HEIC photo decodes to a JPG that still shows the picture it came from', {
    tag: ['@smoke', '@mobile'],
}, async ({ tool }) => {
    test.setTimeout(SLOW_TEST);

    const saved = await tool.process({
        route: '/heic',
        h1: 'Convert HEIC to JPG',
        file: HEIC,
        button: 'Convert to JPG',
        download: 'Download JPG',
        timeout: SLOW,
    });

    const out = await inspect(saved.file);
    expect(out.format).toBe('jpeg');
    expect(out.width).toBe(96);
    expect(out.height).toBe(64);

    // No encoder in this repo writes HEVC, so the HEIC cannot be re-read here
    // (../fixtures/assets/README.md). The path is proved from the other side:
    // the JPG is compared against the PNG the HEIC was made from. A decoder
    // that returned a blank canvas, a wrongly-ordered plane or the wrong
    // subsampling moves this number into the dozens. Measured here: 2.2395 in
    // Chromium, Firefox and WebKit alike — the decoder is one WebAssembly
    // build, so the three engines agree to the last digit. 12 is the ceiling,
    // five times the measurement, so a codec rebuild moves it without lying.
    const difference = await meanAbsoluteDifference(saved.file, HEIC_SOURCE, { width: 96, height: 64 });
    expect(difference).toBeLessThan(12);
});

test('a passport photo comes back at the exact pixels and the exact DPI the preset states', {
    tag: ['@smoke'],
}, async ({ tool, page }) => {
    test.setTimeout(SLOW_TEST);

    // The seventh path, and the only one that chains four stages: crop the
    // source to the frame, resample to an exact box, encode, then rewrite the
    // container's density record. Every earlier test here does one or two of
    // those; a browser that got the last stage wrong would still pass all six.
    const saved = await tool.process({
        route: '/passport-photo',
        h1: 'Make a Passport or ID Photo to Exact Size',
        file: await portrait(),
        // 2 inches at 300 DPI. The chip carries the arithmetic, so nothing
        // here types a pixel count that the page would then have to agree with.
        before: () => page.getByRole('button', { name: 'United States Printed' }).click(),
        button: 'Make photo',
        download: 'Download photo',
        timeout: SLOW,
    });

    const out = await inspect(saved.file);
    expect(out.format).toBe('jpeg');
    // Exact, not "at most". A passport form that says 600×600 rejects 600×599,
    // and a browser that rounded the resample differently would land there.
    expect(out.width).toBe(600);
    expect(out.height).toBe(600);

    // The density record is written by walking the JPEG's own segments rather
    // than by any codec, so this is the assertion that says the byte-level
    // rewrite survived whichever encoder this browser used underneath it.
    expect(out.density).toBe(300);
});

test('a batch of three photos comes back as one archive, every file under the ceiling', {
    tag: ['@smoke'],
}, async ({ tool, page }, testInfo) => {
    // Three target searches in a row, each up to eight full encodes of a 1.7 MP
    // frame, on an engine that fetches and instantiates the codec first — and
    // in `npm run e2e` all five projects share one machine. This is the longest
    // job in the compatibility set by a wide margin, and it is budgeted for.
    test.setTimeout(240_000);

    const photos = await bulkPhotos();

    await tool.open('/bulk-image-compressor', { h1: 'Compress Many Images to a Maximum File Size' });

    // Substring names, like every other control matched in this suite: a chip
    // may render a detail beside its label and a radio may carry its hint.
    const preserve = page.getByRole('radio', { name: 'Preserve dimensions' });
    await preserve.check();

    // The ceiling chip is confirmed rather than pressed: PresetChips reads a
    // press on the ALREADY-ACTIVE chip as "unselect", and 200 KB is the page's
    // default (components/tools/PresetChips.js).
    const ceiling = page.getByRole('button', { name: '200 KB' });
    if ((await ceiling.getAttribute('aria-pressed')) !== 'true') await ceiling.click();
    await expect(ceiling).toHaveAttribute('aria-pressed', 'true');

    // Several files through the one input, and the network guard flagged the
    // way tool.pick flags it — otherwise the no-upload proof would be vacuous
    // on the page that moves the most bytes.
    tool.network.processed = true;
    await page.locator('input[type="file"]').first().setInputFiles(photos);

    const compress = page.getByRole('button', { name: 'Compress 3 images' });
    await expect(compress).toBeEnabled({ timeout: 20_000 });
    await compress.click();

    const zipButton = page.getByRole('button', { name: /Download all as ZIP \(3\)/ });
    await expect(zipButton).toBeVisible({ timeout: 180_000 });

    const [download] = await Promise.all([page.waitForEvent('download'), zipButton.click()]);
    const archive = await download.path();
    expect(archive, 'the ZIP button produced no file').toBeTruthy();
    expect(download.suggestedFilename()).toBe('resizo-compressed-images.zip');

    // The archive is built in the tab, by jszip, out of blobs the codecs wrote
    // — three steps that can each go wrong differently per engine. So the file
    // is opened rather than counted: entries, order, names, and the bytes of
    // each one read back by libvips.
    const entries = await readZip(archive);
    expect(entries.map((entry) => entry.name)).toEqual([
        'bulk-photo-1-compressed.jpg',
        'bulk-photo-2-compressed.jpg',
        'bulk-photo-3-compressed.jpg',
    ]);

    for (const entry of entries) {
        const file = testInfo.outputPath(entry.name);
        fs.writeFileSync(file, entry.buffer);

        const out = await inspect(file);
        expect(out.format, `${entry.name} is not a JPEG`).toBe('jpeg');
        // Preserve dimensions: under the ceiling AND at full size, which is the
        // pair a browser that fell back to resampling would break.
        expect(out.width).toBe(1600);
        expect(out.height).toBe(1067);
        expect(out.bytes, `${entry.name} is over the 200 KB ceiling`).toBeLessThanOrEqual(200 * 1024);
    }
});

test('a batch of three photos converted to WebP comes back as three real WebP files in one archive', {
    tag: ['@smoke'],
}, async ({ tool, page }, testInfo) => {
    // Three full-frame WebP encodes, on an engine that fetches and
    // instantiates the codec first, and in `npm run e2e` all five projects
    // share one machine. Cheaper than the target searches in the test above —
    // one encode per file rather than up to eight — and budgeted the same way.
    test.setTimeout(180_000);

    const photos = await bulkPhotos();

    await tool.open('/bulk-image-converter', { h1: 'Convert Many Images to One Format' });

    // The chip is confirmed rather than pressed: PresetChips reads a press on
    // the ALREADY-ACTIVE chip as "unselect", and WebP is this page's default
    // (components/tools/PresetChips.js). Looked up inside its own group,
    // because "WebP" is also a word this page's prose uses.
    const webp = page.getByRole('group', { name: 'Output format' }).getByRole('button', { name: 'WebP' });
    if ((await webp.getAttribute('aria-pressed')) !== 'true') await webp.click();
    await expect(webp).toHaveAttribute('aria-pressed', 'true');

    // Several files through the one input, and the network guard flagged the
    // way tool.pick flags it — otherwise the no-upload proof would be vacuous
    // on the page that moves the most bytes.
    tool.network.processed = true;
    await page.locator('input[type="file"]').first().setInputFiles(photos);

    const convert = page.getByRole('button', { name: 'Convert 3 images' });
    await expect(convert).toBeEnabled({ timeout: 20_000 });
    await convert.click();

    const zipButton = page.getByRole('button', { name: /Download all as ZIP \(3\)/ });
    await expect(zipButton).toBeVisible({ timeout: 120_000 });

    const [download] = await Promise.all([page.waitForEvent('download'), zipButton.click()]);
    const archive = await download.path();
    expect(archive, 'the ZIP button produced no file').toBeTruthy();
    expect(download.suggestedFilename()).toBe('resizo-converted-images.zip');

    // The archive is built in the tab, by jszip, out of blobs this browser's
    // own WebP encoder wrote — three steps that can each go wrong differently
    // per engine. So the file is opened rather than counted: entries, order,
    // names, and the bytes of each one read back by libvips.
    const entries = await readZip(archive);
    expect(entries.map((entry) => entry.name)).toEqual([
        'bulk-photo-1.webp',
        'bulk-photo-2.webp',
        'bulk-photo-3.webp',
    ]);

    for (const entry of entries) {
        const file = testInfo.outputPath(entry.name);
        fs.writeFileSync(file, entry.buffer);

        const out = await inspect(file);
        // A `.webp` name on a file that is not one is the failure this catches:
        // it downloads, it looks like a success, and it opens in nothing.
        expect(out.format, `${entry.name} is not a WebP`).toBe('webp');
        // Converting is not resizing. Every file keeps the picture it came
        // with, at the size it came at.
        expect(out.width).toBe(1600);
        expect(out.height).toBe(1067);
        expect(out.bytes, `${entry.name} is empty`).toBeGreaterThan(0);
    }
});
