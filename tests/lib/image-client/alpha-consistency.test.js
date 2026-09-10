/**
 * TRANSPARENCY IS FLATTENED THE SAME WAY BY EVERY OP THAT CAN EMIT JPEG.
 *
 * lib/image-client/flatten.js exists because the two encoders disagree about a
 * transparent pixel: libvips composites it onto black, MozJPEG via @jsquash
 * reads the RGBA buffer as RGBX and ignores the alpha byte entirely. So the
 * pixels have to be composited before the encoder sees them, and `runConvert`
 * and `runCompress` both do exactly that:
 *
 *     const pixels = formatKeepsAlpha(format) ? decoded.data : flattenImageData(decoded.data);
 *
 * `runResize` and `runHeic` did not, and /resize offers JPEG as an output for
 * any source. A transparent PNG resized to JPEG therefore reached MozJPEG with
 * its alpha intact and was written as if it were opaque — measured, a
 * rgba(255,0,0,128) fixture came back 254,0,0 from /resize against 128,0,0 from
 * /convert and 128,0,0 from sharp.
 *
 * Worse, it disagreed with ITSELF. @jsquash/resize defaults to
 * `premultiply: true`, so a resample zeroes the RGB underneath alpha=0 and a
 * fully clear pixel lands on black; with no resample the same file kept its
 * white. Same tool, same input, two answers depending on whether a width was
 * typed.
 *
 * These tests are written as a RELATION rather than as a table of expected
 * bytes: whatever the flattening rule is, every op must apply the same one.
 * The sharp reference is the oracle for the ARITHMETIC, and it can only speak
 * for black, because black is what libvips reaches for with no background
 * given. The product default is white — a deliberate decision rather than an
 * inherited library setting, see flatten.js — so the checks against libvips
 * ask for black by name, and the default is asserted separately at the bottom
 * of this file.
 */
import sharp from 'sharp';
import { beforeAll, describe, expect, it } from 'vitest';

import { DEFAULT_QUALITY } from '@/lib/limits';
import { installBrowserEnv } from './helpers/browser-env';

let runOperation;

beforeAll(async () => {
    installBrowserEnv();
    ({ runOperation } = await import('@/lib/image-client/operations'));
});

const WIDTH = 48;
const HEIGHT = 32;

/** A flat block of one RGBA colour, encoded losslessly so alpha survives intake. */
async function transparentSource([r, g, b, a], format = 'png') {
    const raw = Buffer.alloc(WIDTH * HEIGHT * 4);
    for (let index = 0; index < WIDTH * HEIGHT; index += 1) {
        raw[index * 4] = r;
        raw[index * 4 + 1] = g;
        raw[index * 4 + 2] = b;
        raw[index * 4 + 3] = a;
    }

    const pipeline = sharp(raw, { raw: { width: WIDTH, height: HEIGHT, channels: 4 } });
    const bytes = await (format === 'webp'
        ? pipeline.webp({ quality: DEFAULT_QUALITY, alphaQuality: 100 })
        : pipeline.png({ compressionLevel: 9 })
    ).toBuffer();

    return new File([bytes], `fixture.${format}`, { type: `image/${format}` });
}

async function firstPixel(blob) {
    const buffer = Buffer.from(await blob.arrayBuffer());
    const { data } = await sharp(buffer).raw().toBuffer({ resolveWithObject: true });
    return [data[0], data[1], data[2]];
}

/** What libvips does with the same file — the reference the browser build is held to. */
async function sharpReference(file, { width } = {}) {
    const input = Buffer.from(await file.arrayBuffer());
    let pipeline = sharp(input).rotate();
    if (width) pipeline = pipeline.resize({ width });
    const bytes = await pipeline.jpeg({ quality: DEFAULT_QUALITY }).toBuffer();
    const { data } = await sharp(bytes).raw().toBuffer({ resolveWithObject: true });
    return [data[0], data[1], data[2]];
}

/** Channelwise closeness, to absorb JPEG's own noise rather than chasing exact bytes. */
function expectPixelNear(actual, expected, tolerance, message) {
    for (let channel = 0; channel < 3; channel += 1) {
        expect(
            Math.abs(actual[channel] - expected[channel]),
            `${message}: got ${actual.join(',')}, expected ~${expected.join(',')}`,
        ).toBeLessThanOrEqual(tolerance);
    }
}

const ALPHA_CASES = [
    { name: 'half-transparent red', rgba: [255, 0, 0, 128] },
    { name: 'quarter-transparent green', rgba: [0, 255, 0, 64] },
    { name: 'fully clear white', rgba: [255, 255, 255, 0] },
];

describe('a transparent source resized to JPEG', () => {
    it.each(ALPHA_CASES)('$name matches what /convert produces', async ({ rgba }) => {
        const file = await transparentSource(rgba);

        const resized = await runOperation('resize', file, {
            width: 24,
            format: 'jpeg',
            sourceWidth: WIDTH,
            sourceHeight: HEIGHT,
        });
        const converted = await runOperation('convert', file, {
            format: 'jpeg',
            sourceWidth: WIDTH,
            sourceHeight: HEIGHT,
        });

        expectPixelNear(
            await firstPixel(resized.blob),
            await firstPixel(converted.blob),
            3,
            'resize and convert disagree about the same transparent pixel',
        );
    });

    /**
     * BLACK IS NAMED HERE ON PURPOSE. libvips composites onto black when no
     * background is given, and that is the only colour it can be an oracle for.
     * The product default moved to white — a decision, not an inherited library
     * setting, see flatten.js — so asking for black is what puts the engine and
     * the reference back on the same question. The arithmetic under test is
     * unchanged; only which colour is the default moved.
     */
    it.each(ALPHA_CASES)('$name matches the sharp reference when black is asked for', async ({ rgba }) => {
        const file = await transparentSource(rgba);

        const resized = await runOperation('resize', file, {
            width: 24,
            format: 'jpeg',
            background: 'black',
            sourceWidth: WIDTH,
            sourceHeight: HEIGHT,
        });

        expectPixelNear(
            await firstPixel(resized.blob),
            await sharpReference(file, { width: 24 }),
            3,
            'resize disagrees with libvips',
        );
    });

    /**
     * The self-inconsistency, isolated. Typing a width changes whether
     * @jsquash/resize runs, and its `premultiply: true` is what zeroed the RGB
     * under a clear pixel. Once flattening happens on the way out, both lanes
     * land in the same place.
     */
    it.each(ALPHA_CASES)('$name is the same whether or not a resample runs', async ({ rgba }) => {
        const file = await transparentSource(rgba);
        const common = { format: 'jpeg', sourceWidth: WIDTH, sourceHeight: HEIGHT };

        const resampled = await runOperation('resize', file, { ...common, width: 24 });
        const untouched = await runOperation('resize', file, common);

        expectPixelNear(
            await firstPixel(untouched.blob),
            await firstPixel(resampled.blob),
            3,
            'the same file gives two answers depending on whether a width was typed',
        );
    });

    it('flattens a transparent WebP source too, not only PNG', async () => {
        const file = await transparentSource([255, 0, 0, 128], 'webp');

        const resized = await runOperation('resize', file, {
            width: 24,
            format: 'jpeg',
            background: 'black',
            sourceWidth: WIDTH,
            sourceHeight: HEIGHT,
        });

        expectPixelNear(
            await firstPixel(resized.blob),
            await sharpReference(file, { width: 24 }),
            4,
            'a transparent WebP resized to JPEG disagrees with libvips',
        );
    });
});

describe('a transparent source resized to a format that keeps alpha', () => {
    it.each(['png', 'webp'])('%s still carries its alpha channel', async (format) => {
        const file = await transparentSource([255, 0, 0, 128]);

        const resized = await runOperation('resize', file, {
            width: 24,
            format,
            sourceWidth: WIDTH,
            sourceHeight: HEIGHT,
        });

        const buffer = Buffer.from(await resized.blob.arrayBuffer());
        const meta = await sharp(buffer).metadata();

        expect(meta.hasAlpha, `${format} lost its alpha channel`).toBe(true);
    });
});

/**
 * THE OPTION HAS TO REACH THE PIXELS, NOT JUST PARSE.
 *
 * parseBackground is unit-tested in flatten.test.js. What those tests cannot
 * see is the threading: options.background has to survive the page, the
 * FormData map, the worker wire and four separate ops before it reaches
 * flattenImageData. A control that parses perfectly and is then dropped on the
 * way through looks exactly like a working feature until someone checks the
 * pixels.
 *
 * So these run the real ops against the real codecs and read the bytes back.
 */
describe('the chosen background reaches the encoder', () => {
    const HALF_RED = [255, 0, 0, 128];

    it.each(['convert', 'resize', 'compress'])('%s composites onto white when asked', async (op) => {
        const file = await transparentSource(HALF_RED);

        const result = await runOperation(op, file, {
            format: 'jpeg',
            background: 'white',
            sourceWidth: WIDTH,
            sourceHeight: HEIGHT,
        });

        // Half-transparent red over white: the red channel saturates, and the
        // other two carry only the background's contribution.
        expectPixelNear(await firstPixel(result.blob), [255, 127, 127], 3, `${op} ignored the background`);
    });

    it.each(['convert', 'resize', 'compress'])('%s composites onto black when black is chosen', async (op) => {
        const file = await transparentSource(HALF_RED);

        const result = await runOperation(op, file, {
            format: 'jpeg',
            background: 'black',
            sourceWidth: WIDTH,
            sourceHeight: HEIGHT,
        });

        expectPixelNear(await firstPixel(result.blob), [128, 0, 0], 3, `${op} ignored a chosen black`);
    });

    /**
     * The default, on every op that can emit a JPEG. A tool that quietly kept
     * the old black would contradict its own page copy, and the visitor who
     * never touches the control is exactly the one who would never find out.
     */
    it.each(['convert', 'resize', 'compress'])('%s falls back to white when nothing is chosen', async (op) => {
        const file = await transparentSource(HALF_RED);

        const result = await runOperation(op, file, {
            format: 'jpeg',
            sourceWidth: WIDTH,
            sourceHeight: HEIGHT,
        });

        expectPixelNear(await firstPixel(result.blob), [255, 127, 127], 3, `${op} changed the default`);
    });

    it('takes a hex colour end to end, not only the named ones', async () => {
        const file = await transparentSource([255, 255, 255, 0]);

        const result = await runOperation('convert', file, {
            format: 'jpeg',
            background: '#0000ff',
            sourceWidth: WIDTH,
            sourceHeight: HEIGHT,
        });

        // Fully clear over blue is the background, exactly.
        expectPixelNear(await firstPixel(result.blob), [0, 0, 255], 4, 'the hex colour was dropped');
    });

    it('ignores the background when the output keeps its alpha', async () => {
        const file = await transparentSource(HALF_RED);

        const result = await runOperation('convert', file, {
            format: 'png',
            background: 'white',
            sourceWidth: WIDTH,
            sourceHeight: HEIGHT,
        });

        const meta = await sharp(Buffer.from(await result.blob.arrayBuffer())).metadata();
        expect(meta.hasAlpha, 'a background should never flatten a format that has alpha').toBe(true);
    });
});
