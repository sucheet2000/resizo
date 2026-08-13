/**
 * SiteHeader
 *
 * One header for every route. The nav links come from the TOOLS registry, so
 * the four hand-copied headers that each linked to a /resize route that
 * returned 404 cannot come back.
 *
 * A server component: only the mobile disclosure needs the browser, and it is
 * a separate island.
 */
import Link from 'next/link';

import MobileNav from '@/components/layout/MobileNav';
import { TOOL_MARKS } from '@/components/tools/OperationMark';
import Logo from '@/components/ui/Logo';
import { TOOLS } from '@/lib/catalog';

function navItems() {
    const tools = TOOLS.filter((tool) => tool.hasOwnPage).map((tool) => ({
        href: tool.href,
        label: tool.shortTitle,
        mark: TOOL_MARKS[tool.slug]?.mark,
    }));

    return [...tools, { href: '/about', label: 'About' }];
}

export default function SiteHeader() {
    const items = navItems();

    return (
        <header className="border-b border-line bg-surface">
            <div className="shell flex h-16 items-center justify-between gap-4">
                <Link
                    href="/"
                    className="rounded-button text-ink transition-opacity duration-120 ease-snap hover:opacity-80"
                >
                    <Logo />
                    <span className="sr-only">Resizo home</span>
                </Link>

                <nav aria-label="Tools" className="hidden md:block">
                    <ul className="flex items-center gap-1">
                        {items.map((item) => (
                            <li key={item.href}>
                                <Link
                                    href={item.href}
                                    className="rounded-button px-3 py-1.5 text-ui text-ink-muted transition-colors duration-120 ease-snap hover:bg-surface-sunken hover:text-ink"
                                >
                                    {item.label}
                                </Link>
                            </li>
                        ))}
                    </ul>
                </nav>

                <MobileNav items={items} className="md:hidden" />
            </div>
        </header>
    );
}
