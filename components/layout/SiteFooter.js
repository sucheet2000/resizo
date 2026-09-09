/**
 * SiteFooter
 *
 * On every route, including the tool pages that shipped without one, so every
 * page keeps a path back to the tool index and to /about.
 */
import Link from 'next/link';

import Logo from '@/components/ui/Logo';
import { TOOLS } from '@/lib/catalog';

const COMPANY_LINKS = [
    { href: '/tools', label: 'All tools' },
    { href: '/about', label: 'About' },
];

const linkClass = 'rounded-input text-ui text-ink-muted transition-colors duration-120 ease-snap hover:text-ink';

export default function SiteFooter() {
    const tools = TOOLS.filter((tool) => tool.hasOwnPage);

    return (
        <footer className="mt-16 border-t border-line bg-surface">
            <div className="shell grid gap-10 py-12 md:grid-cols-[2fr_1fr_1fr]">
                <div className="max-w-[42ch]">
                    <Logo />
                    <p className="mt-3 text-ui text-ink-muted">
                        Free image tools that run on your device. Your files are not uploaded —
                        every tool works in this browser tab. No account, no watermark.
                    </p>
                </div>

                <nav aria-labelledby="footer-tools">
                    <h2 id="footer-tools" className="text-micro font-semibold text-ink">
                        Tools
                    </h2>
                    <ul className="mt-3 flex flex-col gap-2">
                        {tools.map((tool) => (
                            <li key={tool.slug}>
                                <Link href={tool.href} className={linkClass}>
                                    {tool.title}
                                </Link>
                            </li>
                        ))}
                    </ul>
                </nav>

                <nav aria-labelledby="footer-company">
                    <h2 id="footer-company" className="text-micro font-semibold text-ink">
                        Resizo
                    </h2>
                    <ul className="mt-3 flex flex-col gap-2">
                        {COMPANY_LINKS.map((item) => (
                            <li key={item.href}>
                                <Link href={item.href} className={linkClass}>
                                    {item.label}
                                </Link>
                            </li>
                        ))}
                    </ul>
                </nav>
            </div>

            <div className="border-t border-line">
                <div className="shell flex flex-wrap items-center justify-between gap-2 py-5">
                    <p className="font-data text-micro text-ink-muted">
                        © {new Date().getFullYear()} Resizo
                    </p>
                    <p className="font-data text-micro text-ink-muted">
                        JPEG · PNG · WebP · HEIC
                    </p>
                </div>
            </div>
        </footer>
    );
}
