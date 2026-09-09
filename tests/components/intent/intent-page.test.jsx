/**
 * IntentPage — one renderer for every intent entry.
 *
 * The ten long-tail pages were ten copies of the same skeleton: JSON-LD, the
 * parent tool with a preset and a headline, the procedure, the sections, a
 * sibling block on some, the FAQ. This is that skeleton once, reading an
 * entry, and the assertions are about what each field becomes: which props
 * reach the tool, what order the content comes in, what the structured data
 * says, and that a field left empty renders nothing rather than a heading
 * over nothing.
 */
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import IntentPage, { formatsSentence, intentBreadcrumb } from '@/components/intent/IntentPage';
import { validIntent } from '@/tests/helpers/intent-fixture';

/** A stand-in tool that records the props the renderer hands it. */
const FakeTool = vi.fn(function FakeTool({ children, title, intro }) {
    return (
        <div data-testid="tool">
            <h1>{title}</h1>
            <p>{intro}</p>
            <div data-testid="tool-children">{children}</div>
        </div>
    );
});

const lastProps = () => FakeTool.mock.calls.at(-1)[0];

function jsonLdOf(container) {
    return JSON.parse(container.querySelector('script[type="application/ld+json"]').textContent);
}

describe('intentBreadcrumb', () => {
    it('runs Home → parent tool → this page, from the registry', () => {
        expect(intentBreadcrumb(validIntent({ path: '/compress-image-to-50kb' }))).toEqual([
            { name: 'Home', path: '/' },
            { name: 'Compress Image', path: '/compress' },
            { name: 'Compress to 50 KB', path: '/compress-image-to-50kb' },
        ]);
    });
});

describe('IntentPage', () => {
    const intent = validIntent({ path: '/compress-image-to-50kb' });

    it('hands the tool its preset, headline, intro, answer and breadcrumb', () => {
        render(<IntentPage intent={intent} Tool={FakeTool} />);

        const props = lastProps();
        expect(props.preset).toEqual({ targetKb: 50 });
        expect(props.title).toBe('Compress an Image to 50 KB');
        expect(props.intro).toBe('The target is already set to 50 KB.');
        expect(props.answer).toBe(intent.answer);
        expect(props.breadcrumb).toEqual(intentBreadcrumb(intent));
    });

    it('leaves the preset prop off a tool that takes none', () => {
        render(<IntentPage intent={validIntent({ tool: 'resize', kind: 'format', preset: null, path: '/x' })} Tool={FakeTool} />);
        expect('preset' in lastProps()).toBe(false);
    });

    it('renders the changes, the procedure, every section, then the FAQ, inside the tool', () => {
        render(<IntentPage intent={intent} Tool={FakeTool} />);
        const children = screen.getByTestId('tool-children');

        expect(within(children).getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent)).toEqual([
            'What this changes',
            'What stays the same',
            'How to compress an image to 50 KB',
            'Why a form stops at 50 KB',
            'What 50 KB buys',
            'Limits',
            'Frequently asked questions',
        ]);
        expect(within(children).getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent)).toEqual(
            intent.faqs.map((faq) => faq.question),
        );
        expect(within(children).getByRole('link', { name: 'Resize it first' })).toHaveAttribute('href', '/resize');
        expect(within(children).getByRole('table', { name: 'Bits per pixel at 50 KB' })).toBeInTheDocument();
    });

    it('anchors the procedure at the id the HowTo markup points to', () => {
        const { container } = render(<IntentPage intent={intent} Tool={FakeTool} />);

        expect(container.querySelector('#how-to-compress-50kb')).toBeInTheDocument();
        const howTo = jsonLdOf(container).find((node) => node['@type'] === 'HowTo');
        expect(howTo.url).toBe('https://www.resizo.net/compress-image-to-50kb#how-to-compress-50kb');
    });

    it('emits SoftwareApplication, BreadcrumbList, HowTo and FAQPage from the same entry', () => {
        const { container } = render(<IntentPage intent={intent} Tool={FakeTool} />);
        const nodes = jsonLdOf(container);

        expect(nodes.map((node) => node['@type'])).toEqual(['SoftwareApplication', 'BreadcrumbList', 'HowTo', 'FAQPage']);
        expect(nodes[0]).toMatchObject({
            name: 'Compress Image to 50 KB',
            description: intent.description,
            url: 'https://www.resizo.net/compress-image-to-50kb',
            featureList: ['Target size preset to 50 KB'],
        });
        expect(nodes[0]).not.toHaveProperty('aggregateRating');
        expect(nodes[1].itemListElement.map((item) => item.name)).toEqual(['Home', 'Compress Image', 'Compress to 50 KB']);
        expect(nodes[2].step.map((step) => step.name)).toEqual(intent.howTo.steps.map((step) => step.name));
        expect(nodes[3].mainEntity.map((entry) => entry.name)).toEqual(intent.faqs.map((faq) => faq.question));
    });

    it('renders a sibling block only when the entry asks for one', () => {
        const { rerender } = render(<IntentPage intent={intent} Tool={FakeTool} />);
        expect(screen.queryByRole('region', { name: 'Other targets' })).toBeNull();

        rerender(
            <IntentPage
                intent={validIntent({ path: '/png-to-jpg', slug: 'png-to-jpg', tool: 'convert', kind: 'conversion', preset: { from: 'png', to: 'jpeg' }, siblingLinks: { heading: 'Other conversions' } })}
                Tool={FakeTool}
            />,
        );
        const siblings = screen.getByRole('region', { name: 'Other conversions' });
        const hrefs = within(siblings).getAllByRole('link').map((link) => link.getAttribute('href'));
        expect(hrefs).toContain('/jpg-to-png');
        expect(hrefs).not.toContain('/png-to-jpg');
    });

    it('renders a limits section only when the entry lists limitations', () => {
        const { rerender } = render(<IntentPage intent={validIntent({ path: '/x', limitations: [] })} Tool={FakeTool} />);
        expect(screen.queryByRole('region', { name: 'Limits' })).toBeNull();

        rerender(<IntentPage intent={validIntent({ path: '/x', limitations: ['One photo per pass.', 'Up to 20 MB.'] })} Tool={FakeTool} />);
        const limits = screen.getByRole('region', { name: 'Limits' });
        expect(within(limits).getAllByRole('listitem').map((item) => item.textContent)).toEqual(['One photo per pass.', 'Up to 20 MB.']);
    });

    it('states what the page accepts and what it saves, read off the limits registry', () => {
        expect(formatsSentence(intent)).toBe('Accepts JPEG, PNG and WebP. Saves JPEG, PNG or WebP.');
        expect(formatsSentence(validIntent({
            tool: 'convert',
            kind: 'conversion',
            preset: { from: 'png', to: 'jpeg' },
        }))).toBe('Accepts PNG. Saves JPEG.');
        expect(formatsSentence(validIntent({ tool: 'heic', kind: 'conversion', preset: { format: 'png' } })))
            .toBe('Accepts HEIC. Saves PNG.');
        expect(formatsSentence(validIntent({ tool: 'crop' }))).toBeNull();
    });

    it('paints that line above everything else the entry contributes', () => {
        render(<IntentPage intent={intent} Tool={FakeTool} />);
        const children = screen.getByTestId('tool-children');

        const line = within(children).getByText('Accepts JPEG, PNG and WebP. Saves JPEG, PNG or WebP.');
        const firstHeading = within(children).getAllByRole('heading', { level: 2 })[0];
        expect(line.compareDocumentPosition(firstHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('lists what the page changes and what it leaves alone, in that order', () => {
        render(<IntentPage intent={intent} Tool={FakeTool} />);

        const does = screen.getByRole('region', { name: 'What this changes' });
        expect(within(does).getAllByRole('listitem').map((item) => item.textContent)).toEqual(intent.changes.does);

        const doesNot = screen.getByRole('region', { name: 'What stays the same' });
        expect(within(doesNot).getAllByRole('listitem').map((item) => item.textContent)).toEqual(intent.changes.doesNot);
    });

    it('renders a link written into a changes sentence', () => {
        const linked = validIntent({
            path: '/compress-image-to-50kb',
            changes: {
                does: [intent.changes.does[0], 'Sends you to [the resizer](/resize) when the picture is too wide.'],
                doesNot: intent.changes.doesNot,
            },
        });
        render(<IntentPage intent={linked} Tool={FakeTool} />);

        const does = screen.getByRole('region', { name: 'What this changes' });
        expect(within(does).getByRole('link', { name: 'the resizer' })).toHaveAttribute('href', '/resize');
    });

    it('renders exactly one h1, which is the tool headline', () => {
        render(<IntentPage intent={intent} Tool={FakeTool} />);
        expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    });
});
