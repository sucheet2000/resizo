import { describe, expect, it } from 'vitest';
import { DEFAULT_QUALITY } from '@/lib/constants';
import { parseQuality, pngCompressionLevel, pngPaletteColours } from '@/lib/image/quality';

describe('parseQuality', () => {
    it.each([
        ['80', 80],
        ['1', 1],
        ['100', 100],
        [' 75 ', 75],
    ])('accepts %s as %i', (raw, expected) => {
        expect(parseQuality(raw)).toEqual({ ok: true, value: expected });
    });

    it('accepts a real number', () => {
        expect(parseQuality(80)).toEqual({ ok: true, value: 80 });
    });

    it.each([
        ['null', null],
        ['undefined', undefined],
    ])('marks %s as absent so the caller can apply its default', (_label, raw) => {
        const result = parseQuality(raw);
        expect(result.ok).toBe(false);
        expect(result.absent).toBe(true);
    });

    it.each([
        ['an empty string', ''],
        ['a whitespace-only string', '  '],
        ['0 below the floor', '0'],
        ['101 above the ceiling', '101'],
        ['-1', '-1'],
        ['abc', 'abc'],
        ['exponent notation 1e2', '1e2'],
        ['a decimal 50.9', '50.9'],
        ['a trailing-junk 80abc', '80abc'],
        ['a signed +80', '+80'],
    ])('rejects %s as present-but-invalid', (_label, raw) => {
        const result = parseQuality(raw);
        expect(result.ok).toBe(false);
        expect(result.absent).toBe(false);
        expect(result.error).toBe('Quality must be an integer between 1 and 100.');
    });

    it.each([
        ['a non-integer number', 50.9],
        ['NaN', NaN],
        ['Infinity', Infinity],
        ['true', true],
        ['an object', {}],
        ['an array', []],
        ['a File-like object', { name: 'photo.jpg', size: 10, arrayBuffer: () => {} }],
    ])('rejects %s without throwing', (_label, raw) => {
        expect(() => parseQuality(raw)).not.toThrow();
        expect(parseQuality(raw).ok).toBe(false);
    });

    it('does not silently read 1e2 as quality 1', () => {
        expect(parseQuality('1e2')).not.toMatchObject({ value: 1 });
    });

    it('honours caller-supplied bounds', () => {
        expect(parseQuality('40', { min: 50 }).ok).toBe(false);
        expect(parseQuality('40', { min: 10, max: 50 })).toEqual({ ok: true, value: 40 });
        expect(parseQuality('60', { min: 10, max: 50 }).error).toBe('Quality must be an integer between 10 and 50.');
    });
});

describe('pngCompressionLevel', () => {
    it.each([
        [1, 9],
        [10, 8],
        [45, 5],
        [80, 2],
        [89, 1],
        [90, 1],
        [100, 0],
    ])('maps quality %i to level %i', (quality, expected) => {
        expect(pngCompressionLevel(quality)).toBe(expected);
    });

    it('stays inside sharp 0-9 for every quality in 1..100', () => {
        for (let quality = 1; quality <= 100; quality += 1) {
            const level = pngCompressionLevel(quality);
            expect(Number.isInteger(level)).toBe(true);
            expect(level).toBeGreaterThanOrEqual(0);
            expect(level).toBeLessThanOrEqual(9);
        }
    });

    it('never increases as quality rises', () => {
        let previous = pngCompressionLevel(1);
        for (let quality = 2; quality <= 100; quality += 1) {
            const level = pngCompressionLevel(quality);
            expect(level).toBeLessThanOrEqual(previous);
            previous = level;
        }
    });

    it('clamps an out-of-range quality into sharp legal range', () => {
        expect(pngCompressionLevel(0)).toBe(9);
        expect(pngCompressionLevel(-500)).toBe(9);
        expect(pngCompressionLevel(500)).toBe(0);
    });

    it.each([
        ['NaN', NaN],
        ['Infinity', Infinity],
        ['a string', '80'],
        ['null', null],
        ['undefined', undefined],
        ['an object', {}],
    ])('falls back to the default quality for %s', (_label, input) => {
        expect(pngCompressionLevel(input)).toBe(pngCompressionLevel(DEFAULT_QUALITY));
    });
});

describe('pngPaletteColours', () => {
    it.each([
        [1, 5],
        [50, 129],
        [80, 205],
        [100, 256],
    ])('maps quality %i to %i colours', (quality, expected) => {
        expect(pngPaletteColours(quality)).toBe(expected);
    });

    it('stays inside 2..256 for every quality in 0..100', () => {
        for (let quality = 0; quality <= 100; quality += 1) {
            const colours = pngPaletteColours(quality);
            expect(Number.isInteger(colours)).toBe(true);
            expect(colours).toBeGreaterThanOrEqual(2);
            expect(colours).toBeLessThanOrEqual(256);
        }
    });

    it('never decreases as quality rises', () => {
        let previous = pngPaletteColours(0);
        for (let quality = 1; quality <= 100; quality += 1) {
            const colours = pngPaletteColours(quality);
            expect(colours).toBeGreaterThanOrEqual(previous);
            previous = colours;
        }
    });

    it('clamps an out-of-range quality', () => {
        expect(pngPaletteColours(-100)).toBe(2);
        expect(pngPaletteColours(1000)).toBe(256);
    });

    it.each([
        ['NaN', NaN],
        ['Infinity', Infinity],
        ['a string', '80'],
        ['null', null],
        ['undefined', undefined],
    ])('falls back to the default quality for %s', (_label, input) => {
        expect(pngPaletteColours(input)).toBe(pngPaletteColours(DEFAULT_QUALITY));
    });

    it('shrinks the palette meaningfully at low quality', () => {
        expect(pngPaletteColours(20)).toBeLessThan(pngPaletteColours(90));
    });
});
