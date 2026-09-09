/**
 * ToolsDirectory — every product, grouped by what a visitor came to do.
 *
 * The directory reads the registries and nothing else, so the assertions are
 * about what that must produce: a heading per category that actually holds a
 * product, every tool with a page under its category, every intent under its
 * tool with the situation that would send someone there, and not one dead
 * href. It is a list of rows, never a grid of icon tiles.
 */
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import ToolsDirectory from '@/components/marketing/ToolsDirectory';
import { CATEGORIES, INTENTS, TOOLS, categoriesWithProducts, intentsFor, toolsInCategory } from '@/lib/catalog';
import { routeExists } from '../helpers.jsx';

describe('ToolsDirectory', () => {
    it('renders one section per category that holds a product, headed at h2', () => {
        render(<ToolsDirectory />);

        const headings = screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent);
        expect(headings).toEqual(categoriesWithProducts().map((category) => category.title));
        expect(categoriesWithProducts()).toEqual(CATEGORIES);
    });

    it('lists every tool with a page of its own under its category, at h3', () => {
        render(<ToolsDirectory />);

        for (const category of categoriesWithProducts()) {
            const section = screen.getByRole('region', { name: category.title });
            const tools = toolsInCategory(category.id).filter((tool) => tool.hasOwnPage);
            expect(tools.length).toBeGreaterThan(0);

            for (const tool of tools) {
                const heading = within(section).getByRole('heading', { level: 3, name: new RegExp(tool.title) });
                expect(within(heading).getByRole('link')).toHaveAttribute('href', tool.href);
            }
        }
    });

    it('links every intent under the tool it preconfigures, leading with the situation', () => {
        render(<ToolsDirectory />);

        for (const intent of INTENTS) {
            const link = screen.getByRole('link', { name: new RegExp(`^${intent.label}`) });
            expect(link).toHaveAttribute('href', intent.path);
            expect(link.closest('li')).toHaveTextContent(intent.blurb);
        }
    });

    it('still reaches a tool that lives inside another route', () => {
        render(<ToolsDirectory />);

        const bulk = TOOLS.find((tool) => tool.slug === 'bulk-resize');
        expect(screen.getByRole('link', { name: new RegExp(bulk.title) })).toHaveAttribute('href', bulk.href);
    });

    it('emits no dead href', () => {
        render(<ToolsDirectory />);

        for (const link of screen.getAllByRole('link')) {
            const href = link.getAttribute('href');
            expect(routeExists(href), `${href} has no page`).toBe(true);
        }
    });

    it('links each route once', () => {
        render(<ToolsDirectory />);

        const hrefs = screen.getAllByRole('link').map((link) => link.getAttribute('href'));
        expect(new Set(hrefs).size).toBe(hrefs.length);
        expect(hrefs.length).toBe(
            TOOLS.length + INTENTS.length,
        );
    });

    it('is rows of type, never icon tiles', () => {
        const { container } = render(<ToolsDirectory />);

        expect(container.querySelector('svg')).toBeNull();
        expect(container.querySelector('img')).toBeNull();
        expect(screen.getByText('W×H')).toHaveAttribute('aria-hidden', 'true');
    });

    it('hides a category with nothing in it', () => {
        const registry = {
            tools: [{ slug: 'resize', href: '/resize', title: 'Resize Image', shortTitle: 'Resize', description: 'x', hasOwnPage: true, category: 'resize-crop' }],
            categories: [
                { id: 'resize-crop', title: 'Resize & Crop', blurb: 'Change how big a picture is.' },
                { id: 'ai', title: 'AI Image Tools', blurb: 'Nothing here yet.' },
            ],
            intents: [],
        };
        render(<ToolsDirectory registry={registry} />);

        expect(screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent)).toEqual(['Resize & Crop']);
        expect(screen.queryByText('AI Image Tools')).toBeNull();
    });

    it('covers every intent in the registry, so none is unreachable from the directory', () => {
        render(<ToolsDirectory />);
        const hrefs = new Set(screen.getAllByRole('link').map((link) => link.getAttribute('href')));

        for (const tool of TOOLS.filter((entry) => entry.hasOwnPage)) {
            for (const intent of intentsFor(tool.slug)) {
                expect(hrefs.has(intent.path), `${intent.path} is not in the directory`).toBe(true);
            }
        }
    });
});
