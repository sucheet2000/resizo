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
import { INTENTS, TOOLS } from '@/lib/catalog';
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
     * The grid used to be a hand-written list of every tool, and the homepage
     * used to be a directory. It is a CURATED set now — the caller names a few
     * slugs, in the order it judges most useful, and each cell is
     * sized by what that entry is worth. What the component owes the caller is
     * that a named slug resolves against the registry, so a renamed route can
     * never leave a dead cell behind, and that an entry with no hand-written
     * line still says something specific rather than nothing.
     */
    const ITEMS = [
        { slug: 'compress', kind: 'tool', span: 'md:col-span-7', weight: 'lead', line: 'Aim at a byte target and see exactly what you got.' },
        { slug: 'resize', kind: 'tool', span: 'md:col-span-5', weight: 'lead', line: 'Type exact pixel dimensions or scale by a percentage.', extra: { href: '/resize#bulk', label: 'Or resize up to 20 at once' } },
        { slug: 'compress-image-to-50kb', kind: 'intent', span: 'md:col-span-4' },
    ];

    it('renders one cell per curated entry, in the order given', () => {
        render(<ToolIndex items={ITEMS} />);

        const headings = screen.getAllByRole('heading', { level: 3 });
        expect(headings).toHaveLength(ITEMS.length);
        expect(headings.map((heading) => heading.querySelector('a').getAttribute('href')))
            .toEqual(['/compress', '/resize', '/compress-image-to-50kb']);
    });

    it('reads the title and the href off the registry rather than the caller', () => {
        render(<ToolIndex items={ITEMS} />);

        const compress = TOOLS.find((tool) => tool.slug === 'compress');
        expect(screen.getByRole('link', { name: new RegExp(compress.title) })).toHaveAttribute('href', compress.href);

        const intent = INTENTS.find((entry) => entry.slug === 'compress-image-to-50kb');
        expect(screen.getByRole('link', { name: new RegExp(intent.label) })).toHaveAttribute('href', intent.path);
    });

    it('drops a slug the registry does not know rather than rendering a dead cell', () => {
        render(<ToolIndex items={[...ITEMS, { slug: 'ai-upscaler', kind: 'tool', span: 'md:col-span-4' }]} />);

        expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(ITEMS.length);
    });

    it('falls back to the registry sentence when the caller writes none', () => {
        render(<ToolIndex items={ITEMS} />);

        const intent = INTENTS.find((entry) => entry.slug === 'compress-image-to-50kb');
        expect(screen.getByText(new RegExp(intent.blurb.slice(0, 40)))).toBeInTheDocument();
    });

    it('links every cell to a real route', () => {
        render(<ToolIndex items={ITEMS} />);

        for (const link of screen.getAllByRole('link')) {
            const href = link.getAttribute('href');
            expect(routeExists(href), `${href} has no page.js`).toBe(true);
        }
    });

    it('is asymmetric — never a row of equal columns', () => {
        const { container } = render(<ToolIndex items={ITEMS} />);
        const spans = Array.from(container.querySelectorAll('li'))
            .map((cell) => cell.className.match(/md:col-span-(\d+)/)?.[1]);

        expect(new Set(spans).size).toBeGreaterThan(1);
        expect(spans.every(Boolean)).toBe(true);
    });

    it('uses a typographic operation mark, never an icon tile above a heading', () => {
        const { container } = render(<ToolIndex items={ITEMS} />);

        expect(container.querySelector('svg')).toBeNull();
        expect(container.querySelector('img')).toBeNull();
        expect(screen.getByText('W×H')).toHaveAttribute('aria-hidden', 'true');
    });

    it('gives an intent a mark of its own, derived from what it preconfigures', () => {
        render(<ToolIndex items={ITEMS} />);
        expect(screen.getByText('→50KB')).toHaveAttribute('aria-hidden', 'true');
    });

    it('offers the extra link a cell asks for', () => {
        render(<ToolIndex items={ITEMS} />);
        expect(screen.getByRole('link', { name: /resize up to 20 at once/ })).toHaveAttribute('href', '/resize#bulk');
    });
});

describe('HeroDropzone', () => {
    it('is a working drop target, not a button that scrolls to one', () => {
        render(<HeroDropzone />);

        expect(screen.getByLabelText('Drop an image to resize it')).toHaveAttribute('type', 'file');
        expect(screen.getByRole('button', { name: 'Choose an image' })).toBeInTheDocument();
    });

    it('no longer speaks for the whole site — it points at the rest of the family', () => {
        render(<HeroDropzone />);

        expect(screen.getByRole('link', { name: /start from a job below/i })).toHaveAttribute('href', '#start');
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

        await user.upload(screen.getByLabelText('Drop an image to resize it'), file);

        await waitFor(() => expect(push).toHaveBeenCalledWith('/resize'));
        expect(takePendingFiles()).toEqual([file]);
    });

    it('says what is happening while it hands over', async () => {
        const user = userEvent.setup();
        render(<HeroDropzone />);

        await user.upload(screen.getByLabelText('Drop an image to resize it'), imageFile('holiday.jpg'));

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
