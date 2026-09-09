/**
 * /tools — the directory page, rendered.
 *
 * The page is what makes every intent reachable through a hub as well as
 * through its parent tool, so what is asserted is the whole rendered surface:
 * its own canonical and no-upload description, one h1, a link to every tool
 * and every intent, breadcrumb structured data, and a privacy line that says
 * where the work happens.
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import ToolsPage, { metadata } from '@/app/(marketing)/tools/page';
import { INTENTS, TOOLS, indexableGuides } from '@/lib/catalog';
import { pageFacts } from './helpers/page-facts';

describe('/tools', () => {
    const facts = pageFacts(renderToStaticMarkup(createElement(ToolsPage)), metadata);

    it('canonicalises to itself and makes the no-upload claim inside the snippet budget', () => {
        expect(facts.metadata.alternates.canonical).toBe('https://www.resizo.net/tools');
        expect(facts.metadata.title).toMatch(/Resizo$/);
        expect(facts.metadata.description).toMatch(/(?:on your own device|nothing is uploaded)/);
        expect(facts.metadata.description.search(/on your own device|nothing is uploaded/) + 22).toBeLessThanOrEqual(155);
    });

    it('has one h1 and an intro line', () => {
        expect(facts.h1).toBeTruthy();
        expect(facts.intro).toBeTruthy();
    });

    it('links every tool and every intent', () => {
        const hrefs = new Set(facts.links.map((link) => link.href));
        for (const tool of TOOLS) expect(hrefs.has(tool.href), `${tool.href} missing`).toBe(true);
        for (const intent of INTENTS) expect(hrefs.has(intent.path), `${intent.path} missing`).toBe(true);
    });

    it('emits a breadcrumb and nothing invented', () => {
        expect(facts.jsonLd).toHaveLength(1);
        // One node serialises as an object rather than a one-element array.
        const nodes = [].concat(facts.jsonLd[0]);
        expect(nodes.map((node) => node['@type'])).toEqual(['BreadcrumbList']);
        expect(JSON.stringify(nodes)).not.toMatch(/aggregateRating|review/i);
    });

    it('offers the guides only when one exists, so an empty heading never ships', () => {
        const guideHeadings = facts.headings.filter((heading) => heading.text === 'Guides');
        const expected = indexableGuides().length > 0 ? 1 : 0;
        expect(guideHeadings).toHaveLength(expected);
        for (const guide of indexableGuides()) {
            expect(facts.links.some((link) => link.href === guide.path), `${guide.path} not linked from /tools`).toBe(true);
        }
    });

    it('says where the work happens', () => {
        expect(facts.paragraphs.join(' ')).toMatch(/on your own device|never leaves your device/i);
    });
});
