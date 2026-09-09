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
 * files before they were deleted. A diff here is content the registry entry
 * lost or altered — read it before updating the snapshot, and update it only
 * for a change that was meant.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import CompressTool from '@/app/(tools)/compress/CompressTool';
import ConvertTool from '@/app/(tools)/convert/ConvertTool';
import HeicTool from '@/app/(tools)/heic/HeicTool';
import ResizeTool from '@/app/(tools)/resize/ResizeTool';
import IntentPage from '@/components/intent/IntentPage';
import { INTENTS } from '@/lib/catalog';
import { intentMetadata } from '@/lib/seo';
import { pageFacts } from './helpers/page-facts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * The real tool components, imported directly: the route reaches them through
 * a lazy client switch, and a lazy component renders its fallback under
 * renderToStaticMarkup. What is under test here is the content the entry
 * produces, and the switch itself is exercised end to end in tests/e2e.
 */
const TOOL_COMPONENTS = { compress: CompressTool, convert: ConvertTool, heic: HeicTool, resize: ResizeTool };

function renderIntent(intent) {
    // An intent is a registry entry and nothing else: a page.js under its
    // slug would shadow the shared route and split the copy in two.
    expect(
        fs.existsSync(path.join(ROOT, 'app', '(tools)', intent.slug, 'page.js')),
        `${intent.path} has a page.js of its own beside the registry entry`,
    ).toBe(false);

    const html = renderToStaticMarkup(
        createElement(IntentPage, { intent, Tool: TOOL_COMPONENTS[intent.tool] }),
    );
    return pageFacts(html, intentMetadata(intent));
}

describe('the intent pages render what they rendered before', () => {
    it('covers every registered intent, from the registry rather than a list here', () => {
        expect(INTENTS.length).toBeGreaterThanOrEqual(10);
    });

    it.each(INTENTS.map((page) => [page.slug, page]))(
        '%s keeps its metadata, copy, links, controls and structured data',
        async (slug, page) => {
            const facts = renderIntent(page);

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
