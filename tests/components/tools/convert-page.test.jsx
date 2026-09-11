/**
 * /convert — the AVIF GEO content: the FAQ answers, the sources table, and the
 * measured demo figure. The figure follows the same MEASURED-gated pattern as
 * app/(tools)/favicon-generator/page.js — benchmarks/results/latest.json is
 * mocked here rather than trusted to carry a real 'avif' scenario yet, exactly
 * as bulk-image-converter-page.test.jsx mocks its own scenario.
 */
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/image-client/client', () => ({
    processImage: vi.fn(),
    terminateWorker: vi.fn(),
}));

describe('ConvertPage — AVIF FAQ content', () => {
    it('answers the direct AVIF questions the plan names', async () => {
        vi.resetModules();
        const { default: ConvertPage } = await import('@/app/(tools)/convert/page');
        render(<ConvertPage />);

        for (const question of [
            'What is AVIF?',
            'Is AVIF lossless here?',
            'Does AVIF keep transparency?',
            'Is AVIF always smaller than WebP or JPEG?',
            'Does converting a JPEG to AVIF restore quality?',
            'Are AVIF files uploaded?',
            'Which browsers open AVIF?',
            'Why is AVIF slower to write?',
        ]) {
            expect(screen.getByRole('heading', { name: question })).toBeInTheDocument();
        }
    });

    it('answers "Is AVIF lossless here?" with no, quality 1-100, default 80', async () => {
        vi.resetModules();
        const { default: ConvertPage } = await import('@/app/(tools)/convert/page');
        render(<ConvertPage />);

        const heading = screen.getByRole('heading', { name: 'Is AVIF lossless here?' });
        const answer = heading.nextElementSibling;
        expect(answer).toHaveTextContent(/^No\./);
        expect(answer).toHaveTextContent(/1 to 100/);
        expect(answer).toHaveTextContent(/default of 80/);
    });

    it('mentions the encoder’s licence notices file', async () => {
        vi.resetModules();
        const { default: ConvertPage } = await import('@/app/(tools)/convert/page');
        render(<ConvertPage />);

        expect(screen.getByText(/\/licenses\/avif-encoder-notices\.txt/)).toBeInTheDocument();
    });
});

describe('ConvertPage — the AVIF sources table', () => {
    it('cites the AV1-AVIF spec, MDN and caniuse, each with a verified date', async () => {
        vi.resetModules();
        const { default: ConvertPage } = await import('@/app/(tools)/convert/page');
        render(<ConvertPage />);

        const region = screen.getByRole('region', { name: 'AVIF sources, cited' });

        const spec = within(region).getByRole('link', { name: /AV1 Image File Format/ });
        expect(spec).toHaveAttribute('href', 'https://aomediacodec.github.io/av1-avif/');

        const mdn = within(region).getByRole('link', { name: /Image file type and format guide/ });
        expect(mdn).toHaveAttribute('href', 'https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Formats/Image_types');

        const caniuse = within(region).getByRole('link', { name: /AVIF image format/ });
        expect(caniuse).toHaveAttribute('href', 'https://caniuse.com/avif');

        expect(within(region).getAllByText('2026-09-11')).toHaveLength(3);
    });
});

describe('ConvertPage — the AVIF demo figure waits for a real measurement', () => {
    it('renders no figure today, since benchmarks/results/latest.json carries no avif scenario yet', async () => {
        vi.resetModules();
        const { default: ConvertPage } = await import('@/app/(tools)/convert/page');
        render(<ConvertPage />);

        expect(screen.queryByRole('heading', { name: /AVIF, on a real photo/ })).toBeNull();
    });

    it('renders the measured pair once the bench has an avif scenario', async () => {
        vi.resetModules();
        // Merged onto the REAL data rather than replacing it: other catalogue
        // modules (the guides registry among them) read their own scenarios
        // from this same file at import time, and a bare { scenarios: [...] }
        // would take their data away along with adding this test's own.
        vi.doMock('@/benchmarks/results/latest.json', async (importOriginal) => {
            const actual = await importOriginal();
            return {
                default: {
                    ...actual.default,
                    scenarios: [
                        ...actual.default.scenarios,
                        {
                            id: 'avif',
                            cases: [
                                {
                                    id: 'jpeg-to-avif',
                                    input: { bytes: 500 * 1024, format: 'jpeg', width: 800, height: 534 },
                                    output: { bytes: 120 * 1024, format: 'avif', width: 800, height: 534 },
                                },
                                {
                                    id: 'transparent-png-to-avif',
                                    input: { bytes: 40 * 1024, format: 'png', width: 480, height: 320 },
                                    output: { bytes: 18 * 1024, format: 'avif', width: 480, height: 320 },
                                },
                            ],
                        },
                    ],
                },
            };
        });

        const { default: ConvertPage } = await import('@/app/(tools)/convert/page');
        render(<ConvertPage />);

        expect(screen.getByRole('heading', { name: /AVIF, on a real photo/ })).toBeInTheDocument();
        expect(screen.getByAltText(/written as AVIF at Resizo’s default quality/)).toBeInTheDocument();
        expect(screen.getByAltText(/kept transparent/)).toBeInTheDocument();

        vi.doUnmock('@/benchmarks/results/latest.json');
    });
});
