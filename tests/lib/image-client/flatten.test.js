/**
 * The two predicates in lib/image-client/flatten.js.
 *
 * `flattenImageData` is well covered by tests/lib/image-client/convert.test.js,
 * which compares its output against what libvips does for the same PNG. The two
 * functions that decide WHETHER it runs were not tested by anything, and both
 * are cheap to get subtly wrong:
 *
 *   formatKeepsAlpha  decides whether a transparent pixel is composited at all.
 *                     Wrong in one direction, a PNG loses its transparency; wrong
 *                     in the other, a JPEG comes back WHITE where the server
 *                     returned BLACK, because MozJPEG reads RGBA as RGBX and
 *                     ignores the alpha byte entirely.
 *
 *   hasTransparency   decides whether a whole extra 48 MB surface is allocated
 *                     for a 12 MP photo. A false negative silently skips the
 *                     compositing; a false positive costs the memory the gate
 *                     was never asked about.
 *
 * The scanning one is the interesting half: it walks the alpha byte of every
 * pixel from offset 3 in steps of 4, and a fixture whose only non-opaque pixel
 * is the very first or the very last is the one that catches an off-by-one.
 */
import { beforeAll, describe, expect, it } from 'vitest';

import { installBrowserEnv } from './helpers/browser-env';
import { makeImageData } from './helpers/fixtures';

let flattenImageData;
let formatKeepsAlpha;
let hasTransparency;
let ALPHA_OUTPUT_FORMATS;
let FLATTEN_BACKGROUND;
let parseBackground;
let BACKGROUND_PRESETS;

beforeAll(async () => {
    installBrowserEnv();
    ({
        flattenImageData,
        formatKeepsAlpha,
        hasTransparency,
        ALPHA_OUTPUT_FORMATS,
        FLATTEN_BACKGROUND,
        parseBackground,
        BACKGROUND_PRESETS,
    } = await import('@/lib/image-client/flatten'));
});

/* ------------------------------------------------------------------ *
 * Which formats carry an alpha channel
 * ------------------------------------------------------------------ */

describe('whether a format can store transparency', () => {
    it.each(['png', 'webp'])('%s keeps it', (format) => {
        expect(formatKeepsAlpha(format)).toBe(true);
    });

    it('jpeg does not, which is the whole reason this module exists', () => {
        expect(formatKeepsAlpha('jpeg')).toBe(false);
    });

    /** It normalises through the encoder's own naming, so the aliases work too. */
    it.each([
        ['PNG', true],
        ['image/png', true],
        ['WebP', true],
        ['jpg', false],
        ['image/jpeg', false],
    ])('reads %s as %s', (format, keeps) => {
        expect(formatKeepsAlpha(format)).toBe(keeps);
    });

    it.each([
        ['a format with no encoder here', 'avif'],
        ['a document', 'pdf'],
        ['null', null],
        ['undefined', undefined],
        ['an empty string', ''],
        ['a number', 42],
    ])('says no for %s rather than throwing', (_label, format) => {
        expect(formatKeepsAlpha(format)).toBe(false);
    });

    it('is read off the list rather than a second hard-coded pair', () => {
        expect(ALPHA_OUTPUT_FORMATS).toEqual(['png', 'webp']);
        for (const format of ALPHA_OUTPUT_FORMATS) {
            expect(formatKeepsAlpha(format)).toBe(true);
        }
    });
});

/* ------------------------------------------------------------------ *
 * Whether there is anything to flatten
 * ------------------------------------------------------------------ */

describe('spotting a pixel that is not fully opaque', () => {
    const opaque = (width = 4, height = 4) => makeImageData(width, height, () => [10, 20, 30, 255]);

    it('says no for a fully opaque image', () => {
        expect(hasTransparency(opaque())).toBe(false);
    });

    it('says yes for an image that is transparent throughout', () => {
        expect(hasTransparency(makeImageData(4, 4, () => [10, 20, 30, 0]))).toBe(true);
    });

    /** The first pixel's alpha is at offset 3, which is where the scan starts. */
    it('spots it when only the FIRST pixel is not opaque', () => {
        const pixels = opaque();
        pixels.data[3] = 254;

        expect(hasTransparency(pixels)).toBe(true);
    });

    /** The last pixel's alpha is the final byte, which an off-by-one skips. */
    it('spots it when only the LAST pixel is not opaque', () => {
        const pixels = opaque();
        pixels.data[pixels.data.length - 1] = 254;

        expect(hasTransparency(pixels)).toBe(true);
    });

    it('spots a single almost-opaque pixel in the middle', () => {
        const pixels = opaque(8, 8);
        pixels.data[(8 * 3 + 4) * 4 + 3] = 200;

        expect(hasTransparency(pixels)).toBe(true);
    });

    /**
     * It reads the ALPHA byte and not a colour one. A scan that walked from
     * offset 0 would call this fully-opaque black image transparent.
     */
    it('is not fooled by a colour channel that happens to be zero', () => {
        expect(hasTransparency(makeImageData(4, 4, () => [0, 0, 0, 255]))).toBe(false);
    });

    it.each([
        ['null', null],
        ['undefined', undefined],
        ['an object with no data', {}],
        ['data of null', { data: null }],
    ])('says no for %s rather than throwing', (_label, input) => {
        expect(hasTransparency(input)).toBe(false);
    });
});

/* ------------------------------------------------------------------ *
 * The cheap path, and the refusal
 * ------------------------------------------------------------------ */

describe('flattening only when there is something to flatten', () => {
    /**
     * Most conversions are photographs with no alpha at all, and a whole extra
     * surface on a 12 MP image is 48 MB the memory gate was never asked about.
     * So the opaque case returns the SAME object, not a copy.
     */
    it('hands back the very same object when nothing is transparent', () => {
        const pixels = makeImageData(4, 4, () => [1, 2, 3, 255]);

        expect(flattenImageData(pixels)).toBe(pixels);
    });

    it('returns a new surface when there is alpha to composite', () => {
        const pixels = makeImageData(4, 4, () => [255, 0, 0, 128]);
        const flattened = flattenImageData(pixels);

        expect(flattened).not.toBe(pixels);
        expect(flattened.width).toBe(4);
        expect(flattened.height).toBe(4);
    });

    /** Black, because that is what libvips uses when no background is given. */
    it('composites onto the same background the server always used', () => {
        expect(FLATTEN_BACKGROUND).toEqual({ r: 0, g: 0, b: 0 });

        const clear = flattenImageData(makeImageData(2, 2, () => [255, 255, 255, 0]));

        expect(Array.from(clear.data.slice(0, 4))).toEqual([0, 0, 0, 255]);
    });

    it('leaves every output pixel opaque, whatever went in', () => {
        const flattened = flattenImageData(makeImageData(4, 4, (x) => [200, 40, 80, x * 60]));

        for (let offset = 3; offset < flattened.data.length; offset += 4) {
            expect(flattened.data[offset]).toBe(255);
        }
    });

    it.each([
        ['null', null],
        ['an empty object', {}],
        ['a zero-width image', { data: new Uint8ClampedArray(4), width: 0, height: 1 }],
        ['a zero-height image', { data: new Uint8ClampedArray(4), width: 1, height: 0 }],
    ])('refuses %s in words rather than crashing on a null read', (_label, input) => {
        expect(() => flattenImageData(input)).toThrow('There are no pixels to flatten.');
    });
});

/**
 * WHICH COLOUR A TRANSPARENT PIXEL LANDS ON IS A PRODUCT DECISION, NOT A
 * LIBRARY DEFAULT.
 *
 * Black is what libvips does with no background given, so it stays the default
 * — the pages that promise black stay true, and the sharp reference the suite
 * measures against keeps agreeing with us. But black is the wrong answer for a
 * logo or a flat graphic, which is most of what /png-to-jpg actually receives,
 * and the visitor is the only one who knows which they have.
 *
 * Parsing is deliberately strict: an unparseable value falls back to the
 * default rather than throwing, because a bad colour is not a reason to refuse
 * someone's photo — but it must never silently become a DIFFERENT colour.
 */
describe('choosing the colour a transparent pixel lands on', () => {
    it('defaults to black, which is what libvips does', () => {
        expect(parseBackground(undefined)).toEqual({ r: 0, g: 0, b: 0 });
        expect(parseBackground(null)).toEqual(FLATTEN_BACKGROUND);
    });

    it('takes the two named colours people actually want', () => {
        expect(parseBackground('white')).toEqual({ r: 255, g: 255, b: 255 });
        expect(parseBackground('black')).toEqual({ r: 0, g: 0, b: 0 });
    });

    it('takes a hex colour, long or short, with or without the hash', () => {
        expect(parseBackground('#ff0000')).toEqual({ r: 255, g: 0, b: 0 });
        expect(parseBackground('00ff00')).toEqual({ r: 0, g: 255, b: 0 });
        expect(parseBackground('#abc')).toEqual({ r: 170, g: 187, b: 204 });
    });

    it('ignores case and surrounding space', () => {
        expect(parseBackground('  #FFFFFF  ')).toEqual({ r: 255, g: 255, b: 255 });
        expect(parseBackground('WHITE')).toEqual({ r: 255, g: 255, b: 255 });
    });

    it('falls back to the default rather than inventing a colour', () => {
        for (const bad of ['', 'chartreuse', '#12', '#1234567', 'rgb(1,2,3)', '#gggggg', 42, {}]) {
            expect(parseBackground(bad), `${JSON.stringify(bad)} produced a colour`).toEqual(FLATTEN_BACKGROUND);
        }
    });

    it('offers the presets the UI shows, with the default first', () => {
        expect(BACKGROUND_PRESETS.map((preset) => preset.value)).toEqual(['black', 'white']);
    });
});

describe('flattening onto a chosen colour', () => {
    it('composites a half-transparent red onto white', () => {
        const image = makeImageData(2, 2, () => [255, 0, 0, 128]);
        const flat = flattenImageData(image, parseBackground('white'));

        // 255*128/255 + 255*127/255 = 128 + 127 = 255 on red; the other two
        // channels get only the background's contribution.
        expect(Array.from(flat.data.slice(0, 4))).toEqual([255, 127, 127, 255]);
    });

    it('leaves an opaque pixel alone whatever the background', () => {
        const image = makeImageData(2, 2, () => [10, 20, 30, 255]);
        const flat = flattenImageData(image, parseBackground('white'));

        expect(flat).toBe(image);
    });

    it('still composites onto black when nothing is chosen', () => {
        const image = makeImageData(2, 2, () => [255, 0, 0, 128]);

        expect(Array.from(flattenImageData(image).data.slice(0, 4))).toEqual([128, 0, 0, 255]);
    });
});
