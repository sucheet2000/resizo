/**
 * AVIF, as properties of the finished file rather than as a list of calls.
 *
 * WHAT THIS SUITE IS FOR. Everywhere else in the engine, "it worked" and "the
 * encoder returned without throwing" are close enough together that one stands
 * in for the other. AVIF is the format where they come apart, in four
 * different directions at once:
 *
 *   the container lies easily     an `image/avif` Content-Type over JPEG bytes
 *                                 is one line of code away, and nothing in a
 *                                 result panel would notice
 *   the alpha is a second image   an AVIF's transparency is a whole separate
 *                                 coded item with its own `av1C`. It is not a
 *                                 channel that comes along for the ride, and
 *                                 "the encoder was given RGBA" does not mean
 *                                 the file has an alpha plane in it
 *   the geometry is stated twice  `ispe` says what is stored and `irot`/`imir`
 *                                 say what to do with it, and a decoder that
 *                                 honours one and a check that reads the other
 *                                 agree until the day they do not
 *   the refusals are the feature  an animated AVIF, a truncated one, and a
 *                                 browser with no AVIF decoder all have to be
 *                                 refused in words, because there is no server
 *                                 to fall back to
 *
 * So every assertion here reads the FILE. The engine's own header reader
 * (`lib/image-client/avif.js`) is never imported: the second opinion is
 * `tests/helpers/avif.js`, written from ISO/IEC 14496-12, ISO/IEC 23008-12 and
 * the AV1 Image File Format, plus sharp — libheif 1.23.1 over aom 3.14.1,
 * which is a different implementation from the libavif the browser encodes
 * with.
 *
 * THE FIRST DESCRIBE PROVES THE CHECKS CAN FAIL. Five files that are wrong in
 * the five ways an AVIF job can be wrong — a JPEG under an .avif name, an
 * "AVIF" holding PNG bytes, a lost alpha plane, the wrong dimensions, a
 * damaged container — are built here and handed to the same assertions the
 * engine's output is judged by. A verification nobody has seen fail is a
 * verification nobody should trust.
 *
 * HOW AN AVIF IS DECODED IN NODE. It is not: the engine decodes AVIF with the
 * browser's own `createImageBitmap` and ships no AVIF decoder, and Node has
 * neither. The AVIF-INPUT tests here install a decoder backed by sharp, in the
 * same shape `tests/lib/image-client/native-lane.test.js` installs one — so
 * what is under test is the engine's orchestration (the refusals, the
 * flattening, the encode, the validation), and the browser's own decode is
 * proved where it actually runs, in tests/e2e/flows/avif.spec.js and the
 * compatibility set. The AVIF-OUTPUT tests install nothing and go through the
 * real WASM lane end to end.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { CONVERT_INPUT_FORMATS, CONVERT_OUTPUT_FORMATS, DEFAULT_QUALITY } from '@/lib/limits';
import { sniffImageType } from '@/lib/image/magic-bytes';
import { assertAvif, parseAvif } from '../../helpers/avif.js';
import {
    addCompatibleBrand, appendMoov, setMajorBrand,
} from '../../helpers/isobmff-edit.js';
import { installBrowserEnv } from './helpers/browser-env';

const FIXTURES = path.join(
    path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'fixtures', 'avif',
);

const committed = (name) => fs.readFileSync(path.join(FIXTURES, name));

const WIDTH = 96;
const HEIGHT = 64;

/** The sentences the plan fixes, quoted rather than matched loosely. */
const ANIMATED_MESSAGE = 'Animated AVIF is not supported yet.';
const DAMAGED_MESSAGE = 'This AVIF file is damaged or incomplete and could not be read.';
const UNSUPPORTED_MESSAGE = 'This browser cannot open AVIF images. Chrome 85, Firefox 93, '
    + 'and Safari 16 on iOS 16 or macOS Ventura and later can.';
const ENCODE_FAILED_MESSAGE = "Resizo couldn't encode this image as AVIF.";

let runOperation;
let JobError;
let AVIF_ENCODE_SPEED;
let QUALITY_FORMATS;

beforeAll(async () => {
    installBrowserEnv();
    ({ runOperation, JobError } = await import('@/lib/image-client/operations'));
    ({ AVIF_ENCODE_SPEED, QUALITY_FORMATS } = await import('@/lib/image-client/encode'));
});

/* ------------------------------------------------------------------ *
 * Fixtures
 * ------------------------------------------------------------------ */

/** Four quadrants and an off-centre block, so a turn or a flip is visible. */
function quadrants(width, height, channels, alphaOf = () => 255) {
    const raw = Buffer.alloc(width * height * channels);
    const colours = [[216, 40, 60], [40, 170, 90], [50, 90, 210], [230, 190, 60]];

    for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
            const quadrant = (y < height / 2 ? 0 : 2) + (x < width / 2 ? 0 : 1);
            const block = x >= 8 && x < 24 && y >= 8 && y < 24;
            const [r, g, b] = block ? [250, 250, 250] : colours[quadrant];
            const at = (y * width + x) * channels;
            raw[at] = r;
            raw[at + 1] = g;
            raw[at + 2] = b;
            if (channels === 4) raw[at + 3] = alphaOf(x, y);
        }
    }

    return raw;
}

const pipeline = (raw, width, height, channels) => sharp(raw, { raw: { width, height, channels } });

/**
 * A transparent source whose CORNER IS CLEAR OVER NOTHING.
 *
 * The same argument `tests/e2e/fixtures/files.js` makes for the transparent
 * PNG: a corner that is clear over white comes back white whether or not the
 * flattening ever ran, because an encoder handed RGBA reads it as RGBX and
 * keeps the hidden 255s. A corner with a colour underneath it can only be the
 * fill.
 */
const CLEAR_MARGIN = 16;
const alphaMask = (x, y) => (
    x >= CLEAR_MARGIN && x < WIDTH - CLEAR_MARGIN && y >= CLEAR_MARGIN && y < HEIGHT - CLEAR_MARGIN ? 255 : 0
);

async function jpegSource() {
    const bytes = await pipeline(quadrants(WIDTH, HEIGHT, 3), WIDTH, HEIGHT, 3).jpeg({ quality: 92 }).toBuffer();
    return new File([bytes], 'photo.jpg', { type: 'image/jpeg' });
}

async function transparentPngSource() {
    const bytes = await pipeline(quadrants(WIDTH, HEIGHT, 4, alphaMask), WIDTH, HEIGHT, 4)
        .png({ compressionLevel: 9 })
        .toBuffer();
    return new File([bytes], 'logo.png', { type: 'image/png' });
}

async function avifBytes({ width = WIDTH, height = HEIGHT, alpha = false, bitdepth = 8 } = {}) {
    const raw = alpha
        ? quadrants(width, height, 4, alphaMask)
        : quadrants(width, height, 3);
    return pipeline(raw, width, height, alpha ? 4 : 3).avif({ quality: 60, bitdepth }).toBuffer();
}

const avifFile = async (options, name = 'photo.avif') => new File(
    [await avifBytes(options)], name, { type: 'image/avif' },
);

const bytesOf = async (result) => Buffer.from(await result.blob.arrayBuffer());

/* ------------------------------------------------------------------ *
 * A decoder for Node — see the note at the top of the file
 * ------------------------------------------------------------------ */

/**
 * `createImageBitmap` and `OffscreenCanvas`, backed by libvips.
 *
 * Installed only by the tests that hand the engine an AVIF, and removed after
 * each one, so the AVIF-OUTPUT tests keep using the real WASM decode lane.
 * It honours `resizeWidth`/`resizeHeight` because `decodeAndDownscale` passes
 * them and a shim that ignored them would quietly make every resize a
 * full-size decode.
 */
function installNativeDecoder() {
    const decoded = [];

    globalThis.createImageBitmap = async (blob, options = {}) => {
        // Recorded BEFORE the decode, not after. A test asserting "the decoder
        // was never asked" has to see the attempt even when the attempt failed,
        // or it passes for a file that reached the decoder and was rejected
        // there — which is the opposite of what it claims.
        decoded.push({ type: blob.type, resize: options.resizeWidth ?? null });
        const bytes = Buffer.from(await blob.arrayBuffer());
        let image = sharp(bytes).ensureAlpha();
        if (options.resizeWidth && options.resizeHeight) {
            image = image.resize(options.resizeWidth, options.resizeHeight, { fit: 'fill' });
        }
        const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });
        return {
            width: info.width,
            height: info.height,
            data: new Uint8ClampedArray(data),
            close() {
                this.width = 0;
                this.height = 0;
            },
        };
    };

    globalThis.OffscreenCanvas = class {
        constructor(width, height) {
            this.width = width;
            this.height = height;
            this.bitmap = null;
        }

        getContext() {
            return {
                drawImage: (bitmap) => { this.bitmap = bitmap; },
                getImageData: (x, y, width, height) => new ImageData(
                    new Uint8ClampedArray(this.bitmap.data), width, height,
                ),
            };
        }
    };

    return decoded;
}

afterEach(() => {
    delete globalThis.createImageBitmap;
    delete globalThis.OffscreenCanvas;
});

const convert = (file, options) => runOperation('convert', file, {
    sourceWidth: WIDTH,
    sourceHeight: HEIGHT,
    ...options,
});

/* ------------------------------------------------------------------ *
 * 1. The checks, proved on files that are wrong on purpose
 * ------------------------------------------------------------------ */

describe('the verification these tests rely on can fail', () => {
    it('rejects JPEG bytes wearing an .avif name', async () => {
        const jpeg = await pipeline(quadrants(WIDTH, HEIGHT, 3), WIDTH, HEIGHT, 3).jpeg().toBuffer();

        expect(() => assertAvif(jpeg, { width: WIDTH, height: HEIGHT })).toThrow(/not an AVIF/i);
        // And the name is worth nothing: the bytes are what is read.
        expect(sniffImageType(jpeg.subarray(0, 16))).toBe('jpeg');
    });

    it('rejects an "AVIF" that is really a PNG', async () => {
        const png = await pipeline(quadrants(WIDTH, HEIGHT, 3), WIDTH, HEIGHT, 3).png().toBuffer();

        expect(() => assertAvif(png, { width: WIDTH, height: HEIGHT })).toThrow(/not an AVIF/i);
    });

    it('rejects a real AVIF whose alpha plane is missing', async () => {
        const bytes = await avifBytes({ alpha: false });

        expect(() => assertAvif(bytes, { width: WIDTH, height: HEIGHT, alpha: true }))
            .toThrow(/transparency did not survive/i);
    });

    it('rejects a real AVIF at the wrong size', async () => {
        const bytes = await avifBytes();

        expect(() => assertAvif(bytes, { width: WIDTH + 1, height: HEIGHT }))
            .toThrow(new RegExp(`${WIDTH} × ${HEIGHT}`));
    });

    it('rejects a damaged container', () => {
        expect(() => parseAvif(committed('truncated.avif'))).toThrow();
        expect(() => parseAvif(committed('garbage-after-ftyp.avif'))).toThrow();
    });

    it('passes a file that is right in every one of those ways', async () => {
        const avif = assertAvif(await avifBytes({ alpha: true }), { width: WIDTH, height: HEIGHT, alpha: true });
        expect(avif.brand).toBe('avif');
    });
});

describe('the committed fixtures still say what their README says', () => {
    it('avis-brand.avif is a still that declares itself a sequence', () => {
        const avif = parseAvif(committed('avis-brand.avif'));

        expect(avif.brand).toBe('avis');
        expect(avif.animated).toBe(true);
        expect(avif.hasMoov).toBe(false);
        expect(avif.primary.ispe).toEqual({ width: 96, height: 64 });
    });

    it('irot-90.avif stores 96 × 64 and decodes to 64 × 96', async () => {
        const bytes = committed('irot-90.avif');
        const avif = parseAvif(bytes);

        expect(avif.rotation).toBe(90);
        expect(avif.primary.ispe).toEqual({ width: 96, height: 64 });

        const decoded = await sharp(bytes).raw().toBuffer({ resolveWithObject: true });
        expect([decoded.info.width, decoded.info.height]).toEqual([64, 96]);
    });

    it('imir.avif carries an axis-1 mirror and keeps its shape', async () => {
        const bytes = committed('imir.avif');

        expect(parseAvif(bytes).mirrorAxis).toBe(1);

        const decoded = await sharp(bytes).raw().toBuffer({ resolveWithObject: true });
        expect([decoded.info.width, decoded.info.height]).toEqual([96, 64]);
    });

    it('truncated.avif has a complete header and an incomplete picture', async () => {
        const bytes = committed('truncated.avif');

        // libvips reads the metadata and then cannot decode it, which is the
        // exact shape that makes this the hardest damaged file to catch.
        await expect(sharp(bytes).metadata()).resolves.toMatchObject({ width: 96, height: 64 });
        await expect(sharp(bytes).raw().toBuffer()).rejects.toThrow();
    });

    it('garbage-after-ftyp.avif still sniffs as an AVIF', () => {
        const bytes = committed('garbage-after-ftyp.avif');

        expect(sniffImageType(bytes.subarray(0, 16))).toBe('avif');
        expect(() => parseAvif(bytes)).toThrow();
    });
});

/* ------------------------------------------------------------------ *
 * 2. The registry
 * ------------------------------------------------------------------ */

describe('the registry admits AVIF in both directions', () => {
    it('lists it as a convert input and a convert output', () => {
        expect(CONVERT_INPUT_FORMATS).toContain('avif');
        expect(CONVERT_OUTPUT_FORMATS).toContain('avif');
    });

    it('treats it as a quality format, because libavif takes a quality', () => {
        expect(QUALITY_FORMATS).toContain('avif');
    });

    it('pins the encoder speed as a named constant rather than a literal', () => {
        expect(typeof AVIF_ENCODE_SPEED).toBe('number');
        expect(AVIF_ENCODE_SPEED).toBeGreaterThanOrEqual(0);
        expect(AVIF_ENCODE_SPEED).toBeLessThanOrEqual(10);
    });
});

/* ------------------------------------------------------------------ *
 * 3. Writing an AVIF — the real WASM lane, no shim
 * ------------------------------------------------------------------ */

describe('a JPEG converted to AVIF', () => {
    it('comes back as bytes that are an AVIF by the container, not by the label', async () => {
        const result = await convert(await jpegSource(), { format: 'avif' });
        const bytes = await bytesOf(result);

        expect(sniffImageType(bytes.subarray(0, 16))).toBe('avif');
        expect(result.format).toBe('avif');
        expect(result.blob.type).toBe('image/avif');
        expect(result.filename).toBe('resizo-converted-photo.avif');

        const avif = assertAvif(bytes, { width: WIDTH, height: HEIGHT, bitDepth: 8 });
        expect(avif.animated).toBe(false);
        // encode.js states 4:2:0 as a decision and says the header reader is
        // how the pages get to state it truthfully. This is that reading, taken
        // by a parser the engine does not own.
        expect(avif.chroma).toBe('4:2:0');
    });

    it('is decodable by an implementation that did not write it', async () => {
        const bytes = await bytesOf(await convert(await jpegSource(), { format: 'avif' }));

        const meta = await sharp(bytes).metadata();
        expect(meta.format).toBe('heif');
        expect(meta.compression).toBe('av1');
        expect([meta.width, meta.height]).toEqual([WIDTH, HEIGHT]);

        // And the picture is the picture, not a grey rectangle of the right size.
        const decoded = await sharp(bytes).removeAlpha().raw().toBuffer();
        expect(decoded[0]).toBeGreaterThan(150);
    });

    it('writes no alpha plane for a source that had none', async () => {
        const bytes = await bytesOf(await convert(await jpegSource(), { format: 'avif' }));

        // MEASURED, not assumed: libheif writes an alpha item for any pipeline
        // carrying an alpha channel even when every pixel is opaque, which is
        // how an "opaque" fixture in this repo once shipped with a whole alpha
        // plane inside it. The engine must hand the encoder three channels.
        expect(parseAvif(bytes).hasAlpha).toBe(false);
        expect((await sharp(bytes).metadata()).hasAlpha).toBe(false);
    });

    it('carries nothing from the source: no Exif item and no XMP item', async () => {
        const bytes = await bytesOf(await convert(await jpegSource(), { format: 'avif' }));
        const avif = parseAvif(bytes);

        expect(avif.hasExif).toBe(false);
        expect(avif.hasXmp).toBe(false);
        expect(avif.items.map((item) => item.type)).toEqual(['av01']);
    });

    it('reports the checks it made rather than asserting success', async () => {
        // The decoder is installed here on purpose: the fourth row IS a decode,
        // and a run without one would leave it unasked rather than passed.
        installNativeDecoder();

        const result = await convert(await jpegSource(), { format: 'avif' });

        expect(result.verified).toBe(true);
        expect(result.checks.map((check) => check.key)).toEqual(['format', 'dimensions', 'alpha', 'decodes']);

        for (const check of result.checks) {
            expect(check.ok, `the ${check.key} row: wanted ${check.required}, got ${check.actual}`).toBe(true);
            expect(check.required).toBeTruthy();
            expect(check.actual).toBeTruthy();
        }
    });

    /**
     * THE ONE PLACE "NOBODY CHECKED" COULD BE MISTAKEN FOR "IT PASSED".
     *
     * `verified` is "no row said no", never "every row said yes" — the same
     * convention lib/image-client/requirements.js states. A worker with no
     * createImageBitmap cannot decode anything, so the decode-back row is
     * `null` there, and the danger is a future change that quietly rounds that
     * null up to true: the validation would then report success on a file
     * nothing ever opened. This pins the distinction rather than trusting it.
     */
    it('marks the decode-back row unasked, not passed, where there is no decoder', async () => {
        const result = await convert(await jpegSource(), { format: 'avif' });

        const byKey = Object.fromEntries(result.checks.map((check) => [check.key, check]));

        expect(byKey.decodes.ok, 'an unasked check reported as an answered one').toBeNull();
        expect(byKey.decodes.actual).toMatch(/no decoder/i);

        // The three rows that CAN be checked without a browser still were, and
        // a report with nothing left unanswered by a failure is verified.
        for (const key of ['format', 'dimensions', 'alpha']) expect(byKey[key].ok).toBe(true);
        expect(result.verified).toBe(true);
    });

    it('applies the quality it was given, and defaults to the registry default', async () => {
        const low = await bytesOf(await convert(await jpegSource(), { format: 'avif', quality: 20 }));
        const high = await bytesOf(await convert(await jpegSource(), { format: 'avif', quality: 90 }));
        const fallback = await convert(await jpegSource(), { format: 'avif' });

        expect(low.length).toBeLessThan(high.length);
        expect(fallback.qualityApplied).toBe(true);
        expect(fallback.quality ?? DEFAULT_QUALITY).toBe(DEFAULT_QUALITY);
    });
});

describe('a transparent PNG converted to AVIF', () => {
    it('keeps the transparency as a real alpha auxiliary item', async () => {
        const bytes = await bytesOf(await convert(await transparentPngSource(), { format: 'avif' }));
        const avif = assertAvif(bytes, { width: WIDTH, height: HEIGHT, alpha: true });

        expect(avif.alpha.auxC.auxType).toBe('urn:mpeg:mpegB:cicp:systems:auxiliary:alpha');
        expect(avif.alphaLinkedToPrimary).toBe(true);
    });

    it('leaves the clear corner clear when libvips reads it back', async () => {
        const bytes = await bytesOf(await convert(await transparentPngSource(), { format: 'avif' }));

        const { data } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
        expect(data[3], 'the corner came back opaque — the alpha plane is a stencil of the wrong shape').toBeLessThan(16);

        const middle = ((HEIGHT / 2) * WIDTH + WIDTH / 2) * 4;
        expect(data[middle + 3]).toBeGreaterThan(240);
    });
});

/* ------------------------------------------------------------------ *
 * 4. Reading an AVIF — with the decoder the browser would provide
 * ------------------------------------------------------------------ */

describe('an AVIF converted to JPEG', () => {
    it('comes back a JPEG at the same pixel dimensions', async () => {
        installNativeDecoder();

        const result = await convert(await avifFile(), { format: 'jpeg' });
        const bytes = await bytesOf(result);

        expect(sniffImageType(bytes.subarray(0, 16))).toBe('jpeg');
        expect(result.sourceFormat).toBe('avif');
        expect([result.width, result.height]).toEqual([WIDTH, HEIGHT]);

        const meta = await sharp(bytes).metadata();
        expect([meta.width, meta.height]).toEqual([WIDTH, HEIGHT]);
        expect(meta.hasAlpha).toBe(false);
    });

    it('keeps an odd width and an odd height exactly as they were', async () => {
        installNativeDecoder();

        const file = new File([await avifBytes({ width: 1001, height: 333 })], 'odd.avif', { type: 'image/avif' });
        const result = await runOperation('convert', file, {
            format: 'jpeg', sourceWidth: 1001, sourceHeight: 333,
        });

        const meta = await sharp(await bytesOf(result)).metadata();
        expect([meta.width, meta.height]).toEqual([1001, 333]);
    });

    it('fills a transparent source with white without being asked', async () => {
        installNativeDecoder();

        const bytes = await bytesOf(await convert(await avifFile({ alpha: true }), { format: 'jpeg' }));
        const { data } = await sharp(bytes).removeAlpha().raw().toBuffer({ resolveWithObject: true });

        for (let channel = 0; channel < 3; channel += 1) {
            expect(Math.abs(data[channel] - 255), `the corner read ${data[0]},${data[1]},${data[2]}`).toBeLessThanOrEqual(4);
        }
    });

    it('fills it with a colour that was chosen instead', async () => {
        installNativeDecoder();

        const bytes = await bytesOf(await convert(await avifFile({ alpha: true }), {
            format: 'jpeg',
            background: '#2f6fed',
        }));
        const { data } = await sharp(bytes).removeAlpha().raw().toBuffer({ resolveWithObject: true });

        for (const [channel, wanted] of [[0, 0x2f], [1, 0x6f], [2, 0xed]]) {
            expect(Math.abs(data[channel] - wanted), `the corner read ${data[0]},${data[1]},${data[2]}`).toBeLessThanOrEqual(4);
        }
    });
});

describe('an AVIF converted to PNG', () => {
    it('keeps the transparency a JPEG would have filled in', async () => {
        installNativeDecoder();

        const bytes = await bytesOf(await convert(await avifFile({ alpha: true }), { format: 'png' }));
        const meta = await sharp(bytes).metadata();

        expect(meta.format).toBe('png');
        expect(meta.hasAlpha).toBe(true);

        const { data } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
        expect(data[3]).toBeLessThan(16);
    });
});

describe('a 10-bit AVIF', () => {
    it('is reported as 10-bit and handed back as 8-bit', async () => {
        installNativeDecoder();

        const source = await avifFile({ bitdepth: 10 }, 'hdr.avif');
        expect(parseAvif(Buffer.from(await source.arrayBuffer())).bitDepth).toBe(10);

        /**
         * PNG RATHER THAN JPEG, AND THE CHOICE IS THE ASSERTION. A JPEG is
         * 8-bit by definition, so a depth read off one proves nothing about
         * this engine — and measured on sharp 0.35.3 over libvips 8.18.3,
         * `bitsPerSample` is not even reported for a JPEG: undefined for JPEG,
         * 8 for a PNG, 16 for a 16-bit PNG. A PNG *can* carry sixteen bits a
         * channel, so a PNG that comes back at eight is a real finding about
         * where the depth was dropped.
         */
        const result = await convert(source, { format: 'png' });

        expect(result.sourceBitDepth).toBe(10);
        expect((await sharp(await bytesOf(result)).metadata()).bitsPerSample).toBe(8);
    });

    it('reports 8 for an ordinary source rather than leaving it null', async () => {
        installNativeDecoder();

        expect((await convert(await avifFile(), { format: 'jpeg' })).sourceBitDepth).toBe(8);
    });
});

describe('a stored rotation', () => {
    /**
     * THE ONE THAT COULD BE APPLIED TWICE. `irot` is the decoder's job, and
     * `lib/image-client/orientation.js` is the WASM lane's job; an AVIF takes
     * the native lane and must therefore be turned exactly once. The oracle is
     * libvips, which honours the property in its own decoder.
     */
    it('turns the picture once, and lands where libvips lands', async () => {
        installNativeDecoder();

        const bytes = committed('irot-90.avif');
        const reference = await sharp(bytes).metadata();
        const file = new File([bytes], 'turned.avif', { type: 'image/avif' });

        const result = await runOperation('convert', file, {
            format: 'jpeg', sourceWidth: reference.width, sourceHeight: reference.height,
        });

        const meta = await sharp(await bytesOf(result)).metadata();
        expect([meta.width, meta.height]).toEqual([reference.width, reference.height]);
        expect([meta.width, meta.height]).toEqual([64, 96]);
    });
});

/* ------------------------------------------------------------------ *
 * 5. The refusals
 * ------------------------------------------------------------------ */

describe('an animated AVIF is refused before anything is decoded', () => {
    const cases = [
        ['the major brand says avis', (bytes) => setMajorBrand(bytes, 'avis')],
        ['avis is among the compatible brands', (bytes) => addCompatibleBrand(bytes, 'avis')],
        ['there is a top-level moov', (bytes) => appendMoov(bytes)],
    ];

    it.each(cases)('refuses it when %s', async (_label, edit) => {
        installNativeDecoder();

        const file = new File([edit(await avifBytes())], 'clip.avif', { type: 'image/avif' });
        const failure = await convert(file, { format: 'jpeg' }).catch((error) => error);

        expect(failure).toBeInstanceOf(JobError);
        expect(failure.code).toBe('avif-animated');
        expect(failure.message).toBe(ANIMATED_MESSAGE);
    });

    it('refuses without asking the decoder for a single frame', async () => {
        const decoded = installNativeDecoder();

        const file = new File([setMajorBrand(await avifBytes(), 'avis')], 'clip.avif', { type: 'image/avif' });
        await convert(file, { format: 'jpeg' }).catch(() => {});

        expect(decoded, 'the decoder was called for a file that should never reach it').toEqual([]);
    });
});

describe('a damaged AVIF', () => {
    it.each(['truncated.avif', 'garbage-after-ftyp.avif'])('refuses %s in words', async (name) => {
        installNativeDecoder();

        const bytes = committed(name);
        const file = new File([bytes], name, { type: 'image/avif' });
        const failure = await runOperation('convert', file, {
            format: 'jpeg', sourceWidth: 96, sourceHeight: 64,
        }).catch((error) => error);

        expect(failure).toBeInstanceOf(JobError);
        expect(failure.code).toBe('avif-damaged');
        expect(failure.message).toBe(DAMAGED_MESSAGE);
    });
});

describe('a browser with no AVIF decoder', () => {
    it('says which browsers can open the file instead of failing silently', async () => {
        // No createImageBitmap installed at all — the shape of Safari 15.
        const failure = await convert(await avifFile(), { format: 'jpeg' }).catch((error) => error);

        expect(failure).toBeInstanceOf(JobError);
        expect(failure.code).toBe('avif-unsupported-browser');
        expect(failure.message).toBe(UNSUPPORTED_MESSAGE);
    });

    it('names a version a person can act on', () => {
        expect(UNSUPPORTED_MESSAGE).toMatch(/Chrome 85/);
        expect(UNSUPPORTED_MESSAGE).toMatch(/Firefox 93/);
        expect(UNSUPPORTED_MESSAGE).toMatch(/Safari 16/);
    });
});

describe('AVIF where it is not offered', () => {
    it('is refused by /compress, which has no rate controller for it', async () => {
        const failure = await runOperation('compress', await jpegSource(), {
            format: 'avif', quality: 70, sourceWidth: WIDTH, sourceHeight: HEIGHT,
        }).catch((error) => error);

        expect(failure).toBeInstanceOf(JobError);
        expect(failure.code).toBe('invalid-format');
    });

    it('is refused by the fit op, which writes the three classic formats', async () => {
        // The fitter's own option shape: strings, the way the form sends them.
        const failure = await runOperation('fit', await jpegSource(), {
            format: 'avif', width: '64', height: '48', sourceWidth: WIDTH, sourceHeight: HEIGHT,
        }).catch((error) => error);

        expect(failure).toBeInstanceOf(JobError);
        expect(failure.code).toBe('invalid-format');
    });
});

describe('a file whose name and whose bytes disagree', () => {
    it('reads JPEG bytes under an .avif name as the JPEG they are', async () => {
        const bytes = await pipeline(quadrants(WIDTH, HEIGHT, 3), WIDTH, HEIGHT, 3).jpeg().toBuffer();
        const file = new File([bytes], 'lying.avif', { type: 'image/avif' });

        const result = await convert(file, { format: 'png' });

        expect(result.sourceFormat).toBe('jpeg');
        expect((await sharp(await bytesOf(result)).metadata()).format).toBe('png');
    });

    it('reads AVIF bytes under a .jpg name as the AVIF they are', async () => {
        installNativeDecoder();

        const file = new File([await avifBytes()], 'lying.jpg', { type: 'image/jpeg' });
        const result = await convert(file, { format: 'png' });

        expect(result.sourceFormat).toBe('avif');
    });
});

describe('the encode-failed refusal', () => {
    it('has a sentence of its own, so a validation failure never reads as success', () => {
        expect(ENCODE_FAILED_MESSAGE).toMatch(/could ?n.t encode/i);
    });
});
