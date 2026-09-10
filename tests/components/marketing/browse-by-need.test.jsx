/**
 * BrowseByNeed — the homepage's second path into the family.
 *
 * "Start with a job" is nine curated entries and cannot grow; this block is
 * the one that scales, because it is the categories themselves. It has to
 * stay a summary rather than a second copy of /tools: the category, what the
 * category is for, a few representative tools, and a way into the directory
 * section that holds the rest.
 *
 * `registry` takes a synthetic set so the hiding rule is proved without
 * shipping an empty category to production to watch it disappear.
 */
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import BrowseByNeed from '@/components/marketing/BrowseByNeed';
import { CATEGORIES, INTENTS, TOOLS, categoriesWithProducts, intentsFor, toolsInCategory } from '@/lib/catalog';
import { routeExists } from '../helpers.jsx';

describe('BrowseByNeed', () => {
    it('renders one cell per category that holds a product, headed at h3', () => {
        render(<BrowseByNeed />);

        const headings = screen.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent);
        expect(headings).toEqual(categoriesWithProducts().map((category) => category.title));
    });

    it('carries the category’s own blurb, never an invented one', () => {
        render(<BrowseByNeed />);

        for (const category of categoriesWithProducts()) {
            expect(screen.getByText(category.blurb)).toBeInTheDocument();
        }
    });

    it('shows at most four representative tools, each with a page of its own', () => {
        const { container } = render(<BrowseByNeed />);

        for (const cell of container.querySelectorAll('li')) {
            const tools = [...cell.querySelectorAll('a[href]')]
                .filter((anchor) => !anchor.getAttribute('href').includes('#'));

            expect(tools.length).toBeGreaterThan(0);
            expect(tools.length).toBeLessThanOrEqual(4);

            for (const anchor of tools) {
                const tool = TOOLS.find((entry) => entry.href === anchor.getAttribute('href'));
                expect(tool, `${anchor.getAttribute('href')} is not a tool`).toBeTruthy();
                expect(tool.hasOwnPage).toBe(true);
            }
        }
    });

    it('deep-links each category into the directory section that holds the rest', () => {
        render(<BrowseByNeed />);

        for (const category of categoriesWithProducts()) {
            const cell = screen.getByRole('heading', { level: 3, name: category.title }).closest('li');
            const link = within(cell).getByRole('link', { name: new RegExp(`All of ${category.title}`) });

            expect(link).toHaveAttribute('href', `/tools#${category.id}`);
        }
    });

    it('counts the pages behind each category from the registry, never by hand', () => {
        // And says "1 page", not "1 pages": Forms & applications holds exactly
        // one product today, and a count is the most-read thing on a card.
        render(<BrowseByNeed />);

        for (const category of categoriesWithProducts()) {
            const members = toolsInCategory(category.id);
            const pages = members.length
                + members.filter((tool) => tool.hasOwnPage).flatMap((tool) => intentsFor(tool.slug)).length;

            const cell = screen.getByRole('heading', { level: 3, name: category.title }).closest('li');
            expect(within(cell).getByText(`${pages} ${pages === 1 ? 'page' : 'pages'}`)).toBeInTheDocument();
        }
    });

    it('emits no dead href', () => {
        render(<BrowseByNeed />);

        for (const link of screen.getAllByRole('link')) {
            expect(routeExists(link.getAttribute('href')), `${link.getAttribute('href')} has no page`).toBe(true);
        }
    });

    it('is rows of type, never icon tiles', () => {
        const { container } = render(<BrowseByNeed />);

        expect(container.querySelector('svg')).toBeNull();
        expect(container.querySelector('img')).toBeNull();
    });

    it('hides a category with nothing in it', () => {
        const registry = {
            tools: [{ slug: 'resize', href: '/resize', title: 'Resize Image', description: 'x', hasOwnPage: true, category: 'resize-crop' }],
            categories: [
                { id: 'resize-crop', title: 'Resize & Crop', blurb: 'Change how big a picture is.' },
                { id: 'ai', title: 'AI Image Tools', blurb: 'Nothing here yet.' },
            ],
            intents: [],
        };
        render(<BrowseByNeed registry={registry} />);

        expect(screen.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent)).toEqual(['Resize & Crop']);
        expect(screen.queryByText('AI Image Tools')).toBeNull();
    });

    it('does not reprint the whole directory', () => {
        render(<BrowseByNeed />);
        const hrefs = screen.getAllByRole('link').map((link) => link.getAttribute('href'));

        expect(hrefs.length).toBeLessThan(TOOLS.length + INTENTS.length);
        for (const intent of INTENTS) expect(hrefs).not.toContain(intent.path);
        expect(categoriesWithProducts().length).toBeLessThanOrEqual(CATEGORIES.length);
    });
});
