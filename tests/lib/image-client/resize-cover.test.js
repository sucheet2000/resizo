/**
 * Two sides means COVER, and this file proves it in pixels.
 *
 * When a caller supplies both a width and a height, sharp's default fit is
 * 'cover': it scales the image until it FILLS the box, keeping the shape, and
 * trims the overflow evenly off the two opposite edges. The browser engine used
 * to resample straight to width x height instead, which STRETCHES. Both answers
 * are the right size, so every dimension test in the suite passed while faces
 * came out squashed — a check on the numbers alone could never have caught it.
 * (The numbers themselves are pinned in tests/lib/image/dimensions.test.js,
 * where the caps on a DERIVED side are walked pixel by pixel.)
 *
 * THE ORACLE IS REAL LIBVIPS, not a second copy of our own arithmetic.
 * `referenceBytes` below runs sharp(buffer).rotate().resize({ width, height })
 * into a lossless PNG. This was first written against the resize route handler,
 * importing POST and posting a real multipart body, and it passed there; the
 * oracle is called directly because the route has been deleted, and a test this
 * load-bearing should not die with it. Nothing about what is asserted changed:
 * sharp is the reference either way, and it is a FIXTURE TOOL here in the same
 * sense as everywhere else in this directory — it never appears on the client
 * path under test.
 *
 * THE FIXTURE IS THE ARGUMENT. The source is a grid of flat blocks whose colour
 * encodes its column and row, so every sample point names the piece of the
 * SOURCE it came from. A cover crop and a stretch keep different pieces and
 * disagree about it by whole blocks rather than by a few levels of grey — no
 * tolerance can hide the difference. Three things are asserted per sample: the
 * engine matches libvips, both of them carry the block the cover geometry puts
 * there, and the blocks the crop throws away appear in neither output.
 *
 * WHY THE SAMPLES SIT IN BLOCK INTERIORS. libvips resamples in sRGB and
 * @jsquash/resize is asked for linear light (see resizeImageData), so the two
 * blend a hard edge differently by design. Inside a flat block every kernel
 * that sums to one returns the same colour, which is why the geometry can be
 * compared exactly while the seams are left alone.
 *
 * The sample points and their expected blocks are written out by hand rather
 * than derived, so this file cannot agree with a wrong implementation by
 * sharing its arithmetic.
 */
import sharp from 'sharp';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { installBrowserEnv } from './helpers/browser-env';

/** 25 px blocks: the 200x100 source is 8 columns by 4 rows. */
const BLOCK = 25;
const SOURCE = { width: 200, height: 100 };

let centreCropRect;
let coverDimensions;
let resampleSize;
let runOperation;
let FIT_COVER;

beforeAll(async () => {
    installBrowserEnv();
    ({ centreCropRect, coverDimensions, resampleSize, FIT_COVER } = await import('@/lib/image-client/resize'));
    ({ runOperation } = await import('@/lib/image-client/operations'));
});

/**
 * Both varying channels are monotonic in their axis and spaced far wider than
 * any ringing a lanczos kernel produces, so "this pixel came from column 2" is
 * decidable from the pixel alone.
 */
function blockColour(column, row) {
    return [20 + column * 30, 20 + row * 70, column % 2 === 0 ? 40 : 220];
}

function gridPixels(width, height) {
    const pixels = Buffer.alloc(width * height * 3);

    for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
            const [r, g, b] = blockColour(Math.floor(x / BLOCK), Math.floor(y / BLOCK));
            const offset = (y * width + x) * 3;
            pixels[offset] = r;
            pixels[offset + 1] = g;
            pixels[offset + 2] = b;
        }
    }

    return pixels;
}

function gridPng(width = SOURCE.width, height = SOURCE.height) {
    return sharp(gridPixels(width, height), { raw: { width, height, channels: 3 } }).png().toBuffer();
}

/* ------------------------------------------------------------------ *
 * The geometry
 * ------------------------------------------------------------------ */

describe('covering a box', () => {
    it('scales by the larger ratio so neither side falls short', () => {
        expect(coverDimensions(200, 100, 50, 50)).toEqual({ width: 100, height: 50 });
    });

    it('covers upwards when the target is wider than the source shape', () => {
        expect(coverDimensions(200, 100, 300, 50)).toEqual({ width: 300, height: 150 });
    });

    it('lands on the target itself when the target is on the source ratio', () => {
        expect(coverDimensions(200, 100, 100, 50)).toEqual({ width: 100, height: 50 });
    });

    it('never returns a side shorter than the target it has to cover', () => {
        const cover = coverDimensions(1023, 767, 400, 133);
        expect(cover.width).toBeGreaterThanOrEqual(400);
        expect(cover.height).toBeGreaterThanOrEqual(133);
    });

    it('hands back the target when the source size is unknown', () => {
        expect(coverDimensions(null, null, 40, 20)).toEqual({ width: 40, height: 20 });
    });
});

describe('the centred rectangle', () => {
    it('splits the overflow evenly', () => {
        expect(centreCropRect(100, 50, 50, 50)).toEqual({ x: 25, y: 0, width: 50, height: 50 });
    });

    it('leaves the odd pixel on the bottom right, as libvips does', () => {
        expect(centreCropRect(101, 50, 50, 50)).toEqual({ x: 25, y: 0, width: 50, height: 50 });
        expect(centreCropRect(100, 51, 50, 50)).toEqual({ x: 25, y: 0, width: 50, height: 50 });
    });

    it('never asks for a rectangle bigger than the image', () => {
        expect(centreCropRect(40, 20, 100, 100)).toEqual({ x: 0, y: 0, width: 40, height: 20 });
    });
});

describe('the size the resampler is asked for', () => {
    it('is the covering size for a two-sided target', () => {
        expect(resampleSize(200, 100, { width: 50, height: 50, fit: FIT_COVER }))
            .toEqual({ width: 100, height: 50 });
    });

    it('is the target itself when only one side was asked for', () => {
        expect(resampleSize(200, 100, { width: 50, height: 25 })).toEqual({ width: 50, height: 25 });
    });

    it('is nothing at all when there is no target', () => {
        expect(resampleSize(200, 100, null)).toBeNull();
    });
});

/* ------------------------------------------------------------------ *
 * The pixels, against libvips
 * ------------------------------------------------------------------ */

/**
 * The libvips answer to the same two-sided request, as an independent
 * reference. sharp's default fit is 'cover', which is the geometry under test.
 * There is no decode cap here because there is no longer a route with one — the
 * source ceiling that matters now is HARD_MAX_SOURCE_PIXELS in
 * lib/image-client/capability.js, and it is far below anything this fixture
 * reaches.
 */
function referenceBytes(source, { width, height }) {
    return sharp(source)
        .rotate()
        .resize({ width, height })
        .png({ compressionLevel: 9 })
        .toBuffer();
}

async function localBytes(source, { width, height }) {
    const result = await runOperation('resize', new File([source], 'grid.png', { type: 'image/png' }), {
        width: String(width),
        height: String(height),
        format: 'png',
        sourceWidth: SOURCE.width,
        sourceHeight: SOURCE.height,
    });
    return Buffer.from(await result.blob.arrayBuffer());
}

/** RGBA rows, so an encoder that writes an alpha channel and one that does not compare. */
async function rgba(bytes) {
    const { data, info } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    return { data, width: info.width, height: info.height };
}

function pixelAt(image, x, y) {
    const offset = (y * image.width + x) * 4;
    return [image.data[offset], image.data[offset + 1], image.data[offset + 2]];
}

function near(actual, expected, tolerance) {
    return actual.every((value, index) => Math.abs(value - expected[index]) <= tolerance);
}

/**
 * Every case supplies BOTH sides, which is the only shape that reaches cover.
 * `samples` are output coordinates paired with the source block the cover
 * geometry puts there; `absent` names the blocks the crop throws away, which
 * must then appear nowhere in either output.
 */
const CASES = [
    {
        label: 'a target squarer than the source trims the left and right',
        target: { width: 50, height: 50 },
        samples: [
            { x: 6, y: 6, column: 2, row: 0 },
            { x: 18, y: 18, column: 3, row: 1 },
            { x: 31, y: 31, column: 4, row: 2 },
            { x: 43, y: 43, column: 5, row: 3 },
            { x: 6, y: 43, column: 2, row: 3 },
            { x: 43, y: 6, column: 5, row: 0 },
        ],
        absent: [[0, 0], [1, 1], [6, 2], [7, 3]],
    },
    {
        label: 'a target wider than the source trims the top and bottom',
        target: { width: 300, height: 50 },
        samples: [
            { x: 18, y: 5, column: 0, row: 1 },
            { x: 93, y: 5, column: 2, row: 1 },
            { x: 168, y: 44, column: 4, row: 2 },
            { x: 281, y: 44, column: 7, row: 2 },
        ],
        absent: [[0, 0], [3, 0], [5, 3], [7, 3]],
    },
    {
        label: 'a target on the source’s own ratio trims nothing',
        target: { width: 100, height: 50 },
        samples: [
            { x: 6, y: 6, column: 0, row: 0 },
            { x: 43, y: 18, column: 3, row: 1 },
            { x: 56, y: 31, column: 4, row: 2 },
            { x: 93, y: 43, column: 7, row: 3 },
        ],
        absent: [],
    },
    {
        label: 'a square target on a fractional scale trims the left and right',
        target: { width: 90, height: 90 },
        samples: [
            { x: 11, y: 11, column: 2, row: 0 },
            { x: 34, y: 34, column: 3, row: 1 },
            { x: 56, y: 56, column: 4, row: 2 },
            { x: 79, y: 79, column: 5, row: 3 },
        ],
        absent: [[0, 0], [1, 3], [6, 1], [7, 2]],
    },
];

describe('a two-sided resize covers and crops, and matches libvips doing it', () => {
    it.each(CASES)('$label', async ({ target, samples, absent }) => {
        const png = await gridPng();

        const server = await rgba(await referenceBytes(png, target));
        const local = await rgba(await localBytes(png, target));

        expect({ width: server.width, height: server.height }).toEqual(target);
        expect({ width: local.width, height: local.height }).toEqual(target);

        for (const { x, y, column, row } of samples) {
            const expected = blockColour(column, row);
            const serverPixel = pixelAt(server, x, y);
            const localPixel = pixelAt(local, x, y);

            expect(
                near(serverPixel, expected, 4),
                `sharp at ${x},${y} is ${serverPixel} — block ${column},${row} is ${expected}`,
            ).toBe(true);

            expect(
                near(localPixel, expected, 4),
                `browser at ${x},${y} is ${localPixel} — block ${column},${row} is ${expected}`,
            ).toBe(true);

            expect(
                near(localPixel, serverPixel, 4),
                `browser at ${x},${y} is ${localPixel}, sharp is ${serverPixel}`,
            ).toBe(true);
        }

        for (const [column, row] of absent) {
            const trimmed = blockColour(column, row);

            for (const [name, image] of [['sharp', server], ['browser', local]]) {
                let found = null;

                for (let y = 0; y < image.height && !found; y += 1) {
                    for (let x = 0; x < image.width; x += 1) {
                        if (near(pixelAt(image, x, y), trimmed, 8)) {
                            found = { x, y };
                            break;
                        }
                    }
                }

                expect(
                    found,
                    `${name} kept trimmed block ${column},${row} (${trimmed}) at ${found?.x},${found?.y}`,
                ).toBeNull();
            }
        }
    }, 30_000);
});

/* ------------------------------------------------------------------ *
 * The native lane, where a naive fix does not reach
 * ------------------------------------------------------------------ */

/**
 * The cases above run through the WASM lane, because Node has no
 * createImageBitmap. In a real browser the common case is the OTHER lane: the
 * native decode-and-downscale, `createImageBitmap(blob, { resizeWidth,
 * resizeHeight })`.
 *
 * That call STRETCHES to whatever box it is handed. It has no fit option and it
 * does not preserve the ratio. So a two-sided target that reaches it unchanged
 * comes back squashed no matter how carefully the rest of the engine covers and
 * crops — the resample already happened, inside the browser, at the wrong
 * shape. That is how the stretch survives a fix applied only to the
 * resizeImageData path, and it is what these two tests pin: the box handed to
 * the browser is the COVERING box, and the crop happens after it.
 *
 * The browser here is a stand-in and it is honest about what it stands for: it
 * fills exactly the box it is given by sampling the source across it, which is
 * what a stretch is. Nothing else is faked — the gates, the crop, the PNG
 * encoder and the pixels are all real.
 */
function installFakeBrowserDecoder() {
    const calls = [];

    globalThis.createImageBitmap = async (source, options = {}) => {
        const width = options.resizeWidth ?? source?.width ?? SOURCE.width;
        const height = options.resizeHeight ?? source?.height ?? SOURCE.height;

        calls.push({ width, height, options });

        const data = new Uint8ClampedArray(width * height * 4);

        for (let y = 0; y < height; y += 1) {
            for (let x = 0; x < width; x += 1) {
                const sourceX = Math.min(SOURCE.width - 1, Math.floor((x * SOURCE.width) / width));
                const sourceY = Math.min(SOURCE.height - 1, Math.floor((y * SOURCE.height) / height));
                const [r, g, b] = blockColour(Math.floor(sourceX / BLOCK), Math.floor(sourceY / BLOCK));
                const offset = (y * width + x) * 4;
                data[offset] = r;
                data[offset + 1] = g;
                data[offset + 2] = b;
                data[offset + 3] = 255;
            }
        }

        return { width, height, data, close() {} };
    };

    globalThis.OffscreenCanvas = class FakeOffscreenCanvas {
        constructor(width, height) {
            this.width = width;
            this.height = height;
            this.bitmap = null;
        }

        getContext() {
            return {
                drawImage: (bitmap) => { this.bitmap = bitmap; },
                getImageData: (x, y, width, height) => new ImageData(
                    new Uint8ClampedArray(this.bitmap.data),
                    width,
                    height,
                ),
            };
        }
    };

    return calls;
}

async function sampleRow(bytes, y, columns) {
    const { data, info } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    return columns.map((x) => {
        const offset = (y * info.width + x) * 4;
        return [data[offset], data[offset + 1], data[offset + 2]];
    });
}

describe('the native decode path is handed the covering box, not the target', () => {
    afterEach(() => {
        delete globalThis.createImageBitmap;
        delete globalThis.OffscreenCanvas;
    });

    it('asks the browser for 100x50 for a 50x50 target on a 200x100 source', async () => {
        const calls = installFakeBrowserDecoder();
        const png = await gridPng();

        const result = await runOperation('resize', new File([png], 'grid.png', { type: 'image/png' }), {
            width: '50',
            height: '50',
            format: 'png',
            sourceWidth: SOURCE.width,
            sourceHeight: SOURCE.height,
        });

        expect(calls.map(({ width, height }) => ({ width, height })))
            .toEqual([{ width: 100, height: 50 }]);

        expect({ width: result.width, height: result.height }).toEqual({ width: 50, height: 50 });

        // Output x maps to source x = (x + 25) * 2, so the four surviving
        // columns are 2, 3, 4 and 5 — and 0, 1, 6 and 7 are gone. A stretch
        // would have kept all eight at a quarter of the width.
        const bytes = Buffer.from(await result.blob.arrayBuffer());
        expect(await sampleRow(bytes, 6, [6, 18, 31, 43])).toEqual([
            blockColour(2, 0),
            blockColour(3, 0),
            blockColour(4, 0),
            blockColour(5, 0),
        ]);
    });

    it('still asks for the target itself when only one side was given', async () => {
        const calls = installFakeBrowserDecoder();
        const png = await gridPng();

        const result = await runOperation('resize', new File([png], 'grid.png', { type: 'image/png' }), {
            width: '50',
            format: 'png',
            sourceWidth: SOURCE.width,
            sourceHeight: SOURCE.height,
        });

        expect(calls.map(({ width, height }) => ({ width, height })))
            .toEqual([{ width: 50, height: 25 }]);
        expect({ width: result.width, height: result.height }).toEqual({ width: 50, height: 25 });
    });
});
