/**
 * THE INTERNAL LINK GRAPH HAS NO ISLANDS
 *
 * A page nothing links to is a page that is crawled once, on the strength of
 * the sitemap alone, and then left to rot: no anchor text describing it, no
 * path from anything that already ranks, nothing to pass authority down. The
 * site is deliberately shaped as hub-and-spoke — a tool page is the hub, the
 * intents that preconfigure it are its spokes, /tools is the directory above
 * both — and that shape is a property of the registries, so it can be computed
 * and asserted rather than eyeballed on a diagram.
 *
 * `clusters()` is that computation. This suite holds three separate promises:
 *
 *   - Every indexable route has at least one inbound link from a hub or a core
 *     page. That is computed from the registries and from the RELATED_COPY
 *     keys, and then CROSS-CHECKED by rendering the four blocks the
 *     computation claims exist — /tools, the footer, the header, and the
 *     RelatedTools and IntentLinks blocks. A graph computed from data that no
 *     component actually renders would otherwise pass while the site is full
 *     of orphans.
 *   - Every spoke points back at its hub through the breadcrumb, so the parent
 *     of a long-tail page is never ambiguous.
 *   - The four clusters the site is built around hold what they say they hold:
 *     the four compress ceilings, every format conversion, and the two pairs
 *     of pages that answer one another.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { CORE_PATHS } from '@/app/sitemap';
import IntentLinks from '@/components/content/IntentLinks';
import SiteFooter from '@/components/layout/SiteFooter';
import SiteHeader from '@/components/layout/SiteHeader';
import ToolsDirectory from '@/components/marketing/ToolsDirectory';
import RelatedTools, { RELATED_COPY } from '@/components/tools/RelatedTools';
import { INTENTS, TOOLS, categoriesWithProducts, getTool, intentsFor, sitemapTools } from '@/lib/catalog';
import { inlineLinks } from '@/lib/catalog/inline';
import { clusters, intentLinks } from '@/lib/catalog/relations';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const PAGES = sitemapTools();
const TOOL_HREFS = PAGES.map((tool) => tool.href);
const INTENT_PATHS = INTENTS.map((intent) => intent.path);

/** `/png-to-jpg` → `{ from: 'png', to: 'jpg' }`, or null for anything else. */
function conversion(path) {
    const match = path.match(/^\/([a-z0-9]+)-to-([a-z0-9]+)$/);
    return match ? { from: match[1], to: match[2] } : null;
}

/** Every href a rendered block emits. */
function hrefsOf(element) {
    const html = renderToStaticMarkup(element);
    return [...html.matchAll(/href="([^"]*)"/g)].map(([, href]) => href);
}

const { tools: TOOL_CLUSTERS, categories: CATEGORY_CLUSTERS } = clusters();

const clusterFor = (href) => TOOL_CLUSTERS.find((cluster) => cluster.hub === href) ?? null;

/* ------------------------------------------------------------------ *
 * The shape of a cluster
 * ------------------------------------------------------------------ */

describe('clusters()', () => {
    it('found the registries to build from', () => {
        // Everything below is a statement about a list. An empty list satisfies
        // all of them, so the lists are shown to be real first.
        expect(PAGES.length).toBeGreaterThanOrEqual(10);
        expect(INTENTS.length).toBeGreaterThanOrEqual(15);
        expect(TOOL_CLUSTERS.length).toBe(PAGES.length);
        expect(CATEGORY_CLUSTERS.length).toBe(categoriesWithProducts().length);
        expect(CATEGORY_CLUSTERS.length).toBeGreaterThanOrEqual(4);
    });

    it('gives every tool with a page a hub, and nothing else one', () => {
        expect(TOOL_CLUSTERS.map((cluster) => cluster.hub)).toEqual(TOOL_HREFS);
        // Bulk resize is a tab on /resize, not a URL, so it is not a hub.
        expect(TOOL_CLUSTERS.map((cluster) => cluster.hub)).not.toContain('/resize#bulk');
    });

    it('hangs every intent off exactly one hub', () => {
        const spokes = TOOL_CLUSTERS.flatMap((cluster) => cluster.spokes);

        expect(spokes.length, 'an intent is in two clusters or in none').toBe(INTENTS.length);
        expect([...spokes].sort()).toEqual([...INTENT_PATHS].sort());
    });

    it('reads the spokes of each hub off the registry', () => {
        for (const tool of PAGES) {
            expect(clusterFor(tool.href).spokes).toEqual(intentsFor(tool.slug).map((intent) => intent.path));
        }
    });

    it('groups the tools by the need a visitor arrived with', () => {
        const members = CATEGORY_CLUSTERS.flatMap((cluster) => cluster.members);

        expect([...members].sort(), 'a tool page is in two categories or in none').toEqual([...TOOL_HREFS].sort());

        for (const cluster of CATEGORY_CLUSTERS) {
            expect(cluster.members.length, `the ${cluster.category} category is empty`).toBeGreaterThan(0);
            for (const href of cluster.members) {
                expect(getTool(PAGES.find((tool) => tool.href === href)?.slug)?.category).toBe(cluster.category);
            }
        }
    });
});

/* ------------------------------------------------------------------ *
 * The clusters the site is actually built around
 * ------------------------------------------------------------------ */

describe('the compress cluster', () => {
    it('holds exactly the four ceilings a form asks for', () => {
        // 20, 50, 100 and 200 KB, and no fifth: validate.js caps the pages
        // that differ only by a number at four, because a fifth is a doorway.
        expect([...clusterFor('/compress').spokes].sort()).toEqual([
            '/compress-image-to-100kb',
            '/compress-image-to-200kb',
            '/compress-image-to-20kb',
            '/compress-image-to-50kb',
        ]);
    });
});

describe('the convert cluster', () => {
    const conversions = INTENT_PATHS.filter((path) => conversion(path));

    it('found the conversion pages', () => {
        expect(conversions.length).toBeGreaterThanOrEqual(6);
    });

    it('holds every format-to-format page whose source is an image format', () => {
        const expected = conversions.filter((path) => conversion(path).from !== 'heic');
        expect([...clusterFor('/convert').spokes].sort()).toEqual([...expected].sort());
    });

    it('leaves the HEIC conversions on the HEIC hub, which is the tool that decodes them', () => {
        const expected = conversions.filter((path) => conversion(path).from === 'heic');
        expect(expected.length).toBeGreaterThan(0);
        expect([...clusterFor('/heic').spokes].sort()).toEqual([...expected].sort());
    });
});

/* ------------------------------------------------------------------ *
 * Nothing is an island
 * ------------------------------------------------------------------ */

describe('every indexable route is linked from a hub or a core page', () => {
    /**
     * Computed from the registries and the RELATED_COPY keys — never by
     * crawling the rendered site, which would only prove the site links to
     * whatever it links to. The renders below check this map against reality.
     */
    const sources = new Map();
    const add = (route, source) => sources.set(route, [...(sources.get(route) ?? []), source]);

    add('/', 'header logo');
    for (const tool of TOOLS.filter((tool) => tool.nav)) add(tool.href, 'header nav');
    add('/tools', 'header nav');
    add('/about', 'header nav');

    for (const href of TOOL_HREFS) add(href, 'footer');
    add('/tools', 'footer');
    add('/guides', 'footer');
    add('/about', 'footer');

    for (const href of TOOL_HREFS) add(href, '/tools');
    for (const path of INTENT_PATHS) add(path, '/tools');

    for (const cluster of TOOL_CLUSTERS) {
        for (const spoke of cluster.spokes) add(spoke, `${cluster.hub} IntentLinks`);
    }

    for (const from of TOOL_HREFS) {
        for (const to of TOOL_HREFS) if (from !== to) add(to, `${from} RelatedTools`);
    }

    const INDEXABLE = [...CORE_PATHS, ...TOOL_HREFS, ...INTENT_PATHS];

    it('found the routes to check', () => {
        expect(INDEXABLE.length).toBeGreaterThanOrEqual(28);
        expect(new Set(INDEXABLE).size).toBe(INDEXABLE.length);
    });

    it.each(INDEXABLE)('%s has an inbound link', (route) => {
        const inbound = sources.get(route) ?? [];
        expect(inbound, `nothing on the site links to ${route}`).not.toEqual([]);
    });

    it('links every intent from two places, not one', () => {
        // The directory alone is a single point of failure: /tools is one page,
        // and an intent reachable only from it loses every path in if that
        // block stops rendering. The parent tool's hub block is the second.
        for (const path of INTENT_PATHS) {
            expect(new Set(sources.get(path)).size, `${path} has one way in`).toBeGreaterThanOrEqual(2);
        }
    });

    /* --- the cross-check: the blocks above are really rendered --- */

    it('really does link every tool and every intent from /tools', () => {
        const rendered = new Set(hrefsOf(createElement(ToolsDirectory)));
        expect(rendered.size).toBeGreaterThan(TOOL_HREFS.length);

        for (const href of [...TOOL_HREFS, ...INTENT_PATHS]) {
            expect(rendered.has(href), `/tools does not link ${href}`).toBe(true);
        }
    });

    it('really does link every tool page from the footer', () => {
        const rendered = new Set(hrefsOf(createElement(SiteFooter)));

        for (const href of [...TOOL_HREFS, '/tools', '/about']) {
            expect(rendered.has(href), `the footer does not link ${href}`).toBe(true);
        }
    });

    it('really does link the home page and the nav tools from the header', () => {
        const rendered = new Set(hrefsOf(createElement(SiteHeader)));

        for (const href of ['/', '/tools', '/about', ...TOOLS.filter((tool) => tool.nav).map((tool) => tool.href)]) {
            expect(rendered.has(href), `the header does not link ${href}`).toBe(true);
        }
    });

    it.each(PAGES.map((tool) => [tool.slug, tool.href]))(
        'really does link the other tool pages from the RelatedTools block on /%s',
        (slug, href) => {
            const rendered = new Set(hrefsOf(createElement(RelatedTools, { slug })));

            expect(rendered.has(href), 'a tool page must not link itself').toBe(false);
            for (const other of TOOL_HREFS.filter((candidate) => candidate !== href)) {
                expect(rendered.has(other), `/${slug} does not link ${other}`).toBe(true);
            }
        },
    );

    it.each(PAGES.filter((tool) => intentsFor(tool.slug).length > 0).map((tool) => [tool.slug]))(
        'really does link its spokes from the IntentLinks block on /%s',
        (slug) => {
            const rendered = new Set(hrefsOf(createElement(IntentLinks, { tool: slug, heading: 'x' })));
            expect(rendered.size).toBeGreaterThan(0);

            for (const spoke of clusterFor(getTool(slug).href).spokes) {
                expect(rendered.has(spoke), `the hub block on /${slug} does not link ${spoke}`).toBe(true);
            }
        },
    );
});

/* ------------------------------------------------------------------ *
 * Every spoke names its hub
 * ------------------------------------------------------------------ */

describe('every intent links back to its hub', () => {
    it.each(INTENTS.map((intent) => [intent.slug, intent]))('%s points at the tool it preconfigures', (slug, intent) => {
        const hub = getTool(intent.tool).href;

        expect(
            intentLinks(intent),
            `${intent.path} never links ${hub}, so its parent is only a guess`,
        ).toContain(hub);
    });

    it('reaches the hub through the breadcrumb, not only through a block that may be dropped', () => {
        for (const intent of INTENTS) {
            const hub = getTool(intent.tool).href;
            // intentBreadcrumb() is Home → parent tool → this page, and
            // components/seo/Breadcrumb.js renders every item but the last as
            // a link, so the middle item is a real anchor on every intent page.
            expect(intent.tool, `${intent.path} names no parent tool`).toBeTruthy();
            expect(hub.startsWith('/'), `${intent.path}'s parent has no route`).toBe(true);
        }
    });
});

/* ------------------------------------------------------------------ *
 * The two pairs that answer one another
 * ------------------------------------------------------------------ */

/** The site paths written into an intent entry's own prose. */
function copyLinks(intent) {
    return (intent.sections ?? [])
        .flatMap((section) => section.blocks ?? [])
        .flatMap((block) => (block.type === 'ul' ? block.items : block.type === 'p' ? [block.text] : []))
        .flatMap(inlineLinks)
        .map((link) => link.href.split('#')[0])
        .filter((href) => href.startsWith('/'));
}

describe('the pages that answer one another', () => {
    it('the privacy pair links both ways', () => {
        // Two tools that read as alternatives: one rewrites the resolution a
        // file claims, the other removes what the camera wrote into it. A
        // visitor on either one is often on the wrong page.
        expect(RELATED_COPY['change-image-dpi']?.['remove-image-metadata']).toBeTruthy();
        expect(RELATED_COPY['remove-image-metadata']?.['change-image-dpi']).toBeTruthy();
    });

    it('the application pair links both ways', () => {
        // A signature for a form and a 20 KB ceiling are the same errand
        // arriving from two different searches.
        const signature = TOOLS.find((tool) => tool.slug === 'signature-resizer');
        const twentyKb = INTENTS.find((intent) => intent.slug === 'compress-image-to-20kb');

        expect(signature, 'the signature resizer is not in the registry').toBeTruthy();
        expect(twentyKb, 'the 20 KB intent is not in the registry').toBeTruthy();

        expect(
            copyLinks(twentyKb),
            `${twentyKb.path} never mentions ${signature.href} in its own copy`,
        ).toContain(signature.href);

        // The other direction has to be written into the tool page's own copy:
        // RELATED_COPY is keyed by tool slug on both sides, so no entry in it
        // can ever point at an intent page.
        expect(
            Object.keys(RELATED_COPY['signature-resizer'] ?? {}),
            'RELATED_COPY is keyed by tool slug, so an intent target would never render',
        ).not.toContain(twentyKb.slug);

        const source = fs.readFileSync(path.join(ROOT, 'app', '(tools)', signature.slug, 'page.js'), 'utf8');
        expect(
            source.includes(`"${twentyKb.path}"`) || source.includes(`'${twentyKb.path}'`),
            `${signature.href} never links ${twentyKb.path}, so the pair only points one way`,
        ).toBe(true);
    });
});
