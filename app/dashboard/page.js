import DashboardClient from '@/app/dashboard/DashboardClient';
import { buildMetadata } from '@/lib/seo';

/**
 * The dashboard reads a per-visitor session, so it must never be prerendered
 * into a shared cache entry. The directive belongs here rather than in the
 * client file, where a route segment config is not read at all.
 */
export const dynamic = 'force-dynamic';

/**
 * noindex, nofollow — set here, in metadata, rather than by disallowing the
 * path in robots.txt. A crawl block is not an index block: Google can index a
 * disallowed URL from inbound links alone, and blocking the crawl is exactly
 * what stops it from ever reading this tag. Allow the crawl, serve the noindex.
 *
 * The canonical still comes from buildMetadata so the page cannot inherit the
 * homepage's, which is what it used to do.
 */
export const metadata = {
    ...buildMetadata({
        title: 'Dashboard — Resizo',
        description: 'Your Resizo history: what you processed, how much size it saved, and the controls to export or delete your data.',
        path: '/dashboard',
    }),
    robots: {
        index: false,
        follow: false,
        googleBot: { index: false, follow: false },
    },
};

export default function DashboardPage() {
    return <DashboardClient />;
}
