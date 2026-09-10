/**
 * THE DEMONSTRATION FIGURES ON THE TOOL PAGES
 *
 * Five tool pages now show what the tool actually did to a file, and every one
 * of those figures is a first-party artefact: the "after" side is the byte-for-
 * byte output of a benchmark run driving the real page in a real browser, and
 * the caption's numbers are read out of benchmarks/results/latest.json rather
 * than typed.
 *
 * That arrangement has exactly one failure mode, and it is silent: the assets
 * live in public/ and are referenced by string, so a renamed file, a stale
 * copy left behind after a scenario is dropped, or an <img> that lost its
 * intrinsic size all ship green. Nothing imports a file in public/, so no
 * bundler and no type checker will ever notice.
 *
 * This suite is the thing that notices. It reads the page sources — the same
 * technique tests/app/tool-answers.test.js uses next door, and for the same
 * reason: the failure is a page that stopped saying something, which no render
 * of default props would reveal.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import sharp from 'sharp';

import sitemap from '@/app/sitemap';
import results from '@/benchmarks/results/latest.json';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DEMO_DIR = path.join(ROOT, 'public', 'demos');

/** Per-file and whole-set ceilings. These are committed bytes on every page load. */
const MAX_BYTES_EACH = 300 * 1024;
const MAX_BYTES_TOTAL = 600 * 1024;

/* ------------------------------------------------------------------ *
 * Reading the references out of the source
 * ------------------------------------------------------------------ */

function walk(dir) {
    const out = [];
    for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
        const relative = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
            out.push(...walk(relative));
        } else if (entry.isFile() && /\.jsx?$/.test(entry.name)) {
            out.push(relative);
        }
    }
    return out;
}

/**
 * Where a `/demos/` reference can be written.
 *
 * `app` and `components` were the whole list while every figure lived on a
 * hand-written page. An intent page has no file of its own — it is a registry
 * entry under lib/catalog/, rendered through one route — so a figure there is
 * a `figure` block in a data module, and a scan that stopped at `components`
 * would have found none of them. That is exactly the silent failure this file
 * exists for: the assets would ship, the page would point at them, and nothing
 * would have checked the alt text, the intrinsic size or the file's existence.
 *
 * lib/catalog rather than lib/catalog/intents, because guide entries carry the
 * same blocks and would otherwise be the next thing to slip through.
 */
const SOURCE_DIRS = ['app', 'components', path.join('lib', 'catalog')];

const SOURCE_FILES = SOURCE_DIRS.flatMap(walk).sort();

/** The object literal a `src: '/demos/…'` sits in, by brace matching. */
function enclosingObject(source, at) {
    const open = source.lastIndexOf('{', at);
    if (open === -1) return null;

    let depth = 0;
    for (let index = open; index < source.length; index += 1) {
        if (source[index] === '{') depth += 1;
        else if (source[index] === '}') {
            depth -= 1;
            if (depth === 0) return source.slice(open, index + 1);
        }
    }

    return null;
}

/** The joined value of a `key: 'a' + 'b'` string property. */
function stringProp(block, key) {
    const match = block.match(new RegExp(`${key}:\\s*((?:'[^']*'\\s*\\+\\s*)*'[^']*')`));
    if (!match) return null;

    return [...match[1].matchAll(/'([^']*)'/g)].map((part) => part[1]).join('');
}

function numberProp(block, key) {
    const match = block.match(new RegExp(`${key}:\\s*(\\d+)`));
    return match ? Number(match[1]) : null;
}

const REFERENCES = SOURCE_FILES.flatMap((file) => {
    const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
    return [...source.matchAll(/src:\s*'(\/demos\/[^']+)'/g)].map((match) => {
        const block = enclosingObject(source, match.index) ?? '';
        return {
            file,
            src: match[1],
            alt: stringProp(block, 'alt'),
            width: numberProp(block, 'width'),
            height: numberProp(block, 'height'),
        };
    });
});

const SITEMAP_IMAGES = sitemap()
    .flatMap((entry) => entry.images ?? [])
    .filter((url) => url.includes('/demos/'));

const ON_DISK = fs.existsSync(DEMO_DIR) ? fs.readdirSync(DEMO_DIR).sort() : [];

/* ------------------------------------------------------------------ *
 * The set itself
 * ------------------------------------------------------------------ */

describe('the demo assets', () => {
    it('is a set the pages actually reference', () => {
        expect(ON_DISK.length).toBeGreaterThan(0);
        expect(REFERENCES.length).toBeGreaterThan(0);
    });

    /**
     * The walk, checked before anything is concluded from it.
     *
     * Every assertion below is of the form "nothing in the sources does X", and
     * a walk that read no sources satisfies all of them. It has one real way to
     * go wrong — a directory dropped from SOURCE_DIRS, or a registry moved out
     * from under one — and the symptom is silence, so the count is asserted
     * first and per directory rather than in total.
     */
    it('actually read every place a figure can be written', () => {
        for (const dir of SOURCE_DIRS) {
            const found = SOURCE_FILES.filter((file) => file.startsWith(`${dir}${path.sep}`));
            expect(found.length, `the walk found no JavaScript under ${dir}`).toBeGreaterThan(0);
        }
    });

    /**
     * And that the intent registry is not merely walked but actually a source
     * of figures. It is the half of the discovery that was missing, so "we
     * scan lib/catalog now" is worth nothing until a reference comes out of it.
     */
    it('finds the figures that live in the registry rather than in a page file', () => {
        const fromRegistry = REFERENCES.filter((reference) => reference.file.includes(path.join('lib', 'catalog')));

        expect(fromRegistry.length, 'no /demos/ reference found in lib/catalog — has a figure block moved?')
            .toBeGreaterThan(0);
    });

    it.each(SITEMAP_IMAGES.map((url) => [new URL(url).pathname]))(
        '%s is listed in the sitemap and is on disk',
        (pathname) => {
            const file = path.join(ROOT, 'public', pathname.replace(/^\//, ''));
            expect(fs.existsSync(file), 'the sitemap points at a demo file that is not there').toBe(true);
        },
    );

    it.each(REFERENCES.map((reference) => [reference.src, reference]))(
        '%s exists in public/demos',
        (src, reference) => {
            const file = path.join(ROOT, 'public', src.replace(/^\//, ''));
            expect(fs.existsSync(file), `${reference.file} points at a file that is not there`).toBe(true);
        },
    );

    it('leaves nothing behind that no page and no sitemap entry points at', () => {
        const referenced = new Set([
            ...REFERENCES.map((reference) => path.basename(reference.src)),
            ...SITEMAP_IMAGES.map((url) => path.basename(url)),
        ]);
        const orphans = ON_DISK.filter((name) => !referenced.has(name));

        expect(orphans, `unreferenced files in public/demos:\n${orphans.join('\n')}`).toEqual([]);
    });

    it('keeps every file under 300 KB and the whole set under 600 KB', () => {
        const sizes = ON_DISK.map((name) => ({ name, bytes: fs.statSync(path.join(DEMO_DIR, name)).size }));
        const oversized = sizes.filter((entry) => entry.bytes > MAX_BYTES_EACH);
        const total = sizes.reduce((sum, entry) => sum + entry.bytes, 0);

        expect(oversized.map((entry) => `${entry.name} ${entry.bytes}`), 'a demo image is over 300 KB').toEqual([]);
        expect(total, `public/demos is ${(total / 1024).toFixed(1)} KB`).toBeLessThanOrEqual(MAX_BYTES_TOTAL);
    });

    it('lists every demo in the sitemap so it can be found on its own, the SVG included', () => {
        // Google Images indexes SVG alongside the raster formats, so the
        // diagram is listed like the photographs.
        const demos = new Set(REFERENCES.map((reference) => reference.src));
        const listed = new Set(SITEMAP_IMAGES.map((url) => new URL(url).pathname));

        expect([...demos].filter((src) => !listed.has(src)), 'a demo image is missing from the sitemap')
            .toEqual([]);
    });
});

/* ------------------------------------------------------------------ *
 * What the markup has to declare
 * ------------------------------------------------------------------ */

/**
 * A keyword list has almost no function words in it. "compress jpg, image
 * resizer, photo tool online" passes a length check and fails this one, which
 * is the difference between alt text and stuffing.
 */
const FUNCTION_WORDS = /\b(the|a|an|and|of|in|to|with|that|is|are|was|were|at|on|from|its|it|same|before|after|than)\b/i;

describe('every demo image declares what it is and how big it is', () => {
    it.each(REFERENCES.map((reference) => [reference.src, reference]))(
        '%s has intrinsic width and height',
        (src, reference) => {
            expect(reference.width, `${reference.file}: no width, so the layout jumps when ${src} decodes`)
                .toBeGreaterThan(0);
            expect(reference.height, `${reference.file}: no height on ${src}`).toBeGreaterThan(0);
        },
    );

    it.each(REFERENCES.map((reference) => [reference.src, reference]))(
        '%s has alt text that is a sentence, not a keyword list',
        (src, reference) => {
            const alt = reference.alt ?? '';

            expect(alt.length, `${reference.file}: ${src} has no alt text`).toBeGreaterThan(40);
            expect(alt.trim().split(/\s+/).length, `${src}: too short to describe anything`)
                .toBeGreaterThanOrEqual(8);
            expect(alt.trim(), `${src}: alt text is a sentence and ends like one`).toMatch(/\.$/);
            expect(alt, `${src}: this reads as a keyword list rather than a description`)
                .toMatch(FUNCTION_WORDS);
        },
    );

    it('describes each image once — no alt text pasted between figures', () => {
        const alts = REFERENCES.map((reference) => reference.alt);
        const duplicates = alts.filter((alt, index) => alts.indexOf(alt) !== index);

        expect([...new Set(duplicates)], 'two figures share alt text').toEqual([]);
    });
});

/* ------------------------------------------------------------------ *
 * The numbers under the figures
 * ------------------------------------------------------------------ */

const FIGURE_PAGES = [
    'compress',
    'crop',
    'signature-resizer',
    'change-image-dpi',
    'remove-image-metadata',
].map((slug) => ({
    slug,
    file: path.join('app', '(tools)', slug, 'page.js'),
    source: fs.readFileSync(path.join(ROOT, 'app', '(tools)', slug, 'page.js'), 'utf8'),
}));

const GITHUB_BENCHMARK_README = '/blob/main/benchmarks/README.md';

describe('every caption is built from the measurement rather than typed', () => {
    it.each(FIGURE_PAGES.map((page) => [page.slug, page]))(
        '%s reads benchmarks/results/latest.json',
        (slug, page) => {
            expect(page.source, `${page.file}: a caption number that is typed is a number that drifts`)
                .toContain('benchmarks/results/latest.json');
        },
    );

    it.each(FIGURE_PAGES.map((page) => [page.slug, page]))(
        '%s links its caption to how the number was measured',
        (slug, page) => {
            expect(page.source, `${page.file}: the caption has no route back to the method`)
                .toContain(GITHUB_BENCHMARK_README);
            expect(page.source, `${page.file}: the benchmark link needs rel="noopener"`)
                .toMatch(/rel="noopener"/);
        },
    );

    it.each(FIGURE_PAGES.map((page) => [page.slug, page]))('%s renders a Figure', (slug, page) => {
        expect(page.source).toContain("from '@/components/content/Figure'");
    });

    /**
     * Each page reaches into the results file for one scenario and one case,
     * at module scope, and reads numbers off it. A renamed case id makes that
     * lookup undefined and the page throws while it is being prerendered —
     * a build failure, which is survivable, but only if somebody has already
     * been told which case moved. This says which one.
     */
    it.each(FIGURE_PAGES.map((page) => [page.slug, page]))(
        '%s reads a case that is actually in the results file',
        (slug, page) => {
            const scenarioId = page.source.match(/scenario\.id === '([^']+)'/)?.[1];
            const caseId = page.source.match(/entry\.id === '([^']+)'/)?.[1];

            expect(scenarioId, `${page.file}: no scenario lookup`).toBeTruthy();
            expect(caseId, `${page.file}: no case lookup`).toBeTruthy();

            const scenario = results.scenarios.find((entry) => entry.id === scenarioId);
            expect(scenario, `${page.file}: no scenario "${scenarioId}" in latest.json`).toBeTruthy();

            const measured = scenario.cases.find((entry) => entry.id === caseId);
            expect(measured, `${page.file}: no case "${caseId}" in scenario "${scenarioId}"`).toBeTruthy();
            expect(measured.ok, `${page.file}: "${caseId}" failed in the run it is quoted from`).toBe(true);
        },
    );
});

/**
 * The metadata page is the one figure that is not a picture: a screenshot of a
 * metadata readout would be a picture of text, unreadable to half the people
 * it is for and a lie the moment the panel's wording changes. It renders a
 * table instead, and the table's rows are split out of the panel sentence the
 * benchmark recorded — so this pins that sentence's shape. If the tool starts
 * wording its result differently, this fails here rather than rendering an
 * empty table in production.
 */
describe('the metadata table can still be read out of the benchmark', () => {
    const CASE = results.scenarios
        .find((scenario) => scenario.id === 'demo-outputs')
        .cases.find((entry) => entry.id === 'metadata-stripped');

    it('recorded the run', () => {
        expect(CASE.ok).toBe(true);
        expect(CASE.input.bytes).toBeGreaterThan(CASE.output.bytes);
        expect(CASE.output.width).toBe(CASE.input.width);
        expect(CASE.output.height).toBe(CASE.input.height);
    });

    it('states what it removed and what it kept, in that order', () => {
        expect(CASE.panel).toMatch(
            /^Removed: Camera and capture data \(EXIF\), Location \(GPS coordinates\)\. Kept: Colour profile \(ICC\), because/,
        );
    });

    it('splits into two removed categories and one kept category', () => {
        const removed = CASE.panel.match(/Removed: (.+?)\. Kept:/)[1].split(', ');
        const kept = CASE.panel.match(/Kept: (.+?), because/)[1].split(', ');

        expect(removed).toEqual(['Camera and capture data (EXIF)', 'Location (GPS coordinates)']);
        expect(kept).toEqual(['Colour profile (ICC)']);
    });
});

/* ------------------------------------------------------------------ *
 * The passport pair
 * ------------------------------------------------------------------ */

/**
 * The two files under /passport-photo, checked against the run that made them
 * AND against themselves.
 *
 * The distinction matters. Every check above reads the results JSON, which is
 * the runner's account of what it did; these open the files that actually ship
 * and ask libvips what they are. A copy step that silently re-encoded, a stale
 * file left from an earlier run, or a results entry that describes a different
 * output would all pass a JSON-only check and fail here.
 *
 * The "after" is the one figure on this site whose whole claim is a pair of
 * exact numbers — 600 × 600 pixels and a 300 DPI record, because 2 inches at
 * 300 DPI is 600 pixels. A picture that merely resembles the output would
 * illustrate that claim; only the output itself is evidence for it.
 */
describe('the passport figures are the tool’s own output rather than a picture of it', () => {
    const AFTER = 'portrait-passport-600x600.jpg';
    const BEFORE = 'portrait-source-480x640.jpg';

    const scenario = results.scenarios.find((entry) => entry.id === 'passport-photo');
    const measured = scenario?.cases.find((entry) => entry.id === 'passport-us-600x600');

    const demo = (name) => path.join(DEMO_DIR, name);

    it('quotes a case that is in the results file and did not fail', () => {
        expect(scenario, 'no "passport-photo" scenario in latest.json — has `npm run bench` run since scenario F landed?')
            .toBeTruthy();
        expect(measured, 'no "passport-us-600x600" case in the passport-photo scenario').toBeTruthy();
        expect(measured.ok, 'the passport case failed in the run these figures come from').toBe(true);
    });

    it('ships both halves', () => {
        for (const name of [BEFORE, AFTER]) {
            expect(fs.existsSync(demo(name)), `public/demos/${name} is not there — run \`npm run generate:demos\``)
                .toBe(true);
        }
    });

    it('ships the after byte for byte, with nothing re-encoded on the way', () => {
        expect(fs.statSync(demo(AFTER)).size, 'the shipped figure is not the file the run measured')
            .toBe(measured.output.bytes);
    });

    it('is 600 × 600 at 300 DPI in the shipped file, not only in the JSON', async () => {
        const meta = await sharp(demo(AFTER)).metadata();

        expect(meta.format).toBe('jpeg');
        // 2 inches at 300 DPI. Exact, because a passport form that asks for
        // 600×600 rejects 600×599.
        expect(meta.width).toBe(600);
        expect(meta.height).toBe(600);
        // The density record is the half that makes the pixel count mean two
        // inches. A copy that dropped it would still look right on screen.
        expect(meta.density).toBe(300);

        expect(meta.width).toBe(measured.output.width);
        expect(meta.height).toBe(measured.output.height);
        expect(meta.density).toBe(measured.output.density);
    });

    it('shows a before that is the measured source, downscaled and nothing else', async () => {
        const meta = await sharp(demo(BEFORE)).metadata();

        expect(meta.width).toBe(480);
        expect(meta.height).toBe(640);
        // The one transformation the generator is allowed. Same shape as the
        // 1200×1600 sample the run was fed, so the pair on the page is a crop
        // of that picture rather than of some other one.
        expect(meta.width / meta.height).toBeCloseTo(measured.input.width / measured.input.height, 5);
        expect(fs.statSync(demo(BEFORE)).size).toBeLessThan(measured.input.bytes);
    });

    it('lists both in the sitemap so each can be found on its own', () => {
        const listed = new Set(SITEMAP_IMAGES.map((url) => new URL(url).pathname));

        for (const name of [BEFORE, AFTER]) {
            expect(listed.has(`/demos/${name}`), `/demos/${name} is missing from the sitemap`).toBe(true);
        }
    });
});

/**
 * And that the declared size is the file's ACTUAL size.
 *
 * The suite above asserts that every figure carries a width and a height,
 * which is the rule that stops the layout jumping while the image decodes.
 * It does not, on its own, stop the numbers being wrong — and a wrong
 * intrinsic size causes exactly the jump the rule exists to prevent, plus a
 * squashed picture, while passing every check written so far. So the numbers
 * in the source are read back against the bytes on disk.
 *
 * Raster only. An SVG's width and height attributes are a layout hint over a
 * viewBox that scales, so "the declared size is the intrinsic size" is not a
 * claim a vector makes, and asserting it would be asserting a rule the format
 * does not have.
 */
describe('every raster figure declares the size it actually is', () => {
    const RASTER = REFERENCES.filter((reference) => /\.(png|jpe?g|webp)$/i.test(reference.src));

    it('found raster figures to check', () => {
        // Without this, a filter that matched nothing would make the whole
        // block below pass by checking no file at all.
        expect(RASTER.length, 'no raster figure found — has every figure become a vector?')
            .toBeGreaterThan(0);
    });

    it.each(RASTER.map((reference) => [reference.src, reference]))(
        '%s is the size its markup claims',
        async (src, reference) => {
            const file = path.join(ROOT, 'public', src.replace(/^\//, ''));
            const meta = await sharp(file).metadata();

            expect(meta.width, `${reference.file}: ${src} is ${meta.width}px wide, declared ${reference.width}`)
                .toBe(reference.width);
            expect(meta.height, `${reference.file}: ${src} is ${meta.height}px tall, declared ${reference.height}`)
                .toBe(reference.height);
        },
    );
});
