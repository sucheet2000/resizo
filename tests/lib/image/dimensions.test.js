import { describe, expect, it } from 'vitest';
import { MAX_DIMENSION, MAX_PIXELS, MAX_SCALE_PERCENT } from '@/lib/limits';
import {
    explicitTargetDimensions,
    parsePositiveInt,
    parseScale,
    scaleDimensions,
    withinPixelBudget,
} from '@/lib/image/dimensions';

describe('parsePositiveInt', () => {
    describe('accepts', () => {
        it.each([
            ['800', 800],
            ['1', 1],
            ['8000', 8000],
            [' 7 ', 7],
            ['0007', 7],
        ])('%s as %i', (raw, expected) => {
            expect(parsePositiveInt(raw, { max: MAX_DIMENSION })).toEqual({ ok: true, value: expected });
        });

        it('accepts a real number from the bulk JSON path', () => {
            expect(parsePositiveInt(800, { max: MAX_DIMENSION })).toEqual({ ok: true, value: 800 });
        });

        it('accepts the max boundary inclusively', () => {
            expect(parsePositiveInt('8000', { max: 8000 }).ok).toBe(true);
        });

        it('accepts 0 when min is 0 (crop offsets)', () => {
            expect(parsePositiveInt('0', { min: 0 })).toEqual({ ok: true, value: 0 });
            expect(parsePositiveInt(0, { min: 0 })).toEqual({ ok: true, value: 0 });
        });
    });

    describe('reports absence separately from invalidity', () => {
        it.each([
            ['null', null],
            ['undefined', undefined],
            ['an empty string', ''],
            ['a whitespace-only string', '   '],
        ])('marks %s as absent', (_label, raw) => {
            const result = parsePositiveInt(raw);
            expect(result.ok).toBe(false);
            expect(result.absent).toBe(true);
        });

        it('marks a malformed value as present-but-invalid', () => {
            const result = parsePositiveInt('abc');
            expect(result.ok).toBe(false);
            expect(result.absent).toBe(false);
            expect(result.error).toBeTruthy();
        });
    });

    describe('rejects', () => {
        it.each([
            ['8001 over max', '8001', { max: 8000 }],
            ['0 under the default min', '0', {}],
            ['-1', '-1', {}],
            ['-0', '-0', {}],
            ['abc', 'abc', {}],
            ['NaN', 'NaN', {}],
            ['Infinity', 'Infinity', {}],
            ['exponent notation 1e10', '1e10', {}],
            ['hex 0x10', '0x10', {}],
            ['a decimal 50.9', '50.9', {}],
            ['a trailing-junk 8000abc', '8000abc', {}],
            ['a signed +800', '+800', {}],
            ['an inner space 8 00', '8 00', {}],
            ['a comma 8,000', '8,000', {}],
            ['a value past MAX_SAFE_INTEGER', '99999999999999999999', {}],
        ])('rejects %s', (_label, raw, options) => {
            const result = parsePositiveInt(raw, options);
            expect(result.ok).toBe(false);
            expect(result.absent).toBe(false);
        });

        it.each([
            ['true', true],
            ['false', false],
            ['an object', {}],
            ['an array', []],
            ['a single-element array', [800]],
            ['a non-integer number', 800.7],
            ['NaN as a number', NaN],
            ['Infinity as a number', Infinity],
            ['a negative number', -5],
        ])('rejects %s without throwing', (_label, raw) => {
            expect(() => parsePositiveInt(raw)).not.toThrow();
            expect(parsePositiveInt(raw).ok).toBe(false);
        });

        it('rejects a number past the max', () => {
            expect(parsePositiveInt(8001, { max: MAX_DIMENSION }).ok).toBe(false);
        });

        it.each([
            ['MAX_SAFE_INTEGER + 2', Number.MAX_SAFE_INTEGER + 2],
            ['1e21', 1e21],
            ['2 ** 60', 2 ** 60],
        ])('rejects the unsafe integer %s even with no max supplied', (_label, raw) => {
            const result = parsePositiveInt(raw);
            expect(result.ok).toBe(false);
            expect(result.absent).toBe(false);
        });

        it('still accepts MAX_SAFE_INTEGER itself', () => {
            expect(parsePositiveInt(Number.MAX_SAFE_INTEGER)).toEqual({
                ok: true,
                value: Number.MAX_SAFE_INTEGER,
            });
        });
    });

    it('does not silently coerce 1e10 into 1', () => {
        expect(parsePositiveInt('1e10', { max: MAX_DIMENSION })).not.toMatchObject({ value: 1 });
    });

    it('does not silently coerce 8000abc into 8000', () => {
        expect(parsePositiveInt('8000abc', { max: MAX_DIMENSION })).not.toMatchObject({ value: 8000 });
    });
});

describe('parseScale', () => {
    it.each([
        ['100', 100],
        ['400', 400],
        ['0.001', 0.001],
        ['50.5', 50.5],
        ['  100  ', 100],
    ])('accepts %s as %f', (raw, expected) => {
        expect(parseScale(raw)).toEqual({ ok: true, value: expected });
    });

    it('accepts a real number', () => {
        expect(parseScale(75)).toEqual({ ok: true, value: 75 });
    });

    it.each([
        ['null', null],
        ['undefined', undefined],
        ['an empty string', ''],
        ['a whitespace-only string', '  '],
    ])('marks %s as absent', (_label, raw) => {
        const result = parseScale(raw);
        expect(result.ok).toBe(false);
        expect(result.absent).toBe(true);
    });

    it.each([
        ['400.1 just past the cap', '400.1'],
        ['0', '0'],
        ['-50', '-50'],
        ['-0.5', '-0.5'],
        ['1e400', '1e400'],
        ['abc', 'abc'],
        ['50%', '50%'],
        ['.5 with no leading digit', '.5'],
    ])('rejects %s', (_label, raw) => {
        const result = parseScale(raw);
        expect(result.ok).toBe(false);
        expect(result.absent).toBe(false);
    });

    it.each([
        ['Infinity as a number', Infinity],
        ['NaN as a number', NaN],
        ['0 as a number', 0],
        ['a negative number', -1],
        ['true', true],
        ['an object', {}],
        ['an array', []],
    ])('rejects %s without throwing', (_label, raw) => {
        expect(() => parseScale(raw)).not.toThrow();
        expect(parseScale(raw).ok).toBe(false);
    });

    it('honours a caller-supplied max', () => {
        expect(parseScale('150', { max: 100 }).ok).toBe(false);
        expect(parseScale('100', { max: 100 }).ok).toBe(true);
    });

    it('defaults its cap to MAX_SCALE_PERCENT', () => {
        expect(parseScale(String(MAX_SCALE_PERCENT)).ok).toBe(true);
        expect(parseScale(String(MAX_SCALE_PERCENT + 1)).ok).toBe(false);
    });
});

describe('withinPixelBudget', () => {
    it('accepts a small image', () => {
        expect(withinPixelBudget(1920, 1080)).toBe(true);
    });

    it('accepts exactly the budget', () => {
        expect(withinPixelBudget(8000, 5000)).toBe(true);
        expect(8000 * 5000).toBe(MAX_PIXELS);
    });

    it('rejects one pixel past the budget', () => {
        expect(withinPixelBudget(8000, 5001)).toBe(false);
    });

    it('honours a caller-supplied budget', () => {
        expect(withinPixelBudget(100, 100, 10000)).toBe(true);
        expect(withinPixelBudget(100, 101, 10000)).toBe(false);
    });

    it.each([
        ['zero width', 0, 100],
        ['zero height', 100, 0],
        ['negative width', -1, 100],
        ['NaN', NaN, 100],
        ['Infinity', Infinity, 100],
        ['string dimensions', '100', 100],
        ['null dimensions', null, null],
        ['undefined dimensions', undefined, undefined],
    ])('returns false for %s', (_label, width, height) => {
        expect(withinPixelBudget(width, height)).toBe(false);
    });
});

describe('scaleDimensions', () => {
    it('scales down to whole pixels', () => {
        expect(scaleDimensions(1920, 1080, 50)).toEqual({ ok: true, width: 960, height: 540 });
    });

    it('rounds half up', () => {
        expect(scaleDimensions(1921, 1081, 50)).toEqual({ ok: true, width: 961, height: 541 });
    });

    it('returns the source unchanged at 100 percent', () => {
        expect(scaleDimensions(1234, 567, 100)).toEqual({ ok: true, width: 1234, height: 567 });
    });

    it('clamps a tiny scale to 1x1 rather than asking sharp for 0x0', () => {
        expect(scaleDimensions(10, 10, 0.001)).toEqual({ ok: true, width: 1, height: 1 });
    });

    it('rejects a 400 percent upscale of a 6000x4000 source', () => {
        const result = scaleDimensions(6000, 4000, 400);
        expect(result.ok).toBe(false);
        expect(result.error).toBe('Dimensions exceed maximum allowed values.');
    });

    it('rejects a scale that lands past 8000px on one side', () => {
        expect(scaleDimensions(8000, 100, 400).ok).toBe(false);
        expect(scaleDimensions(2001, 100, 400).ok).toBe(false);
    });

    it('accepts a scale that lands exactly on MAX_DIMENSION', () => {
        expect(scaleDimensions(4000, 1000, 200)).toEqual({ ok: true, width: 8000, height: 2000 });
    });

    it('rejects a result inside MAX_DIMENSION but past the pixel budget', () => {
        const result = scaleDimensions(8000, 8000, 100);
        expect(result.ok).toBe(false);
        expect(result.error).toBe('Dimensions exceed maximum allowed values.');
        expect(8000).toBeLessThanOrEqual(MAX_DIMENSION);
    });

    it.each([
        ['zero width', 0, 100],
        ['zero height', 100, 0],
        ['negative width', -100, 100],
        ['undefined dimensions', undefined, undefined],
        ['NaN dimensions', NaN, NaN],
        ['string dimensions', '1920', '1080'],
    ])('rejects %s with a source-dimension message', (_label, width, height) => {
        const result = scaleDimensions(width, height, 50);
        expect(result.ok).toBe(false);
        expect(result.error).toBe('Unable to determine the source image dimensions.');
    });

    it.each([
        ['zero', 0],
        ['negative', -50],
        ['NaN', NaN],
        ['Infinity', Infinity],
        ['a string', '50'],
        ['undefined', undefined],
        ['null', null],
    ])('rejects a %s percentage with a scale message', (_label, percent) => {
        const result = scaleDimensions(1000, 1000, percent);
        expect(result.ok).toBe(false);
        expect(result.error).toBe('Invalid scale parameter provided.');
    });

    it('never returns a zero or negative side', () => {
        for (const percent of [0.0001, 0.01, 1, 33.3, 99.9]) {
            const result = scaleDimensions(3, 7, percent);
            expect(result.ok).toBe(true);
            expect(result.width).toBeGreaterThanOrEqual(1);
            expect(result.height).toBeGreaterThanOrEqual(1);
        }
    });
});

/**
 * The caps land on the side that was DERIVED, not only the side that was asked
 * for. This is the sharp edge of explicitTargetDimensions and it used to be
 * proved against /api/resize, whose resolveExplicitTarget existed for exactly
 * this. The route is gone; the requirement is not, because the browser engine
 * sizes every two-sided and one-sided resize through this same helper
 * (lib/image-client/resize.js targetDimensions) and lib/upload/process-file.js
 * costs a batch file's memory from it before anything decodes.
 *
 * Each sweep walks the SUPPLIED side across the value where the DERIVED side
 * breaks a cap. The crossing is pinned to the pixel: one pixel of drift in the
 * formula moves `lastAccepted` by one and the test fails. The sweep also
 * insists a crossing really is inside the range, so a range that drifted
 * entirely to one side of it cannot pass while proving nothing.
 */
describe('explicitTargetDimensions applies the caps to the derived side', () => {
    const DIMENSION_ERROR = 'Dimensions exceed maximum allowed values.';

    it.each([
        {
            label: 'a derived height crossing MAX_DIMENSION',
            source: { width: 200, height: 400 },
            side: 'width',
            from: 3998,
            to: 4003,
            lastAccepted: 4000,
        },
        {
            label: 'a derived height crossing MAX_DIMENSION on a ratio that never lands exactly',
            source: { width: 300, height: 701 },
            side: 'width',
            from: 3421,
            to: 3426,
            lastAccepted: 3423,
        },
        {
            label: 'a derived width crossing MAX_DIMENSION',
            source: { width: 701, height: 300 },
            side: 'height',
            from: 3421,
            to: 3426,
            lastAccepted: 3423,
        },
        {
            label: 'a derived height crossing the pixel budget while both sides stay legal',
            source: { width: 4000, height: 3000 },
            side: 'width',
            from: 7301,
            to: 7306,
            lastAccepted: 7303,
        },
    ])('$label', ({ source, side, from, to, lastAccepted }) => {
        const seen = [];

        for (let value = from; value <= to; value += 1) {
            const result = explicitTargetDimensions(source.width, source.height, { [side]: value });

            expect(
                { value, ok: result.ok },
                `${side}=${value} on a ${source.width}x${source.height} source`,
            ).toEqual({ value, ok: value <= lastAccepted });

            if (!result.ok) expect(result.error).toBe(DIMENSION_ERROR);
            seen.push(result.ok);
        }

        // The range has to contain the flip, or the sweep proved nothing.
        expect(new Set(seen).size).toBe(2);
    });

    it('caps the derived side even when both sides stay under MAX_DIMENSION', () => {
        // 7303x5477 is 40.0M pixels — inside the budget with both sides well
        // under 8000. One more pixel of width is not.
        expect(explicitTargetDimensions(4000, 3000, { width: 7303 }))
            .toEqual({ ok: true, width: 7303, height: 5477 });

        const refused = explicitTargetDimensions(4000, 3000, { width: 7304 });
        expect(refused.ok).toBe(false);
        expect(7304).toBeLessThan(MAX_DIMENSION);
        expect(7304 * 5478).toBeGreaterThan(MAX_PIXELS);
    });
});
