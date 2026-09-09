/**
 * Figure
 *
 * The one wrapper for a demonstration on a tool page: a real before/after out
 * of the benchmark run, or a diagram, or a small table — always with a caption
 * that carries the numbers and a link back to how they were measured.
 *
 * It exists because an image on a content page has four ways to go wrong and
 * all four are invisible in a diff: no alt text, no intrinsic size (so the
 * layout jumps when it decodes), an eager fetch that competes with the tool
 * itself, and a caption that says nothing a reader could check. Every one of
 * those is asserted here rather than left to review.
 */
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import Figure from '@/components/content/Figure';

const ONE = [
    {
        src: '/demos/photo-crop-900x600.jpg',
        width: 900,
        height: 600,
        alt: 'The 900 by 600 rectangle the cropper kept, showing the low sun and the ridge line.',
    },
];

const PAIR = [
    {
        src: '/demos/photo-source-800x534.jpg',
        width: 800,
        height: 534,
        alt: 'The synthetic landscape before compression, sky gradient and shingle intact.',
        label: 'Before',
    },
    {
        src: '/demos/photo-compressed-100kb.jpg',
        width: 1600,
        height: 1067,
        alt: 'The same scene after the tool compressed it to under 100 kilobytes.',
        label: 'After',
    },
];

const CAPTION = '384.2 KB became 96.97 KB at quality 66.';

describe('Figure', () => {
    it('is a figure with a caption', () => {
        render(<Figure images={ONE} caption={CAPTION} />);
        const figure = screen.getByRole('figure');

        expect(within(figure).getByText(CAPTION)).toBeInTheDocument();
        expect(figure.querySelector('figcaption')).not.toBeNull();
    });

    it('gives every image its alt text, its intrinsic size and a lazy decode', () => {
        render(<Figure images={ONE} caption={CAPTION} />);
        const image = screen.getByRole('img', { name: ONE[0].alt });

        expect(image).toHaveAttribute('src', ONE[0].src);
        expect(image).toHaveAttribute('width', '900');
        expect(image).toHaveAttribute('height', '600');
        expect(image).toHaveAttribute('loading', 'lazy');
        expect(image).toHaveAttribute('decoding', 'async');
    });

    it('renders both halves of a pair, in order, each with its own label', () => {
        render(<Figure images={PAIR} caption={CAPTION} />);

        expect(screen.getAllByRole('img').map((node) => node.getAttribute('src')))
            .toEqual(PAIR.map((image) => image.src));
        expect(screen.getByText('Before')).toBeInTheDocument();
        expect(screen.getByText('After')).toBeInTheDocument();
    });

    it('stacks a pair on a phone and sits them side by side above it', () => {
        const { container } = render(<Figure images={PAIR} caption={CAPTION} />);
        const grid = container.querySelector('figure > div');

        expect(grid.className).toContain('grid-cols-1');
        expect(grid.className).toContain('sm:grid-cols-2');
    });

    it('carries a caption that is markup, so it can link to the measurement', () => {
        render(
            <Figure
                images={ONE}
                caption={<>Measured on the tool. <a href="https://example.test/bench" rel="noopener">see the benchmark</a></>}
            />,
        );

        expect(screen.getByRole('link', { name: 'see the benchmark' }))
            .toHaveAttribute('href', 'https://example.test/bench');
    });

    it('takes children instead of images, for a demonstration that is not a picture', () => {
        render(
            <Figure caption={CAPTION}>
                <table><caption>Before and after</caption><tbody><tr><td>EXIF</td></tr></tbody></table>
            </Figure>,
        );

        expect(screen.getByRole('table', { name: 'Before and after' })).toBeInTheDocument();
        expect(screen.getByRole('figure')).toBeInTheDocument();
    });

    it('drops a half-written entry rather than rendering an image with no alt or no size', () => {
        render(
            <Figure
                images={[...ONE, { src: '/demos/broken.jpg', width: 10 }, { alt: 'No source.', width: 1, height: 1 }]}
                caption={CAPTION}
            />,
        );

        expect(screen.getAllByRole('img')).toHaveLength(1);
    });

    it('renders nothing at all when there is neither an image nor a child', () => {
        const { container } = render(<Figure images={[]} caption={CAPTION} />);
        expect(container).toBeEmptyDOMElement();
    });
});
