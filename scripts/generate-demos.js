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
 * THE ONE AFTER THAT IS DOWNSCALED, AND WHY IT IS NOT A HOLE IN THE RULE ABOVE.
 * The print sheet's output is a piece of paper — 1200 × 1800 pixels of it at
 * 300 DPI, several hundred kilobytes — and public/demos is capped in total by
 * tests/app/demo-assets.test.js. Shipping that file at full size would spend
 * the whole site's figure budget on one picture, and it would not even be
 * legible: a page shows it a few hundred pixels wide, so every visitor's
 * browser downscales it anyway, badly and after paying for all of it.
 *
 * So that one figure is a PREVIEW rather than an after, and three things keep
 * it honest. It is made from the benchmark's real output rather than from a
 * mock-up. Its caption on the page states the real pixel count and the real
 * byte count of the sheet the tool wrote, not the preview's. And the name it is
 * written under carries the preview's own dimensions, which this script derives
 * from the measured output and refuses to write if they disagree — so a sheet
 * that came out a different shape fails here instead of shipping under a name
 * that describes a picture nobody made.
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
 * One file out of a case that produced several, by the name the tool gave it.
 *
 * The favicon generator is the only tool on the site whose answer is a package
 * rather than a file, so its cases record every asset. Failing loudly here is
 * the point: a renamed output must stop this script rather than leave a figure
 * on the site showing whatever the case's `file` happened to be.
 */
function benchAsset(scenarioId, caseId, filename) {
    const found = benchCase(scenarioId, caseId);
    const asset = (found.assets || []).find((entry) => entry.filename === filename);

    if (!asset) {
        throw new Error(
            `${scenarioId}/${caseId} produced no file called ${filename}`
            + ` — it produced ${(found.assets || []).map((entry) => entry.filename).join(', ') || 'nothing'}`,
        );
    }

    return asset;
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
    // The fitter's own output for a requirement with two halves that pull
    // against each other: exactly 600×600 AND under 50 KB. The figure beside it
    // claims both were met at once, so the file has to BE the one that met
    // them — a re-encode here could hit the byte count at any size at all.
    //
    // The 50 KB row rather than the 100 KB one, and that choice is about the
    // page weight rather than the tool: tests/app/demo-assets.test.js caps
    // public/demos at 600 KB in total, and a 100 KB figure would spend a sixth
    // of the budget for the whole site on one picture.
    { scenario: 'image-size-fitter', case: 'fit-square-600-50kb', to: 'fitter-600x600-50kb.jpg' },
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
    // The favicon generator's own package, four of its seven files. `asset`
    // rather than the case's single `file`, because this is the one tool on the
    // site whose answer is a SET: the case's `file` is the archive, and an
    // archive is not a figure. The four are the sizes worth showing side by
    // side — the two a tab bar picks from, the one Android installs and the one
    // a store lists — and each is the file the tool wrote, byte for byte, which
    // is the whole claim the figure makes.
    //
    // THEY ARE RENAMED ON THE WAY IN. Two of them keep their own names, and the
    // Android pair does not: a figure captioned "192" beside one captioned
    // "android-chrome-192x192" would be describing a filename rather than a
    // size, and the page is showing sizes.
    //
    // ALL FOUR HAVE TO BE REFERENCED BY A FIGURE BLOCK IN lib/catalog, or
    // tests/app/demo-assets.test.js fails them as unreferenced files: nothing
    // imports anything in public/, so an orphan there is invisible except to
    // that test. If the page's figure ends up showing only the source and the
    // 512, the other three lines here come out rather than the assertion.
    // The two AVIF figures, and the one pair on this site where the "after" is
    // a format the "before" cannot be compared to by eye. A visitor looking at
    // /convert wants to know what AVIF costs and what it keeps, so the photo
    // figure is the tool's own AVIF of the JPEG beside it — the same picture at
    // the same size, which is why the bench converts public/demos'
    // photo-source-800x534.jpg rather than the full-size sample — and the
    // transparent figure is the tool's own AVIF of the PNG beside it.
    //
    // The transparent one is the more interesting of the two and the reason
    // both are here: AVIF keeps an alpha channel where JPEG cannot, and the
    // only honest way to show that is the file the converter wrote. A re-encode
    // here would be an illustration of the claim rather than evidence for it.
    { scenario: 'avif', case: 'avif-demo-photo-800x534', to: 'photo-800x534.avif' },
    { scenario: 'avif', case: 'avif-transparent-png-to-avif', to: 'transparent-480x320.avif' },
    { scenario: 'favicon', case: 'favicon-crop-to-square', asset: 'favicon-16x16.png', to: 'favicon-16x16.png' },
    { scenario: 'favicon', case: 'favicon-crop-to-square', asset: 'favicon-32x32.png', to: 'favicon-32x32.png' },
    { scenario: 'favicon', case: 'favicon-crop-to-square', asset: 'android-chrome-192x192.png', to: 'favicon-192x192.png' },
    { scenario: 'favicon', case: 'favicon-crop-to-square', asset: 'android-chrome-512x512.png', to: 'favicon-512x512.png' },
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
    {
        // The favicon figure's "before", and the one source here that does not
        // live in benchmarks/samples: the favicon scenario is driven with the
        // file the page's own "Try the sample logo" button fetches, so the
        // picture in the figure is the picture a visitor can try in one click.
        // `dir` says where, and the length is checked against what the run
        // recorded going IN, exactly as the sample above is.
        //
        // Copied untouched rather than downscaled: it is 5 KB, and it is a PNG
        // because the transparency is half of what the figure demonstrates —
        // re-encoding it would show a picture of the transparency instead.
        scenario: 'favicon',
        case: 'favicon-crop-to-square',
        dir: path.join('public', 'samples'),
        from: 'logo-mark-640x400.png',
        to: 'favicon-source-640x400.png',
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
    // The print sheet preview, and the only entry here whose source is a
    // benchmark OUTPUT rather than a sample — see the note at the top of this
    // file for why a sheet is shown as a preview and what keeps that honest.
    // `output` rather than `from`: the file comes from the case's own record, so
    // a renamed output cannot be silently replaced by a stale file of the old
    // name, and its length is checked against the bytes the run measured coming
    // OUT rather than going in.
    {
        // The six-copy sheet: 35 × 45 mm on a portrait 4 × 6 at the default
        // margins. Two by two inches only reaches six on a borderless sheet.
        output: { scenario: 'print-sheet', case: 'sheet-uk-35x45-4x6-300' },
        to: 'print-sheet-4x6-preview-600x900.jpg',
        width: 600,
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

        // Most cases produce one file and the case names it. A case that
        // produces a PACKAGE names each of them in `assets`, and `asset` picks
        // one out by the filename the tool gave it — so a renamed output fails
        // here by name rather than by silently copying whatever `file` is.
        const produced = copy.asset ? benchAsset(copy.scenario, copy.case, copy.asset) : null;
        const from = path.join(ROOT, produced ? produced.file : measured.file);
        const recorded = produced ? produced.bytes : measured.output.bytes;

        if (!fs.existsSync(from)) missing(from, `A benchmark output this page needs is not on disk.`);

        const { size } = fs.statSync(from);
        if (size !== recorded) {
            process.stderr.write(
                `benchmarks/outputs is stale: ${path.relative(ROOT, from)} is ${size} bytes, but the results `
                + `file records ${recorded} for ${copy.scenario}/${copy.case}`
                + `${copy.asset ? ` (${copy.asset})` : ''}.\n\n`
                + 'Run `npm run bench` so the outputs and the numbers describe one run.\n',
            );
            process.exit(1);
        }

        fs.copyFileSync(from, path.join(OUT_DIR, copy.to));
        total += report(copy.to);
    }

    for (const source of SOURCES) {
        const measured = benchCase(source.scenario, source.case);
        const from = source.dir
            ? path.join(ROOT, source.dir, source.from)
            : path.join(SAMPLES, source.from);

        if (!fs.existsSync(from)) {
            missing(from, 'A benchmark sample this page needs is not on disk.');
        }

        const { size } = fs.statSync(from);
        if (size !== measured.input.bytes) {
            process.stderr.write(
                `${path.relative(ROOT, from)} is out of step: it is ${size} bytes, but the results file `
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
        // Two ends of the same check. A "before" is a downscale of the SAMPLE
        // that was fed to the tool, so its length is checked against the bytes
        // the run recorded going in; the print sheet preview is a downscale of
        // the file the tool WROTE, so its length is checked against the bytes
        // recorded coming out. Either way the figure and its caption describe
        // one run, and a stale outputs/ or samples/ directory says so.
        const side = scale.output ? 'output' : 'input';
        const reference = scale.output ?? scale.measured;
        const measured = benchCase(reference.scenario, reference.case);

        const from = scale.output
            ? path.join(ROOT, measured.file)
            : path.join(SAMPLES, scale.from);

        if (!fs.existsSync(from)) {
            missing(from, scale.output
                ? 'A benchmark output this page needs is not on disk.'
                : 'A benchmark sample this page needs is not on disk.');
        }

        const { size } = fs.statSync(from);
        const expectedBytes = measured[side].bytes;

        if (size !== expectedBytes) {
            process.stderr.write(
                `benchmarks/${scale.output ? 'outputs' : 'samples'} is out of step: `
                + `${path.relative(ROOT, from)} is ${size} bytes, but the results file records `
                + `${expectedBytes} coming ${side === 'output' ? 'out of' : 'into'} `
                + `${reference.scenario}/${reference.case}.\n\n`
                + (scale.output
                    ? 'Run `npm run bench` so the figure and the caption above it describe one run.\n'
                    : 'Run `npm run generate:bench-samples` and then `npm run bench`, so the before on the '
                      + 'page is a downscale of the file that was measured.\n'),
            );
            process.exit(1);
        }

        // The name carries the dimensions, and for the print sheet preview the
        // page's own <Image> repeats them as literals — so a preview written at
        // a different shape would ship a picture that disagrees with the markup
        // around it. Derived from the measured file rather than trusted.
        const named = /-(\d+)x(\d+)\.[a-z]+$/.exec(scale.to);
        if (named && measured[side].width && measured[side].height) {
            const height = Math.round(
                (scale.width * measured[side].height) / measured[side].width,
            );

            if (Number(named[1]) !== scale.width || Number(named[2]) !== height) {
                process.stderr.write(
                    `${scale.to} says ${named[1]} × ${named[2]}, but ${reference.scenario}/`
                    + `${reference.case} measured ${measured[side].width} × ${measured[side].height}, `
                    + `which at width ${scale.width} is ${scale.width} × ${height}.\n\n`
                    + 'Rename the file (and every page that references it) to the shape the tool '
                    + 'actually produces, rather than shipping a figure under a name that describes '
                    + 'a picture nobody made.\n',
                );
                process.exit(1);
            }
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
