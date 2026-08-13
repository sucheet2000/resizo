/**
 * /convert may not name a format the registry does not carry.
 *
 * This suite exists because of a real drift, not a hypothetical one. AVIF was
 * removed from /convert in both directions — no browser build here can decode
 * it, and encoding it costs 823 KB of extra download and 15-30 seconds an image
 * on a phone — and the tool then refused a conversion that the intro sentence,
 * the metadata description, three FAQ answers, a comparison table row and an
 * entire content section were all still advertising. Every one of those was a
 * hand-typed format list, and nothing in the build could tell they had gone
 * false.
 *
 * So the page derives its prose from lib/limits.js through
 * app/(tools)/convert/formats.js, and this file holds it to that in two ways:
 *
 *  1. the helpers really are derived — they say exactly what the registry says,
 *     no more and no less
 *  2. the route's own source names no format the registry does not carry, which
 *     is the check that fails the next time somebody types one back in
 *
 * The second one is a source scan rather than a render on purpose. A rendered
 * assertion would only cover the strings that happened to be on screen for the
 * default props; the drift that actually shipped was in metadata, in JSON-LD
 * features and in a table — none of which a shallow render would have caught.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
    alphaFormatsProse,
    formatComparison,
    formatsProse,
    inputFormatsProse,
    losslessFormatsProse,
    lossyFormatsProse,
    outputFormatsProse,
    convertFormats,
    FORMAT_FACTS,
} from '@/app/(tools)/convert/formats';
import { CONVERT_INPUT_FORMATS, CONVERT_OUTPUT_FORMATS } from '@/lib/limits';
import { formatLabel } from '@/lib/format/upload-helpers';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ROUTE = path.join(ROOT, 'app', '(tools)', 'convert');

const PAGE = fs.readFileSync(path.join(ROUTE, 'page.js'), 'utf8');
const TOOL = fs.readFileSync(path.join(ROUTE, 'ConvertTool.js'), 'utf8');

/**
 * Every image format this site has a name for, spelled the way copy spells it.
 * Lower-case forms are deliberately absent: `png-to-jpg` is a route slug and an
 * anchor id, not a sentence, and matching it would make this test noise.
 */
const FORMAT_WORDS = {
    JPEG: 'jpeg',
    JPG: 'jpeg',
    PNG: 'png',
    WebP: 'webp',
    AVIF: 'avif',
    GIF: 'gif',
    HEIC: 'heic',
    HEIF: 'heic',
    TIFF: 'tiff',
    BMP: 'bmp',
};

const REGISTERED = new Set([...CONVERT_INPUT_FORMATS, ...CONVERT_OUTPUT_FORMATS]);

/**
 * Comments are not copy. A docblock saying why AVIF was dropped is the record of
 * the decision and has to be allowed to name it; a sentence a visitor reads is
 * the thing under test. Block comments and whole-line `//` comments come out
 * before the scan, and nothing else does.
 */
function withoutComments(source) {
    return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

function formatWordsIn(source) {
    const copy = withoutComments(source);
    return Object.keys(FORMAT_WORDS).filter((word) => new RegExp(`\\b${word}\\b`).test(copy));
}

/* ------------------------------------------------------------------ *
 * The helpers are derived, not restated
 * ------------------------------------------------------------------ */

describe('the prose helpers read the registry', () => {
    it('names every input format and nothing else', () => {
        const prose = inputFormatsProse();

        for (const format of CONVERT_INPUT_FORMATS) {
            expect(prose).toContain(formatLabel(format));
        }

        for (const [word, format] of Object.entries(FORMAT_WORDS)) {
            if (REGISTERED.has(format)) continue;
            expect(prose, `${word} is not in the registry`).not.toContain(word);
        }
    });

    it('names every output format and nothing else', () => {
        const prose = outputFormatsProse();

        for (const format of CONVERT_OUTPUT_FORMATS) {
            expect(prose).toContain(formatLabel(format));
        }

        for (const [word, format] of Object.entries(FORMAT_WORDS)) {
            if (REGISTERED.has(format)) continue;
            expect(prose, `${word} is not in the registry`).not.toContain(word);
        }
    });

    it('reads as a sentence rather than as a list', () => {
        expect(formatsProse(['jpeg', 'png', 'webp'])).toBe('JPEG, PNG and WebP');
        expect(formatsProse(['jpeg', 'png', 'webp'], 'or')).toBe('JPEG, PNG or WebP');
        expect(formatsProse(['jpeg', 'png'])).toBe('JPEG and PNG');
        expect(formatsProse(['jpeg'])).toBe('JPEG');
        expect(formatsProse([])).toBe('');
    });

    it('splits the alpha and the lossless claims by fact, not by memory', () => {
        // The FAQ says "X and Y keep an alpha channel" and "converting to Z is
        // lossless". Both sentences come from these, so they cannot contradict
        // the comparison table sitting a few hundred pixels above them.
        expect(alphaFormatsProse()).toContain('PNG');
        expect(alphaFormatsProse()).toContain('WebP');
        expect(alphaFormatsProse()).not.toContain('JPEG');

        expect(losslessFormatsProse()).toBe('PNG');
        expect(lossyFormatsProse()).toContain('JPEG');
        expect(lossyFormatsProse()).not.toContain('PNG');
    });

    it('builds one table row per output format, in registry order', () => {
        const rows = formatComparison();

        expect(rows.map((row) => row.format)).toEqual(CONVERT_OUTPUT_FORMATS);
        expect(rows.map((row) => row.label)).toEqual(CONVERT_OUTPUT_FORMATS.map(formatLabel));

        for (const row of rows) {
            expect(row.transparency).toMatch(/^(Yes|No)$/);
            expect(row.compression).toMatch(/^(Lossy|Lossless|Lossy or lossless)$/);
            expect(row.size).toBeTruthy();
            expect(row.best).toBeTruthy();
        }
    });

    it('refuses to render a format nobody has written facts for', () => {
        // A format added to the registry with no copy is a build failure here,
        // not a silently missing table row. This is what keeps FORMAT_FACTS from
        // quietly becoming a second, shorter registry.
        expect(() => formatsProse(convertFormats())).not.toThrow();
        expect(Object.keys(FORMAT_FACTS)).toEqual(expect.arrayContaining([...REGISTERED]));
    });
});

/* ------------------------------------------------------------------ *
 * The route's source names nothing the registry does not carry
 * ------------------------------------------------------------------ */

describe('the route names no format the registry has dropped', () => {
    it.each([['page.js', PAGE], ['ConvertTool.js', TOOL]])(
        '%s only names registered formats',
        (_name, source) => {
            for (const word of formatWordsIn(source)) {
                expect(
                    REGISTERED.has(FORMAT_WORDS[word]),
                    `${word} is written into this file but is not in CONVERT_INPUT_FORMATS or CONVERT_OUTPUT_FORMATS`,
                ).toBe(true);
            }
        },
    );

    it.each([['page.js', PAGE], ['ConvertTool.js', TOOL]])(
        '%s counts no formats in prose',
        (_name, whole) => {
            const source = withoutComments(whole);
            // "any of the four", "the other three", "the four still formats" —
            // the exact sentences that went wrong. A count is a format list with
            // the names left out, and it goes stale just as quietly.
            expect(source).not.toMatch(/\b(?:any|all|each) of the (?:two|three|four|five)\b/i);
            expect(source).not.toMatch(/\bthe (?:other )?(?:two|three|four|five) (?:still )?formats?\b/i);
        },
    );

    it('builds the metadata title and description from the registry too', () => {
        // The description is what shows up in a search result. It went stale in
        // exactly the same way the on-page copy did, and it is the one nobody
        // looks at.
        expect(PAGE).toContain('outputFormatsProse()');
        expect(PAGE).toContain('formatList(CONVERT_OUTPUT_FORMATS)');
    });

    it('offers both menus straight from the registry', () => {
        expect(TOOL).toContain('CONVERT_INPUT_FORMATS.map');
        expect(TOOL).toContain('CONVERT_OUTPUT_FORMATS.filter');
    });
});
