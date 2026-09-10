const fs = require('node:fs');
const path = require('node:path');

const { test, expect } = require('../fixtures/resizo');
const { exifGpsJpeg, portrait, transparent } = require('../fixtures/files');
const { inspect, meanAbsoluteDifference, transparentShare } = require('../helpers/output');

/**
 * The compatibility set: one representative job per processing path, run in
 * every browser the site claims to work in.
 *
 * WHY THESE SEVEN AND NOT THE WHOLE SUITE. Resizo does its image work in the
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
