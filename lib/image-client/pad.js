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
 * THE FILL IS OPAQUE UNLESS THE CALLER SAYS OTHERWISE, AND THE DEFAULT IS A
 * PRODUCT DECISION
 *
 * For a printed photo a transparent margin would be the "lossless" choice and
 * it is the wrong one. The reason to pad there is that a form asked for an
 * exact box, and the forms that ask for an exact box are printing the result or
 * flattening it onto white on the far side. A PNG whose margins are transparent
 * looks correct in a browser and prints as whatever the printer's default
 * happens to be — which is the failure that padding exists to prevent. So the
 * canvas is filled at full alpha unless a caller states an alpha of its own,
 * and the picture is copied on top of it with its own alpha intact.
 * lib/image-client/flatten.js then composites the picture's own transparency
 * onto the same colour when the format cannot carry it, so the margin and the
 * interior agree whichever format is being written.
 *
 * THE ONE CALLER THAT STATES AN ALPHA IS THE FAVICON PACKAGE
 *
 * An app icon fitted inside a square is the opposite case: the margin is not
 * paper, it is the part of the icon a launcher draws its own background behind,
 * and a visitor who chose "Transparent" means the corners. That is a single
 * optional `a` on the background rather than a second padding function,
 * because every other question — where the picture sits, what happens when it
 * is larger than the canvas, which pixel the odd remainder goes to — has one
 * answer and needs exactly one implementation.
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
 * @param {{ r: number, g: number, b: number, a?: number }} [background] `a`
 *        defaults to 255 — an absent alpha means an opaque margin, which is
 *        what every caller but the favicon package wants.
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
    const alpha = Number.isFinite(fill.a) ? fill.a : 255;
    const output = new Uint8ClampedArray(width * height * 4);

    for (let offset = 0; offset < output.length; offset += 4) {
        output[offset] = fill.r;
        output[offset + 1] = fill.g;
        output[offset + 2] = fill.b;
        output[offset + 3] = alpha;
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
