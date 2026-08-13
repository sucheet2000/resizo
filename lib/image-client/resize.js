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
 * upscale and any environment without createImageBitmap/OffscreenCanvas.
 *
 * NOTHING IN THIS ENGINE RESAMPLES TO A SIZE OFF THE SOURCE'S RATIO. A request
 * for both a width and a height is served the way sharp serves it — scale to
 * cover the box, then crop the overflow away — so `resizeWidth`/`resizeHeight`,
 * which stretch to whatever box they are handed, are only ever handed a box
 * that preserves the shape. See coverDimensions below.
 *
 * The bounds maths is not re-derived here. MAX_DIMENSION, MAX_PIXELS,
 * withinPixelBudget and scaleDimensions are the same helpers the server routes
 * use, so a target the server would have refused is refused here identically.
 */
import { MAX_DIMENSION } from '@/lib/limits';
import { explicitTargetDimensions, scaleDimensions, withinPixelBudget } from '@/lib/image/dimensions';
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
 * Neither half of the arithmetic lives here any more. A percent delegates to
 * scaleDimensions and an explicit target to explicitTargetDimensions, both in
 * lib/image/dimensions.js, which is the module the routes parse with as well.
 * This function is now only the fork between the two, kept because it is the
 * shape lib/image-client/operations.js reads.
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

    return explicitTargetDimensions(sourceWidth, sourceHeight, { width, height });
}

/**
 * The marker a two-sided request carries, and what it means.
 *
 * A request with BOTH a width and a height reaches sharp as
 * `resize({ width, height })`, whose default fit is 'cover' and whose default
 * position is centre: libvips scales the image until it FILLS the box, keeping
 * the shape, and trims the overflow off the two opposite edges evenly. It does
 * NOT stretch, which is what this engine used to do — same output dimensions,
 * different picture, and a distorted face passes every dimension test there is.
 *
 * Single-side and percentage requests carry no marker because there is nothing
 * to trim: the size they ask for is already on the source's own ratio, and both
 * builds simply resample to it.
 */
export const FIT_COVER = 'cover';

/**
 * The size to resample to before cropping, for a cover request.
 *
 * The scale is the LARGER of the two ratios — the one that leaves neither side
 * short — and the rounding is Math.round on both, which is what libvips does
 * with its own shrink factor. Math.max against the target is a floor, not a
 * correction: rounding down by one on the side that set the scale would leave a
 * crop that cannot be satisfied.
 *
 * Verified in pixels in tests/lib/image-client/resize-cover.test.js: for
 * 200x100 asked for 50x50 this returns 100x50, and the pixels of a
 * scale-then-centre-extract at those numbers match what
 * `sharp().resize({ width: 50, height: 50 })` emits.
 */
export function coverDimensions(sourceWidth, sourceHeight, targetWidth, targetHeight) {
    if (!isPositiveFinite(sourceWidth) || !isPositiveFinite(sourceHeight)
        || !isPositiveFinite(targetWidth) || !isPositiveFinite(targetHeight)) {
        return { width: targetWidth, height: targetHeight };
    }

    const scale = Math.max(targetWidth / sourceWidth, targetHeight / sourceHeight);

    return {
        width: Math.max(targetWidth, Math.round(sourceWidth * scale)),
        height: Math.max(targetHeight, Math.round(sourceHeight * scale)),
    };
}

/**
 * The rectangle a centred crop takes out of an image of this size.
 *
 * The offsets floor rather than round, matching libvips' integer division for
 * VIPS_INTERESTING_CENTRE: an odd overhang leaves the extra pixel on the
 * bottom-right, and that choice is visible one pixel at a time on any crop
 * where the overhang is odd.
 *
 * The size is clamped so a target larger than the image cannot produce a
 * rectangle that leaves it — cropImageData refuses one of those outright.
 */
export function centreCropRect(width, height, targetWidth, targetHeight) {
    const cropWidth = Math.min(width, targetWidth);
    const cropHeight = Math.min(height, targetHeight);

    return {
        x: Math.floor((width - cropWidth) / 2),
        y: Math.floor((height - cropHeight) / 2),
        width: cropWidth,
        height: cropHeight,
    };
}

/**
 * The size the resampler should be asked for, given a target.
 *
 * For a cover request that is the covering size, which is BIGGER than the
 * output on one axis — the difference is what the crop then removes. For
 * everything else it is the target itself. Every caller that is about to
 * allocate or resample goes through here, so no path can reach the resampler
 * with the un-covered numbers.
 */
export function resampleSize(sourceWidth, sourceHeight, target) {
    if (!target) return null;
    if (target.fit !== FIT_COVER) return { width: target.width, height: target.height };
    return coverDimensions(sourceWidth, sourceHeight, target.width, target.height);
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
