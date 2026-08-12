/**
 * Cover-then-crop, and the one path where a naive fix does not reach.
 *
 * tests/api/resize-cover-parity.test.js proves the pixels against the real
 * route, but it proves them through the WASM lane, because Node has no
 * createImageBitmap. In a real browser the common case is the OTHER lane: the
 * native decode-and-downscale, which is `createImageBitmap(blob, { resizeWidth,
 * resizeHeight })`.
 *
 * That call STRETCHES to whatever box it is handed. It does not preserve the
 * ratio and it has no fit option. So a two-sided target that reaches it
 * unchanged comes back squashed no matter how carefully the rest of the engine
 * covers and crops — the resample already happened, inside the browser, at the
 * wrong shape. That is the subtle way the stretch bug survives a fix applied
 * only to the resizeImageData path, and it is what the second half of this file
 * pins: the box handed to the browser is the COVERING box, and the crop happens
 * after it.
 *
 * The browser here is a stand-in, and it is honest about what it stands for: it
 * scales by sampling the source into exactly the box it was given, which is what
 * a stretch is. Give it the right box and the picture is right; give it the
 * target and the picture is squashed. Nothing else about the engine is faked —
 * the gates, the crop, the PNG encoder and the pixels are all real.
 */
import sharp from 'sharp';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { installBrowserEnv } from './helpers/browser-env';

/** 25 px columns over a 200 px source: eight of them, each its own colour. */
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

function columnColour(column) {
    return [20 + column * 30, 60, column % 2 === 0 ? 40 : 220];
}

function sourcePixels(width, height) {
    const pixels = Buffer.alloc(width * height * 3);
    for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
            const [r, g, b] = columnColour(Math.floor(x / BLOCK));
            const offset = (y * width + x) * 3;
            pixels[offset] = r;
            pixels[offset + 1] = g;
            pixels[offset + 2] = b;
        }
    }
    return pixels;
}

function sourcePng() {
    return sharp(sourcePixels(SOURCE.width, SOURCE.height), {
        raw: { width: SOURCE.width, height: SOURCE.height, channels: 3 },
    }).png().toBuffer();
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
 * The native lane
 * ------------------------------------------------------------------ */

/**
 * A createImageBitmap that behaves like the real one in the way that matters:
 * it fills exactly the box it is given, sampling the source across it. Given a
 * box off the source's ratio it therefore squashes, which is the truth about
 * the browser API and the reason the box has to be the covering one.
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
                const [r, g, b] = columnColour(Math.floor(sourceX / BLOCK));
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

async function outputColumns(bytes, samples) {
    const { data, info } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    return samples.map((x) => {
        const offset = ((info.height >> 1) * info.width + x) * 4;
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
        const png = await sourcePng();

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
        // columns are 2, 3, 4 and 5 — and columns 0, 1, 6 and 7 are gone. A
        // stretch would have kept all eight at a quarter of the width.
        const bytes = Buffer.from(await result.blob.arrayBuffer());
        expect(await outputColumns(bytes, [6, 18, 31, 43])).toEqual([
            columnColour(2),
            columnColour(3),
            columnColour(4),
            columnColour(5),
        ]);
    });

    it('still asks for the target itself when only one side was given', async () => {
        const calls = installFakeBrowserDecoder();
        const png = await sourcePng();

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
