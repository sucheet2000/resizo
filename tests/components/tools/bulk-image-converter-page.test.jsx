/**
 * BulkImageConverterPage — the measured-batch table reading a mocked
 * benchmark scenario, exactly as bulk-image-compressor-page.test.jsx does for
 * its own page. The benchmark scenario is mocked rather than trusted to exist
 * for real: whether `npm run bench` has produced scenario 'bulk-convert' yet
 * is not something this test should depend on.
 */
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import BulkImageConverterPage from '@/app/(tools)/bulk-image-converter/page';

vi.mock('@/benchmarks/results/latest.json', () => ({
    default: {
        scenarios: [
            {
                id: 'bulk-convert',
                cases: [
                    {
                        id: 'photo-jpeg-webp',
                        sample: 'photo-jpeg-webp.jpg',
                        input: { bytes: 500 * 1024, format: 'jpeg', width: 1600, height: 1067 },
                        output: { bytes: 190 * 1024, format: 'webp', width: 1600, height: 1067 },
                    },
                    {
                        id: 'convert-transparent-png-to-webp',
                        sample: 'transparent-480x320.png',
                        input: { bytes: 40 * 1024, format: 'png', width: 480, height: 320 },
                        output: { bytes: 22 * 1024, format: 'webp', width: 480, height: 320 },
                    },
                    {
                        id: 'screenshot-webp-png',
                        sample: 'screenshot-webp-png.webp',
                        input: { bytes: 60 * 1024, format: 'webp', width: 1280, height: 800 },
                        // A lossless re-encode of a busy image can genuinely GROW.
                        output: { bytes: 95 * 1024, format: 'png', width: 1280, height: 800 },
                    },
                    {
                        id: 'graphic-png-jpeg',
                        sample: 'graphic-png-jpeg.png',
                        input: { bytes: 80 * 1024, format: 'png', width: 800, height: 800 },
                        output: { bytes: 30 * 1024, format: 'jpeg', width: 800, height: 800 },
                    },
                ],
            },
        ],
    },
}));

function measuredTable() {
    return screen.getByRole('region', { name: 'Measured batch example' });
}

function rowFor(sample) {
    return screen.getByText(sample).closest('tr');
}

describe('the measured-batch table', () => {
    it('renders one row per measured case, with source and output format named', () => {
        render(<BulkImageConverterPage />);

        const cells = within(rowFor('photo-jpeg-webp.jpg')).getAllByRole('cell');
        expect(cells[0]).toHaveTextContent('JPEG');
        expect(cells[0]).toHaveTextContent('WebP');
    });

    it('shows a shrink as a real-minus-sign percentage', () => {
        render(<BulkImageConverterPage />);

        const cells = within(rowFor('photo-jpeg-webp.jpg')).getAllByRole('cell');
        expect(cells.at(-1)).toHaveTextContent('−62%');
    });

    it('shows a growth (a lossless re-encode of a busy image) with a real plus sign, never hidden', () => {
        render(<BulkImageConverterPage />);

        const cells = within(rowFor('screenshot-webp-png.webp')).getAllByRole('cell');
        expect(cells.at(-1)).toHaveTextContent('+58%');
    });

    it('renders every case inside the same measured-batch region', () => {
        render(<BulkImageConverterPage />);

        expect(within(measuredTable()).getByText('photo-jpeg-webp.jpg')).toBeInTheDocument();
        expect(within(measuredTable()).getByText('graphic-png-jpeg.png')).toBeInTheDocument();
        expect(within(measuredTable()).getAllByRole('row')).toHaveLength(5); // header + 4 cases
    });

    it('renders the required H1', () => {
        render(<BulkImageConverterPage />);
        expect(screen.getByRole('heading', { level: 1, name: 'Convert Many Images to One Format' })).toBeInTheDocument();
    });

    it('renders the FAQ answering whether files are uploaded, and the HEIC pointer to /heic', () => {
        render(<BulkImageConverterPage />);
        expect(screen.getByText('Are files uploaded?')).toBeInTheDocument();
        expect(screen.getByText(/HEIC needs its own decoder/)).toBeInTheDocument();
        expect(document.body.textContent).toMatch(/\/heic\b/);
    });
});
