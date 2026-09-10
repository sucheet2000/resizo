/**
 * /convert in the browser engine.
 *
 * Three questions, in order of how badly getting them wrong would hurt:
 *
 *  1. Does every surviving pair actually round-trip? A conversion that returns
 *     JPEG bytes under an image/webp type is worse than one that fails.
 *  2. Does a transparent source come out flattened onto the colour the page
 *     promises? MozJPEG ignores the alpha byte entirely, so without an explicit
 *     compositing step the fill colour is never applied at all and the JPEG
 *     carries whatever the hidden colour channels held. The default is WHITE —
 *     chosen for the logos and signatures this route actually receives, rather
 *     than inherited from what libvips does with no background given — and
 *     /png-to-jpg says so in as many words, so this is a claim the page makes
 *     and not merely an internal agreement. sharp is kept below as an
 *     INDEPENDENT reference for what libvips does, which is now the oracle for
 *     the CHOSEN black; it is a fixture and checking tool, never on the path
 *     under test, and it no longer has a route behind it.
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

async function convert(file, format, background) {
    return runOperation('convert', file, {
        format,
        sourceWidth: WIDTH,
        sourceHeight: HEIGHT,
        ...(background === undefined ? {} : { background }),
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

/**
 * A colour, within what a JPEG encode moves it. The fixtures are flat blocks,
 * so the only drift is the codec's own rounding; a fill that landed on the
 * wrong colour is out by tens or by hundreds, never by three.
 */
function expectPixelNear(pixel, expected, label, tolerance = 3) {
    for (let channel = 0; channel < 3; channel += 1) {
        expect(
            Math.abs(pixel[channel] - expected[channel]),
            `${label}: channel ${channel} was ${pixel[channel]}, expected about ${expected[channel]} (read ${pixel.join(',')})`,
        ).toBeLessThanOrEqual(tolerance);
    }
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

/**
 * THE DEFAULT IS WHITE, AND THAT IS NOT WHAT LIBVIPS DOES.
 *
 * libvips composites onto black when no background is given, and for as long as
 * a sharp route existed that inherited default was the product's answer. It was
 * never chosen for anybody. What arrives at /png-to-jpg is overwhelmingly a
 * logo, a signature or a cut-out headed for a document or a form, and those sit
 * on a white page; black is what a missing alpha channel looks like when it has
 * gone wrong. So the engine's default is white and the pages say so.
 *
 * The libvips reference is still here and still valuable — it is now the oracle
 * for the CHOSEN black, which is the arithmetic that must not drift.
 */
describe('a transparent source converted to JPEG', () => {
    const HALF_RED = [255, 0, 0, 128];
    const CLEAR_WHITE = [255, 255, 255, 0];
    const CLEAR_BLACK = [0, 0, 0, 0];

    /** Every fill, whatever the colour, has to produce a real opaque JPEG. */
    async function expectOpaqueJpeg(bytes) {
        expect(sniffImageType(bytes.subarray(0, 16))).toBe('jpeg');

        const meta = await sharp(bytes).metadata();
        expect(meta.format).toBe('jpeg');
        expect(meta.hasAlpha).toBe(false);
        expect(meta.width).toBe(WIDTH);
        expect(meta.height).toBe(HEIGHT);
    }

    it('fills a fully transparent pixel with white when nothing is chosen', async () => {
        // CLEAR_BLACK, deliberately: a clear WHITE pixel would come back white
        // even if the flattening never ran, because MozJPEG reads RGBA as RGBX
        // and would keep the hidden 255s. Clear BLACK can only be white here if
        // the compositing actually happened on white.
        const bytes = await convert(await source('png', CLEAR_BLACK), 'jpeg').then(bytesOf);

        await expectOpaqueJpeg(bytes);
        expectPixelNear(await firstPixel(bytes), [255, 255, 255], 'the default fill');
    });

    it('composites a half-transparent pixel onto white rather than dropping the alpha', async () => {
        const bytes = await convert(await source('png', HALF_RED), 'jpeg').then(bytesOf);

        // Half red over white: the red channel saturates and the other two
        // carry only the background's contribution. Ignoring the alpha byte
        // would return 255,0,0 — the difference this whole module exists for.
        await expectOpaqueJpeg(bytes);
        expectPixelNear(await firstPixel(bytes), [255, 127, 127], 'a half-transparent pixel');
    });

    it('honours a chosen black, and that is where libvips still agrees', async () => {
        const file = await source('png', HALF_RED);

        const [engine, reference] = await Promise.all([
            convert(file, 'jpeg', 'black').then(bytesOf),
            referenceConvert(file, 'jpeg'),
        ]);

        const [enginePixel, referencePixel] = await Promise.all([firstPixel(engine), firstPixel(reference)]);

        // Half red over black is 128, and that is what sharp returns with no
        // background given. The engine reaches it by being told to.
        expect(referencePixel[0]).toBeGreaterThan(120);
        expect(referencePixel[0]).toBeLessThan(136);

        await expectOpaqueJpeg(engine);
        for (let channel = 0; channel < 3; channel += 1) {
            expect(Math.abs(enginePixel[channel] - referencePixel[channel])).toBeLessThanOrEqual(3);
        }
    });

    it('fills a fully transparent pixel with black when black is chosen', async () => {
        const bytes = await convert(await source('png', CLEAR_WHITE), 'jpeg', 'black').then(bytesOf);

        await expectOpaqueJpeg(bytes);
        expectPixelNear(await firstPixel(bytes), [0, 0, 0], 'a chosen black');
    });

    it('fills a fully transparent pixel with a custom hex', async () => {
        const bytes = await convert(await source('png', CLEAR_WHITE), 'jpeg', '#ff0000').then(bytesOf);

        await expectOpaqueJpeg(bytes);
        expectPixelNear(await firstPixel(bytes), [255, 0, 0], 'a custom hex');
    });

    it('reaches the encoder already flattened, with no alpha left to drop', async () => {
        // The parity above could in principle be reached by luck on a flat
        // fixture. This is the mechanism: straight alpha compositing, now onto
        // white rather than onto the colour libvips happened to default to.
        const image = { data: new Uint8ClampedArray([255, 0, 0, 128, 0, 255, 0, 64]), width: 2, height: 1 };
        const flat = flattenImageData(image);

        expect(Array.from(flat.data)).toEqual([255, 127, 127, 255, 191, 255, 191, 255]);
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

/* ------------------------------------------------------------------ *
 * Quality
 * ------------------------------------------------------------------ */

/**
 * A deterministic noise field, because a flat block is the same size at every
 * quality setting and would prove nothing about the dial. The pattern is
 * generated from the pixel index rather than from Math.random, so a failure
 * here reproduces exactly.
 */
async function noisySource(format) {
    const raw = Buffer.alloc(WIDTH * HEIGHT * 4);
    for (let index = 0; index < WIDTH * HEIGHT; index += 1) {
        raw[index * 4] = (index * 37) % 256;
        raw[index * 4 + 1] = (index * 91) % 256;
        raw[index * 4 + 2] = (index * 173) % 256;
        raw[index * 4 + 3] = 255;
    }

    const pipeline = sharp(raw, { raw: { width: WIDTH, height: HEIGHT, channels: 4 } });
    const bytes = await encodeWithSharp(pipeline, format).toBuffer();
    return new File([bytes], `noise.${format}`, { type: `image/${format}` });
}

function convertAt(file, format, quality) {
    return runOperation('convert', file, {
        format,
        sourceWidth: WIDTH,
        sourceHeight: HEIGHT,
        ...(quality === undefined ? {} : { quality }),
    });
}

/**
 * THE BULK CONVERTER NEEDS A DIAL, AND /convert HAD NONE.
 *
 * The single-file route always encoded at DEFAULT_QUALITY, which is the right
 * answer for one picture somebody is looking at. A folder of forty photos is a
 * different question — the whole reason for converting them at once is usually
 * size — so the option is read here, through the same strict parser every other
 * op uses, and absent still means the default.
 */
describe('the quality option', () => {
    it.each(['jpeg', 'webp'])('writes a smaller %s at 30 than at 95', async (format) => {
        const file = await noisySource('png');

        const low = await convertAt(file, format, 30);
        const high = await convertAt(file, format, 95);

        expect(low.blob.size, `${format} ignored its quality`).toBeLessThan(high.blob.size);
        expect(low.qualityApplied).toBe(true);
    });

    it('encodes at the engine default when no quality is given', async () => {
        const file = await noisySource('png');

        const implied = await bytesOf(await convertAt(file, 'jpeg'));
        const stated = await bytesOf(await convertAt(file, 'jpeg', DEFAULT_QUALITY));

        expect(implied.equals(stated)).toBe(true);
    });

    it('is ignored by PNG, which is lossless and has no dial at all', async () => {
        const file = await noisySource('png');

        const low = await bytesOf(await convertAt(file, 'png', 10));
        const high = await bytesOf(await convertAt(file, 'png', 100));

        expect(low.equals(high)).toBe(true);
    });

    it('refuses a quality that is not a whole number between 1 and 100', async () => {
        const file = await source('png');

        for (const quality of ['0', '101', '80.5', 'high', '']) {
            const failure = await convertAt(file, 'jpeg', quality).catch((error) => error);

            expect(failure, `accepted ${JSON.stringify(quality)}`).toBeInstanceOf(JobError);
            expect(failure.code).toBe('invalid-quality');
        }
    });
});
