/**
 * SiteHeader, ToolsMenu, SiteFooter, MobileNav
 *
 * The chrome that used to be hand-copied per page, which is how four headers
 * ended up linking to a route that 404'd and how the tool pages ended up with
 * no link to a privacy policy. Both of those are assertions here: every nav
 * href resolves to a page.js on disk, and the footer carries Privacy and Terms.
 *
 * The bar itself no longer scales with the registry. Seven tool links fit; ten
 * did not, and fifty never will. So the bar carries the three tools people
 * arrive for and the rest of the family lives in one disclosure — which moves
 * the risk from "the bar is too long" to "the menu is a div nobody can reach
 * and a crawler cannot read". That is what most of this file now guards:
 *
 *   - the panel's links are in the server-rendered DOM at all times, carrying
 *     the `hidden` attribute rather than being conditionally rendered, so a
 *     crawler with no JavaScript still sees every tool;
 *   - the disclosure is a real button with the full aria contract, opens from
 *     the keyboard, hands focus to the panel, and gives it back on Escape;
 *   - every own-page tool is reachable from the header exactly the way the
 *     registry says it should be.
 */
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import MobileNav from '@/components/layout/MobileNav';
import SiteFooter from '@/components/layout/SiteFooter';
import SiteHeader from '@/components/layout/SiteHeader';
import { TOOLS, categoriesWithProducts, toolsInCategory } from '@/lib/catalog';
import { routeExists } from '../helpers.jsx';

const pathname = { current: '/resize' };

vi.mock('next/navigation', () => ({
    usePathname: () => pathname.current,
    useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}));

beforeEach(() => {
    pathname.current = '/resize';
});

/** The tools flagged for the bar — the three a visitor arrives for. */
const PRIMARY = TOOLS.filter((tool) => tool.nav);

/** Everything with a page of its own, which is what the menu has to cover. */
const OWN_PAGE = TOOLS.filter((tool) => tool.hasOwnPage);

/** The panel, found the way an assistive technology finds it: through aria-controls. */
function panelFor(name) {
    const button = screen.getByRole('button', { name });
    const id = button.getAttribute('aria-controls');
    return { button, panel: document.getElementById(id) };
}

/** Every href a subtree emits, hidden ones included — a crawler ignores `hidden`. */
function allHrefs(root) {
    return [...root.querySelectorAll('a[href]')].map((link) => link.getAttribute('href'));
}

describe('SiteHeader: the bar', () => {
    it('carries exactly the three primary tools, in registry order, and then About', async () => {
        render(<SiteHeader />);
        const nav = await screen.findByRole('navigation', { name: 'Tools' });

        // The panel is `hidden`, so the accessibility tree holds the bar alone.
        const visible = within(nav).getAllByRole('link');

        expect(visible.map((link) => link.getAttribute('href'))).toEqual([
            ...PRIMARY.map((tool) => tool.href),
            '/about',
        ]);
        expect(visible.map((link) => link.textContent.trim())).toEqual([
            ...PRIMARY.map((tool) => tool.shortTitle),
            'About',
        ]);
    });

    it('keeps the bar to three tools however many the registry grows to', () => {
        expect(PRIMARY.map((tool) => tool.slug)).toEqual(['resize', 'compress', 'convert']);
        expect(OWN_PAGE.length).toBeGreaterThanOrEqual(10);
    });

    it('takes the wordmark home', async () => {
        render(<SiteHeader />);
        expect(await screen.findByRole('link', { name: /Resizo home/ })).toHaveAttribute('href', '/');
    });

    it('emits no dead href anywhere in the header, panel included', () => {
        const { container } = render(<SiteHeader />);

        const hrefs = allHrefs(container);
        expect(hrefs.length).toBeGreaterThan(10);
        for (const href of hrefs) {
            expect(routeExists(href), `${href} has no page.js`).toBe(true);
        }
    });

    it('adds no icon beyond the wordmark and the menu glyph', () => {
        const { container } = render(<SiteHeader />);

        // Tool identity is a typographic operation token. An icon tile per row
        // is the thing DESIGN.md rejects by name.
        const svgs = [...container.querySelectorAll('svg')];
        expect(svgs).toHaveLength(2);
        for (const svg of svgs) expect(svg).toHaveAttribute('aria-hidden', 'true');
    });
});

describe('SiteHeader: the Tools panel', () => {
    it('is in the DOM before anyone touches it, hidden by attribute', () => {
        render(<SiteHeader />);
        const { button, panel } = panelFor('Tools');

        expect(panel).not.toBeNull();
        expect(panel).toHaveAttribute('hidden');
        expect(panel).not.toBeVisible();
        expect(button).toHaveAttribute('aria-expanded', 'false');
    });

    it('holds a link for every own-page tool, grouped under its category, without JavaScript', () => {
        render(<SiteHeader />);
        const { panel } = panelFor('Tools');

        for (const category of categoriesWithProducts()) {
            const members = toolsInCategory(category.id).filter((tool) => tool.hasOwnPage);
            expect(members.length).toBeGreaterThan(0);

            const list = within(panel).getByRole('list', { name: category.title, hidden: true });
            expect(allHrefs(list)).toEqual(members.map((tool) => tool.href));
        }

        const hrefs = allHrefs(panel);
        for (const tool of OWN_PAGE) {
            expect(hrefs, `the panel does not link ${tool.href}`).toContain(tool.href);
        }
    });

    it('names each tool by its title with the operation mark hidden from a screen reader', () => {
        render(<SiteHeader />);
        const { panel } = panelFor('Tools');

        const crop = within(panel).getByRole('link', { name: 'Crop Image', hidden: true });
        expect(crop).toHaveAttribute('href', '/crop');
        expect(within(crop).getByText('⤢')).toHaveAttribute('aria-hidden', 'true');
    });

    it('offers the directory and the guides index at the foot of the panel', () => {
        render(<SiteHeader />);
        const { panel } = panelFor('Tools');

        expect(within(panel).getByRole('link', { name: 'All tools', hidden: true }))
            .toHaveAttribute('href', '/tools');
        expect(within(panel).getByRole('link', { name: 'Guides', hidden: true }))
            .toHaveAttribute('href', '/guides');
    });

    /**
     * The whole point of hiding the panel by attribute rather than by not
     * rendering it. A crawler runs no JavaScript and never opens a
     * disclosure; if the menu were built on click, the nine tools that left
     * the bar would have no inbound link from the header on any page.
     */
    it('ships the entire menu in the server-rendered HTML, hidden rather than absent', () => {
        const html = renderToStaticMarkup(createElement(SiteHeader));

        expect(html).toMatch(/id="tools-menu-panel"[^>]*\shidden/);
        for (const tool of OWN_PAGE) {
            expect(html, `${tool.href} is missing without JavaScript`).toContain(`href="${tool.href}"`);
        }
        expect(html).toContain('href="/tools"');
        expect(html).toContain('href="/guides"');
        expect(html).toContain('href="/about"');
    });

    it('links every own-page tool once the bar and the panel are read together', () => {
        const { container } = render(<SiteHeader />);
        const nav = container.querySelector('nav[aria-label="Tools"]');
        const hrefs = new Set(allHrefs(nav));

        for (const tool of OWN_PAGE) {
            expect(hrefs.has(tool.href), `the header does not link ${tool.href}`).toBe(true);
        }
    });
});

describe('SiteHeader: the Tools disclosure', () => {
    it('is a button carrying the full disclosure contract', () => {
        render(<SiteHeader />);
        const { button, panel } = panelFor('Tools');

        expect(button).toHaveAttribute('type', 'button');
        expect(button).toHaveAttribute('aria-haspopup', 'true');
        expect(button).toHaveAttribute('aria-controls', panel.id);
    });

    it('reveals the panel on click and hides it again', async () => {
        const user = userEvent.setup();
        render(<SiteHeader />);
        const { button, panel } = panelFor('Tools');

        await user.click(button);
        expect(button).toHaveAttribute('aria-expanded', 'true');
        expect(panel).not.toHaveAttribute('hidden');
        expect(panel).toBeVisible();

        await user.click(button);
        expect(button).toHaveAttribute('aria-expanded', 'false');
        expect(panel).toHaveAttribute('hidden');
    });

    it('moves focus to the first link when it is opened from the keyboard', async () => {
        const user = userEvent.setup();
        render(<SiteHeader />);
        const { button, panel } = panelFor('Tools');

        button.focus();
        await user.keyboard('{Enter}');

        expect(button).toHaveAttribute('aria-expanded', 'true');
        expect(panel.querySelector('a[href]')).toHaveFocus();
    });

    it('leaves focus on the button when a pointer opened it', async () => {
        const user = userEvent.setup();
        render(<SiteHeader />);
        const { button } = panelFor('Tools');

        await user.click(button);

        expect(button).toHaveFocus();
    });

    it('closes on Escape and hands focus back to the button', async () => {
        const user = userEvent.setup();
        render(<SiteHeader />);
        const { button, panel } = panelFor('Tools');

        button.focus();
        await user.keyboard('{Enter}');
        await user.keyboard('{Escape}');

        expect(button).toHaveAttribute('aria-expanded', 'false');
        expect(panel).toHaveAttribute('hidden');
        expect(button).toHaveFocus();
    });

    it('closes when a click lands outside it', async () => {
        const user = userEvent.setup();
        render(<SiteHeader />);
        const { button } = panelFor('Tools');

        await user.click(button);
        await user.click(document.body);

        expect(button).toHaveAttribute('aria-expanded', 'false');
    });

    it('closes itself when the route changes underneath it', async () => {
        const user = userEvent.setup();
        const { rerender } = render(<SiteHeader />);
        const { button } = panelFor('Tools');

        await user.click(button);
        expect(button).toHaveAttribute('aria-expanded', 'true');

        pathname.current = '/compress';
        rerender(<SiteHeader />);

        expect(screen.getByRole('button', { name: 'Tools' })).toHaveAttribute('aria-expanded', 'false');
    });
});

describe('SiteFooter', () => {
    it('links the about page', () => {
        render(<SiteFooter />);

        expect(screen.getByRole('link', { name: 'About' })).toHaveAttribute('href', '/about');
    });

    it('links the tools directory from the site column', () => {
        render(<SiteFooter />);
        const nav = screen.getByRole('navigation', { name: 'Resizo' });

        expect(within(nav).getByRole('link', { name: 'All tools' })).toHaveAttribute('href', '/tools');
    });

    it('links the guides index from the site column, so no guide is an orphan', () => {
        render(<SiteFooter />);
        const nav = screen.getByRole('navigation', { name: 'Resizo' });

        expect(within(nav).getByRole('link', { name: 'Guides' })).toHaveAttribute('href', '/guides');
    });

    it('links the public source from the site column', () => {
        render(<SiteFooter />);
        const nav = screen.getByRole('navigation', { name: 'Resizo' });

        expect(within(nav).getByRole('link', { name: 'Source on GitHub' })).toHaveAttribute(
            'href',
            'https://github.com/sucheet2000/resizo',
        );
    });

    it('names the builder in the footer and links the profile the repository confirms', () => {
        render(<SiteFooter />);

        const line = screen.getByText(/Built and maintained by/);
        const profile = within(line).getByRole('link', { name: 'Sucheet Boppana' });
        expect(profile).toHaveAttribute('href', 'https://github.com/sucheet2000');
        expect(profile).toHaveAttribute('rel', expect.stringContaining('noopener'));
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

    // Inverted with the engine: the footer used to have to say the work ran on
    // a server, because it did. It runs on the visitor's device now, so the
    // claim of a transfer is the one that would be false.
    it('states the privacy line truthfully', () => {
        const { container } = render(<SiteFooter />);

        expect(screen.getByText(/run on your device/i)).toBeInTheDocument();
        expect(container.textContent).toMatch(/not uploaded/i);
        expect(container.textContent).not.toMatch(/our servers?/i);
        expect(container.textContent).not.toMatch(/never kept/i);
        expect(container.textContent).not.toMatch(/deleted the moment/i);
    });

    it('labels both footer navs so they are distinguishable', () => {
        render(<SiteFooter />);

        expect(screen.getByRole('navigation', { name: 'Tools' })).toBeInTheDocument();
        expect(screen.getByRole('navigation', { name: 'Resizo' })).toBeInTheDocument();
    });
});

describe('MobileNav', () => {
    const groups = [
        {
            id: 'resize-crop',
            title: 'Resize & Crop',
            tools: [
                { href: '/resize', label: 'Resize Image', mark: 'W×H' },
                { href: '/crop', label: 'Crop Image', mark: '⤢' },
            ],
        },
        {
            id: 'compress',
            title: 'Compress & Optimise',
            tools: [{ href: '/compress', label: 'Compress Image', mark: '−%' }],
        },
    ];

    const links = [
        { href: '/tools', label: 'All tools', arrow: true },
        { href: '/guides', label: 'Guides' },
        { href: '/about', label: 'About' },
    ];

    it('is a real disclosure button', () => {
        render(<MobileNav groups={groups} links={links} />);
        const toggle = screen.getByRole('button', { name: 'Menu' });

        expect(toggle).toHaveAttribute('aria-expanded', 'false');
        expect(toggle).toHaveAttribute('aria-controls', 'mobile-nav-panel');
    });

    it('opens and closes from the keyboard', async () => {
        const user = userEvent.setup();
        render(<MobileNav groups={groups} links={links} />);

        await user.tab();
        const toggle = screen.getByRole('button', { name: 'Menu' });
        expect(toggle).toHaveFocus();

        await user.keyboard('{Enter}');
        expect(toggle).toHaveAttribute('aria-expanded', 'true');
        expect(screen.getByRole('link', { name: 'Resize Image' })).toBeInTheDocument();

        await user.keyboard('{Enter}');
        expect(toggle).toHaveAttribute('aria-expanded', 'false');
    });

    it('closes on Escape and hands focus back to the toggle', async () => {
        const user = userEvent.setup();
        render(<MobileNav groups={groups} links={links} />);
        const toggle = screen.getByRole('button', { name: 'Menu' });

        await user.click(toggle);
        await user.keyboard('{Escape}');

        expect(toggle).toHaveAttribute('aria-expanded', 'false');
        expect(toggle).toHaveFocus();
    });

    it('closes when a click lands outside the panel', async () => {
        const user = userEvent.setup();
        render(<MobileNav groups={groups} links={links} />);

        await user.click(screen.getByRole('button', { name: 'Menu' }));
        await user.click(document.body);

        expect(screen.getByRole('button', { name: 'Menu' })).toHaveAttribute('aria-expanded', 'false');
    });

    it('closes itself when the route changes underneath it', async () => {
        const user = userEvent.setup();
        const { rerender } = render(<MobileNav groups={groups} links={links} />);

        await user.click(screen.getByRole('button', { name: 'Menu' }));
        expect(screen.getByRole('button', { name: 'Menu' })).toHaveAttribute('aria-expanded', 'true');

        pathname.current = '/compress';
        rerender(<MobileNav groups={groups} links={links} />);

        expect(screen.getByRole('button', { name: 'Menu' })).toHaveAttribute('aria-expanded', 'false');
    });

    it('renders nothing with nothing to list', () => {
        const { container } = render(<MobileNav groups={[]} links={[]} />);
        expect(container).toBeEmptyDOMElement();
    });

    it('groups the tools under labelled lists and hides the operation mark', async () => {
        const user = userEvent.setup();
        render(<MobileNav groups={groups} links={links} />);

        await user.click(screen.getByRole('button', { name: 'Menu' }));

        for (const group of groups) {
            const list = screen.getByRole('list', { name: group.title });
            expect([...list.querySelectorAll('a[href]')].map((link) => link.getAttribute('href')))
                .toEqual(group.tools.map((tool) => tool.href));
        }

        expect(screen.getByRole('link', { name: 'Resize Image' })).toBeInTheDocument();
        expect(screen.getByText('W×H')).toHaveAttribute('aria-hidden', 'true');
    });

    it('gives every row a 44px touch target', async () => {
        const user = userEvent.setup();
        render(<MobileNav groups={groups} links={links} />);

        const toggle = screen.getByRole('button', { name: 'Menu' });
        expect(toggle.className).toContain('min-h-11');

        await user.click(toggle);
        for (const link of screen.getAllByRole('link')) {
            expect(link.className, `${link.getAttribute('href')} is under 44px tall`).toContain('min-h-11');
        }
    });
});

describe('the mobile menu the header actually renders', () => {
    it('lists every own-page tool once, grouped by category, plus Guides and About', async () => {
        const user = userEvent.setup();
        const { container } = render(<SiteHeader />);

        await user.click(screen.getByRole('button', { name: 'Menu' }));

        const panel = document.getElementById('mobile-nav-panel');
        const hrefs = allHrefs(panel);

        expect(hrefs.filter((href) => href.startsWith('/') && !href.includes('#')))
            .toEqual([
                ...categoriesWithProducts().flatMap((category) =>
                    toolsInCategory(category.id).filter((tool) => tool.hasOwnPage).map((tool) => tool.href),
                ),
                '/tools',
                '/guides',
                '/about',
            ]);

        for (const href of allHrefs(container)) {
            expect(routeExists(href), `${href} has no page.js`).toBe(true);
        }
    });
});
