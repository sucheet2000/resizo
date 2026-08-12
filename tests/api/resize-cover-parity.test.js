/**
 * Two-sided resize, pixel for pixel, against the route that is the reference.
 *
 * tests/api/resize-target-parity.test.js proves the two builds agree on the
 * DIMENSIONS. That is not enough, and the gap between the two is exactly where
 * this bug lived: when a caller supplies both a width and a height, sharp's
 * default fit is 'cover' — it scales the image until it FILLS the box and trims
 * the overflow, keeping the shape — while the browser engine used to resample
 * straight to width x height, which stretches. Both answers are the right size.
 * Only one of them is the right picture, and a squashed face passes every
 * dimension test ever written.
 *
 * So this file asserts pixels, and it does it against the real handler with
 * real sharp on one side and the real WASM engine on the other.
 *
 * THE FIXTURE IS THE ARGUMENT. The source is a grid of flat blocks whose colour
 * encodes its column and row, so every sample point names the piece of the
 * SOURCE it came from. A cover crop and a stretch keep different pieces, and
 * they disagree about it by whole blocks rather than by a few levels of grey —
 * a tolerance can never hide the difference.
 *
 * Two things are asserted for every sample:
 *
 *   1. the browser lane matches the server lane, and
 *   2. both of them carry the block the COVER geometry says belongs there
 *
 * plus, for the cases that really do crop, that the trimmed-away blocks appear
 * in neither output at all.
 *
 * WHY THE SAMPLES SIT IN BLOCK INTERIORS. libvips resamples in sRGB and
 * @jsquash/resize is asked for linear light (see resizeImageData), so the two
 * lanes blend a hard edge differently by design. Inside a flat block every
 * kernel that sums to one returns the same colour, which is why the geometry
 * can be compared exactly while the seams are left alone.
 *
 * The sample points and their expected blocks are written out by hand rather
 * than derived, so this file cannot agree with a wrong implementation by
 * sharing its arithmetic.
 */
import sharp from 'sharp';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { POST } from '@/app/api/resize/route';
import { installBrowserEnv } from '../lib/image-client/helpers/browser-env';
import { allowLimiter, clearLimiters } from './helpers/limiter';
import { buildFormData, makeFile, postRequest, readBytes } from './helpers/request';

const URL_UNDER_TEST = 'http://localhost:3000/api/resize';

/** 25 px blocks: a 200x100 source is 8 columns by 4 rows. */
const BLOCK = 25;

let runOperation;

beforeAll(async () => {
    installBrowserEnv();
    ({ runOperation } = await import('@/lib/image-client/operations'));
});

beforeEach(() => {
    clearLimiters();
    allowLimiter('resize');
});

afterEach(() => {
    clearLimiters();
    vi.restoreAllMocks();
});

/**
 * The colour of one block. Both channels that vary are monotonic in their axis
 * and spaced far wider than any ringing a lanczos kernel can produce, so "this
 * pixel came from column 2" is decidable from the pixel alone.
 */
function blockColour(column, row) {
    return [20 + column * 30, 20 + row * 70, column % 2 === 0 ? 40 : 220];
}

/** A grid of flat blocks, as a PNG. Asymmetric in both axes on purpose. */
async function blockGridPng(width, height) {
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

    return sharp(pixels, { raw: { width, height, channels: 3 } }).png().toBuffer();
}

async function serverBytes(source, fields) {
    const body = buildFormData({
        file: makeFile(source, { name: 'grid.png', type: 'image/png' }),
        fields,
    });
    const response = await POST(postRequest(URL_UNDER_TEST, body));
    expect(response.status).toBe(200);
    return readBytes(response);
}

async function localBytes(source, { width, height }, sourceSize) {
    const result = await runOperation('resize', makeFile(source, { name: 'grid.png', type: 'image/png' }), {
        width: String(width),
        height: String(height),
        format: 'png',
        sourceWidth: sourceSize.width,
        sourceHeight: sourceSize.height,
    });
    return Buffer.from(await result.blob.arrayBuffer());
}

/** RGBA rows, so a lane that writes an alpha channel and one that does not compare. */
async function rgba(bytes) {
    const { data, info } = await sharp(bytes)
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
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
 * Every case supplies BOTH sides, which is the only shape that reaches sharp's
 * cover behaviour. `samples` are output coordinates paired with the source
 * block that the cover geometry puts there; `absent` names the blocks the crop
 * throws away, which must then appear nowhere in either output.
 */
const CASES = [
    {
        label: 'a target squarer than the source trims the left and right',
        source: { width: 200, height: 100 },
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
        source: { width: 200, height: 100 },
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
        source: { width: 200, height: 100 },
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
        source: { width: 200, height: 100 },
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

describe('/resize with both sides supplied covers and crops in both lanes', () => {
    it.each(CASES)('$label', async ({ source, target, samples, absent }) => {
        const png = await blockGridPng(source.width, source.height);

        const server = await rgba(await serverBytes(png, {
            width: String(target.width),
            height: String(target.height),
            format: 'png',
        }));
        const local = await rgba(await localBytes(png, target, source));

        expect({ width: server.width, height: server.height }).toEqual(target);
        expect({ width: local.width, height: local.height }).toEqual(target);

        for (const { x, y, column, row } of samples) {
            const expected = blockColour(column, row);
            const serverPixel = pixelAt(server, x, y);
            const localPixel = pixelAt(local, x, y);

            expect(
                near(serverPixel, expected, 4),
                `server at ${x},${y} is ${serverPixel} — block ${column},${row} is ${expected}`,
            ).toBe(true);

            expect(
                near(localPixel, expected, 4),
                `browser at ${x},${y} is ${localPixel} — block ${column},${row} is ${expected}`,
            ).toBe(true);

            expect(
                near(localPixel, serverPixel, 4),
                `browser at ${x},${y} is ${localPixel}, server is ${serverPixel}`,
            ).toBe(true);
        }

        for (const [column, row] of absent) {
            const trimmed = blockColour(column, row);

            for (const [name, image] of [['server', server], ['browser', local]]) {
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
