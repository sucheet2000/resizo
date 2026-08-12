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
import { SITE_NAME, SITE_URL, absoluteUrl } from '@/lib/seo';

const ORGANIZATION_ID = `${SITE_URL}/#organization`;
const WEBSITE_ID = `${SITE_URL}/#website`;

const CONTEXT = 'https://schema.org';

function toText(value) {
    if (typeof value === 'string') return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    return '';
}

/**
 * The publisher node. Every other graph points at it by @id rather than
 * repeating the organisation inline.
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
        offers: {
            '@type': 'Offer',
            price: '0',
            priceCurrency: 'USD',
        },
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
 * @param {Array<{ question?: string, q?: string, answer?: string, a?: string }>} qas
 * The markup must mirror FAQ copy that is actually visible on the page.
 */
export function faqPage(qas) {
    const list = Array.isArray(qas) ? qas : [];

    const entities = list
        .map((entry) => {
            const question = toText(entry?.question ?? entry?.q);
            const answer = toText(entry?.answer ?? entry?.a);
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
