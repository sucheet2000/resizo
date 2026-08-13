/**
 * IntentLinks
 *
 * The hub-to-spoke block: from a tool page down to the long-tail pages that
 * preconfigure it, and from one spoke across to its siblings.
 *
 * Each row is the situation that would send someone there, not the keyword —
 * "A photograph saved as a PNG, many times heavier than it needs to be" tells a
 * visitor whether the link is for them; "PNG to JPG" on its own does not. The
 * rows come from LONGTAIL_PAGES, so a route that exists is always linked and a
 * route that is renamed moves everywhere at once.
 */
import Link from 'next/link';

import { longtailPagesFor } from '@/lib/catalog';

export default function IntentLinks({
    tool,
    exclude,
    heading,
    id = 'intent-links',
    className = '',
}) {
    const pages = longtailPagesFor(tool, { exclude });
    if (pages.length === 0) return null;

    return (
        <section aria-labelledby={id} className={className}>
            <h2 id={id} className="font-display text-title font-bold tracking-tight text-ink">
                {heading}
            </h2>

            <ul className="mt-4 flex flex-col gap-3">
                {pages.map((page) => (
                    <li key={page.slug} className="text-base text-ink-muted">
                        {page.blurb}
                        {' — '}
                        <Link
                            href={page.path}
                            className="rounded-input font-medium text-accent underline underline-offset-4 transition-opacity duration-120 ease-snap hover:opacity-80"
                        >
                            {page.label}
                            <span aria-hidden="true"> →</span>
                        </Link>
                    </li>
                ))}
            </ul>
        </section>
    );
}
