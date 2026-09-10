/**
 * Metamorphic relations for the `fit` op.
 *
 * The suite in fit.test.js asks "given THIS source and THIS box, is THAT the
 * output?" — a question that can only be asked where somebody has already
 * worked out the right answer by hand, which caps it at a handful of shapes.
 * The interesting failures are not in the shapes somebody thought to write
 * down. They are at the rounding boundaries: a 901x447 source into a 333x222
 * box, where a derived side lands on .5 and one implementation floors it and
 * another rounds it, and the output is 332 pixels wide on a form that demanded
 * 333.
 *
 * So this file asserts RELATIONS instead, over a table of twelve source/target
 * pairs chosen to cross every boundary the arithmetic has: portrait into
 * landscape and back, an upscale and a downscale, a square into a rectangle, a
 * 10:3 banner into a square, and two pairs of odd primes where nothing divides
 * evenly. None of the four relations needs anybody to know the right answer:
 *
 *   1. the output has EXACTLY the pixels that were asked for — always, for
 *      every geometry, on every pair. This is the op's whole promise and the
 *      one thing it may never trade away.
 *   2. the byte count the result reports is the byte count the blob has, and
 *      when a ceiling was set both are under it. A result panel that printed a
 *      number the file did not match would be worse than no number.
 *   3. a crop rectangle never leaves the source it was taken from.
 *   4. a `contain` never changes the shape of the picture — measured on the
 *      padded output by finding where the fill stops, not by asking the code
 *      what it intended.
 *
 * Every pair runs against sharp, which knows nothing about what this engine
 * meant to do.
 */
import sharp from 'sharp';
import { beforeAll, describe, expect, it } from 'vitest';

import { MAX_DIMENSION } from '@/lib/limits';
import { installBrowserEnv } from './helpers/browser-env';
import { makeFile, noiseJpeg } from './helpers/fixtures';

const KB = 1024;

/**
 * The twelve pairs, and why each one is here.
 *
 * Between them they cover: a wide source into a square and a tall source into
 * the same square (the binding axis swaps); a box bigger than the source on
 * both sides (an upscale, which takes the WASM resampler rather than the native
 * one); a square into both a wide and a tall box; an extreme 10:3 banner both
 * ways; and two pairs whose sides share no common factor, where every derived
 * dimension lands mid-pixel.
 */
const PAIRS = [
    { source: [800, 400], target: [200, 200] },
    { source: [400, 800], target: [200, 200] },
    { source: [640, 480], target: [413, 531] },
    { source: [480, 640], target: [600, 600] },
    { source: [500, 500], target: [300, 200] },
    { source: [300, 200], target: [200, 300] },
    { source: [1000, 300], target: [350, 350] },
    { source: [300, 1000], target: [350, 350] },
    { source: [720, 540], target: [120, 160] },
    { source: [540, 720], target: [160, 120] },
    { source: [640, 640], target: [200, 200] },
    { source: [901, 447], target: [333, 222] },
];

const GEOMETRIES = ['cover', 'contain', 'stretch'];

/** Far enough from the white fill that no resampler can turn one into the other. */
const PICTURE = { r: 40, g: 60, b: 200 };

let runOperation;

beforeAll(async () => {
    installBrowserEnv();
    ({ runOperation } = await import('@/lib/image-client/operations'));
});

const cache = new Map();

/** A flat block of one colour, so the edge of the picture is unambiguous. */
function sourceFile(width, height) {
    const key = `${width}x${height}`;
    if (!cache.has(key)) {
        cache.set(key, sharp({ create: { width, height, channels: 3, background: PICTURE } })
            .png()
            .toBuffer()
            .then((bytes) => makeFile(bytes, { name: 'photo.png', type: 'image/png' })));
    }
    return cache.get(key);
}

async function fitPair({ source, target }, options = {}) {
    const file = await sourceFile(source[0], source[1]);
    return runOperation('fit', file, {
        width: String(target[0]),
        height: String(target[1]),
        format: 'png',
        background: 'white',
        ...options,
    });
}

const label = ({ source, target }) => `${source[0]}x${source[1]} into ${target[0]}x${target[1]}`;

/* ------------------------------------------------------------------ *
 * 1. The dimensions are exact. Always.
 * ------------------------------------------------------------------ */

describe('the output has exactly the pixels that were asked for', () => {
    it.each(
        PAIRS.flatMap((pair) => GEOMETRIES.map((geometry) => [`${label(pair)} by ${geometry}`, pair, geometry])),
    )('%s', async (_name, pair, geometry) => {
        const result = await fitPair(pair, { geometry });
        const meta = await sharp(Buffer.from(await result.blob.arrayBuffer())).metadata();

        expect({ width: result.width, height: result.height })
            .toEqual({ width: pair.target[0], height: pair.target[1] });
        expect({ width: meta.width, height: meta.height })
            .toEqual({ width: pair.target[0], height: pair.target[1] });
        expect(result.verified).toBe(true);
    }, 120_000);
});

/* ------------------------------------------------------------------ *
 * 2. The reported bytes are the file's bytes
 * ------------------------------------------------------------------ */

describe('the byte count the result reports', () => {
    it.each(PAIRS.slice(0, 6).map((pair) => [label(pair), pair]))(
        'is the length of the blob it came with, for %s',
        async (_name, pair) => {
            const result = await fitPair(pair);

            expect(result.resultBytes).toBe(result.blob.size);
            expect(result.resultBytes).toBe((await result.blob.arrayBuffer()).byteLength);
        },
        120_000,
    );

    /**
     * Noise rather than a flat block: a flat picture is a few hundred bytes at
     * any quality, so a ceiling it never approaches proves nothing about the
     * search. These four all encode well above the ceiling at the default
     * quality and have to be searched down to it.
     */
    it.each([
        [400, 400, 30 * KB],
        [300, 300, 20 * KB],
        [250, 350, 15 * KB],
        [350, 250, 25 * KB],
    ])('holds under a ceiling for a %ix%i box at %i bytes', async (width, height, ceiling) => {
        const source = makeFile(await noiseJpeg({ width: 900, height: 900, quality: 95 }), {
            name: 'photo.jpg',
            type: 'image/jpeg',
        });

        const result = await runOperation('fit', source, {
            width: String(width),
            height: String(height),
            format: 'jpeg',
            targetBytes: String(ceiling),
        });

        const real = (await result.blob.arrayBuffer()).byteLength;

        expect(result.resultBytes).toBe(real);
        expect(real).toBeLessThanOrEqual(ceiling);
        expect({ width: result.width, height: result.height }).toEqual({ width, height });
        expect(result.resized).toBe(false);
        expect(result.verified).toBe(true);
    }, 180_000);
});

/* ------------------------------------------------------------------ *
 * 3. A crop never leaves the picture it was taken from
 * ------------------------------------------------------------------ */

describe('the rectangle the result reports', () => {
    it.each(PAIRS.map((pair) => [label(pair), pair]))('stays inside the source, for %s', async (_name, pair) => {
        const [sourceWidth, sourceHeight] = pair.source;
        const result = await fitPair(pair);

        expect(result.crop.x).toBeGreaterThanOrEqual(0);
        expect(result.crop.y).toBeGreaterThanOrEqual(0);
        expect(result.crop.x + result.crop.width).toBeLessThanOrEqual(sourceWidth);
        expect(result.crop.y + result.crop.height).toBeLessThanOrEqual(sourceHeight);
        expect(result.originalWidth).toBe(sourceWidth);
        expect(result.originalHeight).toBe(sourceHeight);
    }, 120_000);

    it.each(PAIRS.slice(0, 6).map((pair) => [label(pair), pair]))(
        'stays inside the source when one was supplied too, for %s',
        async (_name, pair) => {
            const [sourceWidth, sourceHeight] = pair.source;
            const rect = {
                x: Math.floor(sourceWidth / 8),
                y: Math.floor(sourceHeight / 8),
                width: Math.floor(sourceWidth / 2),
                height: Math.floor(sourceHeight / 2),
            };

            const result = await fitPair(pair, {
                x: String(rect.x),
                y: String(rect.y),
                cropWidth: String(rect.width),
                cropHeight: String(rect.height),
            });

            expect(result.crop).toEqual(rect);
            expect(result.crop.x + result.crop.width).toBeLessThanOrEqual(sourceWidth);
            expect(result.crop.y + result.crop.height).toBeLessThanOrEqual(sourceHeight);
        },
        120_000,
    );
});

/* ------------------------------------------------------------------ *
 * 4. Contain never changes the shape of the picture
 * ------------------------------------------------------------------ */

/**
 * Where the fill stops, measured on the output rather than computed.
 *
 * The picture is centred, so the middle row and the middle column both run
 * through it; walking each one and counting the pixels that are not the fill
 * gives the picture's real width and height in the finished file.
 */
async function pictureExtent(blob) {
    const buffer = Buffer.from(await blob.arrayBuffer());
    const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });

    const isPicture = (x, y) => {
        const offset = (y * info.width + x) * 4;
        return Math.abs(data[offset] - PICTURE.r)
            + Math.abs(data[offset + 1] - PICTURE.g)
            + Math.abs(data[offset + 2] - PICTURE.b) < 90;
    };

    const midY = Math.floor(info.height / 2);
    const midX = Math.floor(info.width / 2);

    let width = 0;
    for (let x = 0; x < info.width; x += 1) if (isPicture(x, midY)) width += 1;

    let height = 0;
    for (let y = 0; y < info.height; y += 1) if (isPicture(midX, y)) height += 1;

    return { width, height, canvasWidth: info.width, canvasHeight: info.height };
}

describe('a contain fits the whole picture in without reshaping it', () => {
    it.each(PAIRS.map((pair) => [label(pair), pair]))('%s', async (_name, pair) => {
        const [sourceWidth, sourceHeight] = pair.source;
        const result = await fitPair(pair, { geometry: 'contain' });
        const extent = await pictureExtent(result.blob);

        // The picture is inside the box, and touches it on exactly one axis —
        // the one that ran out first. That is what "as large as it fits" means.
        expect(extent.width).toBeLessThanOrEqual(pair.target[0]);
        expect(extent.height).toBeLessThanOrEqual(pair.target[1]);
        expect(extent.width === pair.target[0] || extent.height === pair.target[1]).toBe(true);

        // And its shape is the source's, to within the one pixel a derived side
        // can be rounded by. Stated as a bound rather than a fixed tolerance so
        // it stays honest on the small boxes as well as the large ones.
        const sourceAspect = sourceWidth / sourceHeight;
        const outputAspect = extent.width / extent.height;
        const rounding = sourceAspect / Math.min(extent.width, extent.height);

        expect(Math.abs(outputAspect - sourceAspect)).toBeLessThanOrEqual(rounding);
    }, 120_000);

    /** The cover is the control: it fills the box, so nothing is ever left over. */
    it.each(PAIRS.slice(0, 6).map((pair) => [label(pair), pair]))(
        'where a cover instead fills the box completely, for %s',
        async (_name, pair) => {
            const result = await fitPair(pair, { geometry: 'cover' });
            const extent = await pictureExtent(result.blob);

            expect({ width: extent.width, height: extent.height })
                .toEqual({ width: pair.target[0], height: pair.target[1] });
        },
        120_000,
    );
});

/* ------------------------------------------------------------------ *
 * 5. A box that cannot be honoured is refused, not approximated
 * ------------------------------------------------------------------ */

describe('a target size the engine will not honour', () => {
    it.each([
        ['zero width', { width: '0', height: '200' }],
        ['zero height', { width: '200', height: '0' }],
        ['a negative height', { width: '200', height: '-200' }],
        ['a fractional width', { width: '200.5', height: '200' }],
        ['a width in exponent form', { width: '2e3', height: '200' }],
        ['a width with units attached', { width: '200px', height: '200' }],
        ['a padded pair of empty strings', { width: '  ', height: '  ' }],
        ['one side past the per-side cap', { width: String(MAX_DIMENSION + 1), height: '10' }],
        ['both sides past the per-side cap', { width: '20000', height: '20000' }],
        ['a box inside the per-side cap but past the pixel budget', { width: '8000', height: '6000' }],
    ])('is refused for %s, with no file produced', async (_name, target) => {
        const file = await sourceFile(400, 300);

        await expect(runOperation('fit', file, { ...target, format: 'png' }))
            .rejects.toMatchObject({ name: 'JobError', code: 'invalid-dimensions' });
    }, 60_000);

    /**
     * The intake comes first, and that ordering is the one in this engine's own
     * order of operations: the file gate and the magic-byte check run before a
     * single option is looked at. So a file that is not an image is named as a
     * bad FILE even when the box is nonsense too — which is the right complaint,
     * because fixing the box would not have helped.
     */
    it('is not the first thing said when the upload was never an image', async () => {
        const broken = makeFile(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]), { name: 'x.png', type: 'image/png' });

        await expect(runOperation('fit', broken, { width: '0', height: '0' }))
            .rejects.toMatchObject({ name: 'JobError', code: 'invalid-type' });
    }, 60_000);
});
