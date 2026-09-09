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
const { SAMPLES, SAMPLES_DIR } = require('./lib/samples');

/**
 * Scenario E's inputs are the E2E suite's own fixtures — an EXIF+GPS JPEG and a
 * scan-shaped signature PNG, both written by sharp into os.tmpdir(). They are
 * borrowed rather than re-specified so the demo assets are made from the exact
 * files the tests drive those two tools with.
 */
const { exifGpsJpeg, signature } = require('../tests/e2e/helpers/fixtures');

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

const sampleByName = (name) => SAMPLES.find((entry) => entry.file === name);
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
 * E — one pass through each of the three remaining tools, for the demo assets.
 * These are outputs to look at rather than numbers to rank, so the table stays
 * shallow: what went in, what came out, and where the file landed.
 */
function scenarioE() {
    const photo = sampleByName('photo-1600x1067.jpg');

    return {
        id: 'demo-outputs',
        title: 'E — one pass through crop, signature resizer and metadata removal',
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

/* ------------------------------------------------------------------ *
 * The run
 * ------------------------------------------------------------------ */

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

async function main() {
    for (const sample of SAMPLES) {
        if (!fs.existsSync(samplePath(sample.file))) {
            process.stderr.write(
                `\nMissing benchmark sample ${sample.file}.\n`
                + 'Run `npm run generate:bench-samples` first.\n\n',
            );
            process.exit(1);
        }
    }

    await requireServer();

    const all = [scenarioA(), scenarioB(), scenarioC(), scenarioD(), scenarioE()];

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
