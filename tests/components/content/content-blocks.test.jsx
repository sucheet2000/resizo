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
