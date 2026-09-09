#!/usr/bin/env node
/**
 * Demo assets for the tool pages
 *
 * Copies the files a benchmark run already produced into public/demos/ under
 * stable names, and prepares the one "before" image that needs preparing.
 *
 * THE RULE THIS SCRIPT EXISTS TO ENFORCE: every "after" image on the site is
 * the tool's own output, byte for byte. Nothing here re-encodes one, resizes
 * one, sharpens one or draws on one. A figure claiming to show what /compress
 * did to a photograph has to be the file /compress wrote, or the figure is an
 * illustration of a claim rather than evidence for it.
 *
 * The "before" side is allowed one transformation and only one: a downscale,
 * so the page does not ship a 384 KB source image. Where that happens the
 * caption on the page says so. sharp is the devDependency doing it, which is
 * fine here — scripts/ is a build tool, not the product (CLAUDE.md > Gotchas).
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
    { scenario: 'demo-outputs', case: 'signature-300x80', to: 'signature-300x80.jpg' },
];

/** The one "before" that is prepared rather than copied. The caption says so. */
const DOWNSCALES = [
    {
        from: path.join(SAMPLES, 'photo-1600x1067.jpg'),
        to: 'photo-source-800x534.jpg',
        width: 800,
        quality: 74,
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

    // The signature "before" is the same fixture the benchmark fed the tool,
    // built by the E2E helper rather than committed — three of those four
    // fixtures are defined by bytes nobody can read in a diff, so they are
    // generated from sharp on demand. Taking it from anywhere else would show
    // a before that is not the before that was measured.
    const { signature } = require('../tests/e2e/helpers/fixtures');
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
        if (!fs.existsSync(scale.from)) {
            missing(scale.from, 'A benchmark sample this page needs is not on disk.');
        }

        await sharp(scale.from)
            .resize({ width: scale.width })
            .jpeg({ quality: scale.quality, chromaSubsampling: '4:2:0', mozjpeg: false })
            .toFile(path.join(OUT_DIR, scale.to));

        total += report(scale.to);
    }

    process.stdout.write(`${''.padEnd(32)} ${(total / 1024).toFixed(1)} KB written (public/demos also holds hand-written SVG diagrams)\n`);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
