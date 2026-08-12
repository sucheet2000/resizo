/**
 * SiteHeader, SiteFooter, MobileNav
 *
 * The chrome that used to be hand-copied per page, which is how four headers
 * ended up linking to a route that 404'd and how four tool pages ended up
 * running the AdSense loader with no link to a privacy policy. Both of those
 * are assertions here: every nav href resolves to a page.js on disk, and the
 * footer carries Privacy and Terms.
 */
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import MobileNav from '@/components/layout/MobileNav';
import SiteFooter from '@/components/layout/SiteFooter';
import SiteHeader from '@/components/layout/SiteHeader';
import { TOOLS } from '@/lib/constants';
import { routeExists } from '../helpers.jsx';

const pathname = { current: '/resize' };

vi.mock('next/navigation', () => ({
    usePathname: () => pathname.current,
    useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}));

vi.mock('@/lib/supabase/client', () => ({
    createClient: () => ({
        auth: {
            getUser: () => Promise.resolve({ data: { user: null } }),
            onAuthStateChange: () => ({ data: { subscription: { unsubscribe: vi.fn() } } }),
            signOut: () => Promise.resolve({ error: null }),
        },
    }),
}));

beforeEach(() => {
    pathname.current = '/resize';
});

describe('SiteHeader', () => {
    it('links every tool that has its own page', async () => {
        render(<SiteHeader />);
        const nav = await screen.findByRole('navigation', { name: 'Tools' });
        const hrefs = within(nav).getAllByRole('link').map((link) => link.getAttribute('href'));

        for (const tool of TOOLS.filter((entry) => entry.hasOwnPage)) {
            expect(hrefs, `${tool.slug} is missing from the header`).toContain(tool.href);
        }
    });

    it('emits no dead href anywhere in the header', async () => {
        render(<SiteHeader />);
        await screen.findByRole('navigation', { name: 'Tools' });

        for (const link of screen.getAllByRole('link')) {
            const href = link.getAttribute('href');
            expect(routeExists(href), `${href} has no page.js`).toBe(true);
        }
    });

    it('takes the wordmark home', async () => {
        render(<SiteHeader />);
        expect(await screen.findByRole('link', { name: /Resizo home/ })).toHaveAttribute('href', '/');
    });

    it('offers sign-in as a real button for an anonymous visitor', async () => {
        render(<SiteHeader />);
        expect(await screen.findByRole('button', { name: 'Sign in' })).toBeInTheDocument();
    });
});

describe('SiteFooter', () => {
    it('links the privacy policy and the terms — the AdSense requirement', () => {
        render(<SiteFooter />);

        expect(screen.getByRole('link', { name: 'Privacy' })).toHaveAttribute('href', '/privacy');
        expect(screen.getByRole('link', { name: 'Terms' })).toHaveAttribute('href', '/terms');
    });

    it('links every tool page', () => {
        render(<SiteFooter />);
        const nav = screen.getByRole('navigation', { name: 'Tools' });
        const hrefs = within(nav).getAllByRole('link').map((link) => link.getAttribute('href'));

        expect(hrefs).toEqual(TOOLS.filter((tool) => tool.hasOwnPage).map((tool) => tool.href));
    });

    it('emits no dead href', () => {
        render(<SiteFooter />);

        for (const link of screen.getAllByRole('link')) {
            const href = link.getAttribute('href');
            expect(routeExists(href), `${href} has no page.js`).toBe(true);
        }
    });

    it('offers a contact address', () => {
        render(<SiteFooter />);
        expect(screen.getByRole('link', { name: 'Contact' }).getAttribute('href')).toMatch(/^mailto:/);
    });

    it('states the privacy line truthfully', () => {
        const { container } = render(<SiteFooter />);

        expect(screen.getByText(/processed in memory on our server/i)).toBeInTheDocument();
        expect(container.textContent).not.toMatch(/in your browser/i);
        expect(container.textContent).not.toMatch(/never leaves? your device/i);
    });

    it('labels both footer navs so they are distinguishable', () => {
        render(<SiteFooter />);

        expect(screen.getByRole('navigation', { name: 'Tools' })).toBeInTheDocument();
        expect(screen.getByRole('navigation', { name: 'Resizo' })).toBeInTheDocument();
    });
});

describe('MobileNav', () => {
    const items = [
        { href: '/resize', label: 'Resize', mark: 'W×H' },
        { href: '/compress', label: 'Compress', mark: '−%' },
    ];

    it('is a real disclosure button', () => {
        render(<MobileNav items={items} />);
        const toggle = screen.getByRole('button', { name: 'Menu' });

        expect(toggle).toHaveAttribute('aria-expanded', 'false');
        expect(toggle).toHaveAttribute('aria-controls', 'mobile-nav-panel');
    });

    it('opens and closes from the keyboard', async () => {
        const user = userEvent.setup();
        render(<MobileNav items={items} />);

        await user.tab();
        const toggle = screen.getByRole('button', { name: 'Menu' });
        expect(toggle).toHaveFocus();

        await user.keyboard('{Enter}');
        expect(toggle).toHaveAttribute('aria-expanded', 'true');
        expect(screen.getByRole('link', { name: /Resize/ })).toBeInTheDocument();

        await user.keyboard('{Enter}');
        expect(toggle).toHaveAttribute('aria-expanded', 'false');
    });

    it('closes on Escape and hands focus back to the toggle', async () => {
        const user = userEvent.setup();
        render(<MobileNav items={items} />);
        const toggle = screen.getByRole('button', { name: 'Menu' });

        await user.click(toggle);
        await user.keyboard('{Escape}');

        expect(toggle).toHaveAttribute('aria-expanded', 'false');
        expect(toggle).toHaveFocus();
    });

    it('closes when a click lands outside the panel', async () => {
        const user = userEvent.setup();
        render(<MobileNav items={items} />);

        await user.click(screen.getByRole('button', { name: 'Menu' }));
        await user.click(document.body);

        expect(screen.getByRole('button', { name: 'Menu' })).toHaveAttribute('aria-expanded', 'false');
    });

    it('closes itself when the route changes underneath it', async () => {
        const user = userEvent.setup();
        const { rerender } = render(<MobileNav items={items} />);

        await user.click(screen.getByRole('button', { name: 'Menu' }));
        expect(screen.getByRole('button', { name: 'Menu' })).toHaveAttribute('aria-expanded', 'true');

        pathname.current = '/compress';
        rerender(<MobileNav items={items} />);

        expect(screen.getByRole('button', { name: 'Menu' })).toHaveAttribute('aria-expanded', 'false');
    });

    it('renders nothing without items', () => {
        const { container } = render(<MobileNav items={[]} />);
        expect(container).toBeEmptyDOMElement();
    });

    it('hides the operation mark from a screen reader', async () => {
        const user = userEvent.setup();
        render(<MobileNav items={items} />);

        await user.click(screen.getByRole('button', { name: 'Menu' }));

        expect(screen.getByRole('link', { name: 'Resize' })).toBeInTheDocument();
        expect(screen.getByText('W×H')).toHaveAttribute('aria-hidden', 'true');
    });
});
