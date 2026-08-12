import { describe, expect, it } from 'vitest';
import { formatFileSize } from '@/lib/format-bytes';

describe('formatFileSize', () => {
    it.each([
        [0, '0 Bytes'],
        [1, '1 Bytes'],
        [512, '512 Bytes'],
        [1023, '1023 Bytes'],
        [1024, '1 KB'],
        [1025, '1 KB'],
        [1536, '1.5 KB'],
        [1048576, '1 MB'],
        [1234567, '1.18 MB'],
        [20971520, '20 MB'],
        [1024 ** 3, '1 GB'],
    ])('formats %i as %s', (bytes, expected) => {
        expect(formatFileSize(bytes)).toBe(expected);
    });

    it('scales past GB instead of rendering "1 undefined"', () => {
        expect(formatFileSize(1024 ** 4)).toBe('1 TB');
    });

    it('scales to PB', () => {
        expect(formatFileSize(1024 ** 5)).toBe('1 PB');
    });

    it('stays on the largest unit rather than running off the table', () => {
        expect(formatFileSize(1024 ** 6)).toBe('1024 PB');
    });

    it('returns "0 Bytes" for negative input instead of "NaN undefined"', () => {
        expect(formatFileSize(-5)).toBe('0 Bytes');
        expect(formatFileSize(-(1024 ** 4))).toBe('0 Bytes');
    });

    it.each([
        ['NaN', NaN],
        ['Infinity', Infinity],
        ['-Infinity', -Infinity],
        ['null', null],
        ['undefined', undefined],
        ['a numeric string', '1024'],
        ['an object', {}],
        ['an array', [1024]],
        ['a boolean', true],
    ])('returns "0 Bytes" for %s', (_label, input) => {
        expect(formatFileSize(input)).toBe('0 Bytes');
    });

    it('never emits NaN or undefined for any input in a wide sweep', () => {
        const inputs = [0, 1, 1023, 1024, 1e6, 1e9, 1e12, 1e15, 1e18, -1, NaN, Infinity, null, undefined, '5', {}];
        for (const input of inputs) {
            const result = formatFileSize(input);
            expect(result).not.toContain('undefined');
            expect(result).not.toContain('NaN');
        }
    });

    it('trims trailing zeros from the rounded value', () => {
        expect(formatFileSize(2048)).toBe('2 KB');
        expect(formatFileSize(2560)).toBe('2.5 KB');
    });
});
