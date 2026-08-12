/**
 * Flattening — what happens to transparency when the output format has none.
 *
 * JPEG has no alpha channel. Something has to be decided about a transparent
 * pixel on the way out, and the two builds have to decide it the same way or
 * the same PNG comes back looking different depending on which lane ran.
 *
 * WHAT THE SERVER DOES, MEASURED
 *
 * app/api/convert/route.js sets no background and lib/image/pipeline.js sets
 * none either. That is not the same as "nothing happens": libvips flattens an
 * image with alpha automatically when the target format cannot carry it, and
 * with no `background` supplied it uses its own default, which is black. So the
 * server's background is real, it is black, and it is inherited rather than
 * chosen. Measured through the shipped sharp 8.18.3 / libvips build, encoding a
 * 64x64 flat PNG to JPEG at quality 80 and reading the pixels back:
 *
 *   rgba(255,0,0,255)      -> 254,0,0     (opaque, unchanged bar JPEG noise)
 *   rgba(255,0,0,128)      -> 128,0,0     (half red over black, not 255)
 *   rgba(255,255,255,0)    -> 0,0,0       (clear white becomes BLACK, not white)
 *   rgba(0,255,0,64)       -> 0,65,1      (quarter green over black)
 *
 * That is straight (unpremultiplied) alpha compositing onto black, not a
 * dropped alpha byte: dropping the byte would have returned 255,0,0 and
 * 255,255,255 for rows two and three.
 *
 * WHY THIS FILE HAS TO EXIST
 *
 * The browser encoder does exactly the thing the server does not. MozJPEG via
 * @jsquash/jpeg reads the RGBA buffer as RGBX and ignores the alpha byte
 * entirely — measured the same way, the same two pixels came back 254,0,0 and
 * 255,255,255. Left alone, a transparent PNG converted to JPEG would come back
 * WHITE in the browser and BLACK on the server for the identical input. So the
 * pixels are composited here, before the encoder sees them, against the same
 * background libvips uses.
 *
 * The colour is stated as a named constant rather than left implicit because it
 * is a product decision that currently belongs to a library default. The page
 * copy already tells people the fill is black (/png-to-jpg says so in as many
 * words); changing it to white is a copy change and an owner's call, not
 * something to slip in behind a conversion.
 */
import { normaliseFormat } from '@/lib/image-client/encode';

/**
 * The colour a transparent pixel is composited onto. Black, because that is
 * what libvips uses when no background is given and what every /convert output
 * has therefore always been.
 */
export const FLATTEN_BACKGROUND = { r: 0, g: 0, b: 0 };

/** The output formats that carry an alpha channel and so need no flattening. */
export const ALPHA_OUTPUT_FORMATS = ['png', 'webp'];

/** True when this format can store transparency, so the pixels pass through. */
export function formatKeepsAlpha(format) {
    return ALPHA_OUTPUT_FORMATS.includes(normaliseFormat(format));
}

/** True when at least one pixel is not fully opaque. */
export function hasTransparency(imageData) {
    const data = imageData?.data;
    if (!data) return false;

    for (let offset = 3; offset < data.length; offset += 4) {
        if (data[offset] !== 255) return true;
    }

    return false;
}

/**
 * Composites an ImageData onto an opaque background.
 *
 * The fully opaque case returns the SAME object rather than a copy — most
 * conversions are photographs with no alpha at all, and a whole extra surface
 * on a 12 MP image is 48 MB the memory gate has not been asked about.
 *
 * @param {ImageData} imageData
 * @param {{ r: number, g: number, b: number }} [background]
 * @returns {ImageData}
 */
export function flattenImageData(imageData, background = FLATTEN_BACKGROUND) {
    if (!imageData || !imageData.data || !imageData.width || !imageData.height) {
        throw new Error('There are no pixels to flatten.');
    }

    if (!hasTransparency(imageData)) return imageData;

    const { data, width, height } = imageData;
    const output = new Uint8ClampedArray(data.length);

    for (let offset = 0; offset < data.length; offset += 4) {
        const alpha = data[offset + 3];

        if (alpha === 255) {
            output[offset] = data[offset];
            output[offset + 1] = data[offset + 1];
            output[offset + 2] = data[offset + 2];
        } else {
            const inverse = 255 - alpha;
            output[offset] = Math.round((data[offset] * alpha + background.r * inverse) / 255);
            output[offset + 1] = Math.round((data[offset + 1] * alpha + background.g * inverse) / 255);
            output[offset + 2] = Math.round((data[offset + 2] * alpha + background.b * inverse) / 255);
        }

        output[offset + 3] = 255;
    }

    return new ImageData(output, width, height);
}
