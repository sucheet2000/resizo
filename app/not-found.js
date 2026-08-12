/**
 * 404.
 *
 * Branded, and useful: every tool is one click away, because most 404s here
 * are an old bookmark or a mistyped tool name rather than a dead end.
 */
import Link from 'next/link';

import SiteFooter from '@/components/layout/SiteFooter';
import SiteHeader from '@/components/layout/SiteHeader';
import OperationMark from '@/components/tools/OperationMark';
import { TOOLS } from '@/lib/constants';

export const metadata = {
    title: 'Page not found — Resizo',
    robots: { index: false, follow: true },
};

export default function NotFound() {
    const tools = TOOLS.filter((tool) => tool.hasOwnPage);

    return (
        <div className="flex min-h-[100dvh] flex-col">
            <SiteHeader />

            <main className="flex-1">
                <div className="shell max-w-[72ch] py-16">
                    <p className="font-data text-numeral font-bold leading-none text-accent">404</p>

                    <h1 className="mt-4 font-display text-headline font-bold tracking-tight text-ink">
                        That page is not here
                    </h1>
                    <p className="mt-3 text-lead text-ink-muted">
                        The link may be out of date. Every tool is below.
                    </p>

                    <ul className="mt-8 flex flex-col divide-y divide-line border-y border-line">
                        {tools.map((tool) => (
                            <li key={tool.slug}>
                                <Link
                                    href={tool.href}
                                    className="flex items-baseline justify-between gap-4 py-4 transition-colors duration-120 ease-snap hover:bg-surface-sunken"
                                >
                                    <span className="min-w-0">
                                        <span className="block font-display text-lead font-bold text-ink">
                                            {tool.title}
                                        </span>
                                        <span className="block text-ui text-ink-muted">
                                            {tool.description}
                                        </span>
                                    </span>
                                    <OperationMark tool={tool.slug} />
                                </Link>
                            </li>
                        ))}
                    </ul>

                    <p className="mt-8 text-base text-ink-muted">
                        Or go back to the{' '}
                        <Link
                            href="/"
                            className="rounded-input font-medium text-accent underline underline-offset-4"
                        >
                            homepage
                        </Link>
                        .
                    </p>
                </div>
            </main>

            <SiteFooter />
        </div>
    );
}
