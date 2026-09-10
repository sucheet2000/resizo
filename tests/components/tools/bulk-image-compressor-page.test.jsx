/**
 * BulkImageCompressorPage — the measured-batch table's honesty about a file
 * that was never re-encoded at all.
 *
 * A file already at or under its limit is now kept rather than compressed
 * (lib/upload/compress-batch.js), which means its measured output can be
 * SLIGHTLY SMALLER than its input (metadata stripped back off), the same
 * size, or even a few bytes larger. Only the engine's own `kept` flag on the
 * benchmark case can tell "kept, incidentally a bit smaller" apart from
 * "genuinely re-encoded, happened to only shrink a little" — a byte
 * comparison cannot, and would print a small, misleading percentage (even a
 * negative-looking one) for a file nothing actually touched. `kept` is
 * trusted first; the byte comparison survives only as a fallback for a
 * results file measured before the field existed.
 *
 * The benchmark scenario is mocked here rather than trusted to contain a kept
 * case for real: whether a real run happens to include one is not something
 * this test should depend on.
 */
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import BulkImageCompressorPage from '@/app/(tools)/bulk-image-compressor/page';

vi.mock('@/benchmarks/results/latest.json', () => ({
    default: {
        scenarios: [
            {
                id: 'bulk-compress',
                cases: [
                    // Genuinely re-encoded: output well under input, kept:false.
                    {
                        id: 'bulk-photo-1600x1067',
                        sample: 'bulk-photo-1600x1067.jpg',
                        kept: false,
                        input: { bytes: 500 * 1024, width: 1600, height: 1067 },
                        output: { bytes: 190 * 1024, width: 1600, height: 1067 },
                    },
                    // Kept, output slightly ABOVE input — the case a plain byte
                    // comparison also happens to get right.
                    {
                        id: 'bulk-graphic-800x800',
                        sample: 'bulk-graphic-800x800.png',
                        kept: true,
                        input: { bytes: 40 * 1024 },
                        output: { bytes: 41 * 1024 },
                    },
                    // Kept, output slightly BELOW input (metadata stripped) — the
                    // case a byte comparison gets WRONG: `output >= input` is
                    // false here, so it would report this as a tiny re-encode
                    // ("−1%") instead of trusting the engine's own kept:true.
                    {
                        id: 'bulk-icon-64x64',
                        sample: 'bulk-icon-64x64.png',
                        kept: true,
                        input: { bytes: 40 * 1024 },
                        output: { bytes: 40 * 1024 - 200 },
                    },
                    // No `kept` field at all — an older results file, measured
                    // before the engine recorded it. Falls back to the byte
                    // comparison, which correctly calls an exact tie "kept".
                    {
                        id: 'bulk-illustration-1200x900',
                        sample: 'bulk-illustration-1200x900.png',
                        input: { bytes: 60 * 1024 },
                        output: { bytes: 60 * 1024 },
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
    it('shows a percentage for a file that was actually re-encoded smaller (kept: false)', () => {
        render(<BulkImageCompressorPage />);

        const cells = within(rowFor('bulk-photo-1600x1067.jpg')).getAllByRole('cell');
        expect(cells.at(-1)).toHaveTextContent('62%');
        expect(cells.at(-1)).not.toHaveTextContent('Kept');
    });

    it('shows "Kept — already under the limit" when kept:true and the output is larger', () => {
        render(<BulkImageCompressorPage />);

        const cells = within(rowFor('bulk-graphic-800x800.png')).getAllByRole('cell');
        expect(cells.at(-1)).toHaveTextContent('Kept — already under the limit');
        expect(cells.at(-1)).not.toHaveTextContent('%');
    });

    it('trusts kept:true even when the output is slightly SMALLER — never prints a percentage here', () => {
        render(<BulkImageCompressorPage />);

        const cells = within(rowFor('bulk-icon-64x64.png')).getAllByRole('cell');
        expect(cells.at(-1)).toHaveTextContent('Kept — already under the limit');
        expect(cells.at(-1)).not.toHaveTextContent('%');
        expect(cells.at(-1)).not.toHaveTextContent('−1%');
        expect(cells.at(-1)).not.toHaveTextContent('-1%');
    });

    it('falls back to the byte comparison for a case with no kept field at all (an older results file)', () => {
        render(<BulkImageCompressorPage />);

        const cells = within(rowFor('bulk-illustration-1200x900.png')).getAllByRole('cell');
        expect(cells.at(-1)).toHaveTextContent('Kept — already under the limit');
    });

    it('renders inside the same measured-batch region either way', () => {
        render(<BulkImageCompressorPage />);

        expect(within(measuredTable()).getByText('bulk-photo-1600x1067.jpg')).toBeInTheDocument();
        expect(within(measuredTable()).getByText('bulk-icon-64x64.png')).toBeInTheDocument();
    });
});
