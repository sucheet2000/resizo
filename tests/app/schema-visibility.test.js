/**
 * STRUCTURED DATA DESCRIBES WHAT THE PAGE SHOWS
 *
 * Every rich-result guideline Google has published says the same thing in the
 * same words: the markup must represent the main content of the page, and
 * describing content a visitor cannot see is grounds for a structured-data
 * manual action. The penalty is not that the offending node is dropped — it is
 * that EVERY structured-data node on the page is ignored, the legitimate
 * BreadcrumbList included. So one invented FAQ question costs the whole graph.
 *
 * Nothing in the build can see this. The JSON-LD is assembled by lib/schema.js
 * from arrays, the visible copy is rendered by components from (usually) those
 * same arrays, and the moment one caller passes a different array to the two
 * the page starts lying with nothing going red. That has a name here already:
 * HowToSteps and FaqList exist precisely so a caller CAN'T hand the builder one
 * list and the reader another — this suite is the proof that no page has found
 * a way around them.
 *
 * Rendered with react-dom/server and read with string matching rather than a
 * DOM: the assertions are about text a person sees, in the order they see it,
 * and none of them needs a parser.
 *
 * WHAT IS DELIBERATELY NOT ASSERTED: that a SoftwareApplication `name` appears
 * verbatim on the page. It does not, on any page — "Resizo Image Compressor"
 * names the application, "Compress Images Online" is the headline, and both are
 * correct. What IS asserted is that every content word of the name is on the
 * page, so a node can never describe a product the page is not about, and that
 * the name never silently falls back to the bare site name (schema.js does that
 * when it is handed nothing, which would put "Resizo" on ten different URLs).
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { INTENT_TOOL_SLUGS } from '@/app/(tools)/[slug]/IntentTool';
import CompressTool from '@/app/(tools)/compress/CompressTool';
import ConvertTool from '@/app/(tools)/convert/ConvertTool';
import HeicTool from '@/app/(tools)/heic/HeicTool';
import ResizeTool from '@/app/(tools)/resize/ResizeTool';
import AboutPage from '@/app/(marketing)/about/page';
import SiteFooter from '@/components/layout/SiteFooter';
import GuidePage from '@/components/guide/GuidePage';
import IntentPage from '@/components/intent/IntentPage';
import { GUIDES, INTENTS, sitemapTools } from '@/lib/catalog';
import { absoluteUrl } from '@/lib/seo';

/**
 * Every page.js in the tree, lazily. A glob rather than a hand-kept list, so a
 * route added by anyone is audited the first time this suite runs after it
 * lands — including app/(marketing)/guides/, which is being written in
 * parallel with this file and is covered the moment it exists.
 */
const PAGE_MODULES = import.meta.glob('../../app/**/page.js');

/** '../../app/(tools)/compress/page.js' → '/compress' */
function routeOf(file) {
    const segments = file
        .replace('../../app', '')
        .replace(/\/page\.js$/, '')
        .split('/')
        .filter((segment) => segment !== '' && !(segment.startsWith('(') && segment.endsWith(')')));

    return segments.length === 0 ? '/' : `/${segments.join('/')}`;
}

const ROUTES = Object.entries(PAGE_MODULES)
    .map(([file, load]) => ({ file, route: routeOf(file), load }))
    // The dynamic segment serves the intents, which are rendered below through
    // IntentPage — the route itself renders a lazy client switch that produces
    // only a fallback under renderToStaticMarkup.
    .filter((page) => !page.file.includes('['));

const TOOL_ROUTES = sitemapTools().map((tool) => ({
    tool,
    page: ROUTES.find((page) => page.route === tool.href),
}));

const GUIDE_ROUTES = ROUTES.filter((page) => page.route.startsWith('/guides'));

/** The real tools, as the intent route loads them. */
const TOOL_COMPONENTS = {
    compress: CompressTool,
    convert: ConvertTool,
    heic: HeicTool,
    resize: ResizeTool,
};

/* ------------------------------------------------------------------ *
 * Reading a rendered page the way a person reads it
 * ------------------------------------------------------------------ */

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', '#x27': "'", '#39': "'", nbsp: ' ' };

const decode = (value) => value.replace(/&(#x27|#39|amp|lt|gt|quot|nbsp);/g, (_, name) => ENTITIES[name]);

const collapse = (value) => decode(value).replace(/\s+/g, ' ').trim();

/** Everything a visitor can read, with the markup and the scripts taken out. */
function visibleText(html) {
    return collapse(
        html
            .replace(/<script[\s\S]*?<\/script>/g, ' ')
            .replace(/<style[\s\S]*?<\/style>/g, ' ')
            .replace(/<[^>]+>/g, ' '),
    );
}

function jsonLd(html) {
    return [...html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/g)]
        .flatMap(([, json]) => {
            const parsed = JSON.parse(json);
            return Array.isArray(parsed) ? parsed : [parsed];
        });
}

/** Every heading on the page, in document order, as plain text. */
function headings(html) {
    return [...html.matchAll(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/g)].map(([, inner]) => visibleText(inner));
}

/** The visible breadcrumb trail: the text of each crumb and the link, if any. */
function breadcrumb(html) {
    const nav = html.match(/<nav[^>]*aria-label="Breadcrumb"[^>]*>([\s\S]*?)<\/nav>/)?.[1];
    if (!nav) return [];

    return [...nav.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)].map(([, item]) => ({
        // The separator between crumbs is aria-hidden, so it is not read.
        text: visibleText(item.replace(/<span[^>]*aria-hidden="true"[^>]*>[\s\S]*?<\/span>/g, ' ')),
        href: item.match(/<a[^>]*href="([^"]*)"/)?.[1] ?? null,
    }));
}

const nodesOfType = (nodes, type) => nodes.filter((node) => node?.['@type'] === type);

/** Every key anywhere in a graph, however deeply nested. */
function everyKey(value, found = new Set()) {
    if (Array.isArray(value)) {
        for (const entry of value) everyKey(entry, found);
    } else if (value && typeof value === 'object') {
        for (const [key, child] of Object.entries(value)) {
            found.add(key);
            everyKey(child, found);
        }
    }
    return found;
}

/** The positions of each string in `text`, or -1 where it is absent. */
const positions = (text, values) => values.map((value) => text.indexOf(value));

const STOP_WORDS = new Set(['a', 'an', 'and', 'the', 'to', 'for', 'of', 'in', 'on', 'with', 'from', 'your', 'resizo']);

/** The words of an application name that actually name the product. */
const contentWords = (name) =>
    (name.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((word) => !STOP_WORDS.has(word));

/**
 * Is `word` on the page, allowing for the agent noun a product name uses where
 * the page uses the verb — a "Converter" is what a page that says "convert"
 * is. Anything shorter than the stem is a different word, and a name naming a
 * different product ("PDF Merger" on /crop) still finds nothing.
 */
function saysWord(text, word) {
    const stem = word.replace(/(er|or|r)$/, '');
    return text.includes(word) || (stem.length >= 4 && text.includes(stem));
}

/* ------------------------------------------------------------------ *
 * The pages under audit
 * ------------------------------------------------------------------ */

async function renderRoute(page) {
    const Page = (await page.load()).default;
    // Every page in app/ is a synchronous server component today; an async one
    // would return a promise here and the assertions would read `undefined`.
    const rendered = Page({});
    expect(typeof rendered, `${page.route} did not render synchronously`).toBe('object');
    return renderToStaticMarkup(rendered);
}

function renderIntent(intent) {
    return renderToStaticMarkup(
        createElement(IntentPage, { intent, Tool: TOOL_COMPONENTS[intent.tool] }),
    );
}

describe('the pages this suite audits', () => {
    it('found every tool page on disk', () => {
        // A glob that matched nothing would make every assertion below vacuous.
        expect(ROUTES.length).toBeGreaterThanOrEqual(12);

        const missing = TOOL_ROUTES.filter((entry) => !entry.page).map((entry) => entry.tool.href);
        expect(missing, `these registry tools have no page.js to audit:\n${missing.join('\n')}`).toEqual([]);
        expect(TOOL_ROUTES.length).toBeGreaterThanOrEqual(10);
    });

    it('has the real component for every tool an intent may hang off', () => {
        // A stub tool would render no breadcrumb, and the breadcrumb assertions
        // would then pass by comparing two empty lists.
        expect(Object.keys(TOOL_COMPONENTS).sort()).toEqual([...INTENT_TOOL_SLUGS].sort());
        expect(INTENTS.length).toBeGreaterThanOrEqual(15);
    });

    it('audits the guide routes and every published guide', () => {
        // The guide registry is deliberately empty until the first benchmark
        // exists, so this counts rather than demands: the index page is audited
        // as soon as its route lands, and each guide entry the run after it is
        // written. A count that never moves off zero is a question for whoever
        // owns lib/catalog/guides/, not a failure here.
        expect(GUIDE_ROUTES.every((page) => page.route.startsWith('/guides'))).toBe(true);
        expect(GUIDES.every((guide) => guide.path?.startsWith('/guides/'))).toBe(true);
        expect(CASES.length).toBe(TOOL_ROUTES.length + GUIDE_ROUTES.length + GUIDES.length + INTENTS.length);
    });
});

/* ------------------------------------------------------------------ *
 * Every node, on every page
 * ------------------------------------------------------------------ */

const CASES = [
    ...TOOL_ROUTES.filter((entry) => entry.page).map((entry) => ({
        name: entry.tool.href,
        route: entry.tool.href,
        render: () => renderRoute(entry.page),
    })),
    ...GUIDE_ROUTES.map((page) => ({
        name: page.route,
        route: page.route,
        render: () => renderRoute(page),
    })),
    ...GUIDES.map((guide) => ({
        name: guide.path,
        route: guide.path,
        render: async () => renderToStaticMarkup(createElement(GuidePage, { guide })),
    })),
    ...INTENTS.map((intent) => ({
        name: intent.path,
        route: intent.path,
        render: () => renderIntent(intent),
    })),
];

describe.each(CASES.map((page) => [page.name, page]))('%s', (_name, page) => {
    it('renders structured data and something to compare it against', async () => {
        const html = await page.render();
        expect(jsonLd(html).length, 'no JSON-LD on the page at all').toBeGreaterThan(0);
        // /guides is an index that is deliberately short while its registry is
        // empty, so this is the floor for "the extraction read a real page",
        // not a content-length rule.
        expect(visibleText(html).length, 'nothing visible to compare the markup with').toBeGreaterThan(200);
        expect(headings(html).length, 'a page with no heading at all').toBeGreaterThan(0);
    });

    it('describes the breadcrumb a visitor can see, in the same order', async () => {
        const html = await page.render();
        const [list] = nodesOfType(jsonLd(html), 'BreadcrumbList');
        const visible = breadcrumb(html);

        expect(list, 'a page with a visible trail must describe it').toBeTruthy();
        expect(visible.length, 'BreadcrumbList markup with no trail on the page').toBeGreaterThan(1);

        expect(list.itemListElement.map((item) => item.name)).toEqual(visible.map((crumb) => crumb.text));

        for (const [index, item] of list.itemListElement.entries()) {
            expect(item.position).toBe(index + 1);

            const href = visible[index].href;
            if (href) {
                expect(item.item, `crumb ${index + 1} points somewhere the link does not`).toBe(absoluteUrl(href));
            } else {
                // The last crumb is the page itself and is not a link.
                expect(item.item).toBe(absoluteUrl(page.route));
            }
        }
    });

    it('asks no question the page does not ask', async () => {
        const html = await page.render();
        const [faq] = nodesOfType(jsonLd(html), 'FAQPage');
        if (!faq) return;

        const asked = faq.mainEntity.map((entity) => entity.name);
        const visible = headings(html);
        const text = visibleText(html);

        expect(asked.length).toBeGreaterThan(0);

        for (const question of asked) {
            expect(visible, `the markup asks "${question}", which is not a heading on the page`).toContain(question);
        }

        // Answers are prose rather than headings, so they are matched in the
        // body — an answer only the crawler can read is the same defect.
        for (const entity of faq.mainEntity) {
            expect(
                text.includes(collapse(entity.acceptedAnswer.text)),
                `the answer to "${entity.name}" is not on the page`,
            ).toBe(true);
        }

        const where = positions(text, asked);
        expect(where.every((index) => index >= 0)).toBe(true);
        expect(where, 'the FAQ markup is in a different order than the page').toEqual([...where].sort((a, b) => a - b));
    });

    it('lists no step the page does not walk through', async () => {
        const html = await page.render();
        const [howto] = nodesOfType(jsonLd(html), 'HowTo');
        if (!howto) return;

        const text = visibleText(html);
        const names = howto.step.map((step) => step.name);

        expect(names.length).toBeGreaterThan(1);

        for (const [index, step] of howto.step.entries()) {
            expect(step.position).toBe(index + 1);
            expect(text.includes(step.name), `step "${step.name}" is not on the page`).toBe(true);
            expect(
                text.includes(collapse(step.text)),
                `the instruction for "${step.name}" is not on the page`,
            ).toBe(true);
        }

        const where = positions(text, names);
        expect(where, 'the procedure is described in a different order than it is shown').toEqual(
            [...where].sort((a, b) => a - b),
        );
    });

    it('names an application the page is about', async () => {
        const html = await page.render();
        const [app] = nodesOfType(jsonLd(html), 'SoftwareApplication');
        if (!app) return;

        const text = visibleText(html).toLowerCase();
        const words = contentWords(app.name);

        expect(app.name, 'schema.js falls back to the bare site name when handed nothing').not.toBe('Resizo');
        expect(words.length, `"${app.name}" says nothing but the brand`).toBeGreaterThan(0);

        for (const word of words) {
            expect(saysWord(text, word), `"${app.name}" contains "${word}", which is nowhere on ${page.route}`).toBe(true);
        }

        expect(app.url, 'the application node points at another URL').toBe(absoluteUrl(page.route));
    });

    it('carries the headline of any article it declares', async () => {
        const html = await page.render();
        const [article] = nodesOfType(jsonLd(html), 'Article');
        if (!article) return;

        const text = visibleText(html);
        expect(article.headline, 'an Article with no headline').toBeTruthy();
        expect(text.includes(article.headline), `the headline "${article.headline}" is not on the page`).toBe(true);

        for (const key of ['datePublished', 'dateModified']) {
            if (article[key] === undefined) continue;
            expect(article[key], `${key} is not a calendar date`).toMatch(/^\d{4}-\d{2}-\d{2}/);
        }
    });

    it('invents no rating and no review', async () => {
        const html = await page.render();
        const keys = everyKey(jsonLd(html));

        // Google requires one of these for the SoftwareApplication rich result,
        // and this site has no real users to source one from. A fabricated one
        // is a manual action that silences every node on the page.
        expect([...keys].filter((key) => key === 'aggregateRating' || key === 'review')).toEqual([]);
        expect([...keys]).not.toContain('ratingValue');
        expect([...keys]).not.toContain('reviewCount');
    });
});

/* ------------------------------------------------------------------ *
 * The organisation claims nothing the site does not show
 * ------------------------------------------------------------------ */

describe('the Organization node', () => {
    it('links only to profiles the site itself links to', async () => {
        const about = renderToStaticMarkup(createElement(AboutPage));
        const footer = renderToStaticMarkup(createElement(SiteFooter));

        const [organization] = nodesOfType(jsonLd(about), 'Organization');
        expect(organization, '/about must carry the Organization node').toBeTruthy();
        expect(organization.sameAs.length, 'sameAs claims nothing at all').toBeGreaterThan(0);

        const visibleLinks = new Set(
            [about, footer].flatMap((html) =>
                [...html.matchAll(/href="(https:\/\/[^"]*)"/g)].map(([, href]) => href),
            ),
        );
        expect(visibleLinks.size, 'no external link was found to compare sameAs against').toBeGreaterThan(0);

        for (const profile of organization.sameAs) {
            expect(
                visibleLinks.has(profile),
                `sameAs claims ${profile}, which no page on the site links to`,
            ).toBe(true);
        }
    });

    it('is the same organisation the page names', async () => {
        const about = renderToStaticMarkup(createElement(AboutPage));
        const [organization] = nodesOfType(jsonLd(about), 'Organization');

        expect(visibleText(about)).toContain(organization.name);
        expect(visibleText(about)).toContain(organization.founder.name);
    });
});
