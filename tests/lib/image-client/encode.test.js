/**
 * Encoding, against the real codecs.
 *
 * MozJPEG, libwebp and the Squoosh PNG encoder all run in Node, so nothing here
 * is stubbed: every assertion is made about bytes a real encoder produced, read
 * back with sharp. Where the browser build differs from the server build — and
 * PNG quality is the big one — the difference is pinned here rather than left
 * for a user to discover.
 */
import sharp from 'sharp';
import { beforeAll, describe, expect, it } from 'vitest';
import { ALLOWED_OUTPUT_FORMATS, DEFAULT_QUALITY } from '@/lib/constants';
import { contentTypeFor } from '@/lib/image/filename';
import { sniffImageType } from '@/lib/image/magic-bytes';
import { installBrowserEnv } from './helpers/browser-env';
import { gradientImageData, makeImageData } from './helpers/fixtures';

let encodeImageData;
let formatSupportsQuality;
let normaliseFormat;
let BROWSER_OUTPUT_FORMATS;
let QUALITY_FORMATS;

beforeAll(async () => {
    installBrowserEnv();
    ({
        encodeImageData,
        formatSupportsQuality,
        normaliseFormat,
        BROWSER_OUTPUT_FORMATS,
        QUALITY_FORMATS,
    } = await import('@/lib/image-client/encode'));
});

async function bytesOf(result) {
    return Buffer.from(await result.blob.arrayBuffer());
}

describe('naming a format', () => {
    it.each([
        ['jpeg', 'jpeg'],
        ['JPEG', 'jpeg'],
        ['jpg', 'jpeg'],
        ['  JPG  ', 'jpeg'],
        ['image/jpeg', 'jpeg'],
        ['image/png', 'png'],
        ['webp', 'webp'],
    ])('reads %s as %s', (input, expected) => {
        expect(normaliseFormat(input)).toBe(expected);
    });

    it.each([null, undefined, 42, {}])('returns null for %s', (input) => {
        expect(normaliseFormat(input)).toBeNull();
    });

    it('writes the same three formats the server allows', () => {
        expect(BROWSER_OUTPUT_FORMATS).toEqual(ALLOWED_OUTPUT_FORMATS);
    });
});

describe('which formats a quality number actually changes', () => {
    it.each([
        ['jpeg', true],
        ['jpg', true],
        ['webp', true],
        ['png', false],
        ['avif', false],
        ['gif', false],
    ])('%s -> %s', (format, supported) => {
        expect(formatSupportsQuality(format)).toBe(supported);
    });

    it('lists exactly the lossy formats', () => {
        expect(QUALITY_FORMATS).toEqual(['jpeg', 'webp']);
    });
});

describe('round trip, one format at a time', () => {
    it.each(['jpeg', 'png', 'webp'])('encodes %s that sharp can read back at the right size', async (format) => {
        const result = await encodeImageData(gradientImageData(120, 90), { format, quality: 80 });
        const bytes = await bytesOf(result);

        expect(result.format).toBe(format);
        expect(result.type).toBe(contentTypeFor(format));
        expect(result.blob.type).toBe(contentTypeFor(format));
        expect(result.bytes).toBe(bytes.length);
        expect(bytes.length).toBeGreaterThan(0);
        expect(sniffImageType(bytes)).toBe(format);
        expect(await sharp(bytes).metadata()).toMatchObject({ format, width: 120, height: 90 });
    });

    it.each(['jpeg', 'png', 'webp'])('%s comes out far smaller than the raw pixels', async (format) => {
        const pixels = gradientImageData(200, 200);
        const result = await encodeImageData(pixels, { format, quality: 80 });

        expect(result.bytes).toBeLessThan(pixels.data.length);
    });

    it('keeps the colours where they were', async () => {
        const pixels = makeImageData(40, 20, (x) => (x < 20 ? [255, 0, 0, 255] : [0, 0, 255, 255]));

        const bytes = await bytesOf(await encodeImageData(pixels, { format: 'png' }));
        const { data, info } = await sharp(bytes).raw().toBuffer({ resolveWithObject: true });
        const at = (x, y) => Array.from(data.subarray((y * info.width + x) * info.channels, (y * info.width + x) * info.channels + 3));

        expect(at(5, 10)).toEqual([255, 0, 0]);
        expect(at(34, 10)).toEqual([0, 0, 255]);
    });

    it.each(['png', 'webp'])('keeps transparency through %s', async (format) => {
        const pixels = makeImageData(30, 30, () => [10, 120, 200, 128]);

        const bytes = await bytesOf(await encodeImageData(pixels, { format }));
        const metadata = await sharp(bytes).metadata();
        const raw = await sharp(bytes).ensureAlpha().raw().toBuffer();

        expect(metadata.hasAlpha).toBe(true);
        expect(raw[3]).toBe(128);
    });
});

describe('the quality slider', () => {
    it.each(['jpeg', 'webp'])('%s at quality 20 is smaller than at quality 90', async (format) => {
        const pixels = gradientImageData(160, 160);

        const low = await encodeImageData(pixels, { format, quality: 20 });
        const high = await encodeImageData(pixels, { format, quality: 90 });

        expect(low.bytes).toBeLessThan(high.bytes);
        expect(low.qualityApplied).toBe(true);
    });

    /**
     * THE DIVERGENCE FROM THE SERVER, PINNED.
     *
     * sharp shrinks a PNG by quantising it — palette:true plus a colour count,
     * which is what lib/image/quality.js maps the 1-100 slider onto, because
     * libvips' own PNG `quality` is inert without libimagequant. @jsquash/png
     * has no quantiser at all: it is a lossless encoder with no knobs. So the
     * slider cannot do anything to a PNG here, and the engine says so through
     * `qualityApplied: false` instead of letting the UI imply otherwise.
     *
     * If a PNG quantiser is ever added to the browser build, this test is the
     * one that has to change, and changing it is the signal that the UI copy
     * needs to change with it.
     */
    it('does nothing at all to a PNG, and admits it', async () => {
        const pixels = gradientImageData(160, 160);

        const low = await encodeImageData(pixels, { format: 'png', quality: 20 });
        const high = await encodeImageData(pixels, { format: 'png', quality: 90 });

        expect(low.bytes).toBe(high.bytes);
        expect(low.qualityApplied).toBe(false);
        expect(high.qualityApplied).toBe(false);
    });

    it.each([
        ['0 clamps up to 1', 0, 1],
        ['-40 clamps up to 1', -40, 1],
        ['1000 clamps down to 100', 1000, 100],
        ['a fraction rounds', 70.6, 71],
    ])('%s', async (_label, quality, expected) => {
        const result = await encodeImageData(makeImageData(16, 16), { format: 'jpeg', quality });

        expect(result.quality).toBe(expected);
    });

    it.each([Number.NaN, Number.POSITIVE_INFINITY, 'high', null])('falls back to the default for %s', async (quality) => {
        const result = await encodeImageData(makeImageData(16, 16), { format: 'jpeg', quality });

        expect(result.quality).toBe(DEFAULT_QUALITY);
    });

    it('uses the default quality when none is given', async () => {
        expect((await encodeImageData(makeImageData(16, 16), { format: 'jpeg' })).quality).toBe(DEFAULT_QUALITY);
    });
});

describe('formats this build refuses, clearly', () => {
    it('names AVIF specifically rather than quietly writing a JPEG', async () => {
        await expect(encodeImageData(makeImageData(16, 16), { format: 'avif' }))
            .rejects.toThrow('AVIF is not supported in the browser build yet.');
    });

    it.each(['gif', 'tiff', 'bmp', 'heic', 'pdf', 'image/svg+xml'])('refuses %s', async (format) => {
        await expect(encodeImageData(makeImageData(16, 16), { format }))
            .rejects.toThrow(`Unsupported output format: ${format}.`);
    });

    it.each([null, undefined, '', 42])('refuses a format of %s', async (format) => {
        await expect(encodeImageData(makeImageData(16, 16), { format })).rejects.toThrow(/Unsupported output format/);
    });

    it('refuses to be called with no format at all', async () => {
        await expect(encodeImageData(makeImageData(16, 16))).rejects.toThrow(/Unsupported output format/);
    });
});

describe('nothing to encode', () => {
    it.each([
        ['null', null],
        ['undefined', undefined],
        ['an object with no pixels', { width: 10, height: 10 }],
        ['a zero-width image', { data: new Uint8ClampedArray(0), width: 0, height: 10 }],
        ['a zero-height image', { data: new Uint8ClampedArray(0), width: 10, height: 0 }],
    ])('refuses %s', async (_label, imageData) => {
        await expect(encodeImageData(imageData, { format: 'jpeg' }))
            .rejects.toThrow('There are no pixels to encode.');
    });
});
