import { describe, expect, it } from 'vitest';
import { MAX_DIMENSION } from '@/lib/limits';
import { isCropInBounds, parseCropParams } from '@/lib/image/crop';

const MISSING = 'Missing crop parameters (crop_x, crop_y, crop_width, crop_height).';
const INVALID = 'Invalid crop parameters provided.';
const TOO_BIG = 'Crop area exceeds the maximum allowed size.';

describe('parseCropParams', () => {
    it('parses four valid form strings into numbers', () => {
        expect(parseCropParams({ x: '10', y: '20', width: '100', height: '50' })).toEqual({
            ok: true,
            rect: { x: 10, y: 20, width: 100, height: 50 },
        });
    });

    it('accepts real numbers from a JSON body', () => {
        expect(parseCropParams({ x: 0, y: 0, width: 10, height: 10 })).toEqual({
            ok: true,
            rect: { x: 0, y: 0, width: 10, height: 10 },
        });
    });

    it('accepts a zero offset', () => {
        expect(parseCropParams({ x: '0', y: '0', width: '1', height: '1' }).ok).toBe(true);
    });

    it('accepts the dimension boundary on one side', () => {
        expect(parseCropParams({ x: '0', y: '0', width: String(MAX_DIMENSION), height: '1' }).ok).toBe(true);
    });

    describe('missing values', () => {
        it.each([
            ['x', { y: '0', width: '10', height: '10' }],
            ['y', { x: '0', width: '10', height: '10' }],
            ['width', { x: '0', y: '0', height: '10' }],
            ['height', { x: '0', y: '0', width: '10' }],
        ])('reports a missing-parameter error when %s is absent', (_label, params) => {
            expect(parseCropParams(params)).toEqual({ ok: false, error: MISSING });
        });

        it.each([
            ['an empty string', ''],
            ['a whitespace-only string', '   '],
            ['null', null],
            ['undefined', undefined],
        ])('treats %s as missing rather than invalid', (_label, value) => {
            expect(parseCropParams({ x: value, y: '0', width: '10', height: '10' }).error).toBe(MISSING);
        });

        it('reports missing parameters when nothing is supplied at all', () => {
            expect(parseCropParams()).toEqual({ ok: false, error: MISSING });
            expect(parseCropParams({})).toEqual({ ok: false, error: MISSING });
        });
    });

    describe('malformed values', () => {
        it.each([
            ['a negative x', { x: '-1', y: '0', width: '10', height: '10' }],
            ['a negative y', { x: '0', y: '-5', width: '10', height: '10' }],
            ['a zero width', { x: '0', y: '0', width: '0', height: '10' }],
            ['a zero height', { x: '0', y: '0', width: '10', height: '0' }],
            ['a decimal', { x: '0', y: '0', width: '10.9', height: '10' }],
            ['a non-numeric value', { x: '0', y: '0', width: 'abc', height: '10' }],
            ['exponent notation', { x: '0', y: '0', width: '1e3', height: '10' }],
            ['trailing junk', { x: '0', y: '0', width: '10abc', height: '10' }],
            ['NaN', { x: NaN, y: 0, width: 10, height: 10 }],
            ['a boolean', { x: true, y: 0, width: 10, height: 10 }],
            ['an object', { x: {}, y: 0, width: 10, height: 10 }],
            ['a width past MAX_DIMENSION', { x: '0', y: '0', width: String(MAX_DIMENSION + 1), height: '10' }],
            ['a height past MAX_DIMENSION', { x: '0', y: '0', width: '10', height: String(MAX_DIMENSION + 1) }],
            ['an offset past MAX_DIMENSION', { x: String(MAX_DIMENSION + 1), y: '0', width: '10', height: '10' }],
        ])('rejects %s with an invalid-parameter error', (_label, params) => {
            expect(parseCropParams(params)).toEqual({ ok: false, error: INVALID });
        });

        it('does not throw on hostile input', () => {
            expect(() => parseCropParams({ x: [], y: Symbol('x'), width: () => {}, height: 10 })).not.toThrow();
        });
    });

    it('rejects an in-range rectangle whose area busts the pixel budget', () => {
        expect(parseCropParams({
            x: '0',
            y: '0',
            width: String(MAX_DIMENSION),
            height: String(MAX_DIMENSION),
        })).toEqual({ ok: false, error: TOO_BIG });
    });
});

describe('isCropInBounds', () => {
    it('accepts a rectangle that exactly fills the image', () => {
        expect(isCropInBounds({ x: 0, y: 0, width: 100, height: 50 }, { width: 100, height: 50 })).toBe(true);
    });

    it('accepts a 1x1 crop of a 1x1 image', () => {
        expect(isCropInBounds({ x: 0, y: 0, width: 1, height: 1 }, { width: 1, height: 1 })).toBe(true);
    });

    it('accepts an offset rectangle that still fits', () => {
        expect(isCropInBounds({ x: 10, y: 10, width: 80, height: 30 }, { width: 100, height: 50 })).toBe(true);
    });

    it('rejects a rectangle one pixel too wide', () => {
        expect(isCropInBounds({ x: 0, y: 0, width: 101, height: 50 }, { width: 100, height: 50 })).toBe(false);
    });

    it('rejects a rectangle one pixel too tall', () => {
        expect(isCropInBounds({ x: 0, y: 1, width: 100, height: 50 }, { width: 100, height: 50 })).toBe(false);
    });

    describe('unresolved metadata is out of bounds, not a 500', () => {
        it.each([
            ['an empty metadata object', {}],
            ['a null width', { width: null, height: 50 }],
            ['an undefined height', { width: 100 }],
            ['a NaN width', { width: NaN, height: 50 }],
            ['a zero width', { width: 0, height: 50 }],
            ['a negative height', { width: 100, height: -50 }],
            ['an Infinity width', { width: Infinity, height: 50 }],
            ['string dimensions', { width: '100', height: '50' }],
        ])('returns false for %s', (_label, meta) => {
            expect(isCropInBounds({ x: 0, y: 0, width: 10, height: 10 }, meta)).toBe(false);
        });

        it.each([
            ['null metadata', null],
            ['undefined metadata', undefined],
        ])('returns false for %s', (_label, meta) => {
            expect(isCropInBounds({ x: 0, y: 0, width: 10, height: 10 }, meta)).toBe(false);
        });
    });

    describe('malformed rectangles', () => {
        it.each([
            ['a null rect', null],
            ['an undefined rect', undefined],
            ['an empty rect', {}],
            ['a negative x', { x: -1, y: 0, width: 10, height: 10 }],
            ['a negative y', { x: 0, y: -1, width: 10, height: 10 }],
            ['a zero width', { x: 0, y: 0, width: 0, height: 10 }],
            ['a zero height', { x: 0, y: 0, width: 10, height: 0 }],
            ['a NaN offset', { x: NaN, y: 0, width: 10, height: 10 }],
            ['an Infinity width', { x: 0, y: 0, width: Infinity, height: 10 }],
            ['string values', { x: '0', y: '0', width: '10', height: '10' }],
        ])('returns false for %s', (_label, rect) => {
            expect(isCropInBounds(rect, { width: 100, height: 100 })).toBe(false);
        });
    });
});
