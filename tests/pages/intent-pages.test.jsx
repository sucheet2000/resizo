/**
 * THE TEN INTENT PAGES, BEFORE AND AFTER
 *
 * Each long-tail route is being moved from its own hand-written page.js into a
 * registry entry rendered by one shared component. Google indexed these pages
 * on the strength of what they say, so the migration is only correct if every
 * heading, paragraph, list, table, link, preconfigured control, JSON-LD node
 * and metadata field comes out the other side unchanged.
 *
 * The snapshots under __snapshots__/ were captured from the ORIGINAL page.js
 * files. A diff here is content the migration lost or altered — read it before
 * updating the snapshot, and update it only for a change that was meant.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { LONGTAIL_PAGES } from '@/lib/catalog';
import { pageFacts } from './helpers/page-facts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

async function renderIntent(page) {
    const file = path.join(ROOT, 'app', '(tools)', page.slug, 'page.js');
    expect(fs.existsSync(file), `${page.path} has no page.js to render`).toBe(true);

    const pageModule = await import(/* @vite-ignore */ pathToFileURL(file).href);
    const html = renderToStaticMarkup(createElement(pageModule.default));

    return pageFacts(html, pageModule.metadata);
}

describe('the intent pages render what they rendered before', () => {
    it('covers every registered intent, from the registry rather than a list here', () => {
        expect(LONGTAIL_PAGES.length).toBeGreaterThanOrEqual(10);
    });

    it.each(LONGTAIL_PAGES.map((page) => [page.slug, page]))(
        '%s keeps its metadata, copy, links, controls and structured data',
        async (slug, page) => {
            const facts = await renderIntent(page);

            // The snapshot can only catch a loss if it captured something to
            // begin with, so the shape is checked before it is compared.
            expect(facts.metadata.alternates.canonical).toBe(`https://www.resizo.net${page.path}`);
            expect(facts.h1).toBeTruthy();
            expect(facts.intro).toBeTruthy();
            expect(facts.answer).toContain('Resizo');
            expect(facts.breadcrumb.length).toBe(3);
            expect(facts.headings.filter((heading) => heading.level === 2).length).toBeGreaterThanOrEqual(4);
            expect(facts.headings.filter((heading) => heading.level === 3).length).toBeGreaterThanOrEqual(5);
            expect(facts.paragraphs.length).toBeGreaterThan(10);
            expect(facts.links.length).toBeGreaterThan(5);
            expect(facts.jsonLd).toHaveLength(1);
            expect(facts.jsonLd[0].map((node) => node['@type'])).toEqual([
                'SoftwareApplication',
                'BreadcrumbList',
                'HowTo',
                'FAQPage',
            ]);

            await expect(`${JSON.stringify(facts, null, 2)}\n`).toMatchFileSnapshot(
                `__snapshots__/${slug}.facts.json`,
            );
        },
    );
});
