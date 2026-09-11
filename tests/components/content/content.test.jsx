/**
 * ContentSection, FaqList, HowToSteps, IntentLinks
 *
 * The below-the-fold prose. All four exist to keep the heading outline at
 * h1 → h2 → h3 with no skipped level — the four tool pages used to run
 * h1 → h3 → h2 — and to keep the visible FAQ and the FAQPage markup, and the
 * visible step list and the HowTo markup, reading the same array.
 */
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import ContentSection from '@/components/content/ContentSection';
import FaqList from '@/components/content/FaqList';
import HowToSteps from '@/components/content/HowToSteps';
import IntentLinks from '@/components/content/IntentLinks';
import { INTENTS, intentsFor } from '@/lib/catalog';
import { faqPage, howTo } from '@/lib/schema';
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

const STEPS = [
    { name: 'Set the size you want', text: 'Type a width and a height in pixels.' },
    { name: 'Choose the image on your device', text: 'Drag it onto the panel above.' },
    { name: 'Press Resize image', text: 'Your device scales it and writes the new file.' },
    { name: 'Download the result', text: 'The panel prints the size before and after.' },
];

describe('HowToSteps', () => {
    it('is a section labelled by its own h2, with the steps in an ordered list', () => {
        const { container } = render(
            <HowToSteps id="how-to-resize" heading="How to resize an image online" steps={STEPS} />,
        );
        const section = screen.getByRole('region', { name: 'How to resize an image online' });

        expect(within(section).getByRole('heading', { level: 2 })).toHaveAttribute('id', 'how-to-resize');
        expect(container.querySelector('ol')).toBeInTheDocument();
        expect(screen.getAllByRole('listitem')).toHaveLength(STEPS.length);
    });

    it('shows the steps in the order they were given', () => {
        render(<HowToSteps id="how-to" heading="How to resize" steps={STEPS} />);

        expect(screen.getAllByRole('listitem').map((item) => item.textContent.trim()))
            .toEqual(STEPS.map((step) => `${step.name}. ${step.text}`));
    });

    /**
     * The whole point of the shared array. Markup describing a step the page
     * does not show is a manual-action risk, so every HowToStep the builder
     * emits has to be findable on screen, in the same position.
     */
    it('shows every step the HowTo markup claims, in the same order', () => {
        render(<HowToSteps id="how-to" heading="How to resize" steps={STEPS} />);
        const markup = howTo({ name: 'How to resize', path: '/resize', steps: STEPS });
        const items = screen.getAllByRole('listitem');

        expect(markup.step).toHaveLength(items.length);

        for (const step of markup.step) {
            const item = items[step.position - 1];
            expect(item.textContent).toContain(step.name);
            expect(item.textContent).toContain(step.text);
        }
    });

    it('drops a half-written step from the visible list, exactly as the markup does', () => {
        const partial = [...STEPS, { name: 'No directions yet' }, { text: 'Orphan.' }];
        render(<HowToSteps id="how-to" heading="How to resize" steps={partial} />);

        expect(screen.getAllByRole('listitem')).toHaveLength(STEPS.length);
        expect(howTo({ name: 'How to resize', path: '/resize', steps: partial }).step)
            .toHaveLength(STEPS.length);
    });

    it('renders prose above and below the list when it is given some', () => {
        render(
            <HowToSteps
                id="how-to"
                heading="How to crop"
                steps={STEPS}
                intro={<p>Coordinates start at the top-left corner.</p>}
            >
                <p>See the HEIC page for the rest.</p>
            </HowToSteps>,
        );

        expect(screen.getByText('Coordinates start at the top-left corner.')).toBeInTheDocument();
        expect(screen.getByText('See the HEIC page for the rest.')).toBeInTheDocument();
    });

    it.each([
        ['no steps', undefined],
        ['an empty array', []],
        ['only half-written steps', [{ name: 'Choose a file' }]],
        ['a value that is not an array', 'Choose a file'],
    ])('renders nothing for %s', (_label, steps) => {
        const { container } = render(<HowToSteps id="how-to" heading="How to resize" steps={steps} />);
        expect(container).toBeEmptyDOMElement();
    });
});

describe('IntentLinks', () => {
    it('links every long-tail page belonging to the tool', () => {
        render(<IntentLinks tool="convert" heading="Common conversions" />);

        const hrefs = screen.getAllByRole('link').map((link) => link.getAttribute('href'));
        expect(hrefs).toEqual(intentsFor('convert').map((page) => page.path));
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
        expect(hrefs).toHaveLength(intentsFor('convert').length - 1);
    });

    it('renders nothing for a tool with no long-tail pages', () => {
        const { container } = render(<IntentLinks tool="crop" heading="Nothing here" />);

        expect(INTENTS.some((page) => page.tool === 'crop')).toBe(false);
        expect(container).toBeEmptyDOMElement();
    });
});

describe('FaqList — links inside an answer', () => {
    // An intent's FAQ answer is written like its sections, plain text with
    // `[label](/path)` for a link. Printing the raw string shows brackets and,
    // for a long URL, one unbreakable token that pushed /avif-to-png sideways
    // on a phone (an audit finding). One inline renderer for both.
    it('renders a [label](/path) as a link, never as brackets', () => {
        render(<FaqList items={[{ question: 'Where next?', answer: 'Then use the [compressor](/compress) to shrink it.' }]} />);

        expect(screen.getByRole('link', { name: 'compressor' })).toHaveAttribute('href', '/compress');
        expect(screen.queryByText(/\]\(/)).toBeNull();
    });
});
