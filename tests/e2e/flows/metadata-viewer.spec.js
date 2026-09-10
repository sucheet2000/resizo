const fs = require('node:fs');

const { test, expect } = require('../fixtures/resizo');
const { metadataFixture } = require('../fixtures/files');

/**
 * The Image Metadata Viewer, driven the way somebody worried about their photo
 * drives it.
 *
 * WHAT MAKES THIS PAGE DIFFERENT FROM EVERY OTHER FLOW IN THIS DIRECTORY. Every
 * other tool here takes a picture and hands one back, and the proof is the file
 * that came out. This one hands back nothing but words — words read out of a
 * stranger's photograph and put on a screen — so the proofs are the other way
 * round: the sentences are the product, and the file must come back unchanged
 * because it was never written to at all.
 *
 * THE EXTRA GUARD, ON TOP OF THE SHARED ONE. ../fixtures/resizo.js already
 * fails any test whose page makes a request that is not a same-origin GET, and
 * that runs here automatically. It is not enough on this page. A viewer could
 * satisfy it completely and still put a visitor's coordinates into a query
 * string on a request to its own origin — an analytics ping, a prefetch, a
 * logged error. So every test below also reads the whole request log itself and
 * asserts that no URL and no body anywhere in it contains the latitude, the
 * longitude, the degrees-and-minutes form of either, the camera model or the
 * image's unique id. That check cannot pass vacuously: it asserts the log is
 * non-empty first, so a listener that was never attached fails rather than
 * reporting a clean sheet.
 *
 * The fixtures are the committed ones under tests/fixtures/metadata/, which is
 * the only place in this repository holding checked-in binaries — their
 * contents are re-verified on every unit run by
 * tests/lib/image-client/metadata-viewer-contract.test.js, and
 * tests/fixtures/metadata/README.md says what is in each of them and why the
 * coordinates are a public landmark rather than anybody's home.
 */
const ROUTE = '/image-metadata-viewer';
const H1 = 'View Image Metadata';

/**
 * Strings that describe where a photograph was taken and what took it. None of
 * these may appear in any request this page makes, in any form.
 *
 * Both the decimal and the degrees-minutes-seconds forms are listed because a
 * page that put the coordinates on the wire would put whichever one it was
 * holding, and they are different strings.
 */
const NEVER_ON_THE_WIRE = [
    '51.477833',
    '51.4778',
    '-0.0015',
    '0.0015',
    '51°28',
    "51 deg 28'",
    'Fixture Camera',
    'RESIZOFIXTURE',
];

/** Every request, with its body, which the shared fixture does not record. */
function watchRequests(page) {
    const seen = [];
    page.on('request', (request) => {
        seen.push({ method: request.method(), url: request.url(), body: request.postData() ?? '' });
    });
    return seen;
}

function expectNothingLeaked(seen) {
    // The self-check first: an empty log proves nothing about what was not sent.
    expect(seen.length, 'no request was recorded — this guard was never watching').toBeGreaterThan(0);

    for (const { method, url, body } of seen) {
        for (const secret of NEVER_ON_THE_WIRE) {
            expect(url, `${method} ${url} carried "${secret}"`).not.toContain(secret);
            expect(body, `the body of ${method} ${url} carried "${secret}"`).not.toContain(secret);
        }
    }
}

const summary = (page) => page.locator('section[aria-labelledby="meta-summary-heading"]');
const privacy = (page) => page.locator('#meta-privacy');

/**
 * The value beside a term in the summary list.
 *
 * Found through the `dl` itself rather than through whatever wrapper the
 * markup uses, so a layout change does not read as a broken tool.
 */
function summaryValue(page, term) {
    return summary(page).locator('dt').filter({ hasText: term }).first()
        .locator('xpath=following-sibling::dd[1]');
}

/* --------------------------------------------------------------- flow one */

test('the sample photo is read on the device and its coordinates are named, not sent', async ({ tool, page }) => {
    const seen = watchRequests(page);

    await tool.open(ROUTE, { h1: H1 });

    // The sample is fetched from this origin like any other static asset, so
    // the no-upload guard has a request to judge and is not vacuous.
    tool.network.processed = true;
    await page.getByRole('button', { name: 'Try the sample photo' }).click();

    const heading = page.getByRole('heading', { name: 'What this file contains' });
    await expect(heading).toBeVisible({ timeout: 30_000 });

    // Focus lands on the summary heading, because the whole page changed under
    // somebody who may not be able to see that it did.
    await expect(heading).toBeFocused();

    await expect(summary(page)).toContainText('JPEG');
    await expect(summary(page)).toContainText('480 × 360');

    // The location row is the one that carries a warning, and the warning is
    // text — a glyph plus a screen-reader word — rather than a colour.
    const gpsRow = summaryValue(page, 'GPS');
    await expect(gpsRow).toContainText('Present — location');
    // textContent rather than innerText: the screen-reader word is visually
    // hidden, which is the point of it.
    expect(await gpsRow.textContent()).toContain('warning');

    await expect(privacy(page).getByRole('heading', { name: 'Location metadata detected' })).toBeVisible();
    await expect(privacy(page)).toContainText('This image contains GPS coordinates.');
    await expect(privacy(page)).toContainText('Metadata that may reveal information about the photo:');

    // The coordinates themselves, on the screen where they belong.
    const location = page.locator('section').filter({ hasText: 'Location (GPS)' }).first();
    await expect(location).toContainText('51.477833');
    await expect(location).toContainText('-0.0015');

    // And the handoff to the tool that takes them out.
    const remove = page.getByRole('link', { name: 'Remove metadata' });
    await expect(remove).toHaveAttribute('href', '/remove-image-metadata');

    expectNothingLeaked(seen);
});

/* --------------------------------------------------------------- flow two */

test('a camera JPEG lists what the camera wrote, orientation in words', async ({ tool, page }) => {
    const seen = watchRequests(page);

    await tool.open(ROUTE, { h1: H1 });
    await tool.pick(metadataFixture('exif-camera.jpg'));

    await expect(page.getByRole('heading', { name: 'What this file contains' })).toBeVisible({ timeout: 30_000 });

    const camera = page.locator('section').filter({ hasText: 'Camera and capture' }).first();
    await expect(camera).toContainText('Resizo');
    await expect(camera).toContainText('Fixture Camera');
    await expect(camera).toContainText('2024-05-01 14:03:22');
    await expect(camera).toContainText('1/250 s');
    await expect(camera).toContainText('f/1.8');
    await expect(camera).toContainText('26 mm');

    // The stored number means nothing to a person; the sentence beside it does.
    await expect(camera).toContainText('Rotate 90° clockwise (stored value 6)');

    // The picture size comes from the image header. This file's EXIF says
    // 4032 × 3024 and the file is 800 × 600 — a viewer that read the tags
    // shows the wrong size and looks entirely plausible doing it.
    await expect(summary(page)).toContainText('800 × 600');
    await expect(summary(page)).not.toContainText('4032 × 3024');

    // One live region for every copy button on the page, so a screen reader
    // hears "Copied" once rather than four times over.
    // Chromium grants clipboard writes only to a page that asked; the fixture's
    // context is fresh, so the permission is granted here, as a visitor's click would.
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.getByRole('button', { name: /^Copy / }).first().click();
    await expect(page.getByRole('status').filter({ hasText: 'Copied' })).toBeVisible();

    expectNothingLeaked(seen);
});

/* ------------------------------------------------------------- flow three */

test('a file with nothing in it says so, and offers nothing to remove', async ({ tool, page }) => {
    const seen = watchRequests(page);

    await tool.open(ROUTE, { h1: H1 });
    await tool.pick(metadataFixture('plain.jpg'));

    await expect(page.getByRole('heading', { name: 'What this file contains' })).toBeVisible({ timeout: 30_000 });

    await expect(privacy(page).getByRole('heading', { name: 'No location metadata detected' })).toBeVisible();
    await expect(privacy(page)).toContainText('No common embedded metadata was found.');

    // The honest ending. A page that offered the remover here would send
    // somebody to a tool that has nothing to do.
    await expect(page.getByText('There is nothing here for Remove Image Metadata to take out.')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Remove metadata' })).toHaveCount(0);

    // The file facts are still there — "no metadata" is not "no report".
    await expect(summary(page)).toContainText('120 × 80');
    await expect(summary(page)).toContainText('JPEG');

    expectNothingLeaked(seen);
});

/* -------------------------------------------------------------- flow four */

test('a PNG named .jpg is called a PNG, and the mismatch is said out loud', async ({ tool, page }) => {
    const seen = watchRequests(page);

    await tool.open(ROUTE, { h1: H1 });
    await tool.pick(metadataFixture('png-as-jpg.jpg'));

    await expect(page.getByRole('heading', { name: 'What this file contains' })).toBeVisible({ timeout: 30_000 });

    const note = page.locator('#meta-extension-note');
    await expect(note).toBeVisible();
    await expect(note).toHaveAttribute('role', 'note');
    await expect(note).toContainText('The file extension does not match the image data');
    await expect(note).toContainText('the name says JPG but the file is a PNG');

    // And the detected format follows the bytes rather than the name.
    await expect(summary(page)).toContainText('PNG');
    await expect(summary(page)).toContainText('100 × 100');

    expectNothingLeaked(seen);
});

/* -------------------------------------------------------------- flow five */

test('an unreadable block costs its own section, and a HEIC is refused by name', async ({ tool, page }) => {
    const seen = watchRequests(page);

    await tool.open(ROUTE, { h1: H1 });
    await tool.pick(metadataFixture('malformed-exif.jpg'));

    await expect(page.getByRole('heading', { name: 'What this file contains' })).toBeVisible({ timeout: 30_000 });

    const problems = page.locator('#meta-problems');
    await expect(problems).toBeVisible();
    await expect(problems).toHaveAttribute('role', 'note');
    await expect(problems).toContainText('Some metadata could not be read.');

    // Everything the broken block did not touch is still on the page: the JFIF
    // beside it, and the picture's own numbers.
    await expect(summary(page)).toContainText('120 × 90');
    await expect(summary(page)).toContainText('72 × 72 DPI');

    // A HEIC is refused by name rather than decoded: libheif never loads here,
    // and the refusal has to be a sentence a person can act on rather than a
    // silent no-op (CLAUDE.md > Gotchas).
    // The drop zone comes back only through the reset, as on the remover.
    await page.getByRole('button', { name: 'Choose another photo' }).click();
    await tool.pick(`${__dirname}/../fixtures/assets/sample-96x64.heic`);
    const error = page.locator('#meta-error');
    await expect(error).toBeVisible();
    await expect(error).toContainText('HEIC');
    await expect(error.getByRole('link').first()).toHaveAttribute('href', '/heic');

    expectNothingLeaked(seen);
});

/* --------------------------------------------------------------- flow six */

test('the advanced panel shows every field, and markup inside one stays text', async ({ tool, page }) => {
    const seen = watchRequests(page);

    // A script that ran would call alert(1), and Playwright dismisses dialogs
    // silently by default — so the dialog is caught rather than left to the
    // console guard, which a successful script logs nothing to.
    const dialogs = [];
    page.on('dialog', (dialog) => {
        dialogs.push(dialog.message());
        dialog.dismiss().catch(() => {});
    });

    await tool.open(ROUTE, { h1: H1 });
    await tool.pick(metadataFixture('xmp.jpg'));

    await expect(page.getByRole('heading', { name: 'What this file contains' })).toBeVisible({ timeout: 30_000 });

    const disclosure = page.locator('#meta-advanced');
    await expect(disclosure).toHaveAttribute('aria-expanded', 'false');
    await expect(disclosure).toHaveAttribute('aria-controls', 'meta-advanced-panel');
    await expect(disclosure).toContainText('All detected fields');

    await disclosure.click();
    await expect(disclosure).toHaveAttribute('aria-expanded', 'true');

    const panel = page.locator('#meta-advanced-panel');
    await expect(panel).toBeVisible();
    await expect(panel).toContainText('XMP');

    // THE ASSERTION THIS FLOW EXISTS FOR. The packet holds an escaped script
    // element, so the decoded value IS `<script>alert(1)</script>` — as a
    // string. It has to reach the page as forty characters somebody can read,
    // and not as a script the page then runs.
    await expect(panel).toContainText('<script>alert(1)</script>');
    expect(await page.locator('#meta-advanced-panel script').count()).toBe(0);
    expect(dialogs, 'a script in the XMP packet ran').toEqual([]);

    // The downloadable report leaves the packet out, so a file somebody
    // forwards does not carry a copy of the whole thing.
    const saved = await tool.download('Download report (JSON)');
    expect(saved.filename).toBe('xmp-metadata.json');
    const report = JSON.parse(fs.readFileSync(saved.file, 'utf8'));
    expect(report.xmp.present).toBe(true);
    expect(report.xmp.packet).toBeUndefined();
    expect(report.raw).toBeUndefined();

    expectNothingLeaked(seen);
});

/* ------------------------------------------------------------- flow seven */

test('the report downloads as JSON without the raw dump, and the page resets', async ({ tool, page }) => {
    const seen = watchRequests(page);

    await tool.open(ROUTE, { h1: H1 });
    await tool.pick(metadataFixture('gps-greenwich.jpg'));

    await expect(page.getByRole('heading', { name: 'What this file contains' })).toBeVisible({ timeout: 30_000 });

    // The number the benchmark reads off this page. An E2E assertion here is
    // what keeps benchmarks/run.js scenario K measuring something real.
    const parseMs = await page.locator('[data-parse-ms]').first().getAttribute('data-parse-ms');
    expect(Number(parseMs)).toBeGreaterThanOrEqual(0);

    await expect(page.getByText('The report includes any location data found in the file.')).toBeVisible();

    const saved = await tool.download('Download report (JSON)');
    expect(saved.filename).toBe('gps-greenwich-metadata.json');

    const report = JSON.parse(fs.readFileSync(saved.file, 'utf8'));
    expect(report.ok).toBe(true);
    expect(report.file.format).toBe('jpeg');
    expect(report.file.width).toBe(480);
    expect(report.gps.latitude).toBeCloseTo(51.477833, 5);
    expect(report.gps.longitude).toBe(-0.0015);

    // The download is the shareable copy, so the whole field dump is left out
    // of it. The XMP packet is left out too, which flow six proves on a file
    // that actually has one.
    expect(report.raw).toBeUndefined();

    // A second file replaces the whole report rather than adding to it, and
    // the disclosure closes with it.
    await page.getByRole('button', { name: 'Choose another photo' }).click();
    await expect(page.locator('#meta-file-browse')).toBeFocused();

    await tool.pick(metadataFixture('plain.jpg'));
    await expect(page.getByRole('heading', { name: 'What this file contains' })).toBeVisible({ timeout: 30_000 });
    await expect(privacy(page)).toContainText('No common embedded metadata was found.');
    await expect(page.locator('#meta-advanced')).toHaveAttribute('aria-expanded', 'false');

    // Nothing about the first photo survived into the second report.
    await expect(summary(page)).not.toContainText('Present — location');

    expectNothingLeaked(seen);
});
