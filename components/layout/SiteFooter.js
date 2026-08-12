/**
 * SiteFooter
 *
 * On every route, including the tool pages that shipped without one. That gap
 * starved the legal pages of internal links and left the tool pages without a
 * path to the privacy policy or terms.
 */
import Link from 'next/link';

import Logo from '@/components/ui/Logo';
import { TOOLS } from '@/lib/constants';

const COMPANY_LINKS = [
    { href: '/about', label: 'About' },
    { href: '/privacy', label: 'Privacy' },
    { href: '/terms', label: 'Terms' },
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
                        Free image tools. Files are processed on our server and deleted the moment
                        your download starts — never kept. No account, no watermark.
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
                        <li>
                            <a href="mailto:contact@resizo.net" className={linkClass}>
                                Contact
                            </a>
                        </li>
                    </ul>
                </nav>
            </div>

            <div className="border-t border-line">
                <div className="shell flex flex-wrap items-center justify-between gap-2 py-5">
                    <p className="font-data text-micro text-ink-muted">
                        © {new Date().getFullYear()} Resizo
                    </p>
                    <p className="font-data text-micro text-ink-muted">
                        JPEG · PNG · WebP · GIF · HEIC · AVIF
                    </p>
                </div>
            </div>
        </footer>
    );
}
