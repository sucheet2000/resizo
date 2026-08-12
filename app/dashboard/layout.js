/**
 * Dashboard chrome.
 *
 * The dashboard sits outside the (marketing) and (tools) route groups — it is
 * the one authenticated route and it is noindex — but it gets the same header
 * and footer as everything else, so signing in never drops you onto a page
 * with no way back to a tool. It used to render a bespoke header of its own.
 */
import SiteFooter from '@/components/layout/SiteFooter';
import SiteHeader from '@/components/layout/SiteHeader';

export default function DashboardLayout({ children }) {
    return (
        <div className="flex min-h-[100dvh] flex-col">
            <SiteHeader />
            <main className="flex-1">{children}</main>
            <SiteFooter />
        </div>
    );
}
