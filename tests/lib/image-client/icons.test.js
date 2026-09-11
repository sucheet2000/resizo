/**
 * The `icons` op — one mark, the whole favicon package.
 *
 * WHY THIS OP EXISTS RATHER THAN SIX TRIPS THROUGH /resize
 *
 * A favicon package is not six resizes. It is six resizes that have to agree
 * with one another and with three files that describe them: the ICO container
 * that holds three of the PNGs, the manifest that names two of them, and the
 * HTML that links four. Every one of those is a place a filename or a size can
 * drift, and every drift is silent — a browser handed a broken icon shows its
 * default and reports nothing, anywhere.
 *
 * WHAT IS ASSERTED HERE AND HOW
 *
 * sharp is the independent reference, as it is for every other op: nothing
 * below trusts the result object about what came out. Each PNG is reopened by
 * libvips and asked its format, its size and its pixels, and the ICO is parsed
 * back out of its own bytes. The geometry assertions are arithmetic on the
 * fixture rather than a measurement of lanczos3 — a 640 x 400 source contained
 * in a 512 box is 512 x 320 whatever the resampler does to the pixels in
 * between.
 *
 * WHY THE MARK IS A RECTANGLE AND THE FIELD IS TRANSPARENT
 *
 * The two things this op can get wrong that a dimension check cannot see are
 * distorting the mark and losing its transparency. A 2:1 rectangle on a
 * transparent field shows both: a contain that stretched would measure 1:1 in
 * the output, and a flatten that ran when no colour was chosen would put 255 in
 * the corner's alpha byte.
 */
import sharp from 'sharp';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { ICON_ASSETS, ICO_SIZES } from '@/lib/format/icon-package';
import { readIco } from '@/lib/image-client/ico';
import { installBrowserEnv } from './helpers/browser-env';
import { makeFile } from './helpers/fixtures';

const SOURCE_WIDTH = 640;
const SOURCE_HEIGHT = 400;

/** The mark: 2:1, opaque, centred on a transparent field. */
const MARK_WIDTH = 320;
const MARK_HEIGHT = 160;
const MARK = { r: 20, g: 160, b: 90 };

const RED = { r: 220, g: 30, b: 40 };
const BLUE = { r: 40, g: 60, b: 200 };

/** Every PNG the op encodes, largest last. 48 exists only inside the ICO. */
const PNG_SIZES = [16, 32, 180, 192, 512];

/** The package minus the manifest — the manifest is text the page builds. */
const EXPECTED_ASSETS = ICON_ASSETS.filter((asset) => asset.kind !== 'manifest');

let runOperation;
let JobError;

beforeAll(async () => {
    installBrowserEnv();
    ({ runOperation, JobError } = await import('@/lib/image-client/operations'));
});

/* ---------------------------------------------------------------- fixtures */

function markPng({ width = SOURCE_WIDTH, height = SOURCE_HEIGHT } = {}) {
    const markWidth = Math.round((MARK_WIDTH * width) / SOURCE_WIDTH);
    const markHeight = Math.round((MARK_HEIGHT * height) / SOURCE_HEIGHT);

    return sharp({
        create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
        .composite([{
            input: {
                create: {
                    width: markWidth,
                    height: markHeight,
                    channels: 4,
                    background: { ...MARK, alpha: 1 },
                },
            },
            left: Math.round((width - markWidth) / 2),
            top: Math.round((height - markHeight) / 2),
        }])
        .png()
        .toBuffer();
}

/** Left half red, right half blue, fully opaque: which part was kept is visible. */
function halvesPng() {
    return sharp({
        create: { width: SOURCE_WIDTH, height: SOURCE_HEIGHT, channels: 4, background: { ...BLUE, alpha: 1 } },
    })
        .composite([{
            input: {
                create: {
                    width: SOURCE_WIDTH / 2,
                    height: SOURCE_HEIGHT,
                    channels: 4,
                    background: { ...RED, alpha: 1 },
                },
            },
            left: 0,
            top: 0,
        }])
        .png()
        .toBuffer();
}

/** The same mark with no alpha channel at all, as a JPEG. */
function markJpeg() {
    return sharp({
        create: { width: SOURCE_WIDTH, height: SOURCE_HEIGHT, channels: 3, background: { r: 240, g: 240, b: 240 } },
    })
        .composite([{
            input: {
                create: {
                    width: MARK_WIDTH,
                    height: MARK_HEIGHT,
                    channels: 3,
                    background: MARK,
                },
            },
            left: (SOURCE_WIDTH - MARK_WIDTH) / 2,
            top: (SOURCE_HEIGHT - MARK_HEIGHT) / 2,
        }])
        .jpeg({ quality: 95 })
        .toBuffer();
}

async function markFile(size) {
    return makeFile(await markPng(size), { name: 'logo.png', type: 'image/png' });
}

function icons(file, options) {
    return runOperation('icons', file, options);
}

/* ----------------------------------------------------------------- readers */

/** One asset reopened by libvips, with a pixel accessor in image space. */
async function readBack(asset) {
    const buffer = Buffer.from(await asset.blob.arrayBuffer());
    const meta = await sharp(buffer).metadata();
    const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });

    return {
        format: meta.format,
        width: info.width,
        height: info.height,
        at(x, y) {
            const offset = (y * info.width + x) * 4;
            return Array.from(data.slice(offset, offset + 4));
        },
    };
}

/** The bounding box of every pixel that is not the transparent field. */
async function markBox(asset) {
    const buffer = Buffer.from(await asset.blob.arrayBuffer());
    const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });

    let left = info.width;
    let right = -1;
    let top = info.height;
    let bottom = -1;

    for (let y = 0; y < info.height; y += 1) {
        for (let x = 0; x < info.width; x += 1) {
            const offset = (y * info.width + x) * 4;
            // The mark is the only green thing in the picture.
            const isMark = data[offset + 3] > 200 && data[offset + 1] > data[offset] + 40;
            if (!isMark) continue;
            if (x < left) left = x;
            if (x > right) right = x;
            if (y < top) top = y;
            if (y > bottom) bottom = y;
        }
    }

    return { width: right - left + 1, height: bottom - top + 1 };
}

function assetOf(result, id) {
    return result.assets.find((asset) => asset.id === id);
}

async function expectJobError(promise, { code, message } = {}) {
    const error = await promise.then(
        () => { throw new Error('expected a JobError, but the job succeeded'); },
        (thrown) => thrown,
    );

    expect(error).toBeInstanceOf(JobError);
    if (code !== undefined) expect(error.code).toBe(code);
    if (message !== undefined) expect(error.message).toBe(message);

    return error;
}

/* ------------------------------------------------------------------ *
 * 1. The package: every file, once, in order
 * ------------------------------------------------------------------ */

describe('the package the op hands back', () => {
    let result;

    beforeAll(async () => {
        result = await icons(await markFile(), { geometry: 'cover', background: 'transparent' });
    }, 180_000);

    it('answers six assets — the five PNGs and the ICO — in package order', () => {
        expect(result.assets.map((asset) => asset.filename))
            .toEqual(EXPECTED_ASSETS.map((asset) => asset.filename));
        expect(result.assets.map((asset) => asset.id))
            .toEqual(EXPECTED_ASSETS.map((asset) => asset.id));
    });

    it('carries no single blob, because a package is not one file', () => {
        expect(result.blob).toBeNull();
    });

    it('states a byte length and a content type for every asset', () => {
        for (const asset of result.assets) {
            expect(asset.bytes).toBeGreaterThan(0);
            expect(asset.blob.size).toBe(asset.bytes);
            expect(asset.type).toBe(asset.filename.endsWith('.ico') ? 'image/x-icon' : 'image/png');
        }
    });

    it('gives every PNG its declared square size, measured by libvips', async () => {
        for (const size of PNG_SIZES) {
            const asset = result.assets.find((entry) => entry.width === size);
            const read = await readBack(asset);

            expect(read.format).toBe('png');
            expect([read.width, read.height]).toEqual([size, size]);
        }
    }, 60_000);

    it('describes the ICO by the sizes it holds rather than by one width', () => {
        const ico = assetOf(result, 'favicon-ico');

        expect(ico.sizes).toEqual(ICO_SIZES);
        expect(ico.width).toBeNull();
        expect(ico.height).toBeNull();
    });

    it('reports one check per asset and every one passing', () => {
        expect(result.checks.map((row) => row.key))
            .toEqual(EXPECTED_ASSETS.map((asset) => asset.filename));
        expect(result.checks.every((row) => row.ok)).toBe(true);
        expect(result.verified).toBe(true);

        for (const row of result.checks) {
            expect(typeof row.required).toBe('string');
            expect(row.actual).toBe(row.required);
        }
    });

    it('says the package is PNG and that nothing was traded for size', () => {
        expect(result.format).toBe('png');
        expect(result.resized).toBe(false);
        expect(result.operation).toBe('icons');
    });
});

/* ------------------------------------------------------------------ *
 * 2. favicon.ico holds the three icons, and the same bytes
 * ------------------------------------------------------------------ */

describe('favicon.ico', () => {
    let result;
    let parsed;

    beforeAll(async () => {
        result = await icons(await markFile(), { geometry: 'cover', background: 'white' });
        parsed = readIco(new Uint8Array(await assetOf(result, 'favicon-ico').blob.arrayBuffer()));
    }, 180_000);

    it('holds exactly 16, 32 and 48', () => {
        expect(parsed.count).toBe(3);
        expect(parsed.entries.map((entry) => entry.width)).toEqual(ICO_SIZES);
        expect(parsed.entries.map((entry) => entry.height)).toEqual(ICO_SIZES);
    });

    it('carries PNG payloads whose own IHDR agrees with the directory', () => {
        for (const entry of parsed.entries) {
            expect(entry.isPng).toBe(true);
            expect([entry.pngWidth, entry.pngHeight]).toEqual([entry.width, entry.height]);
        }
    });

    it.each([
        ['favicon-16', 16],
        ['favicon-32', 32],
    ])('embeds the very bytes of %s, rather than a second encode', async (id, size) => {
        const standalone = new Uint8Array(await assetOf(result, id).blob.arrayBuffer());
        const embedded = parsed.entries.find((entry) => entry.width === size).bytes;

        expect(Array.from(embedded)).toEqual(Array.from(standalone));
    });

    it('keeps 48 inside the container and out of the loose files', () => {
        expect(result.assets.some((asset) => asset.width === 48)).toBe(false);
        expect(parsed.entries.some((entry) => entry.width === 48)).toBe(true);
    });
});

/* ------------------------------------------------------------------ *
 * 3. Geometry: cover fills, contain fits, neither distorts
 * ------------------------------------------------------------------ */

describe('geometry', () => {
    it('contains the whole mark without distorting it', async () => {
        const result = await icons(await markFile(), { geometry: 'contain', background: 'transparent' });
        const box = await markBox(assetOf(result, 'android-512'));

        // The source is 640 x 400 and the box is 512, so the picture lands
        // 512 x 320 and the 2:1 mark lands 256 x 128.
        expect(box.width).toBeGreaterThanOrEqual(255);
        expect(box.width).toBeLessThanOrEqual(257);
        expect(box.height).toBeGreaterThanOrEqual(127);
        expect(box.height).toBeLessThanOrEqual(129);
        expect(box.width / box.height).toBeCloseTo(MARK_WIDTH / MARK_HEIGHT, 1);
    }, 180_000);

    it('pads the contained picture rather than stretching it, top and bottom', async () => {
        const result = await icons(await markFile(), { geometry: 'contain', background: 'black' });
        const read = await readBack(assetOf(result, 'favicon-32'));

        // 32 x 20 of picture on a 32 x 32 canvas: six rows of padding above.
        expect(read.at(16, 1)).toEqual([0, 0, 0, 255]);
        expect(read.at(16, 30)).toEqual([0, 0, 0, 255]);
    }, 180_000);

    it('keeps what the crop rectangle selected in cover mode', async () => {
        const file = makeFile(await halvesPng(), { name: 'halves.png', type: 'image/png' });

        const cropped = await icons(file, {
            geometry: 'cover',
            background: 'white',
            x: '0',
            y: '0',
            cropWidth: '320',
            cropHeight: '320',
        });
        const whole = await icons(
            makeFile(await halvesPng(), { name: 'halves.png', type: 'image/png' }),
            { geometry: 'cover', background: 'white' },
        );

        const fromLeft = await readBack(assetOf(cropped, 'favicon-32'));
        const fromCentre = await readBack(assetOf(whole, 'favicon-32'));

        // The crop is entirely inside the red half.
        expect(fromLeft.at(2, 16)[0]).toBeGreaterThan(180);
        expect(fromLeft.at(29, 16)[0]).toBeGreaterThan(180);
        expect(fromLeft.at(29, 16)[2]).toBeLessThan(80);

        // Without it the centre of the source is kept, and the seam with it.
        expect(fromCentre.at(2, 16)[0]).toBeGreaterThan(180);
        expect(fromCentre.at(29, 16)[2]).toBeGreaterThan(180);
    }, 240_000);

    it('refuses a frame that is not square', async () => {
        await expectJobError(
            icons(await markFile(), {
                geometry: 'cover',
                x: '0',
                y: '0',
                cropWidth: '300',
                cropHeight: '200',
            }),
            { code: 'invalid-crop' },
        );
    }, 60_000);

    it('accepts a frame one pixel off square, because a drag cannot be exact', async () => {
        const result = await icons(await markFile(), {
            geometry: 'cover',
            x: '0',
            y: '0',
            cropWidth: '301',
            cropHeight: '300',
        });

        expect(result.assets).toHaveLength(EXPECTED_ASSETS.length);
    }, 180_000);

    it('refuses a geometry it does not offer', async () => {
        await expectJobError(
            icons(await markFile(), { geometry: 'stretch' }),
            { code: 'invalid-geometry' },
        );
    }, 60_000);
});

/* ------------------------------------------------------------------ *
 * 4. Transparency: kept unless a colour was chosen
 * ------------------------------------------------------------------ */

describe('the background', () => {
    it('keeps the transparent field transparent in contain mode', async () => {
        const result = await icons(await markFile(), { geometry: 'contain', background: 'transparent' });
        const read = await readBack(assetOf(result, 'android-192'));

        expect(read.at(0, 0)[3]).toBe(0);
        expect(read.at(191, 191)[3]).toBe(0);
    }, 180_000);

    it("keeps the source's own alpha in cover mode", async () => {
        const result = await icons(await markFile(), { geometry: 'cover', background: 'transparent' });
        const read = await readBack(assetOf(result, 'android-192'));

        // Nothing is padded in a cover, so the corner is whatever the source
        // had there — and the source's field is empty.
        expect(read.at(0, 0)[3]).toBe(0);
        expect(read.at(96, 96)[3]).toBe(255);
    }, 180_000);

    it('defaults to keeping transparency when no background is asked for', async () => {
        const result = await icons(await markFile(), { geometry: 'contain' });
        const read = await readBack(assetOf(result, 'favicon-32'));

        expect(read.at(0, 0)[3]).toBe(0);
    }, 180_000);

    it.each([
        ['white', [255, 255, 255, 255]],
        ['black', [0, 0, 0, 255]],
        ['#ff00ff', [255, 0, 255, 255]],
    ])('composites the whole icon onto %s when it is chosen', async (background, pixel) => {
        const result = await icons(await markFile(), { geometry: 'contain', background });

        for (const id of ['favicon-16', 'android-512']) {
            const read = await readBack(assetOf(result, id));
            expect(read.at(0, 0)).toEqual(pixel);
        }
    }, 240_000);

    it('flattens a cover onto the colour too, not only the padded margins', async () => {
        const result = await icons(await markFile(), { geometry: 'cover', background: '#ff00ff' });
        const read = await readBack(assetOf(result, 'favicon-32'));

        expect(read.at(0, 0)).toEqual([255, 0, 255, 255]);
    }, 180_000);
});

/* ------------------------------------------------------------------ *
 * 5. A source with no alpha, and a source that is too small
 * ------------------------------------------------------------------ */

describe('the source', () => {
    it.each(['cover', 'contain'])('accepts a JPEG with no alpha channel in %s mode', async (geometry) => {
        const file = makeFile(await markJpeg(), { name: 'logo.jpg', type: 'image/jpeg' });
        const result = await icons(file, { geometry, background: 'transparent' });

        expect(result.assets).toHaveLength(EXPECTED_ASSETS.length);
        const read = await readBack(assetOf(result, 'favicon-32'));
        expect(read.format).toBe('png');
        expect([read.width, read.height]).toEqual([32, 32]);
    }, 240_000);

    it('says when the square it was given is smaller than the largest icon', async () => {
        const result = await icons(
            makeFile(await markPng({ width: 128, height: 128 }), { name: 'small.png', type: 'image/png' }),
            { geometry: 'cover', background: 'white' },
        );

        expect(result.enlargedFrom).toEqual({ width: 128, height: 128 });
    }, 180_000);

    it('says nothing about enlargement when the source is big enough', async () => {
        const result = await icons(
            makeFile(await markPng({ width: 1024, height: 1024 }), { name: 'big.png', type: 'image/png' }),
            { geometry: 'cover', background: 'white' },
        );

        expect(result.enlargedFrom).toBeNull();
    }, 240_000);
});

/* ------------------------------------------------------------------ *
 * 6. The engine measures its own output
 * ------------------------------------------------------------------ */

describe('the size check', () => {
    /**
     * The encoder is replaced with one that writes a 31 x 32 PNG when asked for
     * a 32 x 32 one — the exact failure a dimension check exists to catch, and
     * one no assertion about the request could ever see. Everything else in the
     * module graph is real.
     */
    it('refuses an encode that came back the wrong size', async () => {
        vi.resetModules();

        vi.doMock('@/lib/image-client/encode', async () => {
            const actual = await vi.importActual('@/lib/image-client/encode');

            return {
                ...actual,
                encodeImageData: (imageData, options) => actual.encodeImageData(
                    imageData.width === 32 ? narrowed(imageData) : imageData,
                    options,
                ),
            };
        });

        const { runOperation: run, JobError: Job } = await import('@/lib/image-client/operations');

        const error = await run('icons', await markFile(), { geometry: 'cover', background: 'white' }).then(
            () => { throw new Error('expected a JobError, but the job succeeded'); },
            (thrown) => thrown,
        );

        vi.doUnmock('@/lib/image-client/encode');
        vi.resetModules();

        expect(error).toBeInstanceOf(Job);
        expect(error.code).toBe('icon-size');
        expect(error.message).toContain('favicon-32x32.png');
    }, 180_000);
});

/** The same picture one column narrower — a real 31 x 32 surface. */
function narrowed(imageData) {
    const width = imageData.width - 1;
    const data = new Uint8ClampedArray(width * imageData.height * 4);

    for (let y = 0; y < imageData.height; y += 1) {
        const from = y * imageData.width * 4;
        data.set(imageData.data.subarray(from, from + width * 4), y * width * 4);
    }

    return new ImageData(data, width, imageData.height);
}

/* ------------------------------------------------------------------ *
 * 7. The padding primitive the transparent lane needed
 * ------------------------------------------------------------------ */

describe('padImageData carries an alpha in its background', () => {
    let padImageData;
    let makeImageData;

    beforeAll(async () => {
        installBrowserEnv();
        ({ padImageData } = await import('@/lib/image-client/pad'));
        ({ makeImageData } = await import('./helpers/fixtures'));
    });

    it('fills with a transparent margin when the background asks for one', () => {
        const padded = padImageData(makeImageData(2, 2), 4, 4, { r: 0, g: 0, b: 0, a: 0 });

        expect(padded.width).toBe(4);
        expect(padded.data[3]).toBe(0);
        expect(padded.data[(4 * 4 - 1) * 4 + 3]).toBe(0);
    });

    it('still fills opaquely when the background states no alpha', () => {
        const padded = padImageData(makeImageData(2, 2), 4, 4, { r: 10, g: 20, b: 30 });

        expect(Array.from(padded.data.slice(0, 4))).toEqual([10, 20, 30, 255]);
    });

    it('leaves the picture it was given untouched in the middle', () => {
        const padded = padImageData(makeImageData(2, 2, () => [9, 8, 7, 255]), 4, 4, { r: 0, g: 0, b: 0, a: 0 });
        const centre = (1 * 4 + 1) * 4;

        expect(Array.from(padded.data.slice(centre, centre + 4))).toEqual([9, 8, 7, 255]);
    });
});
