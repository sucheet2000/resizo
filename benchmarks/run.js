#!/usr/bin/env node
/**
 * Resizo's benchmark runner.
 *
 * WHAT MAKES THIS DIFFERENT FROM A SPREADSHEET OF CLAIMS
 *
 * It drives the real pages. Every number below comes from a Chromium that
 * loaded https://…/compress, picked a file through the real file input,
 * pressed the real button and caught the real download — the same selectors
 * tests/e2e/expansion.spec.js uses. Nothing here calls into lib/image-client/
 * directly, because a figure produced by importing the engine would be a claim
 * about a module rather than about the product a visitor uses.
 *
 * WHAT IT REFUSES TO DO
 *
 *  - It does not build, and it does not start a server. A runner that builds
 *    silently measures whatever it happened to build; this one measures what is
 *    already running at BENCH_URL and refuses with instructions if nothing is.
 *  - It does not skip a case that failed. A failure is recorded with the tool's
 *    own message and rendered as a FAILED row, because a benchmark that quietly
 *    drops its losses is worthless.
 *  - It does not invent a number it could not measure. Where a comparison is
 *    impossible — different pixel dimensions, no reference — the field is null
 *    and the reason is written beside it.
 *
 * HOW QUALITY IS MEASURED
 *
 * The downloaded file and the ORIGINAL sample are both decoded with sharp
 * (libvips), then compared with benchmarks/lib/metrics.js. Decoding both sides
 * with the same decoder is the point: the browser's decoder and libvips may
 * round a chroma-upsampled pixel differently, and that difference would
 * otherwise show up as a quality score rather than as what it is.
 *
 * Where the source carries alpha, BOTH sides are composited onto the same
 * background the convert tool uses before either is measured. RGB underneath a
 * fully transparent pixel is undefined and every encoder writes something
 * different there; without compositing, a luma metric reads the invisible half
 * of the image and reports it as quality.
 *
 * Usage:
 *   npm run build && npx next start -p 3910      # terminal one
 *   npm run bench                                # terminal two
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { chromium } = require('@playwright/test');
const sharp = require('sharp');

const { psnr, ssim } = require('./lib/metrics');
const { renderReport, SCHEMA } = require('./lib/report');
const { ALL_SAMPLES, SAMPLES, SAMPLES_DIR } = require('./lib/samples');

/**
 * Scenario E's inputs are the E2E suite's own fixtures — an EXIF+GPS JPEG and a
 * scan-shaped signature PNG, both written by sharp into os.tmpdir(). They are
 * borrowed rather than re-specified so the demo assets are made from the exact
 * files the tests drive those two tools with.
 */
const { exifGpsJpeg, signature } = require('../tests/e2e/fixtures/files');

/**
 * Scenario G's download is an archive rather than an image, so its outputs are
 * read out of the ZIP with the same helper the E2E suite unzips with. Borrowed
 * for the same reason as the fixtures above: one reader, so a run and a test
 * cannot disagree about what "three entries in order" means.
 */
const { readZip } = require('../tests/e2e/helpers/zip');

/**
 * Scenario J's last download is a PDF, which libvips has nothing to say about:
 * its whole physical claim is a page box in points rather than a pixel count.
 * Borrowed from the E2E suite for the same reason readZip is — one reader, so a
 * run and a test cannot disagree about what "one page, 288 × 432 pt" means.
 */
const { readPdf } = require('../tests/e2e/helpers/pdf');

/**
 * Scenario K reads committed files rather than generated ones. The metadata
 * viewer's whole output is a description of what a file contains, so a source
 * regenerated per run would move the thing being measured — see
 * tests/fixtures/metadata/README.md. Borrowed through the same accessor the
 * E2E flows use, so a run and a test cannot disagree about which bytes were
 * inspected.
 */
const { metadataFixture } = require('../tests/e2e/fixtures/files');

/**
 * Scenario L's small source is the E2E suite's own 128 px mark, borrowed for
 * the same reason scenario E borrows its two: the figure on the page and the
 * picture the tests drive that tool with should be one file. Its big source is
 * `public/samples/logo-mark-640x400.png`, which is the file the page's own
 * "Try the sample logo" button fetches — so the benchmark measures the picture
 * a visitor can try in one click.
 */
const { lowResLogo } = require('../tests/e2e/fixtures/files');

/**
 * Scenario L's most interesting download is not an image format: favicon.ico is
 * a directory of offsets with PNGs behind it. It is read with the same parser
 * the E2E suite uses — written from Microsoft's own structure and never from
 * the engine's writer — so a run and a test cannot disagree about what "three
 * entries, none overlapping" means.
 */
const { assertPngIco } = require('../tests/helpers/ico');

const ROOT = path.join(__dirname, '..');
const OUTPUT_DIR = path.join(__dirname, 'outputs');
const RESULTS_DIR = path.join(__dirname, 'results');

const BASE_URL = (process.env.BENCH_URL || 'http://127.0.0.1:3910').replace(/\/$/, '');

/** A compress-to-target search runs up to eight full encodes, plus a WASM fetch. */
const RESULT_TIMEOUT = 90_000;
const NAV_TIMEOUT = 30_000;
const READY_TIMEOUT = 30_000;

/** One attempt at a file pick, of three. Short, because a retry is cheaper. */
const PICK_TIMEOUT = 12_000;

/** Ceiling on any single Playwright action. Bounds a wait; measures nothing. */
const ACTION_TIMEOUT = 60_000;

/** The 1200 px lane in scenario C, and the reference both lanes are scored on. */
const RESIZE_WIDTH = 1200;

const sampleByName = (name) => ALL_SAMPLES.find((entry) => entry.file === name);
const samplePath = (name) => path.join(SAMPLES_DIR, name);

const slug = (text) => String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/* ------------------------------------------------------------------ *
 * Environment
 * ------------------------------------------------------------------ */

/**
 * The commit, read out of .git by hand.
 *
 * No child process: this runs in an agent-driven repo where running git is not
 * always allowed, and .git/HEAD is a text file with a documented format.
 */
function readCommit() {
    const gitDir = path.join(ROOT, '.git');

    try {
        const head = fs.readFileSync(path.join(gitDir, 'HEAD'), 'utf8').trim();
        if (!head.startsWith('ref:')) return { commit: head, branch: null };

        const ref = head.slice(4).trim();
        const branch = ref.replace(/^refs\/heads\//, '');
        const direct = path.join(gitDir, ...ref.split('/'));

        if (fs.existsSync(direct)) return { commit: fs.readFileSync(direct, 'utf8').trim(), branch };

        const packed = path.join(gitDir, 'packed-refs');
        if (fs.existsSync(packed)) {
            for (const line of fs.readFileSync(packed, 'utf8').split('\n')) {
                const [sha, name] = line.trim().split(' ');
                if (name === ref) return { commit: sha, branch };
            }
        }

        return { commit: null, branch };
    } catch {
        return { commit: null, branch: null };
    }
}

/**
 * The id of the build the server is serving, read from .next/BUILD_ID.
 *
 * A rebuild landing in .next while `next start` is serving out of it swaps the
 * chunks under a running page: routes half-render, hydration never completes,
 * and a benchmark carries on recording the wreckage as if it were a
 * measurement. That happened here — an unrelated build mid-run turned two
 * cases into timeouts — so the id is recorded before and after and a run that
 * straddles a rebuild says so instead of publishing the numbers.
 *
 * Local only: it is null when BENCH_URL points somewhere without this tree.
 */
function buildId() {
    try {
        return fs.readFileSync(path.join(ROOT, '.next', 'BUILD_ID'), 'utf8').trim();
    } catch {
        return null;
    }
}

function environment(browser) {
    const { commit, branch } = readCommit();
    const cpus = os.cpus();

    return {
        commit,
        branch,
        buildId: buildId(),
        baseUrl: BASE_URL,
        chromium: browser.version(),
        node: process.version,
        os: `${os.platform()} ${os.release()}`,
        arch: os.arch(),
        cpu: cpus[0]?.model ?? null,
        cores: cpus.length,
        memoryGb: Math.round(os.totalmem() / 1024 ** 3),
        // Recorded because wallMs is the one figure here that a busy machine
        // can move. Bytes, pixels, PSNR and SSIM are deterministic for a given
        // build; a run at load 50 on ten cores reports honest sizes and
        // inflated times, and the reader deserves to be able to tell.
        loadAtStart: os.loadavg().map((value) => Number(value.toFixed(2))),
    };
}

/**
 * Refuses to run against nothing.
 *
 * The alternative — starting a server here — would mean the benchmark measured
 * a build it made itself, which is how a benchmark ends up reporting on code
 * nobody shipped.
 */
async function requireServer() {
    const timeout = AbortSignal.timeout(5000);

    try {
        const response = await fetch(`${BASE_URL}/compress`, { signal: timeout });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
    } catch (error) {
        process.stderr.write(
            `\nNo Resizo server answering at ${BASE_URL} (${error.message}).\n\n`
            + 'This runner measures a running production build and will not start one.\n'
            + 'In another terminal:\n\n'
            + '    npm run build\n'
            + '    npx next start -p 3910\n\n'
            + 'Then run `npm run bench` again, or set BENCH_URL to point somewhere else.\n\n',
        );
        process.exit(1);
    }
}

/* ------------------------------------------------------------------ *
 * Driving the real UI
 * ------------------------------------------------------------------ */

const downloadButton = (page, name) => page.getByRole('button', { name }).or(page.getByRole('link', { name }));

/** blob: and data: are the visitor's own bytes handed back to their own tab. */
function offDevice(requests) {
    return requests
        .filter(({ method, url }) => {
            if (url.startsWith('blob:') || url.startsWith('data:')) return false;
            return method !== 'GET' || !(url === BASE_URL || url.startsWith(`${BASE_URL}/`));
        })
        .map(({ method, url }) => `${method} ${url}`);
}

async function withPage(browser, work) {
    const context = await browser.newContext({ acceptDownloads: true });

    // Playwright's 30 s default is generous on an idle laptop and too short on
    // a machine already running something else: a starved renderer misses it
    // and the run records a product failure that was really a busy CPU.
    context.setDefaultTimeout(ACTION_TIMEOUT);

    const page = await context.newPage();

    const pageErrors = [];
    const requests = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('request', (request) => requests.push({ method: request.method(), url: request.url() }));

    try {
        return await work(page, { pageErrors, requests });
    } finally {
        await context.close();
    }
}

/**
 * Every page here is server-rendered, so the whole form — file input included —
 * is in the HTML long before React has attached a handler to any of it. A file
 * set into the input during that window is dropped on the floor: no error, no
 * event, and a submit button that stays disabled forever. Waiting for the
 * hydration root closes most of that window; `pickFile` covers the rest.
 */
async function waitForHydration(page) {
    await page
        .waitForFunction(
            () => Object.keys(document).some((key) => key.startsWith('__reactContainer$')),
            undefined,
            { timeout: NAV_TIMEOUT },
        )
        .catch(() => {});
}

async function open(page, route) {
    await page.goto(`${BASE_URL}${route}`, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });
    await page.getByRole('heading', { level: 1 }).first().waitFor({ state: 'visible', timeout: NAV_TIMEOUT });
    await waitForHydration(page);
}

/**
 * Waits for the submit button to become pressable.
 *
 * Every tool measures the file before it will accept a job — dimensions first,
 * because the memory gate has to cost the work before anything decodes — so a
 * click fired the instant the input is set lands on a disabled button.
 */
async function waitForAction(page, label, timeout = READY_TIMEOUT) {
    await page.waitForFunction(
        (text) => {
            const button = [...document.querySelectorAll('button')]
                .find((element) => (element.textContent || '').includes(text));
            return Boolean(button) && !button.disabled;
        },
        label,
        { timeout },
    );
}

/**
 * Hands the tool a file and waits until it will accept the job.
 *
 * Retries the pick rather than only the wait: the failure this guards against
 * is a selection that never registered, and waiting longer for an event that
 * was never going to fire is how a benchmark spends thirty seconds to record a
 * failure that was its own fault. Re-picking is harmless — every tool treats a
 * second selection as a fresh one.
 */
async function pickFile(page, file, action) {
    const attempts = 3;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
        await page.locator('input[type="file"]').first().setInputFiles(file);

        try {
            await waitForAction(page, action, PICK_TIMEOUT);
            return;
        } catch (error) {
            if (attempt === attempts) {
                const said = await panelError(page);
                throw new Error(
                    said || `"${action}" never became pressable after ${attempts} file picks (${error.message})`,
                );
            }
        }
    }
}

/** Whatever the page is complaining about, in its own words. */
async function panelError(page) {
    const alerts = await page.getByRole('alert').allInnerTexts();
    const text = alerts.map((line) => line.replace(/\s+/g, ' ').trim()).filter(Boolean).join(' / ');
    return text || null;
}

/**
 * One measured operation: press the button, wait for the result, save the file.
 *
 * `wallMs` is the click to the moment the download affordance is on screen —
 * the span a person actually waits — and deliberately excludes the page load
 * and the file pick, which are not what any tool is being measured on.
 */
async function measure(page, { action, download, outFile }) {
    const started = Date.now();
    await page.getByRole('button', { name: action }).first().click();

    const button = downloadButton(page, download).first();

    try {
        await button.waitFor({ state: 'visible', timeout: RESULT_TIMEOUT });
    } catch (error) {
        const said = await panelError(page);
        throw new Error(said || `no result within ${RESULT_TIMEOUT} ms (${error.message})`);
    }

    const wallMs = Date.now() - started;

    // The footnote, not the whole region. ResultPanel's own children carry the
    // byte pair and the file name, which are read off the file itself further
    // down — quoting them back would put the panel's rounding into a column
    // whose neighbour holds the measured value.
    const region = page.getByRole('status').filter({ has: downloadButton(page, download) }).first();
    const footnote = region.locator('> p');
    const source = (await footnote.count()) > 0 ? footnote.last() : region;
    const panel = (await source.innerText()).replace(/\s+/g, ' ').trim();

    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    const [saved] = await Promise.all([page.waitForEvent('download'), button.click()]);
    await saved.saveAs(outFile);

    return { wallMs, panel, file: outFile, filename: saved.suggestedFilename() };
}

/* ------------------------------------------------------------------ *
 * Reading the files back
 * ------------------------------------------------------------------ */

async function describe(file) {
    const meta = await sharp(file).metadata();
    return {
        bytes: fs.statSync(file).size,
        width: meta.width,
        height: meta.height,
        format: meta.format,
        density: meta.density ?? null,
        hasAlpha: Boolean(meta.hasAlpha),
    };
}

/**
 * The top-left pixel, as RGBA.
 *
 * The one measurement that says what a flatten actually did. "hasAlpha: false"
 * only proves the alpha channel is gone; it says nothing about what took its
 * place, and a page claiming a transparent corner came back white needs the
 * three numbers rather than the absence of a fourth. A corner is used because
 * it is the part of the frame the shapes never reach, so it is transparent in
 * the source by construction rather than by luck.
 */
async function cornerPixel(file) {
    const { data } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    return { r: data[0], g: data[1], b: data[2], a: data[3] };
}

/** RGBA pixels, optionally flattened and/or resampled to a fixed geometry. */
async function pixels(file, { flatten = null, width = null, height = null } = {}) {
    let pipeline = sharp(file);
    if (flatten) pipeline = pipeline.flatten({ background: flatten });
    if (width && height) pipeline = pipeline.resize({ width, height, fit: 'fill' });

    const { data, info } = await pipeline.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    return { data, width: info.width, height: info.height };
}

/**
 * PSNR and SSIM, or a null pair and the reason why.
 *
 * A score is only meaningful between images of one geometry, and the honest
 * answer when they differ is nothing at all rather than a number produced by a
 * resample nobody asked for.
 */
async function score(referenceFile, outputFile, options = {}) {
    try {
        const reference = await pixels(referenceFile, options.reference ?? {});
        const output = await pixels(outputFile, options.output ?? {});

        if (reference.width !== output.width || reference.height !== output.height) {
            return {
                psnr: null,
                ssim: null,
                note: `not scored: ${output.width}×${output.height} output against a `
                    + `${reference.width}×${reference.height} reference`,
            };
        }

        return { psnr: psnr(reference, output), ssim: ssim(reference, output), note: options.note ?? null };
    } catch (error) {
        return { psnr: null, ssim: null, note: `not scored: ${error.message}` };
    }
}

/** The panel prints "at quality 62" only when a quality was actually applied. */
const reportedQuality = (panel) => {
    const found = /quality (\d+)/i.exec(panel || '');
    return found ? Number(found[1]) : null;
};

/* ------------------------------------------------------------------ *
 * The tools, each driven the way the E2E suite drives it
 * ------------------------------------------------------------------ */

const LABELS = { jpeg: 'JPEG', png: 'PNG', webp: 'WebP' };

/**
 * The output format is chosen BEFORE the file goes in, because the submit
 * button is named after it — "Convert to WebP" — and waiting for a button
 * called after the format you have not selected yet waits forever.
 */
async function convert(page, { file, to, outFile }) {
    await open(page, '/convert');
    await page.selectOption('#convert-to', to);
    await pickFile(page, file, `Convert to ${LABELS[to]}`);

    return measure(page, {
        action: `Convert to ${LABELS[to]}`,
        download: `Download ${LABELS[to]}`,
        outFile,
    });
}

/**
 * The converter on a locked-pair intent route — /png-to-jpg and its siblings.
 *
 * Not a variant of `convert` above: there is no `#convert-to` select on these
 * pages, because the pair is already decided by the registry entry, and the
 * transparency control is present from the first paint rather than after a
 * file is picked. So the background is chosen BEFORE the pick, which is also
 * the order a visitor meets the two controls in.
 *
 * The radio is checked explicitly even when it is already the default. A
 * benchmark that relies on a default is a benchmark whose numbers move the day
 * somebody changes one, silently and in the direction nobody looked.
 */
async function convertPair(page, { route, to, background, file, outFile }) {
    await open(page, route);
    await page.getByRole('radio', { name: background, exact: true }).check();
    await pickFile(page, file, `Convert to ${LABELS[to]}`);

    return measure(page, {
        action: `Convert to ${LABELS[to]}`,
        download: `Download ${LABELS[to]}`,
        outFile,
    });
}

async function compressToTarget(page, { file, targetKb, policy = 'keep', route = '/compress', outFile }) {
    await open(page, route);
    await pickFile(page, file, 'Compress image');

    await page.getByRole('radio', { name: 'To a target size' }).check();
    await page.locator('#compress-target').fill(String(targetKb));
    await page.getByRole('radio', {
        name: policy === 'fit' ? 'Shrink to fit' : 'Keep the dimensions',
    }).check();

    return measure(page, { action: 'Compress image', download: 'Download compressed image', outFile });
}

async function resizeToWidth(page, { file, width, outFile }) {
    await open(page, '/resize');
    await pickFile(page, file, 'Resize image');
    await page.locator('#resize-width').fill(String(width));

    return measure(page, { action: 'Resize image', download: 'Download image', outFile });
}

async function setDpi(page, { file, dpi, outFile }) {
    await open(page, '/change-image-dpi');
    await pickFile(page, file, 'Set DPI');
    await page.getByLabel('New DPI').fill(String(dpi));

    return measure(page, { action: 'Set DPI', download: 'Download image', outFile });
}

async function crop(page, { file, rect, outFile }) {
    await open(page, '/crop');
    await pickFile(page, file, 'Crop image');

    for (const key of ['x', 'y', 'width', 'height']) {
        await page.locator(`#crop-${key}`).fill(String(rect[key]));
    }

    return measure(page, { action: 'Crop image', download: 'Download cropped image', outFile });
}

async function makeSignature(page, { file, width, height, maxKb, outFile }) {
    await open(page, '/signature-resizer');
    await page.getByLabel('Width (px)', { exact: true }).fill(String(width));
    await page.getByLabel('Height (px)', { exact: true }).fill(String(height));
    await page.getByLabel('Maximum file size (KB)').fill(String(maxKb));
    await pickFile(page, file, 'Make signature');

    return measure(page, { action: 'Make signature', download: 'Download signature', outFile });
}

async function stripMetadata(page, { file, outFile }) {
    await open(page, '/remove-image-metadata');
    await pickFile(page, file, 'Remove metadata');

    return measure(page, { action: 'Remove metadata', download: 'Download clean image', outFile });
}

/**
 * The requirement fitter, driven by its chip rather than by its fields.
 *
 * The preset is chosen BEFORE the file goes in, for the same reason /convert's
 * output format is: nothing on this page can be submitted until it knows the
 * target size, so a pick that lands first waits on a button that is still
 * disabled. Choosing the chip is also the honest measurement — it is the path
 * the page is built around, and it makes the pixel count the arithmetic's
 * output rather than a number this file typed and the page then agreed with.
 */
/**
 * The metadata viewer, which is the one tool here with no action button.
 *
 * Every other driver in this file picks a file and then presses something; this
 * page has nothing to press — the report appears on intake, because the work is
 * a walk over the file's own bytes and not a job. So `wallMs` is measured from
 * the moment the file goes in to the moment the summary heading is on screen,
 * which is the whole of what a person waits for here.
 *
 * `parseMs` is the page's own measurement of the parse alone, read off the
 * report root's `data-parse-ms`. The two are worth having side by side: the
 * gap between them is React rendering several hundred rows, and on the files
 * with the most metadata that gap is the larger half.
 */
async function inspectImageMetadata(page, { file, outFile }) {
    await open(page, '/image-metadata-viewer');

    const started = Date.now();
    await page.locator('input[type="file"]').first().setInputFiles(file);

    const heading = page.getByRole('heading', { name: 'What this file contains' });
    try {
        await heading.waitFor({ state: 'visible', timeout: RESULT_TIMEOUT });
    } catch (error) {
        const said = await panelError(page);
        throw new Error(said || `no report within ${RESULT_TIMEOUT} ms (${error.message})`);
    }
    const wallMs = Date.now() - started;

    const parseMs = Number(await page.locator('[data-parse-ms]').first().getAttribute('data-parse-ms'));

    // The report is read out of the downloaded JSON rather than off the screen.
    // A row scraped from the page would be measuring the markup; the file is
    // what the tool actually produced, and it is the same artefact a visitor
    // keeps.
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    const button = downloadButton(page, 'Download report (JSON)').first();
    const [saved] = await Promise.all([page.waitForEvent('download'), button.click()]);
    await saved.saveAs(outFile);

    const report = JSON.parse(fs.readFileSync(outFile, 'utf8'));

    return {
        wallMs,
        parseMs: Number.isFinite(parseMs) ? parseMs : null,
        report,
        categories: report.privacy.categories.filter((entry) => entry.present).map((entry) => entry.id),
        file: outFile,
    };
}

async function makePassportPhoto(page, { file, preset, outFile }) {
    await open(page, '/passport-photo');
    await page.getByRole('button', { name: preset }).first().click();
    await pickFile(page, file, 'Make photo');

    return measure(page, { action: 'Make photo', download: 'Download photo', outFile });
}

/* ------------------------------------------------------------------ *
 * The image size fitter, which is the passport tool's engine with none
 * of its presets: every number here is typed, the way a stranger's
 * upload form states them
 * ------------------------------------------------------------------ */

const FIT_FORMAT_LABELS = { jpeg: 'JPEG', png: 'PNG', webp: 'WebP' };

/**
 * Substrings, not whole labels: the shared fieldset renders "Crop to fill
 * (recommended)" and "Fit inside, padded", and a runner that typed either in
 * full would break the day the parenthesis moves without the behaviour moving.
 */
const FIT_GEOMETRY_LABELS = { cover: 'Crop to fill', contain: 'Fit inside', stretch: 'Stretch' };

/**
 * The advanced half, opened once and only if it is shut. Pressed blindly it is
 * a toggle, and a second press would close the drawer the next line fills.
 */
async function openFitAdvanced(page) {
    const toggle = page.locator('#fit-advanced');
    if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
    await page.locator('#fit-advanced-panel').waitFor({ state: 'visible', timeout: READY_TIMEOUT });
}

/**
 * Types a requirement into the form.
 *
 * THE FORMAT RADIO IS ALWAYS SET, even to the value it already holds — the same
 * rule convertPair follows above, and for the same reason: a benchmark that
 * leans on a default is a benchmark whose numbers move the day somebody changes
 * one, silently and in the direction nobody looked.
 *
 * The unit, the DPI, the minimum and the fill behaviour are set only when they
 * differ from the page's own defaults, because reaching them means opening a
 * disclosure a visitor with a simple requirement never opens, and the run
 * should measure the path that is actually taken. The resolved values are
 * recorded in each case's `settings` regardless, so the results file states
 * what was asked for rather than leaving it to be inferred.
 */
async function setFitRequirement(page, settings) {
    const {
        width, height, unit, dpi, format, maxKb, minKb, geometry,
    } = settings;

    if (unit !== 'px' || dpi !== null || minKb !== null || geometry !== 'cover') {
        await openFitAdvanced(page);
    }

    if (unit !== 'px') await page.getByLabel('Unit', { exact: true }).selectOption(unit);
    // The size labels carry the unit once it is not pixels — "Width (mm)" —
    // so the match allows for the suffix without accepting "Width of paper".
    await page.getByLabel(/^Width( \([a-z]+\))?$/).fill(String(width));
    await page.getByLabel(/^Height( \([a-z]+\))?$/).fill(String(height));
    if (dpi !== null) await page.getByLabel(/^DPI/).fill(String(dpi));
    if (geometry !== 'cover') {
        await page.getByRole('radio', { name: FIT_GEOMETRY_LABELS[geometry] }).check();
    }

    await page.getByRole('radio', { name: FIT_FORMAT_LABELS[format], exact: true }).check();

    if (maxKb !== null) await page.getByLabel('Maximum file size (KB)').fill(String(maxKb));
    if (minKb !== null) await page.getByLabel('Minimum file size (KB)').fill(String(minKb));
}

async function fitImage(page, { file, settings, outFile }) {
    await open(page, '/image-size-fitter');
    await setFitRequirement(page, settings);
    await pickFile(page, file, 'Fit image');

    return measure(page, { action: 'Fit image', download: 'Download image', outFile });
}

/**
 * The same page, driven at a requirement no encoder can meet.
 *
 * A refusal is this tool's correct answer to an impossible ceiling, so `measure`
 * is wrong here twice over: it waits for a download that must never appear, and
 * it would record the refusal as a timeout — a product failure that was really
 * the product working. This one waits for whichever arrives first and treats a
 * DOWNLOAD as the failure, because a file under a ceiling nothing can reach can
 * only mean the search spent pixels it was told not to spend.
 */
async function refuseToFit(page, { file, settings }) {
    await open(page, '/image-size-fitter');
    await setFitRequirement(page, settings);
    await pickFile(page, file, 'Fit image');

    const started = Date.now();
    await page.getByRole('button', { name: 'Fit image' }).first().click();

    const refusal = page.locator('#fit-recovery');
    const download = downloadButton(page, 'Download image').first();

    await Promise.race([
        refusal.waitFor({ state: 'visible', timeout: RESULT_TIMEOUT }).catch(() => {}),
        download.waitFor({ state: 'visible', timeout: RESULT_TIMEOUT }).catch(() => {}),
    ]);

    const wallMs = Date.now() - started;

    if (await download.isVisible()) {
        throw new Error(
            'a file was offered for a ceiling no encoder can reach — either the requirement is not '
            + 'impossible after all, or the search met it by handing back a smaller picture',
        );
    }

    const said = await panelError(page);
    if (!said) throw new Error(`neither a refusal nor a result within ${RESULT_TIMEOUT} ms`);

    return { wallMs, said };
}

/**
 * The requirement summary as a person reads it: the row's name, what was asked
 * for, what the file actually is, and the word that says whether they agree.
 *
 * It is the product's own verdict on its own output, so it is recorded BESIDE
 * the libvips reading rather than instead of it — the two disagreeing is the
 * single most interesting thing this scenario can find.
 */
function readRequirementSummary(page) {
    return page.evaluate(() => {
        const heading = [...document.querySelectorAll('h3')]
            .find((element) => (element.textContent || '').startsWith('What was checked'));
        const list = heading?.parentElement?.querySelector('dl');
        if (!list) return [];

        return [...list.querySelectorAll(':scope > div')].map((row) => {
            // The direct spans' own text nodes only, so the sr-only column
            // names a screen reader hears ("required", "actual") stay out.
            const cells = [...row.querySelectorAll(':scope > dd > span')].map((cell) => [...cell.childNodes]
                .filter((node) => node.nodeType === Node.TEXT_NODE)
                .map((node) => node.textContent)
                .join('')
                .trim());
            return {
                label: row.querySelector('dt')?.textContent.trim() ?? '',
                required: cells[0] ?? '',
                actual: cells[1] ?? '',
                status: cells[2] ?? '',
            };
        });
    });
}

/* ------------------------------------------------------------------ *
 * The bulk page, which measures differently from every tool above
 * ------------------------------------------------------------------ */

const BULK_ROUTE = '/bulk-image-compressor';

/**
 * The largest batch the page accepts.
 *
 * It mirrors MAX_BULK_FILES in lib/limits.js and cannot import it: that module
 * is ES modules under a `.js` extension in a CommonJS package, so `require`
 * would be a syntax error and `await import()` would read it as CommonJS. If
 * the cap in lib/limits.js moves, this number has to move with it — which is
 * why the 20-file case states the cap it is standing on in its own note rather
 * than leaving a bare 20 in a table.
 */
const BULK_FILE_CAP = 20;

/**
 * Peak JavaScript heap on the MAIN THREAD, sampled while a batch runs.
 *
 * Two caveats, and they are the whole reason this is reported as a number with
 * a name rather than as "memory used":
 *
 *  1. `performance.memory` is Chromium's and nobody else's. Outside it the
 *     field is null rather than zero, because a missing measurement and a
 *     measurement of nothing are different facts.
 *  2. It sees the main thread's isolate only. The codecs run in a worker, and
 *     that worker's heap — where the decoded pixels actually live — is NOT in
 *     this figure. What this does catch is the thing a bulk page can get wrong
 *     on its own: holding every result blob and every preview in page state
 *     until the batch ends, which is a leak the queue owns rather than the
 *     codec.
 */
async function startHeapSampler(page, intervalMs = 250) {
    await page.evaluate((ms) => {
        window.__resizoHeap = { peak: 0, samples: 0, supported: Boolean(performance.memory) };
        if (!window.__resizoHeap.supported) return;

        window.__resizoHeapTimer = window.setInterval(() => {
            const used = performance.memory.usedJSHeapSize;
            if (used > window.__resizoHeap.peak) window.__resizoHeap.peak = used;
            window.__resizoHeap.samples += 1;
        }, ms);
    }, intervalMs);
}

/** Stops the sampler and reports the peak, or null where it could not measure. */
async function stopHeapSampler(page) {
    const report = await page.evaluate(() => {
        if (window.__resizoHeapTimer) window.clearInterval(window.__resizoHeapTimer);
        return window.__resizoHeap ?? null;
    });

    if (!report || !report.supported || report.samples === 0) {
        return { peakJsHeapBytes: null, heapSamples: report ? report.samples : 0 };
    }

    return { peakJsHeapBytes: report.peak, heapSamples: report.samples };
}

/** The batch summary as the page states it: { Selected: '4', Successful: '4', … }. */
function readBatchSummary(page) {
    return page.evaluate(() => {
        const section = document.querySelector('section[aria-labelledby="bulk-compress-summary-heading"]');
        if (!section) return null;

        const pairs = {};
        for (const term of section.querySelectorAll('dt')) {
            const value = term.nextElementSibling;
            if (value) pairs[term.textContent.trim()] = value.textContent.trim();
        }
        return pairs;
    });
}

/** One count out of that summary, as a number, or null when it is not there. */
function summaryCount(summary, label) {
    if (!summary || typeof summary[label] !== 'string') return null;
    const found = /-?\d+/.exec(summary[label].replace(/,/g, ''));
    return found ? Number(found[0]) : null;
}

const bulkRow = (page, name) => page.locator(`ul[aria-label="Results"] > li[data-name="${name}"]`);

/**
 * A whole batch, from an empty page to a finished queue.
 *
 * `durationMs` is the press of Compress to the moment the archive button is on
 * screen — every file, in order, plus the ZIP the tab assembles at the end.
 * That is the span a person waits, and it is the only figure on this page that
 * a per-file measurement cannot produce.
 */
async function runBulkBatch(page, { files, targetKb, mode = 'fit', timeout }) {
    await open(page, BULK_ROUTE);

    await page.getByRole('radio', {
        name: mode === 'fit' ? 'Fit under limit' : 'Preserve dimensions',
    }).check();
    await page.getByLabel('Custom limit (KB)').fill(String(targetKb));

    // pickFile takes the array straight through: one input, many files, and the
    // same retry it gives every other tool for a selection that never landed.
    const action = `Compress ${files.length} image`;
    await pickFile(page, files, action);

    await startHeapSampler(page);

    const started = Date.now();
    await page.getByRole('button', { name: `Compress ${files.length} image` }).first().click();

    const zip = downloadButton(page, /Download all as ZIP \(\d+\)/).first();

    try {
        await zip.waitFor({ state: 'visible', timeout });
    } catch (error) {
        const said = await panelError(page);
        throw new Error(said || `the batch produced no archive within ${timeout} ms (${error.message})`);
    }

    const durationMs = Date.now() - started;
    const heap = await stopHeapSampler(page);
    const summary = await readBatchSummary(page);

    return { durationMs, summary, zip, ...heap };
}

/** Saves the archive the batch produced. */
async function saveBulkZip(page, zip, outFile) {
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    const [saved] = await Promise.all([page.waitForEvent('download'), zip.click()]);
    await saved.saveAs(outFile);
    return outFile;
}

/**
 * Saves one row's own file — the download somebody who wanted only that one
 * would press. A row that did not succeed throws with the page's own sentence,
 * because a benchmark that recorded a zero here would be recording a refusal
 * as a measurement.
 */
async function saveBulkRow(page, name, outFile) {
    const row = bulkRow(page, name);
    const status = await row.getAttribute('data-status');
    const said = (await row.innerText()).replace(/\s+/g, ' ').trim();

    if (status !== 'success') {
        throw new Error(`${name} came back "${status}": ${said}`);
    }

    // A file already under the ceiling is handed back at its size with only
    // its metadata removed; the row says so. Recorded from the page's own
    // words, because a byte comparison cannot tell a kept file from a
    // re-encode that happened to land close.
    const kept = /kept at its size/.test(said);

    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    const button = row.getByRole('button', { name: /^Download .+-compressed\./ }).first();
    const [saved] = await Promise.all([page.waitForEvent('download'), button.click()]);
    await saved.saveAs(outFile);

    return { file: outFile, filename: saved.suggestedFilename(), kept };
}

/**
 * N copies of one small JPEG, written into this run's own output directory.
 *
 * They are inputs to a timing measurement rather than evidence, so they are
 * never committed — benchmarks/outputs/ is already ignored — and they are
 * IDENTICAL copies on purpose: the 5-file row and the 20-file row differ by
 * the file count and by nothing else, which is the only way the pair says
 * anything about how a batch scales.
 *
 * 640×480 of gaussian noise at quality 80 lands around 86 KB — measured over
 * three draws at 85.6, 85.8 and 86.0 KB, so the 100 KB the small cases are
 * specified at has real headroom — and re-encodes to roughly 24 KB at quality
 * 50, which means each file is genuine encoding work against the 50 KB ceiling
 * rather than a file that was already under it and measures only intake.
 */
async function writeSmallBatch(dir, count) {
    fs.mkdirSync(dir, { recursive: true });

    const body = await sharp({
        create: {
            width: 640,
            height: 480,
            channels: 3,
            background: '#7a8b99',
            noise: { type: 'gaussian', mean: 128, sigma: 20 },
        },
    })
        .jpeg({ quality: 80, chromaSubsampling: '4:2:0' })
        .toBuffer();

    const files = [];
    for (let index = 1; index <= count; index += 1) {
        const file = path.join(dir, `bulk-small-${String(index).padStart(2, '0')}.jpg`);
        fs.writeFileSync(file, body);
        files.push(file);
    }

    return files;
}

/* ------------------------------------------------------------------ *
 * The bulk converter, which is the same platform with a different job
 * ------------------------------------------------------------------ */

const BULK_CONVERT_ROUTE = '/bulk-image-converter';

/** The chip each output format is chosen by. The page speaks JPG, not JPEG. */
const CONVERT_CHIPS = { jpeg: 'JPG', png: 'PNG', webp: 'WebP' };

/** The converter's own summary, read the way the compressor's is. */
function readConvertSummary(page) {
    return page.evaluate(() => {
        const section = document.querySelector('section[aria-labelledby="bulk-convert-summary-heading"]');
        if (!section) return null;

        const pairs = {};
        for (const term of section.querySelectorAll('dt')) {
            const value = term.nextElementSibling;
            if (value) pairs[term.textContent.trim()] = value.textContent.trim();
        }
        return pairs;
    });
}

/**
 * A whole conversion batch, from an empty page to a finished queue.
 *
 * THE ORDER OF THE TWO CONTROLS IS NOT ARBITRARY. The output format is chosen
 * BEFORE the files, because the submit button is not named after it and the
 * chips are painted from the first render — a file lands already configured,
 * which is the order the page is built around. The background is chosen AFTER
 * them, because the control only exists once the page can see that something
 * selected might carry an alpha channel; asking for it first waits on a
 * control the page has no reason to render yet.
 *
 * The chip is confirmed rather than pressed when it is already active:
 * PresetChips reads a press on the active chip as "unselect", so pressing WebP
 * — the page's default — would clear the output format instead of setting it,
 * and the run that followed would measure whatever the page fell back to.
 *
 * The background IS pressed even when it is already the default, for the same
 * reason convertPair does it: a benchmark that leans on a default is one whose
 * numbers move the day somebody changes one, silently.
 */
async function runBulkConvert(page, { files, format, background = null, timeout }) {
    await open(page, BULK_CONVERT_ROUTE);

    const chip = page
        .getByRole('group', { name: 'Output format' })
        .getByRole('button', { name: CONVERT_CHIPS[format] });

    if ((await chip.getAttribute('aria-pressed')) !== 'true') await chip.click();

    // pickFile takes the array straight through: one input, many files, and the
    // same retry it gives every other tool for a selection that never landed.
    const action = `Convert ${files.length} image`;
    await pickFile(page, files, action);

    if (background) await page.getByRole('radio', { name: background, exact: true }).check();

    await startHeapSampler(page);

    const started = Date.now();
    await page.getByRole('button', { name: action }).first().click();

    const zip = downloadButton(page, /Download all as ZIP \(\d+\)/).first();

    try {
        await zip.waitFor({ state: 'visible', timeout });
    } catch (error) {
        const said = await panelError(page);
        throw new Error(said || `the batch produced no archive within ${timeout} ms (${error.message})`);
    }

    const durationMs = Date.now() - started;
    const heap = await stopHeapSampler(page);
    const summary = await readConvertSummary(page);

    return { durationMs, summary, zip, ...heap };
}

/**
 * Saves one converted row's own file.
 *
 * A row that did not succeed throws with the page's own sentence, because a
 * benchmark that recorded a zero here would be recording a refusal as a
 * measurement. `kept` is read from the row's words rather than from the bytes:
 * a file already in the output format is handed back untouched, and a
 * re-encode that happened to land on a similar size is not something a byte
 * comparison can tell apart from that.
 */
async function saveConvertRow(page, name, outFile) {
    const row = bulkRow(page, name);
    const status = await row.getAttribute('data-status');
    const said = (await row.innerText()).replace(/\s+/g, ' ').trim();

    if (status !== 'success') {
        throw new Error(`${name} came back "${status}": ${said}`);
    }

    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    const button = row.getByRole('button', { name: /^Download \S+\.(jpg|png|webp)$/ }).first();
    const [saved] = await Promise.all([page.waitForEvent('download'), button.click()]);
    await saved.saveAs(outFile);

    return { file: outFile, filename: saved.suggestedFilename(), kept: /kept unchanged/i.test(said) };
}

/**
 * A transparent WebP, written into this run's own output directory.
 *
 * The WebP-to-PNG case needs a WebP with a real alpha channel going IN, and
 * there is no such file among the committed samples — they are four opaque
 * pictures plus two demo inputs, none of them a WebP. So one is drawn here
 * from the transparent PNG sample, losslessly, which makes it the same picture
 * in a different container: the conversion back to PNG is then measurable
 * against a reference that is not itself a lossy guess.
 *
 * It is an INPUT to a measurement rather than evidence, so it is never
 * committed — benchmarks/outputs/ is already ignored — and it is written from
 * the sample the results file records, so it cannot drift from the picture the
 * other cases are about.
 */
async function writeTransparentWebp(dir, from) {
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'transparent-480x320.webp');

    await sharp(from).webp({ lossless: true, alphaQuality: 100 }).toFile(file);

    return file;
}

/* ------------------------------------------------------------------ *
 * Scenarios
 * ------------------------------------------------------------------ */

const TARGETS_KB = [100, 50];
const FORMATS = ['jpeg', 'webp'];

/**
 * A — the same picture pushed to the same byte target as JPEG and as WebP.
 *
 * EVERY case converts first, including JPEG to JPEG. /compress cannot choose an
 * output format on its own (it writes what it was given, and only offers WebP
 * when a lossless PNG cannot reach a target at all), so the format has to come
 * from /convert. Letting the already-JPEG sample skip that step would hand JPEG
 * one fewer generation of loss than WebP and quietly rig the comparison, so the
 * pipeline is identical in all sixteen cases and the extra encode is paid by
 * both. It measures the tool chain, not a bare encoder.
 */
function scenarioA() {
    const cases = [];

    for (const sample of SAMPLES) {
        for (const format of FORMATS) {
            for (const targetKb of TARGETS_KB) {
                cases.push({
                    id: `${slug(sample.file)}-${format}-${targetKb}kb`,
                    sample: sample.file,
                    label: `${sample.file} → ${LABELS[format]} @ ${targetKb} KB`,
                    tool: 'compress',
                    route: '/compress',
                    settings: { targetKb, policy: 'keep', outputFormat: format, via: '/convert' },
                    async play(page, { outDir }) {
                        const source = samplePath(sample.file);
                        const intermediate = path.join(outDir, `${slug(sample.file)}-${format}-step1.${format === 'jpeg' ? 'jpg' : format}`);
                        const final = path.join(outDir, `${slug(sample.file)}-${format}-${targetKb}kb.${format === 'jpeg' ? 'jpg' : format}`);

                        const converted = await convert(page, { file: source, to: format, outFile: intermediate });
                        const compressed = await compressToTarget(page, {
                            file: intermediate,
                            targetKb,
                            policy: 'keep',
                            outFile: final,
                        });

                        const input = await describe(source);
                        const output = await describe(final);
                        output.quality = reportedQuality(compressed.panel);

                        /**
                         * BOTH sides are flattened when the source carries
                         * alpha, onto the same black the convert tool uses.
                         *
                         * Not doing this scored the logo's WebP lane at 20 dB
                         * against the JPEG lane's 43 — not because the WebP was
                         * worse but because RGB underneath a fully transparent
                         * pixel is undefined, every encoder writes something
                         * different there, and a luma metric happily counted
                         * pixels no viewer will ever see. Composite first, then
                         * measure what is actually displayed.
                         */
                        const flatten = input.hasAlpha ? { r: 0, g: 0, b: 0 } : null;
                        const scored = await score(source, final, {
                            reference: { flatten },
                            output: { flatten },
                        });

                        const notes = [];
                        if (flatten) notes.push('both sides flattened onto black before scoring');
                        if (output.bytes > input.bytes) {
                            notes.push('the target was larger than this source, so the search raised quality to fill it');
                        }
                        if (scored.note) notes.push(scored.note);

                        return {
                            input,
                            output,
                            wallMs: compressed.wallMs,
                            ratio: output.bytes / input.bytes,
                            panel: compressed.panel,
                            file: path.relative(ROOT, final),
                            steps: [
                                { route: '/convert', wallMs: converted.wallMs, bytes: (await describe(intermediate)).bytes },
                                { route: '/compress', wallMs: compressed.wallMs, bytes: output.bytes },
                            ],
                            psnr: scored.psnr,
                            ssim: scored.ssim,
                            note: notes.length > 0 ? notes.join('; ') : null,
                        };
                    },
                });
            }
        }
    }

    return {
        id: 'jpeg-vs-webp',
        title: 'A — JPEG against WebP at a fixed byte target',
        note: 'A target is a CEILING, not a goal: the search returns the best quality that still '
            + 'fits. Where a source is already smaller than the target the ratio therefore goes '
            + 'above 100% — asking a 24 KB screenshot for 100 KB makes it bigger, at higher '
            + 'quality. Every case converts through /convert first, including JPEG to JPEG, so '
            + 'neither format gets one fewer generation of loss than the other. The two samples '
            + 'with transparency are flattened onto black on both sides before scoring.',
        cases,
    };
}

/**
 * B — the 20 KB page, which opens on the policy that is allowed to move the
 * pixels. The number worth reading here is not the byte count (20 KB was asked
 * for and 20 KB is what the ceiling means) but what it cost: the dimensions the
 * picture came back at.
 */
function scenarioB() {
    const sample = sampleByName('photo-1600x1067.jpg');

    return {
        id: 'fit-20kb',
        title: 'B — /compress-image-to-20kb, the shrink-to-fit policy',
        cases: [{
            id: 'fit-20kb-photo',
            sample: sample.file,
            label: `${sample.file} → 20 KB, shrink to fit`,
            tool: 'compress',
            route: '/compress-image-to-20kb',
            settings: { targetKb: 20, policy: 'fit' },
            async play(page, { outDir }) {
                const source = samplePath(sample.file);
                const final = path.join(outDir, 'photo-20kb-fit.jpg');

                const run = await compressToTarget(page, {
                    file: source,
                    targetKb: 20,
                    policy: 'fit',
                    route: '/compress-image-to-20kb',
                    outFile: final,
                });

                const input = await describe(source);
                const output = await describe(final);
                output.quality = reportedQuality(run.panel);

                const quality = await score(source, final);

                return {
                    input,
                    output,
                    wallMs: run.wallMs,
                    ratio: output.bytes / input.bytes,
                    panel: run.panel,
                    file: path.relative(ROOT, final),
                    ...quality,
                };
            },
        }],
    };
}

/**
 * C — is it better to downscale first, or to let the encoder work at full size?
 *
 * The only fair way to ask is to score both answers against the same picture,
 * so both lanes are compared with the source downscaled to 1200 px by sharp,
 * and the full-size lane's output is downscaled to that same geometry before
 * scoring. That resample is applied to the OUTPUT, after the tool is done, and
 * it is what a reader who displays the image at 1200 px would see.
 */
function scenarioC() {
    const sample = sampleByName('photo-1600x1067.jpg');
    const referenceHeight = Math.round((sample.height * RESIZE_WIDTH) / sample.width);

    const lanes = [
        {
            id: 'resize-then-compress',
            label: `Resize to ${RESIZE_WIDTH} px, then compress to 100 KB`,
            async play(page, { outDir }) {
                const source = samplePath(sample.file);
                const resized = path.join(outDir, 'photo-1200px.jpg');
                const final = path.join(outDir, 'photo-1200px-100kb.jpg');

                const one = await resizeToWidth(page, { file: source, width: RESIZE_WIDTH, outFile: resized });
                const two = await compressToTarget(page, { file: resized, targetKb: 100, outFile: final });

                return {
                    final,
                    wallMs: one.wallMs + two.wallMs,
                    panel: two.panel,
                    steps: [
                        { route: '/resize', wallMs: one.wallMs, bytes: (await describe(resized)).bytes },
                        { route: '/compress', wallMs: two.wallMs, bytes: fs.statSync(final).size },
                    ],
                };
            },
        },
        {
            id: 'compress-at-full-size',
            label: 'Compress to 100 KB at the full 1600 px',
            async play(page, { outDir }) {
                const source = samplePath(sample.file);
                const final = path.join(outDir, 'photo-fullsize-100kb.jpg');

                const one = await compressToTarget(page, { file: source, targetKb: 100, outFile: final });

                return {
                    final,
                    wallMs: one.wallMs,
                    panel: one.panel,
                    steps: [{ route: '/compress', wallMs: one.wallMs, bytes: fs.statSync(final).size }],
                };
            },
        },
    ];

    return {
        id: 'resize-then-compress',
        title: `C — downscale first, or compress at full size? (both scored at ${RESIZE_WIDTH} px)`,
        note: `Both lanes are scored against one reference: the source downscaled to ${RESIZE_WIDTH} px `
            + 'by sharp. The full-size lane\'s output is downscaled to that same geometry AFTER the '
            + 'tool is finished, which is what a reader displaying the image at that width would see.',
        cases: lanes.map((lane) => ({
            id: lane.id,
            sample: sample.file,
            label: lane.label,
            tool: 'resize+compress',
            route: '/resize, /compress',
            settings: { targetKb: 100, policy: 'keep', referenceWidth: RESIZE_WIDTH },
            async play(page, context) {
                const source = samplePath(sample.file);
                const run = await lane.play(page, context);

                const input = await describe(source);
                const output = await describe(run.final);
                output.quality = reportedQuality(run.panel);

                const quality = await score(source, run.final, {
                    reference: { width: RESIZE_WIDTH, height: referenceHeight },
                    output: output.width === RESIZE_WIDTH && output.height === referenceHeight
                        ? {}
                        : { width: RESIZE_WIDTH, height: referenceHeight },
                    note: output.width === RESIZE_WIDTH
                        ? null
                        : `output downscaled to ${RESIZE_WIDTH}×${referenceHeight} by sharp before scoring`,
                });

                return {
                    input,
                    output,
                    wallMs: run.wallMs,
                    ratio: output.bytes / input.bytes,
                    panel: run.panel,
                    steps: run.steps,
                    file: path.relative(ROOT, run.final),
                    ...quality,
                };
            },
        })),
    };
}

/**
 * D — a DPI change rewrites a header and must leave the picture alone. The
 * assertion worth making is the boring one: same pixels in, same pixels out.
 */
function scenarioD() {
    const sample = sampleByName('photo-1600x1067.jpg');

    return {
        id: 'dpi',
        title: 'D — /change-image-dpi at 300 DPI',
        cases: [{
            id: 'dpi-300-photo',
            sample: sample.file,
            label: `${sample.file} → 300 DPI`,
            tool: 'change-image-dpi',
            route: '/change-image-dpi',
            settings: { dpi: 300 },
            async play(page, { outDir }) {
                const source = samplePath(sample.file);
                const final = path.join(outDir, 'photo-300dpi.jpg');

                const run = await setDpi(page, { file: source, dpi: 300, outFile: final });

                const input = await describe(source);
                const output = await describe(final);
                const quality = await score(source, final);

                const samePixels = input.width === output.width && input.height === output.height;

                return {
                    input,
                    output,
                    wallMs: run.wallMs,
                    ratio: output.bytes / input.bytes,
                    panel: run.panel,
                    file: path.relative(ROOT, final),
                    ...quality,
                    note: samePixels
                        ? `dimensions unchanged; file grew by ${output.bytes - input.bytes} bytes of header`
                        : 'DIMENSIONS CHANGED — a DPI edit must not resample',
                };
            },
        }],
    };
}

/**
 * E — one pass through each of the remaining tools, for the demo assets.
 * These are outputs to look at rather than numbers to rank, so the table stays
 * shallow: what went in, what came out, and where the file landed.
 *
 * The PNG-to-JPG case is the one here that carries a claim rather than a
 * picture: a JPEG has no alpha channel, so the figure on /png-to-jpg says the
 * see-through part of the source comes back filled. The corner pixel is read
 * on both sides so that sentence is a measurement.
 */
function scenarioE() {
    const photo = sampleByName('photo-1600x1067.jpg');
    const transparent = sampleByName('transparent-480x320.png');

    return {
        id: 'demo-outputs',
        title: 'E — one pass through crop, signature resizer, PNG to JPG and metadata removal',
        cases: [
            {
                id: 'crop-photo',
                sample: photo.file,
                label: 'Crop a 900×600 rectangle out of the photo',
                tool: 'crop',
                route: '/crop',
                settings: { rect: { x: 320, y: 180, width: 900, height: 600 } },
                async play(page, { outDir }) {
                    const source = samplePath(photo.file);
                    const final = path.join(outDir, 'photo-crop-900x600.jpg');
                    const rect = { x: 320, y: 180, width: 900, height: 600 };

                    const run = await crop(page, { file: source, rect, outFile: final });

                    return {
                        input: await describe(source),
                        output: await describe(final),
                        wallMs: run.wallMs,
                        panel: run.panel,
                        file: path.relative(ROOT, final),
                    };
                },
            },
            {
                id: 'signature-300x80',
                sample: 'signature-600x200.png (E2E fixture)',
                label: 'Signature scan into a 300×80 box, JPG under 15 KB',
                tool: 'signature-resizer',
                route: '/signature-resizer',
                settings: { width: 300, height: 80, maxKb: 15 },
                async play(page, { outDir }) {
                    const source = await signature();
                    const final = path.join(outDir, 'signature-300x80.jpg');

                    const run = await makeSignature(page, {
                        file: source,
                        width: 300,
                        height: 80,
                        maxKb: 15,
                        outFile: final,
                    });

                    const output = await describe(final);

                    return {
                        input: await describe(source),
                        output,
                        wallMs: run.wallMs,
                        panel: run.panel,
                        file: path.relative(ROOT, final),
                        note: output.bytes <= 15 * 1024
                            ? 'inside the 15 KB ceiling'
                            : `OVER the 15 KB ceiling at ${output.bytes} bytes`,
                    };
                },
            },
            {
                id: 'transparent-on-white',
                sample: transparent.file,
                label: 'A transparent PNG through /png-to-jpg, filled with white',
                tool: 'convert',
                route: '/png-to-jpg',
                settings: { from: 'png', to: 'jpeg', background: 'white' },
                async play(page, { outDir }) {
                    const source = samplePath(transparent.file);
                    const final = path.join(outDir, 'transparent-on-white-480x320.jpg');

                    const run = await convertPair(page, {
                        route: '/png-to-jpg',
                        to: 'jpeg',
                        background: 'White',
                        file: source,
                        outFile: final,
                    });

                    const input = await describe(source);
                    const output = await describe(final);
                    const before = await cornerPixel(source);
                    const after = await cornerPixel(final);

                    return {
                        input,
                        output,
                        wallMs: run.wallMs,
                        ratio: output.bytes / input.bytes,
                        panel: run.panel,
                        file: path.relative(ROOT, final),
                        corner: { before, after },
                        // Not scored: PSNR and SSIM between a transparent source
                        // and its flattened output would be measuring the fill
                        // colour, which is the thing this case is demonstrating
                        // rather than a defect to quantify.
                        psnr: null,
                        ssim: null,
                        note: `corner rgba(${before.r},${before.g},${before.b},${before.a}) became `
                            + `rgb(${after.r},${after.g},${after.b}); alpha ${input.hasAlpha} → ${output.hasAlpha}`,
                    };
                },
            },
            {
                id: 'metadata-stripped',
                sample: 'exif-gps-72dpi.jpg (E2E fixture)',
                label: 'Strip EXIF and GPS from a camera-shaped JPEG',
                tool: 'remove-image-metadata',
                route: '/remove-image-metadata',
                settings: {},
                async play(page, { outDir }) {
                    const source = await exifGpsJpeg();
                    const final = path.join(outDir, 'metadata-stripped.jpg');

                    const run = await stripMetadata(page, { file: source, outFile: final });

                    const input = await describe(source);
                    const output = await describe(final);
                    const meta = await sharp(final).metadata();

                    return {
                        input,
                        output,
                        wallMs: run.wallMs,
                        ratio: output.bytes / input.bytes,
                        panel: run.panel,
                        file: path.relative(ROOT, final),
                        ...(await score(source, final)),
                        note: meta.exif
                            ? 'EXIF STILL PRESENT'
                            : `EXIF gone, ${input.bytes - output.bytes} bytes smaller, pixels untouched`,
                    };
                },
            },
        ],
    };
}

/**
 * F — /passport-photo on the US printed preset.
 *
 * The one tool on this site that has to satisfy several requirements at once,
 * so the row it produces is read differently from every other row here: the
 * question is not "how small did it get" but "did it land on the number the
 * authority published, and does the file say so".
 *
 * 2 inches at 300 DPI is 600 pixels. The runner never types that 600 — it
 * presses the chip and then asks libvips what came out, so a conversion that
 * drifted would show up as a wrong answer rather than as agreement between
 * two copies of the same typo. The DPI record is read back for the same
 * reason: 600 pixels means nothing to a printer without the number that makes
 * it two inches.
 *
 * PSNR AND SSIM ARE NULL HERE ON PURPOSE. Both need one geometry on both
 * sides, and this case's whole job is to change the geometry — a 600×600 crop
 * of a 1200×1600 portrait has no reference to be scored against, and a score
 * produced by resampling one side back would be measuring the resample.
 */
function scenarioF() {
    const sample = sampleByName('portrait-1200x1600.jpg');
    const preset = 'United States Printed';

    return {
        id: 'passport-photo',
        title: 'F — /passport-photo on the US printed preset (2 × 2 in at 300 DPI)',
        note: 'A row to be read as pass/fail rather than ranked: the preset asks for 600×600 at 300 DPI '
            + 'and the file either says that or it does not. PSNR and SSIM are null because the case '
            + 'changes the geometry, which leaves nothing to score against.',
        cases: [{
            id: 'passport-us-600x600',
            sample: sample.file,
            label: `${sample.file} → US passport photo, 2 × 2 in at 300 DPI`,
            tool: 'passport-photo',
            route: '/passport-photo',
            settings: { preset: 'us-passport-print', unit: 'in', size: 2, dpi: 300, format: 'jpeg' },
            async play(page, { outDir }) {
                const source = samplePath(sample.file);
                const final = path.join(outDir, 'portrait-passport-600x600.jpg');

                const run = await makePassportPhoto(page, { file: source, preset, outFile: final });

                const input = await describe(source);
                const output = await describe(final);

                const exact = output.width === 600 && output.height === 600;
                const stamped = output.density === 300;

                return {
                    input,
                    output,
                    wallMs: run.wallMs,
                    ratio: output.bytes / input.bytes,
                    panel: run.panel,
                    file: path.relative(ROOT, final),
                    psnr: null,
                    ssim: null,
                    note: exact && stamped
                        ? '600×600 at 300 DPI, exactly as the preset states'
                        : `MISSED THE REQUIREMENT: ${output.width}×${output.height} at ${output.density ?? 'no'} DPI`,
                };
            },
        }],
    };
}

/** The ceiling every file in scenario G's main batch is given. */
const BULK_TARGET_KB = 200;

/** The ceiling the small-batch timing rows use, so each file is real work. */
const BULK_SMALL_TARGET_KB = 50;

/** A generous per-file budget, so a slow machine reads as slow and not as broken. */
const BULK_PER_FILE_TIMEOUT = 45_000;

const bulkTimeout = (count) => Math.max(RESULT_TIMEOUT, count * BULK_PER_FILE_TIMEOUT);

/**
 * The four scored samples, the case each one gets, and the name its output is
 * saved under. The ids are quoted by scripts/generate-demos.js — a rename here
 * has to be a rename there, and that script fails loudly rather than silently
 * copying a stale file.
 */
const BULK_FILES = [
    { file: 'photo-1600x1067.jpg', id: 'bulk-photo-1600x1067', out: 'bulk-photo-200kb.jpg' },
    { file: 'screenshot-1440x900.png', id: 'bulk-screenshot-1440x900', out: 'bulk-screenshot-200kb.png' },
    { file: 'graphic-800x800.png', id: 'bulk-graphic-800x800', out: 'bulk-graphic-200kb.png' },
    { file: 'illustration-1200x900.png', id: 'bulk-illustration-1200x900', out: 'bulk-illustration-200kb.png' },
];

/**
 * G — /bulk-image-compressor: a per-file ceiling applied to a queue.
 *
 * WHY THE MODE IS FIT AND NOT PRESERVE. Three of the four samples are PNGs,
 * and PNG has no quality dial in this engine — it gets one lossless encode and
 * an honest answer about whether that met the ceiling
 * (lib/image-client/compress-target.js). Under "Preserve dimensions" a PNG
 * that misses its target has no lever left and is reported as a failure, which
 * is correct behaviour and a useless benchmark: three of four rows would read
 * FAILED and measure nothing. "Fit under limit" is the mode that has a second
 * lever, so it is the one that produces a number for every input.
 *
 * WHY THE FOUR PER-FILE ROWS ARE THEIR OWN RUNS. Each is that file alone
 * through the bulk page, so its `wallMs` is that file's own cost with nothing
 * queued behind it. The `bulk-summary` row is the same four files together,
 * and its `durationMs` is the wait a person actually sits through. Read as a
 * pair they answer the only question a batch raises that a single file cannot:
 * whether four files cost four files' worth. The engine is deterministic, so
 * the bytes in the two runs should agree — and the summary row says out loud
 * when they do not, rather than quietly reporting one of them.
 *
 * THE SMALL ROWS ARE ABOUT SCALE, NOT ABOUT PICTURES. Five copies and twenty
 * copies of one 97 KB file, so the difference between the rows is the file
 * count. Twenty is the cap the page enforces. FIFTY IS NOT RUN AND NEVER WILL
 * BE HERE: the page refuses a selection above MAX_BULK_FILES, so a fifty-file
 * row could only be produced by driving something other than the product, and
 * a number obtained that way is exactly what this runner exists not to publish.
 */
function scenarioG() {
    const cases = BULK_FILES.map((entry) => {
        const sample = sampleByName(entry.file);

        return {
            id: entry.id,
            sample: sample.file,
            label: `${sample.file} alone through the bulk page at ${BULK_TARGET_KB} KB`,
            tool: 'bulk-image-compressor',
            route: BULK_ROUTE,
            settings: { targetKb: BULK_TARGET_KB, mode: 'fit', files: 1 },
            async play(page, { outDir }) {
                const source = samplePath(sample.file);
                const final = path.join(outDir, entry.out);

                const run = await runBulkBatch(page, {
                    files: [source],
                    targetKb: BULK_TARGET_KB,
                    mode: 'fit',
                    timeout: bulkTimeout(1),
                });

                const saved = await saveBulkRow(page, sample.file, final);

                const input = await describe(source);
                const output = await describe(final);

                return {
                    input,
                    output,
                    wallMs: run.durationMs,
                    ratio: output.bytes / input.bytes,
                    file: path.relative(ROOT, final),
                    filename: saved.filename,
                    kept: saved.kept,
                    resized: output.width !== input.width || output.height !== input.height,
                    peakJsHeapBytes: run.peakJsHeapBytes,
                    successCount: summaryCount(run.summary, 'Successful'),
                    // Not scored. Scenario A is where format quality is the
                    // subject; this scenario measures a queue, and half its
                    // inputs change geometry to meet the ceiling, which leaves
                    // nothing to score them against.
                    psnr: null,
                    ssim: null,
                    note: output.width === input.width && output.height === input.height
                        ? `met ${BULK_TARGET_KB} KB at full size`
                        : `met ${BULK_TARGET_KB} KB by shrinking to ${output.width}×${output.height}`,
                };
            },
        };
    });

    cases.push({
        id: 'bulk-summary',
        sample: 'all four samples',
        label: `All four samples in one batch at ${BULK_TARGET_KB} KB each`,
        tool: 'bulk-image-compressor',
        route: BULK_ROUTE,
        settings: { targetKb: BULK_TARGET_KB, mode: 'fit', files: BULK_FILES.length },
        async play(page, { outDir }) {
            const sources = BULK_FILES.map((entry) => samplePath(entry.file));

            const run = await runBulkBatch(page, {
                files: sources,
                targetKb: BULK_TARGET_KB,
                mode: 'fit',
                timeout: bulkTimeout(sources.length),
            });

            const archive = path.join(outDir, 'bulk-four-files-200kb.zip');
            await saveBulkZip(page, run.zip, archive);

            const entries = await readZip(archive);
            if (entries.length === 0) throw new Error('the archive the batch produced is empty');

            const files = [];
            for (let index = 0; index < entries.length; index += 1) {
                const entry = entries[index];
                const entryFile = path.join(outDir, 'batch', entry.name);
                fs.mkdirSync(path.dirname(entryFile), { recursive: true });
                fs.writeFileSync(entryFile, entry.buffer);

                const source = sources[index];
                const input = await describe(source);
                const output = await describe(entryFile);
                const rowText = (await bulkRow(page, path.basename(source)).innerText()).replace(/\s+/g, ' ');

                files.push({
                    sample: path.basename(source),
                    kept: /kept at its size/.test(rowText),
                    name: entry.name,
                    input,
                    output,
                    ratio: output.bytes / input.bytes,
                    resized: output.width !== input.width || output.height !== input.height,
                    file: path.relative(ROOT, entryFile),
                });
            }

            const totalInputBytes = files.reduce((sum, item) => sum + item.input.bytes, 0);
            const totalOutputBytes = files.reduce((sum, item) => sum + item.output.bytes, 0);
            const successCount = summaryCount(run.summary, 'Successful');

            // A mean of the per-file reductions rather than one reduction over
            // the totals: the totals are dominated by the largest file, and the
            // question "how much smaller does a file get" is asked per file.
            const avgReduction = files.length === 0
                ? null
                : Number((files.reduce((sum, item) => sum + (1 - item.ratio), 0) / files.length * 100).toFixed(1));

            const named = entries.every((entry, index) => entry.name.startsWith(
                path.basename(sources[index], path.extname(sources[index])),
            ));

            const disagreement = successCount !== null && successCount !== entries.length
                ? `MISMATCH: the panel says ${successCount} succeeded and the archive holds ${entries.length}. `
                : '';
            const misordered = named ? '' : 'MISMATCH: the archive is not in the order the files went in. ';

            return {
                // In and Out on this row are the batch's totals, which is what
                // the report's default columns then say about it.
                input: { bytes: totalInputBytes },
                output: { bytes: totalOutputBytes },
                ratio: totalInputBytes === 0 ? null : totalOutputBytes / totalInputBytes,
                wallMs: run.durationMs,
                durationMs: run.durationMs,
                msPerFile: Math.round(run.durationMs / Math.max(1, files.length)),
                peakJsHeapBytes: run.peakJsHeapBytes,
                heapSamples: run.heapSamples,
                files,
                fileCount: files.length,
                totalInputBytes,
                totalOutputBytes,
                avgReduction,
                successCount,
                filesNeedingDimensionReduction: files.filter((item) => item.resized).length,
                keptCount: files.filter((item) => item.kept).length,
                summary: run.summary,
                file: path.relative(ROOT, archive),
                psnr: null,
                ssim: null,
                note: `${disagreement}${misordered}`
                    + `${files.length} files, ${avgReduction}% smaller on average, `
                    + `${files.filter((item) => item.resized).length} needed a smaller picture to get there. `
                    + `Peak main-thread heap ${run.peakJsHeapBytes === null ? 'not measurable in this browser' : `${(run.peakJsHeapBytes / (1024 * 1024)).toFixed(1)} MB`} `
                    + '(the codecs run in a worker, whose heap this figure does not see).',
            };
        },
    });

    for (const count of [5, BULK_FILE_CAP]) {
        cases.push({
            id: `bulk-${count}-small`,
            sample: `${count} × 640×480 JPEG, ~86 KB each`,
            label: `${count} small files in one batch at ${BULK_SMALL_TARGET_KB} KB each`,
            tool: 'bulk-image-compressor',
            route: BULK_ROUTE,
            settings: { targetKb: BULK_SMALL_TARGET_KB, mode: 'fit', files: count },
            async play(page, { outDir }) {
                const files = await writeSmallBatch(path.join(outDir, `small-${count}`), count);

                const run = await runBulkBatch(page, {
                    files,
                    targetKb: BULK_SMALL_TARGET_KB,
                    mode: 'fit',
                    timeout: bulkTimeout(count),
                });

                const archive = path.join(outDir, `bulk-${count}-small.zip`);
                await saveBulkZip(page, run.zip, archive);
                const entries = await readZip(archive);

                const totalInputBytes = files.reduce((sum, file) => sum + fs.statSync(file).size, 0);
                const totalOutputBytes = entries.reduce((sum, entry) => sum + entry.bytes, 0);
                const successCount = summaryCount(run.summary, 'Successful');

                return {
                    input: { bytes: totalInputBytes },
                    output: { bytes: totalOutputBytes },
                    ratio: totalInputBytes === 0 ? null : totalOutputBytes / totalInputBytes,
                    wallMs: run.durationMs,
                    durationMs: run.durationMs,
                    msPerFile: Math.round(run.durationMs / count),
                    peakJsHeapBytes: run.peakJsHeapBytes,
                    heapSamples: run.heapSamples,
                    fileCount: count,
                    totalInputBytes,
                    totalOutputBytes,
                    successCount,
                    zipEntries: entries.length,
                    summary: run.summary,
                    file: path.relative(ROOT, archive),
                    psnr: null,
                    ssim: null,
                    note: count === BULK_FILE_CAP
                        ? `The cap: the page accepts ${BULK_FILE_CAP} files (MAX_BULK_FILES in lib/limits.js) and `
                            + 'refuses the twenty-first. A fifty-file batch is therefore not run here and is not '
                            + 'measurable through the product at all — the only way to produce that number would '
                            + 'be to drive something other than the page, which is not what this file publishes.'
                        : `${count} identical copies, so the only difference from the ${BULK_FILE_CAP}-file row `
                            + 'is the file count.',
                };
            },
        });
    }

    return {
        id: 'bulk-compress',
        title: `G — /bulk-image-compressor, four files at ${BULK_TARGET_KB} KB each`,
        note: 'Mode is "Fit under limit" throughout: three of the four samples are PNGs, which have no quality '
            + 'dial in this engine, so under "Preserve dimensions" a PNG that misses its ceiling is reported as a '
            + 'failure rather than compressed. The four per-file rows are each that file alone through the bulk '
            + 'page; the bulk-summary row is the same four together, and its In and Out are the batch totals. '
            + 'PSNR and SSIM are null on every row here — format quality is scenario A\'s subject, and rows that '
            + 'change geometry to reach a ceiling have nothing to be scored against. peakJsHeapBytes is the main '
            + 'thread only and is null outside Chromium; the codecs run in a worker whose heap it does not see. '
            + `Twenty is the largest batch the page accepts, so fifty files is not run and is not measurable here.`,
        cases,
    };
}

/** White, as the flatten cases spell it and as `pixels` wants it. */
const WHITE = '#ffffff';

/**
 * H — /bulk-image-converter: one output format applied to a queue.
 *
 * WHAT THIS MEASURES THAT SCENARIO A DOES NOT. A asks what a picture costs at
 * a fixed byte target, one file at a time, and answers in PSNR. This asks the
 * question the converter page is actually about: hand a batch a format it did
 * not arrive in, and what comes out — how big, how long, and is the alpha
 * channel still there. The two lean opposite ways on purpose: A holds the
 * bytes still and measures quality, H holds the settings still and measures
 * the bytes.
 *
 * THE QUALITY SLIDER IS NEVER TOUCHED. Every row is what a visitor gets
 * without adjusting anything, which is the number the page is entitled to
 * quote. Moving the slider per case would produce a better-looking table about
 * a flow almost nobody runs.
 *
 * FIVE ROWS ACROSS FOUR DIRECTIONS. JPEG to WebP and PNG to WebP are the two
 * conversions people arrive for, and they answer opposite halves of the same
 * claim — the photograph gets much smaller, the screenshot may not, and the
 * page says both. WebP to PNG is the direction that cannot win on size and is
 * asked for anyway, because PNG is what a form or an editor will take. PNG to
 * JPEG is the one that DESTROYS something — the alpha channel — so it is the
 * one row that records the colour that took its place, read off the saved
 * pixels rather than from the control that was set.
 *
 * The extra fifth row is the transparent PNG to WebP, and it is the one
 * scripts/generate-demos.js copies onto the page: the figure there claims a
 * see-through PNG came back see-through, and the only honest way to show that
 * is the file the tool itself wrote.
 */
function scenarioH() {
    const photo = sampleByName('photo-1600x1067.jpg');
    const screenshot = sampleByName('screenshot-1440x900.png');
    const transparentSample = sampleByName('transparent-480x320.png');

    /**
     * One file through the bulk converter, and everything the run knows about
     * it. Every case does this much; what differs is what each one then asks
     * of the file it produced.
     */
    async function convertThrough(page, { source, to, background = null, outFile }) {
        const name = path.basename(source);

        const run = await runBulkConvert(page, {
            files: [source],
            format: to,
            background,
            timeout: bulkTimeout(1),
        });

        const saved = await saveConvertRow(page, name, outFile);
        const input = await describe(source);
        const output = await describe(outFile);

        return {
            input,
            output,
            wallMs: run.durationMs,
            ratio: input.bytes === 0 ? null : output.bytes / input.bytes,
            file: path.relative(ROOT, outFile),
            filename: saved.filename,
            kept: saved.kept,
            peakJsHeapBytes: run.peakJsHeapBytes,
            convertedCount: summaryCount(run.summary, 'Converted'),
            summary: run.summary,
        };
    }

    /** The sentence a size row ends with, in the direction the numbers went. */
    const sizeNote = (input, output) => (output.bytes <= input.bytes
        ? `${(100 - (output.bytes / input.bytes) * 100).toFixed(1)}% smaller`
        : `${((output.bytes / input.bytes) * 100 - 100).toFixed(1)}% LARGER — a conversion is not a compression`);

    return {
        id: 'bulk-convert',
        title: 'H — /bulk-image-converter, five conversions',
        note: 'One file per row, each alone through the bulk page, so wallMs is that file\'s own cost with '
            + 'nothing queued behind it. The quality slider is left at the page\'s default and never touched: '
            + 'these are the numbers a visitor gets without adjusting anything. Five rows across four directions '
            + '— JPEG→WebP, PNG→WebP (twice: an opaque screenshot and a transparent graphic), WebP→PNG and '
            + 'PNG→JPEG. The transparent PNG→WebP row is the one scripts/generate-demos.js copies onto the page, '
            + 'which is why it is here as well as the screenshot. Where both sides can be put in the same space '
            + 'the rows are scored, with an alpha channel composited onto white on BOTH sides first so the score '
            + 'is about the encoder and not about the fill; the PNG→JPEG row is not scored, because the fill '
            + 'colour is what that row is demonstrating rather than a defect to quantify — its corner pixel is '
            + 'recorded instead. peakJsHeapBytes is the main thread only and is null outside Chromium; the '
            + 'codecs run in a worker whose heap it does not see.',
        cases: [
            {
                id: 'convert-photo-jpeg-to-webp',
                sample: photo.file,
                label: 'A photograph-like JPEG converted to WebP',
                tool: 'bulk-image-converter',
                route: BULK_CONVERT_ROUTE,
                settings: { outputFormat: 'webp', sourceFormat: 'jpeg', files: 1 },
                async play(page, { outDir }) {
                    const source = samplePath(photo.file);
                    const final = path.join(outDir, 'photo-1600x1067-converted.webp');

                    const measured = await convertThrough(page, { source, to: 'webp', outFile: final });

                    return {
                        ...measured,
                        // Both sides are opaque and the geometry does not
                        // change, so this is a straight question: what did the
                        // trip through WebP cost the picture?
                        ...(await score(source, final)),
                        note: `JPEG → WebP, ${sizeNote(measured.input, measured.output)}, `
                            + `${measured.output.width}×${measured.output.height} either way.`,
                    };
                },
            },
            {
                id: 'convert-screenshot-png-to-webp',
                sample: screenshot.file,
                label: 'A screenshot PNG converted to WebP',
                tool: 'bulk-image-converter',
                route: BULK_CONVERT_ROUTE,
                settings: { outputFormat: 'webp', sourceFormat: 'png', files: 1 },
                async play(page, { outDir }) {
                    const source = samplePath(screenshot.file);
                    const final = path.join(outDir, 'screenshot-1440x900-converted.webp');

                    const measured = await convertThrough(page, { source, to: 'webp', outFile: final });

                    return {
                        ...measured,
                        ...(await score(source, final)),
                        // The row that stops "WebP is smaller" from being said
                        // as a rule. A flat screenshot is what PNG is best at,
                        // and this is where the sentence has to say "often".
                        note: `PNG → WebP, ${sizeNote(measured.input, measured.output)}. `
                            + 'Hard edges and flat panels are what PNG is best at, so this is the row that '
                            + 'decides whether "WebP is smaller" can be said as a rule.',
                    };
                },
            },
            {
                id: 'convert-transparent-png-to-webp',
                sample: transparentSample.file,
                label: 'A transparent PNG converted to WebP, alpha intact',
                tool: 'bulk-image-converter',
                route: BULK_CONVERT_ROUTE,
                settings: { outputFormat: 'webp', sourceFormat: 'png', files: 1 },
                async play(page, { outDir }) {
                    const source = samplePath(transparentSample.file);
                    const final = path.join(outDir, 'transparent-480x320-converted.webp');

                    const measured = await convertThrough(page, { source, to: 'webp', outFile: final });

                    return {
                        ...measured,
                        // Both sides carry alpha, so both are composited onto
                        // the same white before either is measured. Scoring
                        // RGB under a transparent pixel measures whatever the
                        // encoder happened to leave there, which is nothing.
                        ...(await score(source, final, {
                            reference: { flatten: WHITE },
                            output: { flatten: WHITE },
                            note: 'both sides composited onto white before scoring',
                        })),
                        note: `PNG → WebP, ${sizeNote(measured.input, measured.output)}. `
                            + `Alpha in ${measured.input.hasAlpha}, alpha out ${measured.output.hasAlpha}`
                            + `${measured.output.hasAlpha ? '' : ' — THE TRANSPARENCY WAS LOST'}. `
                            + 'This is the file the page shows as its "after".',
                    };
                },
            },
            {
                id: 'convert-transparent-webp-to-png',
                sample: 'transparent-480x320.webp (drawn from the PNG sample, not committed)',
                label: 'A transparent WebP converted to PNG',
                tool: 'bulk-image-converter',
                route: BULK_CONVERT_ROUTE,
                settings: { outputFormat: 'png', sourceFormat: 'webp', files: 1 },
                async play(page, { outDir }) {
                    const source = await writeTransparentWebp(
                        path.join(outDir, 'sources'),
                        samplePath(transparentSample.file),
                    );
                    const final = path.join(outDir, 'transparent-480x320-converted.png');

                    const measured = await convertThrough(page, { source, to: 'png', outFile: final });

                    return {
                        ...measured,
                        ...(await score(source, final, {
                            reference: { flatten: WHITE },
                            output: { flatten: WHITE },
                            note: 'both sides composited onto white before scoring',
                        })),
                        note: `WebP → PNG, ${sizeNote(measured.input, measured.output)}. `
                            + `Alpha in ${measured.input.hasAlpha}, alpha out ${measured.output.hasAlpha}. `
                            + 'The direction that cannot win on size and is asked for anyway, because PNG is '
                            + 'what a form or an editor will take.',
                    };
                },
            },
            {
                id: 'convert-transparent-png-to-jpeg',
                sample: transparentSample.file,
                label: 'A transparent PNG converted to JPG, filled with white',
                tool: 'bulk-image-converter',
                route: BULK_CONVERT_ROUTE,
                settings: { outputFormat: 'jpeg', sourceFormat: 'png', background: 'white', files: 1 },
                async play(page, { outDir }) {
                    const source = samplePath(transparentSample.file);
                    const final = path.join(outDir, 'transparent-480x320-converted.jpg');

                    const measured = await convertThrough(page, {
                        source,
                        to: 'jpeg',
                        background: 'White',
                        outFile: final,
                    });

                    const before = await cornerPixel(source);
                    const after = await cornerPixel(final);

                    return {
                        ...measured,
                        corner: { before, after },
                        // Not scored: PSNR and SSIM between a transparent
                        // source and its flattened output would be measuring
                        // the fill colour, which is the thing this case is
                        // demonstrating rather than a defect to quantify.
                        psnr: null,
                        ssim: null,
                        note: `PNG → JPEG, ${sizeNote(measured.input, measured.output)}. `
                            + `Corner rgba(${before.r},${before.g},${before.b},${before.a}) became `
                            + `rgb(${after.r},${after.g},${after.b}); alpha ${measured.input.hasAlpha} → `
                            + `${measured.output.hasAlpha}. JPEG has no alpha channel, so the transparency `
                            + 'did not survive — it became a colour, and this row says which.',
                    };
                },
            },
        ],
    };
}

/**
 * The conversion a physical size has to go through before it is a pixel count,
 * written out here rather than imported.
 *
 * lib/format/physical.js holds the same three lines, and this file cannot reach
 * it: that module is ES modules under a `.js` extension in a CommonJS package,
 * so `require` is a syntax error and `await import()` reads it as CommonJS —
 * the same wall BULK_FILE_CAP runs into further up. Writing it out is also the
 * more honest arrangement for a benchmark: the runner types 35 mm and 300 DPI,
 * derives 413 with arithmetic of its own, and then asks libvips what the file
 * actually is. Importing the product's converter would make a drifted
 * conversion agree with itself.
 */
const pixelsFromMillimetres = (mm, dpi) => Math.round((mm / 25.4) * dpi);

/** Every field the fitter's form holds, with the page's own defaults. */
const fitRequirement = (overrides) => ({
    width: null,
    height: null,
    unit: 'px',
    dpi: null,
    format: 'jpeg',
    maxKb: null,
    minKb: null,
    geometry: 'cover',
    ...overrides,
});

/**
 * I — /image-size-fitter across eight requirement sets.
 *
 * THE ROWS HERE ARE READ AS PASS/FAIL, NOT RANKED. Every other scenario in this
 * file asks how small or how good; this one asks whether the file is what was
 * demanded, because that is the only question a portal's upload form asks. A
 * 600×600 JPEG that came back at 47 KB under a 50 KB ceiling is a pass; the
 * same 47 KB at 512×512 is a failure that every byte-shaped metric would call a
 * success.
 *
 * SO NO CEILING IS RECORDED WITHOUT THE DIMENSIONS BESIDE IT, and the verdict
 * in each row's note is computed from libvips' reading of the saved file. The
 * page's own requirement summary is recorded next to it rather than instead of
 * it: the two disagreeing — a panel reporting "Meets" over a file that does not
 * — is the single most valuable thing this scenario can catch, and it is
 * invisible to a runner that only reads one of them.
 *
 * THE EIGHT ARE CHOSEN AS DISTINCT SHAPES OF REQUIREMENT, not as a size sweep:
 * two ceilings on one square target (one of which the demo figure is made
 * from), a padded portrait, a target small enough that no ceiling binds, a size
 * stated in millimetres that only becomes pixels after a DPI, a ceiling nothing
 * can reach, a lossless format with an alpha channel to keep, and a WebP whose
 * container has no density field to write.
 *
 * THE IMPOSSIBLE ROW PASSES BY BEING REFUSED. It asks 800×800 JPEG under 10 KB
 * of a frame that is 22.9 KB through libvips at quality 50 — the floor the fit
 * op stops at — so there is no quality left to spend and the correct output is
 * a sentence. The row records that sentence. A file appearing there instead is
 * the failure, and refuseToFit says so in those words.
 *
 * PSNR AND SSIM ARE NULL ON EVERY ROW. Both need one geometry on both sides,
 * and changing the geometry is what every case here does; a score produced by
 * resampling one side back would be measuring the resample.
 */
function scenarioI() {
    const photo = sampleByName('photo-1600x1067.jpg');
    const portraitSample = sampleByName('portrait-1200x1600.jpg');
    const transparentSample = sampleByName('transparent-480x320.png');

    /**
     * The verdict, from the bytes.
     *
     * `checks` is the page's own report on the same file. It never decides the
     * verdict — it is compared against it, and a disagreement in either
     * direction is spelled out rather than averaged away.
     */
    function verdictFor({ output, settings, expected, checks }) {
        const problems = [];

        if (output.width !== expected.width || output.height !== expected.height) {
            problems.push(`${output.width}×${output.height}, not the ${expected.width}×${expected.height} asked for`);
        }
        if (output.format !== settings.format) {
            problems.push(`came back ${output.format}, not ${settings.format}`);
        }
        if (settings.maxKb !== null && output.bytes > settings.maxKb * 1024) {
            problems.push(`${output.bytes} bytes, over the ${settings.maxKb} KB ceiling`);
        }
        if (settings.minKb !== null && output.bytes < settings.minKb * 1024) {
            problems.push(`${output.bytes} bytes, under the ${settings.minKb} KB minimum`);
        }
        if (settings.dpi !== null && output.density !== settings.dpi) {
            problems.push(`${output.density ?? 'no'} DPI, not the ${settings.dpi} asked for`);
        }

        const disputed = checks.filter((row) => row.status === 'Fails').map((row) => row.label);

        if (problems.length > 0) {
            return `MISSED THE REQUIREMENT: ${problems.join('; ')}`
                + (disputed.length === 0
                    ? ' — and the page reported every check as met, which is worse than the miss'
                    : `; the page also failed ${disputed.join(', ')}`);
        }

        if (disputed.length > 0) {
            return `libvips reads this file as meeting the requirement, but the page failed ${disputed.join(', ')}`;
        }

        return `met: ${output.width}×${output.height} ${output.format.toUpperCase()}`
            + (settings.maxKb === null ? '' : `, ${output.bytes} B inside the ${settings.maxKb} KB ceiling`)
            + (settings.dpi === null ? '' : `, ${output.density} DPI written`);
    }

    /** One requirement through the page, and everything the run knows about it. */
    function fitCase({ id, sample, source, label, settings, expected, outName, remark = null }) {
        return {
            id,
            sample,
            label,
            tool: 'image-size-fitter',
            route: '/image-size-fitter',
            settings,
            async play(page, { outDir }) {
                const from = source();
                const final = path.join(outDir, outName);

                const run = await fitImage(page, { file: from, settings, outFile: final });

                const input = await describe(from);
                const output = await describe(final);
                const checks = await readRequirementSummary(page);

                const note = [
                    verdictFor({ output, settings, expected, checks }),
                    remark ? remark({ input, output }) : null,
                ].filter(Boolean).join('. ');

                return {
                    input,
                    output,
                    expected,
                    checks,
                    wallMs: run.wallMs,
                    ratio: input.bytes === 0 ? null : output.bytes / input.bytes,
                    panel: run.panel,
                    file: path.relative(ROOT, final),
                    filename: run.filename,
                    psnr: null,
                    ssim: null,
                    note,
                };
            },
        };
    }

    const square = { width: 600, height: 600 };
    const physical = {
        width: pixelsFromMillimetres(35, 300),
        height: pixelsFromMillimetres(45, 300),
    };

    /**
     * Named once and used twice — as the row's recorded `settings` and as the
     * form the driver types. Two copies of one requirement is exactly the drift
     * that lets a results file describe a job nobody ran.
     */
    // 10 KB is the smallest ceiling the engine accepts; 800 × 800 cannot get near it.
    const impossible = fitRequirement({ width: 800, height: 800, maxKb: 10, format: 'jpeg' });

    return {
        id: 'image-size-fitter',
        title: 'I — /image-size-fitter, eight requirement sets',
        note: 'Rows to be read as pass/fail rather than ranked: each one either is the file that was '
            + 'demanded or is not, and the note says which, from libvips rather than from the panel. '
            + 'PSNR and SSIM are null throughout because every case changes the geometry, which leaves '
            + 'nothing to score against. The impossible row passes by being refused in words.',
        cases: [
            fitCase({
                id: 'fit-square-600-100kb',
                sample: photo.file,
                source: () => samplePath(photo.file),
                label: `${photo.file} → 600×600 JPEG under 100 KB at 300 DPI`,
                settings: fitRequirement({ ...square, maxKb: 100, dpi: 300, format: 'jpeg' }),
                expected: square,
                outName: 'photo-fit-600x600-100kb.jpg',
            }),
            fitCase({
                id: 'fit-square-600-50kb',
                sample: photo.file,
                source: () => samplePath(photo.file),
                // The demo figure on the page is made from this row, and it is
                // the 50 KB one rather than the 100 KB one for a reason that has
                // nothing to do with the tool: public/demos is capped at 600 KB
                // in total by tests/app/demo-assets.test.js, and a 100 KB figure
                // would spend a sixth of that budget on one picture.
                label: `${photo.file} → 600×600 JPEG under 50 KB at 300 DPI (the page's figure)`,
                settings: fitRequirement({ ...square, maxKb: 50, dpi: 300, format: 'jpeg' }),
                expected: square,
                outName: 'photo-fit-600x600-50kb.jpg',
            }),
            fitCase({
                id: 'fit-portrait-contain-50kb',
                sample: photo.file,
                source: () => samplePath(photo.file),
                // The one row where nothing is thrown away: a landscape frame
                // into a portrait box, padded rather than cropped, which is what
                // a form asking for the whole picture at a fixed size gets.
                label: `${photo.file} → 400×600 JPEG under 50 KB, fit inside and padded`,
                settings: fitRequirement({
                    width: 400, height: 600, maxKb: 50, geometry: 'contain', format: 'jpeg',
                }),
                expected: { width: 400, height: 600 },
                outName: 'photo-fit-400x600-contain-50kb.jpg',
            }),
            fitCase({
                id: 'fit-tiny-140x60-20kb',
                sample: photo.file,
                source: () => samplePath(photo.file),
                label: `${photo.file} → 140×60 JPEG under 20 KB, the signature-box shape`,
                settings: fitRequirement({ width: 140, height: 60, maxKb: 20, format: 'jpeg' }),
                expected: { width: 140, height: 60 },
                outName: 'photo-fit-140x60-20kb.jpg',
                // Measured through libvips, 140×60 of this frame is 7.0 KB at
                // quality 100, so the ceiling is not what decides this row. That
                // is the point of keeping it: a target this small is where a
                // resampler's rounding shows, and the row says plainly that the
                // 20 KB never bound rather than crediting the tool for it.
                remark: ({ output }) => (output.bytes <= 20 * 1024
                    ? `the 20 KB ceiling did not bind — ${output.bytes} B at full quality`
                    : null),
            }),
            fitCase({
                id: 'fit-physical-35x45mm-300dpi',
                sample: portraitSample.file,
                source: () => samplePath(portraitSample.file),
                // 35 × 45 mm is the size most of the world's ID forms state, and
                // it is not a pixel count until a DPI is supplied. The runner
                // types the millimetres and derives the pixels itself.
                label: `${portraitSample.file} → 35 × 45 mm at 300 DPI (${physical.width}×${physical.height} px)`,
                settings: fitRequirement({
                    width: 35, height: 45, unit: 'mm', dpi: 300, format: 'jpeg',
                }),
                expected: physical,
                outName: 'portrait-fit-35x45mm-300dpi.jpg',
            }),
            {
                id: 'fit-impossible-800-10kb',
                sample: photo.file,
                label: `${photo.file} → 800×800 JPEG under 10 KB, which no encoder can do`,
                tool: 'image-size-fitter',
                route: '/image-size-fitter',
                settings: impossible,
                async play(page) {
                    const from = samplePath(photo.file);
                    const run = await refuseToFit(page, { file: from, settings: impossible });

                    return {
                        input: await describe(from),
                        // There is no file, and no number about a file. A row
                        // that dashed these while quietly reporting a ratio
                        // would be describing something that does not exist.
                        output: null,
                        expected: square,
                        checks: null,
                        wallMs: run.wallMs,
                        ratio: null,
                        panel: run.said,
                        file: null,
                        psnr: null,
                        ssim: null,
                        refusal: run.said,
                        note: `refused in words, which is the pass: "${run.said}"`,
                    };
                },
            },
            fitCase({
                id: 'fit-png-600',
                sample: transparentSample.file,
                source: () => samplePath(transparentSample.file),
                // The only lossless row, and the only one with something to
                // lose that no byte count would show: PNG has no quality axis in
                // this build, so the whole question is whether the alpha channel
                // survived the crop and the resample.
                label: `${transparentSample.file} → 600×400 PNG, transparency kept`,
                settings: fitRequirement({ width: 600, height: 400, format: 'png' }),
                expected: { width: 600, height: 400 },
                outName: 'transparent-fit-600x400.png',
                remark: ({ input, output }) => `alpha ${input.hasAlpha} → ${output.hasAlpha}`
                    + (output.hasAlpha ? '' : ' — THE TRANSPARENCY WAS LOST'),
            }),
            fitCase({
                id: 'fit-webp-600-60kb',
                sample: photo.file,
                source: () => samplePath(photo.file),
                // 18.3 KB at quality 50 and 94.1 KB at quality 100 through
                // libvips, so 60 KB is a ceiling with a real search behind it:
                // reachable without lifting the floor, unreachable without
                // searching. No DPI is asked for, because a WebP container has
                // no density field to write one into.
                label: `${photo.file} → 600×600 WebP under 60 KB`,
                settings: fitRequirement({ ...square, maxKb: 60, format: 'webp' }),
                expected: square,
                outName: 'photo-fit-600x600-60kb.webp',
            }),
        ],
    };
}

/* ------------------------------------------------------------------ *
 * The print sheet, which is the only tool here whose output is a
 * physical object rather than a picture
 * ------------------------------------------------------------------ */

const SHEET_ROUTE = '/passport-photo-print';

/**
 * The two papers and the two photo sizes these six cases use, written in the
 * units the registry states them in.
 *
 * Papers are named width-by-height in PORTRAIT — "4 × 6 in" is four across and
 * six down — and nothing below assumes which way up the layout will choose.
 */
const SHEET_PAPERS = {
    '4x6': {
        id: '4x6', label: '4 × 6 in', width: 4, height: 6, unit: 'in',
    },
    a4: {
        id: 'a4', label: 'A4 (210 × 297 mm)', width: 210, height: 297, unit: 'mm',
    },
};

const SHEET_PHOTOS = {
    us: {
        chip: 'United States 2 × 2 in', width: 2, height: 2, unit: 'in',
    },
    uk: {
        chip: 'United Kingdom 35 × 45 mm', width: 35, height: 45, unit: 'mm',
    },
};

const SHEET_GUIDE_LABELS = { none: 'Off', corners: 'Corner marks', lines: 'Full lines' };
const SHEET_OUTPUT_LABELS = { jpeg: 'JPEG', pdf: 'PDF' };
const SHEET_DOWNLOADS = { jpeg: 'Download JPEG', pdf: 'Download PDF' };

/** Millimetres from whatever unit an authority or a paper size states. */
const sheetMillimetres = (value, unit) => {
    if (unit === 'mm') return value;
    if (unit === 'cm') return value * 10;
    if (unit === 'in') return value * 25.4;
    throw new Error(`unrecognised unit "${unit}"`);
};

/** Points, which is what a PDF page is measured in: 72 to the inch. */
const pointsFromMillimetres = (mm) => (mm / 25.4) * 72;

/**
 * What the arithmetic says the sheet should be, derived here rather than asked
 * of the product.
 *
 * The same position this file already takes about lib/format/physical.js a few
 * hundred lines up: a runner that imported layoutSheet and then checked the
 * sheet against layoutSheet's own answer would agree with a drifted layout
 * instead of catching it. Every number here comes from the paper size, the
 * photo size and the rounding rule — each length converted independently and
 * rounded once — and the row says whether the file agrees.
 *
 * Full grids only, which is all these six cases ask for: every one of them
 * fills the sheet rather than requesting a partial count.
 */
function deriveSheetLayout({
    paper, photo, dpi, marginMm = 5, gapMm = 3,
}) {
    const marginPx = pixelsFromMillimetres(marginMm, dpi);
    const gapPx = pixelsFromMillimetres(gapMm, dpi);
    const photoWidthPx = pixelsFromMillimetres(sheetMillimetres(photo.width, photo.unit), dpi);
    const photoHeightPx = pixelsFromMillimetres(sheetMillimetres(photo.height, photo.unit), dpi);

    const fits = (paperPx, itemPx) => Math.max(
        0,
        Math.floor((paperPx - 2 * marginPx + gapPx) / (itemPx + gapPx)),
    );

    const shape = (widthMm, heightMm, name) => {
        const widthPx = pixelsFromMillimetres(widthMm, dpi);
        const heightPx = pixelsFromMillimetres(heightMm, dpi);
        const columns = fits(widthPx, photoWidthPx);
        const rows = fits(heightPx, photoHeightPx);
        return {
            name,
            columns,
            rows,
            capacity: columns * rows,
            paperPx: { width: widthPx, height: heightPx },
            paperPt: {
                width: pointsFromMillimetres(widthMm),
                height: pointsFromMillimetres(heightMm),
            },
        };
    };

    const widthMm = sheetMillimetres(paper.width, paper.unit);
    const heightMm = sheetMillimetres(paper.height, paper.unit);

    const upright = shape(widthMm, heightMm, 'portrait');
    const sideways = shape(heightMm, widthMm, 'landscape');

    // 'auto' takes the larger capacity, and a tie goes to portrait.
    const chosen = sideways.capacity > upright.capacity ? sideways : upright;

    return {
        ...chosen,
        dpi,
        marginPx,
        gapPx,
        photoPx: { width: photoWidthPx, height: photoHeightPx },
    };
}

/**
 * The advanced half, opened once and only if it is shut. Pressed blindly it is
 * a toggle, and a second press would close the drawer the next line fills.
 */
async function openSheetAdvanced(page) {
    const toggle = page.locator('#sheet-advanced');
    if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
    await page.locator('#sheet-margin').waitFor({ state: 'visible', timeout: READY_TIMEOUT });
}

/**
 * One radio, named by its own label and pinned to its own group.
 *
 * The label alone is not enough on this page — "PDF", "Off" and "Portrait" are
 * all words the surrounding prose uses — and the group's `name` attribute is
 * what the contract actually fixes.
 */
const sheetRadio = (page, group, label) => page
    .getByRole('radio', { name: label, exact: true })
    .and(page.locator(`input[name="${group}"]`));

/**
 * Fills in the form.
 *
 * The paper, the photo size, the DPI and the output are set every time, even to
 * the value the page already holds — the same rule convertPair and
 * setFitRequirement follow, and for the same reason: a benchmark leaning on a
 * default is a benchmark whose numbers move the day somebody changes one,
 * silently and in the direction nobody looked. The guides are reached only when
 * they differ from the default, because that means opening a disclosure a
 * visitor with a simple job never opens.
 *
 * The photo-size chip is CONFIRMED rather than pressed: PresetChips reads a
 * press on the already-active chip as "unselect", so pressing the default would
 * leave the page with no photo size at all.
 */
async function setSheetOptions(page, settings) {
    const {
        paper, photo, dpi, guides, output,
    } = settings;

    await page.locator('#sheet-paper').selectOption({ label: paper.label });

    const chip = page.getByRole('button', { name: photo.chip, exact: true });
    if ((await chip.getAttribute('aria-pressed')) !== 'true') await chip.click();

    await page.locator('#sheet-dpi').fill(String(dpi));

    if (guides !== 'corners') {
        await openSheetAdvanced(page);
        await sheetRadio(page, 'sheet-guides', SHEET_GUIDE_LABELS[guides]).check();
    }

    await sheetRadio(page, 'sheet-output', SHEET_OUTPUT_LABELS[output]).check();
}

async function makePrintSheet(page, { file, settings, outFile }) {
    await open(page, SHEET_ROUTE);
    await setSheetOptions(page, settings);
    await pickFile(page, file, 'Create sheet');

    return measure(page, {
        action: 'Create sheet',
        download: SHEET_DOWNLOADS[settings.output],
        outFile,
    });
}

/**
 * The sheet's own report on its own output, read as a person reads it.
 *
 * Scoped to the result section and taken from its first `dl`, so it does not
 * depend on the heading text above the list. Recorded BESIDE the libvips
 * reading rather than instead of it — the two disagreeing is the most valuable
 * thing this scenario can find.
 */
function readSheetSummary(page) {
    return page.locator('section[aria-labelledby="sheet-result-heading"]').evaluate((section) => {
        const list = section.querySelector('dl');
        if (!list) return [];

        return [...list.querySelectorAll(':scope > div')].map((row) => {
            const cells = [...row.querySelectorAll(':scope > dd > span')].map((cell) => [...cell.childNodes]
                .filter((node) => node.nodeType === Node.TEXT_NODE)
                .map((node) => node.textContent)
                .join('')
                .trim());
            return {
                label: row.querySelector('dt')?.textContent.trim() ?? '',
                required: cells[0] ?? '',
                actual: cells[1] ?? '',
                status: cells[2] ?? '',
            };
        });
    });
}

/**
 * J — /passport-photo-print across six sheets.
 *
 * THESE ROWS ARE READ AS PASS/FAIL, NOT RANKED, like the fitter's above. The
 * question a print sheet answers is not "how small did it get" but "will this
 * come off the printer at two inches across", and that is decided by three
 * numbers: the paper's pixel count, the DPI record written beside it, and —
 * for a PDF — the page box in points. Every one of them is derived from the
 * paper size here and then read back out of the saved file, so a sheet that
 * looks perfect on screen and prints at the wrong size is a FAILED row rather
 * than a smaller number in a column.
 *
 * THE SIX ARE CHOSEN AS DISTINCT SHAPES OF SHEET, not as a size sweep: the
 * page's own defaults (the row the demo figure is cut from), a photo size whose
 * two edges differ, the same photo on a much larger sheet, the same sheet at
 * twice the resolution — which must not change the grid, only the pixels — a
 * sheet whose guides run the full width and height instead of ticking the
 * corners, and the same sheet asked for as a PDF, where the whole physical
 * claim lives in the page box rather than in a density record.
 *
 * PSNR AND SSIM ARE NULL ON EVERY ROW, and for a stronger reason than the
 * fitter's. A sheet is not a version of the photo that went into it — it is a
 * piece of paper with several copies of that photo on it, surrounded by white.
 * There is no geometry in which the two can be compared, and a number produced
 * by resampling one to the other's shape would be measuring the white.
 *
 * THE RATIO COLUMN READS ABOVE 100% ON EVERY ROW AND THAT IS CORRECT. This is
 * the one tool on the site that produces more pixels than it consumes: a
 * 1200×1600 portrait goes in and a paper-sized canvas comes out with the photo
 * on it more than once.
 */
function scenarioJ() {
    const sample = sampleByName('portrait-1200x1600.jpg');

    /** The verdict, from the bytes and the page box — never from the panel. */
    function verdictFor({
        layout, output, pdf, checks, settings,
    }) {
        const problems = [];

        if (settings.output === 'pdf') {
            if (!pdf) problems.push('the PDF could not be reopened');
            else {
                if (pdf.pageCount !== 1) problems.push(`${pdf.pageCount} pages, not one sheet`);
                const [first] = pdf.pages;
                if (first) {
                    const offWidth = Math.abs(first.widthPt - layout.paperPt.width);
                    const offHeight = Math.abs(first.heightPt - layout.paperPt.height);
                    if (offWidth > 0.01 || offHeight > 0.01) {
                        problems.push(
                            `the page box is ${first.widthPt.toFixed(2)}×${first.heightPt.toFixed(2)} pt, `
                            + `not the ${layout.paperPt.width.toFixed(2)}×${layout.paperPt.height.toFixed(2)} `
                            + 'the paper size derives — it will print at the wrong size',
                        );
                    }
                }
            }
        } else {
            if (output.width !== layout.paperPx.width || output.height !== layout.paperPx.height) {
                problems.push(
                    `${output.width}×${output.height} px, not the ${layout.paperPx.width}×`
                    + `${layout.paperPx.height} the paper derives`,
                );
            }
            if (output.density !== layout.dpi) {
                problems.push(`${output.density ?? 'no'} DPI written, not ${layout.dpi}`);
            }
        }

        const copies = checks.find((row) => row.label === 'Copies');
        if (copies && copies.actual !== String(layout.capacity)) {
            problems.push(`the sheet says ${copies.actual} copies, the arithmetic says ${layout.capacity}`);
        }

        const disputed = checks.filter((row) => row.status === 'Fails').map((row) => row.label);

        if (problems.length > 0) {
            return `WILL NOT PRINT AS ASKED: ${problems.join('; ')}`
                + (disputed.length === 0
                    ? ' — and the page reported every check as met, which is worse than the miss'
                    : `; the page also failed ${disputed.join(', ')}`);
        }

        if (disputed.length > 0) {
            return `the file is what the arithmetic demands, but the page failed ${disputed.join(', ')}`;
        }

        const size = settings.output === 'pdf'
            ? `${layout.paperPt.width.toFixed(2)}×${layout.paperPt.height.toFixed(2)} pt on one page`
            : `${output.width}×${output.height} px at ${output.density} DPI`;

        return `met: ${size}, ${layout.capacity} copies in ${layout.columns} × ${layout.rows} `
            + `(${layout.name}), photo ${layout.photoPx.width}×${layout.photoPx.height} px`;
    }

    /** One sheet through the page, and everything the run knows about it. */
    function sheetCase({
        id, label, settings, outName, remark = null,
    }) {
        const layout = deriveSheetLayout(settings);

        return {
            id,
            sample: sample.file,
            label,
            tool: 'passport-photo-print',
            route: SHEET_ROUTE,
            settings: {
                paper: settings.paper.id,
                photo: settings.photo.chip,
                dpi: settings.dpi,
                marginMm: 5,
                gapMm: 3,
                guides: settings.guides,
                output: settings.output,
                copies: 'auto',
            },
            async play(page, { outDir }) {
                const from = samplePath(sample.file);
                const final = path.join(outDir, outName);

                const run = await makePrintSheet(page, { file: from, settings, outFile: final });

                const input = await describe(from);
                const checks = await readSheetSummary(page);

                // A PDF is not an image, so libvips has nothing to say about it
                // and is not asked. The bytes are read from disk and the page
                // box from pdf-lib, which re-parses the saved document — the
                // same helper the E2E suite reopens a sheet with.
                const pdf = settings.output === 'pdf' ? await readPdf(final) : null;
                const output = settings.output === 'pdf'
                    ? {
                        bytes: fs.statSync(final).size,
                        width: null,
                        height: null,
                        format: 'pdf',
                        density: null,
                        hasAlpha: false,
                    }
                    : await describe(final);

                const note = [
                    verdictFor({
                        layout, output, pdf, checks, settings,
                    }),
                    remark ? remark({ input, output, layout }) : null,
                ].filter(Boolean).join('. ');

                return {
                    input,
                    output,
                    layout,
                    pdf,
                    checks,
                    verified: checks.length > 0 && checks.every((row) => row.status !== 'Fails'),
                    wallMs: run.wallMs,
                    ratio: input.bytes === 0 ? null : output.bytes / input.bytes,
                    panel: run.panel,
                    file: path.relative(ROOT, final),
                    filename: run.filename,
                    psnr: null,
                    ssim: null,
                    note,
                };
            },
        };
    }

    const base = {
        paper: SHEET_PAPERS['4x6'], photo: SHEET_PHOTOS.us, dpi: 300, guides: 'corners', output: 'jpeg',
    };

    return {
        id: 'print-sheet',
        title: 'J — /passport-photo-print, six sheets',
        note: 'Rows to be read as pass/fail rather than ranked: a sheet either prints at the size it '
            + 'promises or it does not, and the note says which — from libvips and from the PDF page box, '
            + 'never from the panel. Every expected number is derived here from the paper size and the '
            + 'photo size rather than asked of the product, so a drifted layout reads as a disagreement '
            + 'instead of agreeing with itself. PSNR and SSIM are null throughout: a sheet is not a '
            + 'version of the photo that went into it, so there is no geometry in which the two can be '
            + 'compared. The ratio reads above 100% on every row and that is correct — this is the one '
            + 'tool on the site that produces more pixels than it consumes.',
        cases: [
            sheetCase({
                id: 'sheet-us-2x2-4x6-300',
                // The page's own defaults, and the row scripts/generate-demos.js
                // cuts the figure from — so a rename here is a rename there,
                // and that script fails loudly rather than copying a stale file.
                label: `${sample.file} → US 2 × 2 in on 4 × 6 paper at 300 DPI (the page's figure)`,
                settings: base,
                outName: 'sheet-us-2x2-4x6-300.jpg',
            }),
            sheetCase({
                id: 'sheet-uk-35x45-4x6-300',
                // A photo whose two edges differ, which is where a layout that
                // costs one axis and reuses it for the other falls over.
                label: `${sample.file} → UK 35 × 45 mm on 4 × 6 paper at 300 DPI`,
                settings: { ...base, photo: SHEET_PHOTOS.uk },
                outName: 'sheet-uk-35x45-4x6-300.jpg',
            }),
            sheetCase({
                id: 'sheet-uk-35x45-a4-300',
                // The biggest canvas this site ever allocates: A4 at 300 DPI is
                // 2480 × 3508, which is 8.7 megapixels of paper before a single
                // photo is drawn onto it.
                label: `${sample.file} → UK 35 × 45 mm on A4 at 300 DPI`,
                settings: { ...base, paper: SHEET_PAPERS.a4, photo: SHEET_PHOTOS.uk },
                outName: 'sheet-uk-35x45-a4-300.jpg',
                remark: ({ layout }) => `${(layout.paperPx.width * layout.paperPx.height / 1e6).toFixed(1)} MP of paper`,
            }),
            sheetCase({
                id: 'sheet-us-2x2-4x6-600',
                // The same physical sheet at twice the resolution. THE GRID MUST
                // NOT MOVE: doubling the DPI doubles every pixel count and
                // changes nothing about how many photos fit on a piece of paper,
                // so this row beside the first is the check that the layout is
                // reasoning in millimetres and not in pixels.
                label: `${sample.file} → US 2 × 2 in on 4 × 6 paper at 600 DPI, same sheet twice the pixels`,
                settings: { ...base, dpi: 600 },
                outName: 'sheet-us-2x2-4x6-600.jpg',
                remark: ({ layout }) => `${layout.columns} × ${layout.rows} at 600 DPI — compare the 300 DPI row above`,
            }),
            sheetCase({
                id: 'sheet-us-2x2-4x6-lines',
                // Guides that run the whole width and height of the sheet rather
                // than ticking four corners. Same photos, same paper, more ink:
                // the byte difference against the first row is what a visitor
                // pays for cutting lines, and it is measured rather than guessed.
                label: `${sample.file} → US 2 × 2 in on 4 × 6 paper at 300 DPI, full cutting lines`,
                settings: { ...base, guides: 'lines' },
                outName: 'sheet-us-2x2-4x6-lines.jpg',
                remark: () => 'full lines rather than corner marks — the byte difference against the first row is the cost of the ink',
            }),
            sheetCase({
                id: 'sheet-us-2x2-4x6-pdf',
                // The same sheet as a PDF, where there is no density record and
                // the entire physical claim is the page box in points. A viewer
                // shows a wrong box at exactly the right shape, so this is the
                // row that can only be judged by reopening the document.
                label: `${sample.file} → US 2 × 2 in on 4 × 6 paper at 300 DPI, as a PDF`,
                settings: { ...base, output: 'pdf' },
                outName: 'sheet-us-2x2-4x6.pdf',
                remark: ({ layout }) => `page box read back from the document: ${layout.paperPt.width.toFixed(2)} × ${layout.paperPt.height.toFixed(2)} pt`,
            }),
        ],
    };
}

/* ------------------------------------------------------------------ *
 * The run
 * ------------------------------------------------------------------ */

/**
 * K — /image-metadata-viewer, the only tool here that produces no image.
 *
 * WHAT IS BEING MEASURED AND WHY IT IS NOT A RATIO. Every other scenario in
 * this file asks "how much smaller, and at what cost in quality". This one has
 * no output file to weigh: the product is a description, so the numbers that
 * matter are how long the walk took, how much of the wait was the walk rather
 * than the rendering, and how much a given file actually turned out to be
 * carrying. The In column is the file that went in; Out, Ratio, PSNR and SSIM
 * are dashes on every row and that is the honest reading of a read-only tool.
 *
 * THE FIVE FILES ARE FIVE DIFFERENT AMOUNTS OF WORK, on purpose: a JPEG with
 * no metadata at all, one with a full camera block, one with a camera block
 * plus a GPS IFD and an embedded thumbnail, a WebP carrying EXIF, XMP and an
 * ICC profile at once, and a PNG whose metadata is text chunks. A parser that
 * was fast because it stopped early shows up as a flat parse time across all
 * five with an empty category list on the last three.
 *
 * THE SIXTH CASE IS THE ONE THE PAGE QUOTES. It drives the viewer, then the
 * remover, then the viewer again on what the remover handed back, and records
 * the categories present on each side. That before-and-after pair is the
 * measured version of the sentence the two tools make together — "this is what
 * is in your photo" and "this is what is left" — and it is a measurement rather
 * than a claim because the second inspection reads the downloaded file.
 */
function scenarioK() {
    const viewer = (id, name, label) => ({
        id,
        sample: `${name} (metadata fixture)`,
        label,
        tool: 'image-metadata-viewer',
        route: '/image-metadata-viewer',
        settings: {},
        async play(page, { outDir }) {
            const source = metadataFixture(name);
            const run = await inspectImageMetadata(page, {
                file: source,
                outFile: path.join(outDir, `${id}.json`),
            });

            return {
                input: await describe(source),
                wallMs: run.wallMs,
                parseMs: run.parseMs,
                categories: run.categories,
                fields: run.report.exif.fields.length,
                problems: run.report.problems,
                file: path.relative(ROOT, run.file),
                // A read-only tool writes no image, so there is nothing to
                // weigh against the input and nothing to score.
                output: null,
                ratio: null,
                psnr: null,
                ssim: null,
                note: run.categories.length === 0
                    ? `nothing found; parsed in ${run.parseMs} ms`
                    : `${run.categories.join(', ')}; parsed in ${run.parseMs} ms`,
            };
        },
    });

    return {
        id: 'metadata-viewer',
        title: 'K — /image-metadata-viewer, five files and one round trip',
        note: 'Read the Time column and the per-case `parseMs` in the results JSON; Out, Ratio, PSNR '
            + 'and SSIM are dashes on every row because this tool writes no image and never decodes '
            + 'one. The five files carry deliberately different amounts of metadata, so a parser that '
            + 'was quick because it gave up early reads as a flat parse time with empty categories. '
            + 'The last row is the round trip the page quotes: inspect, remove, inspect again, with '
            + 'the categories present on each side read out of the downloaded reports rather than off '
            + 'the screen.',
        cases: [
            viewer('metadata-plain', 'plain.jpg', 'plain.jpg — a JPEG with no metadata at all'),
            viewer('metadata-exif-camera', 'exif-camera.jpg', 'exif-camera.jpg — a full camera block'),
            viewer('metadata-gps', 'gps-greenwich.jpg', 'gps-greenwich.jpg — camera, GPS and a thumbnail'),
            viewer('metadata-webp', 'webp-exif-xmp.webp', 'webp-exif-xmp.webp — EXIF, XMP and ICC at once'),
            viewer('metadata-png-text', 'png-alpha-text.png', 'png-alpha-text.png — PNG text chunks'),
            {
                id: 'inspect-strip-inspect',
                sample: 'gps-greenwich.jpg (metadata fixture)',
                label: 'Inspect, remove the metadata, inspect what came back',
                tool: 'image-metadata-viewer',
                route: '/image-metadata-viewer',
                settings: {},
                async play(page, { outDir }) {
                    const source = metadataFixture('gps-greenwich.jpg');

                    const before = await inspectImageMetadata(page, {
                        file: source,
                        outFile: path.join(outDir, 'round-trip-before.json'),
                    });

                    const cleaned = path.join(outDir, 'round-trip-cleaned.jpg');
                    const removal = await stripMetadata(page, { file: source, outFile: cleaned });

                    const after = await inspectImageMetadata(page, {
                        file: cleaned,
                        outFile: path.join(outDir, 'round-trip-after.json'),
                    });

                    const input = await describe(source);
                    const output = await describe(cleaned);

                    const left = after.categories;
                    const samePicture = input.width === output.width && input.height === output.height;

                    return {
                        input,
                        output,
                        ratio: output.bytes / input.bytes,
                        wallMs: before.wallMs + removal.wallMs + after.wallMs,
                        parseMs: before.parseMs,
                        panel: removal.panel,
                        categoriesBefore: before.categories,
                        categoriesAfter: left,
                        file: path.relative(ROOT, cleaned),
                        psnr: null,
                        ssim: null,
                        note: left.length > 0 || !samePicture
                            ? `STILL PRESENT AFTER REMOVAL: ${left.join(', ') || 'the picture changed size'}`
                            : `${before.categories.join(', ')} → nothing, `
                                + `${input.bytes - output.bytes} bytes smaller, pixels untouched`,
                    };
                },
            },
        ],
    };
}

/* ------------------------------------------------------------------ *
 * The favicon generator, which is the only tool here whose answer is a
 * set of files rather than a file
 * ------------------------------------------------------------------ */

const FAVICON_ROUTE = '/favicon-generator';

/** The package, in the order the registry states it. The ZIP order too. */
const ICON_PACKAGE = [
    'favicon.ico',
    'favicon-16x16.png',
    'favicon-32x32.png',
    'apple-touch-icon.png',
    'android-chrome-192x192.png',
    'android-chrome-512x512.png',
    'site.webmanifest',
];

/** The five rasters a visitor can open, and the square each one has to be. */
const ICON_RASTERS = {
    'favicon-16x16.png': 16,
    'favicon-32x32.png': 32,
    'apple-touch-icon.png': 180,
    'android-chrome-192x192.png': 192,
    'android-chrome-512x512.png': 512,
};

/** The background presets, by the radio each one is chosen with. */
const ICON_BACKGROUNDS = { transparent: 'Transparent', white: 'White', black: 'Black' };

/** Saves whatever a click downloads, under a name this runner chose. */
async function saveClick(page, locator, outFile) {
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    const [saved] = await Promise.all([page.waitForEvent('download'), locator.click()]);
    await saved.saveAs(outFile);
    return { file: outFile, filename: saved.suggestedFilename(), bytes: fs.statSync(outFile).size };
}

/**
 * One package through the real page, every file of it saved.
 *
 * WHY THIS DOES NOT GO THROUGH `measure`. That helper exists for a tool with
 * one answer: press the button, wait for the one download affordance, save the
 * one file. This page answers with seven, so waiting for "a button whose name
 * starts with Download" would match six of them at once. The wall clock is
 * taken the same way regardless — the click to the moment the result is on
 * screen, which is the span a person actually waits — and the page also stamps
 * its own `data-generate-ms` on the result section, so the two can be read
 * against each other rather than one being trusted.
 */
async function generateIcons(page, { file, settings, outDir, prefix }) {
    await open(page, FAVICON_ROUTE);

    if (settings.geometry === 'contain') {
        await page.getByRole('radio', { name: 'Fit inside square' }).check();
    }

    // The background is always set, even to the value the page already holds —
    // the same rule the converter and the fitter follow here, and for the same
    // reason: a benchmark that leans on a default is a benchmark whose numbers
    // move the day somebody changes one, silently.
    if (settings.background.startsWith('#')) {
        await page.getByRole('radio', { name: 'Custom', exact: true }).check();
        await page.locator('#icon-background-custom').fill(settings.background);
    } else {
        await page.getByRole('radio', { name: ICON_BACKGROUNDS[settings.background], exact: true }).check();
    }

    await pickFile(page, file, 'Generate icons');

    const started = Date.now();
    await page.getByRole('button', { name: 'Generate icons' }).click();

    const heading = page.getByRole('heading', { name: 'Icons ready' });
    try {
        await heading.waitFor({ state: 'visible', timeout: RESULT_TIMEOUT });
    } catch (error) {
        const said = await panelError(page);
        throw new Error(said || `no package within ${RESULT_TIMEOUT} ms (${error.message})`);
    }
    const wallMs = Date.now() - started;

    // The page's own measurement of the work, which excludes the render the
    // wall clock above includes. Reported beside it rather than instead of it.
    const stamped = await page.locator('section[aria-labelledby="icon-result-heading"]')
        .getAttribute('data-generate-ms');
    const generateMs = Number(stamped);

    const saved = [];
    for (const filename of ICON_PACKAGE) {
        // site.webmanifest is text the page assembles rather than bytes a
        // codec wrote, and it is saved like the rest: it is a file in the
        // package a visitor puts at their site root.
        const button = page.getByRole('button', { name: `Download ${filename}`, exact: true });
        saved.push(await saveClick(page, button, path.join(outDir, prefix, filename)));
    }

    const zip = await saveClick(
        page,
        page.getByRole('button', { name: 'Download all as ZIP' }),
        path.join(outDir, `${prefix}.zip`),
    );

    return {
        wallMs,
        generateMs: Number.isFinite(generateMs) ? generateMs : null,
        saved,
        zip,
    };
}

/**
 * L — /favicon-generator, five packages.
 *
 * WHAT IS BEING MEASURED, AND WHY THE RATIO READS ABOVE 100% ON EVERY ROW.
 * Every other scenario in this file asks "how much smaller, and at what cost in
 * quality". This tool is not a compressor: one mark goes in and seven files
 * come out, so the Out column is the ARCHIVE — the thing a visitor actually
 * takes away — and a ratio over 100% is the correct reading rather than a
 * regression. PSNR and SSIM are null on every row, because a 16 × 16 icon is
 * not a version of a 640 × 400 logo that any metric can score: there is no
 * geometry in which the two can be put side by side.
 *
 * WHAT EACH CASE IS FOR, since none of them is a rank against the others:
 *
 *   crop-to-square   the page's defaults on the page's own sample, and the
 *                    row scripts/generate-demos.js cuts the figure from
 *   fit-transparent  the other geometry on the same mark: padded instead of
 *                    cropped, and the padding left clear
 *   fit-white        the same again onto white, which is the pair that says
 *                    what a background costs in bytes for an identical picture
 *   custom-colour    a colour somebody typed, with the corner pixel recorded
 *                    so "the fill was the colour asked for" is a measurement
 *   low-res-source   a 128 px mark enlarged four times over for the 512, which
 *                    is the one row where the tool is asked for detail that
 *                    does not exist
 *
 * Every row records each asset's own byte length, the ICO's directory as the
 * independent parser reads it, and the page's own `data-generate-ms` beside
 * the wall clock. A row is a pass when the archive holds the seven package
 * files and every raster is exactly the square its name claims — read from
 * libvips and from that parser, never from the panel.
 */
function scenarioL() {
    const markSample = 'logo-mark-640x400.png';
    const markSource = () => path.join(ROOT, 'public', 'samples', markSample);

    /** Every saved file, reopened: the rasters by libvips, the ICO by its own reader. */
    async function describePackage(saved) {
        const assets = [];

        for (const file of saved) {
            const entry = {
                filename: file.filename,
                file: path.relative(ROOT, file.file),
                bytes: file.bytes,
            };

            if (ICON_RASTERS[file.filename] !== undefined) {
                const meta = await describe(file.file);
                Object.assign(entry, {
                    width: meta.width,
                    height: meta.height,
                    format: meta.format,
                    hasAlpha: meta.hasAlpha,
                    // A raster that is not the square its own name claims is
                    // the failure this tool has to be judged on, and the row
                    // says so as a value rather than in prose.
                    exact: meta.width === ICON_RASTERS[file.filename]
                        && meta.height === ICON_RASTERS[file.filename],
                });
            }

            assets.push(entry);
        }

        return assets;
    }

    /** The ICO's directory, read by the parser the E2E suite uses. */
    function describeIco(file) {
        try {
            const read = assertPngIco(fs.readFileSync(file), { sizes: [16, 32, 48] });
            return {
                ok: true,
                count: read.header.count,
                entries: read.entries.map((entry) => ({
                    width: entry.width, bytes: entry.bytes, offset: entry.offset, isPng: entry.isPng,
                })),
            };
        } catch (error) {
            return { ok: false, count: null, entries: [], error: error.message };
        }
    }

    function iconCase({
        id, sample, source, label, settings, remark = null,
    }) {
        return {
            id,
            sample,
            label,
            tool: 'favicon-generator',
            route: FAVICON_ROUTE,
            settings,
            async play(page, { outDir }) {
                const from = await source();
                const run = await generateIcons(page, {
                    file: from, settings, outDir, prefix: id,
                });

                const input = await describe(from);
                const assets = await describePackage(run.saved);
                const ico = describeIco(path.join(outDir, id, 'favicon.ico'));
                const entries = (await readZip(run.zip.file)).map((entry) => entry.name);

                const wrong = assets.filter((asset) => asset.exact === false).map((asset) => asset.filename);
                const missing = ICON_PACKAGE.filter((name) => !entries.includes(name));

                // A corner is transparent in every source here by construction,
                // so what it holds afterwards is the fill and nothing else.
                const corner = await cornerPixel(path.join(outDir, id, 'android-chrome-512x512.png'));

                const verdict = [
                    missing.length > 0 ? `THE ARCHIVE IS MISSING ${missing.join(', ')}` : null,
                    wrong.length > 0 ? `WRONG SIZE: ${wrong.join(', ')}` : null,
                    ico.ok ? null : `THE ICO IS MALFORMED: ${ico.error}`,
                ].filter(Boolean);

                return {
                    input,
                    // The archive is the answer, so it is what the Out column
                    // weighs. libvips has nothing to say about a ZIP and is
                    // not asked — the bytes come off the disk.
                    output: {
                        bytes: run.zip.bytes,
                        width: null,
                        height: null,
                        format: 'zip',
                        density: null,
                        hasAlpha: false,
                    },
                    assets,
                    ico,
                    corner,
                    zip: { bytes: run.zip.bytes, filename: run.zip.filename, entries },
                    generateMs: run.generateMs,
                    wallMs: run.wallMs,
                    ratio: input.bytes === 0 ? null : run.zip.bytes / input.bytes,
                    file: path.relative(ROOT, run.zip.file),
                    filename: run.zip.filename,
                    psnr: null,
                    ssim: null,
                    note: [
                        verdict.length > 0
                            ? verdict.join('; ')
                            : `met: ${entries.length} files, every raster exact, ICO ${ico.entries.map((entry) => entry.width).join('/')}`,
                        remark ? remark({ input, assets, corner }) : null,
                    ].filter(Boolean).join('. '),
                };
            },
        };
    }

    return {
        id: 'favicon',
        title: 'L — /favicon-generator, five packages',
        note: 'Rows to be read as pass/fail rather than ranked: a package either holds the seven files '
            + 'at the exact squares their names claim or it does not, and the note says which — from '
            + 'libvips and from an ICO parser written from Microsoft’s structure, never from the '
            + 'panel. The Out column is the ARCHIVE rather than any one file, so the ratio reads above '
            + '100% on every row and that is correct: one mark goes in and seven files come out. PSNR '
            + 'and SSIM are null throughout, because a 16 × 16 icon is not a version of the logo '
            + 'that any metric can score. Each case also records every asset’s own byte length, '
            + 'the ICO’s directory, the corner pixel of the 512 (transparent in every source here '
            + 'by construction, so what it holds afterwards is the fill) and the page’s own '
            + '`data-generate-ms` beside the wall clock, which includes the render.',
        cases: [
            iconCase({
                id: 'favicon-crop-to-square',
                sample: `${markSample} (public sample)`,
                source: async () => markSource(),
                // The page's own defaults on the page's own sample, and the row
                // scripts/generate-demos.js cuts its figure from — so a rename
                // here is a rename there, and that script fails loudly rather
                // than copying a stale file.
                label: `${markSample} → cropped to square, transparent (the page's figure)`,
                settings: { geometry: 'cover', background: 'transparent' },
            }),
            iconCase({
                id: 'favicon-fit-transparent',
                sample: `${markSample} (public sample)`,
                source: async () => markSource(),
                label: `${markSample} → fitted inside the square, padding left clear`,
                settings: { geometry: 'contain', background: 'transparent' },
                remark: ({ corner }) => `corner alpha ${corner.a}`
                    + (corner.a === 0 ? '' : ' — THE PADDING IS NOT TRANSPARENT'),
            }),
            iconCase({
                id: 'favicon-fit-white',
                sample: `${markSample} (public sample)`,
                source: async () => markSource(),
                // The same picture as the row above with one thing changed, so
                // the byte difference between the two IS the cost of a
                // background rather than a difference in the drawing.
                label: `${markSample} → fitted inside the square on white`,
                settings: { geometry: 'contain', background: 'white' },
                remark: ({ corner }) => `corner rgb(${corner.r},${corner.g},${corner.b}) alpha ${corner.a}`,
            }),
            iconCase({
                id: 'favicon-custom-colour',
                sample: `${markSample} (public sample)`,
                source: async () => markSource(),
                label: `${markSample} → cropped to square on #2f6fed`,
                settings: { geometry: 'cover', background: '#2f6fed' },
                remark: ({ corner }) => {
                    const wanted = { r: 0x2f, g: 0x6f, b: 0xed };
                    const off = ['r', 'g', 'b'].some((channel) => Math.abs(corner[channel] - wanted[channel]) > 2);
                    return `corner rgb(${corner.r},${corner.g},${corner.b})`
                        + (off ? ' — NOT THE COLOUR THAT WAS ASKED FOR' : '');
                },
            }),
            iconCase({
                id: 'favicon-low-res',
                sample: 'logo-mark-128x128.png (E2E fixture)',
                source: lowResLogo,
                // The one row asked for detail that does not exist: 128 px
                // enlarged four times over to fill the 512. It is a warning on
                // the page rather than a refusal, so the row has to show that
                // the file still came out at the size it promises.
                label: 'logo-mark-128x128.png → enlarged four times over for the 512',
                settings: { geometry: 'cover', background: 'transparent' },
                remark: ({ input }) => `source ${input.width} × ${input.height}, enlarged for the 512`,
            }),
        ],
    };
}

async function runCase(browser, scenario, entry) {
    const outDir = path.join(OUTPUT_DIR, scenario.id);
    fs.mkdirSync(outDir, { recursive: true });

    const started = Date.now();
    process.stdout.write(`  ${entry.label} … `);

    const record = {
        id: entry.id,
        sample: entry.sample,
        label: entry.label,
        tool: entry.tool,
        route: entry.route,
        settings: entry.settings,
        ok: true,
    };

    try {
        const measured = await withPage(browser, async (page, watched) => {
            const result = await entry.play(page, { outDir });
            const strays = offDevice(watched.requests);

            if (watched.requests.length === 0) throw new Error('no requests observed — the page never loaded');
            if (strays.length > 0) throw new Error(`request left the device: ${strays.join(', ')}`);
            if (watched.pageErrors.length > 0) throw new Error(`page error: ${watched.pageErrors.join(' / ')}`);

            return { ...result, requests: watched.requests.length };
        });

        Object.assign(record, measured);
        process.stdout.write(`ok (${((Date.now() - started) / 1000).toFixed(1)} s)\n`);
    } catch (error) {
        record.ok = false;
        record.error = error.message.replace(/\s+/g, ' ').trim().slice(0, 300);
        process.stdout.write(`FAILED — ${record.error}\n`);
    }

    return record;
}

/**
 * An interrupted run publishes nothing.
 *
 * Ctrl-C, or a kill from a supervisor, tears the browser out from under the
 * remaining cases: they record "browser has been closed", the run reaches the
 * end anyway and overwrites results/latest.json with a file full of failures
 * that describe the interruption rather than the product. That happened here,
 * and it cost a reviewer a trip through a results file that was never real. A
 * failure the TOOL produced is still recorded and still shipped — that rule is
 * untouched — but a run somebody stopped is not a measurement at all.
 */
function refuseToPublishOnInterrupt() {
    for (const signal of ['SIGINT', 'SIGTERM']) {
        process.on(signal, () => {
            process.stderr.write(
                `\n${signal} — stopping without writing a results file. `
                + 'The last complete run stands.\n',
            );
            process.exit(130);
        });
    }
}

async function main() {
    refuseToPublishOnInterrupt();

    for (const sample of ALL_SAMPLES) {
        if (!fs.existsSync(samplePath(sample.file))) {
            process.stderr.write(
                `\nMissing benchmark sample ${sample.file}.\n`
                + 'Run `npm run generate:bench-samples` first.\n\n',
            );
            process.exit(1);
        }
    }

    await requireServer();

    const all = [
        scenarioA(), scenarioB(), scenarioC(), scenarioD(), scenarioE(), scenarioF(), scenarioG(),
        scenarioH(), scenarioI(), scenarioJ(), scenarioK(), scenarioL(),
    ];

    /**
     * BENCH_SCENARIOS=dpi,fit-20kb runs a subset while iterating. Such a run
     * writes NO results file: a partial results.json that looked like a full
     * one is exactly the artefact that ends up committed and quoted.
     */
    const only = (process.env.BENCH_SCENARIOS || '').split(',').map((id) => id.trim()).filter(Boolean);
    const scenarios = only.length > 0 ? all.filter((scenario) => only.includes(scenario.id)) : all;

    if (scenarios.length === 0) {
        process.stderr.write(
            `\nBENCH_SCENARIOS matched nothing. Known ids: ${all.map((s) => s.id).join(', ')}\n\n`,
        );
        process.exit(1);
    }

    const browser = await chromium.launch();
    const started = Date.now();

    const results = {
        schema: SCHEMA,
        generatedAt: new Date().toISOString(),
        environment: environment(browser),
        scenarios: [],
    };

    try {
        for (const scenario of scenarios) {
            process.stdout.write(`\n${scenario.title}\n`);
            const cases = [];
            for (const entry of scenario.cases) cases.push(await runCase(browser, scenario, entry));
            // `note` carries the caveat the table needs beside it — the reason a
            // ratio can read 393%. Dropping it here once left every one of those
            // rows unexplained in the rendered report.
            results.scenarios.push({
                id: scenario.id,
                title: scenario.title,
                note: scenario.note ?? null,
                cases,
            });
        }

        // Before the teardown, so the figure is time spent measuring rather
        // than time spent closing a browser.
        results.durationMs = Date.now() - started;
    } finally {
        await browser.close();
    }

    results.environment.loadAtEnd = os.loadavg().map((value) => Number(value.toFixed(2)));

    const busy = results.environment.loadAtStart[0] > results.environment.cores;
    if (busy) {
        process.stderr.write(
            `\nNOTE: load average was ${results.environment.loadAtStart[0]} on `
            + `${results.environment.cores} cores when this run started.\n`
            + 'Sizes and quality scores are unaffected — they are deterministic for a\n'
            + 'given build — but every wallMs figure here is inflated by that contention.\n\n',
        );
    }

    const finishedOn = buildId();
    results.environment.buildStable = results.environment.buildId === null
        || results.environment.buildId === finishedOn;

    if (!results.environment.buildStable) {
        process.stderr.write(
            `\nWARNING: the build changed under this run (${results.environment.buildId} → ${finishedOn}).\n`
            + 'Something rebuilt .next while the server was serving out of it, so these\n'
            + 'numbers describe two different builds. Re-run against a settled build.\n\n',
        );
    }

    const day = results.generatedAt.slice(0, 10);

    if (only.length === 0) {
        fs.mkdirSync(RESULTS_DIR, { recursive: true });
        const body = `${JSON.stringify(results, null, 2)}\n`;
        fs.writeFileSync(path.join(RESULTS_DIR, `${day}.json`), body);
        fs.writeFileSync(path.join(RESULTS_DIR, 'latest.json'), body);
    }

    const total = results.scenarios.reduce((sum, scenario) => sum + scenario.cases.length, 0);
    const failed = results.scenarios.reduce(
        (sum, scenario) => sum + scenario.cases.filter((entry) => !entry.ok).length,
        0,
    );

    process.stdout.write(`\n${renderReport(results)}\n`);
    process.stdout.write(
        `${total - failed}/${total} cases measured, ${failed} failed, `
        + `in ${(results.durationMs / 1000).toFixed(1)} s\n`
        + (only.length === 0
            ? `results/${day}.json and results/latest.json written\n`
            : 'partial run (BENCH_SCENARIOS set) — no results file written\n')
        + `outputs under ${path.relative(ROOT, OUTPUT_DIR)}/\n`,
    );

    process.exitCode = failed > 0 || !results.environment.buildStable ? 1 : 0;
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
