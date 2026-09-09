const path = require('node:path');
const fs = require('node:fs');

const { expect, test } = require('@playwright/test');
const sharp = require('sharp');

const { exifGpsJpeg, signature, transparent } = require('./helpers/fixtures');

/**
 * The seven expansion flows, driven the way a person drives them: a real file
 * through a real input, the real button, the real download.
 *
 * TWO THINGS EVERY IMAGE TEST HERE ASSERTS BEYOND ITS OWN FLOW.
 *
 * 1. No page error. A tool that throws during hydration still renders its
 *    static HTML, so a headline assertion alone passes over a dead page.
 * 2. Nothing left the device. CLAUDE.md's central promise is that no image is
 *    uploaded, and the only mechanical proof of that is the request log: every
 *    request the page makes is a GET to this origin, so there is no POST
 *    carrying a photograph and no other host to carry it to. A green flow
 *    proves the picture came back; only the log proves where it went.
 *
 * The downloaded file is re-opened with sharp — the repo's independent libvips
 * reference — rather than trusted from the panel's own sentence, because the
 * panel and the file are exactly the two things that can disagree.
 */
const SAMPLE = path.join(__dirname, '..', '..', 'public', 'samples', 'landscape-1600x1067.jpg');

/** A compress-to-target search runs up to eight full encodes, plus a WASM fetch. */
const HEAVY = 120_000;

/** The bar the panel has to clear once the button is pressed. */
const RESULT_TIMEOUT = 30_000;

function watchPageErrors(page) {
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    return errors;
}

/**
 * Every request the page makes, from before the document itself. Starting at
 * the top rather than at the file pick is deliberate: the page load is what
 * proves the listener is attached to this page at all, which is what stops
 * `expect(offenders).toEqual([])` passing on an empty log it never filled.
 */
function watchNetwork(page) {
    const seen = [];
    page.on('request', (request) => seen.push({ method: request.method(), url: request.url() }));
    return seen;
}

function isLocal(url, baseURL) {
    // blob: and data: never reach a network — they are the visitor's own bytes
    // handed back to their own browser, which is the whole architecture.
    if (url.startsWith('blob:') || url.startsWith('data:')) return true;
    return url === baseURL || url.startsWith(`${baseURL}/`);
}

function expectStayedOnDevice(seen, baseURL) {
    expect(seen.length, 'requests observed — an empty log proves nothing').toBeGreaterThan(0);

    const offenders = seen
        .filter(({ method, url }) => method !== 'GET' || !isLocal(url, baseURL))
        .map(({ method, url }) => `${method} ${url}`);

    expect(offenders, 'requests that were not a same-origin GET').toEqual([]);
}

/** The affordance that replaces the submit button once a result exists. */
function downloadButton(page, name) {
    return page.getByRole('button', { name }).or(page.getByRole('link', { name }));
}

/** Presses the download affordance and hands back the file the browser saved. */
async function saveDownload(page, name) {
    const [download] = await Promise.all([
        page.waitForEvent('download'),
        downloadButton(page, name).click(),
    ]);

    const file = await download.path();
    expect(file, `${name} produced no file`).toBeTruthy();
    return { file, filename: download.suggestedFilename(), bytes: fs.statSync(file).size };
}

test('a 20 KB intent page opens on the policy that may shrink, and reaches the ceiling', async ({ page, baseURL }) => {
    test.setTimeout(HEAVY);

    const errors = watchPageErrors(page);
    const seen = watchNetwork(page);

    await page.goto('/compress-image-to-20kb');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Compress an Image to 20 KB');

    // The whole point of this page against its 100 KB sibling: at 20 KB the
    // pixels are allowed to move, and the visitor is told that before they drop
    // anything rather than after.
    await expect(page.getByRole('radio', { name: 'Shrink to fit' })).toBeChecked();
    await expect(page.getByRole('radio', { name: 'Keep the dimensions' })).not.toBeChecked();

    await page.locator('input[type="file"]').first().setInputFiles(SAMPLE);
    await page.getByRole('button', { name: 'Compress image' }).click();

    await expect(downloadButton(page, 'Download compressed image')).toBeVisible({ timeout: RESULT_TIMEOUT });
    await expect(page.getByText('Asked for 20 KB')).toBeVisible();

    expect(errors.join('\n')).toBe('');
    expectStayedOnDevice(seen, baseURL);
});

test('the 100 KB page opens on the policy that never touches the pixels', async ({ page }) => {
    const errors = watchPageErrors(page);

    await page.goto('/compress-image-to-100kb');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Compress an Image to 100 KB');

    await expect(page.getByRole('radio', { name: 'Keep the dimensions' })).toBeChecked();
    await expect(page.getByRole('radio', { name: 'Shrink to fit' })).not.toBeChecked();

    expect(errors.join('\n')).toBe('');
});

test('the signature resizer meets a pixel box and a byte ceiling in one pass', async ({ page, baseURL }) => {
    test.setTimeout(HEAVY);

    const errors = watchPageErrors(page);
    const seen = watchNetwork(page);
    const fixture = await signature();

    await page.goto('/signature-resizer');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Signature Resizer for Online Forms');

    // Every number a form gives you is knowable before there is a file, and the
    // page puts all three above the drop zone for exactly that reason.
    await page.getByLabel('Width (px)', { exact: true }).fill('300');
    await page.getByLabel('Height (px)', { exact: true }).fill('80');
    await page.getByLabel('Maximum file size (KB)').fill('15');

    await page.locator('input[type="file"]').first().setInputFiles(fixture);
    await page.getByRole('button', { name: 'Make signature' }).click();

    await expect(downloadButton(page, 'Download signature')).toBeVisible({ timeout: RESULT_TIMEOUT });
    await expect(page.getByText('saved as JPG')).toBeVisible();
    await expect(page.getByText('It fits the 15 KB limit you set')).toBeVisible();

    const saved = await saveDownload(page, 'Download signature');
    const meta = await sharp(saved.file).metadata();

    expect(meta.format).toBe('jpeg');
    expect(meta.width).toBeLessThanOrEqual(300);
    expect(meta.height).toBeLessThanOrEqual(80);
    expect(saved.bytes).toBeLessThan(15 * 1024);

    expect(errors.join('\n')).toBe('');
    expectStayedOnDevice(seen, baseURL);
});

test('the DPI tool reads what a file claims and writes what was asked for', async ({ page, baseURL }) => {
    test.setTimeout(HEAVY);

    const errors = watchPageErrors(page);
    const seen = watchNetwork(page);
    const fixture = await exifGpsJpeg();

    await page.goto('/change-image-dpi');
    await page.locator('input[type="file"]').first().setInputFiles(fixture);

    // The checker opens on intake, before any control is touched: the visitor
    // arrived holding somebody else's sentence about their file.
    const readout = page.getByRole('status').filter({ hasText: 'What this file says' });
    await expect(readout).toBeVisible();
    // sharp records a JPEG's density in the EXIF block and writes no JFIF APP0,
    // so the source named here is the EXIF one.
    await expect(readout).toContainText('72 × 72 DPI, from the EXIF block');
    await expect(readout).toContainText('800 × 600 px');

    await page.getByRole('button', { name: 'Print 300' }).click();
    await expect(page.getByLabel('New DPI')).toHaveValue('300');

    await page.getByRole('button', { name: 'Set DPI' }).click();
    await expect(downloadButton(page, 'Download image')).toBeVisible({ timeout: RESULT_TIMEOUT });
    await expect(page.getByText('It now says 300 × 300 DPI')).toBeVisible();

    const saved = await saveDownload(page, 'Download image');
    const meta = await sharp(saved.file).metadata();

    expect(meta.density).toBe(300);
    // A DPI change adds or removes no pixels. This is the assertion that would
    // catch a "set DPI" that quietly resampled.
    expect(meta.width).toBe(800);
    expect(meta.height).toBe(600);

    expect(errors.join('\n')).toBe('');
    expectStayedOnDevice(seen, baseURL);
});

test('the metadata tool names the camera and the coordinates, then removes them', async ({ page, baseURL }) => {
    test.setTimeout(HEAVY);

    const errors = watchPageErrors(page);
    const seen = watchNetwork(page);
    const fixture = await exifGpsJpeg();
    const sourceBytes = fs.statSync(fixture).size;

    await page.goto('/remove-image-metadata');
    await page.locator('input[type="file"]').first().setInputFiles(fixture);

    const readout = page.getByRole('status').filter({ hasText: 'What this file carries' });
    await expect(readout).toBeVisible();
    await expect(readout).toContainText('Camera and capture data (EXIF)');
    await expect(readout).toContainText('Location (GPS coordinates)');

    await page.getByRole('button', { name: 'Remove metadata' }).click();
    await expect(downloadButton(page, 'Download clean image')).toBeVisible({ timeout: RESULT_TIMEOUT });

    const saved = await saveDownload(page, 'Download clean image');
    const meta = await sharp(saved.file).metadata();

    expect(meta.exif).toBeUndefined();
    // The picture is copied through byte for byte; only the blocks around it go.
    expect(meta.width).toBe(800);
    expect(meta.height).toBe(600);
    expect(saved.bytes).toBeLessThan(sourceBytes);

    expect(errors.join('\n')).toBe('');
    expectStayedOnDevice(seen, baseURL);
});

/**
 * A page-level check and nothing more, on purpose: there is no HEIC fixture in
 * this repo and there cannot be one made here, because sharp's libvips build
 * does not encode HEVC. What is provable without a file is that the intent
 * entry's preset actually reaches the tool — the PNG radio, the button label
 * and the headline all follow `preset: { format: 'png' }`, and a preset that
 * failed to arrive would leave every one of them saying JPG.
 */
test('the HEIC to PNG page arrives preset to PNG', async ({ page }) => {
    const errors = watchPageErrors(page);

    await page.goto('/heic-to-png');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Convert HEIC to PNG');

    await expect(page.getByRole('radio', { name: /^PNG/ })).toBeChecked();
    await expect(page.getByRole('radio', { name: /^JPG/ })).not.toBeChecked();
    await expect(page.getByRole('button', { name: 'Convert to PNG' })).toBeVisible();

    expect(errors.join('\n')).toBe('');
});

test('WebP to PNG keeps the transparency the JPG route would have filled in', async ({ page, baseURL }) => {
    test.setTimeout(HEAVY);

    const errors = watchPageErrors(page);
    const seen = watchNetwork(page);
    const fixture = await transparent();

    await page.goto('/webp-to-png');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Convert WebP to PNG');

    await page.locator('input[type="file"]').first().setInputFiles(fixture);
    await page.getByRole('button', { name: 'Convert to PNG' }).click();

    await expect(downloadButton(page, /^Download/)).toBeVisible({ timeout: RESULT_TIMEOUT });

    const saved = await saveDownload(page, /^Download/);
    const meta = await sharp(saved.file).metadata();

    expect(meta.format).toBe('png');
    // The one thing this page exists for. A JPEG route would have made this false.
    expect(meta.hasAlpha).toBe(true);
    expect(meta.width).toBe(320);
    expect(meta.height).toBe(240);

    expect(errors.join('\n')).toBe('');
    expectStayedOnDevice(seen, baseURL);
});

test('resizing a WebP gives back a WebP at the width that was asked for', async ({ page, baseURL }) => {
    test.setTimeout(HEAVY);

    const errors = watchPageErrors(page);
    const seen = watchNetwork(page);
    const fixture = await transparent();

    await page.goto('/resize-webp');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Resize a WebP');

    // The file goes first: an unconfigured panel adopts the source dimensions on
    // intake, so a width typed before the drop is the one it overwrites.
    await page.locator('input[type="file"]').first().setInputFiles(fixture);
    await page.getByLabel('Width (px)', { exact: true }).fill('400');

    await page.getByRole('button', { name: 'Resize image' }).click();
    await expect(downloadButton(page, /^Download/)).toBeVisible({ timeout: RESULT_TIMEOUT });

    const saved = await saveDownload(page, /^Download/);
    const meta = await sharp(saved.file).metadata();

    // No preset on this page, so the format select stays on "Same as the
    // original" — a WebP in has to be a WebP out.
    expect(meta.format).toBe('webp');
    expect(meta.width).toBe(400);

    expect(errors.join('\n')).toBe('');
    expectStayedOnDevice(seen, baseURL);
});

test('the hubs link every expansion page they own', async ({ page }) => {
    const errors = watchPageErrors(page);

    await page.goto('/tools');
    const directory = page.getByRole('main');
    for (const href of ['/signature-resizer', '/change-image-dpi', '/remove-image-metadata']) {
        await expect(directory.locator(`a[href="${href}"]`), `/tools → ${href}`).toHaveCount(1);
    }

    await page.goto('/compress');
    const compress = page.getByRole('main');
    for (const href of ['/compress-image-to-20kb', '/compress-image-to-50kb']) {
        await expect(compress.locator(`a[href="${href}"]`), `/compress → ${href}`).toHaveCount(1);
    }

    await page.goto('/heic');
    await expect(page.getByRole('main').locator('a[href="/heic-to-png"]'), '/heic → /heic-to-png').toHaveCount(1);

    expect(errors.join('\n')).toBe('');
});
