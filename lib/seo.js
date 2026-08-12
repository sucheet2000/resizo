/**
 * Per-Route Metadata
 *
 * Every page composes its own metadata here so it carries its own canonical
 * and its own openGraph.url. The root layout must not declare either: Next
 * inherits them down the tree, which made all eleven routes self-canonicalise
 * to the homepage.
 */

export const SITE_URL = 'https://www.resizo.net';

export const SITE_NAME = 'Resizo';

export const DEFAULT_OG_IMAGE = '/og-image.jpg';

/**
 * How much of a page a search engine may show.
 *
 * Without these Google clips the snippet to its own short default and shows no
 * image preview. At an average position of 9 the snippet is the entire pitch —
 * being found is not the problem here, being chosen is — so every indexable
 * page opts into a full-length snippet and a large thumbnail.
 *
 * Stated once, at the top level, which Next renders as <meta name="robots">.
 * Google reads that tag as well as the googleBot-specific one, so a googleBot
 * block would be a second copy of the same sentence that Bing and everyone
 * else still could not see. This object is the only copy: the root layout
 * imports it as the site-wide default and buildMetadata restates it per page,
 * because a page-level `robots` replaces the inherited one wholesale rather
 * than merging into it.
 */
export const INDEXABLE_ROBOTS = {
    index: true,
    follow: true,
    'max-snippet': -1,
    'max-image-preview': 'large',
    'max-video-preview': -1,
};

const OG_IMAGE_TYPES = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
};

/**
 * og:image:type for a path, or undefined when the extension is not one we
 * ship — a wrong type is worse than a missing one, since a scraper trusts it
 * over the bytes.
 */
export function ogImageType(image) {
    if (typeof image !== 'string') return undefined;
    const extension = image.split('.').pop();
    return OG_IMAGE_TYPES[extension?.toLowerCase()];
}

export function normalizePath(path) {
    if (typeof path !== 'string' || path.trim() === '') return '/';
    const withLeadingSlash = path.startsWith('/') ? path : `/${path}`;
    if (withLeadingSlash === '/') return '/';
    return withLeadingSlash.replace(/\/+$/, '') || '/';
}

export function absoluteUrl(path) {
    return `${SITE_URL}${normalizePath(path)}`;
}

/**
 * Builds a complete Next metadata object for one route.
 */
export function buildMetadata({
    title,
    description,
    path = '/',
    ogImage = DEFAULT_OG_IMAGE,
    keywords,
    type = 'website',
    robots = INDEXABLE_ROBOTS,
} = {}) {
    const url = absoluteUrl(path);
    const imageType = ogImageType(ogImage);

    const metadata = {
        title,
        description,
        alternates: {
            canonical: url,
        },
        openGraph: {
            title,
            description,
            url,
            siteName: SITE_NAME,
            images: [
                {
                    url: ogImage,
                    width: 1200,
                    height: 630,
                    alt: title,
                    ...(imageType ? { type: imageType } : {}),
                },
            ],
            locale: 'en_US',
            type,
        },
        twitter: {
            card: 'summary_large_image',
            title,
            description,
            images: [ogImage],
        },
    };

    // A page that must stay out of the index passes its own object and it is
    // used verbatim — this must never be able to index a noindex page. Passing
    // null leaves the key off so the page inherits the layout default.
    if (robots) {
        metadata.robots = robots;
    }

    if (Array.isArray(keywords) && keywords.length > 0) {
        metadata.keywords = keywords;
    }

    return metadata;
}
