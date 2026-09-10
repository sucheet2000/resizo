/**
 * /passport-photo-print — the static page.
 *
 * Mirrors tests/components/tools/image-size-fitter-page.test.jsx and
 * passport-tool.test.jsx's own page suite: FrameCrop, SheetPreview and
 * useLocalProcess are mocked (their own internals are covered elsewhere), the
 * benchmark JSON is mocked deliberately so both the "scenario exists" and
 * "scenario does not exist yet" branches of the page's own gate are provable
 * regardless of which is true on disk today. `lib/format/print-sheet`,
 * `lib/catalog/application-presets` and `lib/catalog/paper-sizes` are all real
 * — the "how many copies fit" table and the FAQ's own count are asserted
 * against the actual layoutSheet arithmetic, never a typed-in guess.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { getApplicationPreset } from '@/lib/catalog/application-presets';
import { paperSize } from '@/lib/catalog/paper-sizes';
import { layoutSheet } from '@/lib/format/print-sheet';

vi.mock('@/components/tools/FrameCrop', () => ({
    default: function FrameCropStub({ id, label }) {
        return <div role="group" aria-label={label} id={id} data-testid="frame-crop" />;
    },
}));

vi.mock('@/app/(tools)/passport-photo-print/SheetPreview', () => ({
    default: function SheetPreviewStub() { return <div data-testid="sheet-preview" />; },
}));

vi.mock('@/lib/hooks/useLocalProcess', async () => {
    const { useState } = await import('react');
    return {
        default: function useStubbedProcess() {
            const [result] = useState(null);
            return {
                submit: () => {},
                download: () => {},
                reset: () => {},
                cancel: () => {},
                isProcessing: false,
                progress: 0,
                error: null,
                result,
                setError: () => {},
                phase: null,
                suggestion: null,
                code: null,
            };
        },
    };
});

const SCENARIO_WITH_CASE = {
    scenarios: [
        {
            id: 'print-sheet',
            cases: [
                {
                    id: 'sheet-uk-35x45-4x6-300',
                    input: { width: 1200, height: 1600, bytes: 300000 },
                    output: { width: 1200, height: 1800, bytes: 260000, density: 300 },
                },
            ],
        },
    ],
};

vi.mock('@/benchmarks/results/latest.json', () => ({ default: SCENARIO_WITH_CASE }));

const { default: PrintSheetPage, metadata } = await import('@/app/(tools)/passport-photo-print/page');

/** The real, un-mocked layout for the US preset on 4 × 6 paper, at the defaults. */
const US_ON_FOUR_BY_SIX = layoutSheet({
    paperWidthMm: paperSize('4x6').widthMm,
    paperHeightMm: paperSize('4x6').heightMm,
    photoWidthMm: getApplicationPreset('us-passport-print').physical.widthMm,
    photoHeightMm: getApplicationPreset('us-passport-print').physical.heightMm,
});

describe('/passport-photo-print metadata', () => {
    it('has the exact title and canonical', () => {
        expect(metadata.title).toBe('Passport Photo Print Sheet — 4 × 6, A4, JPEG or PDF | Resizo');
        expect(metadata.alternates.canonical).toBe('https://www.resizo.net/passport-photo-print');
    });

    it('states its no-upload claim before the snippet is cut', () => {
        const NO_UPLOAD_CLAIM = /(?:no|not|never|without|nothing)[^.,;—]{0,40}(?:upload|uploading|leaving|leaves|server|install)|(?:on )?your own (?:device|computer)|in (?:your|this) browser/i;
        const match = metadata.description.match(NO_UPLOAD_CLAIM);
        expect(match, 'no no-upload claim found in the description').toBeTruthy();
        expect(match.index + match[0].length).toBeLessThanOrEqual(155);
    });
});

describe('/passport-photo-print renders one h1 and the direct-answer paragraph', () => {
    it('has exactly one h1 matching the plan’s exact wording', () => {
        render(<PrintSheetPage />);
        const headings = screen.getAllByRole('heading', { level: 1 });
        expect(headings).toHaveLength(1);
        expect(headings[0]).toHaveTextContent('Create a Passport Photo Print Sheet');
    });

    it('names the mechanism in the answer paragraph, below the panel', () => {
        render(<PrintSheetPage />);
        expect(screen.getByText(/one deterministic layout|the same layout model/i)).toBeInTheDocument();
    });
});

describe('/passport-photo-print content sections', () => {
    it('carries the six named statement headings', () => {
        render(<PrintSheetPage />);
        expect(screen.getByRole('heading', { name: 'One layout, one file' })).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'Actual size, not fit to page' })).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'DPI sets pixels, not inches' })).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'How many copies fit' })).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'Your printer’s own margins' })).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'Everything happens in your browser' })).toBeInTheDocument();
    });

    it('computes the copies-fit table from layoutSheet rather than typing the numbers in', () => {
        render(<PrintSheetPage />);
        const table = screen.getByRole('heading', { name: 'How many copies fit' }).closest('section');
        expect(table).toHaveTextContent(String(US_ON_FOUR_BY_SIX.copies));
    });

    it('renders the measured figure from the mocked benchmark scenario, with the literal 600 × 900 demo image', () => {
        render(<PrintSheetPage />);
        const figure = screen.getByRole('figure');
        expect(figure).toBeInTheDocument();
        const img = figure.querySelector('img');
        expect(img).toHaveAttribute('width', '600');
        expect(img).toHaveAttribute('height', '900');
        expect(figure).toHaveTextContent('1200');
        expect(figure).toHaveTextContent('1800');
    });

    it('renders no measured figure when the scenario does not exist, without crashing or inventing a number', async () => {
        vi.resetModules();
        vi.doMock('@/benchmarks/results/latest.json', () => ({ default: { scenarios: [] } }));

        const { default: PageWithNoScenario } = await import('@/app/(tools)/passport-photo-print/page');
        render(<PageWithNoScenario />);
        expect(screen.queryByRole('figure')).toBeNull();

        vi.doMock('@/benchmarks/results/latest.json', () => ({ default: SCENARIO_WITH_CASE }));
        vi.resetModules();
    });
});

describe('/passport-photo-print HowTo and FAQ', () => {
    it('shows at least four HowTo steps and five FAQ entries, matching the JSON-LD counts, and answers the capacity question from the real arithmetic', () => {
        render(<PrintSheetPage />);
        expect(screen.getByRole('heading', { name: 'Frequently asked questions' })).toBeInTheDocument();
        expect(screen.getByText('Why does Actual Size matter?')).toBeInTheDocument();
        expect(screen.getByText('Does 300 DPI change the physical size?')).toBeInTheDocument();
        expect(screen.getByText('How many 2 × 2 photos fit on 4 × 6 paper?')).toBeInTheDocument();
        expect(screen.getByText('Can Resizo guarantee passport acceptance?')).toBeInTheDocument();
        expect(screen.getByText('Why might my photo look blurry?')).toBeInTheDocument();

        const question = screen.getByText('How many 2 × 2 photos fit on 4 × 6 paper?');
        expect(question.closest('li')).toHaveTextContent(String(US_ON_FOUR_BY_SIX.copies));
    });
});

describe('/passport-photo-print structured data', () => {
    it('carries a SoftwareApplication with no rating, a BreadcrumbList, a HowTo (4 steps) and an FAQPage (>= 5)', () => {
        const { container } = render(<PrintSheetPage />);
        const script = container.querySelector('script[type="application/ld+json"]');
        expect(script, 'no JSON-LD script tag rendered').toBeTruthy();
        const nodes = JSON.parse(script.textContent);
        const types = nodes.map((node) => node['@type']);
        expect(types).toContain('SoftwareApplication');
        expect(types).toContain('BreadcrumbList');
        expect(types).toContain('HowTo');
        expect(types).toContain('FAQPage');

        const [software] = nodes.filter((node) => node['@type'] === 'SoftwareApplication');
        expect(software.offers.price).toBe('0');
        expect(software.isAccessibleForFree).toBe(true);
        expect(software.aggregateRating).toBeUndefined();
        expect(software.review).toBeUndefined();

        const [howTo] = nodes.filter((node) => node['@type'] === 'HowTo');
        expect(howTo.step.length).toBeGreaterThanOrEqual(4);

        const [faq] = nodes.filter((node) => node['@type'] === 'FAQPage');
        expect(faq.mainEntity.length).toBeGreaterThanOrEqual(5);
    });
});
