/**
 * Crop Rectangle Parsing and Bounds Checking
 */
import { MAX_DIMENSION } from '@/lib/constants';
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
