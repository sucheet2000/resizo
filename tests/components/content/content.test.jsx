/**
 * ContentSection, FaqList, IntentLinks
 *
 * The below-the-fold prose. All three exist to keep the heading outline at
 * h1 → h2 → h3 with no skipped level — the four tool pages used to run
 * h1 → h3 → h2 — and to keep the visible FAQ and the FAQPage markup reading
 * the same array.
 */
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import ContentSection from '@/components/content/ContentSection';
import FaqList from '@/components/content/FaqList';
import IntentLinks from '@/components/content/IntentLinks';
import { LONGTAIL_PAGES, longtailPagesFor } from '@/lib/constants';
import { faqPage } from '@/lib/schema';
import { routeExists } from '../helpers.jsx';

const FAQS = [
    { question: 'Does resizing lose quality?', answer: 'Downscaling does not; upscaling invents pixels.' },
    { question: 'What is the size limit?', answer: '20 MB per file.' },
];

describe('ContentSection', () => {
    it('is a section labelled by its own h2', () => {
        render(<ContentSection id="how-it-works" heading="How resizing works"><p>Body.</p></ContentSection>);
        const section = screen.getByRole('region', { name: 'How resizing works' });

        expect(within(section).getByRole('heading', { level: 2 })).toHaveAttribute('id', 'how-it-works');
    });

    it('renders its children', () => {
        render(<ContentSection id="x" heading="Heading"><p>Body copy.</p></ContentSection>);
        expect(screen.getByText('Body copy.')).toBeInTheDocument();
    });
});

describe('FaqList', () => {
    it('puts the questions at h3 under the section h2', () => {
        render(<FaqList items={FAQS} />);

        expect(screen.getByRole('heading', { level: 2, name: 'Frequently asked questions' })).toBeInTheDocument();
        expect(screen.getAllByRole('heading', { level: 3 }).map((node) => node.textContent))
            .toEqual(FAQS.map((item) => item.question));
    });

    it('shows every answer the markup claims', () => {
        render(<FaqList items={FAQS} />);
        const markup = faqPage(FAQS);

        for (const entity of markup.mainEntity) {
            expect(screen.getByRole('heading', { level: 3, name: entity.name })).toBeInTheDocument();
            expect(screen.getByText(entity.acceptedAnswer.text)).toBeInTheDocument();
        }
    });

    it('drops a half-written entry from the visible list', () => {
        render(<FaqList items={[...FAQS, { question: 'No answer yet' }]} />);
        expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(2);
    });

    it('takes its own heading and id', () => {
        render(<FaqList items={FAQS} heading="Common questions" id="resize-faq" />);
        expect(screen.getByRole('region', { name: 'Common questions' })).toBeInTheDocument();
        expect(screen.getByRole('heading', { level: 2 })).toHaveAttribute('id', 'resize-faq');
    });

    it.each([
        ['no items', undefined],
        ['an empty array', []],
        ['only half-written entries', [{ question: 'Q' }]],
    ])('renders nothing for %s', (_label, items) => {
        const { container } = render(<FaqList items={items} />);
        expect(container).toBeEmptyDOMElement();
    });
});

describe('IntentLinks', () => {
    it('links every long-tail page belonging to the tool', () => {
        render(<IntentLinks tool="convert" heading="Common conversions" />);

        const hrefs = screen.getAllByRole('link').map((link) => link.getAttribute('href'));
        expect(hrefs).toEqual(longtailPagesFor('convert').map((page) => page.path));
    });

    it('emits no dead href', () => {
        render(<IntentLinks tool="convert" heading="Common conversions" />);

        for (const link of screen.getAllByRole('link')) {
            const href = link.getAttribute('href');
            expect(routeExists(href), `${href} has no page.js`).toBe(true);
        }
    });

    it('leads each row with the situation, not the keyword', () => {
        render(<IntentLinks tool="convert" heading="Common conversions" />);
        const row = screen.getByRole('link', { name: /PNG to JPG/ }).closest('li');

        expect(row).toHaveTextContent('A photograph saved as a PNG, many times heavier than it needs to be');
    });

    it('leaves out the page the visitor is already on', () => {
        render(<IntentLinks tool="convert" exclude="png-to-jpg" heading="Sibling pages" />);

        const hrefs = screen.getAllByRole('link').map((link) => link.getAttribute('href'));
        expect(hrefs).not.toContain('/png-to-jpg');
        expect(hrefs).toHaveLength(longtailPagesFor('convert').length - 1);
    });

    it('renders nothing for a tool with no long-tail pages', () => {
        const { container } = render(<IntentLinks tool="crop" heading="Nothing here" />);

        expect(LONGTAIL_PAGES.some((page) => page.tool === 'crop')).toBe(false);
        expect(container).toBeEmptyDOMElement();
    });
});
