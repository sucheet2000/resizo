/**
 * ToolIndex, HeroDropzone, DocPage
 *
 * The homepage and the legal-page frame. Two contract clauses live here: the
 * tool index is asymmetric by content weight rather than a three-equal-column
 * card row, and the hero IS a working drop target rather than a CTA that
 * scrolls to one.
 */
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import DocPage, { DocSection, DocSpecList } from '@/components/marketing/DocPage';
import HeroDropzone from '@/components/marketing/HeroDropzone';
import ToolIndex from '@/components/marketing/ToolIndex';
import { TOOLS } from '@/lib/catalog';
import { takePendingFiles } from '@/lib/pending-files';
import { imageFile, routeExists } from '../helpers.jsx';

const push = vi.fn();

vi.mock('next/navigation', () => ({
    useRouter: () => ({ push, replace: vi.fn(), prefetch: vi.fn() }),
    usePathname: () => '/',
}));

beforeEach(() => {
    push.mockClear();
    takePendingFiles();
});

describe('ToolIndex', () => {
    /**
     * The grid is a hand-written list of cells, because each one is sized by
     * what that tool is actually worth — a loop over the registry cannot decide
     * that resize deserves seven columns and crop three. The cost of writing it
     * by hand is that a tool can ship without ever reaching the homepage, which
     * is exactly what happened: /jpg-to-pdf and /merge-pdf launched and the grid
     * still showed five cards under the words "Five tools".
     *
     * The tests below were part of the problem. They asserted the number five
     * and named five slugs, so they passed for as long as the bug existed. The
     * registry is the only honest source for what "every tool" means.
     */
    const OWN_PAGE = TOOLS.filter((tool) => tool.hasOwnPage);

    it('shows a cell for every tool that has its own page', () => {
        render(<ToolIndex />);
        const hrefs = screen.getAllByRole('link').map((link) => link.getAttribute('href'));

        for (const tool of OWN_PAGE) {
            expect(hrefs, `${tool.slug} has a page but no cell on the homepage`).toContain(tool.href);
        }
    });

    it('links every tool cell to a real route', () => {
        render(<ToolIndex />);

        for (const link of screen.getAllByRole('link')) {
            const href = link.getAttribute('href');
            expect(routeExists(href), `${href} has no page.js`).toBe(true);
        }
    });

    it('names each tool with its registry title', () => {
        render(<ToolIndex />);

        for (const tool of OWN_PAGE) {
            expect(screen.getByRole('link', { name: new RegExp(tool.title) })).toHaveAttribute('href', tool.href);
        }
    });

    it('is asymmetric — never five equal columns', () => {
        const { container } = render(<ToolIndex />);
        const spans = Array.from(container.querySelectorAll('li'))
            .map((cell) => cell.className.match(/md:col-span-(\d+)/)?.[1]);

        expect(new Set(spans).size).toBeGreaterThan(1);
        expect(spans.every(Boolean)).toBe(true);
    });

    it('uses a typographic operation mark, never an icon tile above a heading', () => {
        const { container } = render(<ToolIndex />);

        expect(container.querySelector('svg')).toBeNull();
        expect(container.querySelector('img')).toBeNull();
        expect(screen.getByText('W×H')).toHaveAttribute('aria-hidden', 'true');
    });

    it('keeps the tool titles at h3, under the page h1 and its h2', () => {
        render(<ToolIndex />);
        expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(OWN_PAGE.length);
    });

    it('offers the bulk route from the resize cell', () => {
        render(<ToolIndex />);
        expect(screen.getByRole('link', { name: /resize up to 20 at once/ })).toHaveAttribute('href', '/resize#bulk');
    });
});

describe('HeroDropzone', () => {
    it('is a working drop target, not a button that scrolls to one', () => {
        render(<HeroDropzone />);

        expect(screen.getByLabelText('Drop an image here to resize it')).toHaveAttribute('type', 'file');
        expect(screen.getByRole('button', { name: 'Choose an image' })).toBeInTheDocument();
    });

    it('states the constraints inside the zone', () => {
        render(<HeroDropzone />);
        // GIF was in this line for as long as RESIZE_INPUT_FORMATS carried it.
        expect(screen.getByText(/JPEG, PNG, WebP · up to 20 MB/)).toBeInTheDocument();
    });

    it('hands the dropped file to /resize rather than processing it here', async () => {
        const user = userEvent.setup();
        render(<HeroDropzone />);
        const file = imageFile('holiday.jpg');

        await user.upload(screen.getByLabelText('Drop an image here to resize it'), file);

        await waitFor(() => expect(push).toHaveBeenCalledWith('/resize'));
        expect(takePendingFiles()).toEqual([file]);
    });

    it('says what is happening while it hands over', async () => {
        const user = userEvent.setup();
        render(<HeroDropzone />);

        await user.upload(screen.getByLabelText('Drop an image here to resize it'), imageFile('holiday.jpg'));

        expect(await screen.findByText('Opening the resizer with your image…')).toBeInTheDocument();
    });

    it('offers the tool link for anyone whose picker never opens', () => {
        render(<HeroDropzone />);
        expect(screen.getByRole('link', { name: 'resize tool' })).toHaveAttribute('href', '/resize');
    });
});

describe('DocPage', () => {
    it('renders one h1 with the intro and the updated date', () => {
        render(
            <DocPage title="Privacy policy" intro="What we do with your files." updated="2026-08-11">
                <DocSection id="files" heading="Your files"><p>Deleted immediately.</p></DocSection>
            </DocPage>,
        );

        expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
        expect(screen.getByText('What we do with your files.')).toBeInTheDocument();
        expect(screen.getByText('2026-08-11').tagName).toBe('TIME');
    });

    it('renders the breadcrumb when one is given', () => {
        render(
            <DocPage breadcrumb={[{ name: 'Home', path: '/' }, { name: 'Privacy' }]} title="Privacy policy">
                <p>Body.</p>
            </DocPage>,
        );

        expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toBeInTheDocument();
    });

    it('renders the aside beside the prose', () => {
        render(
            <DocPage title="Privacy policy" aside={<DocSpecList heading="Limits" rows={[{ label: 'Max file', value: '20 MB' }]} />}>
                <p>Body.</p>
            </DocPage>,
        );

        const aside = screen.getByRole('complementary');
        expect(within(aside).getByText('20 MB')).toBeInTheDocument();
    });
});

describe('DocSection', () => {
    it('is anchorable and labelled by its own h2', () => {
        render(<DocSection id="retention" heading="Retention"><p>Nothing is kept.</p></DocSection>);
        const section = screen.getByRole('region', { name: 'Retention' });

        expect(section).toHaveAttribute('id', 'retention');
        expect(within(section).getByRole('heading', { level: 2 })).toHaveAttribute('id', 'retention-heading');
    });
});

describe('DocSpecList', () => {
    it('renders a labelled definition list of the real limits', () => {
        render(
            <DocSpecList
                heading="Upload limits"
                rows={[{ label: 'Max file', value: '20 MB' }, { label: 'Max batch', value: '20 files' }]}
                note="Enforced by the API, not only by the page."
            />,
        );

        expect(screen.getByRole('heading', { level: 2, name: 'Upload limits' })).toHaveAttribute('id', 'spec-upload-limits');
        expect(screen.getByText('Max file')).toBeInTheDocument();
        expect(screen.getByText('20 files')).toBeInTheDocument();
        expect(screen.getByText('Enforced by the API, not only by the page.')).toBeInTheDocument();
    });

    it('derives a distinct id per list so two can share a page', () => {
        render(
            <>
                <DocSpecList heading="Upload limits" rows={[{ label: 'a', value: '1' }]} />
                <DocSpecList heading="Output limits" rows={[{ label: 'b', value: '2' }]} />
            </>,
        );

        const ids = screen.getAllByRole('heading', { level: 2 }).map((node) => node.id);
        expect(new Set(ids).size).toBe(2);
    });
});
