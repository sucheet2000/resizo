/**
 * Quality parsing.
 *
 * The pngCompressionLevel and pngPaletteColours blocks were deleted with the
 * functions themselves: both mapped a 1-100 quality onto a sharp/libvips knob,
 * and there is no sharp on the path any more. @jsquash/png has no quantiser, so
 * there is nothing for a PNG quality number to drive — which is a fact
 * /compress states to the visitor and tests/components/tools/compress-tool.test.jsx
 * asserts.
 */
import { describe, expect, it } from 'vitest';
import { parseQuality } from '@/lib/image/quality';

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
