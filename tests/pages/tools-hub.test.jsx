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
    const html = renderToStaticMarkup(createElement(ToolsPage));
    const facts = pageFacts(html, metadata);

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

    /**
     * The filter is progressive enhancement or it is a trap: /tools is the page
     * that makes every intent reachable, so a row that only appears once the
     * island has hydrated is a row a crawler never sees. What is asserted is
     * the server render — every row present, nothing hidden — plus the labelled
     * control and a count read off the registry rather than typed.
     */
    it('offers a labelled filter above the directory', () => {
        const document = new DOMParser().parseFromString(`<!doctype html><html><body>${html}</body></html>`, 'text/html');
        const input = document.querySelector('input[type="search"]');

        expect(input, 'no filter input on /tools').toBeTruthy();
        const label = document.querySelector(`label[for="${input.getAttribute('id')}"]`);
        expect(label?.textContent.trim()).toBe('Filter tools');
    });

    it('renders every row before any JavaScript runs, with nothing hidden', () => {
        const document = new DOMParser().parseFromString(`<!doctype html><html><body>${html}</body></html>`, 'text/html');
        const keys = [...document.querySelectorAll('[data-filter-key]')]
            .map((node) => node.getAttribute('data-filter-key'));

        expect(keys).toHaveLength(TOOLS.length + INTENTS.length);
        expect(document.querySelectorAll('[data-filter-key][hidden]')).toHaveLength(0);
        expect(document.querySelectorAll('[data-filter-group][hidden]')).toHaveLength(0);
    });

    it('counts what is shown from the registry, not from a typed number', () => {
        const document = new DOMParser().parseFromString(`<!doctype html><html><body>${html}</body></html>`, 'text/html');
        const status = document.querySelector('[role="status"]');
        const total = TOOLS.length + INTENTS.length;

        expect(status?.textContent.replace(/\s+/g, ' ').trim()).toBe(`${total} of ${total} shown`);
    });

    it('says where the work happens', () => {
        expect(facts.paragraphs.join(' ')).toMatch(/on your own device|never leaves your device/i);
    });
});
