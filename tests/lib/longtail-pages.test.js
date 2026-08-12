/**
 * LONG-TAIL ROUTE REGISTRY
 *
 * LONGTAIL_PAGES is read by three things that must never disagree: the pages
 * themselves, the hub link blocks on the parent tool pages, and the sitemap.
 * The shape tests below are ordinary unit tests; the ones that touch the
 * filesystem exist because the failure mode here is not a wrong value, it is a
 * route in the registry with no page behind it (a 404 in the sitemap) or a page
 * on disk that nothing links to (an orphan Google finds and no visitor does).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
    LONGTAIL_PAGES,
    TOOLS,
    getLongtailPage,
    getTool,
    longtailPagesFor,
} from '@/lib/constants';
import { absoluteUrl } from '@/lib/seo';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function pageFile(page) {
    return path.join(ROOT, 'app', '(tools)', page.slug, 'page.js');
}

function sourceOf(page) {
    return fs.readFileSync(pageFile(page), 'utf8');
}

describe('LONGTAIL_PAGES registry', () => {
    it('lists the ten long-tail routes', () => {
        expect(LONGTAIL_PAGES).toHaveLength(10);
        expect(LONGTAIL_PAGES.map((page) => page.slug)).toEqual([
            'resize-jpg',
            'resize-png',
            'compress-image-to-100kb',
            'compress-image-to-200kb',
            'png-to-jpg',
            'jpg-to-png',
            'jpg-to-webp',
            'png-to-webp',
            'webp-to-jpg',
            'heic-to-jpg',
        ]);
    });

    it('gives every entry the full shape', () => {
        for (const page of LONGTAIL_PAGES) {
            expect(Object.keys(page).sort()).toEqual([
                'blurb',
                'label',
                'lastModified',
                'path',
                'slug',
                'tool',
            ]);
            expect(page.slug).toMatch(/^[a-z0-9-]+$/);
            expect(page.path).toBe(`/${page.slug}`);
            expect(page.label.length).toBeGreaterThan(0);
            expect(page.blurb.length).toBeGreaterThan(20);
            expect(page.lastModified).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        }
    });

    it('keeps slugs, paths and labels unique', () => {
        for (const key of ['slug', 'path', 'label']) {
            const values = LONGTAIL_PAGES.map((page) => page[key]);
            expect(new Set(values).size).toBe(values.length);
        }
    });

    it('never collides with a tool route', () => {
        const toolPaths = new Set(TOOLS.map((tool) => tool.href));
        for (const page of LONGTAIL_PAGES) {
            expect(toolPaths.has(page.path)).toBe(false);
        }
    });

    it('hangs every page off a tool that owns a page of its own', () => {
        for (const page of LONGTAIL_PAGES) {
            const tool = getTool(page.tool);
            expect(tool, `${page.slug} points at an unknown tool`).not.toBeNull();
            expect(tool.hasOwnPage).toBe(true);
        }
    });

    it('groups the entries by tool in registry order', () => {
        const seen = [];
        for (const page of LONGTAIL_PAGES) {
            if (seen[seen.length - 1] !== page.tool) seen.push(page.tool);
        }
        expect(new Set(seen).size, 'a tool group is split in two').toBe(seen.length);

        const toolOrder = TOOLS.map((tool) => tool.slug);
        const positions = seen.map((slug) => toolOrder.indexOf(slug));
        expect(positions).toEqual([...positions].sort((a, b) => a - b));
    });
});

describe('getLongtailPage', () => {
    it('finds a page by slug', () => {
        expect(getLongtailPage('png-to-jpg')).toMatchObject({ path: '/png-to-jpg', tool: 'convert' });
    });

    it.each([
        ['an unknown slug', 'png-to-tiff'],
        ['a tool slug', 'convert'],
        ['an empty string', ''],
        ['null', null],
        ['undefined', undefined],
        ['a number', 3],
    ])('returns null for %s', (_label, slug) => {
        expect(getLongtailPage(slug)).toBeNull();
    });
});

describe('longtailPagesFor', () => {
    it('returns the pages of one tool', () => {
        expect(longtailPagesFor('resize').map((page) => page.slug)).toEqual(['resize-jpg', 'resize-png']);
        expect(longtailPagesFor('convert').map((page) => page.slug)).toEqual([
            'png-to-jpg',
            'jpg-to-png',
            'jpg-to-webp',
            'png-to-webp',
            'webp-to-jpg',
        ]);
    });

    it('drops the page you are already on', () => {
        const siblings = longtailPagesFor('convert', { exclude: 'png-to-jpg' });
        expect(siblings.map((page) => page.slug)).not.toContain('png-to-jpg');
        expect(siblings).toHaveLength(4);
    });

    it('returns an empty list for an unknown tool', () => {
        expect(longtailPagesFor('sharpen')).toEqual([]);
        expect(longtailPagesFor(undefined)).toEqual([]);
    });

    it('covers every entry exactly once across the tools', () => {
        const gathered = TOOLS.flatMap((tool) => longtailPagesFor(tool.slug));
        expect(gathered).toHaveLength(LONGTAIL_PAGES.length);
        expect(new Set(gathered.map((page) => page.slug)).size).toBe(LONGTAIL_PAGES.length);
    });
});

describe('every registered route has a page behind it', () => {
    it.each(LONGTAIL_PAGES.map((page) => [page.slug, page]))('%s ships app/(tools)/%s/page.js', (_slug, page) => {
        expect(fs.existsSync(pageFile(page)), `${page.path} is in the registry with no page`).toBe(true);
    });

    it.each(LONGTAIL_PAGES.map((page) => [page.slug, page]))('%s declares its own canonical', (_slug, page) => {
        const source = sourceOf(page);
        expect(source).toContain('buildMetadata');
        expect(source, 'the canonical path must be the page path').toContain(`'${page.path}'`);
    });

    it.each(LONGTAIL_PAGES.map((page) => [page.slug, page]))('%s emits schema and a visible FAQ', (_slug, page) => {
        const source = sourceOf(page);
        for (const marker of ['softwareApplication', 'breadcrumbList', 'faqPage', 'FaqList']) {
            expect(source, `${page.slug} is missing ${marker}`).toContain(marker);
        }
    });

    // The FAQ markup has to mirror FAQ copy the page actually shows, so both
    // read the one FAQS array rather than two lists that can drift apart.
    it.each(LONGTAIL_PAGES.map((page) => [page.slug, page]))('%s feeds one FAQ array to both', (_slug, page) => {
        const source = sourceOf(page);
        expect(source).toContain('faqPage(FAQS)');
        expect(source).toContain('items={FAQS}');
    });

    it.each(LONGTAIL_PAGES.map((page) => [page.slug, page]))('%s links back to its parent tool', (_slug, page) => {
        const tool = getTool(page.tool);
        expect(sourceOf(page)).toContain(`'${tool.href}'`);
    });
});

describe('the hub pages link to their spokes', () => {
    it.each(['resize', 'compress', 'convert', 'heic'])('/%s reaches its long-tail pages', (slug) => {
        const source = fs.readFileSync(path.join(ROOT, 'app', '(tools)', slug, 'page.js'), 'utf8');
        const reachable = longtailPagesFor(slug).every((page) => source.includes(page.path))
            || source.includes('IntentLinks');
        expect(reachable, `/${slug} does not link to any of its long-tail pages`).toBe(true);
    });
});

describe('canonical URLs', () => {
    it('resolves every registered path to an absolute URL on the site host', () => {
        for (const page of LONGTAIL_PAGES) {
            expect(absoluteUrl(page.path)).toBe(`https://www.resizo.net${page.path}`);
        }
    });
});
