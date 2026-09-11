/**
 * The favicon package — what the visitor gets, named once.
 *
 * WHY A PURE MODULE UNDER lib/format/ AND NOT IN THE ENGINE
 *
 * Three different things have to agree about this list: the engine, which
 * encodes one PNG per entry; the page, which lists the assets and builds the
 * ZIP; and the copy-and-paste HTML, which references the filenames the other
 * two produced. A filename typed twice is a snippet that points at a file the
 * ZIP does not contain, and nothing in a browser would ever report it. So the
 * order, the filenames and the sizes live in ONE array and everything else is
 * derived from it — including the assertions below.
 *
 * WHAT IS UNTRUSTED HERE
 *
 * The manifest carries the visitor's own text. `name` and `short_name` come out
 * of two text inputs, and the file they land in is JSON that a browser parses.
 * A name containing a quote or a backslash that reached the output by string
 * concatenation would produce a manifest no browser can read — at best. So the
 * whole document goes through JSON.stringify and the tests below prove it with
 * a name built out of exactly the characters that break a hand-rolled writer.
 */
import { describe, expect, it } from 'vitest';

import {
    buildHtmlSnippet,
    buildManifest,
    escapeHtml,
    ICON_ASSETS,
    ICO_SIZES,
    ZIP_FILENAME,
} from '@/lib/format/icon-package';

/** The package order, written out rather than derived: this IS the contract. */
const EXPECTED_ORDER = [
    'favicon.ico',
    'favicon-16x16.png',
    'favicon-32x32.png',
    'apple-touch-icon.png',
    'android-chrome-192x192.png',
    'android-chrome-512x512.png',
    'site.webmanifest',
];

describe('ICON_ASSETS', () => {
    it('is the package order, and the ICO comes first', () => {
        expect(ICON_ASSETS.map((asset) => asset.filename)).toEqual(EXPECTED_ORDER);
    });

    it('names each entry once', () => {
        expect(new Set(ICON_ASSETS.map((asset) => asset.id)).size).toBe(ICON_ASSETS.length);
        expect(new Set(ICON_ASSETS.map((asset) => asset.filename)).size).toBe(ICON_ASSETS.length);
    });

    it('describes the ICO by the sizes it contains, not by one width', () => {
        const ico = ICON_ASSETS.find((asset) => asset.kind === 'ico');

        expect(ico).toEqual({
            id: 'favicon-ico',
            filename: 'favicon.ico',
            kind: 'ico',
            sizes: [16, 32, 48],
            type: 'image/x-icon',
        });
        expect(ico.sizes).toEqual(ICO_SIZES);
    });

    it('gives every PNG a square size', () => {
        const pngs = ICON_ASSETS.filter((asset) => asset.kind === 'png');

        expect(pngs.map((asset) => asset.width)).toEqual([16, 32, 180, 192, 512]);
        for (const png of pngs) expect(png.height).toBe(png.width);
    });

    it('carries the manifest as the one entry that is not a picture', () => {
        const manifest = ICON_ASSETS.filter((asset) => asset.kind === 'manifest');

        expect(manifest).toEqual([{
            id: 'manifest',
            filename: 'site.webmanifest',
            kind: 'manifest',
            type: 'application/manifest+json',
        }]);
    });

    it('names the ZIP after the site and the package', () => {
        expect(ZIP_FILENAME).toBe('resizo-favicon-package.zip');
    });
});

describe('buildManifest', () => {
    /** Every assertion below reads the parsed document, never the raw text. */
    function parsed(fields) {
        return JSON.parse(buildManifest(fields));
    }

    it('writes the two installability icons and nothing else when no field is given', () => {
        expect(parsed()).toEqual({
            icons: [
                { src: '/android-chrome-192x192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
                { src: '/android-chrome-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
            ],
        });
    });

    it('references only files the package actually contains', () => {
        const filenames = ICON_ASSETS.map((asset) => asset.filename);

        for (const icon of parsed().icons) {
            expect(filenames).toContain(icon.src.replace(/^\//, ''));
        }
    });

    it('is indented two spaces, so a person can read the file it writes', () => {
        expect(buildManifest()).toContain('\n  "icons": [');
    });

    it('carries every optional field when every optional field is given', () => {
        expect(parsed({
            name: 'Resizo Tools',
            shortName: 'Resizo',
            themeColor: '#0b7285',
            backgroundColor: '#fff',
        })).toEqual({
            name: 'Resizo Tools',
            short_name: 'Resizo',
            icons: [
                { src: '/android-chrome-192x192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
                { src: '/android-chrome-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
            ],
            theme_color: '#0b7285',
            background_color: '#fff',
        });
    });

    it('escapes a name built out of the characters that break a hand-rolled writer', () => {
        const hostile = 'A "quoted" <name> with a \\ backslash';

        const text = buildManifest({ name: hostile });

        // The parsed value is the name exactly. The RAW text never carries the
        // quote or the backslash unescaped, which is what a concatenated
        // writer would have produced.
        expect(JSON.parse(text).name).toBe(hostile);
        expect(text).toContain('\\"quoted\\"');
        expect(text).toContain('\\\\ backslash');
        expect(text).not.toContain('"A "quoted"');
    });

    it('keeps a name with a newline readable as JSON', () => {
        const text = buildManifest({ name: 'Line one\nLine two' });

        expect(JSON.parse(text).name).toBe('Line one\nLine two');
        expect(text.split('\n')).toHaveLength(buildManifest().split('\n').length + 1);
    });

    it.each([
        ['#ff', 'too short'],
        ['#gggggg', 'not hexadecimal'],
        ['red', 'a colour name'],
        ['rgb(1,2,3)', 'a function'],
        ['#0b7285ff', 'eight digits'],
        ['javascript:alert(1)', 'a scheme'],
    ])('drops %s as a theme colour (%s)', (value) => {
        const document = parsed({ themeColor: value, backgroundColor: value });

        expect(document).not.toHaveProperty('theme_color');
        expect(document).not.toHaveProperty('background_color');
    });

    it.each(['#abc', '#ABCDEF', '#0b7285'])('keeps %s as a colour', (value) => {
        expect(parsed({ themeColor: value }).theme_color).toBe(value);
    });

    it('trims a name and caps it at 200 characters', () => {
        const long = 'x'.repeat(250);

        expect(parsed({ name: '  Resizo  ' }).name).toBe('Resizo');
        expect(parsed({ name: long, shortName: long }).name).toHaveLength(200);
        expect(parsed({ name: long, shortName: long }).short_name).toHaveLength(200);
    });

    it.each([
        ['an empty string', ''],
        ['whitespace only', '   '],
        ['a number', 42],
        ['null', null],
    ])('leaves the name out when it is %s', (_label, value) => {
        expect(parsed({ name: value, shortName: value })).not.toHaveProperty('name');
        expect(parsed({ name: value, shortName: value })).not.toHaveProperty('short_name');
    });
});

describe('buildHtmlSnippet', () => {
    it('references only files the package contains', () => {
        const filenames = ICON_ASSETS.map((asset) => asset.filename);

        for (const href of buildHtmlSnippet().match(/href="\/([^"]+)"/g) ?? []) {
            expect(filenames).toContain(href.replace('href="/', '').replace('"', ''));
        }
    });

    it('links the two PNG favicons, the Apple touch icon and the manifest', () => {
        expect(buildHtmlSnippet().split('\n')).toEqual([
            '<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png">',
            '<link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png">',
            '<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">',
            '<link rel="manifest" href="/site.webmanifest">',
        ]);
    });

    it('drops the manifest line when no manifest is wanted', () => {
        const lines = buildHtmlSnippet({ manifest: false }).split('\n');

        expect(lines).toHaveLength(3);
        expect(lines.join('\n')).not.toContain('site.webmanifest');
    });

    it('never carries user text, whatever it is handed', () => {
        expect(buildHtmlSnippet({ name: '<script>alert(1)</script>' }))
            .toBe(buildHtmlSnippet());
    });
});

describe('escapeHtml', () => {
    it.each([
        ['&', '&amp;'],
        ['<', '&lt;'],
        ['>', '&gt;'],
        ['"', '&quot;'],
        ["'", '&#39;'],
    ])('escapes %s', (character, escaped) => {
        expect(escapeHtml(character)).toBe(escaped);
    });

    it('escapes the ampersand first, so an entity is not double-written', () => {
        expect(escapeHtml('&lt;')).toBe('&amp;lt;');
    });

    it('escapes every occurrence, not just the first', () => {
        expect(escapeHtml('<a><b>')).toBe('&lt;a&gt;&lt;b&gt;');
    });

    it('leaves ordinary text alone and answers empty for a non-string', () => {
        expect(escapeHtml('Resizo icons 512')).toBe('Resizo icons 512');
        expect(escapeHtml(null)).toBe('');
        expect(escapeHtml(undefined)).toBe('');
        expect(escapeHtml(42)).toBe('');
    });
});

/**
 * ONE ENLARGEMENT RULE FOR THE ENGINE AND THE PAGE. The page warns before the
 * job runs and the engine reports after it, so neither can read the other —
 * they share this function instead, and disagreeing by value is impossible.
 */
describe('iconEnlargedFrom', () => {
    it('reports the frame\'s square in cover mode when it is smaller than the largest icon', async () => {
        const { iconEnlargedFrom } = await import('@/lib/format/icon-package');
        expect(iconEnlargedFrom({ sourceWidth: 640, sourceHeight: 400, geometry: 'cover', frameRect: { x: 120, y: 0, width: 400, height: 400 } }))
            .toEqual({ width: 400, height: 400 });
    });

    it('takes the largest centred square when cover mode has no frame', async () => {
        const { iconEnlargedFrom } = await import('@/lib/format/icon-package');
        expect(iconEnlargedFrom({ sourceWidth: 1600, sourceHeight: 300, geometry: 'cover' })).toEqual({ width: 300, height: 300 });
        expect(iconEnlargedFrom({ sourceWidth: 1024, sourceHeight: 1024, geometry: 'cover' })).toBeNull();
    });

    it('judges contain mode by the longer edge and reports the whole source', async () => {
        const { iconEnlargedFrom } = await import('@/lib/format/icon-package');
        expect(iconEnlargedFrom({ sourceWidth: 640, sourceHeight: 400, geometry: 'contain' })).toBeNull();
        expect(iconEnlargedFrom({ sourceWidth: 300, sourceHeight: 200, geometry: 'contain' })).toEqual({ width: 300, height: 200 });
    });

    it('is null for an unusable source and at exactly the largest size', async () => {
        const { iconEnlargedFrom, LARGEST_ICON_SIZE } = await import('@/lib/format/icon-package');
        expect(LARGEST_ICON_SIZE).toBe(512);
        expect(iconEnlargedFrom({ sourceWidth: 0, sourceHeight: 10, geometry: 'cover' })).toBeNull();
        expect(iconEnlargedFrom({ sourceWidth: 512, sourceHeight: 512, geometry: 'cover' })).toBeNull();
        expect(iconEnlargedFrom({ sourceWidth: 511, sourceHeight: 511, geometry: 'cover' })).toEqual({ width: 511, height: 511 });
    });
});

