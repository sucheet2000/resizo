/**
 * Marketing route group — the homepage and /about.
 *
 * Same chrome as the tool group, kept as a separate layout so the two can
 * diverge (a tool page will eventually want a narrower main) without either
 * one growing a conditional.
 */
import SiteFooter from '@/components/layout/SiteFooter';
import SiteHeader from '@/components/layout/SiteHeader';

export default function MarketingLayout({ children }) {
    return (
        <div className="flex min-h-[100dvh] flex-col">
            <SiteHeader />
            <main className="flex-1">{children}</main>
            <SiteFooter />
        </div>
    );
}
