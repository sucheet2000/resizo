/**
 * The privacy guarantee, re-proved for the browser engine.
 *
 * tests/api/integration/image-guarantees.test.js asks the sharp pipeline one
 * question: can anything the camera wrote about the user survive a round trip?
 * This file asks the browser engine the same question, with the same marker and
 * the same fixture, because moving the work into the tab must not quietly move
 * the guarantee with it.
 *
 * WHY THE ANSWER IS NOW STRUCTURAL RATHER THAN A DISCIPLINE
 *
 * On the server the guarantee was a rule someone had to keep obeying. sharp
 * strips EXIF by default, so the pipeline stayed clean only as long as nobody
 * added a `withMetadata()` call — and `withMetadata(false)` KEEPS metadata,
 * because it calls keepMetadata() regardless of its argument. The whole promise
 * rested on the continued ABSENCE of one function call, which is why
 * lib/image/pipeline.js carries a warning comment and why the server suite has
 * to test for it.
 *
 * In the browser engine there is no such call to avoid, and no rule to keep.
 * The data type in the middle of the pipeline forbids it:
 *
 *   decodeToImageData()  ->  ImageData  ->  encodeImageData()
 *
 * An ImageData is a Uint8ClampedArray of RGBA samples plus a width and a
 * height. It has no field for an EXIF block, an ICC profile, an XMP packet or a
 * GPS coordinate, so by the time the pixels reach an encoder every one of those
 * has already been dropped by the decoder — it had nowhere to be put. The
 * jSquash encoders then take that ImageData and a numeric quality and nothing
 * else: `encode(imageData, { quality })`. There is no parameter through which
 * metadata could be passed even deliberately.
 *
 * So these tests are not guarding against a regression in a flag. They pin the
 * shape of the pipeline: as long as the only thing crossing between decode and
 * encode is an ImageData, the user's camera, lens, timestamp and location
 * cannot reach the file they download. A future change that threads a metadata
 * object through the middle to "preserve" something is what these tests exist
 * to catch.
 *
 * The five operations below are the browser equivalents of the five the server
 * suite runs a marked fixture through: resize, compress, convert, crop and a
 * plain re-encode. Every one of them ends at encodeImageData, which is the
 * point: there is exactly one door out of this engine and no metadata fits
 * through it.
 */
import sharp from 'sharp';
import { beforeAll, describe, expect, it } from 'vitest';
import { sniffImageType } from '@/lib/image/magic-bytes';
import { installBrowserEnv } from './helpers/browser-env';
import { EXIF_MARKER, GPS_MARKER, jpegWithExifAndGps, makeImageData } from './helpers/fixtures';

let cropImageData;
let decodeToImageData;
let encodeImageData;
let resizeImageData;

beforeAll(async () => {
    installBrowserEnv();
    ({ cropImageData } = await import('@/lib/image-client/crop'));
    ({ decodeToImageData } = await import('@/lib/image-client/decode'));
    ({ encodeImageData } = await import('@/lib/image-client/encode'));
    ({ resizeImageData } = await import('@/lib/image-client/resize'));
});

async function outputBytes(result) {
    return Buffer.from(await result.blob.arrayBuffer());
}

/** Every stage of the engine, run end to end the way a tool page would. */
async function run(source, operation) {
    const decoded = await decodeToImageData(source);
    return operation(decoded.data);
}

describe('EXIF and GPS never survive a round trip through the browser engine', () => {
    it('the fixture really carries EXIF and GPS going in', async () => {
        const source = await jpegWithExifAndGps();
        const { exif } = await sharp(source).metadata();

        expect(exif).toBeDefined();
        expect(exif.includes(EXIF_MARKER)).toBe(true);
        expect(exif.includes(GPS_MARKER)).toBe(true);
        expect(source.includes(EXIF_MARKER)).toBe(true);
        expect(source.includes(GPS_MARKER)).toBe(true);
    });

    it.each([
        ['resize to 30x20 and re-encode as JPEG', async (pixels) => {
            const resized = await resizeImageData(pixels, { width: 30, height: 20 });
            return encodeImageData(resized.data, { format: 'jpeg', quality: 80 });
        }],
        ['compress at quality 70', (pixels) => encodeImageData(pixels, { format: 'jpeg', quality: 70 })],
        ['re-encode at quality 100, full size', (pixels) => encodeImageData(pixels, { format: 'jpeg', quality: 100 })],
        ['convert to PNG', (pixels) => encodeImageData(pixels, { format: 'png' })],
        ['convert to WebP', (pixels) => encodeImageData(pixels, { format: 'webp', quality: 80 })],
        ['crop a 20x20 window out of it', (pixels) => encodeImageData(
            cropImageData(pixels, { x: 0, y: 0, width: 20, height: 20 }),
            { format: 'jpeg', quality: 80 },
        )],
    ])('%s returns an image with no EXIF block and no marker', async (_label, operation) => {
        const source = await jpegWithExifAndGps();
        const output = await outputBytes(await run(source, operation));
        const metadata = await sharp(output).metadata();

        expect(metadata.exif).toBeUndefined();
        expect(output.includes(EXIF_MARKER)).toBe(false);
        expect(output.includes(GPS_MARKER)).toBe(false);
    });

    it('the whole EXIF segment is absent from the output, not just its text', async () => {
        const source = await jpegWithExifAndGps();
        const { exif } = await sharp(source).metadata();

        const output = await outputBytes(await run(source, (pixels) => encodeImageData(pixels, { format: 'jpeg', quality: 90 })));

        expect(source.includes(exif)).toBe(true);
        expect(output.includes(exif)).toBe(false);
    });

    it('drops every other metadata channel too — ICC, IPTC, XMP', async () => {
        const source = await jpegWithExifAndGps();

        for (const format of ['jpeg', 'png', 'webp']) {
            const output = await outputBytes(await run(source, (pixels) => encodeImageData(pixels, { format })));
            const metadata = await sharp(output).metadata();

            expect(metadata.exif).toBeUndefined();
            expect(metadata.icc).toBeUndefined();
            expect(metadata.iptc).toBeUndefined();
            expect(metadata.xmp).toBeUndefined();
        }
    });

    it('still produces a real image of the right format and size', async () => {
        const source = await jpegWithExifAndGps({ width: 60, height: 40 });
        const output = await outputBytes(await run(source, (pixels) => encodeImageData(pixels, { format: 'jpeg', quality: 80 })));

        expect(sniffImageType(output)).toBe('jpeg');
        expect(await sharp(output).metadata()).toMatchObject({ width: 60, height: 40 });
    });
});

describe('decode hands back bare pixels', () => {
    it('returns pixels, dimensions and a format — no metadata object', async () => {
        const decoded = await decodeToImageData(await jpegWithExifAndGps());

        expect(Object.keys(decoded).sort()).toEqual(['data', 'format', 'height', 'viaNative', 'width']);
        expect(decoded.format).toBe('jpeg');
        expect(decoded.width).toBe(60);
        expect(decoded.height).toBe(40);
    });

    it('the pixel container is an ImageData and carries nothing else', async () => {
        const { data } = await decodeToImageData(await jpegWithExifAndGps());

        expect(data.data).toBeInstanceOf(Uint8ClampedArray);
        expect(data.data.length).toBe(data.width * data.height * 4);

        for (const key of Object.keys(data)) {
            expect(key).not.toMatch(/exif|gps|icc|iptc|xmp|orientation|metadata|comment/i);
        }
    });

    it('the decoded pixel buffer does not contain the marker bytes', async () => {
        const { data } = await decodeToImageData(await jpegWithExifAndGps());
        const pixels = Buffer.from(data.data.buffer, data.data.byteOffset, data.data.byteLength);

        expect(pixels.includes(EXIF_MARKER)).toBe(false);
        expect(pixels.includes(GPS_MARKER)).toBe(false);
    });

    /**
     * The structural claim, stated as a test: even a caller who deliberately
     * hangs metadata off the ImageData cannot get it into the file, because the
     * encoder reads `data`, `width` and `height` and nothing else.
     */
    it('an encoder given an ImageData with extra fields ignores them', async () => {
        const pixels = makeImageData(24, 16);
        pixels.exif = Buffer.from(EXIF_MARKER);
        pixels.gps = GPS_MARKER;

        const output = await outputBytes(await encodeImageData(pixels, { format: 'jpeg', quality: 90 }));

        expect((await sharp(output).metadata()).exif).toBeUndefined();
        expect(output.includes(EXIF_MARKER)).toBe(false);
        expect(output.includes(GPS_MARKER)).toBe(false);
    });
});

/**
 * ORIENTATION — A REAL GAP, DELIBERATELY LEFT FAILING-BY-ABSENCE.
 *
 * Stripping EXIF removes the Orientation tag, so a photo whose camera wrote
 * "rotate 90 to display" must have that rotation baked into its pixels before
 * the tag is thrown away. lib/image-client does none of that: decode.js never
 * reads the tag and never rotates, and neither the WASM decoders nor the HEIC
 * path apply it. Measured on an Orientation-6 fixture, the engine returns a
 * 40x20 buffer where the upright image is 20x40.
 *
 * Worse, this is inconsistent rather than merely absent. createImageBitmap
 * applies EXIF orientation by default, so the native path in a real browser
 * WILL come out upright while the WASM fallback and every HEIC will not — the
 * same file rotating differently depending on the browser.
 *
 * No passing test is written for this: there is nothing to assert that would be
 * true. The todo below keeps the gap visible in the test output until an
 * orientation helper exists in the engine.
 */
describe('EXIF orientation', () => {
    it.todo('ENGINE GAP: bakes EXIF orientation into the pixels before the tag is stripped');
});
