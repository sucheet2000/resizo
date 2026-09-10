/**
 * /image-size-fitter — the static page.
 *
 * Mirrors tests/pages/passport.test.jsx's approach for its own tool: mock the
 * modules FitTool needs that a unit test should not exercise for real
 * (FrameCrop's drag internals, useLocalProcess's async job), then render the
 * whole page tree and check what a crawler and a visitor would see — the
 * metadata, the direct answer, the JSON-LD, and the visible HowTo/FAQ lists.
 *
 * `benchmarks/results/latest.json` is mocked too, deliberately, rather than
 * read for real: the page's own gate (`MEASURED ? <Figure/> : null`) has two
 * real states — the 'image-size-fitter' scenario exists, or it does not yet
 * — and a suite that only ever sees whichever one happens to be true on disk
 * today can never prove the OTHER branch still works. Most tests use the
 * "scenario exists" mock; the one test that needs the other state loads its
 * own fresh copy of the page after re-mocking, since a JSON import is cached
 * the same way any other module is.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/components/tools/FrameCrop', () => ({
    default: function FrameCropStub({ id, label }) {
        return <div role="group" aria-label={label} id={id} data-testid="frame-crop" />;
    },
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

/** A faithful stand-in for the real, since-landed benchmark case — see the file note above. */
const SCENARIO_WITH_CASE = {
    scenarios: [
        {
            id: 'image-size-fitter',
            cases: [
                {
                    id: 'fit-square-600-50kb',
                    input: { width: 1600, height: 1067, bytes: 393418 },
                    output: { width: 600, height: 600, bytes: 51097 },
                },
            ],
        },
    ],
};

vi.mock('@/benchmarks/results/latest.json', () => ({ default: SCENARIO_WITH_CASE }));

const { default: ImageSizeFitterPage, metadata } = await import('@/app/(tools)/image-size-fitter/page');

describe('/image-size-fitter metadata', () => {
    it('has the exact title and canonical the plan asks for', () => {
        expect(metadata.title).toBe('Image Size Fitter — Exact Pixels, KB and DPI | Resizo');
        expect(metadata.alternates.canonical).toBe('https://www.resizo.net/image-size-fitter');
    });

    it('states its no-upload claim before the snippet is cut', () => {
        const NO_UPLOAD_CLAIM = /(?:no|not|never|without|nothing)[^.,;—]{0,40}(?:upload|uploading|leaving|leaves|server|install)|(?:on )?your own (?:device|computer)|in (?:your|this) browser/i;
        const match = metadata.description.match(NO_UPLOAD_CLAIM);
        expect(match, 'no no-upload claim found in the description').toBeTruthy();
        expect(match.index + match[0].length).toBeLessThanOrEqual(155);
    });
});

describe('/image-size-fitter renders one h1 and the direct-answer paragraph', () => {
    it('has exactly one h1 matching the plan’s exact wording', () => {
        render(<ImageSizeFitterPage />);
        const headings = screen.getAllByRole('heading', { level: 1 });
        expect(headings).toHaveLength(1);
        expect(headings[0]).toHaveTextContent('Fit an Image to Exact Dimensions and File Size');
    });

    it('names the mechanism in the answer paragraph, below the panel', () => {
        render(<ImageSizeFitterPage />);
        expect(screen.getByText(/fit an image to exact dimensions and a maximum file size in one step/i)).toBeInTheDocument();
        expect(screen.getByText(/your own browser so the file is read and rewritten/i)).toBeInTheDocument();
    });
});

describe('/image-size-fitter content sections', () => {
    it('carries the named statement headings, none of them duplicating an FAQ question', () => {
        render(<ImageSizeFitterPage />);
        expect(screen.getByRole('heading', { name: 'Every requirement at once' })).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'Enlarging cannot add detail' })).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'Everything happens in your browser' })).toBeInTheDocument();
    });

    it('renders the measured figure from the benchmark scenario, with the 600 × 600 after image', () => {
        render(<ImageSizeFitterPage />);
        const figure = screen.getByRole('figure');
        expect(figure).toBeInTheDocument();
        expect(figure).toHaveTextContent('600×600');
        expect(figure).toHaveTextContent(/downscale/i);
    });

    it('renders no measured figure when the scenario does not exist, without crashing or inventing a number', async () => {
        vi.resetModules();
        vi.doMock('@/benchmarks/results/latest.json', () => ({ default: { scenarios: [] } }));

        const { default: PageWithNoScenario } = await import('@/app/(tools)/image-size-fitter/page');
        render(<PageWithNoScenario />);
        expect(screen.queryByRole('figure')).toBeNull();

        // Every later test in this file resolves the module fresh too — put
        // the shared mock back so the rest see the scenario again.
        vi.doMock('@/benchmarks/results/latest.json', () => ({ default: SCENARIO_WITH_CASE }));
        vi.resetModules();
    });
});

describe('/image-size-fitter HowTo and FAQ', () => {
    it('shows at least four HowTo steps and five FAQ entries, matching the JSON-LD counts', () => {
        render(<ImageSizeFitterPage />);
        expect(screen.getByRole('heading', { name: 'How to fit an image to exact dimensions and file size' })).toBeInTheDocument();
        expect(screen.getAllByRole('listitem').length).toBeGreaterThan(0);
        expect(screen.getByRole('heading', { name: 'Frequently asked questions' })).toBeInTheDocument();
        expect(screen.getByText('Can an image always be made smaller without changing dimensions?')).toBeInTheDocument();
        expect(screen.getByText('Does resizing to 600 × 600 make the file 100 KB?')).toBeInTheDocument();
        expect(screen.getByText('Does DPI change pixel dimensions?')).toBeInTheDocument();
        expect(screen.getByText('Can converting JPG to PNG improve quality?')).toBeInTheDocument();
        expect(screen.getByText('What happens if the requirements conflict?')).toBeInTheDocument();
    });
});

describe('/image-size-fitter structured data', () => {
    it('carries a SoftwareApplication, a BreadcrumbList, a HowTo and an FAQPage', () => {
        const { container } = render(<ImageSizeFitterPage />);
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

        const [faq] = nodes.filter((node) => node['@type'] === 'FAQPage');
        expect(faq.mainEntity.length).toBeGreaterThanOrEqual(5);
    });
});
