/**
 * Crop Rectangle Parsing and Bounds Checking
 */
import { MAX_DIMENSION } from '@/lib/limits';
import { parsePositiveInt, withinPixelBudget } from '@/lib/image/dimensions';

function isPositiveFinite(value) {
    return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function isNonNegativeFinite(value) {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

/**
 * Parses the four crop values (as read from a FormData body). Offsets may be 0,
 * width and height must be at least 1, and all four are strict integers so
 * '10.9' or '100abc' is rejected rather than silently truncated.
 */
export function parseCropParams({ x, y, width, height } = {}) {
    const parsedX = parsePositiveInt(x, { min: 0, max: MAX_DIMENSION });
    const parsedY = parsePositiveInt(y, { min: 0, max: MAX_DIMENSION });
    const parsedWidth = parsePositiveInt(width, { min: 1, max: MAX_DIMENSION });
    const parsedHeight = parsePositiveInt(height, { min: 1, max: MAX_DIMENSION });

    if (parsedX.absent || parsedY.absent || parsedWidth.absent || parsedHeight.absent) {
        return { ok: false, error: 'Missing crop parameters (crop_x, crop_y, crop_width, crop_height).' };
    }

    if (!parsedX.ok || !parsedY.ok || !parsedWidth.ok || !parsedHeight.ok) {
        return { ok: false, error: 'Invalid crop parameters provided.' };
    }

    if (!withinPixelBudget(parsedWidth.value, parsedHeight.value)) {
        return { ok: false, error: 'Crop area exceeds the maximum allowed size.' };
    }

    return {
        ok: true,
        rect: {
            x: parsedX.value,
            y: parsedY.value,
            width: parsedWidth.value,
            height: parsedHeight.value,
        },
    };
}

/**
 * False whenever the rectangle leaves the image — and false when sharp could
 * not resolve the source dimensions, because `n > undefined` is false and used
 * to let an unbounded extract() through as a 500.
 */
export function isCropInBounds(rect, meta) {
    if (!rect || !meta) return false;
    if (!isNonNegativeFinite(rect.x) || !isNonNegativeFinite(rect.y)) return false;
    if (!isPositiveFinite(rect.width) || !isPositiveFinite(rect.height)) return false;
    if (!isPositiveFinite(meta.width) || !isPositiveFinite(meta.height)) return false;

    return rect.x + rect.width <= meta.width && rect.y + rect.height <= meta.height;
}

/**
 * The largest `ratioWidth`:`ratioHeight` rectangle that fits centred inside a
 * `sourceWidth`×`sourceHeight` image, for the /crop aspect-ratio chips.
 *
 * Takes four numbers, never an id — lib/catalog.js's ASPECT_RATIOS stays
 * above this module. Returns the same `{ ok, rect }` shape parseCropParams
 * does, so the result is checkable against isCropInBounds like any other
 * parsed rectangle.
 *
 * resolveCropRect (lib/image-client/crop.js) REJECTS an out-of-bounds
 * rectangle rather than clamping it, so the fit has to happen here, before a
 * chip's numbers ever reach the engine:
 *
 *  - WHICH SIDE IS FIXED is decided with an integer cross-product
 *    (sourceWidth * ratioHeight vs sourceHeight * ratioWidth), never a
 *    float division. Anchoring to the source width and deriving the height
 *    (or the reverse, picked by which axis happens to be larger) overflows
 *    the other axis on most sources — a 1200×800 source asked for 1:1 that
 *    way derives an 1200×1200 rectangle, taller than the source it came
 *    from. The cross-product picks the constrained axis correctly every
 *    time: the derived side is guaranteed, by the inequality itself, not to
 *    exceed the source before it is even rounded.
 *  - THE DERIVED SIDE IS ROUNDED, NOT FLOORED, then clamped to
 *    [1, sourceDimension]. A floored side degenerates to 0 wherever the
 *    exact quotient is under 1 — every non-square ratio on a 1×1 source, or
 *    any source with a side of 1 (1×8000 at 4:3 floors to 1×0). Rounding
 *    keeps the result at the nearest whole pixel instead, and the
 *    Math.max(1, …) floor is a backstop for the cases even rounding would
 *    zero out.
 *  - A SOURCE ALREADY EXACTLY THE RATIO derives a side equal to the other
 *    source dimension with no rounding error (the divisions the ruling's
 *    examples exercise — 1920×1080 at 16:9, 1080×1350 at 4:5, 4032×3024 at
 *    4:3 — are IEEE-exact), so the rectangle comes out as the whole image,
 *    x=0, y=0, which is what lets cropImageData's identity fast path return
 *    the source untouched instead of re-copying it for nothing.
 *  - CENTRING floors the offset on both axes — `Math.floor((dimension -
 *    rectDimension) / 2)` — the same expression lib/image-client/resize.js's
 *    centreCropRect uses for VIPS_INTERESTING_CENTRE, so an odd remainder
 *    lands the extra pixel bottom-right on every centred crop in this
 *    codebase, not a second convention invented for chips.
 *
 * @param {number} sourceWidth
 * @param {number} sourceHeight
 * @param {number} ratioWidth
 * @param {number} ratioHeight
 * @returns {{ ok: true, rect: { x, y, width, height } }|{ ok: false, error: string }}
 */
export function centeredRectForRatio(sourceWidth, sourceHeight, ratioWidth, ratioHeight) {
    if (!isPositiveFinite(sourceWidth) || !isPositiveFinite(sourceHeight)
        || !isPositiveFinite(ratioWidth) || !isPositiveFinite(ratioHeight)) {
        return { ok: false, error: 'Invalid aspect ratio parameters provided.' };
    }

    const width = Math.round(sourceWidth);
    const height = Math.round(sourceHeight);

    let rectWidth;
    let rectHeight;

    if (width * ratioHeight <= height * ratioWidth) {
        // The full source width, scaled to the ratio, is no taller than the
        // source — fix the width and derive the height.
        rectWidth = width;
        rectHeight = Math.max(1, Math.min(height, Math.round((width * ratioHeight) / ratioWidth)));
    } else {
        // The reverse: fix the height and derive the width.
        rectHeight = height;
        rectWidth = Math.max(1, Math.min(width, Math.round((height * ratioWidth) / ratioHeight)));
    }

    return {
        ok: true,
        rect: {
            x: Math.floor((width - rectWidth) / 2),
            y: Math.floor((height - rectHeight) / 2),
            width: rectWidth,
            height: rectHeight,
        },
    };
}
