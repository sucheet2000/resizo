/**
 * robots.txt
 *
 * One allow rule and two disallows. The allow list used to name four paths —
 * '/', '/about', '/privacy', '/terms' — which blocked nothing, because
 * `Allow: /` already matches every URL and robots.txt is most-specific-wins.
 * It only read like an allowlist, and it had drifted out of sync with the
 * routes twice; the next person to "fix" it would have blocked something real.
 */
import { absoluteUrl } from '@/lib/seo';

export default function robots() {
    return {
        rules: [
            {
                userAgent: '*',
                allow: '/',
                // /api/ and /auth/ never render indexable HTML.
                //
                // /dashboard is deliberately NOT here. It carries
                // `robots: { index: false }` in its metadata instead, because a
                // crawl block is not an index block: Google can index a
                // disallowed URL from inbound links alone, and disallowing it
                // is precisely what stops the crawler ever reading the noindex.
                // Allow the crawl, serve the noindex.
                disallow: ['/api/', '/auth/'],
            },
        ],
        sitemap: absoluteUrl('/sitemap.xml'),
    };
}
