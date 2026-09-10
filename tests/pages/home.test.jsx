/**
 * The homepage, rendered.
 *
 * The page's job changed: it used to sell one tool ("Resize, compress and
 * convert images without uploading them") and list ten cards under it, which
 * left the family — the form tools, the metadata tools, the byte ceilings —
 * invisible from the front door. What is pinned here is the new job: the
 * headline names the family, the intro says what you can actually do, the
 * drop zone stays but no longer speaks for the whole site, the curated set
 * resolves against the registry rather than being typed prose, and every
 * category that holds a product is reachable in one click.
 *
 * One claim is pinned by its ABSENCE. "carries no EXIF or GPS data" / "No
 * metadata in the output" was true of the re-encoding tools and false of the
 * two that do not re-encode — the DPI tool keeps EXIF and rewrites its
 * resolution fields, and the metadata remover keeps the ICC profile. A global
 * claim that two tools break is the kind of copy that reads as a promise, so
 * the test that it never comes back lives here rather than in a comment.
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import HomePage, { metadata } from '@/app/(marketing)/page';
import { CATEGORIES, INTENTS, TOOLS, categoriesWithProducts } from '@/lib/catalog';
import { routeExists } from '../components/helpers.jsx';
import { pageFacts } from './helpers/page-facts';

vi.mock('next/navigation', () => ({
    useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
    usePathname: () => '/',
}));

/**
 * The curated "start with a job" set, written here as the contract the page
 * has to keep: nine entries at most, every one of them a real route in the
 * registry, ordered by an editorial judgement of usefulness rather than by the
 * order the registry happens to list them in.
 */
const CURATED = [
    '/compress',
    '/resize',
    '/compress-image-to-50kb',
    '/heic-to-jpg',
    '/compress-image-to-20kb',
    '/convert',
    '/signature-resizer',
    '/remove-image-metadata',
    '/change-image-dpi',
];

const html = renderToStaticMarkup(createElement(HomePage));
const facts = pageFacts(html, metadata);
const text = facts.paragraphs.join(' ');

/** The anchors inside one section of the rendered page, by its id. */
function sectionLinks(id) {
    const document = new DOMParser().parseFromString(
        `<!doctype html><html><body>${html}</body></html>`,
        'text/html',
    );
    const section = document.querySelector(`#${id}`);
    expect(section, `no #${id} section on the homepage`).toBeTruthy();
    return [...section.querySelectorAll('a[href]')].map((anchor) => ({
        href: anchor.getAttribute('href'),
        text: anchor.textContent.replace(/\s+/g, ' ').trim(),
        heading: anchor.closest('h3') !== null,
    }));
}

describe('the homepage names the family, not one tool', () => {
    it('has one h1 and it does not read as a single-tool headline', () => {
        expect(facts.h1).toBeTruthy();
        expect(facts.h1).toMatch(/image tools/i);
        expect(facts.h1).not.toMatch(/^resize,/i);
    });

    it('says in the intro what you can do here and where the file is processed', () => {
        expect(facts.intro).toBeTruthy();
        for (const job of [/resize/i, /compress/i, /convert/i, /crop/i, /signature/i, /dpi/i, /metadata/i, /pdf/i]) {
            expect(facts.intro, `the intro never mentions ${job}`).toMatch(job);
        }
        expect(facts.intro).toMatch(/on your (own )?device|the machine in front of you/i);
        expect(facts.intro).toMatch(/nothing is uploaded|never uploaded|not uploaded/i);
    });

    it('claims no traffic fact — there is no analytics, so nothing here is "most often"', () => {
        expect(text).not.toMatch(/arrive for most often|most often|most popular|most used|most visited/i);
    });

    it('keeps the working drop zone without letting it speak for the whole site', () => {
        expect(html).toMatch(/Drop an image to resize it/);
        expect(html).not.toMatch(/Drop an image here to resize it/);
        expect(html).toMatch(/start from a job below/i);
    });

    it('carries the shared trust strip rather than a second hand-written list', () => {
        const promises = facts.lists.find((list) =>
            list.items.some((item) => /Processed on your device/.test(item)));

        expect(promises, 'the shared TrustStrip is not on the homepage').toBeTruthy();
        expect(promises.items.join(' ')).toMatch(/No image upload/);
        expect(promises.items.join(' ')).toMatch(/No account/);
        expect(promises.items.join(' ')).toMatch(/No watermark/);
    });
});

describe('start with a job', () => {
    const links = sectionLinks('start');
    const headings = links.filter((link) => link.heading).map((link) => link.href);

    it('offers a curated set, in the order chosen, and never the whole catalogue', () => {
        expect(headings).toEqual(CURATED);
        expect(headings.length).toBeLessThanOrEqual(9);
    });

    it('names only slugs that exist in the registry', () => {
        const known = new Set([
            ...TOOLS.map((tool) => tool.href),
            ...INTENTS.map((intent) => intent.path),
        ]);

        for (const href of headings) {
            expect(known.has(href), `${href} is not a tool href or an intent path`).toBe(true);
        }
    });

    it('gives every cell a sentence of its own — never a generic description', () => {
        const document = new DOMParser().parseFromString(
            `<!doctype html><html><body>${html}</body></html>`,
            'text/html',
        );
        const cells = [...document.querySelectorAll('#start li')];
        expect(cells).toHaveLength(CURATED.length);

        const lines = cells.map((cell) => {
            const paragraph = cell.querySelector('p');
            return (paragraph?.textContent ?? '').replace(/\s+/g, ' ').trim();
        });

        for (const line of lines) expect(line.length).toBeGreaterThan(40);
        expect(new Set(lines).size, 'two cells share a sentence').toBe(lines.length);
    });
});

describe('browse by need', () => {
    const links = sectionLinks('browse');

    it('shows every category that holds a product, and no empty one', () => {
        const populated = categoriesWithProducts();
        const headings = facts.headings.filter((heading) => heading.level === 3);

        for (const category of populated) {
            expect(
                headings.some((heading) => heading.text === category.title),
                `${category.title} is missing from browse by need`,
            ).toBe(true);
        }

        for (const category of CATEGORIES.filter((entry) => !populated.includes(entry))) {
            expect(html).not.toContain(category.title);
        }
    });

    it('deep-links each category into the directory', () => {
        for (const category of categoriesWithProducts()) {
            expect(
                links.some((link) => link.href === `/tools#${category.id}`),
                `no /tools#${category.id} link`,
            ).toBe(true);
        }
    });

    it('reaches every tool that has a page of its own', () => {
        const hrefs = new Set(links.map((link) => link.href));

        for (const tool of TOOLS.filter((entry) => entry.hasOwnPage)) {
            expect(hrefs.has(tool.href), `${tool.href} is not reachable from browse by need`).toBe(true);
        }
    });
});

describe('what the page promises', () => {
    it('makes no global claim about metadata in the output', () => {
        expect(html).not.toMatch(/no metadata in the output/i);
        expect(html).not.toMatch(/carries no EXIF/i);
        expect(html).not.toMatch(/EXIF and GPS data are gone/i);
    });

    it('sends the reader to the tool page for what that tool changes', () => {
        expect(text).toMatch(/each tool page|every tool page/i);
    });

    it('states the mechanism rather than only the reassurance', () => {
        expect(text).toMatch(/WebAssembly/);
        expect(text).toMatch(/connect-src/);
        expect(text).toMatch(/saved by (the|your) browser|written by (the|your) browser/i);
    });

    it('keeps the durable free-tools promise', () => {
        expect(text).toMatch(/every core Resizo tool is free to use/i);
        expect(text).toMatch(/no account, no watermark and no daily quota/i);
    });

    it('keeps the FAQ and the structured data', () => {
        expect(facts.headings.some((heading) => heading.text === 'Frequently asked questions')).toBe(true);
        const types = facts.jsonLd.flat().map((node) => node['@type']);
        expect(types).toContain('FAQPage');
        expect(types).toContain('SoftwareApplication');
        expect(JSON.stringify(facts.jsonLd)).not.toMatch(/aggregateRating|"review"/i);
    });

    it('canonicalises to itself and makes the no-upload claim inside the snippet budget', () => {
        expect(facts.metadata.alternates.canonical).toBe('https://www.resizo.net/');
        const match = facts.metadata.description.match(/without uploading|on your own device|nothing is uploaded/i);
        expect(match).toBeTruthy();
        expect(match.index + match[0].length).toBeLessThanOrEqual(155);
    });
});

describe('the homepage does not become a wall of links', () => {
    it('links only real routes', () => {
        for (const link of facts.links) {
            expect(routeExists(link.href), `${link.href} has no page`).toBe(true);
        }
    });

    it('shows at most three tools per category in browse by need', () => {
        const document = new DOMParser().parseFromString(
            `<!doctype html><html><body>${html}</body></html>`,
            'text/html',
        );

        for (const cell of document.querySelectorAll('#browse li')) {
            const tools = [...cell.querySelectorAll('a[href]')]
                .filter((anchor) => !anchor.getAttribute('href').includes('#'));
            expect(tools.length).toBeLessThanOrEqual(3);
        }
    });
});
