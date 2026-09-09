/**
 * WHAT A GUIDE PAGE RENDERS
 *
 * The registry ships empty, so there is no shipped guide to snapshot and this
 * suite runs entirely against tests/helpers/guide-fixture.js. That is the
 * point: the renderer has to be correct BEFORE the first real guide is written
 * from benchmark results, because the writer of that guide should be arguing
 * about the finding, not about whether the byline shows up.
 *
 * The order below is the order a crawler reads and the order the spec fixes:
 * headline, byline, the answer, the methodology, the sections, the sources,
 * where to go next, the FAQ. The answer being FIRST is the whole reason this
 * content type ranks — a finding buried under an introduction is a page nobody
 * quotes.
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import GuidePage from '@/components/guide/GuidePage';
import { AUTHOR_NAME, guideMetadata } from '@/lib/seo';
import { validGuide } from '@/tests/helpers/guide-fixture';
import { pageFacts } from './helpers/page-facts';

const guide = { ...validGuide(), path: `/guides/${validGuide().slug}` };

const html = renderToStaticMarkup(createElement(GuidePage, { guide }));

const facts = pageFacts(html, guideMetadata(guide));

const document = new DOMParser().parseFromString(
    `<!doctype html><html><body>${html}</body></html>`,
    'text/html',
);

const collapse = (value) => (value ?? '').replace(/\s+/g, ' ').trim();

const headingsAt = (level) => facts.headings.filter((heading) => heading.level === level).map((heading) => heading.text);

describe('the headline and the byline', () => {
    it('gives the page exactly one h1, and it is the entry\'s h1', () => {
        expect(document.querySelectorAll('h1')).toHaveLength(1);
        expect(facts.h1).toBe(guide.h1);
    });

    it('names the author and both dates under the headline', () => {
        const byline = collapse(document.querySelector('h1')?.parentElement?.textContent);

        expect(byline).toContain(guide.h1);
        expect(byline).toContain('By Sucheet Boppana');
        expect(byline).toContain('Published');
        expect(byline).toContain('Updated');
    });

    it('marks both dates up as machine-readable, on the day the entry records', () => {
        const dates = [...document.querySelectorAll('header time')].map((node) => node.getAttribute('datetime'));
        expect(dates).toEqual([guide.published, guide.modified]);
    });

    it('writes the dates out for a reader rather than leaving them as ISO', () => {
        const byline = collapse(document.querySelector('header time')?.parentElement?.textContent);
        expect(byline).toContain('September 2, 2026');
        expect(byline).toContain('September 5, 2026');
    });
});

describe('the body', () => {
    it('puts the answer immediately after the headline, before any section heading', () => {
        const header = document.querySelector('header');
        expect(collapse(header?.nextElementSibling?.textContent)).toBe(collapse(guide.answer));

        // DOCUMENT_POSITION_FOLLOWING: every h2 on the page comes after it.
        const FOLLOWING = 4;
        for (const heading of document.querySelectorAll('h2')) {
            expect(
                header.nextElementSibling.compareDocumentPosition(heading) & FOLLOWING,
                `"${collapse(heading.textContent)}" is above the answer`,
            ).toBeTruthy();
        }
    });

    it('renders the methodology, so the numbers can be reproduced', () => {
        expect(headingsAt(2)).toContain('Methodology');
        expect(facts.paragraphs.some((text) => text.includes('benchmarks/run.js'))).toBe(true);
    });

    it('leaves the methodology out when the entry has none', () => {
        const without = renderToStaticMarkup(
            createElement(GuidePage, { guide: { ...guide, methodology: undefined } }),
        );
        expect(pageFacts(without).headings.map((heading) => heading.text)).not.toContain('Methodology');
    });

    it('renders every section as an h2 with its blocks', () => {
        for (const section of guide.sections) {
            expect(headingsAt(2)).toContain(section.heading);
        }

        expect(facts.lists.some((list) => list.items.includes('One tag records which edge was up.'))).toBe(true);
        expect(facts.tables[0].caption).toBe('The eight positions and what each reader showed');
        expect(facts.tables[0].head).toEqual(['Held', 'Tag', 'Shown upright']);
    });

    it('renders an inline link in the copy as a real link', () => {
        expect(facts.links.some((link) => link.href === '/crop' && link.text === 'Rotate it once for good')).toBe(true);
    });

    it('renders the FAQ, and omits the section when there is none', () => {
        expect(headingsAt(3)).toContain('Does Resizo keep the orientation tag?');

        const without = renderToStaticMarkup(createElement(GuidePage, { guide: { ...guide, faqs: undefined } }));
        expect(pageFacts(without).headings.map((heading) => heading.text))
            .not.toContain('Does Resizo keep the orientation tag?');
    });
});

describe('the sources', () => {
    const links = [...document.querySelectorAll('a[href^="https://"]')];

    it('lists each one as an external link carrying the date it was checked', () => {
        const source = links.find((link) => link.getAttribute('href') === guide.sources[0].url);

        expect(source, 'the source is not linked').toBeTruthy();
        expect(collapse(source.textContent)).toContain(guide.sources[0].label);
        expect(collapse(source.closest('li')?.textContent)).toContain('September 2, 2026');
    });

    it('opens nothing without rel="noopener"', () => {
        for (const link of links) {
            expect(link.getAttribute('rel'), `${link.getAttribute('href')} has no rel`).toContain('noopener');
        }
    });

    it('leaves the section out when the entry cites nothing', () => {
        const without = renderToStaticMarkup(
            createElement(GuidePage, {
                guide: { ...guide, basedOnOfficialRequirements: false, sources: [] },
            }),
        );
        expect(pageFacts(without).headings.map((heading) => heading.text)).not.toContain('Sources');
    });
});

describe('where to go next', () => {
    it('sends the reader on with a sentence, not a bare link label', () => {
        expect(headingsAt(2)).toContain('Where to go next');

        for (const related of guide.relatedTools) {
            expect(facts.paragraphs.concat(facts.lists.flatMap((list) => list.items)).some((text) => text.includes(related.nextJob.slice(0, 30)))).toBe(true);
        }
    });

    it('links a tool slug and an intent slug to their real paths', () => {
        const hrefs = facts.links.map((link) => link.href);
        expect(hrefs).toContain('/resize');
        expect(hrefs).toContain('/remove-image-metadata');
    });
});

describe('the structured data', () => {
    const [nodes] = facts.jsonLd;

    it('emits an Article and a BreadcrumbList, and nothing invented', () => {
        expect(facts.jsonLd).toHaveLength(1);
        expect(nodes.map((node) => node['@type'])).toEqual(['Article', 'BreadcrumbList']);

        const [article] = nodes;
        expect(article.aggregateRating).toBeUndefined();
        expect(article.review).toBeUndefined();
    });

    it('describes the page a reader is actually on', () => {
        const [article] = nodes;

        expect(article.headline).toBe(guide.h1);
        expect(article.description).toBe(guide.description);
        expect(article.datePublished).toBe(guide.published);
        expect(article.dateModified).toBe(guide.modified);
        // The byline is asserted by what it names, not by the exact node: the
        // Person may also carry the one profile the repository confirms, and
        // that is lib/schema.js's call to make in one place for every node.
        expect(article.author['@type']).toBe('Person');
        expect(article.author.name).toBe(AUTHOR_NAME);
        expect(collapse(document.querySelector('header')?.textContent)).toContain(AUTHOR_NAME);
        expect(article.mainEntityOfPage['@id']).toBe(`https://www.resizo.net${guide.path}`);
        expect(article.publisher['@type']).toBe('Organization');
    });

    it('trails Home, Guides and this page, and the visible breadcrumb says the same', () => {
        const [, breadcrumb] = nodes;

        expect(breadcrumb.itemListElement.map((item) => item.name)).toEqual(['Home', 'Guides', guide.h1]);
        expect(breadcrumb.itemListElement.map((item) => item.item)).toEqual([
            'https://www.resizo.net/',
            'https://www.resizo.net/guides',
            `https://www.resizo.net${guide.path}`,
        ]);
        // The visible trail carries a "/" separator inside each item after the
        // first, so the hrefs are the exact comparison and the leaf is checked
        // by what it says.
        expect(facts.breadcrumb.map((item) => item.href)).toEqual(['/', '/guides', null]);
        expect(facts.breadcrumb.at(-1).text).toContain(guide.h1);
    });
});

describe('the metadata', () => {
    it('canonicalises to the guide\'s own URL and declares it an article', () => {
        expect(facts.metadata.alternates.canonical).toBe(`https://www.resizo.net${guide.path}`);
        expect(facts.metadata.openGraph.type).toBe('article');
        expect(facts.metadata.title).toBe(guide.title);
    });
});
