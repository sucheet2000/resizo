/**
 * GuidesList — the guides, listed where the tools are.
 *
 * A guide is written from a measurement of the tools above it, so /tools is
 * where it is offered. The list reads the registry and renders nothing at all
 * while the registry is empty: an empty "Guides" heading over no links is a
 * promise the page cannot keep.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import GuidesList from '@/components/marketing/GuidesList';
import { validGuide } from '../../helpers/guide-fixture';

const guide = { ...validGuide(), path: '/guides/what-the-orientation-tag-does' };

describe('GuidesList', () => {
    it('renders nothing while there is no guide to list', () => {
        const { container } = render(<GuidesList guides={[]} />);
        expect(container).toBeEmptyDOMElement();
    });

    it('lists each guide as a link to its own page, with its first sentence', () => {
        render(<GuidesList guides={[guide]} />);

        expect(screen.getByRole('heading', { level: 2, name: 'Guides' })).toBeInTheDocument();
        const link = screen.getByRole('link', { name: guide.h1 });
        expect(link).toHaveAttribute('href', guide.path);
        expect(link.closest('li')).toHaveTextContent('A phone camera almost never rotates the pixels it captures.');
    });

    it('leaves out a guide that is held back from the index', () => {
        render(<GuidesList guides={[guide, { ...guide, slug: 'held', path: '/guides/held', h1: 'Held back', indexable: false }]} />);

        expect(screen.queryByRole('link', { name: 'Held back' })).toBeNull();
    });

    it('is rows of type, never tiles', () => {
        const { container } = render(<GuidesList guides={[guide]} />);
        expect(container.querySelector('svg')).toBeNull();
        expect(container.querySelector('img')).toBeNull();
    });
});
