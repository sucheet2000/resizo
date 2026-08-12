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
                // /api/ never renders indexable HTML. /auth/ is kept as a
                // defensive block even though the site no longer serves it.
                disallow: ['/api/', '/auth/'],
            },
        ],
        sitemap: absoluteUrl('/sitemap.xml'),
    };
}
