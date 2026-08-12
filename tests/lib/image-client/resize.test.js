/**
 * Resampling.
 *
 * Two halves. The dimension maths is pure and is checked against the very same
 * helpers the server routes use, because a target the server would have refused
 * has to be refused here identically — during the changeover both builds are
 * live and a size that works on one and 400s on the other is a bug nobody can
 * reproduce.
 *
 * The second half runs the real @jsquash/resize WASM through Node. Node has no
 * createImageBitmap, so every resize here takes the lanczos3 fallback — which
 * is the path a browser also takes for an upscale and for anything its own
 * decoder refused.
 */
import sharp from 'sharp';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { MAX_DIMENSION, MAX_PIXELS } from '@/lib/constants';
import { scaleDimensions } from '@/lib/image/dimensions';
import { installBrowserEnv } from './helpers/browser-env';
import { gradientImageData, makeImageData } from './helpers/fixtures';

let canUseNativeDownscale;
let fitWithin;
let resizeImageData;
let targetDimensions;
let RESIZE_METHOD;

beforeAll(async () => {
    installBrowserEnv();
    ({
        canUseNativeDownscale,
        fitWithin,
        resizeImageData,
        targetDimensions,
        RESIZE_METHOD,
    } = await import('@/lib/image-client/resize'));
});

describe('choosing the output size', () => {
    it('derives the height from a width, keeping the shape', () => {
        expect(targetDimensions(4000, 3000, { width: 800 })).toEqual({ ok: true, width: 800, height: 600 });
    });

    it('derives the width from a height, keeping the shape', () => {
        expect(targetDimensions(4000, 3000, { height: 600 })).toEqual({ ok: true, width: 800, height: 600 });
    });

    // The OUTPUT size, which is all this helper decides. Whether the picture is
    // covered and cropped into those two numbers or squashed into them is
    // settled elsewhere — tests/lib/image-client/resize-cover.test.js.
    it('honours both sides exactly', () => {
        expect(targetDimensions(4000, 3000, { width: 500, height: 500 }))
            .toEqual({ ok: true, width: 500, height: 500 });
    });

    it('rounds a derived side rather than truncating it', () => {
        expect(targetDimensions(1000, 333, { width: 100 })).toEqual({ ok: true, width: 100, height: 33 });
    });

    it('never derives a side of zero', () => {
        expect(targetDimensions(10_000, 3, { width: 1 })).toMatchObject({ ok: true, width: 1, height: 1 });
    });

    it('hands a percentage straight to the server helper, so the rounding matches', () => {
        for (const percent of [50, 33.3, 12.5, 150, 400]) {
            expect(targetDimensions(1234, 987, { scalePercent: percent }))
                .toEqual(scaleDimensions(1234, 987, percent));
        }
    });

    it('asks for something when given nothing', () => {
        expect(targetDimensions(800, 600, {}))
            .toEqual({ ok: false, error: 'Provide a width, a height or a scale.' });
    });

    it.each([
        ['a zero source', 0, 600],
        ['a negative source', 800, -600],
        ['a NaN source', Number.NaN, 600],
        ['an undefined source', undefined, 600],
    ])('refuses %s', (_label, sourceWidth, sourceHeight) => {
        expect(targetDimensions(sourceWidth, sourceHeight, { width: 100 }))
            .toEqual({ ok: false, error: 'Unable to determine the source image dimensions.' });
    });

    it('accepts exactly the maximum dimension and refuses one more', () => {
        expect(targetDimensions(MAX_DIMENSION, 10, { width: MAX_DIMENSION, height: 10 }).ok).toBe(true);
        expect(targetDimensions(MAX_DIMENSION, 10, { width: MAX_DIMENSION + 1, height: 10 }))
            .toEqual({ ok: false, error: 'Dimensions exceed maximum allowed values.' });
    });

    it('accepts exactly the pixel budget and refuses one row more', () => {
        expect(targetDimensions(8000, 5000, { width: 8000, height: 5000 }))
            .toEqual({ ok: true, width: 8000, height: 5000 });
        expect(8000 * 5000).toBe(MAX_PIXELS);

        expect(targetDimensions(8000, 5001, { width: 8000, height: 5001 }))
            .toEqual({ ok: false, error: 'Dimensions exceed maximum allowed values.' });
    });
});

describe('fitting inside a box', () => {
    it('leaves an image that already fits alone', () => {
        expect(fitWithin(400, 300, 800, 600)).toEqual({ width: 400, height: 300, changed: false });
    });

    it('reports changed: false when the image is exactly the box', () => {
        expect(fitWithin(800, 600, 800, 600)).toEqual({ width: 800, height: 600, changed: false });
    });

    it('shrinks to a width limit, keeping the shape', () => {
        expect(fitWithin(4000, 3000, 1000)).toEqual({ width: 1000, height: 750, changed: true });
    });

    it('shrinks to a height limit, keeping the shape', () => {
        expect(fitWithin(4000, 3000, null, 600)).toEqual({ width: 800, height: 600, changed: true });
    });

    it('takes whichever limit bites harder', () => {
        expect(fitWithin(4000, 3000, 2000, 600)).toEqual({ width: 800, height: 600, changed: true });
    });

    it('never enlarges', () => {
        expect(fitWithin(100, 80, 5000, 5000)).toEqual({ width: 100, height: 80, changed: false });
    });

    it('never returns a side of zero', () => {
        expect(fitWithin(10_000, 5, 10)).toMatchObject({ width: 10, height: 1, changed: true });
    });

    it('passes an unmeasurable image straight through', () => {
        expect(fitWithin(0, 0, 100, 100)).toEqual({ width: 0, height: 0, changed: false });
    });
});

describe('whether the browser could have done it natively', () => {
    afterEach(() => {
        delete globalThis.createImageBitmap;
        delete globalThis.OffscreenCanvas;
    });

    function pretendBrowser() {
        globalThis.createImageBitmap = () => {};
        globalThis.OffscreenCanvas = class {};
    }

    it('is false in Node, which is why this suite exercises the WASM path', () => {
        expect(canUseNativeDownscale({ sourceWidth: 400, sourceHeight: 300, width: 200, height: 150 })).toBe(false);
    });

    it('is true for a real downscale in a browser', () => {
        pretendBrowser();

        expect(canUseNativeDownscale({ sourceWidth: 400, sourceHeight: 300, width: 200, height: 150 })).toBe(true);
    });

    it('is true when the size is unchanged', () => {
        pretendBrowser();

        expect(canUseNativeDownscale({ sourceWidth: 400, sourceHeight: 300, width: 400, height: 300 })).toBe(true);
    });

    /**
     * An enlargement is the one case where the 1700 ms resampler earns its
     * time: createImageBitmap will happily upscale, but with the browser's own
     * filter rather than Lanczos.
     */
    it.each([
        ['wider', 500, 150],
        ['taller', 200, 400],
    ])('is false when the target is %s than the source', (_label, width, height) => {
        pretendBrowser();

        expect(canUseNativeDownscale({ sourceWidth: 400, sourceHeight: 300, width, height })).toBe(false);
    });

    it.each([
        ['no arguments at all', undefined],
        ['no source', { width: 100, height: 100 }],
        ['no target', { sourceWidth: 400, sourceHeight: 300 }],
        ['a zero target', { sourceWidth: 400, sourceHeight: 300, width: 0, height: 100 }],
    ])('is false given %s', (_label, input) => {
        pretendBrowser();

        expect(canUseNativeDownscale(input)).toBe(false);
    });
});

describe('resampling for real, through @jsquash/resize', () => {
    it('uses lanczos3, the same kernel sharp defaults to', () => {
        expect(RESIZE_METHOD).toBe('lanczos3');
    });

    it('returns an image of exactly the size asked for', async () => {
        const result = await resizeImageData(gradientImageData(80, 60), { width: 40, height: 30 });

        expect(result).toMatchObject({ width: 40, height: 30, viaNative: false });
        expect(result.data.width).toBe(40);
        expect(result.data.height).toBe(30);
        expect(result.data.data.length).toBe(40 * 30 * 4);
    });

    it('upscales too, which is the case the native path is not allowed to take', async () => {
        const result = await resizeImageData(gradientImageData(40, 30), { width: 80, height: 60 });

        expect(result).toMatchObject({ width: 80, height: 60 });
        expect(result.data.data.length).toBe(80 * 60 * 4);
    });

    it('stretches when told to, ignoring the source ratio', async () => {
        const result = await resizeImageData(gradientImageData(80, 60), { width: 20, height: 60 });

        expect(result).toMatchObject({ width: 20, height: 60 });
    });

    it('skips the codec entirely when the size is already right', async () => {
        const pixels = gradientImageData(40, 30);
        const result = await resizeImageData(pixels, { width: 40, height: 30 });

        expect(result.data).toBe(pixels);
    });

    /**
     * Two flat blocks with one hard seam. A resampler that swapped channels,
     * mistook the row stride or read the buffer as BGRA would show it here
     * where a gradient would hide it. The samples are a few pixels in from the
     * seam so the Lanczos ringing at the edge is not what is being measured.
     */
    it('keeps the colours where they belong', async () => {
        const pixels = makeImageData(80, 40, (x) => (x < 40 ? [255, 0, 0, 255] : [0, 0, 255, 255]));

        const result = await resizeImageData(pixels, { width: 40, height: 20 });
        const at = (x, y) => Array.from(result.data.data.subarray((y * 40 + x) * 4, (y * 40 + x) * 4 + 4));

        const [leftR, leftG, leftB, leftA] = at(5, 10);
        const [rightR, rightG, rightB, rightA] = at(34, 10);

        expect(leftR).toBeGreaterThan(240);
        expect(leftG).toBe(0);
        expect(leftB).toBeLessThan(10);
        expect(leftA).toBe(255);

        expect(rightB).toBeGreaterThan(240);
        expect(rightG).toBe(0);
        expect(rightR).toBeLessThan(10);
        expect(rightA).toBe(255);
    });

    it('keeps a half-transparent image half-transparent', async () => {
        const pixels = makeImageData(40, 30, () => [10, 120, 200, 128]);

        const result = await resizeImageData(pixels, { width: 20, height: 15 });

        expect(result.data.data[3]).toBe(128);
    });

    it('produces something a real PNG encoder accepts', async () => {
        const { encodeImageData } = await import('@/lib/image-client/encode');

        const result = await resizeImageData(gradientImageData(120, 90), { width: 60, height: 45 });
        const encoded = await encodeImageData(result.data, { format: 'png' });
        const bytes = Buffer.from(await encoded.blob.arrayBuffer());

        expect(await sharp(bytes).metadata()).toMatchObject({ format: 'png', width: 60, height: 45 });
    });
});

describe('resampling refuses what it cannot do', () => {
    it.each([
        ['nothing', null],
        ['an object with no dimensions', { data: new Uint8ClampedArray(4) }],
        ['a zero-width image', { data: new Uint8ClampedArray(0), width: 0, height: 10 }],
    ])('refuses %s as a source', async (_label, imageData) => {
        await expect(resizeImageData(imageData, { width: 10, height: 10 }))
            .rejects.toThrow('Unable to determine the source image dimensions.');
    });

    it.each([
        ['no dimensions', {}],
        ['a zero width', { width: 0, height: 10 }],
        ['a negative height', { width: 10, height: -10 }],
        ['a NaN width', { width: Number.NaN, height: 10 }],
    ])('refuses %s as a target', async (_label, options) => {
        await expect(resizeImageData(gradientImageData(20, 20), options))
            .rejects.toThrow('Invalid resize dimensions.');
    });

    it('refuses a target past the maximum dimension', async () => {
        await expect(resizeImageData(gradientImageData(20, 20), { width: MAX_DIMENSION + 1, height: 10 }))
            .rejects.toThrow('Dimensions exceed maximum allowed values.');
    });

    it('refuses a target past the pixel budget', async () => {
        await expect(resizeImageData(gradientImageData(20, 20), { width: 8000, height: 5001 }))
            .rejects.toThrow('Dimensions exceed maximum allowed values.');
    });
});
