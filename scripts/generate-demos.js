#!/usr/bin/env node
/**
 * Demo assets for the tool pages
 *
 * Copies the files a benchmark run already produced into public/demos/ under
 * stable names, and prepares the two "before" images that need preparing.
 *
 * THE RULE THIS SCRIPT EXISTS TO ENFORCE: every "after" image on the site is
 * the tool's own output, byte for byte. Nothing here re-encodes one, resizes
 * one, sharpens one or draws on one. A figure claiming to show what /compress
 * did to a photograph has to be the file /compress wrote, or the figure is an
 * illustration of a claim rather than evidence for it.
 *
 * The "before" side is allowed one transformation and only one: a downscale,
 * so the page does not ship a 384 KB source image at full size. Where that happens the
 * caption on the page says so, and where it does not — a before small enough
 * to ship as it is — the file is copied untouched. sharp is the devDependency
 * doing the downscale, which is fine here: scripts/ is a build tool, not the
 * product (CLAUDE.md > Gotchas).
 *
 * Nothing in here draws text. A label baked into a raster is unreadable to a
 * screen reader, unselectable, unsearchable and wrong in the other theme; the
 * labels live in the page's own markup instead.
 *
 * The byte length of every copied output is checked against the number
 * benchmarks/results/latest.json recorded for that case. A stale outputs/
 * directory — a run from an older build, or a half-finished one — is otherwise
 * indistinguishable from a fresh one, and would put a figure on the site that
 * disagrees with the caption above it.
 *
 * Usage:
 *   npm run bench        # once, to produce benchmarks/outputs/
 *   npm run generate:demos
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'public', 'demos');
const RESULTS = path.join(ROOT, 'benchmarks', 'results', 'latest.json');
const SAMPLES = path.join(ROOT, 'benchmarks', 'samples');

const results = JSON.parse(fs.readFileSync(RESULTS, 'utf8'));

function benchCase(scenarioId, caseId) {
    const scenario = results.scenarios.find((entry) => entry.id === scenarioId);
    const found = scenario && scenario.cases.find((entry) => entry.id === caseId);

    if (!found) {
        throw new Error(`benchmarks/results/latest.json has no case ${scenarioId}/${caseId}`);
    }

    return found;
}

/**
 * The tool's own bytes. `from` is read out of the case rather than typed, so a
 * renamed output cannot be silently replaced by a stale file of the old name.
 */
const COPIES = [
    { scenario: 'jpeg-vs-webp', case: 'photo-1600x1067-jpg-jpeg-100kb', to: 'photo-compressed-100kb.jpg' },
    { scenario: 'demo-outputs', case: 'crop-photo', to: 'photo-crop-900x600.jpg' },
    // Asked for a 300×80 box; fit inside it came back 240×80, and the file is named for what it is.
    { scenario: 'demo-outputs', case: 'signature-300x80', to: 'signature-fitted-240x80.jpg' },
    { scenario: 'demo-outputs', case: 'transparent-on-white', to: 'transparent-on-white-480x320.jpg' },
    // The passport tool's own output for the US printed preset: 600×600 at
    // 300 DPI. Copied, never re-encoded — a figure about hitting an exact
    // pixel count and an exact density has to BE the file that hit them.
    { scenario: 'passport-photo', case: 'passport-us-600x600', to: 'portrait-passport-600x600.jpg' },
    // The bulk page's own output for the photo in its four-file batch. The
    // figure beside it on the page is a table of what a batch did, and the
    // "after" in that table has to be a file the batch actually wrote.
    { scenario: 'bulk-compress', case: 'bulk-photo-1600x1067', to: 'bulk-compressed-photo-200kb.jpg' },
    // The bulk converter's own WebP, made from the transparent PNG that is
    // already copied below as the "before" of the same figure. The claim on
    // that page is that a see-through PNG comes back see-through in a smaller
    // container, and the only honest way to show it is the file the converter
    // wrote — a re-encode here would be an illustration of the claim rather
    // than evidence for it, and this is the one figure on the site where the
    // thing being demonstrated is invisible until the browser draws the alpha.
    { scenario: 'bulk-convert', case: 'convert-transparent-png-to-webp', to: 'transparent-480x320-converted.webp' },
];

/**
 * A "before" that is the input file itself, byte for byte.
 *
 * The photo source below is downscaled because shipping 384 KB to show a
 * before would cost more than the demonstration is worth. This one is 4 KB and
 * has nothing to trade: re-encoding it would mean the page shows a picture of
 * the transparency rather than the transparency, and a PNG is what keeps the
 * alpha channel a browser needs to draw it over the checkerboard. So it is
 * copied untouched, and its length is checked against the bytes the run
 * recorded going IN — the same staleness check the outputs get, pointed at the
 * other end of the case.
 */
const SOURCES = [
    {
        scenario: 'demo-outputs',
        case: 'transparent-on-white',
        from: 'transparent-480x320.png',
        to: 'transparent-source-480x320.png',
    },
];

/**
 * The "before" images that are prepared rather than copied. The caption on the
 * page says so, and the downscale is the ONLY transformation allowed anywhere
 * in this script.
 *
 * `measured` is what keeps a prepared before honest. The file is transformed,
 * so its own byte length proves nothing — but the sample it is made FROM is
 * the file the benchmark actually fed the tool, and that length is recorded in
 * the results. Checking it here catches the one failure this arrangement has:
 * regenerating the samples without re-running the benchmark, which would put a
 * before on the page that is not the before the after came from.
 */
const DOWNSCALES = [
    {
        from: 'photo-1600x1067.jpg',
        to: 'photo-source-800x534.jpg',
        width: 800,
        quality: 74,
        measured: { scenario: 'jpeg-vs-webp', case: 'photo-1600x1067-jpg-jpeg-100kb' },
    },
    {
        from: 'portrait-1200x1600.jpg',
        to: 'portrait-source-480x640.jpg',
        width: 480,
        quality: 74,
        measured: { scenario: 'passport-photo', case: 'passport-us-600x600' },
    },
];

function missing(file, why) {
    process.stderr.write(`${why}\n  ${path.relative(ROOT, file)}\n\nRun \`npm run bench\` first — it drives the real pages and writes benchmarks/outputs/.\n`);
    process.exit(1);
}

function report(name) {
    const { size } = fs.statSync(path.join(OUT_DIR, name));
    process.stdout.write(`${name.padEnd(32)} ${(size / 1024).toFixed(1)} KB\n`);
    return size;
}

async function main() {
    fs.mkdirSync(OUT_DIR, { recursive: true });

    let total = 0;

    for (const copy of COPIES) {
        const measured = benchCase(copy.scenario, copy.case);
        const from = path.join(ROOT, measured.file);

        if (!fs.existsSync(from)) missing(from, `A benchmark output this page needs is not on disk.`);

        const { size } = fs.statSync(from);
        if (size !== measured.output.bytes) {
            process.stderr.write(
                `benchmarks/outputs is stale: ${measured.file} is ${size} bytes, but the results file `
                + `records ${measured.output.bytes} for ${copy.scenario}/${copy.case}.\n\n`
                + 'Run `npm run bench` so the outputs and the numbers describe one run.\n',
            );
            process.exit(1);
        }

        fs.copyFileSync(from, path.join(OUT_DIR, copy.to));
        total += report(copy.to);
    }

    for (const source of SOURCES) {
        const measured = benchCase(source.scenario, source.case);
        const from = path.join(SAMPLES, source.from);

        if (!fs.existsSync(from)) {
            missing(from, 'A benchmark sample this page needs is not on disk.');
        }

        const { size } = fs.statSync(from);
        if (size !== measured.input.bytes) {
            process.stderr.write(
                `benchmarks/samples is out of step: ${source.from} is ${size} bytes, but the results file `
                + `records ${measured.input.bytes} going into ${source.scenario}/${source.case}.\n\n`
                + 'Run `npm run generate:bench-samples` and then `npm run bench`, so the before on the page '
                + 'is the file that was measured.\n',
            );
            process.exit(1);
        }

        fs.copyFileSync(from, path.join(OUT_DIR, source.to));
        total += report(source.to);
    }

    // The signature "before" is the same fixture the benchmark fed the tool,
    // built by the E2E helper rather than committed — three of those four
    // fixtures are defined by bytes nobody can read in a diff, so they are
    // generated from sharp on demand. Taking it from anywhere else would show
    // a before that is not the before that was measured.
    const { signature } = require('../tests/e2e/fixtures/files');
    const signatureCase = benchCase('demo-outputs', 'signature-300x80');
    const signatureSource = await signature();
    const signatureSize = fs.statSync(signatureSource).size;

    if (signatureSize !== signatureCase.input.bytes) {
        process.stderr.write(
            `The signature fixture is ${signatureSize} bytes; the run measured ${signatureCase.input.bytes}.\n`
            + 'Run `npm run bench` so the figure and its caption describe one file.\n',
        );
        process.exit(1);
    }

    fs.copyFileSync(signatureSource, path.join(OUT_DIR, 'signature-source-600x200.png'));
    total += report('signature-source-600x200.png');

    const sharp = require('sharp');

    for (const scale of DOWNSCALES) {
        const from = path.join(SAMPLES, scale.from);

        if (!fs.existsSync(from)) {
            missing(from, 'A benchmark sample this page needs is not on disk.');
        }

        const measured = benchCase(scale.measured.scenario, scale.measured.case);
        const { size } = fs.statSync(from);

        if (size !== measured.input.bytes) {
            process.stderr.write(
                `benchmarks/samples is out of step: ${scale.from} is ${size} bytes, but the results file `
                + `records ${measured.input.bytes} going into ${scale.measured.scenario}/${scale.measured.case}.\n\n`
                + 'Run `npm run generate:bench-samples` and then `npm run bench`, so the before on the page '
                + 'is a downscale of the file that was measured.\n',
            );
            process.exit(1);
        }

        await sharp(from)
            .resize({ width: scale.width })
            .jpeg({ quality: scale.quality, chromaSubsampling: '4:2:0', mozjpeg: false })
            .toFile(path.join(OUT_DIR, scale.to));

        total += report(scale.to);
    }

    // The passport page offers the generated portrait as its "try the sample"
    // file, full size and untouched: the same bytes the benchmark fed the
    // tool, so the figure on the page and the sample a visitor tries are one
    // file. It lives beside the resize samples in public/samples, not among
    // the demos, because it is an input, not evidence.
    const portraitCase = benchCase('passport-photo', 'passport-us-600x600');
    const portraitSample = path.join(SAMPLES, 'portrait-1200x1600.jpg');
    const portraitSize = fs.statSync(portraitSample).size;

    if (portraitSize !== portraitCase.input.bytes) {
        process.stderr.write(
            `benchmarks/samples is out of step: portrait-1200x1600.jpg is ${portraitSize} bytes, but the results `
            + `file records ${portraitCase.input.bytes} going into passport-photo/passport-us-600x600.\n`,
        );
        process.exit(1);
    }

    const samplesDir = path.join(ROOT, 'public', 'samples');
    fs.mkdirSync(samplesDir, { recursive: true });
    fs.copyFileSync(portraitSample, path.join(samplesDir, 'portrait-1200x1600.jpg'));
    process.stdout.write(`${'samples/portrait-1200x1600.jpg'.padEnd(32)} ${(portraitSize / 1024).toFixed(1)} KB (the passport page's sample, untouched)\n`);

    process.stdout.write(`${''.padEnd(32)} ${(total / 1024).toFixed(1)} KB written (public/demos also holds hand-written SVG diagrams)\n`);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
