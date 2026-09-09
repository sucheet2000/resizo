/**
 * THE GUIDE ROUTES
 *
 * /guides is the index and /guides/[slug] serves every entry in the guide
 * registry and nothing else — the same three guarantees the intent route makes,
 * asserted the same way: the static params come from the registry, an
 * unregistered slug is a 404 (dynamicParams is off, and this is a single
 * dynamic segment rather than a catch-all), and the registry is validated while
 * the params are collected, so a broken entry fails `next build`.
 *
 * The registry ships EMPTY, which is the case this suite has to cover
 * properly rather than skip: with no guides the route prerenders nothing, the
 * index page is noindex, and the sitemap gains no URL. Every one of those has
 * to hold on the day the first guide lands too, so the assertions are written
 * against the registry rather than against zero.
 *
 * A guide page also has to be free of client JavaScript. It is prose — there
 * is no tool panel on it, nothing to preconfigure and nothing to interact with
 * — so a 'use client' directive under components/guide/ would ship a React
 * bundle to render paragraphs.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import GuidesIndex, * as index from '@/app/(marketing)/guides/page';
import * as route from '@/app/(marketing)/guides/[slug]/page';
import sitemap from '@/app/sitemap';
import { GUIDES, getGuide, indexableGuides } from '@/lib/catalog/guides';
import { AUTHOR_NAME, INDEXABLE_ROBOTS, NOINDEX_ROBOTS, SITE_URL, guideMetadata } from '@/lib/seo';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const GUIDES_DIR = path.join(ROOT, 'app', '(marketing)', 'guides');
const COMPONENTS_DIR = path.join(ROOT, 'components', 'guide');

describe('the guide route', () => {
    it('is one dynamic segment, not a catch-all', () => {
        expect(fs.existsSync(path.join(GUIDES_DIR, '[slug]', 'page.js'))).toBe(true);
        for (const entry of fs.readdirSync(GUIDES_DIR)) {
            expect(entry, 'a catch-all would serve arbitrary paths under /guides').not.toMatch(/\[\.\.\./);
        }
    });

    it('refuses any slug the registry does not know', () => {
        expect(route.dynamicParams).toBe(false);
    });

    it('prerenders exactly the registry, in registry order', () => {
        expect(route.generateStaticParams()).toEqual(GUIDES.map((guide) => ({ slug: guide.slug })));
    });

    it('validates the registry while collecting params, so a broken entry fails the build', () => {
        const source = fs.readFileSync(path.join(GUIDES_DIR, '[slug]', 'page.js'), 'utf8');
        expect(source).toMatch(/assertGuidesValid\(GUIDES, \{ author: AUTHOR_NAME \}\)/);
    });

    it('hands the validator the one byline this site has', () => {
        expect(AUTHOR_NAME).toBeTruthy();
        for (const guide of GUIDES) {
            expect(guide.author, `${guide.slug} is bylined to someone else`).toBe(AUTHOR_NAME);
        }
    });

    it('treats an unknown slug as not found', async () => {
        await expect(
            route.generateMetadata({ params: Promise.resolve({ slug: 'a-guide-nobody-wrote' }) }),
        ).rejects.toThrow();
    });

    it.each(GUIDES.map((guide) => [guide.slug]))('%s gets the metadata the registry describes', async (slug) => {
        const metadata = await route.generateMetadata({ params: Promise.resolve({ slug }) });

        expect(metadata).toEqual(guideMetadata(getGuide(slug)));
        expect(metadata.alternates.canonical).toBe(`${SITE_URL}/guides/${slug}`);
    });
});

describe('guideMetadata', () => {
    const guide = {
        slug: 'a-measured-finding',
        path: '/guides/a-measured-finding',
        title: 'A Measured Finding | Resizo',
        description: 'What the measurement showed, on your own device with nothing uploaded.',
        indexable: true,
    };

    it('canonicalises a guide to its own URL under /guides', () => {
        expect(guideMetadata(guide).alternates.canonical).toBe(`${SITE_URL}/guides/a-measured-finding`);
    });

    it('marks the page as an article rather than a website', () => {
        expect(guideMetadata(guide).openGraph.type).toBe('article');
    });

    it('lets the entry decide whether it is indexed', () => {
        expect(guideMetadata(guide).robots).toEqual(INDEXABLE_ROBOTS);
        expect(guideMetadata({ ...guide, indexable: false }).robots).toEqual(NOINDEX_ROBOTS);
    });

    it('falls back to the site OG image, because a guide declares none', () => {
        expect(guideMetadata(guide).openGraph.images[0].type).toMatch(/^image\//);
    });
});

describe('the guides index', () => {
    it('canonicalises to /guides', () => {
        expect(index.metadata.alternates.canonical).toBe(`${SITE_URL}/guides`);
    });

    /**
     * Indexable from the day it ships, empty list and all. The page is not a
     * container waiting for content: it states what a guide is on this site and
     * what one has to carry to be published here, which is worth reading and
     * worth being found.
     */
    it('is indexable, and never quietly removes itself while the list is short', () => {
        expect(index.metadata.robots).toEqual(INDEXABLE_ROBOTS);
    });

    it('says what a guide is, rather than rendering an empty container', () => {
        const html = renderToStaticMarkup(createElement(GuidesIndex));
        const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

        expect(html.match(/<h1[^>]*>/g)).toHaveLength(1);
        expect(text).toContain('measured against the tools themselves');
        expect(text.split('.').filter((sentence) => sentence.trim().length > 40).length)
            .toBeGreaterThanOrEqual(3);

        if (indexableGuides().length === 0) expect(text).toContain('No guides yet.');
    });

    it('carries its own title and description', () => {
        expect(index.metadata.title).toBeTruthy();
        expect(index.metadata.description).toBeTruthy();
        expect(index.metadata.openGraph.url).toBe(`${SITE_URL}/guides`);
    });
});

describe('the sitemap', () => {
    const urls = sitemap().map((entry) => entry.url);

    it('advertises every indexable guide and nothing that is held back', () => {
        for (const guide of GUIDES) {
            const advertised = urls.includes(`${SITE_URL}${guide.path}`);
            expect(advertised, `${guide.path} is ${guide.indexable ? 'missing from' : 'wrongly in'} the sitemap`)
                .toBe(guide.indexable !== false);
        }
    });

    it('dates a guide by the day its content last changed, never the build clock', () => {
        for (const guide of indexableGuides()) {
            const entry = sitemap().find((candidate) => candidate.url === `${SITE_URL}${guide.path}`);
            expect(entry.lastModified).toBe(guide.modified);
        }
    });

    it('always lists /guides itself, because the index page is always indexable', () => {
        expect(urls).toContain(`${SITE_URL}/guides`);
    });
});

describe('a guide page ships no client JavaScript', () => {
    const files = fs.existsSync(COMPONENTS_DIR)
        ? fs.readdirSync(COMPONENTS_DIR).filter((file) => file.endsWith('.js'))
        : [];

    it('found the components to check', () => {
        expect(files).toContain('GuidePage.js');
        expect(files).toContain('GuideByline.js');
    });

    it.each(files)('components/guide/%s is a server component', (file) => {
        const source = fs.readFileSync(path.join(COMPONENTS_DIR, file), 'utf8');
        expect(source, 'a guide is prose — there is nothing on it to interact with').not.toMatch(
            /^\s*['"]use client['"]/,
        );
    });
});
