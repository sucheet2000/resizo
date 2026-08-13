/**
 * THE PRIVACY GUARANTEE. This file is now the only place it is proved.
 *
 * The question is: can anything the camera wrote about the user — the model,
 * the lens, the timestamp, the GPS coordinate — survive a round trip through
 * this tool? A server suite used to ask it of the sharp pipeline and this file
 * asked the same question of the browser engine, with the same marker and the
 * same fixture, so that moving the work into the tab could not quietly move the
 * guarantee with it. The pipeline and its suite are deleted. The guarantee is
 * not, and everything below is what is left holding it up.
 *
 * WHY THE ANSWER IS NOW STRUCTURAL RATHER THAN A DISCIPLINE
 *
 * On the server the guarantee was a rule someone had to keep obeying. sharp
 * strips EXIF by default, so the pipeline stayed clean only as long as nobody
 * added a `withMetadata()` call — and `withMetadata(false)` KEEPS metadata,
 * because it calls keepMetadata() regardless of its argument. The whole promise
 * rested on the continued ABSENCE of one function call, which is why that
 * pipeline carried a warning comment and why its suite had to test for it.
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
import {
    jpegWithExifAndGps,
    makeImageData,
    splitRedBlueJpegOriented,
    splitRedBluePng,
    EXIF_MARKER,
    GPS_MARKER,
} from './helpers/fixtures';

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
 * ORIENTATION — THE OTHER HALF OF STRIPPING THE METADATA.
 *
 * This gap was real and is now closed. Removing the EXIF block removes the
 * Orientation tag with it, so a photo whose camera wrote "rotate 90 to display"
 * has to have that rotation baked into its pixels FIRST or it is simply lost and
 * the photo comes back on its side. Measured before the fix, an Orientation-6
 * fixture came out of this engine as a 40x20 buffer where upright is 20x40.
 *
 * lib/image-client/orientation.js is the fix and
 * tests/lib/image-client/orientation.test.js is where it is proved in full —
 * all eight tag values, the mirrored ones included, against sharp's geometry.
 * What is asserted here is only the join between the two guarantees: that
 * turning the pixels did not quietly re-introduce the metadata that turning them
 * exists to make safe to delete.
 */
/**
 * THE BYTES DECIDE WHAT A FILE IS. THE FILE'S OWN CLAIM NEVER DOES.
 *
 * `decodeToImageData` takes a `mimeOrSniff` hint, and the hint is caller-
 * supplied: it comes from `File.type`, which is derived from the extension and
 * is whatever the person who made the file decided to write there. It exists for
 * one narrow case — a file whose magic bytes match nothing known — and it must
 * never outrank a signature that WAS recognised.
 *
 * Getting that order backwards is the SVG-polyglot bug this repo has already
 * had once: a file that opens with valid PNG or JPEG magic but is handed to a
 * decoder chosen by its declared type instead. lib/image/magic-bytes.js is
 * strict precisely so that the sniff can be trusted, and all of that strictness
 * is worth nothing if the caller consults it second.
 *
 * Measured by mutation: swapping the two operands of the `??` in decode.js —
 * `normaliseHint(mimeOrSniff) ?? sniffImageType(header)` — left every test in
 * this repo green. Nothing anywhere asserted the precedence.
 */
describe('the sniffed bytes decide the format, never the declared type', () => {
    it.each([
        ['a PNG that claims to be a JPEG', 'image/jpeg'],
        ['a PNG that claims to be a WebP', 'image/webp'],
        ['a PNG that claims to be a HEIC', 'image/heic'],
    ])('%s is still decoded as a PNG', async (_label, lie) => {
        const png = await splitRedBluePng({ width: 24, height: 16 });

        const decoded = await decodeToImageData(png, { mimeOrSniff: lie });

        expect(decoded.format).toBe('png');
        expect({ width: decoded.width, height: decoded.height })
            .toEqual({ width: 24, height: 16 });
    });

    it('a JPEG that claims to be a PNG is still decoded as a JPEG', async () => {
        const jpeg = await jpegWithExifAndGps({ width: 24, height: 16 });

        const decoded = await decodeToImageData(jpeg, { mimeOrSniff: 'image/png' });

        expect(decoded.format).toBe('jpeg');
    });

    /**
     * The hint's real job, kept working. Without this the test above could be
     * satisfied by ignoring the hint entirely, which would break the one case
     * it was added for.
     */
    it('still falls back to the hint when the bytes match nothing known', async () => {
        const notAnImage = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07,
            0x08, 0x09, 0x0A, 0x0B, 0x0C, 0x0D, 0x0E, 0x0F]);

        await expect(decodeToImageData(notAnImage, { mimeOrSniff: null }))
            .rejects.toThrow(/Invalid file type/);

        // With a hint the same unrecognised bytes get as far as a decoder, and
        // fail there instead — a different error, which is the point.
        await expect(decodeToImageData(notAnImage, { mimeOrSniff: 'image/png' }))
            .rejects.not.toThrow(/Invalid file type/);
    });
});

describe('EXIF orientation is applied to the pixels, not carried in the file', () => {
    it('bakes the rotation in before the tag is stripped', async () => {
        const source = await splitRedBlueJpegOriented({ width: 40, height: 20, orientation: 6 });

        // Stored 40x20, tagged to display 20x40. sharp produces the upright
        // shape from this fixture and so must the tab — which is asserted
        // directly below by measuring the fixture through sharp first.
        expect((await sharp(source).metadata())).toMatchObject({ width: 40, height: 20, orientation: 6 });

        const decoded = await decodeToImageData(source);
        expect({ width: decoded.width, height: decoded.height }).toEqual({ width: 20, height: 40 });
    });

    it('writes the turned photo out with no orientation tag to turn it again', async () => {
        const source = await splitRedBlueJpegOriented({ width: 40, height: 20, orientation: 6 });
        const output = await outputBytes(await run(source, (pixels) => encodeImageData(pixels, { format: 'jpeg', quality: 90 })));
        const metadata = await sharp(output).metadata();

        // Upright pixels AND no tag: a viewer that honoured a surviving tag
        // would turn an already-turned photo, which is the mirror-image bug.
        expect({ width: metadata.width, height: metadata.height }).toEqual({ width: 20, height: 40 });
        expect(metadata.orientation).toBeUndefined();
        expect(metadata.exif).toBeUndefined();
    });
});
