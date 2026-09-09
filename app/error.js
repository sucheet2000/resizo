'use client';

/**
 * Route-level error boundary.
 *
 * Shows the reset control first, because in this app almost every runtime
 * error is one bad upload away from working again. The error text itself is
 * logged, never printed — a stack trace is not a message for a visitor.
 *
 * DELIBERATELY CHROME-FREE, AND THAT IS A BUNDLE DECISION.
 *
 * error.js is a client entry, so Next must have its chunk group available on
 * every page load — the RSC manifest lists it on every prerendered route. While
 * it imported SiteHeader and SiteFooter, that pulled Logo, MobileNav,
 * OperationMark and next/link into a second client copy of chrome the server
 * already renders, and shipped it eagerly to everyone on every page for the
 * sake of a page almost nobody sees. Measured, that chunk duplicated 11,550 B
 * of module bodies already present in MobileNav's own chunk.
 *
 * So: no header and no footer. Measured, that is 17.5 KB raw / 6.3 KB gzip off
 * EVERY route's eager JS.
 *
 * next/link is deliberately KEPT, and it costs about half the win — dropping it
 * too would take a further 3.4 KB gzip, but a plain <a> to an internal page
 * trips @next/next/no-html-link-for-pages, and silencing that rule on this file
 * is a judgement the owner should make rather than something to slip in behind
 * a bundle number. (The argument for it is real: on an error boundary a full
 * document load is arguably the CORRECT behaviour, because a router-driven
 * navigation depends on the very router that may itself be in a bad state.)
 *
 * The page still renders inside app/layout.js, so it keeps the fonts, the theme
 * and the background, and it keeps the tool list — the part that actually helps
 * someone whose page just broke.
 */
import Link from 'next/link';
import { useEffect } from 'react';

import { TOOLS } from '@/lib/catalog/tools';

export default function GlobalError({ error, reset }) {
    useEffect(() => {
        console.error('[resizo] route error', error);
    }, [error]);

    const tools = TOOLS.filter((tool) => tool.hasOwnPage);

    return (
        <div className="shell max-w-[72ch] py-16">
            <h1 className="font-display text-headline font-bold tracking-tight text-ink">
                Something broke on this page
            </h1>
            <p className="mt-3 text-lead text-ink-muted">
                Nothing was saved and no file was kept. Try the page again — if it keeps
                failing, one of the tools below will do the same job.
            </p>

            {error?.digest ? (
                <p className="mt-4 font-data text-micro text-ink-muted">
                    Reference: {error.digest}
                </p>
            ) : null}

            <div className="mt-8 flex flex-wrap gap-3">
                <button
                    type="button"
                    onClick={() => reset()}
                    className="rounded-button bg-accent px-5 py-3 text-base font-semibold text-accent-ink transition-opacity duration-180 ease-snap hover:opacity-90"
                >
                    Try again
                </button>
                <Link
                    href="/"
                    className="rounded-button border border-line px-5 py-3 text-base text-ink transition-colors duration-120 ease-snap hover:bg-surface-sunken"
                >
                    Go to the homepage
                </Link>
            </div>

            <ul className="mt-10 flex flex-wrap gap-2">
                {tools.map((tool) => (
                    <li key={tool.slug}>
                        <Link
                            href={tool.href}
                            className="inline-flex rounded-pill border border-line px-3 py-1.5 text-ui text-ink-muted transition-colors duration-120 ease-snap hover:bg-surface-sunken hover:text-ink"
                        >
                            {tool.title}
                        </Link>
                    </li>
                ))}
            </ul>
        </div>
    );
}
