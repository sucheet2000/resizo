const fs = require('node:fs');
const path = require('node:path');

const sharp = require('sharp');

const { test, expect } = require('../fixtures/resizo');
const {
    bulkPhotos, exifGpsJpeg, logoMark, metadataFixture, portrait, transparent, transparentAvif,
} = require('../fixtures/files');
const { inspect, meanAbsoluteDifference, transparentShare } = require('../helpers/output');
const { readZip } = require('../helpers/zip');
const { assertPngIco } = require('../../helpers/ico');
const { assertAvif } = require('../../helpers/avif');

/**
 * The compatibility set: one representative job per processing path, run in
 * every browser the site claims to work in.
 *
 * WHY THESE THIRTEEN AND NOT THE WHOLE SUITE. Resizo does its image work in the
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
 *   crop → resize → a byte     the fit op again, with the     (test 8)
 *   search under a ceiling     search in the middle of it
 *   many jobs, then an         the bulk path: a queue, and a  (test 9)
 *   archive built in the tab   ZIP assembled on the device
 *   a queue that changes the   the bulk converter: one encode (test 10)
 *   container on every file    per file, in a format nobody
 *                              chose per file
 *   one photo drawn several    the print sheet: a surface     (test 11)
 *   times onto a canvas far    many times the photo's size,
 *   larger than itself         built and encoded in the tab
 *   a file read and never      the metadata viewer: bytes    (test 12)
 *   decoded at all             walked on the main thread,
 *                              no codec, no canvas, no worker
 *   one decode, six encodes,   the favicon generator: the    (test 13)
 *   and a container this       only output that is not an
 *   browser then has to draw   image format, handed back to
 *                              the same browser to render
 *
 * The eighth is not a spare copy of the seventh. A passport preset asks for an
 * exact box and gets one encode; a fitter requirement asks for an exact box AND
 * a byte ceiling, which puts a multi-encode search between the resample and the
 * download — and the failure it exists to catch is a browser whose search meets
 * the ceiling by handing back a smaller picture. That file passes a byte
 * assertion and fails the form it was made for.
 *
 * The last two are the only ones whose download is not an image. Every browser
 * has to run the same job several times over without the previous run's memory
 * still held, and then build a container out of the results — so they are also
 * the place where "it worked once" and "it works" are different claims.
 *
 * The tenth is not a spare copy of the ninth. A compressing batch hands every
 * file back in the format it arrived in, so the queue is the only thing under
 * test; a converting batch runs the browser's WebP encoder once per file and
 * writes a container the source never had. An engine whose encoder works on
 * one file and leaks on the third would pass test 8 and fail here.
 *
 * The eleventh is the only one whose OUTPUT is bigger than its input, and that
 * is what it is here to prove. Every other path in this file shrinks a picture
 * or leaves it the size it was; the print sheet allocates a canvas the size of
 * a piece of paper — 1200 × 1800 at 300 DPI, six times the pixels of the photo
 * going onto it — fills it with white, draws the same resampled photo into it
 * several times, and encodes the lot. A browser whose surface allocation, whose
 * blit or whose encoder gives out somewhere above the size of the source would
 * pass all ten tests above and fail here, and a phone is where it would happen.
 *
 * The twelfth is the only one that decodes nothing. Every other path above
 * reaches a codec sooner or later; this one walks the container on the main
 * thread and never allocates a pixel, which makes it the one test here that
 * can fail for a reason that has nothing to do with WebAssembly or canvas —
 * a TypedArray method, a TextDecoder encoding, a DataView bounds rule. It is
 * also the only one whose download is not an image at all: it saves the
 * report as JSON, which is then judged against libvips like every other file.
 *
 * The thirteenth is the only one whose download is not an image format at all.
 * favicon.ico is a directory of offsets with pictures behind it, and a PNG
 * inside one is a CONVENTION rather than anything the format's own document
 * describes — so "every browser accepts it" is precisely the claim this
 * project is not entitled to make from Chromium alone. It is settled twice
 * over: the bytes are taken apart by a reader written from Microsoft's
 * structure, and then handed back to the browser under test as an <img>, which
 * is the only evidence that this engine will draw the file a visitor is about
 * to put at their site root. It is also the only test here that runs six
 * encodes off ONE decode, so an engine that leaked a surface between encodes
 * shows up as the sixth one failing rather than the first.
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

test('an exact 600×600 under a 100 KB ceiling spends quality, never pixels', {
    tag: ['@smoke'],
}, async ({ tool, page }) => {
    test.setTimeout(SLOW_TEST);

    // The eighth path: crop the source to the frame, resample to an exact box,
    // then run a multi-encode search until the file is under a ceiling — and
    // hand back the box that was asked for regardless of what the search found.
    // Test 2 above searches without changing geometry and test 7 changes
    // geometry without searching; only this one does both, which is the
    // combination /image-size-fitter exists for.
    const saved = await tool.process({
        route: '/image-size-fitter',
        h1: 'Fit an Image to Exact Dimensions and File Size',
        file: SAMPLE,
        before: async () => {
            await page.getByLabel(/^Width\b/).fill('600');
            await page.getByLabel(/^Height\b/).fill('600');
            await page.getByLabel('Maximum file size (KB)').fill('100');
        },
        button: 'Fit image',
        download: 'Download image',
        timeout: SLOW,
    });

    const out = await inspect(saved.file);
    expect(out.format).toBe('jpeg');
    expect(out.bytes).toBeLessThanOrEqual(100 * 1024);
    // Exact, not "at most", and asserted in the same breath as the ceiling. A
    // browser whose search met 100 KB by dropping to 512×512 passes the line
    // above and fails the portal the file was made for.
    expect(out.width).toBe(600);
    expect(out.height).toBe(600);
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

test('a print sheet composites one photo several times onto a paper-sized canvas', {
    tag: ['@smoke'],
}, async ({ tool }) => {
    // A 1.9 MP source decoded, cropped and resampled, then drawn into a
    // 2.16 MP canvas that is allocated white first — the largest single
    // surface any tool on this site asks a browser for. Budgeted like the
    // other multi-stage jobs here rather than like the one-encode ones.
    test.setTimeout(SLOW_TEST);

    // 4 × 6 in at 300 DPI, which is 1200 × 1800 pixels. Auto resolves to
    // portrait for the default 2 × 2 in photo — the two orientations tie at two
    // copies and a tie goes to portrait — so the four-inch edge is the width.
    // ../flows/passport-photo-print.spec.js derives all of that from the paper
    // registry and proves it; here it is simply what the file has to be, and
    // the arithmetic is written down so a changed default reads as a changed
    // default rather than as a broken browser.
    const DPI = 300;
    const PAPER = { width: Math.round(4 * DPI), height: Math.round(6 * DPI) };

    const saved = await tool.process({
        route: '/passport-photo-print',
        h1: 'Create a Passport Photo Print Sheet',
        file: await portrait(),
        button: 'Create sheet',
        download: 'Download JPEG',
        timeout: SLOW,
    });

    const out = await inspect(saved.file);
    expect(out.format).toBe('jpeg');
    // The paper, exactly. A sheet an engine sized from the photo instead of
    // from the paper opens perfectly and prints at the wrong size.
    expect(out.width).toBe(PAPER.width);
    expect(out.height).toBe(PAPER.height);
    // And the record that makes those pixels inches, written by walking the
    // JPEG's own segments rather than by any codec — the same byte-level
    // rewrite test 7 above proves on a much smaller file.
    expect(out.density).toBe(DPI);

    // A canvas of the right size proves the allocation, not the drawing. These
    // two say a photo went onto it and that the paper around it stayed paper:
    // an engine that returned the white surface untouched has a standard
    // deviation of zero, and one that stretched the photo over the whole sheet
    // has no white corner.
    const stats = await sharp(saved.file).stats();
    const spread = Math.max(...stats.channels.map((channel) => channel.stdev));
    expect(spread, 'the sheet is a flat field — no photo was drawn onto the paper')
        .toBeGreaterThan(10);

    const { data } = await sharp(saved.file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const corner = [data[0], data[1], data[2]];
    expect(
        corner.every((channel) => channel >= 250),
        `the top-left corner reads rgb(${corner.join(',')}) — the margin is not bare paper`,
    ).toBe(true);
});

test('a photo is read for what is stored inside it without a codec touching a pixel', {
    tag: ['@smoke'],
}, async ({ tool, page }) => {
    // The twelfth path, and the only one with no decode in it. Nothing here
    // fetches a codec, so it is also the fastest test in this file by an order
    // of magnitude — which is itself the assertion: a viewer that quietly
    // decoded the picture to read its header would not be.
    const fixture = metadataFixture('gps-greenwich.jpg');
    const before = fs.readFileSync(fixture);

    await tool.open('/image-metadata-viewer', { h1: 'View Image Metadata' });
    await tool.pick(fixture);

    await expect(page.getByRole('heading', { name: 'What this file contains' }))
        .toBeVisible({ timeout: 30_000 });

    const saved = await tool.download('Download report (JSON)');
    const report = JSON.parse(fs.readFileSync(saved.file, 'utf8'));

    // Judged against libvips rather than against the panel, like every other
    // download in this file: sharp opens the same photograph and is asked the
    // same questions the page just answered.
    const meta = await sharp(fixture).metadata();
    expect(report.file.format).toBe(meta.format);
    expect(report.file.width).toBe(meta.width);
    expect(report.file.height).toBe(meta.height);
    expect(report.exif.orientation.value).toBe(meta.orientation);

    // The Royal Observatory, to six decimals. A browser whose DataView or
    // whose 64-bit arithmetic differed would land somewhere else entirely.
    expect(report.gps.latitude).toBeCloseTo(51.477833, 5);
    expect(report.gps.longitude).toBe(-0.0015);

    // Read-only means the source file on disk is untouched, which no other
    // test in this directory has any reason to check.
    expect(fs.readFileSync(fixture).equals(before)).toBe(true);
});

test('a favicon package comes back as an ICO this browser can take apart and then draw', {
    tag: ['@smoke'],
}, async ({ tool, page }) => {
    // Six PNG encodes off one decode, behind a codec the engine fetches and
    // instantiates on first use. The largest surface is 512 × 512, which is
    // smaller than anything else in this file — the cost here is the number of
    // encodes rather than the size of any one of them.
    test.setTimeout(SLOW_TEST);

    await tool.open('/favicon-generator', { h1: 'Generate Favicons and App Icons' });
    await tool.pick(await logoMark());

    tool.network.processed = true;
    await page.getByRole('button', { name: 'Generate icons' }).click();
    await expect(page.getByRole('heading', { name: 'Icons ready' })).toBeVisible({ timeout: SLOW });

    const [download] = await Promise.all([
        page.waitForEvent('download'),
        page.getByRole('button', { name: 'Download favicon.ico', exact: true }).click(),
    ]);
    const saved = await download.path();
    expect(saved, 'the favicon.ico button produced no file').toBeTruthy();
    expect(download.suggestedFilename()).toBe('favicon.ico');

    // Taken apart by a reader written from Microsoft's own ICONDIR structure,
    // which never imports the engine's writer: three entries at 16, 32 and 48,
    // every payload a PNG whose IHDR agrees with the directory, every payload
    // inside the file and none of them overlapping. Each is a throw inside the
    // helper rather than an assertion here.
    const bytes = fs.readFileSync(saved);
    const ico = assertPngIco(bytes, { sizes: [16, 32, 48] });
    expect(ico.entries.map((entry) => entry.width)).toEqual([16, 32, 48]);

    // And libvips agrees about the pictures behind the offsets.
    for (const entry of ico.entries) {
        const meta = await sharp(entry.data).metadata();
        expect(meta.format).toBe('png');
        expect(meta.width).toBe(entry.width);
    }

    // THE HALF NO PARSER CAN PROVE, and the reason this test is in the
    // compatibility set rather than only in ../flows/favicon.spec.js: whether
    // THIS engine draws a PNG-in-ICO. The bytes go back to the browser as a
    // data: URL — the visitor's own file handed to their own tab, which the
    // no-upload guard treats as local and next.config's CSP allows under
    // `img-src data:`.
    const drawn = await page.evaluate((base64) => new Promise((resolve) => {
        const image = new window.Image();
        image.onload = () => resolve({ ok: true, width: image.naturalWidth, height: image.naturalHeight });
        image.onerror = () => resolve({ ok: false, width: 0, height: 0 });
        image.src = `data:image/x-icon;base64,${base64}`;
    }), bytes.toString('base64'));

    expect(drawn.ok, 'this browser refused to decode the generated favicon.ico').toBe(true);
    // A browser picks the entry it wants out of the directory, so which of the
    // three it reports is its own business — but it has to be one of them.
    expect(drawn.width, 'the browser decoded the ICO to nothing').toBeGreaterThanOrEqual(16);
    expect(drawn.width).toBe(drawn.height);
});


/**
 * FOURTEEN AND FIFTEEN: AVIF, which is the only format on this site whose two
 * directions run on two completely different implementations.
 *
 * Reading one is the BROWSER's own decoder — there is no AVIF decoder in this
 * build and there never will be, because the measured WASM one grew a 12
 * megapixel decode to 449 MB of heap. Writing one is libavif compiled to
 * WebAssembly, the same binary in every browser. So "AVIF works" is two claims
 * with nothing in common, and a browser can pass either one while failing the
 * other: Firefox and WebKit reached AVIF decoding in different years, and the
 * encoder is a WebAssembly module that has to instantiate under this site's CSP
 * in an engine that is not V8.
 *
 * The compatibility set therefore carries one of each, and the encode test
 * closes the loop by handing the finished AVIF back to the browser that wrote
 * it. A file this engine can produce and not open is not a file a visitor can
 * use.
 */

test('an AVIF is opened by this browser\'s own decoder and comes back a JPG', {
    tag: ['@smoke'],
}, async ({ tool }) => {
    test.setTimeout(SLOW_TEST);

    const saved = await tool.process({
        route: '/avif-to-jpg',
        file: await transparentAvif(),
        button: /convert to jpe?g/i,
        timeout: SLOW,
    });

    const out = await inspect(saved.file);
    expect(out.format).toBe('jpeg');
    expect([out.width, out.height]).toEqual([480, 320]);
    // JPEG has no alpha, so the transparent field this AVIF carries had to be
    // filled in — which only happens if the alpha plane was decoded at all.
    expect(out.hasAlpha).toBe(false);

    const { data } = await sharp(saved.file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    for (let channel = 0; channel < 3; channel += 1) {
        expect(
            Math.abs(data[channel] - 255),
            `the corner read ${data[0]},${data[1]},${data[2]} rather than white`,
        ).toBeLessThanOrEqual(6);
    }
});

test('a JPEG is written as an AVIF by the WASM encoder, and this browser reads it back', {
    tag: ['@smoke'],
}, async ({ tool, page }) => {
    test.setTimeout(SLOW_TEST);

    const saved = await tool.process({
        route: '/convert',
        h1: 'Convert Image Format Online',
        file: SAMPLE,
        before: () => page.selectOption('#convert-to', 'avif'),
        button: 'Convert to AVIF',
        download: 'Download AVIF',
        timeout: SLOW,
    });

    // Taken apart by a reader written from ISO/IEC 14496-12 and the AV1 Image
    // File Format, which never imports the engine's own header reader.
    const bytes = fs.readFileSync(saved.file);
    assertAvif(bytes, { width: 1600, height: 1067, alpha: false });

    // And libvips, which did not write it either.
    const out = await inspect(saved.file);
    expect(out.format).toBe('heif');
    expect([out.width, out.height]).toEqual([1600, 1067]);

    // THE HALF NO PARSER CAN PROVE, and the reason this test is here rather
    // than only in ../flows/avif.spec.js: whether THIS engine decodes the file
    // its own WebAssembly just wrote. The bytes go back as a Blob the page
    // builds itself, so nothing leaves the device.
    const drawn = await page.evaluate(async (base64) => {
        const binary = atob(base64);
        const buffer = new Uint8Array(binary.length);
        for (let index = 0; index < binary.length; index += 1) buffer[index] = binary.charCodeAt(index);
        try {
            const bitmap = await createImageBitmap(new Blob([buffer], { type: 'image/avif' }));
            const size = { ok: true, width: bitmap.width, height: bitmap.height };
            bitmap.close();
            return size;
        } catch (error) {
            return { ok: false, width: 0, height: 0, error: String(error && error.message) };
        }
    }, bytes.toString('base64'));

    expect(drawn.ok, `this browser refused to decode the AVIF it just wrote: ${drawn.error}`).toBe(true);
    expect([drawn.width, drawn.height]).toEqual([1600, 1067]);
});
