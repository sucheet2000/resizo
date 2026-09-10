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
        // A category with nothing in it yet is declared but not shown.
        expect(categoriesWithProducts().length).toBeLessThanOrEqual(CATEGORIES.length);
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

    /**
     * The filter island narrows the directory by toggling `hidden` on rows that
     * are already in the HTML, so the anchors it works through are part of the
     * directory's contract rather than an implementation detail of the island:
     * a category section that loses its id stops being a deep-link target for
     * the homepage, and a row that loses its key silently stops being
     * filterable while still looking fine.
     */
    it('gives every category section the id the homepage deep-links to', () => {
        const { container } = render(<ToolsDirectory />);

        for (const category of categoriesWithProducts()) {
            const section = screen.getByRole('region', { name: category.title });
            expect(section).toHaveAttribute('id', category.id);
            expect(section).toHaveAttribute('data-filter-group', category.id);
        }

        expect(container.querySelectorAll('[data-filter-group]')).toHaveLength(categoriesWithProducts().length);
    });

    it('keys every row by the route it links to', () => {
        const { container } = render(<ToolsDirectory />);
        const keys = [...container.querySelectorAll('[data-filter-key]')]
            .map((node) => node.getAttribute('data-filter-key'));

        expect(new Set(keys).size).toBe(keys.length);
        for (const tool of TOOLS) expect(keys, `${tool.href} has no filterable row`).toContain(tool.href);
        for (const intent of INTENTS) expect(keys, `${intent.path} has no filterable row`).toContain(intent.path);
    });

    /**
     * `hidden` is a UA-stylesheet rule, and any author `display:` utility on the
     * same element beats it. A row that grew a `flex` class would go on showing
     * while the filter believed it was hidden — which looks like a broken filter
     * and is really a broken row.
     */
    it('puts no display utility on a filterable row, so hidden actually hides', () => {
        const { container } = render(<ToolsDirectory />);

        for (const node of container.querySelectorAll('[data-filter-key], [data-filter-group]')) {
            expect(
                node.className,
                `${node.getAttribute('data-filter-key') ?? node.getAttribute('data-filter-group')} carries a display utility`,
            ).not.toMatch(/(^|\s)(flex|grid|block|inline-flex|inline-block|table)(\s|$)/);
        }
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
