const fs = require('node:fs');
const path = require('node:path');

const sharp = require('sharp');

const { test, expect } = require('../fixtures/resizo');
const {
    avifFixture, largeAvif, opaqueAvif, tenBitAvif, transparentAvif, transparentPng,
} = require('../fixtures/files');
const { inspect, meanAbsoluteDifference, transparentShare } = require('../helpers/output');
const { assertAvif, parseAvif } = require('../../helpers/avif');

/**
 * AVIF, in the browser, through the real pages.
 *
 * WHAT ONLY A BROWSER CAN SETTLE. The engine tests in
 * tests/lib/image-client/avif.properties.test.js prove the orchestration —
 * the refusals, the flattening, the validation — but they cannot prove the one
 * thing the whole feature rests on, because Node has no AVIF decoder and the
 * product ships none. **Every AVIF this site opens is opened by the visitor's
 * own browser**, and the only place that claim can be tested is in one.
 *
 * So every flow here reads the file three times over, by three different
 * implementations, and a claim is only a finding when they agree:
 *
 *   the browser under test   it decoded the input, and for an AVIF output it
 *                            is handed the finished bytes back through
 *                            createImageBitmap — the same call a visitor's
 *                            next page would make of the file they just saved
 *   libvips (sharp)          reopens the download: format, dimensions, alpha,
 *                            and the actual corner pixel
 *   tests/helpers/avif.js    takes the container apart from ISO/IEC 14496-12
 *                            and the AV1 Image File Format, so "it is an AVIF"
 *                            is a parse rather than a Content-Type
 *
 * THE NO-UPLOAD GUARD RUNS ON ALL OF THESE AUTOMATICALLY and cannot pass
 * vacuously: a test that processed a file asserts the request log is non-empty
 * (see ../fixtures/resizo.js). AVIF is the first format on this site whose
 * encoder is large enough that "send it to a server instead" would be a
 * tempting shortcut, which makes the mechanical proof worth more here than
 * anywhere else.
 *
 * A browser error or a console.error fails every test here too, which is what
 * makes the refusal flow meaningful: a damaged AVIF has to produce a SENTENCE,
 * not a thrown promise nobody caught.
 */

const SAMPLE = path.join(__dirname, '..', '..', '..', 'public', 'samples', 'landscape-1600x1067.jpg');

/** A WASM encoder fetch plus a first AVIF encode is slower than the default. */
const SLOW = 90_000;
const SLOW_TEST = 180_000;

/** The sentence the plan fixes for a file that cannot be read. */
const DAMAGED = 'This AVIF file is damaged or incomplete and could not be read.';

/** The top-left pixel of a saved file, as libvips reads it back. */
async function cornerPixel(file) {
    const { data } = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    return [data[0], data[1], data[2]];
}

/** A colour, within what a lossy encode moves a flat field. */
function expectColourNear(actual, expected, label, tolerance = 6) {
    for (let channel = 0; channel < 3; channel += 1) {
        expect(
            Math.abs(actual[channel] - expected[channel]),
            `${label}: the corner read ${actual.join(',')}, expected about ${expected.join(',')}`,
        ).toBeLessThanOrEqual(tolerance);
    }
}

/**
 * Hands the saved file back to the browser that made it and asks it to decode.
 *
 * THE ONLY EVIDENCE THAT MATTERS FOR AN AVIF OUTPUT. A file can parse as a
 * valid container, satisfy libvips, and still be one a browser will not draw —
 * and a visitor who downloads an AVIF is going to open it in a browser. The
 * bytes go in as a base64 string and become a Blob inside the page, so nothing
 * leaves the device and the no-upload guard stays true.
 */
async function decodeInBrowser(page, file, type = 'image/avif') {
    const base64 = fs.readFileSync(file).toString('base64');

    return page.evaluate(async ([data, mime]) => {
        const binary = atob(data);
        const bytes = new Uint8Array(binary.length);
        for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);

        const blob = new Blob([bytes], { type: mime });
        try {
            const bitmap = await createImageBitmap(blob);
            const size = { width: bitmap.width, height: bitmap.height };
            bitmap.close();
            return { ok: true, ...size };
        } catch (error) {
            return { ok: false, error: String(error && error.message) };
        }
    }, [base64, type]);
}

/** Whatever the page is complaining about, in its own words. */
async function refusal(page) {
    const alerts = await page.getByRole('alert').allInnerTexts();
    return alerts.map((line) => line.replace(/\s+/g, ' ').trim()).filter(Boolean).join(' / ');
}

/* ------------------------------------------------------------------ *
 * 1–3. Reading an AVIF
 * ------------------------------------------------------------------ */

test('an opaque AVIF converts to a JPG of the same picture at the same size', async ({ tool, page }) => {
    test.setTimeout(SLOW_TEST);

    const saved = await tool.process({
        route: '/avif-to-jpg',
        file: await opaqueAvif(),
        button: /convert to jpe?g/i,
        timeout: SLOW,
    });

    const out = await inspect(saved.file);
    expect(out.format).toBe('jpeg');
    expect([out.width, out.height]).toEqual([640, 480]);
    expect(out.hasAlpha).toBe(false);

    // The picture, not a grey rectangle of the right size: the browser's decode
    // and libvips' decode of the ORIGINAL have to be the same photograph.
    const drift = await meanAbsoluteDifference(saved.file, await opaqueAvif(), { width: 320, height: 240 });
    expect(drift, 'the JPG is not the picture the AVIF held').toBeLessThan(12);

    expect(await refusal(page)).toBe('');
});

test('a transparent AVIF converted to PNG keeps its transparency', async ({ tool }) => {
    test.setTimeout(SLOW_TEST);

    const saved = await tool.process({
        route: '/avif-to-png',
        file: await transparentAvif(),
        button: /convert to png/i,
        timeout: SLOW,
    });

    const out = await inspect(saved.file);
    expect(out.format).toBe('png');
    expect(out.hasAlpha).toBe(true);
    expect([out.width, out.height]).toEqual([480, 320]);

    // The fixture is clear right out to the corners and opaque in the middle.
    expect(await transparentShare(saved.file)).toBeGreaterThan(0.5);
    const { data } = await sharp(saved.file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    expect(data[3], 'the corner came back opaque').toBeLessThan(16);
});

test('a transparent AVIF converted to JPG lands on white, and on a colour when one is chosen', async ({ tool, page }) => {
    test.setTimeout(SLOW_TEST);

    const white = await tool.process({
        route: '/avif-to-jpg',
        file: await transparentAvif(),
        button: /convert to jpe?g/i,
        timeout: SLOW,
    });

    expect((await inspect(white.file)).hasAlpha).toBe(false);
    expectColourNear(await cornerPixel(white.file), [255, 255, 255], 'the default fill');

    const chosen = await tool.process({
        route: '/avif-to-jpg',
        file: await transparentAvif(),
        before: async () => {
            await page.getByRole('radio', { name: 'Custom' }).check();
            await page.getByLabel('Custom colour').fill('#2f6fed');
        },
        button: /convert to jpe?g/i,
        timeout: SLOW,
    });

    expectColourNear(await cornerPixel(chosen.file), [0x2f, 0x6f, 0xed], 'a custom hex');
});

/* ------------------------------------------------------------------ *
 * 4–5. Writing an AVIF
 * ------------------------------------------------------------------ */

test('a JPEG converted to AVIF comes back as a file all three readers agree is an AVIF', async ({ tool, page }) => {
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

    expect(saved.filename).toMatch(/\.avif$/);

    // Reader one: the container, taken apart from the format's own document.
    const avif = assertAvif(fs.readFileSync(saved.file), { width: 1600, height: 1067, alpha: false });
    expect(avif.animated).toBe(false);
    expect(avif.hasExif, 'the source EXIF rode along into the AVIF').toBe(false);
    expect(avif.hasXmp).toBe(false);

    // Reader two: libvips, which did not write it.
    const out = await inspect(saved.file);
    expect(out.format).toBe('heif');
    expect([out.width, out.height]).toEqual([1600, 1067]);

    // Reader three: the browser itself, handed its own output back.
    const decoded = await decodeInBrowser(page, saved.file);
    expect(decoded.ok, `this browser would not decode the AVIF it just wrote: ${decoded.error}`).toBe(true);
    expect([decoded.width, decoded.height]).toEqual([1600, 1067]);
});

test('a transparent PNG converted to AVIF keeps the transparency as a real alpha plane', async ({ tool, page }) => {
    test.setTimeout(SLOW_TEST);

    const saved = await tool.process({
        route: '/convert',
        h1: 'Convert Image Format Online',
        file: await transparentPng(),
        before: () => page.selectOption('#convert-to', 'avif'),
        button: 'Convert to AVIF',
        download: 'Download AVIF',
        timeout: SLOW,
    });

    // An AVIF's transparency is a second coded image, not a fourth channel, so
    // "it has alpha" is a statement about the container's item list.
    const avif = assertAvif(fs.readFileSync(saved.file), { width: 480, height: 320, alpha: true });
    expect(avif.alphaLinkedToPrimary).toBe(true);

    const out = await inspect(saved.file);
    expect(out.hasAlpha).toBe(true);

    const { data } = await sharp(saved.file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    expect(data[3], 'the clear corner came back opaque').toBeLessThan(16);

    const decoded = await decodeInBrowser(page, saved.file);
    expect(decoded.ok, `this browser would not decode the AVIF it just wrote: ${decoded.error}`).toBe(true);
});

/* ------------------------------------------------------------------ *
 * 6. The pair the converter must never run
 * ------------------------------------------------------------------ */

test('dropping an AVIF while AVIF is selected moves the output away rather than re-encoding it', async ({ tool, page }) => {
    test.setTimeout(SLOW_TEST);

    await tool.open('/convert', { h1: 'Convert Image Format Online' });
    await page.selectOption('#convert-to', 'avif');
    await expect(page.locator('#convert-to')).toHaveValue('avif');

    await tool.pick(await opaqueAvif());

    // The page's own rule: the source format is never also the target. An
    // AVIF → AVIF job is a slow re-encode that makes the picture worse and the
    // file no better, so the control moves instead of the engine running.
    await expect(page.locator('#convert-to')).not.toHaveValue('avif');

    const chosen = await page.locator('#convert-to').inputValue();
    expect(['jpeg', 'png', 'webp']).toContain(chosen);

    // And the button that would have run it is gone, not merely disabled.
    await expect(page.getByRole('button', { name: 'Convert to AVIF' })).toHaveCount(0);
});

/* ------------------------------------------------------------------ *
 * 7. A file that cannot be read
 * ------------------------------------------------------------------ */

test('a damaged AVIF is refused in a sentence, with no download and nothing thrown', async ({ tool, page }) => {
    test.setTimeout(SLOW_TEST);

    await tool.open('/avif-to-jpg');
    await tool.pick(avifFixture('truncated.avif'));

    // The refusal may arrive on intake or when the job runs — both are correct
    // and the visitor cannot tell the difference. What is NOT correct is a
    // download button, and what is never correct is a thrown promise, which the
    // shared fixture fails the test for on its own.
    const action = page.getByRole('button', { name: /convert to jpe?g/i });
    if (await action.isEnabled().catch(() => false)) await action.click();

    await expect(page.getByText(DAMAGED)).toBeVisible({ timeout: SLOW });
    await expect(page.getByRole('button', { name: /^Download/ })).toHaveCount(0);
});

test('an AVIF that declares itself an animation is refused by name', async ({ tool, page }) => {
    test.setTimeout(SLOW_TEST);

    await tool.open('/avif-to-jpg');
    await tool.pick(avifFixture('avis-brand.avif'));

    const action = page.getByRole('button', { name: /convert to jpe?g/i });
    if (await action.isEnabled().catch(() => false)) await action.click();

    await expect(page.getByText('Animated AVIF is not supported yet.')).toBeVisible({ timeout: SLOW });
    await expect(page.getByRole('button', { name: /^Download/ })).toHaveCount(0);
});

/* ------------------------------------------------------------------ *
 * 8. A phone
 * ------------------------------------------------------------------ */

test.describe('on a 390 px screen', () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test('an AVIF is decoded and a new one is encoded, both inside the screen', async ({ tool, page }) => {
        test.setTimeout(SLOW_TEST);

        const decoded = await tool.process({
            route: '/avif-to-jpg',
            file: await transparentAvif(),
            button: /convert to jpe?g/i,
            timeout: SLOW,
        });

        expect((await inspect(decoded.file)).format).toBe('jpeg');

        const encoded = await tool.process({
            route: '/convert',
            h1: 'Convert Image Format Online',
            file: await transparentPng(),
            before: () => page.selectOption('#convert-to', 'avif'),
            button: 'Convert to AVIF',
            download: 'Download AVIF',
            timeout: SLOW,
        });

        assertAvif(fs.readFileSync(encoded.file), { width: 480, height: 320, alpha: true });

        // A phone has no horizontal scrollbar to warn you: an overflowing
        // result panel just cuts the page off at the right edge.
        const { innerWidth, scrollWidth } = await page.evaluate(() => ({
            innerWidth: window.innerWidth,
            scrollWidth: document.documentElement.scrollWidth,
        }));
        expect(scrollWidth, 'the document is wider than the screen').toBeLessThanOrEqual(innerWidth);
    });
});

/* ------------------------------------------------------------------ *
 * The two the fixtures exist for
 * ------------------------------------------------------------------ */

test('a 10-bit AVIF is converted and the page says it was decoded to 8-bit', async ({ tool, page }) => {
    test.setTimeout(SLOW_TEST);

    const source = await tenBitAvif();
    expect(parseAvif(fs.readFileSync(source)).bitDepth, 'the fixture is not 10-bit').toBe(10);

    const saved = await tool.process({
        route: '/avif-to-jpg',
        file: source,
        button: /convert to jpe?g/i,
        timeout: SLOW,
    });

    const out = await inspect(saved.file);
    expect(out.format).toBe('jpeg');
    expect([out.width, out.height]).toEqual([640, 480]);

    // The footnote is the only place a visitor learns their 10-bit file came
    // back 8-bit, and that sentence is the product's answer to a real question.
    await expect(page.getByText(/10-bit source decoded to 8-bit/i)).toBeVisible();
});

test('a 12 megapixel AVIF decodes in the tab and comes back at its full size', async ({ tool }) => {
    test.setTimeout(SLOW_TEST);

    const saved = await tool.process({
        route: '/avif-to-jpg',
        file: await largeAvif(),
        button: /convert to jpe?g/i,
        timeout: SLOW,
    });

    const out = await inspect(saved.file);
    expect(out.format).toBe('jpeg');
    // Not downscaled to fit a budget: a conversion changes the container and
    // never the picture's size, however large the picture is.
    expect([out.width, out.height]).toEqual([4000, 3000]);
});
