/**
 * Cropping
 *
 * A crop is the one operation where the numbers come from the user's mouse, so
 * it is also the one where "trust nothing" matters most: a rectangle that
 * leaves the image is not a clamp-and-carry-on, it is a refusal. The server
 * learned that the hard way — `n > undefined` is false, so an unresolved source
 * width used to let an unbounded extract() through as a 500.
 *
 * NOTHING IS RE-DERIVED HERE. parseCropParams and isCropInBounds in
 * lib/image/crop.js are the validation, and this module only adds the two
 * things the crop route used to get from sharp: the ordering of those two
 * checks, and the actual pixel slice.
 *
 * COORDINATES ARE SOURCE-IMAGE PIXELS. Not CSS pixels, not preview pixels, not
 * a fraction of the displayed box. Whatever the crop UI is dragging on screen,
 * it must convert to full-resolution image pixels before it gets here — which
 * is what the server contract already was, since sharp's extract() takes source
 * pixels too.
 */
import { isCropInBounds, parseCropParams } from '@/lib/image/crop';

const OUT_OF_BOUNDS = 'Crop parameters are out of bounds of the original image dimensions.';

/**
 * Parses the four crop values and checks them against the real image.
 *
 * The two stages stay separate on purpose and run in this order: a malformed
 * value ("100abc", a negative, a width of 0) is a different complaint from a
 * well-formed rectangle that hangs off the edge, and the user can only act on
 * the right one.
 *
 * @param {{ x: *, y: *, width: *, height: * }} input   strings or numbers
 * @param {{ sourceWidth: number, sourceHeight: number }} bounds
 * @returns {{ ok: true, rect: { x, y, width, height } }|{ ok: false, error: string }}
 */
export function resolveCropRect(input, { sourceWidth, sourceHeight } = {}) {
    const parsed = parseCropParams(input);
    if (!parsed.ok) return parsed;

    if (!isCropInBounds(parsed.rect, { width: sourceWidth, height: sourceHeight })) {
        return { ok: false, error: OUT_OF_BOUNDS };
    }

    return parsed;
}

/**
 * Slices a rectangle out of an ImageData, row by row.
 *
 * A row copy rather than a canvas round trip. drawImage + getImageData would be
 * shorter, but it puts the pixels through the canvas colour space and its
 * premultiplied-alpha handling, and a crop must return the source bytes
 * unchanged — the same pixels, fewer of them. This also keeps the peak at one
 * source surface plus one (always smaller) destination, which is under the
 * decode stage the memory gate already costed.
 *
 * @param {ImageData} imageData
 * @param {{ x: number, y: number, width: number, height: number }} rect
 * @returns {ImageData}
 */
export function cropImageData(imageData, rect) {
    if (!imageData || !imageData.data || !imageData.width || !imageData.height) {
        throw new Error('There are no pixels to crop.');
    }

    if (!isCropInBounds(rect, { width: imageData.width, height: imageData.height })) {
        throw new Error(OUT_OF_BOUNDS);
    }

    const { x, y, width, height } = rect;

    if (x === 0 && y === 0 && width === imageData.width && height === imageData.height) {
        return imageData;
    }

    const sourceStride = imageData.width * 4;
    const destinationStride = width * 4;
    const output = new Uint8ClampedArray(width * height * 4);

    for (let row = 0; row < height; row += 1) {
        const start = (y + row) * sourceStride + x * 4;
        output.set(imageData.data.subarray(start, start + destinationStride), row * destinationStride);
    }

    return new ImageData(output, width, height);
}
