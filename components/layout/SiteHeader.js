/**
 * SiteHeader
 *
 * One header for every route. Everything it links comes from the TOOLS
 * registry, so the four hand-copied headers that each linked to a /resize
 * route that returned 404 cannot come back.
 *
 * It is built to survive the family growing. The bar shows the three tools
 * people arrive for and nothing else — seven links already crowded a 64px bar
 * and the registry is at ten — and the rest of the family lives in one Tools
 * menu, grouped by the need a visitor came with. Adding a tool to the registry
 * puts it in the menu under its category with no edit here at all; the only
 * decision left is whether it belongs in the bar, and that is the `nav` flag.
 *
 * A server component. It reads the catalogue barrel, which client code may not
 * touch, and hands the two disclosures plain arrays — so the whole registry,
 * intent copy included, stays out of the first load of every page.
 */
import Link from 'next/link';

import MobileNav from '@/components/layout/MobileNav';
import ToolsMenu from '@/components/layout/ToolsMenu';
import { TOOL_MARKS } from '@/components/tools/OperationMark';
import Logo from '@/components/ui/Logo';
import { TOOLS, categoriesWithProducts, toolsInCategory } from '@/lib/catalog';

// The directory and the guides index sit at the foot of the menu, under a
// rule: the categories above them are the family, and these two are the ways
// out of it. About stays in the bar, where a visitor looks for it.
const PANEL_LINKS = [
    { href: '/tools', label: 'All tools', arrow: true },
    { href: '/guides', label: 'Guides' },
];

const ABOUT = { href: '/about', label: 'About' };

function toRow(tool) {
    return {
        href: tool.href,
        label: tool.title,
        mark: TOOL_MARKS[tool.slug]?.mark,
    };
}

/**
 * Every category holding a tool with a page of its own, each with its tools.
 * A category with nothing to show is never emitted — categoriesWithProducts()
 * is the same rule the /tools directory uses, so the two cannot disagree.
 */
function toolGroups() {
    return categoriesWithProducts().map((category) => ({
        id: category.id,
        title: category.title,
        tools: toolsInCategory(category.id).filter((tool) => tool.hasOwnPage).map(toRow),
    }));
}

export default function SiteHeader() {
    const primary = TOOLS.filter((tool) => tool.nav);
    const groups = toolGroups();

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
                        {primary.map((tool) => (
                            <li key={tool.slug}>
                                <Link
                                    href={tool.href}
                                    className="rounded-button px-3 py-1.5 text-ui text-ink-muted transition-colors duration-120 ease-snap hover:bg-surface-sunken hover:text-ink"
                                >
                                    {tool.shortTitle}
                                </Link>
                            </li>
                        ))}

                        <li>
                            <ToolsMenu groups={groups} links={PANEL_LINKS} />
                        </li>

                        <li>
                            <Link
                                href={ABOUT.href}
                                className="rounded-button px-3 py-1.5 text-ui text-ink-muted transition-colors duration-120 ease-snap hover:bg-surface-sunken hover:text-ink"
                            >
                                {ABOUT.label}
                            </Link>
                        </li>
                    </ul>
                </nav>

                <MobileNav
                    groups={groups}
                    links={[...PANEL_LINKS, ABOUT]}
                    className="md:hidden"
                />
            </div>
        </header>
    );
}
