/**
 * BulkConvertTool's output-format chips are exactly lib/upload/convert-batch.js
 * OUTPUT_FORMATS — one source, never a second hand-typed list here. That
 * constant is mocked in this file (rather than trusted to its real, current
 * value) because lib/limits.js already defines the narrower
 * BULK_OUTPUT_FORMATS this tool is meant to use, but convert-batch.js
 * — a file the engine agent owns, not this one — still re-exports the wider
 * CONVERT_OUTPUT_FORMATS today, which now carries 'avif' for real. Mocking
 * proves BulkConvertTool.js itself introduces no separate AVIF chip, without
 * this suite's outcome depending on when that one-line switch lands.
 */
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/upload/convert-batch', async (importOriginal) => {
    const actual = await importOriginal();
    return { ...actual, OUTPUT_FORMATS: ['jpeg', 'png', 'webp'] };
});

import BulkConvertTool from '@/app/(tools)/bulk-image-converter/BulkConvertTool';

describe('BulkConvertTool — output chips follow OUTPUT_FORMATS exactly', () => {
    it('renders no AVIF chip when OUTPUT_FORMATS does not carry one', () => {
        render(<BulkConvertTool />);
        const group = screen.getByRole('group', { name: 'Output format' });

        expect(within(group).queryByRole('button', { name: 'AVIF' })).toBeNull();
        for (const label of ['JPG', 'PNG', 'WebP']) {
            expect(within(group).getByRole('button', { name: label })).toBeInTheDocument();
        }
    });
});
