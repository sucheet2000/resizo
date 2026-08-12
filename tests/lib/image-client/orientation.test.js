/**
 * EXIF orientation in the browser engine.
 *
 * A phone stores a portrait photo as landscape bytes plus an Orientation tag
 * telling the viewer to turn it. This engine throws every byte of metadata away
 * — deliberately, it carries GPS — so the rotation has to be baked into the
 * pixels first or it is lost, and the photo comes back on its side. That is the
 * bug PR #10 fixed on the server with sharp's `.rotate()`; this file is the same
 * guarantee, re-proved for the code that runs in the tab.
 *
 * THE THREE DECODE PATHS, AND WHAT EACH ONE DOES ABOUT THE TAG. Measured, not
 * assumed:
 *
 *  1. NATIVE (createImageBitmap). The browser applies the tag itself. decode.js
 *     pins `imageOrientation: 'from-image'` rather than leaning on it being the
 *     default. There is no native decoder in Node, so this path is exercised by
 *     the browser suite, not here.
 *
 *  2. WASM (@jsquash/jpeg). Measured: decoding an Orientation-6 fixture at the
 *     package default returns a 40x20 buffer where upright is 20x40 — it does
 *     not turn the pixels. `defaultDecodeOptions` in the package is
 *     `{ preserveOrientation: false }`, and its own README states that `true` is
 *     what rotates. This is the path the engine has to fix itself, and the path
 *     these tests cover end to end.
 *
 *  3. HEIC (libheif). Measured: libheif applies the container's own transform.
 *     Encoding orientations 1/2/4/6/8 to real HEVC HEICs with libheif's heif-enc
 *     showed it turns each Exif tag into an `irot`/`imir` box, and decoding
 *     those files back through libheif-js returned upright pixels and swapped
 *     dimensions with no help from us. So the HEIC path needs no fix — and must
 *     not be given one, because a second rotation on top would be wrong.
 *
 * The reader below is therefore consulted for JPEG and nothing else. See the
 * module comment in lib/image-client/orientation.js for why PNG and WebP are
 * deliberately left alone.
 */
import sharp from 'sharp';
import { beforeAll, describe, expect, it } from 'vitest';
import {
    applyOrientation,
    orientationSwapsAxes,
    orientedSize,
    readExifOrientation,
    EXIF_SCAN_BYTES,
    ORIENTATION_NONE,
} from '@/lib/image-client/orientation';
import { assessFile, assessPixels, estimatePeakBytes, WASM_BASELINE_BYTES } from '@/lib/image-client/capability';
import { installBrowserEnv } from './helpers/browser-env';
import {
    makeFile,
    makeImageData,
    splitRedBlueJpegOriented,
    splitRedBlueJpegPlain,
    splitRedBluePixels,
    splitRedBluePng,
    halfAlphaPng,
} from './helpers/fixtures';

const ALL_ORIENTATIONS = [1, 2, 3, 4, 5, 6, 7, 8];
const SOURCE = { width: 40, height: 20 };

let decodeToImageData;

beforeAll(async () => {
    installBrowserEnv();
    ({ decodeToImageData } = await import('@/lib/image-client/decode'));
});

/* ------------------------------------------------------------- test tools */

/** A minimal but real Exif APP1 segment carrying exactly one Orientation tag. */
function exifApp1(orientation, { bigEndian = false, tag = 0x0112, type = 3, count = 1 } = {}) {
    const tiff = Buffer.alloc(8 + 2 + 12 + 4);
    const u16 = (offset, value) => (bigEndian ? tiff.writeUInt16BE(value, offset) : tiff.writeUInt16LE(value, offset));
    const u32 = (offset, value) => (bigEndian ? tiff.writeUInt32BE(value, offset) : tiff.writeUInt32LE(value, offset));

    tiff.write(bigEndian ? 'MM' : 'II', 0, 'latin1');
    u16(2, 42);
    u32(4, 8);
    u16(8, 1);
    u16(10, tag);
    u16(12, type);
    u32(14, count);
    // A SHORT sits in the first two bytes of the four-byte value slot, which is
    // the one place the two byte orders disagree about where the number lives.
    if (bigEndian) tiff.writeUInt16BE(orientation, 18);
    else tiff.writeUInt16LE(orientation, 18);
    u32(22, 0);

    const payload = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff]);
    const header = Buffer.alloc(4);
    header.writeUInt16BE(0xFFE1, 0);
    header.writeUInt16BE(payload.length + 2, 2);

    return Buffer.concat([header, payload]);
}

/** An APP1 that is not Exif — this is how XMP travels, and it must be skipped. */
function xmpApp1() {
    const payload = Buffer.concat([
        Buffer.from('http://ns.adobe.com/xap/1.0/\0', 'latin1'),
        Buffer.from('<x:xmpmeta/>', 'latin1'),
    ]);
    const header = Buffer.alloc(4);
    header.writeUInt16BE(0xFFE1, 0);
    header.writeUInt16BE(payload.length + 2, 2);
    return Buffer.concat([header, payload]);
}

/** A JPEG-shaped file built from the segments given, so each one can be aimed. */
function jpegWithSegments(...segments) {
    return Buffer.concat([
        Buffer.from([0xFF, 0xD8]),
        ...segments,
        // SOS, then a scrap of entropy-coded data, then EOI.
        Buffer.from([0xFF, 0xDA, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3F, 0x00]),
        Buffer.from([0x12, 0x34, 0x56, 0x78]),
        Buffer.from([0xFF, 0xD9]),
    ]);
}

/**
 * What sharp does to the same picture, expressed as explicit geometry rather
 * than as `.rotate()`, so the reference is derived independently of the tag
 * reader being tested. Each transform runs as its own lossless raw pass because
 * sharp orders rotate and flip internally by its own rules, not by call order.
 */
async function sharpReference(pixels, width, height, orientation) {
    const steps = {
        1: [],
        2: [(image) => image.flop()],
        3: [(image) => image.rotate(180)],
        4: [(image) => image.flip()],
        5: [(image) => image.rotate(90), (image) => image.flop()],
        6: [(image) => image.rotate(90)],
        7: [(image) => image.rotate(270), (image) => image.flop()],
        8: [(image) => image.rotate(270)],
    }[orientation];

    let current = { data: pixels, info: { width, height, channels: 3 } };

    for (const step of steps) {
        current = await step(sharp(current.data, {
            raw: { width: current.info.width, height: current.info.height, channels: 3 },
        })).raw().toBuffer({ resolveWithObject: true });
    }

    return current;
}

/** The split fixture as RGBA ImageData, which is what the engine passes around. */
function splitImageData(width, height) {
    const rgb = splitRedBluePixels(width, height);
    return makeImageData(width, height, (x, y) => {
        const offset = (y * width + x) * 3;
        return [rgb[offset], rgb[offset + 1], rgb[offset + 2], 255];
    });
}

function corners(imageData) {
    const { data, width, height } = imageData;
    const at = (x, y) => {
        const offset = (y * width + x) * 4;
        return [data[offset], data[offset + 1], data[offset + 2]];
    };
    return {
        topLeft: at(0, 0),
        topRight: at(width - 1, 0),
        bottomLeft: at(0, height - 1),
        bottomRight: at(width - 1, height - 1),
    };
}

/** Which of red and blue a sampled pixel is, so JPEG's ringing cannot fail a test. */
function hue([r, , b]) {
    if (r > 128 && b < 128) return 'red';
    if (b > 128 && r < 128) return 'blue';
    return `neither(${r},${b})`;
}

function hueCorners(imageData) {
    const sampled = corners(imageData);
    return {
        topLeft: hue(sampled.topLeft),
        topRight: hue(sampled.topRight),
        bottomLeft: hue(sampled.bottomLeft),
        bottomRight: hue(sampled.bottomRight),
    };
}

/* ------------------------------------------------------------ the reader */

describe('reading the Orientation tag out of the source bytes', () => {
    it.each(ALL_ORIENTATIONS)('reads the tag sharp wrote as %i', async (orientation) => {
        const bytes = await splitRedBlueJpegOriented({ ...SOURCE, orientation });

        // The fixture is only worth anything if it really carries the tag.
        expect((await sharp(bytes).metadata()).orientation).toBe(orientation);
        expect(readExifOrientation(bytes)).toBe(orientation);
    });

    it('reads a JPEG with no EXIF block at all as upright', async () => {
        const bytes = await splitRedBlueJpegPlain(SOURCE);

        expect((await sharp(bytes).metadata()).orientation).toBeUndefined();
        expect(readExifOrientation(bytes)).toBe(ORIENTATION_NONE);
    });

    it.each(ALL_ORIENTATIONS)('reads a big-endian (MM) Exif block as %i as well', (orientation) => {
        expect(readExifOrientation(jpegWithSegments(exifApp1(orientation, { bigEndian: true }))))
            .toBe(orientation);
    });

    it.each(ALL_ORIENTATIONS)('reads a little-endian (II) Exif block as %i', (orientation) => {
        expect(readExifOrientation(jpegWithSegments(exifApp1(orientation)))).toBe(orientation);
    });

    it('walks past an APP1 that holds XMP rather than Exif', () => {
        expect(readExifOrientation(jpegWithSegments(xmpApp1(), exifApp1(7)))).toBe(7);
    });

    it('never reads past the start of scan, where the tag cannot legally be', () => {
        const afterTheScan = Buffer.concat([
            jpegWithSegments(),
            exifApp1(6),
        ]);

        expect(readExifOrientation(afterTheScan)).toBe(ORIENTATION_NONE);
    });

    it.each([
        ['zero', 0],
        ['nine', 9],
        ['a wild value', 0xFFFF],
    ])('refuses %s as an orientation and stays upright', (_label, value) => {
        expect(readExifOrientation(jpegWithSegments(exifApp1(value)))).toBe(ORIENTATION_NONE);
    });

    it('ignores an entry that claims to be Orientation but is the wrong type', () => {
        expect(readExifOrientation(jpegWithSegments(exifApp1(6, { type: 2 })))).toBe(ORIENTATION_NONE);
        expect(readExifOrientation(jpegWithSegments(exifApp1(6, { count: 4 })))).toBe(ORIENTATION_NONE);
    });

    it('ignores an IFD entry that is not the Orientation tag', () => {
        expect(readExifOrientation(jpegWithSegments(exifApp1(6, { tag: 0x011A })))).toBe(ORIENTATION_NONE);
    });

    /**
     * A PNG and a WebP can both legally carry an Orientation tag, and browsers
     * do not agree about honouring it. Reading it here would make the WASM
     * fallback disagree with the native decoder instead of agreeing with it,
     * which is the opposite of the point. See lib/image-client/orientation.js.
     */
    it('is never consulted for a PNG or a WebP', async () => {
        expect(readExifOrientation(await splitRedBluePng(SOURCE))).toBe(ORIENTATION_NONE);
        expect(readExifOrientation(await halfAlphaPng())).toBe(ORIENTATION_NONE);
        expect(readExifOrientation(await sharp(await splitRedBluePng(SOURCE)).webp().toBuffer()))
            .toBe(ORIENTATION_NONE);
    });

    it.each([
        ['nothing at all', new Uint8Array(0)],
        ['two bytes of SOI and no more', Buffer.from([0xFF, 0xD8])],
        ['an APP1 header that runs off the end', Buffer.from([0xFF, 0xD8, 0xFF, 0xE1, 0x40, 0x00, 0x45])],
        ['an Exif marker with no TIFF header', Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF, 0xE1, 0x00, 0x0A]), Buffer.from('Exif\0\0', 'latin1')])],
        ['a bogus byte-order mark', jpegWithSegments(Buffer.concat([
            Buffer.from([0xFF, 0xE1, 0x00, 0x12]),
            Buffer.from('Exif\0\0', 'latin1'),
            Buffer.from('XX', 'latin1'),
            Buffer.alloc(10),
        ]))],
        ['plain text', Buffer.from('this is not an image at all', 'latin1')],
        ['not bytes at all', null],
        ['a number', 42],
    ])('reads %s as upright rather than throwing', (_label, input) => {
        expect(readExifOrientation(input)).toBe(ORIENTATION_NONE);
    });

    it('needs only the head of the file, not all 20 MB of it', async () => {
        const bytes = await splitRedBlueJpegOriented({ ...SOURCE, orientation: 6 });

        expect(EXIF_SCAN_BYTES).toBeGreaterThanOrEqual(64 * 1024);
        expect(readExifOrientation(bytes.subarray(0, EXIF_SCAN_BYTES))).toBe(6);
    });
});

/* --------------------------------------------------------- the geometry */

describe('what each orientation does to the shape', () => {
    it.each([1, 2, 3, 4])('leaves width and height alone for orientation %i', (orientation) => {
        expect(orientationSwapsAxes(orientation)).toBe(false);
        expect(orientedSize(40, 20, orientation)).toEqual({ width: 40, height: 20 });
    });

    it.each([5, 6, 7, 8])('swaps width and height for orientation %i', (orientation) => {
        expect(orientationSwapsAxes(orientation)).toBe(true);
        expect(orientedSize(40, 20, orientation)).toEqual({ width: 20, height: 40 });
    });
});

/* -------------------------------------------------------- the transform */

describe('turning the pixels', () => {
    it('hands back the very same buffer for orientation 1, allocating nothing', () => {
        const pixels = splitImageData(40, 20);

        expect(applyOrientation(pixels, 1)).toBe(pixels);
        expect(applyOrientation(pixels, ORIENTATION_NONE)).toBe(pixels);
    });

    it.each([
        ['null', null],
        ['undefined', undefined],
        ['zero', 0],
        ['nine', 9],
        ['a string', '6'],
    ])('treats %s as upright and hands the buffer straight back', (_label, orientation) => {
        const pixels = splitImageData(40, 20);

        expect(applyOrientation(pixels, orientation)).toBe(pixels);
    });

    it.each(ALL_ORIENTATIONS)('places every pixel exactly where sharp does, for orientation %i', async (orientation) => {
        const { width, height } = SOURCE;
        const reference = await sharpReference(splitRedBluePixels(width, height), width, height, orientation);
        const turned = applyOrientation(splitImageData(width, height), orientation);

        expect({ width: turned.width, height: turned.height })
            .toEqual({ width: reference.info.width, height: reference.info.height });

        const mine = [];
        const theirs = [];
        for (let index = 0; index < turned.width * turned.height; index += 1) {
            mine.push(turned.data[index * 4], turned.data[index * 4 + 1], turned.data[index * 4 + 2]);
            theirs.push(reference.data[index * 3], reference.data[index * 3 + 1], reference.data[index * 3 + 2]);
        }

        expect(mine).toEqual(theirs);
    });

    it('keeps alpha with its pixel when it turns the image', () => {
        const pixels = makeImageData(4, 2, (x, y) => [x * 10, y * 10, 0, x * 20]);
        const turned = applyOrientation(pixels, 6);

        // Orientation 6 is a 90 degree clockwise turn: source (0,0) lands
        // top-right, and its alpha has to travel with it.
        const at = (x, y) => Array.from(turned.data.slice((y * turned.width + x) * 4, (y * turned.width + x) * 4 + 4));

        expect({ width: turned.width, height: turned.height }).toEqual({ width: 2, height: 4 });
        expect(at(1, 0)).toEqual([0, 0, 0, 0]);
        expect(at(1, 3)).toEqual([30, 0, 0, 60]);
    });

    it('turning twice by the same tag is not the same as turning once', () => {
        const pixels = splitImageData(40, 20);
        const once = applyOrientation(pixels, 6);
        const twice = applyOrientation(once, 6);

        expect({ width: once.width, height: once.height }).toEqual({ width: 20, height: 40 });
        expect({ width: twice.width, height: twice.height }).toEqual({ width: 40, height: 20 });
        expect(Array.from(twice.data)).not.toEqual(Array.from(pixels.data));
    });
});

/* ------------------------------------------- the engine against the server */

describe('the browser engine comes back upright, exactly as the server does', () => {
    /**
     * The parity claim, and the reason this file exists. sharp's `.rotate()` is
     * what app/api runs today; whatever shape it produces is the shape the tab
     * has to produce, or the changeover silently turns people's photos.
     */
    it.each(ALL_ORIENTATIONS)('decodes an Orientation-%i JPEG to sharp .rotate()\'s exact shape', async (orientation) => {
        const bytes = await splitRedBlueJpegOriented({ ...SOURCE, orientation });

        const server = await sharp(bytes).rotate().raw().toBuffer({ resolveWithObject: true });
        const browser = await decodeToImageData(bytes);

        expect({ width: browser.width, height: browser.height })
            .toEqual({ width: server.info.width, height: server.info.height });
        expect({ width: browser.data.width, height: browser.data.height })
            .toEqual({ width: server.info.width, height: server.info.height });
    });

    it.each(ALL_ORIENTATIONS)('lands the red half where sharp .rotate() lands it, for orientation %i', async (orientation) => {
        const bytes = await splitRedBlueJpegOriented({ ...SOURCE, orientation });

        const server = await sharp(bytes).rotate().raw().toBuffer({ resolveWithObject: true });
        const serverCorners = hueCorners({
            data: (() => {
                // sharp hands back three channels; widen to the four the engine speaks.
                const rgba = new Uint8ClampedArray(server.info.width * server.info.height * 4);
                for (let index = 0; index < server.info.width * server.info.height; index += 1) {
                    rgba[index * 4] = server.data[index * 3];
                    rgba[index * 4 + 1] = server.data[index * 3 + 1];
                    rgba[index * 4 + 2] = server.data[index * 3 + 2];
                    rgba[index * 4 + 3] = 255;
                }
                return rgba;
            })(),
            width: server.info.width,
            height: server.info.height,
        });

        expect(hueCorners((await decodeToImageData(bytes)).data)).toEqual(serverCorners);
    });

    it('leaves an untagged JPEG exactly as it was', async () => {
        const bytes = await splitRedBlueJpegPlain(SOURCE);
        const decoded = await decodeToImageData(bytes);

        expect({ width: decoded.width, height: decoded.height }).toEqual(SOURCE);
        expect(hueCorners(decoded.data)).toEqual({
            topLeft: 'red',
            topRight: 'blue',
            bottomLeft: 'red',
            bottomRight: 'blue',
        });
    });

    it('still hands back bare pixels and nothing else', async () => {
        const decoded = await decodeToImageData(await splitRedBlueJpegOriented({ ...SOURCE, orientation: 6 }));

        expect(Object.keys(decoded).sort()).toEqual(['data', 'format', 'height', 'viaNative', 'width']);
        for (const key of Object.keys(decoded.data)) {
            expect(key).not.toMatch(/exif|orientation|metadata/i);
        }
    });
});

/* ------------------------------------------------------- the memory gate */

describe('the memory gate pays for the second buffer a turn needs', () => {
    // A decode-only job, so the decode stage is the only stage and the extra
    // surface shows up undiluted. On a job that also encodes, the encode stage
    // can be the larger of the two and the peak grows by less than a surface —
    // which is the estimator working as designed, not the allowance going missing.
    const job = { sourceWidth: 4000, sourceHeight: 3000, fileBytes: 4 * 1024 * 1024, operation: 'decode' };
    const surface = 4000 * 3000 * 4;

    it('costs an upright image exactly as it did before', () => {
        expect(estimatePeakBytes({ ...job, orientation: 1, nativeDownscale: false }))
            .toBe(estimatePeakBytes({ ...job, nativeDownscale: false }));
    });

    it.each([2, 3, 4, 5, 6, 7, 8])('adds one full surface for orientation %i on the WASM path', (orientation) => {
        const upright = estimatePeakBytes({ ...job, orientation: 1, nativeDownscale: false });
        const turned = estimatePeakBytes({ ...job, orientation, nativeDownscale: false });

        // The codec's own buffer, the ImageData copied out of it, and now the
        // turned copy as well: three surfaces where there were two.
        expect(turned - upright).toBe(surface);
        expect(turned).toBe(surface * 3 + job.fileBytes + WASM_BASELINE_BYTES);
    });

    it('charges nothing extra when the browser does the turning itself', () => {
        expect(estimatePeakBytes({ ...job, orientation: 6, nativeDownscale: true }))
            .toBe(estimatePeakBytes({ ...job, orientation: 1, nativeDownscale: true }));
    });

    /**
     * The allowance is only worth having if it can actually change an answer.
     * A 20 MP source on a 1 GB device sits just inside the budget upright and
     * just outside it once the turn is paid for — which is the whole point: the
     * tab is refused with a sentence instead of being killed mid-rotation.
     */
    const TIGHT = {
        sourceWidth: 5000,
        sourceHeight: 4000,
        fileBytes: 8 * 1024 * 1024,
        operation: 'convert',
        device: {
            memoryGb: 1, memoryReported: true, cores: 6, ios: false, nativeDownscale: false, wasm: true,
        },
    };

    it('can turn a job that fitted into one that does not', () => {
        expect(assessPixels({ ...TIGHT, orientation: 1 }).ok).toBe(true);
        expect(assessPixels({ ...TIGHT, orientation: 6 })).toMatchObject({ ok: false, code: 'not-enough-memory' });
    });

    it('is reachable through the file gate, not only the pixel gate', () => {
        const bytes = Buffer.from([0xFF, 0xD8, 0xFF, 0xD9]);
        const file = () => makeFile(bytes, { size: TIGHT.fileBytes });

        expect(assessFile(file(), { ...TIGHT, orientation: 1 }).ok).toBe(true);
        expect(assessFile(file(), { ...TIGHT, orientation: 6 }).ok).toBe(false);
    });
});
