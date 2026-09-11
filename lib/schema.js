/**
 * JSON-LD Builders
 *
 * Pure functions returning plain schema.org objects, so a page never
 * hand-writes a graph and every URL in one is absolute (Google resolves
 * relative @id/url values inconsistently across crawl passes).
 *
 * Nothing here invents data — no fabricated ratings and no review counts, which
 * would be a manual-action risk rather than an SEO win.
 */
import { plainText } from '@/lib/catalog/inline';
import { AUTHOR_NAME, GITHUB_PROFILE_URL, GITHUB_REPO_URL, SITE_NAME, SITE_URL, absoluteUrl } from '@/lib/seo';

const ORGANIZATION_ID = `${SITE_URL}/#organization`;
const WEBSITE_ID = `${SITE_URL}/#website`;

const CONTEXT = 'https://schema.org';

/**
 * The person who builds the site, inline rather than as a node of its own:
 * there is no page here that is about the person, so there is no @id to
 * point at. `url` is the one profile the repository itself confirms — the
 * account that owns it — and it is linked visibly in the footer and on
 * /about, so the markup asserts nothing the page does not show. No other
 * profile is listed, because none is verifiable from here.
 */
const author = () => ({ '@type': 'Person', name: AUTHOR_NAME, url: GITHUB_PROFILE_URL });

function toText(value) {
    if (typeof value === 'string') return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    return '';
}

/**
 * The publisher node. Every other graph points at it by @id rather than
 * repeating the organisation inline.
 *
 * `sameAs` names the one place on the web that is unambiguously this project
 * — the public repository — and `founder` names the person who builds it.
 * Nothing else is claimed: no social profiles, no address, no headcount, no
 * awards, because none of those exist to cite.
 */
export function organization() {
    return {
        '@context': CONTEXT,
        '@type': 'Organization',
        '@id': ORGANIZATION_ID,
        name: SITE_NAME,
        url: absoluteUrl('/'),
        logo: {
            '@type': 'ImageObject',
            url: absoluteUrl('/og-image.jpg'),
            width: 1200,
            height: 630,
        },
        sameAs: [GITHUB_REPO_URL],
        founder: author(),
    };
}

/**
 * No SearchAction: the site has no search endpoint, and declaring one that
 * 404s is worse than declaring none.
 */
export function webSite() {
    return {
        '@context': CONTEXT,
        '@type': 'WebSite',
        '@id': WEBSITE_ID,
        name: SITE_NAME,
        url: absoluteUrl('/'),
        inLanguage: 'en-US',
        publisher: { '@id': ORGANIZATION_ID },
        author: author(),
    };
}

/**
 * A tool page.
 *
 * @param {{ name: string, description?: string, path?: string, href?: string,
 *           category?: string, features?: string[] }} tool
 */
export function softwareApplication(tool = {}) {
    const path = tool.path ?? tool.href ?? '/';
    const url = absoluteUrl(path);
    const name = toText(tool.name) || SITE_NAME;

    const node = {
        '@context': CONTEXT,
        '@type': 'SoftwareApplication',
        '@id': `${url}#software`,
        name,
        url,
        applicationCategory: toText(tool.category) || 'MultimediaApplication',
        operatingSystem: 'Any',
        browserRequirements: 'Requires JavaScript',
        // True of every core tool and stated on every page's trust strip;
        // the Offer below says the same thing in the property Google reads.
        isAccessibleForFree: true,
        offers: {
            '@type': 'Offer',
            price: '0',
            priceCurrency: 'USD',
        },
        author: author(),
        publisher: { '@id': ORGANIZATION_ID },
    };

    const description = toText(tool.description);
    if (description) node.description = description;

    const features = Array.isArray(tool.features)
        ? tool.features.map(toText).filter(Boolean)
        : [];
    if (features.length > 0) node.featureList = features;

    return node;
}

/**
 * A guide — the one content type here that is a document rather than a tool.
 *
 * `Article` is not a rich result and is not being counted as one. What it buys
 * is unambiguous authorship and unambiguous dates: a page whose whole claim is
 * "this was measured, on this day, by this person" should not leave a crawler
 * to infer any of the three from the prose. The visible byline carries the same
 * three facts, so the markup describes what the page shows.
 *
 * Nothing is invented. No `aggregateRating`, no `review`, no `wordCount`, no
 * image the page does not have — the same rule the SoftwareApplication builder
 * follows, for the same reason: one fabricated property costs every node on the
 * page, the legitimate BreadcrumbList included.
 *
 * `publisher` is the organisation inline rather than an `@id` reference,
 * because a guide page emits no Organization node of its own for that id to
 * resolve against — only the homepage and /about do.
 *
 * @param {{ slug?: string, path?: string, h1?: string, title?: string,
 *           description?: string, published?: string, modified?: string }} guide
 */
export function article(guide = {}) {
    const path = guide.path ?? (guide.slug ? `/guides/${guide.slug}` : '/');
    const url = absoluteUrl(path);

    const node = {
        '@context': CONTEXT,
        '@type': 'Article',
        '@id': `${url}#article`,
        headline: toText(guide.h1) || toText(guide.title),
        url,
        author: author(),
        publisher: organization(),
        mainEntityOfPage: { '@type': 'WebPage', '@id': url },
        inLanguage: 'en-US',
    };

    const description = toText(guide.description);
    if (description) node.description = description;

    const published = toText(guide.published);
    if (published) node.datePublished = published;

    // Falls back to datePublished rather than being left off: a crawler that
    // finds no dateModified treats the page as never revised, which is worse
    // than being told it has not changed since publication.
    const modified = toText(guide.modified) || published;
    if (modified) node.dateModified = modified;

    return node;
}

/**
 * @param {Array<{ name: string, path?: string, href?: string }>} items
 * Ordered root-first. Returns null for an empty trail so a caller can splat
 * the result without guarding.
 */
export function breadcrumbList(items) {
    const list = Array.isArray(items) ? items : [];

    const elements = list
        .map((item, index) => {
            const name = toText(item?.name);
            if (!name) return null;

            const path = item?.path ?? item?.href;
            const element = {
                '@type': 'ListItem',
                position: index + 1,
                name,
            };

            if (typeof path === 'string' && path !== '') {
                element.item = absoluteUrl(path);
            }

            return element;
        })
        .filter(Boolean)
        .map((element, index) => ({ ...element, position: index + 1 }));

    if (elements.length === 0) return null;

    return {
        '@context': CONTEXT,
        '@type': 'BreadcrumbList',
        itemListElement: elements,
    };
}

/**
 * A step-by-step procedure.
 *
 * GOOGLE NO LONGER RENDERS THIS. The HowTo rich result was removed on
 * 2023-09-14 — "no longer shown in search results, on both desktop and mobile
 * devices" — and it is absent from the current search gallery. This builder
 * therefore earns no SERP real estate and is not a click-through lever. It is
 * inert rather than penalised, and costs 174 bytes of brotli a page, which is
 * the only reason it is still here. Do not extend it, and do not count it.
 *
 * The VISIBLE steps are the part that still matters: a caller hands the SAME
 * array to this builder and to `components/content/HowToSteps.js`, so the two
 * cannot drift. Keep rendering the steps even if this markup is ever dropped.
 *
 * No `supply`, `tool` or `estimatedCost`: a web page needs no materials and no
 * equipment, and filling those properties in to look complete would be invented
 * data. `totalTime` is absent for the same reason — how long a decode takes is
 * a property of the visitor's machine, not of the procedure.
 *
 * @param {{ name?: string, description?: string, path?: string, href?: string,
 *           anchor?: string,
 *           steps?: Array<{ name?: string, text?: string }> }} howto
 * Returns null when there is no name or no usable step, so a caller can splat
 * the result the same way it splats breadcrumbList() and faqPage().
 */
export function howTo(howto = {}) {
    const name = toText(howto?.name);
    const list = Array.isArray(howto?.steps) ? howto.steps : [];

    const steps = list
        .map((entry) => {
            const stepName = toText(entry?.name);
            const text = toText(entry?.text);
            if (!stepName || !text) return null;
            return { name: stepName, text };
        })
        .filter(Boolean)
        .map((step, index) => ({
            '@type': 'HowToStep',
            position: index + 1,
            name: step.name,
            text: step.text,
        }));

    if (!name || steps.length === 0) return null;

    const path = howto.path ?? howto.href ?? '/';
    const pageUrl = absoluteUrl(path);
    const anchor = toText(howto.anchor);

    const node = {
        '@context': CONTEXT,
        '@type': 'HowTo',
        '@id': `${pageUrl}#howto`,
        name,
        // The fragment points at the visible step list, so a crawler comparing
        // the markup with the page lands on the section it was built from.
        url: anchor ? `${pageUrl}#${anchor}` : pageUrl,
        step: steps,
    };

    const description = toText(howto.description);
    if (description) node.description = description;

    return node;
}

/**
 * GOOGLE NO LONGER RENDERS THIS EITHER, and this site was never eligible. The
 * FAQ rich result stopped appearing on 2026-05-07 and its documentation was
 * deleted on 2026-06-15 — but eligibility had already been narrowed in Aug 2023
 * to "well-known, authoritative government and health websites", so a free image
 * tool has earned nothing from this markup since 2023. Inert, not penalised;
 * see the note on howTo() above for why it is still here.
 *
 * The visible FAQ copy is the valuable half and stays either way.
 *
 * @param {Array<{ question?: string, q?: string, answer?: string, a?: string }>} qas
 * The markup must mirror FAQ copy that is actually visible on the page.
 */
export function faqPage(qas) {
    const list = Array.isArray(qas) ? qas : [];

    const entities = list
        .map((entry) => {
            const question = toText(entry?.question ?? entry?.q);
            // The visible answer may carry `[label](/path)`; the markup gets the text a reader sees.
            const answer = plainText(toText(entry?.answer ?? entry?.a));
            if (!question || !answer) return null;

            return {
                '@type': 'Question',
                name: question,
                acceptedAnswer: {
                    '@type': 'Answer',
                    text: answer,
                },
            };
        })
        .filter(Boolean);

    if (entities.length === 0) return null;

    return {
        '@context': CONTEXT,
        '@type': 'FAQPage',
        mainEntity: entities,
    };
}
