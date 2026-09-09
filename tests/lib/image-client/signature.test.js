/**
 * /signature-resizer — a scanned signature, cropped and sized to what a form
 * asks for.
 *
 * WHY THIS IS AN OP RATHER THAN A PRESET ON /resize
 *
 * The forms that ask for a signature ask for two things at once: a box in
 * pixels AND a ceiling in bytes ("50 KB, 300x100"), and they ask for them on a
 * picture whose useful part is a fraction of the scan. /resize answers one of
 * those and /crop answers another, so doing this with the existing tools is
 * three round trips with a guess in the middle.
 *
 * THE THREE WAYS TO REACH A BOX, AND WHY ALL THREE EXIST
 *
 * A signature is a wide, short banner and the box on the form almost never has
 * the same ratio, so "make it 300x100" is genuinely ambiguous:
 *
 *   fit      scale until the whole signature is inside the box. The output can
 *            be SMALLER than the box on one axis. Nothing is lost and nothing
 *            is distorted, which is why it is the default.
 *   cover    fill the box exactly and trim the overflow off the centre. Exactly
 *            the numbers asked for, at the cost of the edges of the ink.
 *   stretch  resample straight to the box. The one place in this engine that
 *            deliberately changes the shape of a picture, and it exists because
 *            some portals validate the dimensions byte for byte.
 *
 * Every number asserted below is arithmetic, not a measurement, so it is stated
 * exactly. The fixture is 800x300 and the two boxes are 300x100 and 150x150 —
 * one box wider than the signature and one narrower, so the binding axis
 * changes between them and a version that always binds on width passes one and
 * fails the other.
 */
import sharp from 'sharp';
import { beforeAll, describe, expect, it } from 'vitest';

import { DEFAULT_QUALITY, SIGNATURE_OUTPUT_FORMATS } from '@/lib/limits';
import { installBrowserEnv } from './helpers/browser-env';
import { makeFile, noiseJpeg, signaturePng } from './helpers/fixtures';

const KB = 1024;

const SOURCE_WIDTH = 800;
const SOURCE_HEIGHT = 300;

// The fixture paints its ink across the middle half horizontally and the middle
// third vertically: x in [200, 600), y in [100, 200).
const INK = { x: 200, y: 100, width: 400, height: 100 };

let runOperation;
let JobError;

beforeAll(async () => {
    installBrowserEnv();
    ({ runOperation, JobError } = await import('@/lib/image-client/operations'));
});

async function sourceFile() {
    const bytes = await signaturePng({ width: SOURCE_WIDTH, height: SOURCE_HEIGHT });
    return makeFile(bytes, { name: 'scan.png', type: 'image/png' });
}

function sign(options) {
    return sourceFile().then((file) => runOperation('signature', file, options));
}

/** The output read back through sharp, with a pixel accessor in image space. */
async function readBack(blob) {
    const buffer = Buffer.from(await blob.arrayBuffer());
    const format = (await sharp(buffer).metadata()).format;
    const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });

    return {
        format,
        width: info.width,
        height: info.height,
        at(x, y) {
            const offset = (y * info.width + x) * 4;
            return Array.from(data.slice(offset, offset + 4));
        },
        everyAlpha(predicate) {
            for (let offset = 3; offset < data.length; offset += 4) {
                if (!predicate(data[offset])) return false;
            }
            return true;
        },
    };
}

/* ------------------------------------------------------------------ *
 * 1. The three ways to reach a box
 * ------------------------------------------------------------------ */

describe('the size a box is reached at', () => {
    it.each([
        ['fit', 300, 100, 267, 100],
        ['cover', 300, 100, 300, 100],
        ['stretch', 300, 100, 300, 100],
        ['fit', 150, 150, 150, 56],
        ['cover', 150, 150, 150, 150],
        ['stretch', 150, 150, 150, 150],
    ])('%s into %ix%i lands on %ix%i', async (fit, boxWidth, boxHeight, width, height) => {
        const result = await sign({ width: String(boxWidth), height: String(boxHeight), fit, format: 'png' });

        expect({ width: result.width, height: result.height }).toEqual({ width, height });
        expect(result.fit).toBe(fit);
        expect(result.requestedWidth).toBe(boxWidth);
        expect(result.requestedHeight).toBe(boxHeight);

        const output = await readBack(result.blob);
        expect({ width: output.width, height: output.height }).toEqual({ width, height });
    }, 60_000);

    it('fits by default, because it is the only one of the three that loses nothing', async () => {
        const result = await sign({ width: '300', height: '100', format: 'png' });

        expect(result.fit).toBe('fit');
        expect({ width: result.width, height: result.height }).toEqual({ width: 267, height: 100 });
    }, 60_000);

    it('derives the other side from the CROP, not from the source', async () => {
        // A 400x200 crop is 2:1 where the source is 8:3, so a width of 200
        // derives a height of 100 here and would derive 75 from the source.
        const result = await sign({
            x: String(INK.x), y: String(INK.y), cropWidth: '400', cropHeight: '200',
            width: '200', format: 'png',
        });

        expect({ width: result.width, height: result.height }).toEqual({ width: 200, height: 100 });
        expect({ width: result.requestedWidth, height: result.requestedHeight }).toEqual({ width: 200, height: 100 });
    }, 60_000);

    it('is allowed to make a small signature bigger', async () => {
        // A scan at 800 wide going onto a form that wants 1600 is a real
        // request, and refusing to upscale would leave it unanswerable.
        const result = await sign({ width: '1600', fit: 'fit', format: 'png' });

        expect({ width: result.width, height: result.height }).toEqual({ width: 1600, height: 600 });
    }, 60_000);
});

/* ------------------------------------------------------------------ *
 * 2. The crop is the pixels, not just a number on the result
 * ------------------------------------------------------------------ */

describe('the crop rectangle', () => {
    it('comes back on the result exactly as it was applied', async () => {
        const result = await sign({
            x: '100', y: '50', cropWidth: '400', cropHeight: '200',
            width: '200', format: 'png',
        });

        expect(result.crop).toEqual({ x: 100, y: 50, width: 400, height: 200 });
    }, 60_000);

    it('is the whole image when none of the four is given', async () => {
        const result = await sign({ width: '400', format: 'png' });

        expect(result.crop).toEqual({ x: 0, y: 0, width: SOURCE_WIDTH, height: SOURCE_HEIGHT });
    }, 60_000);

    it('actually moves which pixels survive — an empty corner stays empty', async () => {
        const result = await sign({
            x: '0', y: '0', cropWidth: '200', cropHeight: '100',
            width: '100', format: 'png',
        });

        const output = await readBack(result.blob);
        expect({ width: output.width, height: output.height }).toEqual({ width: 100, height: 50 });
        expect(output.everyAlpha((alpha) => alpha === 0)).toBe(true);
    }, 60_000);

    it('and a rectangle inside the ink comes back solid', async () => {
        const result = await sign({
            x: '250', y: '110', cropWidth: '300', cropHeight: '80',
            width: '150', format: 'png',
        });

        const output = await readBack(result.blob);
        expect(output.everyAlpha((alpha) => alpha === 255)).toBe(true);

        // Within a point of the ink rather than equal to it: the resampler
        // works in linear light and a flat fill comes back off by one from the
        // gamma round trip. Pinning the byte would be measuring lanczos3, and
        // what is under test is which pixels the crop selected.
        const [red, green, blue] = output.at(75, 20);
        expect(Math.abs(red - 12)).toBeLessThanOrEqual(2);
        expect(Math.abs(green - 24)).toBeLessThanOrEqual(2);
        expect(Math.abs(blue - 48)).toBeLessThanOrEqual(2);
    }, 60_000);
});

/* ------------------------------------------------------------------ *
 * 3. What fills the transparency, and where it does not need filling
 * ------------------------------------------------------------------ */

describe('the background behind a signature', () => {
    /**
     * WHITE, not the engine's black. Everywhere else in this engine a
     * transparent pixel is composited onto black, because that is what libvips
     * does with no background given and what /png-to-jpg's copy promises. A
     * signature is going onto a form — a white one — and a black rectangle
     * around the ink is not a defensible default here.
     */
    it('is white by default for a JPEG, which is the paper it is going onto', async () => {
        const result = await sign({ width: '400', format: 'jpeg' });
        const output = await readBack(result.blob);

        expect(output.format).toBe('jpeg');
        const [red, green, blue] = output.at(4, 4);
        expect(red).toBeGreaterThan(245);
        expect(green).toBeGreaterThan(245);
        expect(blue).toBeGreaterThan(245);
    }, 60_000);

    it('is still whatever the visitor asked for', async () => {
        const result = await sign({ width: '400', format: 'jpeg', background: 'black' });
        const output = await readBack(result.blob);

        const [red, green, blue] = output.at(4, 4);
        expect(red).toBeLessThan(12);
        expect(green).toBeLessThan(12);
        expect(blue).toBeLessThan(12);
    }, 60_000);

    it('is not applied at all to a PNG, which can carry the transparency', async () => {
        const result = await sign({ width: '400', format: 'png', background: 'black' });
        const output = await readBack(result.blob);

        expect(output.format).toBe('png');
        expect(output.at(4, 4)[3]).toBe(0);
    }, 60_000);

    it('defaults the output to JPEG, which is what the forms ask for', async () => {
        const result = await sign({ width: '400' });

        expect(result.format).toBe('jpeg');
        expect(result.type).toBe('image/jpeg');
        expect(result.quality).toBe(DEFAULT_QUALITY);
        expect(result.qualityApplied).toBe(true);
    }, 60_000);

    it('turns the quality claim off for a PNG, which has no such dial', async () => {
        const result = await sign({ width: '400', format: 'png' });

        expect(result.qualityApplied).toBe(false);
    }, 60_000);
});

/* ------------------------------------------------------------------ *
 * 4. The byte ceiling the form also imposes
 * ------------------------------------------------------------------ */

describe('a byte ceiling on top of the box', () => {
    it('is met without touching anything when the box already fits under it', async () => {
        const result = await sign({ width: '300', format: 'jpeg', targetBytes: String(200 * KB) });

        expect(result.targetMet).toBe(true);
        expect(result.resultBytes).toBeLessThanOrEqual(200 * KB);
        expect(result.resized).toBe(false);
        expect(result.steps).toBe(0);
        expect(result.scalePercent).toBe(100);
        expect({ width: result.width, height: result.height }).toEqual({ width: 300, height: 113 });
    }, 60_000);

    /**
     * The case the tool exists for: the form wants 800 pixels wide AND under
     * 10 KB, and a scan with real detail in it cannot be both. The box is
     * reached first, then the ceiling takes pixels off it — and the result says
     * that it did, because a signature that quietly came back a third of the
     * size it was asked for would be rejected by the form it was made for.
     */
    it('takes pixels off the box when the ceiling cannot be met any other way', async () => {
        const bytes = await noiseJpeg({ width: SOURCE_WIDTH, height: SOURCE_HEIGHT });
        const target = 10 * KB;

        const result = await runOperation(
            'signature',
            makeFile(bytes, { name: 'scan.jpg', type: 'image/jpeg' }),
            { width: String(SOURCE_WIDTH), format: 'jpeg', targetBytes: String(target) },
        );

        expect(result.targetMet).toBe(true);
        expect(result.resultBytes).toBeLessThanOrEqual(target);
        expect(result.resized).toBe(true);
        expect(result.steps).toBeGreaterThan(0);
        expect(result.width).toBeLessThan(SOURCE_WIDTH);
        expect(result.scalePercent).toBeLessThan(100);

        // The box that was asked for is still reported, so the panel can say
        // what was given up rather than only what was delivered.
        expect(result.requestedWidth).toBe(SOURCE_WIDTH);
        expect(result.requestedHeight).toBe(SOURCE_HEIGHT);

        const legal = [1, 2, 3, 4, 5, 6, 7, 8].map((step) => ({
            width: Math.max(1, Math.round(SOURCE_WIDTH * 0.8 ** step)),
            height: Math.max(1, Math.round(SOURCE_HEIGHT * 0.8 ** step)),
        }));
        expect(legal).toContainEqual({ width: result.width, height: result.height });

        const output = await readBack(result.blob);
        expect({ width: output.width, height: output.height }).toEqual({ width: result.width, height: result.height });
    }, 120_000);

    it('reports nothing about a target that was never asked for', async () => {
        const result = await sign({ width: '300', format: 'jpeg' });

        expect(result.targetBytes).toBeNull();
        expect(result.targetMet).toBeNull();
        expect(result.resized).toBe(false);
        expect(result.steps).toBe(0);
    }, 60_000);
});

/* ------------------------------------------------------------------ *
 * 5. Refusals, each with the code the panel branches on
 * ------------------------------------------------------------------ */

async function refusalFrom(options) {
    return sign(options).then(
        (result) => { throw new Error(`expected a refusal, got ${result.width}x${result.height}`); },
        (thrown) => thrown,
    );
}

describe('what it will not do', () => {
    it.each([
        ['no size at all', {}, 'invalid-dimensions'],
        ['a width that is not a number', { width: '100abc' }, 'invalid-dimensions'],
        ['a width past the dimension cap', { width: '9000' }, 'invalid-dimensions'],
        ['a crop that leaves the image', { x: '700', y: '0', cropWidth: '400', cropHeight: '100', width: '100' }, 'invalid-crop'],
        ['a crop with a piece missing', { x: '0', y: '0', cropWidth: '100', width: '100' }, 'invalid-crop'],
        ['a crop that is not a number', { x: '0', y: '0', cropWidth: '10.5', cropHeight: '10', width: '100' }, 'invalid-crop'],
        ['a fit mode it does not have', { width: '100', fit: 'contain' }, 'invalid-fit'],
        ['a format it cannot write', { width: '100', format: 'webp' }, 'invalid-format'],
        ['a target that is not a number', { width: '100', targetBytes: 'lots' }, 'invalid-target'],
    ])('refuses %s', async (_label, options, code) => {
        const error = await refusalFrom(options);

        expect(error).toBeInstanceOf(JobError);
        expect(error.code).toBe(code);
    }, 60_000);

    it('names the two formats it can write', async () => {
        const error = await refusalFrom({ width: '100', format: 'webp' });

        for (const allowed of SIGNATURE_OUTPUT_FORMATS) {
            expect(error.message).toContain(allowed);
        }
    }, 60_000);
});

/* ------------------------------------------------------------------ *
 * 6. What the result says about where it came from
 * ------------------------------------------------------------------ */

describe('the result describes the source it started from', () => {
    it('reports the source size, not the cropped size', async () => {
        const result = await sign({
            x: '100', y: '50', cropWidth: '400', cropHeight: '200',
            width: '200', format: 'png',
        });

        expect(result.originalWidth).toBe(SOURCE_WIDTH);
        expect(result.originalHeight).toBe(SOURCE_HEIGHT);
        expect(result.sourceFormat).toBe('png');
    }, 60_000);

    it('names the file for the tool that made it', async () => {
        const result = await sign({ width: '200', format: 'png' });

        expect(result.filename).toContain('resizo-signature');
        expect(result.filename.endsWith('.png')).toBe(true);
    }, 60_000);
});
