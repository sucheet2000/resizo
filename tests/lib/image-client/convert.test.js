/**
 * /convert in the browser engine.
 *
 * Three questions, in order of how badly getting them wrong would hurt:
 *
 *  1. Does every surviving pair actually round-trip? A conversion that returns
 *     JPEG bytes under an image/webp type is worse than one that fails.
 *  2. Does a transparent source come out flattened onto BLACK? This is the one
 *     place the browser build silently disagreed with the sharp one it
 *     replaced: libvips composites the alpha onto black, MozJPEG ignores the
 *     alpha byte entirely, so the same PNG came out BLACK through sharp and
 *     WHITE in the tab. /png-to-jpg tells people in as many words that the fill
 *     is black, so this is a claim the page makes and not merely an internal
 *     agreement. sharp is kept below as an INDEPENDENT reference for what
 *     libvips does — it is a fixture and checking tool, never on the path under
 *     test, and it no longer has a route behind it.
 *  3. Does a pair the browser cannot do refuse cleanly and in words a person
 *     can act on? There is nowhere to fall back to, so the refusal is the
 *     whole answer.
 *
 * WHY THE PAIRS ARE COMPUTED AND NOT LISTED
 *
 * lib/limits.js is the registry, and AVIF is leaving it in both directions:
 * there is no AVIF decoder available in this build and the encoder costs 823 KB
 * of download and 15-30 seconds an image on a phone. So the pairs under test are
 * derived from the registry rather than typed out — this file needs no edit when
 * that lands, and if it were typed out it would be one more place still claiming
 * AVIF works.
 *
 * sharp appears here only as a fixture tool and as the reference implementation
 * to compare against. It is not on the path under test.
 */
import sharp from 'sharp';
import { beforeAll, describe, expect, it } from 'vitest';

import { CONVERT_INPUT_FORMATS, CONVERT_OUTPUT_FORMATS, DEFAULT_QUALITY } from '@/lib/limits';
import { sniffImageType } from '@/lib/image/magic-bytes';
// A plain list of strings, so it can be read before installBrowserEnv() has run
// and the pairs below can be built at module scope. Everything that touches a
// codec is imported inside beforeAll, after the WASM fetch shim exists.
import { BROWSER_OUTPUT_FORMATS } from '@/lib/image-client/encode';
import { installBrowserEnv } from './helpers/browser-env';

/**
 * What a browser build can actually decode, from the WASM_DECODERS table in
 * lib/image-client/decode.js. Node has no createImageBitmap, so these tests
 * exercise the WASM route, which is also the route a browser falls back to.
 */
const DECODABLE = ['jpeg', 'png', 'webp'];

/**
 * The libvips reference encode, written out here rather than imported.
 *
 * It used to be lib/image/pipeline.js's applyOutputFormat, shared with the
 * routes. The routes are gone and so is that module, and re-creating it in
 * lib/ purely so a test could import it would be a production file that exists
 * for a test. So the four lines live in the file that needs them, where they
 * are plainly a reference implementation and not a second engine.
 *
 * `.rotate()` matters: it bakes EXIF Orientation into the pixels, which is what
 * lib/image-client/orientation.js does for the browser engine. Without it the
 * reference and the engine would disagree about any tagged fixture.
 */
function encodeWithSharp(pipeline, format) {
    switch (format) {
        case 'png':
            return pipeline.png({ compressionLevel: 9 });
        case 'webp':
            return pipeline.webp({ quality: DEFAULT_QUALITY });
        case 'jpeg':
        default:
            return pipeline.jpeg({ quality: DEFAULT_QUALITY });
    }
}

let runOperation;
let JobError;
let flattenImageData;

beforeAll(async () => {
    installBrowserEnv();
    ({ runOperation, JobError } = await import('@/lib/image-client/operations'));
    ({ flattenImageData } = await import('@/lib/image-client/flatten'));
});

/* ------------------------------------------------------------------ *
 * Fixtures
 * ------------------------------------------------------------------ */

const WIDTH = 48;
const HEIGHT = 32;

/** A flat block of one RGBA colour, in the given container format. */
async function source(format, [r, g, b, a] = [200, 40, 80, 255]) {
    const raw = Buffer.alloc(WIDTH * HEIGHT * 4);
    for (let index = 0; index < WIDTH * HEIGHT; index += 1) {
        raw[index * 4] = r;
        raw[index * 4 + 1] = g;
        raw[index * 4 + 2] = b;
        raw[index * 4 + 3] = a;
    }

    const pipeline = sharp(raw, { raw: { width: WIDTH, height: HEIGHT, channels: 4 } });
    const bytes = await encodeWithSharp(pipeline, format).toBuffer();
    return new File([bytes], `fixture.${format}`, { type: `image/${format}` });
}

async function convert(file, format) {
    return runOperation('convert', file, {
        format,
        sourceWidth: WIDTH,
        sourceHeight: HEIGHT,
    });
}

async function bytesOf(result) {
    return Buffer.from(await result.blob.arrayBuffer());
}

/** The mean RGB of the top-left pixel, read back through sharp. */
async function firstPixel(buffer) {
    const { data } = await sharp(buffer).raw().toBuffer({ resolveWithObject: true });
    return [data[0], data[1], data[2]];
}

/* ------------------------------------------------------------------ *
 * Round trips
 * ------------------------------------------------------------------ */

const PAIRS = CONVERT_INPUT_FORMATS
    .filter((from) => DECODABLE.includes(from))
    .flatMap((from) => CONVERT_OUTPUT_FORMATS
        .filter((to) => BROWSER_OUTPUT_FORMATS.includes(to))
        .map((to) => [from, to]));

describe('every surviving pair converts on the device', () => {
    it('covers all three formats in both directions', () => {
        // Nine pairs, not eight: converting a JPEG to a JPEG is a re-encode the
        // route has always allowed, and the engine must not special-case it.
        expect(PAIRS).toHaveLength(9);
        expect(PAIRS.map(([from, to]) => `${from}->${to}`)).toContain('png->jpeg');
        expect(PAIRS.map(([from, to]) => `${from}->${to}`)).toContain('webp->png');
    });

    it.each(PAIRS)('%s -> %s', async (from, to) => {
        const result = await convert(await source(from), to);
        const bytes = await bytesOf(result);

        // The bytes are what they claim to be, checked at the signature rather
        // than at the Content-Type the engine wrote next to them.
        expect(sniffImageType(bytes.subarray(0, 16))).toBe(to);
        expect(result.format).toBe(to);
        expect(result.blob.type).toBe(`image/${to}`);

        // A conversion changes the container, never the picture's size.
        expect(result.width).toBe(WIDTH);
        expect(result.height).toBe(HEIGHT);

        const meta = await sharp(bytes).metadata();
        expect(meta.width).toBe(WIDTH);
        expect(meta.height).toBe(HEIGHT);

        expect(result.filename).toBe(`resizo-converted-fixture.${to === 'jpeg' ? 'jpg' : to}`);
        expect(result.sourceFormat).toBe(from);
    });

    it('does not quantise a PNG on the way out, unlike /compress', async () => {
        const result = await convert(await source('png'), 'png');
        const meta = await sharp(await bytesOf(result)).metadata();

        expect(meta.paletteBitDepth).toBeUndefined();
        expect(result.qualityApplied).toBe(false);
    });
});

/* ------------------------------------------------------------------ *
 * Transparency
 * ------------------------------------------------------------------ */

/** The same conversion, done by libvips instead of by the engine under test. */
async function referenceConvert(file, format) {
    const buffer = Buffer.from(await file.arrayBuffer());
    return encodeWithSharp(sharp(buffer).rotate(), format).toBuffer();
}

describe('a transparent source converted to JPEG', () => {
    const HALF_RED = [255, 0, 0, 128];
    const CLEAR_WHITE = [255, 255, 255, 0];

    it('lands on the same background libvips uses, not on white', async () => {
        const file = await source('png', HALF_RED);

        const [engine, reference] = await Promise.all([
            convert(file, 'jpeg').then(bytesOf),
            referenceConvert(file, 'jpeg'),
        ]);

        const [enginePixel, referencePixel] = await Promise.all([firstPixel(engine), firstPixel(reference)]);

        // Half red over black is 128, and that is what sharp returns. Ignoring
        // the alpha byte — which is what MozJPEG does unless the pixels are
        // composited first — would return 255 here.
        expect(referencePixel[0]).toBeGreaterThan(120);
        expect(referencePixel[0]).toBeLessThan(136);

        for (let channel = 0; channel < 3; channel += 1) {
            expect(Math.abs(enginePixel[channel] - referencePixel[channel])).toBeLessThanOrEqual(3);
        }
    });

    it('fills a fully transparent pixel with black, as libvips does', async () => {
        const file = await source('png', CLEAR_WHITE);

        const [engine, reference] = await Promise.all([
            convert(file, 'jpeg').then(bytesOf),
            referenceConvert(file, 'jpeg'),
        ]);

        const [enginePixel, referencePixel] = await Promise.all([firstPixel(engine), firstPixel(reference)]);

        // Black, and black on purpose: /png-to-jpg tells people in as many words
        // that the fill is black. A build that returned white here would be
        // making the page copy false, which is why this asserts the colour and
        // not merely that the two agree.
        for (const pixel of [enginePixel, referencePixel]) {
            expect(pixel[0]).toBeLessThan(8);
            expect(pixel[1]).toBeLessThan(8);
            expect(pixel[2]).toBeLessThan(8);
        }

        expect(Math.abs(enginePixel[0] - referencePixel[0])).toBeLessThanOrEqual(3);
    });

    it('reaches the encoder already flattened, with no alpha left to drop', async () => {
        // The parity above could in principle be reached by luck on a flat
        // fixture. This is the mechanism: the same arithmetic libvips does.
        const image = { data: new Uint8ClampedArray([255, 0, 0, 128, 0, 255, 0, 64]), width: 2, height: 1 };
        const flat = flattenImageData(image);

        expect(Array.from(flat.data)).toEqual([128, 0, 0, 255, 0, 64, 0, 255]);
    });

    it('keeps the alpha channel when the target format has one', async () => {
        const file = await source('png', HALF_RED);

        for (const format of ['png', 'webp']) {
            const bytes = await bytesOf(await convert(file, format));
            const meta = await sharp(bytes).metadata();
            expect(meta.hasAlpha, `${format} lost its alpha channel`).toBe(true);

            const { data } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
            expect(Math.abs(data[3] - 128), `${format} changed the alpha value`).toBeLessThanOrEqual(2);
        }
    });

    it('leaves a fully opaque image untouched rather than copying it', async () => {
        const image = { data: new Uint8ClampedArray([9, 9, 9, 255]), width: 1, height: 1 };
        expect(flattenImageData(image)).toBe(image);
    });
});

/* ------------------------------------------------------------------ *
 * What the browser cannot do
 * ------------------------------------------------------------------ */

describe('a pair this build cannot do refuses instead of guessing', () => {
    it('refuses an output format with no encoder, before spending a decode on it', async () => {
        // Empty once AVIF leaves CONVERT_OUTPUT_FORMATS, which is the point: the
        // list is the registry's, not this file's.
        const unencodable = CONVERT_OUTPUT_FORMATS.filter((format) => !BROWSER_OUTPUT_FORMATS.includes(format));

        for (const format of unencodable) {
            const failure = await convert(await source('png'), format).catch((error) => error);
            expect(failure).toBeInstanceOf(JobError);
            expect(failure.code).toBe('unsupported-output');
            expect(failure.suggestion).toBeTruthy();
        }
    });

    it('refuses an input format with no decoder rather than guessing at it', async () => {
        const undecodable = CONVERT_INPUT_FORMATS.filter((format) => !DECODABLE.includes(format));

        for (const format of undecodable) {
            const bytes = await encodeWithSharp(
                sharp({ create: { width: WIDTH, height: HEIGHT, channels: 3, background: '#c82850' } }),
                format,
            ).toBuffer();
            const file = new File([bytes], `fixture.${format}`, { type: `image/${format}` });

            await expect(convert(file, 'jpeg')).rejects.toThrow();
        }
    });

    it('names the registry rather than a hard-coded list when the target is not a format at all', async () => {
        const failure = await convert(await source('png'), 'tiff').catch((error) => error);

        expect(failure.code).toBe('invalid-format');
        for (const format of CONVERT_OUTPUT_FORMATS) {
            expect(failure.message).toContain(format);
        }
        expect(failure.message).not.toContain('tiff');
    });
});
