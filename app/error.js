'use client';

/**
 * Route-level error boundary.
 *
 * Shows the reset control first, because in this app almost every runtime
 * error is one bad upload away from working again. The error text itself is
 * logged, never printed — a stack trace is not a message for a visitor.
 */
import Link from 'next/link';
import { useEffect } from 'react';

import SiteFooter from '@/components/layout/SiteFooter';
import SiteHeader from '@/components/layout/SiteHeader';
import { TOOLS } from '@/lib/catalog';

export default function GlobalError({ error, reset }) {
    useEffect(() => {
        console.error('[resizo] route error', error);
    }, [error]);

    const tools = TOOLS.filter((tool) => tool.hasOwnPage);

    return (
        <div className="flex min-h-[100dvh] flex-col">
            <SiteHeader />

            <main className="flex-1">
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
            </main>

            <SiteFooter />
        </div>
    );
}
