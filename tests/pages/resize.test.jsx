/**
 * /resize — the platform sizes, and the page's account of where they came from.
 *
 * The chips are the only place on the site that states a fact about somebody
 * else's product, and two of the twelve were wrong for months (Instagram moved
 * the tallest feed photo to 3:4; YouTube raised the recommended thumbnail to
 * 3840×2160) with nothing on the page or in the suite able to notice. Recording
 * a source per preset only helps if the page renders it, so this file holds the
 * rendered half of the contract:
 *
 *   - every sourced preset is listed once, with a link to the platform's own
 *     page and the day it was read;
 *   - no unsourced preset is listed there, because a link is a claim;
 *   - the at-a-glance table says, per row, which kind of number it is.
 *
 * It renders the real server component, so a section deleted or a link dropped
 * fails here rather than being noticed in a crawl weeks later.
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import ResizePage, { metadata } from '@/app/(tools)/resize/page';
import { SOCIAL_PRESETS, describePreset } from '@/lib/catalog/presets';
import { pageFacts } from './helpers/page-facts';

const HTML = renderToStaticMarkup(createElement(ResizePage));

const document = new DOMParser().parseFromString(
    `<!doctype html><html><body>${HTML}</body></html>`,
    'text/html',
);

const SOURCES_HEADING = 'Where the platform sizes come from';
const SOURCED = SOCIAL_PRESETS.filter((preset) => preset.source);
const UNSOURCED = SOCIAL_PRESETS.filter((preset) => !preset.source);

/** The one <section> the sources heading labels — ContentSection wires that up. */
const sourcesSection = () => {
    const heading = [...document.querySelectorAll('h2')].find((node) => node.textContent.trim() === SOURCES_HEADING);
    expect(heading, `the "${SOURCES_HEADING}" section is gone`).toBeTruthy();
    return heading.closest('section');
};

const sourceItems = () => [...sourcesSection().querySelectorAll('ul > li')];

describe('/resize states where each platform size came from', () => {
    const facts = pageFacts(HTML, metadata);

    it('keeps its own canonical and one h1', () => {
        expect(facts.metadata.alternates.canonical).toBe('https://www.resizo.net/resize');
        expect(document.querySelectorAll('h1')).toHaveLength(1);
    });

    it('carries the sources section under the page’s one h1', () => {
        expect(facts.headings.map((heading) => heading.text)).toContain(SOURCES_HEADING);
        expect(facts.headings.find((heading) => heading.text === SOURCES_HEADING).level).toBe(2);
    });

    it('lists every sourced preset exactly once', () => {
        const items = sourceItems();
        expect(items).toHaveLength(SOURCED.length);

        for (const preset of SOURCED) {
            const matches = items.filter((item) => item.textContent.includes(preset.label));
            expect(matches, `${preset.id} is listed ${matches.length} times, not once`).toHaveLength(1);
        }
    });

    it('gives every listed preset its pixels, its platform’s page and the day it was read', () => {
        for (const preset of SOURCED) {
            const item = sourceItems().find((node) => node.textContent.includes(preset.label));
            const text = item.textContent.replace(/\s+/g, ' ');

            expect(text).toContain(`${preset.width}×${preset.height}`);
            expect(text).toContain(preset.source.label);
            expect(text).toMatch(/checked \w+ \d{1,2}, \d{4}/);

            const link = item.querySelector('a');
            expect(link.getAttribute('href')).toBe(preset.source.url);
            expect(link.getAttribute('href').startsWith('https://')).toBe(true);
            expect(link.getAttribute('rel')).toContain('noopener');

            expect(item.querySelector('time').getAttribute('datetime')).toBe(preset.source.verifiedAt);
        }
    });

    // A link in this list means "they said so". An unsourced size has nobody to
    // link to, and inventing one is the exact failure the registry exists to stop.
    it('links nothing on behalf of a platform that published nothing', () => {
        const listed = sourceItems().map((item) => item.textContent);
        for (const preset of UNSOURCED) {
            expect(
                listed.some((text) => text.includes(preset.label)),
                `${preset.id} has no source but is listed as though it did`,
            ).toBe(false);
        }
    });

    it('names the unsourced sizes in full rather than only counting them', () => {
        const prose = [...sourcesSection().querySelectorAll('p')].map((node) => node.textContent).join(' ');
        for (const preset of UNSOURCED) {
            expect(prose, `${preset.id} is not named`).toContain(preset.label);
        }
    });

    it('says on every row of the at-a-glance table which kind of number it is', () => {
        const rows = [...document.querySelectorAll('table tbody tr')]
            .filter((row) => SOCIAL_PRESETS.some((preset) => row.textContent.includes(preset.label)));
        expect(rows).toHaveLength(SOCIAL_PRESETS.length);

        for (const preset of SOCIAL_PRESETS) {
            const row = rows.find((node) => node.textContent.includes(preset.label));
            expect(row.textContent.replace(/\s+/g, ' '), `${preset.id}`).toContain(describePreset(preset));
        }
    });

    it('calls every unsourced size a convention on the page itself', () => {
        const body = document.body.textContent.replace(/\s+/g, ' ');
        expect(body).toContain('Common export size, not a platform rule');
        for (const preset of UNSOURCED) {
            expect(describePreset(preset)).toBe('Common export size, not a platform rule');
        }
    });

    /**
     * The one reciprocal link to /favicon-generator, and it is in the
     * at-a-glance section on purpose: a visitor reading a table of sizes is the
     * visitor who wants six of them at once. The Related Tools block carries
     * the same link at the foot of every page, but a link inside the copy is
     * the one a crawler reads as content rather than as navigation, and it is
     * the one a reader meets while the question is in their head.
     */
    it('points a visitor picking a size at the favicon package, inside the copy', () => {
        const heading = [...document.querySelectorAll('h2')]
            .find((node) => node.textContent.trim() === 'Platform sizes at a glance');
        expect(heading, 'the at-a-glance section is gone').toBeTruthy();

        const link = heading.closest('section').querySelector('a[href="/favicon-generator"]');
        expect(link, '/resize no longer links the favicon generator from its copy').toBeTruthy();
        expect(link.textContent.trim().length).toBeGreaterThan(4);
    });
});
