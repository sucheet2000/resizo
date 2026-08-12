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
} = {}) {
    const url = absoluteUrl(path);

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

    if (Array.isArray(keywords) && keywords.length > 0) {
        metadata.keywords = keywords;
    }

    return metadata;
}
