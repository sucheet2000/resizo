/**
 * Result helpers.
 *
 * What is left after the transport went away. The status-code sentence table,
 * the error-body reader, the raw-header parser, the upload-progress mapping and
 * resultStats' header lookups were all about reading an HTTP response, and
 * there are no responses to read: every image is processed in the tab. Those
 * blocks were deleted with the code they covered rather than kept passing
 * against helpers nothing calls.
 *
 * The arithmetic below is untouched, and it is the half that was never about a
 * request in the first place.
 */
import { describe, expect, it } from 'vitest';

import {
    batchTotals,
    formatSavings,
    formatTransition,
    savingsPercent,
} from '@/lib/hooks/submit-helpers';

describe('savingsPercent', () => {
    it.each([
        [1000, 130, 87],
        [1000, 1000, 0],
        [1000, 1040, -4],
    ])('reports %i -> %i as %i%%', (before, after, expected) => {
        expect(savingsPercent(before, after)).toBe(expected);
    });

    it.each([
        [0, 100],
        [-1, 100],
        [null, 100],
        [100, null],
        [NaN, NaN],
    ])('returns null for %o -> %o', (before, after) => {
        expect(savingsPercent(before, after)).toBeNull();
    });
});

describe('formatSavings', () => {
    it('uses a real minus sign for a reduction', () => {
        expect(formatSavings(87)).toBe('−87%');
    });

    it('shows growth honestly rather than hiding it', () => {
        expect(formatSavings(-4)).toBe('+4%');
    });

    it('renders no change as 0%', () => {
        expect(formatSavings(0)).toBe('0%');
    });

    it('returns null when there is nothing to report', () => {
        expect(formatSavings(null)).toBeNull();
        expect(formatSavings(NaN)).toBeNull();
    });
});

describe('formatTransition', () => {
    it('reads old to new', () => {
        expect(formatTransition(1024, 512)).toBe('1 KB → 512 Bytes');
    });
});

describe('batchTotals', () => {
    it('sums a batch and reports one saving', () => {
        expect(batchTotals([
            { originalBytes: 1000, resultBytes: 400 },
            { originalBytes: 3000, resultBytes: 600 },
        ])).toEqual({
            count: 2,
            originalBytes: 4000,
            resultBytes: 1000,
            savedBytes: 3000,
            savedPercent: 75,
        });
    });

    it('skips rows that carry no measurable sizes', () => {
        const totals = batchTotals([
            { originalBytes: 1000, resultBytes: 400 },
            { name: 'failed.png' },
        ]);
        expect(totals.count).toBe(1);
    });

    it.each([[[]], [null], [[{ name: 'only-a-name' }]]])('returns null for %o', (input) => {
        expect(batchTotals(input)).toBeNull();
    });
});
