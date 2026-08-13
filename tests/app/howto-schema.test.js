/**
 * HowTo STRUCTURED DATA CONTRACT
 *
 * Every tool page and every long-tail page describes a real procedure, so every
 * one of them emits a HowTo. Two things can go wrong with that, and neither is
 * visible in a diff:
 *
 *  1. the markup describes steps the page does not show. Google requires a
 *     HowTo to reflect visible content, and markup that does not is a
 *     manual-action risk rather than a ranking trick. The pages defend against
 *     it structurally — one `STEPS` array feeds `howTo()` in the JSON-LD and
 *     `<HowToSteps>` in the body — and this suite fails if a page ever stops
 *     doing that, or emits a HowTo with no visible list behind it at all.
 *
 *  2. a step says the file is uploaded. That was true of the old build and is
 *     now false: every tool decodes and encodes in the visitor's own tab. A
 *     step claiming a transfer would be both a lie and a design-contract
 *     violation, so the step text is scanned for it here.
 *
 * The scan is source-level, like the metadata audit next door, because the
 * failure mode is a page that stopped calling something — which no render of
 * the default props would reveal.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { LONGTAIL_PAGES, sitemapTools } from '@/lib/catalog';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const TOOLS_DIR = path.join(ROOT, 'app', '(tools)');

/** Every page that renders a tool: the seven hubs and their ten spokes. */
const PAGES = [
    ...sitemapTools().map((tool) => tool.href),
    ...LONGTAIL_PAGES.map((page) => page.path),
].map((route) => {
    const file = path.join(TOOLS_DIR, route.replace(/^\//, ''), 'page.js');
    return { route, file, source: fs.readFileSync(file, 'utf8') };
});

/**
 * The body of the page's `const STEPS = [ ... ];`, as raw source. Bracket
 * matching rather than a lazy regex, because a step's text contains brackets.
 */
function stepsBlock(source) {
    const start = source.indexOf('const STEPS = [');
    if (start === -1) return null;

    let depth = 0;
    for (let index = source.indexOf('[', start); index < source.length; index += 1) {
        const char = source[index];
        if (char === '[') depth += 1;
        if (char === ']') {
            depth -= 1;
            if (depth === 0) return source.slice(source.indexOf('[', start) + 1, index);
        }
    }

    return null;
}

/** The `name:` and `text:` string literals inside the STEPS array. */
function stepStrings(block) {
    return [...block.matchAll(/(?:name|text):\s*((?:['`][^'`]*['`]\s*\+?\s*)+)/g)]
        .map((match) => match[1].replace(/['`]\s*\+\s*['`]/g, '').replace(/^['`]|['`]\s*$/g, '').trim());
}

/* ------------------------------------------------------------------ *
 * Coverage
 * ------------------------------------------------------------------ */

describe('the HowTo audit covers every tool page', () => {
    it('found the seven tool pages and the ten long-tail pages', () => {
        expect(PAGES).toHaveLength(17);
        expect(PAGES.map((page) => page.route)).toEqual(
            expect.arrayContaining([
                '/resize', '/compress', '/convert', '/crop', '/heic', '/jpg-to-pdf', '/merge-pdf',
            ]),
        );
    });

    it('reads a real file for each', () => {
        for (const page of PAGES) {
            expect(fs.existsSync(page.file), `${page.route} has no page.js`).toBe(true);
        }
    });
});

/* ------------------------------------------------------------------ *
 * Every page emits a HowTo, from the array it renders
 * ------------------------------------------------------------------ */

describe('every tool page emits HowTo structured data', () => {
    it.each(PAGES.map((page) => [page.route, page]))(
        '%s builds one through lib/schema.js howTo()',
        (_route, page) => {
            expect(page.source, `${page.route} does not import howTo`).toMatch(
                /import \{[^}]*\bhowTo\b[^}]*\} from '@\/lib\/schema'/,
            );
            expect(page.source, `${page.route} never calls howTo()`).toContain('howTo({');
        },
    );

    it.each(PAGES.map((page) => [page.route, page]))(
        '%s renders the same steps it marks up',
        (_route, page) => {
            expect(
                page.source,
                `${page.route} marks up a HowTo with no visible step list — Google requires one`,
            ).toContain('<HowToSteps');
            expect(page.source).toContain('steps={STEPS}');
            expect(
                page.source,
                `${page.route} feeds howTo() something other than the array it renders`,
            ).toContain('steps: STEPS');
        },
    );

    it.each(PAGES.map((page) => [page.route, page]))(
        '%s canonicalises the HowTo to its own path',
        (_route, page) => {
            // `path: PATH` is the same const buildMetadata() takes, so the
            // HowTo @id can never point at a different URL than the canonical.
            const call = page.source.slice(page.source.indexOf('howTo({'));
            expect(call.slice(0, call.indexOf('})'))).toContain('path: PATH');
        },
    );

    it.each(PAGES.map((page) => [page.route, page]))(
        '%s points the HowTo at the anchor of the list it renders',
        (_route, page) => {
            expect(page.source).toMatch(/const HOW_TO_ID = '[a-z0-9-]+';/);
            expect(page.source).toContain('anchor: HOW_TO_ID');
            expect(page.source).toContain('id={HOW_TO_ID}');
        },
    );

    it.each(PAGES.map((page) => [page.route, page]))(
        '%s names the HowTo with the heading the page displays',
        (_route, page) => {
            expect(page.source).toMatch(/const HOW_TO_HEADING = '[^']+';/);
            expect(page.source).toContain('name: HOW_TO_HEADING');
            expect(page.source).toContain('heading={HOW_TO_HEADING}');
        },
    );
});

/* ------------------------------------------------------------------ *
 * The steps describe the client-side reality
 * ------------------------------------------------------------------ */

/**
 * A step that tells someone to upload would be describing the deleted server.
 * "Uploading" appears in truthful copy elsewhere on these pages ("without
 * uploading it"), which is why this scans the STEPS array and not the file.
 */
const UPLOAD_CLAIMS = [
    /\bupload/i,
    /\bsend (?:it|the (?:file|image|photo)) to\b/i,
    /\bour server/i,
    /\bto the server\b/i,
    /\bwait for the transfer\b/i,
    /\bdeleted after\b/i,
];

describe('no step describes an upload, because there is nothing to upload to', () => {
    it.each(PAGES.map((page) => [page.route, page]))('%s has a readable STEPS array', (_route, page) => {
        const block = stepsBlock(page.source);
        expect(block, `${page.route} has no const STEPS = [...]`).toBeTruthy();
        // A name and a text per step, and the shortest procedure here is
        // choose a file, run it, download it.
        expect(stepStrings(block).length).toBeGreaterThanOrEqual(6);
    });

    it.each(PAGES.map((page) => [page.route, page]))('%s never tells anyone to upload', (_route, page) => {
        const strings = stepStrings(stepsBlock(page.source));

        for (const value of strings) {
            for (const claim of UPLOAD_CLAIMS) {
                expect(
                    claim.test(value),
                    `${page.route} step copy claims a transfer that does not happen: "${value}"`,
                ).toBe(false);
            }
        }
    });

    it('names the choose-a-file step after choosing, not after uploading', () => {
        for (const page of PAGES) {
            const strings = stepStrings(stepsBlock(page.source));
            expect(
                strings.some((value) => /\b(choose|drop|drag)\b/i.test(value)),
                `${page.route} never says how to pick a file`,
            ).toBe(true);
        }
    });

    it('ends every procedure at the download, which is where a visitor actually ends', () => {
        for (const page of PAGES) {
            const strings = stepStrings(stepsBlock(page.source));
            expect(
                strings.some((value) => /\bdownload\b/i.test(value)),
                `${page.route} never reaches the download`,
            ).toBe(true);
        }
    });
});
