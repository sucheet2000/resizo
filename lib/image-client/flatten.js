/**
 * Flattening — what happens to transparency when the output format has none.
 *
 * JPEG has no alpha channel. Something has to be decided about a transparent
 * pixel on the way out, and the two builds have to decide it the same way or
 * the same PNG comes back looking different depending on which lane ran.
 *
 * WHAT THE SHARP BUILD DID, MEASURED
 *
 * Neither the convert route nor the pipeline it called set a background. That is not the same as "nothing happens": libvips flattens an
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
 * 255,255,255. Left alone the fill colour is never applied at all: the JPEG
 * comes back carrying whatever the hidden colour channels happened to hold, so
 * one transparent PNG lands on white and the next on black with nothing to
 * explain the difference. So the pixels are composited here, before the encoder
 * sees them, onto a colour this file names.
 *
 * WHY THE DEFAULT IS WHITE AND NOT THE COLOUR ABOVE
 *
 * Black was never chosen for anybody. It is what libvips reaches for when no
 * background is given, and for as long as a sharp route existed that inherited
 * default was the product's answer by accident. The colour is a product
 * decision, so it is made here rather than borrowed.
 *
 * White is the right one. What arrives at /png-to-jpg is overwhelmingly a logo,
 * a signature or a cut-out on its way into a document, a form or a slide, and
 * all of those sit on a white page — a white fill is invisible there, which is
 * what somebody filling in a form wants. Black is what a missing alpha channel
 * looks like when it has gone wrong, and a visitor who sees their mark on a
 * black rectangle reads it as the tool breaking rather than as a choice.
 *
 * Black keeps its place in the list, one click away, because a white logo or a
 * screenshot of a dark interface genuinely wants it.
 */
import { normaliseFormat } from '@/lib/image-client/encode';

/**
 * The colour a transparent pixel is composited onto when nothing is chosen.
 * White — see the note above; every operation that falls back to this default
 * flattens on white, and the pages say so in as many words.
 */
export const FLATTEN_BACKGROUND = { r: 255, g: 255, b: 255 };

/**
 * The two the panel offers, DEFAULT FIRST. The order is load-bearing: the panel
 * renders this list, and the custom picker seeds itself from the white entry.
 */
export const BACKGROUND_PRESETS = [
    { value: 'white', label: 'White', hex: '#ffffff' },
    { value: 'black', label: 'Black', hex: '#000000' },
];

const NAMED_BACKGROUNDS = {
    black: { r: 0, g: 0, b: 0 },
    white: { r: 255, g: 255, b: 255 },
};

const SHORT_HEX = /^#?([0-9a-f])([0-9a-f])([0-9a-f])$/;
const LONG_HEX = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/;

/**
 * A background colour from whatever the page sent, or the default.
 *
 * Deliberately does NOT throw. A colour that cannot be read is not a reason to
 * refuse somebody's photo — but it must never silently become a *different*
 * colour either, so anything unrecognised falls back to the documented default
 * rather than to a guess.
 *
 * @param {string} [value] 'black', 'white', or a 3- or 6-digit hex
 * @returns {{ r: number, g: number, b: number }}
 */
export function parseBackground(value) {
    if (typeof value !== 'string') return FLATTEN_BACKGROUND;

    const text = value.trim().toLowerCase();
    if (text === '') return FLATTEN_BACKGROUND;

    const named = NAMED_BACKGROUNDS[text];
    if (named) return named;

    const long = LONG_HEX.exec(text);
    if (long) {
        return {
            r: Number.parseInt(long[1], 16),
            g: Number.parseInt(long[2], 16),
            b: Number.parseInt(long[3], 16),
        };
    }

    const short = SHORT_HEX.exec(text);
    if (short) {
        // #abc is #aabbcc — each digit doubled, not padded with a zero.
        return {
            r: Number.parseInt(short[1] + short[1], 16),
            g: Number.parseInt(short[2] + short[2], 16),
            b: Number.parseInt(short[3] + short[3], 16),
        };
    }

    return FLATTEN_BACKGROUND;
}

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
