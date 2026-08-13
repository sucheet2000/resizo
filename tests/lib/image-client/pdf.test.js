/**
 * /jpg-to-pdf, the engine.
 *
 * The tool has one claim that no competitor makes — the file never leaves the
 * device — and one that they cannot make even in principle, which is a PDF of a
 * chosen size. Both live or die on this module, and both are asserted here
 * against real bytes: real JPEGs from sharp, the real MozJPEG encoder, the real
 * pdf-lib writer, and the finished document read back and taken apart again.
 *
 * FOUR THINGS THIS FILE EXISTS TO STOP
 *
 *  1. A JPEG BEING DECODED ON ITS WAY IN. That is the whole memory argument:
 *     0.45 MB of heap growth for the byte copy against 45.78 MB for one decoded
 *     surface. It is proved the only way it can be — the source's own bytes are
 *     found inside the output, and the stream is stored as DCTDecode rather than
 *     re-packed — because a build that decoded and re-encoded at quality 100
 *     would look identical to a test that only compared pictures.
 *
 *  2. A PHONE PHOTO ARRIVING SIDEWAYS. A PDF reader never looks inside an image
 *     stream for EXIF, so a byte-copied portrait photo lands on its side. Every
 *     one of the eight tag values is put through and the pixels are checked at
 *     the corners, not the dimensions: orientations 5 and 6 produce the same
 *     shape and only the corners tell them apart.
 *
 *  3. GPS AND CAMERA METADATA RIDING INTO THE DOCUMENT. The site's guarantee is
 *     that metadata does not survive, and the file people build here goes to a
 *     bank or a passport office. The scan has to be copied verbatim and the Exif
 *     block has to be gone, in the same file, at the same time.
 *
 *  4. A SIZE TARGET BEING ANSWERED WITH A LIE. Either the document is inside the
 *     number that was typed, or it says it is not. There is no third answer, and
 *     nothing is allowed to reach the target by quietly shrinking the picture.
 *
 * sharp is a fixture and a reference here, never on the path under test.
 */
import sharp from 'sharp';
import { beforeAll, describe, expect, it } from 'vitest';

import { MAX_BULK_FILES, MAX_BULK_TOTAL_BYTES, MIN_TARGET_BYTES } from '@/lib/limits';
import {
    assessPdfJob,
    estimatePdfPeakBytes,
    PDF_DOCUMENT_COPIES,
    PDF_EMBED_FILE_COPIES,
    WASM_BASELINE_BYTES,
} from '@/lib/image-client/capability';
import {
    canEmbedWithoutDecoding,
    findJpegScanEnd,
    pageGeometry,
    parseMarginPoints,
    parsePageOrientation,
    parsePageSize,
    pixelsToPoints,
    shareBudgets,
    stripJpegMetadata,
    targetMissMessage,
    A4_POINTS,
    LETTER_POINTS,
    MAX_MARGIN_POINTS,
    MAX_PAGE_POINTS,
    NO_SCAN_END,
    PAGE_SIZE_A4,
    PAGE_SIZE_FIT,
    PAGE_SIZE_LETTER,
    LANDSCAPE,
    PORTRAIT,
} from '@/lib/image-client/pdf';
import { installBrowserEnv } from './helpers/browser-env';
import {
    halfAlphaPng,
    jpegWithExifAndGps,
    noiseJpeg,
    splitRedBlueJpegOriented,
    splitRedBlueJpegPlain,
    splitRedBluePng,
    EXIF_MARKER,
    GPS_MARKER,
    TRAILER_EXIF_MARKER,
    TRAILER_GPS_MARKER,
} from './helpers/fixtures';

let runOperation;
let JobError;
let buildPdf;
let PDFDocument;
let PDFName;

beforeAll(async () => {
    installBrowserEnv();
    ({ runOperation, JobError } = await import('@/lib/image-client/operations'));
    ({ buildPdf } = await import('@/lib/image-client/pdf'));
    ({ PDFDocument, PDFName } = await import('@cantoo/pdf-lib'));
}, 60_000);

/* ------------------------------------------------------------------ *
 * Reading the document back
 * ------------------------------------------------------------------ */

async function bytesOf(blob) {
    return Buffer.from(await blob.arrayBuffer());
}

/**
 * Every page's image, in page order, taken out of the finished PDF.
 *
 * The document is opened by the writer's own loader rather than by scanning for
 * JPEG signatures, so the ORDER is the page tree's order and not the order the
 * bytes happen to sit in the file. That distinction is the whole point of the
 * ordering test below.
 */
async function pageImages(pdfBytes) {
    const loaded = await PDFDocument.load(pdfBytes);

    return loaded.getPages().map((page) => {
        const xobjects = page.node.Resources().lookup(PDFName.of('XObject'));
        const [[, reference]] = xobjects.entries();
        const stream = loaded.context.lookup(reference);

        return {
            bytes: Buffer.from(stream.getContents()),
            filter: String(stream.dict.get(PDFName.of('Filter'))),
            width: Number(stream.dict.get(PDFName.of('Width'))?.asNumber?.() ?? 0),
            height: Number(stream.dict.get(PDFName.of('Height'))?.asNumber?.() ?? 0),
        };
    });
}

async function pageSizes(pdfBytes) {
    const loaded = await PDFDocument.load(pdfBytes);
    return loaded.getPages().map((page) => ({
        width: Math.round(page.getWidth() * 100) / 100,
        height: Math.round(page.getHeight() * 100) / 100,
    }));
}

function fileOf(bytes, name, type) {
    return new File([bytes], name, { type });
}

/**
 * Something recognisable to staple after a photo's EOI, standing in for the MP4
 * a Motion Photo appends and the second JPEG an iPhone writes for its gain map.
 */
const TRAILER_SENTINEL = Buffer.from('RESIZO-TRAILER-PAYLOAD');

async function makePdf(files, options = {}) {
    return runOperation('pdf', files, options);
}

/** The RGB of one pixel of a JPEG, read back through an independent decoder. */
async function pixelAt(jpegBytes, x, y) {
    const { data, info } = await sharp(jpegBytes).raw().toBuffer({ resolveWithObject: true });
    const offset = ((y * info.width) + x) * info.channels;
    return [data[offset], data[offset + 1], data[offset + 2]];
}

/** Which of red and blue a sample is, so JPEG ringing cannot fail a test. */
function hue([r, , b]) {
    if (r > 128 && b < 128) return 'red';
    if (b > 128 && r < 128) return 'blue';
    return `neither(${r},${b})`;
}

/* ------------------------------------------------------------------ *
 * The cheap lane
 * ------------------------------------------------------------------ */

describe('a JPEG goes onto the page without being opened', () => {
    it('puts the source file into the document byte for byte', async () => {
        const source = await splitRedBlueJpegPlain({ width: 120, height: 80 });
        const result = await makePdf([fileOf(source, 'photo.jpg', 'image/jpeg')]);
        const output = await bytesOf(result.blob);

        // The lead's prototype assertion, and the only one that can tell a byte
        // copy apart from a decode-and-re-encode at high quality.
        expect(output.includes(source)).toBe(true);
        expect(result.reencodedCount).toBe(0);
    });

    it('stores it as a JPEG stream rather than re-packing the samples', async () => {
        const source = await splitRedBlueJpegPlain({ width: 120, height: 80 });
        const result = await makePdf([fileOf(source, 'photo.jpg', 'image/jpeg')]);
        const [image] = await pageImages(await bytesOf(result.blob));

        // DCTDecode is the JPEG data as it arrived. FlateDecode here would mean
        // the samples had been decoded and re-compressed, which is the thing
        // this tool must never do to a JPEG.
        expect(image.filter).toBe('/DCTDecode');
        expect(image.bytes.equals(source)).toBe(true);
    });

    it('takes the page size from the header, having never decoded the picture', async () => {
        const source = await splitRedBlueJpegPlain({ width: 120, height: 80 });
        const result = await makePdf([fileOf(source, 'photo.jpg', 'image/jpeg')]);
        const [image] = await pageImages(await bytesOf(result.blob));

        expect(image.width).toBe(120);
        expect(image.height).toBe(80);
    });

    it('says so about itself before any work starts', async () => {
        expect(canEmbedWithoutDecoding({ format: 'jpeg', orientation: 1 })).toBe(true);
        expect(canEmbedWithoutDecoding({ format: 'jpeg', orientation: 6 })).toBe(false);
        expect(canEmbedWithoutDecoding({ format: 'png', orientation: 1 })).toBe(false);
        expect(canEmbedWithoutDecoding({ format: 'webp', orientation: 1 })).toBe(false);
        expect(canEmbedWithoutDecoding({ format: 'heic', orientation: 1 })).toBe(false);
    });
});

/* ------------------------------------------------------------------ *
 * A picture that stops in the middle
 * ------------------------------------------------------------------ */

/**
 * The cheap lane's blind spot, and the one way this tool could answer a broken
 * file differently from every other tool on the site.
 *
 * embedJpg needs an SOI and an SOF and nothing else: it reads the width and the
 * height out of the header and copies the bytes in. A photo whose download was
 * cut off still has both, so the document is written, the panel says
 * "400x300 · JPEG · Download PDF", and what a reader draws is whatever it can
 * make of a scan that stops — a band of noise over grey, or a blank sheet.
 * Nothing in the engine ever looked at the picture, so nothing ever said no.
 *
 * Handed the identical bytes, /convert opens them, and either returns the
 * partial picture its decoder recovered or refuses the file outright. That is
 * the disagreement this block exists to close: what happens to a broken file
 * must not depend on which tool the person happened to open.
 *
 * The bytes are real ones, cut at two lengths that behave differently:
 *
 *   5353  five percent — every header intact, the scan cut mid-picture. The
 *         decoder recovers the top of the image and greys the rest.
 *    200  past the SOF and barely into the scan. The decoder refuses it.
 *
 * Both were accepted and copied verbatim by the shipped build.
 */
describe('a JPEG whose scan has no end', () => {
    async function cutTo(byteCount) {
        const full = Buffer.from(await noiseJpeg({ width: 400, height: 300 }));
        return full.subarray(0, byteCount);
    }

    /** The same bytes through the tool that always decodes what it is given. */
    function convertOf(bytes) {
        return runOperation('convert', fileOf(bytes, 'cut.jpg', 'image/jpeg'), { format: 'png' });
    }

    /** What a job threw, or a loud failure if it unexpectedly produced a file. */
    async function thrownBy(promise) {
        try {
            const result = await promise;
            throw new Error(`expected a refusal, got a ${result.format} of ${result.resultBytes} bytes`);
        } catch (error) {
            return error;
        }
    }

    it('would have been embedded happily, which is why the writer cannot be the check', async () => {
        // The premise of the whole block: pdf-lib is not being defeated here, it
        // is doing exactly what it documents. Nothing downstream of the copy
        // lane is ever going to notice a missing picture.
        const embedded = await (await PDFDocument.create()).embedJpg(await cutTo(200));

        expect({ width: embedded.width, height: embedded.height }).toEqual({ width: 400, height: 300 });
    });

    it('is never copied into the document as it stands', async () => {
        const cut = await cutTo(5353);
        const result = await makePdf([fileOf(cut, 'cut.jpg', 'image/jpeg')]);
        const output = await bytesOf(result.blob);

        // The cheap lane's own proof, inverted: the source bytes appearing in
        // the output is what a byte copy looks like, and this file must not get
        // one. It is rebuilt from pixels instead.
        expect(output.includes(cut)).toBe(false);
        expect(result.reencodedCount).toBe(1);

        const [image] = await pageImages(output);
        expect({ width: image.width, height: image.height }).toEqual({ width: 400, height: 300 });
    }, 30_000);

    it('puts the same picture on the page that /convert returns for it', async () => {
        const cut = await cutTo(5353);

        const viaPdf = await makePdf([fileOf(cut, 'cut.jpg', 'image/jpeg')]);
        const [page] = await pageImages(await bytesOf(viaPdf.blob));

        const viaConvert = await convertOf(cut);
        const converted = Buffer.from(await viaConvert.blob.arrayBuffer());

        // Well below the row the scan stops at, which is the part of the picture
        // only a decoder can have an opinion about. A PDF reader guessing at the
        // same bytes is not the same answer, and is not the same on two readers.
        const fromPage = await pixelAt(page.bytes, 200, 280);
        const fromConvert = await pixelAt(converted, 200, 280);

        for (let channel = 0; channel < 3; channel += 1) {
            expect(Math.abs(fromPage[channel] - fromConvert[channel])).toBeLessThanOrEqual(8);
        }
    }, 30_000);

    /**
     * The sentence itself is poor — it is the emscripten exit string pinned as a
     * KNOWN HOLE in hostile-inputs.test.js, and improving it is a separate
     * decision. What is pinned here is that there is ONE answer: the tool that
     * copies bytes and the tool that decodes them refuse the same file in the
     * same words, so the two cannot drift apart again.
     */
    it('is refused in exactly the words /convert refuses it in', async () => {
        const stub = await cutTo(200);

        const fromConvert = await thrownBy(convertOf(stub));
        const fromPdf = await thrownBy(makePdf([fileOf(stub, 'stub.jpg', 'image/jpeg')]));

        expect(fromConvert.message).toBeTruthy();
        expect(fromPdf.message).toBe(fromConvert.message);
        expect(fromPdf.name).toBe(fromConvert.name);
    }, 30_000);

    it('leaves a whole JPEG on the cheap lane, byte for byte', async () => {
        const whole = Buffer.from(await noiseJpeg({ width: 400, height: 300 }));
        const result = await makePdf([fileOf(whole, 'whole.jpg', 'image/jpeg')]);
        const [image] = await pageImages(await bytesOf(result.blob));

        expect(image.bytes.equals(whole)).toBe(true);
        expect(result.reencodedCount).toBe(0);
    }, 30_000);

    it('has no end to report — not from the header, and not from an empty file', async () => {
        const whole = new Uint8Array(await noiseJpeg({ width: 400, height: 300 }));

        // The 200-byte stub is the reachable case: the header is whole enough
        // for embedJpg, and the picture never starts.
        expect(findJpegScanEnd(whole.subarray(0, 200))).toBe(NO_SCAN_END);
        expect(findJpegScanEnd(whole.subarray(0, 5353))).toBe(NO_SCAN_END);
        // An EOI that no scan ever reached ends nothing. It is a header with
        // no picture under it, and pdf-lib would make a blank page of it.
        expect(findJpegScanEnd(new Uint8Array([0xFF, 0xD8, 0xFF, 0xD9]))).toBe(NO_SCAN_END);
    });
});

/* ------------------------------------------------------------------ *
 * Metadata
 * ------------------------------------------------------------------ */

describe('the camera and the GPS do not travel with the photo', () => {
    it('the fixture really carries both going in', async () => {
        const source = await jpegWithExifAndGps({ width: 90, height: 60 });

        expect(Buffer.from(source).includes(EXIF_MARKER)).toBe(true);
        expect(Buffer.from(source).includes(GPS_MARKER)).toBe(true);
    });

    it('neither marker survives into the PDF', async () => {
        const source = await jpegWithExifAndGps({ width: 90, height: 60 });
        const result = await makePdf([fileOf(source, 'passport.jpg', 'image/jpeg')]);
        const output = await bytesOf(result.blob);

        expect(output.includes(EXIF_MARKER)).toBe(false);
        expect(output.includes(GPS_MARKER)).toBe(false);
    });

    it('and the compressed picture is still copied, not re-encoded', async () => {
        const source = Buffer.from(await jpegWithExifAndGps({ width: 90, height: 60 }));
        const result = await makePdf([fileOf(source, 'passport.jpg', 'image/jpeg')]);
        const [image] = await pageImages(await bytesOf(result.blob));

        // Everything from the start of scan to the end of the file — which is
        // the picture itself — is in the document unchanged. Stripping is a
        // rewrite of the segment table and nothing else.
        const scanStart = source.indexOf(Buffer.from([0xFF, 0xDA]));
        expect(scanStart).toBeGreaterThan(0);
        expect(image.bytes.includes(source.subarray(scanStart))).toBe(true);
        expect(image.filter).toBe('/DCTDecode');
        expect(result.reencodedCount).toBe(0);
    });
});

describe('stripping a JPEG down to its picture', () => {
    const SOI = [0xFF, 0xD8];
    const SCAN = [0xFF, 0xDA, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3F, 0x00, 0x11, 0x22, 0xFF, 0xD9];

    /** One segment: marker, length, payload. */
    function segment(marker, payload) {
        const header = Buffer.alloc(4);
        header.writeUInt16BE(0xFF00 | marker, 0);
        header.writeUInt16BE(payload.length + 2, 2);
        return Buffer.concat([header, Buffer.from(payload)]);
    }

    function jpeg(...segments) {
        return new Uint8Array(Buffer.concat([Buffer.from(SOI), ...segments, Buffer.from(SCAN)]));
    }

    it('drops Exif, XMP, ICC, IPTC and comments', () => {
        for (const marker of [0xE1, 0xE2, 0xED, 0xEF, 0xFE]) {
            const stripped = stripJpegMetadata(jpeg(segment(marker, 'SECRET')));
            expect(Buffer.from(stripped).includes('SECRET'), `APP${marker - 0xE0} survived`).toBe(false);
        }
    });

    it('keeps JFIF and the Adobe colour marker, which are not metadata', () => {
        // APP14's transform flag is how a decoder knows whether a scan is YCbCr,
        // RGB or YCCK. Dropping it would not be a privacy win, it would be a
        // colour bug — and APP0 is only the density units.
        for (const marker of [0xE0, 0xEE]) {
            const source = jpeg(segment(marker, 'KEEPME'));
            expect(Buffer.from(stripJpegMetadata(source)).includes('KEEPME')).toBe(true);
        }
    });

    it('hands back the very same array when there is nothing to drop', () => {
        const source = jpeg(segment(0xE0, 'JFIF\0'));
        expect(stripJpegMetadata(source)).toBe(source);
    });

    it('never touches the entropy-coded data, even when a marker appears inside it', () => {
        const source = jpeg(segment(0xE1, 'Exif\0\0secret'));
        const stripped = Buffer.from(stripJpegMetadata(source));

        // The scan carries 0xFF bytes of its own; a walker that kept reading
        // past SOS would eat them as segment headers.
        expect(stripped.subarray(stripped.length - SCAN.length)).toEqual(Buffer.from(SCAN));
    });

    it('leaves anything that is not a parseable JPEG exactly as it found it', () => {
        for (const bytes of [
            new Uint8Array([1, 2, 3, 4]),
            new Uint8Array([0xFF, 0xD8, 0xFF, 0xE1, 0xFF, 0xFF]),
            new Uint8Array(2),
        ]) {
            expect(stripJpegMetadata(bytes)).toBe(bytes);
        }
    });

    /* --------------------------------------------------------------- *
     * The trailer
     * --------------------------------------------------------------- */

    const TRAILER = TRAILER_SENTINEL;

    /** A scan whose compressed bytes contain every 0xFF sequence that is NOT a marker. */
    function scan(...entropy) {
        return Buffer.concat([
            Buffer.from([0xFF, 0xDA, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3F, 0x00]),
            Buffer.from(entropy),
        ]);
    }

    const EOI = Buffer.from([0xFF, 0xD9]);

    it('stops at the end of the primary image instead of copying to the end of the file', () => {
        const source = new Uint8Array(Buffer.concat([
            Buffer.from(SOI),
            segment(0xE1, 'Exif\0\0secret'),
            scan(0x11, 0x22),
            EOI,
            TRAILER,
        ]));

        const stripped = Buffer.from(stripJpegMetadata(source));

        expect(stripped.includes(TRAILER)).toBe(false);
        expect(stripped.subarray(stripped.length - 2)).toEqual(EOI);
    });

    it('truncates the trailer even when there is no metadata segment to drop', () => {
        // The early "nothing to drop, hand the same array back" exit is the other
        // way a trailer reaches the document: a JPEG this engine wrote itself,
        // with a Motion Photo video stapled to the end of it.
        const source = new Uint8Array(Buffer.concat([
            Buffer.from(SOI),
            segment(0xE0, 'JFIF\0'),
            scan(0x11, 0x22),
            EOI,
            TRAILER,
        ]));

        const stripped = Buffer.from(stripJpegMetadata(source));

        expect(stripped.includes(TRAILER)).toBe(false);
        expect(stripped.length).toBe(source.length - TRAILER.length);
    });

    it('reads past a stuffed 0xFF, a restart marker and a stray 0xD9 in the scan', () => {
        // In entropy-coded data a 0xFF is followed by 0x00 (byte stuffing) or by
        // a restart marker D0-D7. Only anything else is a real marker, so an
        // indexOf for FF D9 truncates a real photo in the middle of its picture.
        const entropy = [
            0x11, 0xFF, 0x00, 0x22, // stuffed FF, then a literal 0x22
            0xFF, 0xD0, 0x33, // restart 0
            0xFF, 0x00, 0xD9, // a 0xD9 that is NOT a marker: the FF before it is stuffed
            0xFF, 0xD7, 0x44, // restart 7
            0x00, 0xD9, // a bare 0xD9 byte, no FF in front of it
        ];

        const source = new Uint8Array(Buffer.concat([
            Buffer.from(SOI),
            segment(0xE1, 'Exif\0\0secret'),
            scan(...entropy),
            EOI,
            TRAILER,
        ]));

        const stripped = Buffer.from(stripJpegMetadata(source));

        expect(stripped.includes(Buffer.from(entropy))).toBe(true);
        expect(stripped.includes(TRAILER)).toBe(false);
        expect(stripped.subarray(stripped.length - 2)).toEqual(EOI);
    });

    it('walks the second scan of a multi-scan file rather than stopping at the first', () => {
        // A progressive JPEG is several scans with their own tables between them.
        // A walker that gave up at the first marker after SOS would never reach
        // the EOI and would disqualify every progressive photo on the site.
        const source = new Uint8Array(Buffer.concat([
            Buffer.from(SOI),
            segment(0xE1, 'Exif\0\0secret'),
            scan(0x11, 0x22),
            segment(0xC4, 'huffman-table'), // DHT between the scans
            scan(0x33, 0x44),
            EOI,
            TRAILER,
        ]));

        const stripped = Buffer.from(stripJpegMetadata(source));

        expect(stripped.includes(Buffer.from('huffman-table'))).toBe(true);
        expect(stripped.includes(Buffer.from([0x33, 0x44]))).toBe(true);
        expect(stripped.includes(TRAILER)).toBe(false);
        expect(stripped.subarray(stripped.length - 2)).toEqual(EOI);
    });

    it('answers where a real photo ends, and where the one behind it starts', async () => {
        const primary = Buffer.from(await splitRedBlueJpegPlain({ width: 120, height: 80 }));
        const secondary = Buffer.from(await noiseJpeg({ width: 40, height: 30 }));

        // On its own, the end of the file. Stapled to a second image, still the
        // end of the FIRST one — which is the whole difference this fix is.
        expect(findJpegScanEnd(new Uint8Array(primary))).toBe(primary.length);
        expect(findJpegScanEnd(new Uint8Array(Buffer.concat([primary, secondary]))))
            .toBe(primary.length);
        expect(findJpegScanEnd(new Uint8Array(Buffer.concat([primary, TRAILER_SENTINEL]))))
            .toBe(primary.length);
    });

    it('answers NO_SCAN_END rather than guessing when the scan has no end', () => {
        const source = new Uint8Array(Buffer.concat([
            Buffer.from(SOI),
            segment(0xE0, 'JFIF\0'),
            scan(0x11, 0xFF, 0x00, 0x22),
        ]));

        expect(findJpegScanEnd(source)).toBe(NO_SCAN_END);
    });

    it('refuses the copy lane outright when the picture has no end', () => {
        // Nothing here may guess. A scan with no EOI cannot be bounded, so it is
        // not copied at all — null sends the file down the decode lane, which
        // rebuilds the bytes and is safe by construction.
        const source = new Uint8Array(Buffer.concat([
            Buffer.from(SOI),
            segment(0xE1, 'Exif\0\0secret'),
            scan(0x11, 0x22, 0x33),
        ]));

        expect(stripJpegMetadata(source)).toBe(null);
    });
});

/* ------------------------------------------------------------------ *
 * The trailer, through the real tool
 * ------------------------------------------------------------------ */

describe('what a phone staples after the end of a photo does not reach the page', () => {
    async function withSecondImage() {
        const primary = Buffer.from(await jpegWithExifAndGps({ width: 90, height: 60 }));
        const secondary = Buffer.from(await jpegWithExifAndGps({
            width: 32,
            height: 24,
            exifMarker: TRAILER_EXIF_MARKER,
            gpsMarker: TRAILER_GPS_MARKER,
        }));

        return { primary, secondary, bytes: Buffer.concat([primary, secondary]) };
    }

    it('the fixture really is two images, each with its own GPS', async () => {
        const { primary, secondary, bytes } = await withSecondImage();

        expect(primary.subarray(primary.length - 2)).toEqual(Buffer.from([0xFF, 0xD9]));
        expect(secondary.includes(TRAILER_GPS_MARKER)).toBe(true);
        expect(bytes.includes(GPS_MARKER)).toBe(true);
        expect(bytes.includes(TRAILER_GPS_MARKER)).toBe(true);
    });

    it('carries neither the primary nor the secondary image’s coordinates into the PDF', async () => {
        const { bytes } = await withSecondImage();
        const result = await makePdf([fileOf(bytes, 'passport.jpg', 'image/jpeg')]);
        const output = await bytesOf(result.blob);

        expect(output.includes(EXIF_MARKER)).toBe(false);
        expect(output.includes(GPS_MARKER)).toBe(false);
        // The one the shipped build leaked: the primary was stripped correctly
        // and the second image walked in behind it, whole.
        expect(output.includes(TRAILER_EXIF_MARKER)).toBe(false);
        expect(output.includes(TRAILER_GPS_MARKER)).toBe(false);
    });

    it('still puts the primary picture on the page without decoding it', async () => {
        const { bytes } = await withSecondImage();
        const result = await makePdf([fileOf(bytes, 'passport.jpg', 'image/jpeg')]);
        const [image] = await pageImages(await bytesOf(result.blob));

        expect(result.reencodedCount).toBe(0);
        expect(image.filter).toBe('/DCTDecode');
        expect({ width: image.width, height: image.height }).toEqual({ width: 90, height: 60 });
    });

    it('does not carry three megabytes of appended video into a document', async () => {
        const primary = Buffer.from(await noiseJpeg({ width: 400, height: 300 }));
        const junk = Buffer.alloc(3 * 1024 * 1024, 0xAB);
        TRAILER_SENTINEL.copy(junk, 0);

        const source = Buffer.concat([primary, junk]);
        const result = await makePdf([fileOf(source, 'motion.jpg', 'image/jpeg')]);
        const output = await bytesOf(result.blob);

        expect(output.includes(TRAILER_SENTINEL)).toBe(false);
        // Bounded by the picture, not by the file. The shipped build produced a
        // 3,247,311-byte PDF here and reported it as a 0% saving.
        expect(result.resultBytes).toBeLessThan(primary.length + 4096);
        expect(result.originalBytes).toBe(source.length);
        expect(result.savedPercent).toBeGreaterThan(0);
    }, 30_000);

    it('finds the real end of a busy scan, not the first 0xFFD9 inside it', async () => {
        const primary = Buffer.from(await noiseJpeg({ width: 400, height: 300 }));

        // The fixture has to be able to fail this test: noise at quality 92
        // carries stuffed 0xFF bytes, and a naive scan would stop at the first
        // 0xFF 0xD9 pair among them.
        expect(primary.includes(Buffer.from([0xFF, 0x00]))).toBe(true);

        const source = Buffer.concat([primary, TRAILER_SENTINEL]);
        const result = await makePdf([fileOf(source, 'noise.jpg', 'image/jpeg')]);
        const [image] = await pageImages(await bytesOf(result.blob));

        // Byte-identical to the primary image: one byte early and this fails.
        expect(image.bytes.equals(primary)).toBe(true);
        expect({ width: image.width, height: image.height }).toEqual({ width: 400, height: 300 });
        expect(result.reencodedCount).toBe(0);
    }, 30_000);

    it('finds the end of a progressive JPEG, which is several scans', async () => {
        const primary = await sharp(await noiseJpeg({ width: 200, height: 150 }))
            .jpeg({ progressive: true, quality: 80 })
            .toBuffer();

        const source = Buffer.concat([primary, TRAILER_SENTINEL]);
        const result = await makePdf([fileOf(source, 'progressive.jpg', 'image/jpeg')]);
        const [image] = await pageImages(await bytesOf(result.blob));

        expect(image.bytes.equals(primary)).toBe(true);
        expect(result.reencodedCount).toBe(0);
    }, 30_000);

    it('leaves a JPEG with no trailer bit-identical on the cheap lane', async () => {
        const source = await splitRedBlueJpegPlain({ width: 120, height: 80 });
        const result = await makePdf([fileOf(source, 'photo.jpg', 'image/jpeg')]);
        const [image] = await pageImages(await bytesOf(result.blob));

        expect(image.bytes.equals(Buffer.from(source))).toBe(true);
        expect(result.reencodedCount).toBe(0);
    });
});

/* ------------------------------------------------------------------ *
 * Order
 * ------------------------------------------------------------------ */

describe('the pages come out in the order they were given', () => {
    async function flat(colour) {
        return sharp({ create: { width: 60, height: 40, channels: 3, background: colour } })
            .jpeg({ quality: 100 })
            .toBuffer();
    }

    it('honours the caller’s order exactly, including one that is not sorted', async () => {
        const red = await flat({ r: 255, g: 0, b: 0 });
        const green = await flat({ r: 0, g: 255, b: 0 });
        const blue = await flat({ r: 0, g: 0, b: 255 });

        const result = await makePdf([
            fileOf(blue, 'c-third.jpg', 'image/jpeg'),
            fileOf(red, 'a-first.jpg', 'image/jpeg'),
            fileOf(green, 'b-second.jpg', 'image/jpeg'),
        ]);

        const images = await pageImages(await bytesOf(result.blob));
        expect(images).toHaveLength(3);
        expect(result.pageCount).toBe(3);

        const dominant = await Promise.all(images.map(async (image) => {
            const [r, g, b] = await pixelAt(image.bytes, 30, 20);
            if (r > 200) return 'red';
            if (g > 200) return 'green';
            return b > 200 ? 'blue' : 'unknown';
        }));

        // Not alphabetical, not by size — the order the list was handed over in.
        expect(dominant).toEqual(['blue', 'red', 'green']);
    });

    it('names the document after the first file', async () => {
        const red = await flat({ r: 255, g: 0, b: 0 });
        const result = await makePdf([
            fileOf(red, 'scan page one.jpg', 'image/jpeg'),
            fileOf(red, 'scan page two.jpg', 'image/jpeg'),
        ]);

        expect(result.filename).toBe('resizo-scan-page-one.pdf');
        expect(result.format).toBe('pdf');
        expect(result.type).toBe('application/pdf');
    });
});

/* ------------------------------------------------------------------ *
 * Orientation
 * ------------------------------------------------------------------ */

describe('a photo that needs turning is turned before it is embedded', () => {
    const SOURCE = { width: 40, height: 20 };

    it('comes out upright, at swapped dimensions, for Orientation 6', async () => {
        const source = await splitRedBlueJpegOriented({ ...SOURCE, orientation: 6 });
        expect((await sharp(source).metadata()).orientation).toBe(6);

        const result = await makePdf([fileOf(source, 'portrait.jpg', 'image/jpeg')]);
        const [image] = await pageImages(await bytesOf(result.blob));

        // Stored 40x20, displayed 20x40. A byte copy would have left it 40x20
        // and the tag — which no PDF reader honours — would have been the only
        // thing saying otherwise.
        expect({ width: image.width, height: image.height }).toEqual({ width: 20, height: 40 });

        // The dimensions alone cannot tell a quarter turn from its mirror, so
        // the corners decide: a quarter turn clockwise puts the left half of the
        // stored image along the top.
        expect(hue(await pixelAt(image.bytes, 10, 2))).toBe('red');
        expect(hue(await pixelAt(image.bytes, 10, 37))).toBe('blue');
    });

    it('cannot be a byte copy, and does not pretend to be one', async () => {
        const source = await splitRedBlueJpegOriented({ ...SOURCE, orientation: 6 });
        const result = await makePdf([fileOf(source, 'portrait.jpg', 'image/jpeg')]);
        const output = await bytesOf(result.blob);

        expect(output.includes(Buffer.from(source))).toBe(false);
        expect(result.reencodedCount).toBe(1);
    });

    it.each([2, 3, 4, 5, 6, 7, 8])('turns Orientation %i the same way the reader would', async (orientation) => {
        const source = await splitRedBlueJpegOriented({ ...SOURCE, orientation });
        const result = await makePdf([fileOf(source, 'photo.jpg', 'image/jpeg')]);
        const [image] = await pageImages(await bytesOf(result.blob));

        // sharp's own .rotate() is the independent reference: it reads the tag
        // and bakes it in, which is exactly what the engine has to have done.
        const reference = await sharp(source).rotate().raw().toBuffer({ resolveWithObject: true });

        expect({ width: image.width, height: image.height })
            .toEqual({ width: reference.info.width, height: reference.info.height });

        const corner = (data, info, x, y) => {
            const offset = ((y * info.width) + x) * info.channels;
            return hue([data[offset], data[offset + 1], data[offset + 2]]);
        };

        const engine = await sharp(image.bytes).raw().toBuffer({ resolveWithObject: true });
        for (const [x, y] of [[1, 1], [reference.info.width - 2, 1], [1, reference.info.height - 2]]) {
            expect(corner(engine.data, engine.info, x, y))
                .toBe(corner(reference.data, reference.info, x, y));
        }
    });

    it('leaves an untagged JPEG on the cheap lane', async () => {
        const source = await splitRedBlueJpegPlain(SOURCE);
        const result = await makePdf([fileOf(source, 'photo.jpg', 'image/jpeg')]);

        expect(result.reencodedCount).toBe(0);
        expect((await bytesOf(result.blob)).includes(Buffer.from(source))).toBe(true);
    });
});

/* ------------------------------------------------------------------ *
 * The formats that have to be decoded
 * ------------------------------------------------------------------ */

describe('PNG and WebP are decoded and re-encoded, not embedded raw', () => {
    it('turns a PNG into a real, readable page', async () => {
        const source = await splitRedBluePng({ width: 80, height: 40 });
        const result = await makePdf([fileOf(source, 'chart.png', 'image/png')]);
        const output = await bytesOf(result.blob);

        expect(output.subarray(0, 5).toString('latin1')).toBe('%PDF-');
        expect(result.reencodedCount).toBe(1);

        const [image] = await pageImages(output);
        expect(image.filter).toBe('/DCTDecode');
        expect({ width: image.width, height: image.height }).toEqual({ width: 80, height: 40 });

        // The picture survived the round trip: the seam is still where it was.
        expect(hue(await pixelAt(image.bytes, 5, 20))).toBe('red');
        expect(hue(await pixelAt(image.bytes, 75, 20))).toBe('blue');
    });

    it('fills a transparent PNG with white, because a page is white paper', async () => {
        const source = await halfAlphaPng({ width: 40, height: 30 });
        const result = await makePdf([fileOf(source, 'logo.png', 'image/png')]);
        const [image] = await pageImages(await bytesOf(result.blob));

        // Half-opaque blue over white, not over the black the rest of the engine
        // composites onto: a black rectangle on a white sheet is a defect, and
        // no page here promises black the way /png-to-jpg does.
        const [r, g, b] = await pixelAt(image.bytes, 20, 15);
        expect(r).toBeGreaterThan(110);
        expect(g).toBeGreaterThan(150);
        expect(b).toBeGreaterThan(200);
    });

    it('accepts a mixed pile and only decodes what it has to', async () => {
        const jpg = await splitRedBlueJpegPlain({ width: 60, height: 40 });
        const png = await splitRedBluePng({ width: 60, height: 40 });

        const result = await makePdf([
            fileOf(jpg, 'a.jpg', 'image/jpeg'),
            fileOf(png, 'b.png', 'image/png'),
            fileOf(jpg, 'c.jpg', 'image/jpeg'),
        ]);

        expect(result.pageCount).toBe(3);
        expect(result.reencodedCount).toBe(1);
        expect((await bytesOf(result.blob)).includes(Buffer.from(jpg))).toBe(true);
    });
});

/* ------------------------------------------------------------------ *
 * Geometry
 * ------------------------------------------------------------------ */

describe('where the image sits on the page', () => {
    it('fits the page to the image by default, with nothing left over', () => {
        const geometry = pageGeometry(1200, 800);

        expect(geometry.pageWidth).toBeCloseTo(pixelsToPoints(1200), 5);
        expect(geometry.pageHeight).toBeCloseTo(pixelsToPoints(800), 5);
        expect({ x: geometry.x, y: geometry.y }).toEqual({ x: 0, y: 0 });
        expect(geometry.width).toBeCloseTo(geometry.pageWidth, 5);
        expect(geometry.height).toBeCloseTo(geometry.pageHeight, 5);
    });

    it('gives a landscape photo a landscape page and a portrait one a portrait page', async () => {
        const wide = await splitRedBlueJpegPlain({ width: 200, height: 100 });
        const tall = await splitRedBlueJpegPlain({ width: 100, height: 200 });

        const result = await makePdf([
            fileOf(wide, 'wide.jpg', 'image/jpeg'),
            fileOf(tall, 'tall.jpg', 'image/jpeg'),
        ]);

        const [first, second] = await pageSizes(await bytesOf(result.blob));
        expect(first.width).toBeGreaterThan(first.height);
        expect(second.height).toBeGreaterThan(second.width);
    });

    it.each([
        [PAGE_SIZE_A4, A4_POINTS],
        [PAGE_SIZE_LETTER, LETTER_POINTS],
    ])('puts the image inside a %s page, centred and undistorted', (size, [shortSide, longSide]) => {
        const geometry = pageGeometry(1000, 500, { pageSize: size, orientation: PORTRAIT });

        expect(geometry.pageWidth).toBeCloseTo(shortSide, 5);
        expect(geometry.pageHeight).toBeCloseTo(longSide, 5);

        // Aspect ratio kept: 2:1 in, 2:1 out.
        expect(geometry.width / geometry.height).toBeCloseTo(2, 5);
        expect(geometry.width).toBeLessThanOrEqual(shortSide + 0.001);

        // Centred, which is the only sane thing to do with the leftover space.
        expect(geometry.x * 2).toBeCloseTo(shortSide - geometry.width, 5);
        expect(geometry.y * 2).toBeCloseTo(longSide - geometry.height, 5);
    });

    it('turns the page over for landscape, and only for a fixed size', () => {
        const portrait = pageGeometry(1000, 500, { pageSize: PAGE_SIZE_A4, orientation: PORTRAIT });
        const landscape = pageGeometry(1000, 500, { pageSize: PAGE_SIZE_A4, orientation: LANDSCAPE });

        expect(landscape.pageWidth).toBeCloseTo(portrait.pageHeight, 5);
        expect(landscape.pageHeight).toBeCloseTo(portrait.pageWidth, 5);

        // A fitted page takes its shape from the image, so the setting has
        // nothing to turn.
        expect(pageGeometry(1000, 500, { pageSize: PAGE_SIZE_FIT, orientation: LANDSCAPE }))
            .toEqual(pageGeometry(1000, 500, { pageSize: PAGE_SIZE_FIT, orientation: PORTRAIT }));
    });

    it('keeps a margin clear on all four sides', () => {
        const margin = 36;
        const fitted = pageGeometry(400, 400, { margin });
        expect(fitted.x).toBeCloseTo(margin, 5);
        expect(fitted.pageWidth - fitted.width - fitted.x).toBeCloseTo(margin, 5);

        const a4 = pageGeometry(1000, 1000, { pageSize: PAGE_SIZE_A4, margin });
        expect(a4.width).toBeLessThanOrEqual(A4_POINTS[0] - (margin * 2) + 0.001);
        expect(a4.x).toBeGreaterThanOrEqual(margin - 0.001);
    });

    it('never asks for a page the format cannot describe', () => {
        const geometry = pageGeometry(60_000, 1000);
        expect(geometry.pageWidth).toBeLessThanOrEqual(MAX_PAGE_POINTS);
        expect(geometry.pageHeight).toBeLessThanOrEqual(MAX_PAGE_POINTS);
        // Shrunk, not squashed.
        expect(geometry.pageWidth / geometry.pageHeight).toBeCloseTo(60, 5);
    });

    it('scales a small image up to fill a fixed page, which costs nothing', () => {
        const geometry = pageGeometry(100, 100, { pageSize: PAGE_SIZE_A4 });
        expect(geometry.width).toBeGreaterThan(pixelsToPoints(100));
    });
});

describe('the option parsers', () => {
    it.each([
        [undefined, PAGE_SIZE_FIT],
        ['', PAGE_SIZE_FIT],
        ['A4', PAGE_SIZE_A4],
        [' letter ', PAGE_SIZE_LETTER],
    ])('reads %s as %s', (raw, expected) => {
        expect(parsePageSize(raw)).toEqual({ ok: true, value: expected });
    });

    it('refuses a page size it does not know', async () => {
        expect(parsePageSize('a3').ok).toBe(false);

        const source = await splitRedBlueJpegPlain({ width: 40, height: 20 });
        const failure = await makePdf([fileOf(source, 'a.jpg', 'image/jpeg')], { pageSize: 'a3' })
            .catch((error) => error);

        expect(failure).toBeInstanceOf(JobError);
        expect(failure.code).toBe('invalid-page-size');
    });

    it('refuses an orientation and a margin it does not know', () => {
        expect(parsePageOrientation('sideways').ok).toBe(false);
        expect(parsePageOrientation(undefined)).toEqual({ ok: true, value: PORTRAIT });
        expect(parseMarginPoints('-1').ok).toBe(false);
        expect(parseMarginPoints(MAX_MARGIN_POINTS + 1).ok).toBe(false);
        expect(parseMarginPoints('36')).toEqual({ ok: true, value: 36 });
    });
});

/* ------------------------------------------------------------------ *
 * The size target
 * ------------------------------------------------------------------ */

describe('a PDF of a chosen size', () => {
    async function noiseFiles(count, size = { width: 500, height: 400 }) {
        const files = [];
        for (let index = 0; index < count; index += 1) {
            const bytes = await noiseJpeg({ ...size, seed: index + 1 });
            files.push(fileOf(bytes, `noise-${index}.jpg`, 'image/jpeg'));
        }
        return files;
    }

    it('leaves the originals alone when they already fit the target', async () => {
        const files = await noiseFiles(2);
        const generous = files.reduce((sum, file) => sum + file.size, 0) + MIN_TARGET_BYTES;

        const result = await makePdf(files, { targetBytes: generous });

        expect(result.targetMet).toBe(true);
        expect(result.resultBytes).toBeLessThanOrEqual(generous);
        expect(result.targetMessage).toBeNull();
        expect(result.pageCount).toBe(2);

        // Nothing was decoded to hit a target the files were already inside.
        expect(result.reencodedCount).toBe(0);
    }, 60_000);

    it('re-encodes to reach a target the originals are over', async () => {
        const files = await noiseFiles(2);
        const total = files.reduce((sum, file) => sum + file.size, 0);

        const result = await makePdf(files, { targetBytes: Math.round(total / 4) });

        expect(result.targetMet).toBe(true);
        expect(result.resultBytes).toBeLessThanOrEqual(Math.round(total / 4));
        expect(result.reencodedCount).toBe(2);
        expect(result.iterations).toBeGreaterThan(1);
    }, 60_000);

    it('says plainly when it cannot, and still hands over the document', async () => {
        // Four frames of pure noise against the smallest target the tool
        // accepts at all. Even at quality 1 — where MozJPEG has thrown away
        // everything it can — these do not add up to 10 KB, and the one lever
        // left would be shrinking the pictures, which this build will not do.
        const files = await noiseFiles(4, { width: 900, height: 700 });

        const result = await makePdf(files, { targetBytes: MIN_TARGET_BYTES });

        expect(result.targetMet).toBe(false);
        expect(result.resultBytes).toBeGreaterThan(MIN_TARGET_BYTES);
        expect(result.targetMessage).toBe(targetMissMessage(MIN_TARGET_BYTES, result.resultBytes));
        expect(result.targetMessage).toContain('Raise the target');

        // The document is real and complete. A miss is reported, never thrown
        // away — the pages were up to twenty files' worth of work.
        const images = await pageImages(await bytesOf(result.blob));
        expect(images).toHaveLength(4);
        for (const image of images) {
            expect({ width: image.width, height: image.height }).toEqual({ width: 900, height: 700 });
        }
    }, 120_000);

    it('never reaches a target by quietly shrinking the picture', async () => {
        const files = await noiseFiles(2);
        const result = await makePdf(files, { targetBytes: MIN_TARGET_BYTES });

        for (const image of await pageImages(await bytesOf(result.blob))) {
            expect({ width: image.width, height: image.height }).toEqual({ width: 500, height: 400 });
        }
    }, 60_000);

    it('spends what the page before it did not', async () => {
        const flat = await splitRedBlueJpegPlain({ width: 200, height: 100 });
        const noisy = await noiseJpeg({ width: 500, height: 400, seed: 9 });

        const files = [fileOf(flat, 'flat.jpg', 'image/jpeg'), fileOf(noisy, 'noisy.jpg', 'image/jpeg')];
        const total = files.reduce((sum, file) => sum + file.size, 0);
        const target = Math.round(total / 3);

        const withCarry = await makePdf(files, { targetBytes: target });

        // The flat image comes in far under its share and the difference goes to
        // the noisy one rather than being thrown away, so the document lands
        // close under the target rather than far below it.
        expect(withCarry.targetMet).toBe(true);
        expect(withCarry.resultBytes).toBeLessThanOrEqual(target);
        expect(withCarry.resultBytes).toBeGreaterThan(target * 0.5);
    }, 60_000);

    it('shares the target out in proportion to what each file weighs', () => {
        const images = [{ fileBytes: 300_000 }, { fileBytes: 100_000 }];
        const [first, second] = shareBudgets(images, 400_000);

        expect(first / second).toBeCloseTo(3, 1);
        // Room is left for the document's own structure, so the shares can
        // never add up to more than the target.
        expect(first + second).toBeLessThan(400_000);
    });

    it('refuses a malformed target before any work is done', async () => {
        const source = await splitRedBlueJpegPlain({ width: 40, height: 20 });
        const failure = await makePdf([fileOf(source, 'a.jpg', 'image/jpeg')], { targetBytes: 'lots' })
            .catch((error) => error);

        expect(failure).toBeInstanceOf(JobError);
        expect(failure.code).toBe('invalid-target');
    });

    it('reports no verdict at all when no target was asked for', async () => {
        const source = await splitRedBlueJpegPlain({ width: 40, height: 20 });
        const result = await makePdf([fileOf(source, 'a.jpg', 'image/jpeg')]);

        expect(result.targetBytes).toBeNull();
        expect(result.targetMet).toBeNull();
        expect(result.targetMessage).toBeNull();
    });
});

/* ------------------------------------------------------------------ *
 * The builder on its own
 * ------------------------------------------------------------------ */

describe('the builder, called directly', () => {
    it('takes raw bytes as well as files, which is what a worker transfer arrives as', async () => {
        const source = await splitRedBlueJpegPlain({ width: 60, height: 40 });

        for (const bytes of [new Uint8Array(source), new Uint8Array(source).buffer]) {
            const built = await buildPdf({
                images: [{ source: bytes, format: 'jpeg', fileBytes: source.byteLength }],
            });

            expect(built.pageCount).toBe(1);
            expect(built.reencodedCount).toBe(0);
            expect((await bytesOf(built.blob)).includes(Buffer.from(source))).toBe(true);
        }
    });

    it('stops searching when the clock runs out and says the target was missed', async () => {
        const source = await noiseJpeg({ width: 300, height: 200, seed: 4 });

        const built = await buildPdf({
            images: [{ source: new Uint8Array(source), format: 'png', fileBytes: source.byteLength }],
            targetBytes: MIN_TARGET_BYTES,
            // Already expired, so not one probe is allowed to run. The page is
            // still encoded and the document still exists — a person holding a
            // phone gets a file and a straight answer, not a failed job.
            deadline: 0,
            now: () => 1,
        });

        expect(built.pageCount).toBe(1);
        expect(built.iterations).toBe(0);
        expect(built.sharesMet).toBe(false);
        expect(built.targetMet).toBe(false);
    }, 30_000);

    it('refuses a page the device cannot hold, once the decoder has said how big it is', async () => {
        // A PNG says nothing about its size until it has been decoded, so this
        // is the one refusal that cannot happen in the pre-flight. It happens
        // between the decode and the encode instead — before the encoder is
        // handed a surface — and it has to arrive as a sentence a person can
        // act on rather than as an out-of-memory nobody catches.
        const source = await sharp({
            create: { width: 4000, height: 3000, channels: 3, background: { r: 20, g: 60, b: 120 } },
        }).png().toBuffer();

        // 0.5 GB is a real navigator.deviceMemory value, and iOS takes the
        // extra haircut because a tab there is killed with nothing to catch.
        const phone = {
            memoryGb: 0.5, memoryReported: true, cores: 6, ios: true, nativeDownscale: false, wasm: true,
        };

        const failure = await buildPdf({
            images: [{ source: new Uint8Array(source), format: 'png', fileBytes: source.byteLength }],
            device: phone,
        }).catch((error) => error);

        expect(failure).toBeInstanceOf(Error);
        expect(failure.code).toBe('not-enough-memory');
        expect(failure.message).toContain('MB');
        expect(failure.suggestion).toBeTruthy();
    }, 60_000);

    it('splits a target evenly when nothing declares a size', () => {
        const budgets = shareBudgets([{}, {}], 100_000);
        expect(budgets[0]).toBe(budgets[1]);
        expect(budgets[0]).toBeGreaterThan(0);
    });

    it('hands every caller the same writer, and reloads it after a reset', async () => {
        const { loadPdfWriter, resetPdfWriter } = await import('@/lib/image-client/pdf');

        const [first, second] = await Promise.all([loadPdfWriter(), loadPdfWriter()]);
        expect(first).toBe(second);

        resetPdfWriter();
        expect(await loadPdfWriter()).toBe(first);
    });
});

/* ------------------------------------------------------------------ *
 * The memory gate
 * ------------------------------------------------------------------ */

describe('what a PDF job is costed at', () => {
    const TWELVE_MP = { sourceWidth: 4032, sourceHeight: 3024 };
    const THREE_MB = 3 * 1024 * 1024;

    function device({ memoryGb = 4, ios = false } = {}) {
        return { memoryGb, memoryReported: true, cores: 8, ios, nativeDownscale: false, wasm: true };
    }

    it('charges a copied JPEG a fraction of what a decoded one costs', () => {
        const copied = estimatePdfPeakBytes({
            pages: [{ fileBytes: THREE_MB, ...TWELVE_MP, reencoded: false }],
        });
        const decoded = estimatePdfPeakBytes({
            pages: [{ fileBytes: THREE_MB, ...TWELVE_MP, reencoded: true }],
        });

        // 0.45 MB of heap growth against 45.78 MB for one surface. The gate must
        // reflect that or the tool refuses jobs it could do — and twenty photos
        // is the job it exists for.
        expect(copied).toBeLessThan(decoded / 2);
        expect(decoded - copied).toBeGreaterThan(80 * 1024 * 1024);
    });

    it('charges one page at a time, not all of them at once', () => {
        const pages = (count) => Array.from({ length: count }, () => ({
            fileBytes: THREE_MB, ...TWELVE_MP, reencoded: true,
        }));

        const one = estimatePdfPeakBytes({ pages: pages(1) });
        const twenty = estimatePdfPeakBytes({ pages: pages(20) });

        // Twenty pages cost nineteen more documents' worth of bytes and not one
        // extra surface. Charging twenty surfaces would be 900 MB and would
        // refuse every real job.
        expect(twenty - one).toBeCloseTo(19 * THREE_MB * PDF_DOCUMENT_COPIES, -3);
    });

    /**
     * EVERY PILE ABOVE IS TWENTY IDENTICAL PAGES, AND THAT HID THE SELECTION.
     *
     * `estimatePdfPeakBytes` charges the LARGEST single page's stage, because
     * the loop works one page at a time. A pile of identical pages cannot tell
     * "largest" apart from "first", "last" or "any" — measured by mutation,
     * replacing the running maximum with "keep the first" left the whole suite
     * green.
     *
     * That mutation is the worst kind of wrong this file can be. It under-
     * charges, and an under-charged job is not refused: it is attempted, and on
     * iOS an attempt that oversteps kills the tab with no exception, no error
     * event and no message — the photo is simply gone. Someone whose first page
     * is a small screenshot and whose second is a 12 MP photo is exactly the
     * person this would hit.
     *
     * So the pile below is deliberately RAGGED, and the big page is never first.
     */
    describe('the page it charges for is the largest one, wherever it sits', () => {
        const SMALL = { sourceWidth: 640, sourceHeight: 480 };
        const HUGE = { sourceWidth: 6000, sourceHeight: 4000 };
        const page = (size, reencoded = true) => ({ fileBytes: THREE_MB, ...size, reencoded });

        it('costs a small-then-huge pile the same as a huge-then-small one', () => {
            const bigLast = estimatePdfPeakBytes({ pages: [page(SMALL), page(SMALL), page(HUGE)] });
            const bigFirst = estimatePdfPeakBytes({ pages: [page(HUGE), page(SMALL), page(SMALL)] });

            expect(bigLast).toBe(bigFirst);
        });

        it('charges the huge page even when every other page is small', () => {
            const allSmall = estimatePdfPeakBytes({ pages: [page(SMALL), page(SMALL), page(SMALL)] });
            const oneHuge = estimatePdfPeakBytes({ pages: [page(SMALL), page(SMALL), page(HUGE)] });

            // The document half is identical — same count, same bytes — so the
            // whole difference is the page stage, and it must be the huge one.
            expect(oneHuge).toBeGreaterThan(allSmall);
            expect(oneHuge - allSmall).toBeGreaterThan(40 * 1024 * 1024);
        });

        it('refuses a pile whose only big page is last, on a device that cannot hold it', () => {
            // An iPhone, which is where an under-charge costs the photo rather
            // than an error message.
            const phone = device({ memoryGb: 1, ios: true });

            // Three small pages alone are comfortably inside the budget, so the
            // refusal below can only be coming from the page that is last.
            expect(assessPdfJob({ pages: [page(SMALL), page(SMALL), page(SMALL)], device: phone }).ok)
                .toBe(true);

            const refused = assessPdfJob({ pages: [page(SMALL), page(SMALL), page(HUGE)], device: phone });

            expect(refused.ok).toBe(false);
            expect(refused.code).toBe('not-enough-memory');
        });
    });

    /**
     * The embed lane's cost, pinned as an equation rather than an inequality.
     *
     * The test above it asserts only that a copied page costs LESS than a
     * decoded one, which stays true however far the copy is under-charged —
     * halving PDF_EMBED_FILE_COPIES left it green. This states the arithmetic
     * outright, so either constant moving is a failure that names itself.
     */
    /**
     * The two lane costs, pinned to LITERALS rather than to the constants.
     *
     * Writing `THREE_MB * PDF_EMBED_FILE_COPIES` here would be a tautology: the
     * expectation imports the same constant the code uses, so halving it moves
     * both sides of the equation and the test stays green. Measured — that is
     * exactly what happened, and dropping PDF_EMBED_FILE_COPIES from 2 to 1 was
     * a survived mutation until these numbers were written out.
     *
     * The literals are the measurements from capability.js: the copy lane holds
     * the bytes read off the file AND the metadata-stripped copy handed to
     * embedJpg (2), and the document holds the embedded streams, the array
     * doc.save() serialises into, and the Blob built from it (3).
     */
    it('pins the copy lane at two file copies and the document at three', () => {
        expect(PDF_EMBED_FILE_COPIES).toBe(2);
        expect(PDF_DOCUMENT_COPIES).toBe(3);
    });

    it('charges a copied page exactly its bytes twice, plus the document and the codecs', () => {
        const oneCopiedPage = estimatePdfPeakBytes({
            pages: [{ fileBytes: THREE_MB, ...TWELVE_MP, reencoded: false }],
        });

        expect(oneCopiedPage).toBe((THREE_MB * 3) + (THREE_MB * 2) + WASM_BASELINE_BYTES);
    });

    it('charges an unsized page as an embed, because nothing can size it yet', () => {
        const unsized = estimatePdfPeakBytes({
            pages: [{ fileBytes: THREE_MB, reencoded: true }],
        });

        // `reencoded` is true but the dimensions are unknown, so the surface
        // cannot be priced and the embed cost is the honest floor.
        expect(unsized).toBe((THREE_MB * 3) + (THREE_MB * 2) + WASM_BASELINE_BYTES);
    });

    it('lets through a pile of JPEGs that the same pile of PNGs could not fit', () => {
        const small = device({ memoryGb: 1 });
        const files = (reencoded) => Array.from({ length: 20 }, () => ({
            fileBytes: THREE_MB, ...TWELVE_MP, reencoded,
        }));

        expect(assessPdfJob({ pages: files(false), device: small }).ok).toBe(true);

        const refused = assessPdfJob({ pages: files(true), device: small });
        expect(refused.ok).toBe(false);
        expect(refused.code).toBe('not-enough-memory');
        expect(refused.reason).toContain('MB');
        expect(refused.suggestion).toBeTruthy();
    });

    it('refuses more files than a PDF is allowed to hold', () => {
        const pages = Array.from({ length: MAX_BULK_FILES + 1 }, () => ({ fileBytes: 1024 }));
        const refused = assessPdfJob({ pages });

        expect(refused.code).toBe('too-many-files');
        expect(refused.reason).toContain(String(MAX_BULK_FILES));
    });

    it('refuses a pile that is past the total byte limit', () => {
        const pages = Array.from({ length: 5 }, () => ({ fileBytes: MAX_BULK_TOTAL_BYTES / 4 }));
        expect(assessPdfJob({ pages }).code).toBe('total-too-large');
    });

    it('refuses an empty list rather than building an empty document', async () => {
        expect(assessPdfJob({ pages: [] }).code).toBe('no-file');

        const failure = await makePdf([]).catch((error) => error);
        expect(failure).toBeInstanceOf(JobError);

        await expect(buildPdf({ images: [] })).rejects.toThrow();
    });

    it('refuses on the dimensions the page measured, before anything is decoded', async () => {
        const source = await splitRedBluePng({ width: 80, height: 40 });

        // The page measures every file at intake and hands the sizes over in
        // order, one entry per file. This one claims 400 megapixels — 3 GB of
        // surface — so the per-file gate refuses it on the same source ceiling
        // every other tool is held to, while there is still a tab alive to say
        // so: on iOS an over-committed tab is killed with nothing to catch.
        const failure = await makePdf(
            [fileOf(source, 'huge.png', 'image/png')],
            { sizes: [{ width: 20_000, height: 20_000 }] },
        ).catch((error) => error);

        expect(failure).toBeInstanceOf(JobError);
        expect(failure.code).toBe('source-too-large');

        // Without the measurement there is nothing to refuse on yet, and the
        // same file goes through — the deferral every unmeasured file gets.
        await expect(makePdf([fileOf(source, 'huge.png', 'image/png')])).resolves.toBeTruthy();
    });

    it('answers with a sentence and a suggestion, never a bare boolean', () => {
        const refused = assessPdfJob({ pages: [], device: device() });
        expect(typeof refused.reason).toBe('string');
        expect(typeof refused.suggestion).toBe('string');
    });
});

/* ------------------------------------------------------------------ *
 * The op as the worker sees it
 * ------------------------------------------------------------------ */

describe('the op end to end', () => {
    it('reports the whole pile as the original size, not just the first file', async () => {
        const a = await splitRedBlueJpegPlain({ width: 60, height: 40 });
        const b = await splitRedBluePng({ width: 60, height: 40 });

        const files = [fileOf(a, 'a.jpg', 'image/jpeg'), fileOf(b, 'b.png', 'image/png')];
        const result = await makePdf(files);

        expect(result.originalBytes).toBe(files[0].size + files[1].size);
        expect(result.resultBytes).toBe(result.blob.size);
        expect(result.operation).toBe('pdf');
        expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('reports progress and finishes at 100', async () => {
        const source = await splitRedBlueJpegPlain({ width: 60, height: 40 });
        const seen = [];

        await runOperation(
            'pdf',
            [fileOf(source, 'a.jpg', 'image/jpeg'), fileOf(source, 'b.jpg', 'image/jpeg')],
            {},
            { onProgress: (value, phase) => seen.push([value, phase]) },
        );

        expect(seen.at(-1)).toEqual([100, 'done']);
        expect(seen.some(([, phase]) => phase === 'building')).toBe(true);
    });

    it('stops when the job is cancelled', async () => {
        const source = await splitRedBlueJpegPlain({ width: 60, height: 40 });
        let calls = 0;

        const failure = await runOperation(
            'pdf',
            [fileOf(source, 'a.jpg', 'image/jpeg'), fileOf(source, 'b.jpg', 'image/jpeg')],
            {},
            {
                checkCancelled: () => {
                    calls += 1;
                    if (calls > 2) throw new JobError('Cancelled.', { code: 'cancelled' });
                },
            },
        ).catch((error) => error);

        expect(failure.code).toBe('cancelled');
    });

    it('refuses a file that is not one of the formats it accepts', async () => {
        const gif = Buffer.from('GIF89a', 'latin1');
        const failure = await makePdf([fileOf(gif, 'anim.gif', 'image/gif')]).catch((error) => error);

        expect(failure).toBeInstanceOf(JobError);
        expect(failure.code).toBe('invalid-type');
    });

    it('refuses the whole job when any one file is wrong, before building anything', async () => {
        const good = await splitRedBlueJpegPlain({ width: 40, height: 20 });
        const failure = await makePdf([
            fileOf(good, 'a.jpg', 'image/jpeg'),
            fileOf(Buffer.from('GIF89a', 'latin1'), 'b.gif', 'image/gif'),
        ]).catch((error) => error);

        expect(failure.code).toBe('invalid-type');
    });

    it('fails cleanly on a file that says it is a PNG and is not', async () => {
        // The magic bytes are right, so it gets past the format gate and the
        // decoder is the first thing to find out. Whatever it throws carries no
        // code of ours, so it is passed through untouched for the worker to
        // sanitise rather than being dressed up as a refusal we understood.
        const broken = Buffer.concat([
            Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
            Buffer.alloc(64, 0x7F),
        ]);

        await expect(makePdf([fileOf(broken, 'broken.png', 'image/png')])).rejects.toThrow();
    });

    it('refuses a single file handed over where a list belongs', async () => {
        const source = await splitRedBlueJpegPlain({ width: 40, height: 20 });
        const failure = await runOperation('pdf', fileOf(source, 'a.jpg', 'image/jpeg'), {})
            .catch((error) => error);

        expect(failure).toBeInstanceOf(JobError);
        expect(failure.code).toBe('invalid-file');
    });
});
