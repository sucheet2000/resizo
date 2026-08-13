/**
 * deriveWidth and deriveHeight — the aspect-ratio lock.
 *
 * Both are exported from lib/image/dimensions.js and neither was called
 * directly by any test. They were reached only through
 * explicitTargetDimensions, which is a different claim: that suite proves the
 * CAPS land in the right place, and this one proves the arithmetic underneath
 * them is the arithmetic the whole site agreed on.
 *
 * WHY THE ORDER OF THE MULTIPLICATION IS THE POINT
 *
 * This had three separate implementations once: the client resizer, the live
 * width/height fields on /resize, and the two route handlers. They did the same
 * sum in a different ORDER — `(h / w) * width` against `h * (width / w)` — and
 * those are not the same function in floating point. The number the input field
 * predicted and the number the server produced could differ by one pixel, which
 * is a visible, reportable bug on a page whose entire promise is exactness.
 *
 * The order below is the routes' order, because the routes are what sharp was
 * actually asked for and therefore what the output really was. The cases here
 * are chosen to be ones where the two orders disagree, so the test fails if
 * anybody ever "simplifies" it back.
 */
import { describe, expect, it } from 'vitest';

import { deriveHeight, deriveWidth } from '@/lib/image/dimensions';

describe('deriving the other side', () => {
    it('keeps a plain 3:2 photograph at 3:2', () => {
        expect(deriveHeight(3000, 2000, 1500)).toBe(1000);
        expect(deriveWidth(3000, 2000, 1000)).toBe(1500);
    });

    it('is symmetric on an exact ratio', () => {
        expect(deriveWidth(1920, 1080, deriveHeight(1920, 1080, 1280))).toBe(1280);
    });

    it('rounds rather than truncating, so a 0.5 pixel goes up', () => {
        // 1001 * (500 / 1000) = 500.5
        expect(deriveHeight(1000, 1001, 500)).toBe(501);
    });

    /**
     * THE FLOOR OF 1 IS NOT DECORATION.
     *
     * A 10000x3 source at width 1 rounds its height to 0, and asking any
     * resampler for a zero-height surface is an error rather than a small image.
     * lib/image-client/hostile-inputs.test.js walks the same case through the
     * whole engine; this is the arithmetic on its own.
     */
    it('never derives a side of zero, however extreme the source', () => {
        expect(deriveHeight(10_000, 3, 1)).toBe(1);
        expect(deriveHeight(8000, 1, 1)).toBe(1);
        expect(deriveWidth(3, 10_000, 1)).toBe(1);
    });

    it('never derives a negative side from a rounding artefact', () => {
        expect(deriveHeight(10_000, 1, 2)).toBeGreaterThanOrEqual(1);
        expect(deriveWidth(1, 10_000, 2)).toBeGreaterThanOrEqual(1);
    });

    /**
     * THE ORDER LOCK.
     *
     * Each pair below is a size where `dimension * (target / source)` and
     * `(dimension / source) * target` land on opposite sides of a .5 boundary,
     * so the two orders produce different integers. The first number is what the
     * routes produced and therefore what every published output has been.
     */
    it.each([
        // sourceW, sourceH, width, expected — the OTHER order gives the value
        // in the comment, one pixel away, on every one of these.
        [1000, 1001, 500, 501], //  other order: 500
        [3920, 2205, 1080, 607], //  other order: 608
        [4208, 2367, 1080, 607], //  other order: 608
        [6, 13, 27, 59], //         other order: 58
        [6, 15, 49, 122], //        other order: 123
    ])('derives the height of %ix%i at width %i as %i', (sourceWidth, sourceHeight, width, expected) => {
        expect(deriveHeight(sourceWidth, sourceHeight, width)).toBe(expected);

        // Stated so a reader can see the two orders really are different
        // functions here, rather than taking the docblock's word for it.
        const otherOrder = Math.max(1, Math.round((sourceHeight / sourceWidth) * width));
        expect(otherOrder).not.toBe(expected);
    });

    it('the mirror derives the width the same way, and is just as order-sensitive', () => {
        expect(deriveWidth(2205, 3920, 1080)).toBe(607);
        expect(Math.round((2205 / 3920) * 1080)).toBe(608);

        expect(deriveWidth(1001, 1000, 500)).toBe(501);
        expect(Math.round((1001 / 1000) * 500)).toBe(500);
    });

    /**
     * An upscale is a legal request on /resize (MAX_SCALE_PERCENT is 400), so
     * the derivation has to hold above 1:1 as well as below it.
     */
    it('holds the ratio when the target is larger than the source', () => {
        expect(deriveHeight(400, 300, 1600)).toBe(1200);
        expect(deriveWidth(400, 300, 1200)).toBe(1600);
    });

    it('is exact on a square', () => {
        expect(deriveHeight(512, 512, 137)).toBe(137);
        expect(deriveWidth(512, 512, 137)).toBe(137);
    });
});
