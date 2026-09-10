/**
 * Padding — the other half of "make this exactly 600 by 750".
 *
 * There are only two honest ways to put a picture of one shape into a box of
 * another without distorting it: trim what does not fit, or add something that
 * does. lib/image-client/crop.js owns the first. This owns the second, and it
 * is a separate file for the same reason the crop is: it is a pixel operation
 * with one job, no options and no opinion about which of the two a caller
 * wants.
 *
 * THE FILL IS OPAQUE, ALWAYS, AND THAT IS A PRODUCT DECISION
 *
 * A transparent margin would be the "lossless" choice and it is the wrong one
 * here. The only reason to pad is that a form asked for an exact box, and the
 * forms that ask for an exact box are printing the result or flattening it onto
 * white on the far side. A PNG whose margins are transparent looks correct in a
 * browser and prints as whatever the printer's default happens to be — which is
 * the failure this padding exists to prevent. So the canvas is filled with the
 * background at full alpha and the picture is copied on top of it, its own alpha
 * intact. lib/image-client/flatten.js then composites the picture's own
 * transparency onto the same colour when the format cannot carry it, so the
 * margin and the interior agree whichever format is being written.
 *
 * A PICTURE LARGER THAN ITS CANVAS IS A CALLER BUG, NOT A CROP
 *
 * Silently trimming the overflow here would make a `contain` behave like a
 * `cover` for exactly the inputs where the geometry maths had gone wrong, and
 * the output would be plausible: right dimensions, wrong picture. It throws
 * instead. lib/image-client/requirements.js fitGeometry is what guarantees the
 * resampled size fits, and this is the assertion that keeps it honest.
 */
import { FLATTEN_BACKGROUND } from '@/lib/image-client/flatten';

const TOO_LARGE = 'The image is larger than the canvas it must be padded onto.';

/**
 * Centres an ImageData on a width x height canvas filled with `background`.
 *
 * Returns the SAME object when the image already fills the canvas exactly, the
 * way cropImageData returns its input for a whole-image rectangle: the common
 * case for a `contain` whose source happens to share the target's shape, and a
 * whole extra surface not worth allocating to prove a point.
 *
 * The offsets floor on both axes, which is the convention every centred
 * rectangle in this engine uses (centreCropRect, centeredRectForRatio): an odd
 * remainder leaves the extra pixel on the bottom-right.
 *
 * @param {ImageData} imageData
 * @param {number} width
 * @param {number} height
 * @param {{ r: number, g: number, b: number }} [background]
 * @returns {ImageData}
 */
export function padImageData(imageData, width, height, background = FLATTEN_BACKGROUND) {
    if (!imageData || !imageData.data || !imageData.width || !imageData.height) {
        throw new Error('There are no pixels to pad.');
    }

    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
        throw new Error('Invalid canvas dimensions.');
    }

    if (imageData.width > width || imageData.height > height) {
        throw new Error(TOO_LARGE);
    }

    if (imageData.width === width && imageData.height === height) return imageData;

    const fill = background ?? FLATTEN_BACKGROUND;
    const output = new Uint8ClampedArray(width * height * 4);

    for (let offset = 0; offset < output.length; offset += 4) {
        output[offset] = fill.r;
        output[offset + 1] = fill.g;
        output[offset + 2] = fill.b;
        output[offset + 3] = 255;
    }

    const left = Math.floor((width - imageData.width) / 2);
    const top = Math.floor((height - imageData.height) / 2);

    const sourceStride = imageData.width * 4;
    const destinationStride = width * 4;

    for (let row = 0; row < imageData.height; row += 1) {
        const start = row * sourceStride;
        output.set(
            imageData.data.subarray(start, start + sourceStride),
            (top + row) * destinationStride + left * 4,
        );
    }

    return new ImageData(output, width, height);
}
