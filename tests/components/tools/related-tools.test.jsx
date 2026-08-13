/**
 * RelatedTools + OperationMark
 *
 * The link block is generated from the TOOLS registry, so the assertion that
 * matters is that nothing it emits is a dead route: every href is checked
 * against the page.js files actually on disk, not against the registry it came
 * from.
 */
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import OperationMark, { TOOL_MARKS, markFor } from '@/components/tools/OperationMark';
import RelatedTools, { RELATED_COPY } from '@/components/tools/RelatedTools';
import { TOOLS, LONGTAIL_PAGES } from '@/lib/catalog';
import { routeExists } from '../helpers.jsx';

const REGISTRY_HREFS = new Set([
    ...TOOLS.map((tool) => tool.href),
    ...LONGTAIL_PAGES.map((page) => page.path),
]);

const TOOL_PAGE_SLUGS = TOOLS.filter((tool) => tool.hasOwnPage).map((tool) => tool.slug);

describe('RelatedTools links', () => {
    it.each(TOOL_PAGE_SLUGS)('emits no dead href from /%s', (slug) => {
        render(<RelatedTools slug={slug} />);

        const links = screen.getAllByRole('link');
        expect(links.length).toBeGreaterThan(0);

        for (const link of links) {
            const href = link.getAttribute('href');
            expect(REGISTRY_HREFS.has(href), `${href} is not in the registry`).toBe(true);
            expect(routeExists(href), `${href} has no page.js`).toBe(true);
        }
    });

    it('never links a tool back to the page it is on', () => {
        render(<RelatedTools slug="compress" />);

        const hrefs = screen.getAllByRole('link').map((link) => link.getAttribute('href'));
        expect(hrefs).not.toContain('/compress');
    });

    it('omits tools that have no page of their own', () => {
        render(<RelatedTools slug="compress" />);

        const hrefs = screen.getAllByRole('link').map((link) => link.getAttribute('href'));
        expect(hrefs).not.toContain('/resize#bulk');
    });

    it('links every other tool page exactly once', () => {
        render(<RelatedTools slug="resize" />);

        const hrefs = screen.getAllByRole('link').map((link) => link.getAttribute('href'));
        const expected = TOOLS.filter((tool) => tool.hasOwnPage && tool.slug !== 'resize').map((tool) => tool.href);

        expect(hrefs.sort()).toEqual(expected.sort());
    });
});

describe('RelatedTools copy', () => {
    it('leads with the situation, not the keyword', () => {
        render(<RelatedTools slug="resize" />);

        expect(screen.getByText(/iPhone photo\? Convert HEIC to JPG before resizing/)).toBeInTheDocument();
    });

    it('orders hand-written sentences ahead of registry fallbacks', () => {
        render(<RelatedTools slug="bulk-resize" />);

        const items = screen.getAllByRole('listitem');
        const written = Object.keys(RELATED_COPY['bulk-resize']);

        expect(items[0].textContent).toContain('Only one image to do?');
        expect(written).toContain('resize');
    });

    it('falls back to the registry description for a tool with no sentence', () => {
        render(<RelatedTools slug="bulk-resize" />);

        // /crop has no bulk-resize sentence, so it uses its own description.
        const crop = screen.getByRole('link', { name: /Crop Image/ }).closest('li');
        expect(crop).toHaveTextContent('Remove unwanted areas with exact pixel control.');
    });
});

describe('RelatedTools structure', () => {
    it('is a labelled section with a real heading', () => {
        render(<RelatedTools slug="compress" />);
        const section = screen.getByRole('region', { name: 'What to do next' });

        expect(within(section).getByRole('heading', { level: 2 })).toHaveTextContent('What to do next');
    });

    it('takes a heading level so a page never skips one', () => {
        render(<RelatedTools slug="compress" headingLevel="h3" heading="More tools" />);
        expect(screen.getByRole('heading', { level: 3, name: 'More tools' })).toBeInTheDocument();
    });

    it('honours a limit', () => {
        render(<RelatedTools slug="compress" limit={2} />);
        expect(screen.getAllByRole('listitem')).toHaveLength(2);
    });

    it('states which tool the visitor is on, for a screen reader only', () => {
        render(<RelatedTools slug="crop" />);
        expect(screen.getByText('You are on the Crop Image tool.')).toHaveClass('sr-only');
    });

    it('renders nothing when there is nothing left to link', () => {
        const { container } = render(<RelatedTools slug="compress" limit={0} />);
        expect(container).toBeEmptyDOMElement();
    });
});

describe('OperationMark', () => {
    it('renders the tool token as a decorative glyph with a real name', () => {
        const { container } = render(<OperationMark tool="resize" />);

        expect(container.querySelector('[aria-hidden="true"]')).toHaveTextContent('W×H');
        expect(screen.getByText('Resize')).toHaveClass('sr-only');
    });

    it('is a typographic token, never an icon tile', () => {
        const { container } = render(<OperationMark tool="heic" />);

        expect(container.querySelector('svg')).toBeNull();
        expect(container.querySelector('img')).toBeNull();
        expect(container.firstElementChild).toHaveClass('font-data');
    });

    it('takes an explicit mark and label', () => {
        const { container } = render(<OperationMark mark="→AVIF" label="Convert to AVIF" />);

        expect(container.querySelector('[aria-hidden="true"]')).toHaveTextContent('→AVIF');
        expect(screen.getByText('Convert to AVIF')).toHaveClass('sr-only');
    });

    it('renders nothing for a tool it does not know', () => {
        const { container } = render(<OperationMark tool="unknown" />);
        expect(container).toBeEmptyDOMElement();
    });

    it('has a mark for every tool in the registry', () => {
        for (const tool of TOOLS) {
            expect(markFor(tool.slug), `${tool.slug} has no operation mark`).not.toBeNull();
            expect(TOOL_MARKS[tool.slug].mark.length).toBeGreaterThan(0);
        }
    });

    it('falls back to the ui size for an unknown size token', () => {
        const { container } = render(<OperationMark tool="crop" size="enormous" />);
        expect(container.firstElementChild).toHaveClass('text-ui');
    });
});
