/**
 * Resampling
 *
 * Two ways to make an image smaller, and the rule for choosing between them.
 *
 * The browser's own path — createImageBitmap with `resizeWidth` and
 * `resizeQuality: 'high'` — decodes AND downscales a 12 MP JPEG in 110 ms.
 * @jsquash/resize's lanczos3 takes 1700 ms on the same image. That is not a
 * close call, so the native path is the default and this module is the
 * fallback: it exists for the cases the browser cannot serve, which are an
 * upscale, a stretch that ignores the source ratio, and any environment
 * without createImageBitmap/OffscreenCanvas.
 *
 * The bounds maths is not re-derived here. MAX_DIMENSION, MAX_PIXELS,
 * withinPixelBudget and scaleDimensions are the same helpers the server routes
 * use, so a target the server would have refused is refused here identically.
 */
import { MAX_DIMENSION } from '@/lib/constants';
import { scaleDimensions, withinPixelBudget } from '@/lib/image/dimensions';
import { nativeDownscaleSupported } from '@/lib/image-client/capability';
import { loadResizer } from '@/lib/image-client/codecs';

/**
 * lanczos3 is the closest match to sharp's default resize kernel, which is also
 * Lanczos 3. Keeping them the same is what stops the browser build from
 * producing visibly different edges to the server build during the changeover.
 */
export const RESIZE_METHOD = 'lanczos3';

function isPositiveFinite(value) {
    return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

/**
 * The dimensions an image should end up at, given whichever of width, height
 * and scalePercent the caller supplied.
 *
 * One side alone means "keep the shape" — the other is derived from the source
 * ratio, which is the aspect-ratio lock every tool page offers. Both sides mean
 * exactly that, stretch included. A percent delegates to scaleDimensions so the
 * rounding and the clamping match the server byte for byte.
 *
 * @returns {{ ok: true, width: number, height: number }|{ ok: false, error: string }}
 */
export function targetDimensions(sourceWidth, sourceHeight, { width = null, height = null, scalePercent = null } = {}) {
    if (!isPositiveFinite(sourceWidth) || !isPositiveFinite(sourceHeight)) {
        return { ok: false, error: 'Unable to determine the source image dimensions.' };
    }

    if (scalePercent !== null) {
        return scaleDimensions(sourceWidth, sourceHeight, scalePercent);
    }

    const hasWidth = isPositiveFinite(width);
    const hasHeight = isPositiveFinite(height);

    if (!hasWidth && !hasHeight) {
        return { ok: false, error: 'Provide a width, a height or a scale.' };
    }

    const outWidth = hasWidth
        ? Math.round(width)
        : Math.max(1, Math.round((sourceWidth / sourceHeight) * height));
    const outHeight = hasHeight
        ? Math.round(height)
        : Math.max(1, Math.round((sourceHeight / sourceWidth) * width));

    if (outWidth > MAX_DIMENSION || outHeight > MAX_DIMENSION) {
        return { ok: false, error: 'Dimensions exceed maximum allowed values.' };
    }
    if (!withinPixelBudget(outWidth, outHeight)) {
        return { ok: false, error: 'Dimensions exceed maximum allowed values.' };
    }

    return { ok: true, width: outWidth, height: outHeight };
}

/**
 * The largest size that fits inside a box without changing the shape, never
 * upscaling. `changed` is false when the image already fits, which is the
 * caller's signal to skip the resampling stage entirely.
 */
export function fitWithin(sourceWidth, sourceHeight, maxWidth = null, maxHeight = null) {
    if (!isPositiveFinite(sourceWidth) || !isPositiveFinite(sourceHeight)) {
        return { width: sourceWidth, height: sourceHeight, changed: false };
    }

    const widthRatio = isPositiveFinite(maxWidth) ? maxWidth / sourceWidth : 1;
    const heightRatio = isPositiveFinite(maxHeight) ? maxHeight / sourceHeight : 1;
    const ratio = Math.min(1, widthRatio, heightRatio);

    if (ratio >= 1) return { width: sourceWidth, height: sourceHeight, changed: false };

    return {
        width: Math.max(1, Math.round(sourceWidth * ratio)),
        height: Math.max(1, Math.round(sourceHeight * ratio)),
        changed: true,
    };
}

/**
 * Whether the 110 ms native path could have done this job, so a caller that
 * reached for the 1700 ms WASM resizer can be told it did not have to.
 *
 * Native resizing is downscale-only here on purpose: createImageBitmap will
 * happily enlarge, but its upscaling filter is the browser's, not Lanczos, and
 * an enlargement is the one case where the slow, better resampler earns its
 * time.
 */
export function canUseNativeDownscale({ sourceWidth, sourceHeight, width, height } = {}) {
    if (!nativeDownscaleSupported()) return false;
    if (!isPositiveFinite(sourceWidth) || !isPositiveFinite(sourceHeight)) return false;
    if (!isPositiveFinite(width) || !isPositiveFinite(height)) return false;
    return width <= sourceWidth && height <= sourceHeight;
}

/**
 * Resamples an ImageData with @jsquash/resize.
 *
 * `premultiply` and `linearRGB` are the package defaults and are stated
 * explicitly because they are what keep a transparent PNG's edges from
 * darkening and what makes the downscale gamma-correct. Turning either off
 * changes the pixels.
 *
 * @returns {Promise<{ data: ImageData, width: number, height: number, viaNative: false }>}
 */
export async function resizeImageData(imageData, { width, height, method = RESIZE_METHOD, premultiply = true, linearRGB = true } = {}) {
    if (!imageData || !isPositiveFinite(imageData.width) || !isPositiveFinite(imageData.height)) {
        return Promise.reject(new Error('Unable to determine the source image dimensions.'));
    }

    if (!isPositiveFinite(width) || !isPositiveFinite(height)) {
        return Promise.reject(new Error('Invalid resize dimensions.'));
    }

    if (width > MAX_DIMENSION || height > MAX_DIMENSION || !withinPixelBudget(width, height)) {
        return Promise.reject(new Error('Dimensions exceed maximum allowed values.'));
    }

    if (width === imageData.width && height === imageData.height) {
        return { data: imageData, width, height, viaNative: false };
    }

    const resize = await loadResizer();
    const output = await resize(imageData, { width, height, method, premultiply, linearRGB });

    return { data: output, width: output.width, height: output.height, viaNative: false };
}
