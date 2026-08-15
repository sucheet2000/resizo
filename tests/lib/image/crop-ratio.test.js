/**
 * The aspect-ratio chips: every ratio against every awkward source.
 *
 * A chip is the one control on /crop that puts four numbers into the form
 * without the visitor typing them, so it is the one place where the rectangle
 * can be wrong in a way nobody sees until the download is open. This file is
 * the cross-product sweep: each entry of ASPECT_RATIOS against a table of
 * sources chosen to break a naive fit, checked THROUGH resolveCropRect — the
 * same function lib/image-client/operations.js runs before it slices pixels —
 * rather than against an inequality re-derived here. A test that re-derives the
 * formula agrees with the implementation by construction and proves nothing;
 * the engine accepting the rectangle is the property that matters.
 *
 * FOUR CLAUSES PER CASE, and none of the four is redundant:
 *
 *  1. THE ENGINE ACCEPTS IT, UNCHANGED. resolveCropRect refuses an
 *     out-of-bounds rectangle rather than clamping it (that is the whole point
 *     of lib/image-client/crop.js), so a chip that overflows by one pixel is a
 *     dead button with an error under it. `toEqual` on the whole result also
 *     catches a rectangle the parser would silently rewrite.
 *
 *  2. IT IS MAXIMAL — one pixel wider, with the partner side recomputed from
 *     the ratio, must no longer fit; likewise one pixel taller. Without this a
 *     preset that returned 1×1 for everything would satisfy every other clause
 *     in this file. The comparison is integer cross-multiplication, never a
 *     float division, so "the partner side" is exact.
 *
 *  3. IT IS THE REQUESTED SHAPE. Clause 2 on its own is satisfied by an
 *     implementation that returns the WHOLE SOURCE every time — one pixel wider
 *     than the source does not fit either — which is exactly the bug a chip row
 *     regresses into when someone "simplifies" the fit. So the rectangle's own
 *     cross-product must match the ratio's to within one rounding step,
 *     `max(ratioWidth, ratioHeight)`: the derived side is `Math.round`ed, and
 *     rounding moves the cross-product by at most one whole unit of the fixed
 *     side's ratio term.
 *
 *  4. IT IS CENTRED, floor-biased: `Math.floor((source - side) / 2)` on both
 *     axes, the same expression lib/image-client/resize.js's centreCropRect
 *     uses, so an odd remainder lands the spare pixel bottom-right everywhere
 *     in this codebase rather than one way here and the other way there.
 *
 * And separately, because a clause hidden behind an `if` inside a parametrised
 * case can stop firing without anyone noticing: a source ALREADY exactly the
 * ratio returns exactly the whole image at 0,0. That is what lets
 * cropImageData's identity fast path hand the surface back instead of copying
 * every row into a second buffer of the same size, which is asserted here
 * against cropImageData itself rather than inferred from the coordinates.
 *
 * THE SELF-CHECK COMES FIRST. An empty ASPECT_RATIOS, or a case list built from
 * a table that stopped being crossed with anything, sweeps nothing and passes.
 * The first describe asserts the sweep is actually the size it claims to be.
 */
import { describe, expect, it } from 'vitest';

import { ASPECT_RATIOS } from '@/lib/catalog';
import { cropImageData, resolveCropRect } from '@/lib/image-client/crop';
import { centeredRectForRatio } from '@/lib/image/crop';
import { MAX_DIMENSION } from '@/lib/limits';

import { installBrowserEnv } from '../image-client/helpers/browser-env';

installBrowserEnv();

/**
 * Sources chosen because each one breaks a different naive fit: a phone photo
 * and its portrait twin, the laptop screenshot that is famously NOT 16:9,
 * two odd-by-odd sources so the centring remainder is never zero, a source
 * that is exactly 3:2 (so an identity case rides inside the shared table too),
 * and the three degenerate shapes where a floored derived side collapses to 0.
 */
const AWKWARD_SOURCES = [
    [4032, 3024],
    [3000, 4000],
    [1366, 768],
    [1023, 767],
    [999, 501],
    [1200, 800],
    [1, 1],
    [1, MAX_DIMENSION],
    [MAX_DIMENSION, 1],
];

/**
 * Each ratio also gets its own exact-fit source and that source ±1 on each
 * axis — the four rectangles either side of the identity case, where an
 * off-by-one in the branch choice shows up as a whole extra pixel row.
 */
const EXACT_FIT_SCALE = 120;
const NEIGHBOURS_PER_RATIO = 5;

function neighbourhood({ ratioWidth, ratioHeight }) {
    const width = ratioWidth * EXACT_FIT_SCALE;
    const height = ratioHeight * EXACT_FIT_SCALE;
    return [
        [width, height],
        [width + 1, height],
        [width - 1, height],
        [width, height + 1],
        [width, height - 1],
    ];
}

const CASES = ASPECT_RATIOS.flatMap((ratio) =>
    [...AWKWARD_SOURCES, ...neighbourhood(ratio)].map(([sourceWidth, sourceHeight]) => [
        `${ratio.ratio} on ${sourceWidth}×${sourceHeight}`,
        sourceWidth,
        sourceHeight,
        ratio,
    ]),
);

/** True when the source is already exactly this ratio, by integer cross-product. */
function isExactlyRatio(sourceWidth, sourceHeight, { ratioWidth, ratioHeight }) {
    return sourceWidth * ratioHeight === sourceHeight * ratioWidth;
}

const EXACT_CASES = CASES.filter(([, width, height, ratio]) => isExactlyRatio(width, height, ratio));
const INEXACT_CASES = CASES.filter(([, width, height, ratio]) => !isExactlyRatio(width, height, ratio));

/**
 * Does a rectangle of exactly ratioWidth:ratioHeight and this width fit inside
 * the source? The partner height is `width * ratioHeight / ratioWidth`, and
 * comparing it by cross-multiplication keeps the whole test in integers — a
 * float partner would make the maximality clause depend on rounding, which is
 * the very thing it is meant to police.
 */
function widthFits(width, sourceWidth, sourceHeight, { ratioWidth, ratioHeight }) {
    return width <= sourceWidth && width * ratioHeight <= sourceHeight * ratioWidth;
}

/** The mirror: a rectangle of this height, with the width derived from the ratio. */
function heightFits(height, sourceWidth, sourceHeight, { ratioWidth, ratioHeight }) {
    return height <= sourceHeight && height * ratioWidth <= sourceWidth * ratioHeight;
}

describe('the sweep itself covers something', () => {
    it('has presets to sweep', () => {
        expect(ASPECT_RATIOS.length).toBeGreaterThan(0);
        expect(AWKWARD_SOURCES.length).toBeGreaterThan(0);
    });

    it('runs the full cross-product, one case per preset per source', () => {
        expect(CASES).toHaveLength(
            ASPECT_RATIOS.length * (AWKWARD_SOURCES.length + NEIGHBOURS_PER_RATIO),
        );
        expect(new Set(CASES.map(([, , , ratio]) => ratio.id)).size).toBe(ASPECT_RATIOS.length);
    });

    it('covers both sides of the identity split', () => {
        // Every preset contributes at least its own exact-fit source, so the
        // identity clause below can never be vacuous.
        expect(EXACT_CASES.length).toBeGreaterThanOrEqual(ASPECT_RATIOS.length);
        expect(INEXACT_CASES.length).toBeGreaterThan(0);
        expect(EXACT_CASES.length + INEXACT_CASES.length).toBe(CASES.length);
    });
});

describe('every chip fits every source', () => {
    it.each(CASES)('%s', (_label, sourceWidth, sourceHeight, ratio) => {
        const fitted = centeredRectForRatio(sourceWidth, sourceHeight, ratio.ratioWidth, ratio.ratioHeight);
        expect(fitted.ok, fitted.error).toBe(true);

        // 1. Through the engine's own gate, not a re-derived inequality.
        const resolved = resolveCropRect(fitted.rect, { sourceWidth, sourceHeight });
        expect(
            resolved,
            'the engine refused or rewrote a rectangle a chip put in the form',
        ).toEqual({ ok: true, rect: fitted.rect });

        const { rect } = resolved;

        // 2. Maximal: neither axis can grow by a pixel and still fit.
        expect(
            widthFits(rect.width + 1, sourceWidth, sourceHeight, ratio),
            'a wider rectangle of the same ratio still fits — the chip is not the largest one',
        ).toBe(false);
        expect(
            heightFits(rect.height + 1, sourceWidth, sourceHeight, ratio),
            'a taller rectangle of the same ratio still fits — the chip is not the largest one',
        ).toBe(false);

        // 3. Actually the requested shape. Clause 2 alone is satisfied by
        //    returning the whole source, which is not a crop at all.
        expect(
            Math.abs(rect.width * ratio.ratioHeight - rect.height * ratio.ratioWidth),
            `${rect.width}×${rect.height} is not ${ratio.ratio}`,
        ).toBeLessThanOrEqual(Math.max(ratio.ratioWidth, ratio.ratioHeight));

        // 4. Centred, spare pixel bottom-right.
        expect(rect.x).toBe(Math.floor((sourceWidth - rect.width) / 2));
        expect(rect.y).toBe(Math.floor((sourceHeight - rect.height) / 2));
    });
});

describe('a source already exactly the ratio is kept whole', () => {
    it.each(EXACT_CASES)('%s takes the whole image', (_label, sourceWidth, sourceHeight, ratio) => {
        const fitted = centeredRectForRatio(sourceWidth, sourceHeight, ratio.ratioWidth, ratio.ratioHeight);

        expect(fitted).toEqual({
            ok: true,
            rect: { x: 0, y: 0, width: sourceWidth, height: sourceHeight },
        });
    });

    /**
     * The reason the clause above is worth its own describe: an identity
     * rectangle is what lets the slicer return the surface it was handed
     * instead of copying every row into a second buffer of the same size. A
     * rectangle one pixel short of the source would still be "correct" and
     * would quietly double the peak memory of a no-op crop.
     */
    it.each(ASPECT_RATIOS.map((ratio) => [ratio.ratio, ratio]))(
        '%s hits the slicer identity fast path',
        (_label, ratio) => {
            const width = ratio.ratioWidth * 8;
            const height = ratio.ratioHeight * 8;
            const source = new ImageData(new Uint8ClampedArray(width * height * 4), width, height);

            const fitted = centeredRectForRatio(width, height, ratio.ratioWidth, ratio.ratioHeight);

            expect(cropImageData(source, fitted.rect)).toBe(source);
        },
    );
});

describe('centeredRectForRatio refuses what it cannot fit', () => {
    const INVALID = 'Invalid aspect ratio parameters provided.';

    it.each([
        ['a zero source width', [0, 800, 1, 1]],
        ['a zero source height', [1200, 0, 1, 1]],
        ['a negative source width', [-1200, 800, 1, 1]],
        ['a negative source height', [1200, -800, 1, 1]],
        ['a NaN source width', [NaN, 800, 1, 1]],
        ['an Infinity source height', [1200, Infinity, 1, 1]],
        ['string source dimensions', ['1200', '800', 1, 1]],
        ['undefined source dimensions', [undefined, undefined, 1, 1]],
        ['no arguments at all', []],
        ['a zero ratio width', [1200, 800, 0, 1]],
        ['a zero ratio height', [1200, 800, 1, 0]],
        ['a negative ratio side', [1200, 800, -4, 3]],
        ['a NaN ratio side', [1200, 800, 4, NaN]],
        ['string ratio sides', [1200, 800, '4', '3']],
        ['a null ratio side', [1200, 800, 4, null]],
    ])('rejects %s', (_label, args) => {
        expect(centeredRectForRatio(...args)).toEqual({ ok: false, error: INVALID });
    });

    it('does not throw on hostile input', () => {
        expect(() => centeredRectForRatio({}, [], Symbol('w'), () => {})).not.toThrow();
    });

    /**
     * A measured source arrives from `naturalWidth`, which is an integer — but
     * a fractional one must not produce a fractional rectangle, because
     * parseCropParams rejects a decimal outright and the chip would become a
     * dead button rather than a slightly-off crop.
     */
    it('rounds a fractional source rather than emitting a fractional rectangle', () => {
        const { rect } = centeredRectForRatio(1200.4, 800.6, 1, 1);

        for (const value of Object.values(rect)) {
            expect(Number.isInteger(value)).toBe(true);
        }
        expect(resolveCropRect(rect, { sourceWidth: 1200, sourceHeight: 801 }).ok).toBe(true);
    });
});

/**
 * The three shapes where a floored derived side would be 0, spelled out
 * separately from the sweep because the numbers are the point: a rectangle of
 * zero width is not a small crop, it is a rejected job (parseCropParams demands
 * min 1) and, further down, an encoder error.
 */
describe('a source with a one-pixel side still yields a usable rectangle', () => {
    it.each([
        ['1×1 at 16:9', 1, 1, 16, 9, { x: 0, y: 0, width: 1, height: 1 }],
        ['1×1 at 9:16', 1, 1, 9, 16, { x: 0, y: 0, width: 1, height: 1 }],
        ['1×8000 at 4:3', 1, 8000, 4, 3, { x: 0, y: 3999, width: 1, height: 1 }],
        ['8000×1 at 4:3', 8000, 1, 4, 3, { x: 3999, y: 0, width: 1, height: 1 }],
        ['1×8000 at 9:16', 1, 8000, 9, 16, { x: 0, y: 3999, width: 1, height: 2 }],
    ])('%s', (_label, sourceWidth, sourceHeight, ratioWidth, ratioHeight, expected) => {
        expect(centeredRectForRatio(sourceWidth, sourceHeight, ratioWidth, ratioHeight))
            .toEqual({ ok: true, rect: expected });
    });
});

/**
 * THE ROUNDING DIRECTION, PINNED EXACTLY.
 *
 * The reviewer's finding, and the weakest part of this change on the record:
 * mutating the derived side from Math.round to Math.floor left 152 of 153
 * tests green. The sweep above cannot see it — its maximality clause compares
 * against the exact ratio partner, so a side one pixel short still passes, and
 * its shape tolerance of max(ratioWidth, ratioHeight) swallows a whole
 * rounding step.
 *
 * So "the largest rectangle of that shape that fits" was pinned only to within
 * a pixel on every ordinary source. These cases are chosen so the exact derived
 * side lands on .5 — the one place round and floor disagree — and they are
 * written as literal expected numbers rather than derived, so the test cannot
 * agree with a wrong implementation by sharing its arithmetic.
 *
 * Rounding is not cosmetic here: flooring is what degenerates a side to zero on
 * a source with a 1-pixel axis, which is why the implementation rounds.
 */
describe('the derived side rounds, and that is load-bearing', () => {
    it.each([
        // source        ratio    exact      round  (floor would give)
        [1000, 1000, 16, 9, 1000, 563, 562.5],
        [4000, 3000, 9, 16, 1688, 3000, 1687.5],
        [999, 999, 3, 2, 999, 666, 666.0],
        [101, 101, 16, 9, 101, 57, 56.8125],
    ])('%ix%i at %i:%i', (sw, sh, rw, rh, expectedWidth, expectedHeight) => {
        const { ok, rect } = centeredRectForRatio(sw, sh, rw, rh);

        expect(ok).toBe(true);
        expect(
            [rect.width, rect.height],
            'the derived side moved by a pixel — check the rounding, not the branch',
        ).toEqual([expectedWidth, expectedHeight]);
    });

    it('never rounds a side past the source it came from', () => {
        // Rounding up is only safe because the exact value already fits; this
        // is the property that makes round preferable to ceil.
        for (const [sw, sh] of [[1000, 1000], [4000, 3000], [999, 999], [101, 101], [7, 3]]) {
            for (const { ratioWidth, ratioHeight } of ASPECT_RATIOS) {
                const { rect } = centeredRectForRatio(sw, sh, ratioWidth, ratioHeight);
                expect(rect.width).toBeLessThanOrEqual(sw);
                expect(rect.height).toBeLessThanOrEqual(sh);
            }
        }
    });
});
