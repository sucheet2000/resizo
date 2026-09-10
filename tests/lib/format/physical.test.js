import { describe, expect, it } from 'vitest';

import { MM_PER_INCH, describePhysical, pixelsFor, toMillimetres } from '@/lib/format/physical';

describe('MM_PER_INCH', () => {
    it('is the standard millimetres-per-inch constant', () => {
        expect(MM_PER_INCH).toBe(25.4);
    });
});

describe('toMillimetres', () => {
    it.each([
        ['mm', 35, 35],
        ['mm', 0.5, 0.5],
        ['cm', 3.5, 35],
        ['cm', 1, 10],
        ['in', 1, 25.4],
        ['in', 2, 50.8],
    ])('converts %s %d to %d mm', (unit, value, expected) => {
        expect(toMillimetres(value, unit)).toBeCloseTo(expected, 10);
    });

    it.each([
        ['NaN', NaN],
        ['Infinity', Infinity],
        ['-Infinity', -Infinity],
        ['zero', 0],
        ['a negative number', -5],
    ])('throws when the value is %s', (_label, value) => {
        expect(() => toMillimetres(value, 'mm')).toThrow();
    });

    it.each([
        ['an unrecognised unit', 'ft'],
        ['an empty string', ''],
        ['undefined', undefined],
        ['null', null],
        ['the wrong case', 'MM'],
    ])('throws when the unit is %s', (_label, unit) => {
        expect(() => toMillimetres(35, unit)).toThrow();
    });
});

describe('pixelsFor', () => {
    // These are the numbers the passport presets depend on: a UK printed photo
    // (35 x 45 mm) and a US printed photo (2 x 2 in, restated by the State
    // Department as 51 x 51 mm), both at the 300 DPI default.
    it.each([
        [35, 'mm', 300, 413],
        [45, 'mm', 300, 531],
        [2, 'in', 300, 600],
        [51, 'mm', 300, 602],
    ])('rounds %d %s at %d DPI to %d px', (value, unit, dpi, expected) => {
        expect(pixelsFor(value, unit, dpi)).toBe(expected);
    });

    // 51 mm is the US State Department's own rounded-millimetre restatement of
    // "2 inches", not a bit-for-bit equal length (2 in is 50.8 mm), so the two
    // must not collapse onto the same pixel count even though both describe
    // "a US passport photo" at the same DPI.
    it('does not treat the 51 mm restatement as identical to the exact 2 in size', () => {
        expect(pixelsFor(51, 'mm', 300)).not.toBe(pixelsFor(2, 'in', 300));
    });

    it.each([
        ['NaN', NaN],
        ['Infinity', Infinity],
        ['zero', 0],
        ['a negative number', -300],
    ])('throws when the DPI is %s', (_label, dpi) => {
        expect(() => pixelsFor(35, 'mm', dpi)).toThrow();
    });

    it.each([
        ['zero', 0],
        ['a negative number', -1],
        ['NaN', NaN],
    ])('throws when the value is %s', (_label, value) => {
        expect(() => pixelsFor(value, 'mm', 300)).toThrow();
    });

    it('throws for an unrecognised unit', () => {
        expect(() => pixelsFor(35, 'ft', 300)).toThrow();
    });
});

describe('describePhysical', () => {
    it('formats millimetres with inches alongside, to two decimal places', () => {
        expect(describePhysical(35, 45)).toBe('35 × 45 mm (1.38 × 1.77 in)');
    });

    it('formats an exact-inch size without a misleading trailing digit', () => {
        expect(describePhysical(50.8, 50.8)).toBe('50.8 × 50.8 mm (2.00 × 2.00 in)');
    });

    it('formats the 51 mm restatement distinctly from the exact 2 in size', () => {
        expect(describePhysical(51, 51)).toBe('51 × 51 mm (2.01 × 2.01 in)');
    });
});
