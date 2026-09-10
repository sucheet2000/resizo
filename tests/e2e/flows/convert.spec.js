const path = require('node:path');

const sharp = require('sharp');

const { test, expect } = require('../fixtures/resizo');
const { transparent, transparentPng } = require('../fixtures/files');
const { inspect, transparentShare } = require('../helpers/output');

const SAMPLE = path.join(__dirname, '..', '..', '..', 'public', 'samples', 'landscape-1600x1067.jpg');

/**
 * THE FILL COLOUR, READ OFF THE SAVED FILE.
 *
 * JPEG has no alpha channel, so /png-to-jpg has to put a real colour where the
 * transparency was. Which colour is a product decision — white, because what
 * arrives here is a logo or a signature going onto a white page — and the only
 * honest proof of it is the pixel in the file the browser saved. The panel
 * cannot be asked: a control that reports white and posts something else looks
 * identical to a working one until you open the bytes.
 *
 * The fixture's corner is transparent over NOTHING, so its colour in the JPG is
 * the fill and cannot be anything else.
 */
const CLEAR_CORNER_FLOW = {
    route: '/png-to-jpg',
    h1: 'Convert PNG to JPG',
    button: /convert to jpeg/i,
};

/** The top-left pixel of a saved file, as libvips reads it back. */
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

test('a transparent PNG converted to JPG lands on white without being asked', async ({ tool }) => {
    test.setTimeout(120_000);

    const saved = await tool.process({ ...CLEAR_CORNER_FLOW, file: await transparentPng() });
    const out = await inspect(saved.file);

    expect(out.format).toBe('jpeg');
    expect(out.width).toBe(480);
    expect(out.height).toBe(320);
    // JPEG cannot carry one, and a file that still claimed alpha would mean the
    // flattening never ran and the encoder simply dropped the byte.
    expect(out.hasAlpha).toBe(false);

    expectColourNear(await cornerPixel(saved.file), [255, 255, 255], 'the default fill');
});

test('choosing Black fills the transparency with black instead', async ({ tool, page }) => {
    test.setTimeout(120_000);

    const saved = await tool.process({
        ...CLEAR_CORNER_FLOW,
        file: await transparentPng(),
        after: () => page.getByRole('radio', { name: 'Black' }).check(),
    });
    const out = await inspect(saved.file);

    expect(out.format).toBe('jpeg');
    expect(out.hasAlpha).toBe(false);

    expectColourNear(await cornerPixel(saved.file), [0, 0, 0], 'a chosen black');
});

test('a custom colour reaches the saved pixels exactly as it was picked', async ({ tool, page }) => {
    test.setTimeout(120_000);

    const saved = await tool.process({
        ...CLEAR_CORNER_FLOW,
        file: await transparentPng(),
        after: async () => {
            await page.getByRole('radio', { name: 'Custom' }).check();
            await page.getByLabel('Custom colour').fill('#2f6fed');
        },
    });
    const out = await inspect(saved.file);

    expect(out.format).toBe('jpeg');
    expect(out.hasAlpha).toBe(false);

    // #2f6fed, within what the JPEG round trip moves a flat field.
    expectColourNear(await cornerPixel(saved.file), [0x2f, 0x6f, 0xed], 'a custom hex');
});

/**
 * The page shows the conversion as well as describing it. The figure is two
 * files this repo ships, so a broken path or a dropped block is a picture that
 * is simply not there — which nothing else on this page would notice.
 */
test('the transparency figure on /png-to-jpg shows both of its images', async ({ tool, page }) => {
    await tool.open('/png-to-jpg', { h1: 'Convert PNG to JPG' });

    const before = page.getByAltText(/checkerboard/i);
    const after = page.getByAltText(/filled in solid white/i);

    await before.scrollIntoViewIfNeeded();
    await expect(before).toBeVisible();
    await expect(after).toBeVisible();

    for (const image of [before, after]) {
        expect(
            await image.evaluate((node) => node.naturalWidth),
            'a demo image is in the markup but did not load',
        ).toBeGreaterThan(0);
    }
});

test('WebP to PNG keeps the transparency the JPG route would have filled in', async ({ tool }) => {
    test.setTimeout(120_000);

    const saved = await tool.process({
        route: '/webp-to-png',
        h1: 'Convert WebP to PNG',
        file: await transparent(),
        button: 'Convert to PNG',
    });
    const out = await inspect(saved.file);

    expect(out.format).toBe('png');
    // The one thing this page exists for. A JPEG route would have made this false.
    expect(out.hasAlpha).toBe(true);
    expect(await transparentShare(saved.file)).toBeGreaterThan(0.5);
    expect(out.width).toBe(320);
    expect(out.height).toBe(240);
});

test('resizing a WebP gives back a WebP at the width that was asked for', async ({ tool, page }) => {
    test.setTimeout(120_000);

    const saved = await tool.process({
        route: '/resize-webp',
        h1: 'Resize a WebP',
        file: await transparent(),
        // The file goes first: an unconfigured panel adopts the source
        // dimensions on intake, so a width typed before the drop is the one it
        // overwrites.
        after: () => page.getByLabel('Width (px)', { exact: true }).fill('400'),
        button: 'Resize image',
    });
    const out = await inspect(saved.file);

    // No preset on this page, so the format select stays on "Same as the
    // original" — a WebP in has to be a WebP out.
    expect(out.format).toBe('webp');
    expect(out.width).toBe(400);
});

test('the lazily loaded tool hydrates on an intent page and converts with the preset', async ({ tool }) => {
    test.setTimeout(120_000);

    const saved = await tool.process({
        route: '/jpg-to-webp',
        h1: 'Convert JPG to WebP',
        file: SAMPLE,
        button: /convert to webp/i,
    });
    const out = await inspect(saved.file);

    expect(out.format).toBe('webp');
    expect(out.width).toBe(1600);
    expect(out.height).toBe(1067);
});
