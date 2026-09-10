/**
 * HEIC, end to end, on the three routes that offer it.
 *
 * This is the one format on the site that no browser can display and that the
 * repository's own reference implementation cannot decode either: sharp's
 * libvips is built with AV1 but not HEVC, so it reads the container header of
 * `sample-96x64.heic` and then fails on the pixels ("bad seek"). There is
 * therefore no way to check the conversion by decoding the input.
 *
 * So the proof runs from the other side. `sample-96x64.heic` was made once, on
 * a Mac, from `sample-96x64.png` (see ../fixtures/assets/README.md). The page
 * decodes the HEIC with libheif-js in the visitor's own browser, writes a JPG
 * or a PNG, and the downloaded bytes are compared pixel-for-pixel against that
 * original PNG. If libheif returned the wrong picture — a stale buffer, a
 * half-decoded tile, the wrong plane order, garbage — the comparison moves a
 * long way. Nothing here reads the result panel as evidence; every claim is a
 * claim about the saved file.
 */
const path = require('node:path');

const { test, expect } = require('../fixtures/resizo');
const { inspect, meanAbsoluteDifference } = require('../helpers/output');

const ASSETS = path.join(__dirname, '..', 'fixtures', 'assets');
const SOURCE_HEIC = path.join(ASSETS, 'sample-96x64.heic');
const SOURCE_PNG = path.join(ASSETS, 'sample-96x64.png');

/** The fixture's own dimensions. A conversion changes neither. */
const SIZE = { width: 96, height: 64 };

/**
 * Mean absolute difference per channel, 0–255, allowed between a converted
 * file and the PNG the HEIC was encoded from.
 *
 * MEASURED, on this fixture, in Chromium:
 *
 *   HEIC → PNG   1.55   HEVC at quality 90 is the only loss in the chain
 *   HEIC → JPG   2.24   plus the JPEG the engine writes at quality 90
 *
 * Flat colour survives both codecs almost intact; what little moves is the
 * pale diagonal band and the four quadrant edges, where 4:2:0 chroma
 * subsampling bleeds colour across a hard boundary. Neither figure is near
 * this ceiling, and no plausible way of getting the picture WRONG lands
 * anywhere near it either — measured against the same source, a blank grey
 * buffer scores 70.5, a red/blue plane swap 74.4, a single tile stretched
 * over the frame 71.2 and an unwanted 180° turn 97.2. So 12 sits roughly five
 * times above a correct decode and six times below the cheapest failure. It
 * is a wide, deliberately uninteresting band: a different JPEG encoder or a
 * newer libheif may move the figure a little, and only a genuinely wrong
 * picture can cross this.
 */
const LOSSY_TOLERANCE = 12;

/**
 * libheif-js is a WebAssembly module the page downloads the first time a HEIC
 * is handed to it, so the first conversion in a fresh browser context pays for
 * the fetch and the instantiation before a single pixel is decoded.
 */
const DECODE_TIMEOUT = 60_000;

const JPG_RADIO = 'JPG (smaller, opens everywhere)';
const PNG_RADIO = 'PNG (lossless, keeps transparency, much larger)';

/**
 * The independent check: does this file hold the picture the HEIC was made
 * from? Attaches the measured figure either way, so a failure reads as "it
 * moved this far" rather than as a bare threshold.
 */
async function assertMatchesSource(file, testInfo, label) {
    const difference = await meanAbsoluteDifference(file, SOURCE_PNG, SIZE);
    await testInfo.attach(`mean-absolute-difference-${label}`, {
        contentType: 'application/json',
        body: JSON.stringify({ label, difference, tolerance: LOSSY_TOLERANCE }, null, 2),
    });
    expect(difference, `${label} does not hold the picture the HEIC was encoded from`).toBeLessThan(LOSSY_TOLERANCE);
    return difference;
}

test('/heic decodes a HEIC and downloads the JPG it was made from', async ({ tool }, testInfo) => {
    test.setTimeout(120_000);

    const saved = await tool.process({
        route: '/heic',
        h1: 'Convert HEIC to JPG',
        file: SOURCE_HEIC,
        button: 'Convert to JPG',
        download: /^Download JPG$/,
        timeout: DECODE_TIMEOUT,
    });

    const out = await inspect(saved.file);
    expect(out.format).toBe('jpeg');
    expect(out.width).toBe(SIZE.width);
    expect(out.height).toBe(SIZE.height);
    expect(out.hasAlpha, 'a JPEG cannot carry an alpha channel').toBe(false);

    await assertMatchesSource(saved.file, testInfo, 'heic-default-jpg');
});

test('/heic-to-png arrives preset to PNG and writes a lossless copy', async ({ tool, page }, testInfo) => {
    test.setTimeout(120_000);

    await tool.open('/heic-to-png', { h1: 'Convert HEIC to PNG' });

    await expect(page.getByRole('radio', { name: PNG_RADIO })).toBeChecked();
    await expect(page.getByRole('radio', { name: JPG_RADIO })).not.toBeChecked();
    await expect(page.getByRole('button', { name: 'Convert to PNG' })).toBeVisible();

    await tool.pick(SOURCE_HEIC);
    await tool.run('Convert to PNG', { download: /^Download PNG$/, timeout: DECODE_TIMEOUT });
    const png = await tool.download(/^Download PNG$/);

    const out = await inspect(png.file);
    expect(out.format).toBe('png');
    expect(out.width).toBe(SIZE.width);
    expect(out.height).toBe(SIZE.height);

    await assertMatchesSource(png.file, testInfo, 'heic-preset-png');

    /**
     * The preset selects PNG, it does not lock it (HeicTool says so in as many
     * words), so the same page can be asked for the other format — and that is
     * also how the two files get compared on one source. A PNG stores every
     * decoded pixel; a JPG at quality 90 throws some away. The PNG is larger,
     * and on this fixture it is not close.
     */
    await page.getByRole('radio', { name: JPG_RADIO }).check();
    await tool.run('Convert to JPG', { download: /^Download JPG$/, timeout: DECODE_TIMEOUT });
    const jpg = await tool.download(/^Download JPG$/);

    expect((await inspect(jpg.file)).format).toBe('jpeg');
    await testInfo.attach('lossless-costs-more', {
        contentType: 'application/json',
        body: JSON.stringify({ pngBytes: png.bytes, jpgBytes: jpg.bytes }, null, 2),
    });
    expect(png.bytes, 'the lossless PNG should be the larger file').toBeGreaterThan(jpg.bytes);
});

test('/heic-to-jpg hydrates the lazily loaded tool with no preset and converts', async ({ tool, page }, testInfo) => {
    test.setTimeout(120_000);

    await tool.open('/heic-to-jpg', { h1: 'HEIC to JPG' });

    await expect(page.getByRole('radio', { name: JPG_RADIO })).toBeChecked();
    await expect(page.getByRole('radio', { name: PNG_RADIO })).not.toBeChecked();

    await tool.pick(SOURCE_HEIC);
    await tool.run('Convert to JPG', { download: /^Download JPG$/, timeout: DECODE_TIMEOUT });
    const saved = await tool.download(/^Download JPG$/);

    const out = await inspect(saved.file);
    expect(out.format).toBe('jpeg');
    expect(out.width).toBe(SIZE.width);
    expect(out.height).toBe(SIZE.height);
    expect(out.hasAlpha).toBe(false);

    await assertMatchesSource(saved.file, testInfo, 'heic-to-jpg-intent');
});
