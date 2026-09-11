/**
 * THE FAVICON PACKAGE CITES ITS SOURCES
 *
 * Every other number on this site is either the visitor's own or one this
 * build measured. The favicon package is different: its seven filenames, its
 * six pixel sizes and the sentence beside each of them come from somebody
 * else's published document — Microsoft's ICO structure, Apple's touch-icon
 * guidance, Chrome's installability criteria, the W3C manifest specification —
 * and a page that states them without saying where they came from is asking to
 * be believed rather than checked.
 *
 * So the claims are a registry with a citation apiece, exactly as the four
 * government passport presets are, and the validator is strict for the same
 * reason `lib/catalog/application-presets/validate.js` is: an uncited icon size
 * is a guess, and a guess is what somebody's site would ship.
 *
 * ONE RULE IS NOT ABOUT DATA SHAPE AND MATTERS MORE THAN THE REST. Only Chrome
 * requires anything — a 192 and a 512 icon, for installability. Apple documents
 * sizes, the ICO document encourages three, the manifest specification requires
 * no size at all. `status` is what keeps the page from promoting a
 * recommendation into a requirement, so the statuses are asserted against the
 * source each one cites, not merely against a list of allowed strings.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import * as catalog from '@/lib/catalog';
import {
    ICON_SOURCES,
    ICON_SOURCE_STATUSES,
    iconSourcesFor,
    validateIconSources,
} from '@/lib/catalog/icon-sources';
import { validateCatalog } from '@/lib/catalog/validate';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/**
 * The engine's package, pinned.
 *
 * `lib/format/icon-package.js` is being written in the same cycle as this
 * registry, so the filenames are typed here rather than imported — and the
 * last test in this block imports them the moment that module lands, which is
 * what stops the pin from rotting into a second, private truth.
 */
const PACKAGE_FILENAMES = [
    'favicon.ico',
    'favicon-16x16.png',
    'favicon-32x32.png',
    'apple-touch-icon.png',
    'android-chrome-192x192.png',
    'android-chrome-512x512.png',
    'site.webmanifest',
];

const ENGINE_MODULE = path.join(ROOT, 'lib', 'format', 'icon-package.js');

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

describe('the registry covers the package', () => {
    it('found sources to check', () => {
        // An empty registry breaks no rule below, so the sweep is shown to
        // have read something before anything is asserted about it.
        expect(ICON_SOURCES.length).toBeGreaterThanOrEqual(8);
    });

    it('cites at least one source for every file the package writes', () => {
        const uncited = PACKAGE_FILENAMES.filter(
            (filename) => !ICON_SOURCES.some((entry) => entry.asset === filename),
        );

        expect(
            uncited,
            `these files are generated with nothing published behind them:\n${uncited.join('\n')}`,
        ).toEqual([]);
    });

    it('names no file the package does not write', () => {
        const strays = [...new Set(ICON_SOURCES.map((entry) => entry.asset))]
            .filter((asset) => !PACKAGE_FILENAMES.includes(asset));

        expect(strays, `these entries describe files nothing generates:\n${strays.join('\n')}`).toEqual([]);
    });

    it('groups the claims by asset, in registry order', () => {
        expect(iconSourcesFor('favicon.ico').length).toBeGreaterThanOrEqual(2);
        expect(iconSourcesFor('favicon.ico').every((entry) => entry.asset === 'favicon.ico')).toBe(true);
        expect(iconSourcesFor('nothing.png')).toEqual([]);
    });

    it('pins the same filenames the engine ships, once that module exists', async () => {
        if (!fs.existsSync(ENGINE_MODULE)) {
            expect(PACKAGE_FILENAMES).toHaveLength(7);
            return;
        }

        const { ICON_ASSETS } = await import('@/lib/format/icon-package');
        expect(ICON_ASSETS.map((asset) => asset.filename)).toEqual(PACKAGE_FILENAMES);
    });
});

/* ------------------------------------------------------------------ *
 * What each claim is allowed to say
 * ------------------------------------------------------------------ */

describe('the shipped claims', () => {
    it('gives every entry the full shape', () => {
        for (const entry of ICON_SOURCES) {
            expect(typeof entry.asset, entry.asset).toBe('string');
            expect(entry.sizeLabel.length, entry.asset).toBeGreaterThan(0);
            expect(ICON_SOURCE_STATUSES, entry.asset).toContain(entry.status);
            expect(entry.claim.length, entry.asset).toBeGreaterThan(60);
        }
    });

    it('reads every citation on the day the lead verified it', () => {
        for (const entry of ICON_SOURCES) {
            expect(entry.source.verifiedAt, entry.asset).toBe('2026-09-10');
            expect(entry.source.url, entry.asset).toMatch(/^https:\/\//);
            expect(entry.source.publisher.length, entry.asset).toBeGreaterThan(0);
            expect(entry.source.title.length, entry.asset).toBeGreaterThan(0);
        }
    });

    /**
     * The whole point of the `status` field. Chrome's install criteria are the
     * only document here that uses the word "must" about an icon, so they are
     * the only entries allowed to say a size is required — and the 192 and the
     * 512 are the two sizes that document names.
     */
    it('calls a size required only where Chrome requires it', () => {
        const required = ICON_SOURCES.filter((entry) => entry.status === 'required-by-chrome');

        expect(required.map((entry) => entry.asset)).toEqual([
            'android-chrome-192x192.png',
            'android-chrome-512x512.png',
        ]);

        for (const entry of required) {
            expect(entry.source.url).toBe('https://web.dev/articles/install-criteria');
            expect(entry.claim).toContain('must include a 192px and a 512px icon');
        }
    });

    /**
     * The other half of that rule, and the one a copywriter would break first:
     * no entry outside the pair above may use the word at all. Microsoft
     * "encourages" three sizes, Apple "documents" one, and the manifest
     * specification requires no size whatsoever.
     */
    it('never puts the word required in a claim that nothing requires', () => {
        const overclaimed = ICON_SOURCES
            .filter((entry) => entry.status !== 'required-by-chrome')
            .filter((entry) => /\brequire[sd]?\b/i.test(entry.claim))
            .map((entry) => `${entry.asset} — ${entry.sizeLabel}`);

        expect(
            overclaimed,
            `these claims say required and their source only recommends:\n${overclaimed.join('\n')}`,
        ).toEqual([]);
    });

    it('attributes the Apple sizes to Apple and the ICO structure to Microsoft', () => {
        const apple = ICON_SOURCES.filter((entry) => entry.status === 'documented-by-apple');
        expect(apple.length).toBeGreaterThanOrEqual(2);
        for (const entry of apple) {
            expect(entry.asset).toBe('apple-touch-icon.png');
            expect(entry.source.publisher).toBe('Apple');
        }

        const [ico] = iconSourcesFor('favicon.ico');
        expect(ico.status).toBe('specification');
        expect(ico.source.publisher).toBe('Microsoft');
        expect(ico.claim).toContain('common sizes include 16, 32, and 48 pixels square');
    });

    /**
     * The deferral is a claim like any other: a maskable icon is a real thing
     * with a published safe zone, this build does not generate one, and the
     * page says so with the article that describes it beside the sentence.
     */
    it('states the maskable icon it does not generate, and cites what it is', () => {
        const maskable = ICON_SOURCES.find((entry) => /maskable/i.test(entry.sizeLabel));

        expect(maskable, 'nothing in the registry mentions maskable icons').toBeTruthy();
        expect(maskable.asset).toBe('site.webmanifest');
        expect(maskable.status).not.toBe('required-by-chrome');
        expect(maskable.claim).toContain('radius equal to 40% of the icon width');
    });

    it('writes every claim as prose rather than as a label', () => {
        for (const entry of ICON_SOURCES) {
            expect(entry.claim.trim(), entry.asset).toMatch(/[.!?]$/);
            expect(entry.claim, entry.asset).not.toContain('→');
        }
    });

    it('says something different about every row', () => {
        const claims = ICON_SOURCES.map((entry) => entry.claim);
        expect(new Set(claims).size).toBe(claims.length);

        const rows = ICON_SOURCES.map((entry) => `${entry.asset} — ${entry.sizeLabel}`);
        expect(new Set(rows).size).toBe(rows.length);
    });
});

/* ------------------------------------------------------------------ *
 * The validator
 * ------------------------------------------------------------------ */

describe('validateIconSources', () => {
    const base = () => ICON_SOURCES.map((entry) => ({ ...entry, source: { ...entry.source } }));

    const codes = (sources) => validateIconSources(sources).map((problem) => problem.code);

    it('finds nothing wrong with the shipped registry', () => {
        expect(validateIconSources()).toEqual([]);
    });

    it('refuses a claim with no source at all', () => {
        const sources = base();
        sources[0].source = null;
        expect(codes(sources)).toContain('icon-source-invalid');
    });

    it('refuses a source that is not served over https', () => {
        const sources = base();
        sources[0].source.url = 'http://learn.microsoft.com/en-us/previous-versions/ms997538(v=msdn.10)';
        expect(codes(sources)).toContain('icon-source-invalid');
    });

    it('refuses a source that names no publisher', () => {
        const sources = base();
        sources[0].source.publisher = '   ';
        expect(codes(sources)).toContain('icon-source-invalid');
    });

    it.each([
        ['a calendar date nobody read it on', '10-09-2026'],
        ['no date at all', undefined],
        ['a day that has not happened', '2099-01-01'],
    ])('refuses %s', (_label, verifiedAt) => {
        const sources = base();
        sources[0].source.verifiedAt = verifiedAt;
        expect(codes(sources)).toContain('icon-source-invalid');
    });

    it('refuses a status the page has no label for', () => {
        const sources = base();
        sources[0].status = 'required';
        expect(codes(sources)).toContain('icon-source-status-invalid');
    });

    it('refuses an entry with no asset, no size label or no claim', () => {
        for (const field of ['asset', 'sizeLabel', 'claim']) {
            const sources = base();
            sources[0][field] = '';
            expect(codes(sources), field).toContain('icon-source-fields-missing');
        }
    });

    it('names the row in every problem, so a failure is actionable', () => {
        const sources = base();
        sources[0].source = null;
        const [problem] = validateIconSources(sources);

        expect(problem.subject).toBe(ICON_SOURCES[0].asset);
        expect(problem.message).toContain(ICON_SOURCES[0].sizeLabel);
    });

    /**
     * The same guarantee the government presets get. The intent route calls
     * assertCatalogValid() while it collects its params, so an uncited icon
     * size fails `next build` rather than reaching a page that states it as
     * fact — which is the only enforcement a registry of claims can have.
     */
    it('is wired into validateCatalog, so an uncited size fails the build', () => {
        expect(validateCatalog()).toEqual([]);

        const broken = base();
        broken[0].source = null;

        expect(validateCatalog({ iconSources: broken }).map((problem) => problem.code))
            .toContain('icon-source-invalid');
    });

    it('is reachable from the catalogue barrel, like every other registry', () => {
        expect(catalog.ICON_SOURCES).toBe(ICON_SOURCES);
        expect(catalog.iconSourcesFor).toBe(iconSourcesFor);
        expect(catalog.validateIconSources).toBe(validateIconSources);
    });

    it('has a date check that accepts today and every day before it', () => {
        const sources = base();
        sources[0].source.verifiedAt = new Date().toISOString().slice(0, 10);
        expect(validateIconSources(sources)).toEqual([]);

        expect(ISO_DATE.test(ICON_SOURCES[0].source.verifiedAt)).toBe(true);
    });
});
