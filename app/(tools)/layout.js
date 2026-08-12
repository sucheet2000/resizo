/**
 * Tool route group.
 *
 * Carries the header and footer for every tool page so no tool client renders
 * its own chrome. The column is sized with min-h-[100dvh]: the viewport-height
 * unit accounts for mobile browser chrome, so the footer cannot end up hidden
 * behind it.
 */
import SiteFooter from '@/components/layout/SiteFooter';
import SiteHeader from '@/components/layout/SiteHeader';

export default function ToolsLayout({ children }) {
    return (
        <div className="flex min-h-[100dvh] flex-col">
            <SiteHeader />
            <main className="flex-1">{children}</main>
            <SiteFooter />
        </div>
    );
}
