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

const SOURCE_FILES = ['app', 'components'].flatMap(walk).sort();

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
