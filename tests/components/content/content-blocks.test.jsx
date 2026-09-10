/**
 * ContentBlocks — the prose of an intent page, rendered from data.
 *
 * A section in the registry is paragraphs, lists and tables written as plain
 * data with `[label](/path)` for links. This turns them into the same markup
 * the hand-written pages used, so a migrated page reads identically and a
 * link in the copy is a real next/link.
 */
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import ContentBlocks, { InlineText } from '@/components/content/ContentBlocks';

describe('InlineText', () => {
    it('renders plain text as text', () => {
        render(<p><InlineText text="Nothing to link here." /></p>);
        expect(screen.getByText('Nothing to link here.')).toBeInTheDocument();
    });

    it('turns [label](/path) into a link and keeps the words around it', () => {
        render(<p><InlineText text="Cut the pixels first — [resize it](/resize), then come back." /></p>);

        const link = screen.getByRole('link', { name: 'resize it' });
        expect(link).toHaveAttribute('href', '/resize');
        expect(link.closest('p')).toHaveTextContent('Cut the pixels first — resize it, then come back.');
    });

    it('renders several links in one sentence, in order', () => {
        render(<p><InlineText text="The [200 KB](/compress-image-to-200kb) and [100 KB](/compress-image-to-100kb) pages." /></p>);

        expect(screen.getAllByRole('link').map((link) => link.getAttribute('href'))).toEqual([
            '/compress-image-to-200kb',
            '/compress-image-to-100kb',
        ]);
    });
});

describe('ContentBlocks', () => {
    it('renders a paragraph block as a <p>', () => {
        const { container } = render(<ContentBlocks blocks={[{ type: 'p', text: 'One paragraph.' }]} />);
        expect(container.querySelector('p')).toHaveTextContent('One paragraph.');
    });

    it('renders a list block as a bulleted list with one item per entry', () => {
        render(<ContentBlocks blocks={[{ type: 'ul', items: ['First.', 'Second, with a [link](/crop).'] }]} />);

        const list = screen.getByRole('list');
        expect(list.tagName).toBe('UL');
        expect(within(list).getAllByRole('listitem').map((item) => item.textContent)).toEqual([
            'First.',
            'Second, with a link.',
        ]);
        expect(within(list).getByRole('link', { name: 'link' })).toHaveAttribute('href', '/crop');
    });

    it('renders a table block with a caption, column headers and one row per entry', () => {
        render(
            <ContentBlocks
                blocks={[
                    {
                        type: 'table',
                        caption: 'Common PNG icon and asset dimensions',
                        columns: [
                            { key: 'use', label: 'Use', rowHeader: true },
                            { key: 'pixels', label: 'Pixels', mono: true },
                            { key: 'note', label: 'Notes' },
                        ],
                        rows: [
                            { use: 'Favicon', pixels: '32×32', note: 'The one browsers show in a tab.' },
                            { use: 'Apple touch icon', pixels: '180×180', note: 'Saved to the home screen.' },
                        ],
                    },
                ]}
            />,
        );

        const table = screen.getByRole('table', { name: 'Common PNG icon and asset dimensions' });
        expect(within(table).getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual(['Use', 'Pixels', 'Notes']);
        expect(within(table).getAllByRole('rowheader').map((cell) => cell.textContent)).toEqual(['Favicon', 'Apple touch icon']);
        expect(within(table).getByText('180×180')).toHaveClass('font-data');
        expect(within(table).getAllByRole('row')).toHaveLength(3);
    });

    it('lets a table scroll sideways rather than overflowing the page', () => {
        const { container } = render(
            <ContentBlocks
                blocks={[{
                    type: 'table',
                    caption: 'x',
                    columns: [{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }],
                    rows: [{ a: '1', b: '2' }],
                }]}
            />,
        );
        expect(container.querySelector('table').parentElement).toHaveClass('overflow-x-auto');
    });

    it('renders blocks in the order given', () => {
        const { container } = render(
            <ContentBlocks
                blocks={[
                    { type: 'p', text: 'Before.' },
                    { type: 'ul', items: ['Between.'] },
                    { type: 'p', text: 'After.' },
                ]}
            />,
        );
        expect([...container.children].map((node) => node.tagName)).toEqual(['P', 'UL', 'P']);
    });

    it('refuses a block type it does not know, rather than dropping it silently', () => {
        expect(() => render(<ContentBlocks blocks={[{ type: 'html', text: '<b>x</b>' }]} />)).toThrow(/html/);
    });
});

/**
 * The figure block.
 *
 * An intent page has no file of its own to import a component from, so this is
 * the only route a registry entry has to a demonstration image. Everything the
 * hand-written pages get from components/content/Figure has to survive the
 * trip: both halves of a pair, their intrinsic sizes, the lazy decode, and a
 * caption that can still carry the link back to how the numbers were measured.
 */
const PAIR_BLOCK = {
    type: 'figure',
    before: {
        src: '/demos/transparent-source-480x320.png',
        alt: 'A blue rounded rectangle and an orange disc on a fully transparent field.',
        width: 480,
        height: 320,
    },
    after: {
        src: '/demos/transparent-on-white-480x320.jpg',
        alt: 'The same two shapes after conversion, sitting on a solid white rectangle.',
        width: 480,
        height: 320,
    },
    caption: 'The transparent corner came back white — [see the benchmark](/tools) for how it was measured.',
};

describe('ContentBlocks: the figure block', () => {
    it('renders a before/after pair as one figure, in that order', () => {
        render(<ContentBlocks blocks={[PAIR_BLOCK]} />);

        const figure = screen.getByRole('figure');
        expect(within(figure).getAllByRole('img').map((image) => image.getAttribute('src'))).toEqual([
            PAIR_BLOCK.before.src,
            PAIR_BLOCK.after.src,
        ]);
    });

    it('labels the two halves Before and After without the block having to say so', () => {
        render(<ContentBlocks blocks={[PAIR_BLOCK]} />);

        expect(screen.getByText('Before')).toBeInTheDocument();
        expect(screen.getByText('After')).toBeInTheDocument();
    });

    it('lets the block name the halves itself when Before and After are the wrong words', () => {
        render(
            <ContentBlocks
                blocks={[{
                    ...PAIR_BLOCK,
                    before: { ...PAIR_BLOCK.before, label: 'PNG, transparent' },
                    after: { ...PAIR_BLOCK.after, label: 'JPG, filled with white' },
                }]}
            />,
        );

        expect(screen.getByText('PNG, transparent')).toBeInTheDocument();
        expect(screen.getByText('JPG, filled with white')).toBeInTheDocument();
        expect(screen.queryByText('Before')).toBeNull();
    });

    it('carries the alt text and the intrinsic size of each half through unchanged', () => {
        render(<ContentBlocks blocks={[PAIR_BLOCK]} />);

        const before = screen.getByRole('img', { name: PAIR_BLOCK.before.alt });
        expect(before).toHaveAttribute('width', '480');
        expect(before).toHaveAttribute('height', '320');
        expect(before).toHaveAttribute('loading', 'lazy');
    });

    it('runs the caption through the same inline parser as a paragraph', () => {
        render(<ContentBlocks blocks={[PAIR_BLOCK]} />);

        const caption = screen.getByRole('figure').querySelector('figcaption');
        expect(caption).toHaveTextContent('The transparent corner came back white — see the benchmark for how it was measured.');
        expect(within(caption).getByRole('link', { name: 'see the benchmark' })).toHaveAttribute('href', '/tools');
    });

    it('renders a single image on its own, with no Before or After label', () => {
        render(
            <ContentBlocks
                blocks={[{
                    type: 'figure',
                    image: {
                        src: '/demos/dpi-print-size.svg',
                        alt: 'The same 1800 pixel wide picture printed at 72 and at 300 DPI, side by side.',
                        width: 640,
                        height: 300,
                    },
                    caption: 'The pixels never change; only the number written in the header does.',
                }]}
            />,
        );

        expect(screen.getAllByRole('img')).toHaveLength(1);
        expect(screen.queryByText('Before')).toBeNull();
        expect(screen.queryByText('After')).toBeNull();
    });

    it('sits in order among the paragraphs around it', () => {
        const { container } = render(
            <ContentBlocks
                blocks={[
                    { type: 'p', text: 'What the tool does.' },
                    PAIR_BLOCK,
                    { type: 'p', text: 'What it leaves alone.' },
                ]}
            />,
        );

        expect([...container.children].map((node) => node.tagName)).toEqual(['P', 'FIGURE', 'P']);
    });

    /**
     * Figure drops a half-written image rather than rendering one with no alt
     * or no size, which is right for it and wrong here: the caption's claim
     * would stay on the page with nothing underneath it. A block that cannot
     * produce a figure has to stop the build instead.
     */
    it('throws rather than rendering a caption with no picture under it', () => {
        expect(() => render(<ContentBlocks blocks={[{ type: 'figure', caption: 'Nothing to see.' }]} />))
            .toThrow(/figure block/);

        expect(() => render(
            <ContentBlocks blocks={[{ type: 'figure', before: PAIR_BLOCK.before, caption: 'Half a pair.' }]} />,
        )).toThrow(/figure block/);
    });
});
