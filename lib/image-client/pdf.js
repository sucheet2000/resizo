/**
 * Photos into one PDF, on the device
 *
 * Every other tool here takes one image and gives one image back. This one
 * takes a list and gives back a container, and the container is the whole
 * reason it can be done in a tab at all.
 *
 * A PDF does not store pixels. It stores STREAMS, and a JPEG stream is stored
 * as the JPEG already is — the same DCTDecode bytes the camera wrote. So the
 * cheapest possible way to put a photo on a page is to not open the photo:
 * embedJpg reads the width and the height out of the SOF header and copies the
 * compressed bytes straight into the document. Measured on a 12 MP JPEG:
 *
 *   embedJpg (header read + byte copy)     0.45 MB of heap growth
 *   one decoded RGBA surface              45.78 MB
 *
 * A hundred to one. That is what makes twenty photos on a phone possible, and
 * everything below is written to protect it.
 *
 * THE TWO LANES, AND WHEN A FILE FALLS OFF THE CHEAP ONE
 *
 *   COPY      a JPEG whose pixels are already the right way up. Its bytes go in
 *             untouched apart from the metadata strip below. No codec is loaded,
 *             no surface is allocated, and the source bytes appear verbatim
 *             inside the output.
 *
 *   RE-ENCODE everything else — PNG, WebP, HEIC, and a JPEG carrying an EXIF
 *             Orientation. Decoded with the codecs this engine already ships,
 *             flattened, encoded to JPEG by MozJPEG, then embedded. This lane
 *             costs one decode surface, and STRICTLY ONE AT A TIME: the loop
 *             decodes, encodes, embeds and drops before it looks at the next
 *             file. Twenty surfaces alive at once is the failure this whole
 *             module is shaped to avoid.
 *
 * PNG AND WEBP ARE NOT FREE, WHICH IS WHY THEY ARE NOT COPIED. pdf-lib can embed
 * a PNG, but only by decoding it and re-packing the raw samples as a Flate
 * stream — the memory of a full decode, and an output usually LARGER than the
 * file that went in. A JPEG re-encode of the same pixels is smaller and costs
 * the same decode, so that is what happens.
 *
 * WHY THE ORIENTATION TAG CANNOT RIDE ALONG
 *
 * A phone stores a portrait photo as landscape pixels plus an EXIF Orientation
 * tag telling the viewer to turn it. Every image viewer honours that tag. NO PDF
 * VIEWER DOES — a PDF image stream is just samples, and the reader never looks
 * inside it for EXIF. So a byte-for-byte copy of a tagged phone photo produces a
 * page that is lying on its side, and it would be lying on its side only for
 * portrait photos, which is the most common thing anyone will ever put in this
 * tool. This is the same class of bug that shipped here before and was fixed in
 * the sharp pipeline with a .rotate() call, and again in the browser engine with
 * lib/image-client/orientation.js.
 *
 * The fix is that a tagged JPEG is not eligible for the copy lane at all. It is
 * decoded (which applies the turn — every route in decode.js returns upright
 * pixels), re-encoded and embedded, and it pays a full surface for the privilege.
 * There is no way to have both: the turn has to be in the pixels, because there
 * is nowhere else for the reader to find it.
 *
 * WHY THE COPY IS NOT QUITE A COPY
 *
 * This engine strips every byte of metadata, and that is a stated guarantee of
 * the site, not a side effect — an EXIF block from a phone carries the camera,
 * the timestamp and the GPS coordinates of the person's home. A PDF built out of
 * raw JPEG bytes would carry all of it into the file people then email to a bank
 * or a passport office. So the copy lane runs stripJpegMetadata first, which
 * walks the SEGMENT TABLE and drops the metadata segments without ever touching
 * the compressed scan. It is a byte rewrite, not a decode: the memory argument
 * above is untouched, and the entropy-coded data — which is all of the file that
 * matters — still ends up in the document verbatim.
 *
 * AND THE COPY STOPS WHERE THE PICTURE STOPS, not where the file does. A phone
 * writes more after the primary image's EOI — Apple a second JPEG with its own
 * Exif and GPS, Samsung and Google a video — and a copy that ran to the end of
 * the file put that second set of coordinates on a page that says the
 * coordinates were stripped. findJpegScanEnd is where that is decided, and a
 * file whose end cannot be found is not copied at all.
 */
import { TARGET_SEARCH_ITERATIONS } from '@/lib/limits';
import { guideRects, referenceRects } from '@/lib/format/print-sheet';
import { assessPixels, PDF_OPERATION } from '@/lib/image-client/capability';
import { decodeToImageData } from '@/lib/image-client/decode';
import { encodeImageData } from '@/lib/image-client/encode';
import { flattenImageData } from '@/lib/image-client/flatten';
import { ORIENTATION_NONE } from '@/lib/image-client/orientation';
import { bytesToKb, searchQuality } from '@/lib/image-client/target-bytes';

/* ------------------------------------------------------------- the writer */

/**
 * @cantoo/pdf-lib is around a megabyte of JavaScript. Five of the seven tools on
 * this site have no use for it, so it is loaded by `import()` on first use and
 * memoised exactly as the WASM codecs are in lib/image-client/codecs.js — and a
 * failed load is evicted so the next attempt retries rather than replaying the
 * failure forever.
 *
 * THIS IS THE ONLY MODULE THAT MAY IMPORT IT, which is the same rule
 * lib/image/pipeline.js used to carry for sharp. A second importer would be a
 * second copy of the "is this a page or an image" decision.
 */
let modulePromise = null;

/**
 * The whole module, for the one caller that needs more than the document class:
 * lib/image-client/pdf-merge.js, which has to recognise EncryptedPDFError to
 * tell a password-protected file apart from a damaged one.
 *
 * It goes through here rather than importing the package a second time so the
 * rule above still holds literally — there is one `import('@cantoo/pdf-lib')`
 * in this repo, one memo, and one place a failed load is evicted from.
 */
export function loadPdfLib() {
    if (!modulePromise) {
        modulePromise = import('@cantoo/pdf-lib').catch((error) => {
            modulePromise = null;
            throw error;
        });
    }
    return modulePromise;
}

export function loadPdfWriter() {
    return loadPdfLib().then((module) => module.PDFDocument);
}

/** Test seam. Drops the memoised writer; does not unload anything. */
export function resetPdfWriter() {
    modulePromise = null;
}

/* -------------------------------------------------------------- geometry */

/** PDF user space. One unit is 1/72 inch, and always has been. */
export const POINTS_PER_INCH = 72;

/**
 * How many image pixels go into an inch of page when the page is fitted to the
 * image. 96 is the CSS reference pixel, which is what a screenshot, a scan
 * saved by a phone and a web-sourced photo are all implicitly authored at, and
 * it is what img2pdf and every browser's print path assume when a file says
 * nothing about its own density. At 72 the same photo would claim to be a third
 * larger on paper for no reason anyone chose.
 *
 * It changes the STATED size of the page and nothing about the picture: the
 * stream is identical either way, and a viewer showing the PDF at "fit width"
 * cannot tell the difference.
 */
export const IMAGE_DPI = 96;

/**
 * The largest page either side may be. 14400 units — 200 inches — is the limit
 * in the PDF specification, and a page past it is a file some readers refuse to
 * open. Only reachable from an image wider than 19200 px, which the source
 * pixel ceiling does still allow.
 */
export const MAX_PAGE_POINTS = 14400;

export const PAGE_SIZE_FIT = 'fit';
export const PAGE_SIZE_A4 = 'a4';
export const PAGE_SIZE_LETTER = 'letter';

/** The choices a caller may make. `fit` is the default; see parsePageSize. */
export const PAGE_SIZES = [PAGE_SIZE_FIT, PAGE_SIZE_A4, PAGE_SIZE_LETTER];

/**
 * Portrait points for the two fixed sizes, from the same table pdf-lib's own
 * PageSizes exports: A4 is 210x297 mm and US Letter is 8.5x11 inches. Written
 * out rather than imported so the geometry below stays pure — it can be unit
 * tested without loading a megabyte of PDF writer.
 */
export const A4_POINTS = [595.28, 841.89];
export const LETTER_POINTS = [612, 792];

const FIXED_PAGE_POINTS = {
    [PAGE_SIZE_A4]: A4_POINTS,
    [PAGE_SIZE_LETTER]: LETTER_POINTS,
};

export const PORTRAIT = 'portrait';
export const LANDSCAPE = 'landscape';
export const PAGE_ORIENTATIONS = [PORTRAIT, LANDSCAPE];

/**
 * Margin bounds. Zero is the default because the default page is the image
 * itself and a border around a photo is not what anyone asked for; the ceiling
 * is an inch and a half, past which an A4 page has more margin than picture.
 */
export const DEFAULT_MARGIN_POINTS = 0;
export const MAX_MARGIN_POINTS = 108;

/**
 * Quality for the lane that has to re-encode.
 *
 * Above the site's DEFAULT_QUALITY of 80 on purpose. Everywhere else that number
 * is applied to a photograph, where 80 is invisible; here the likely input is a
 * scan of a document, and JPEG ringing around black text on white paper is
 * visible at 80 and not at 88. It is only paid by PNG, WebP and HEIC sources —
 * a JPEG that takes the copy lane is not re-encoded at any quality.
 */
export const PDF_JPEG_QUALITY = 88;

/**
 * What a transparent pixel becomes on a page.
 *
 * WHITE, and this is the one place in the engine that does not use
 * FLATTEN_BACKGROUND. Everywhere else a transparent pixel meets a JPEG the
 * answer is black, because that is what libvips does and /png-to-jpg says so in
 * as many words. A PDF page is white paper: filling the transparent parts of a
 * logo or a scan with black would put a black rectangle on a white sheet, which
 * is not a colour anyone chose and not a thing any page here promises.
 */
export const PAGE_BACKGROUND = { r: 255, g: 255, b: 255 };

/**
 * What the document costs on top of the images, measured against a real build:
 * 1 page 1075 bytes, 2 pages 1581, 5 pages 3095, 20 pages 10662. That is a
 * fixed catalogue plus roughly 505 bytes of page object, XObject reference and
 * xref entry each. Both are rounded UP, because the only thing they are used
 * for is reserving room inside a size target — under-reserving would overshoot
 * the number the person typed.
 */
export const PDF_BASE_OVERHEAD_BYTES = 700;
export const PDF_PAGE_OVERHEAD_BYTES = 550;

/**
 * What a missed size target says out loud.
 *
 * The same shape as impossibleTargetMessage in target-bytes.js — what was
 * asked for, what is actually achievable, what to do — and the same KB
 * formatter, rounded UP on the achievable number so the figure quoted back is
 * one the person can retry with. A separate sentence only because "for this
 * image" is not what a twenty-page document is.
 */
export function targetMissMessage(targetBytes, actualBytes) {
    return `Cannot reach ${bytesToKb(targetBytes)} KB for these images. `
        + `The smallest this PDF gets is ${bytesToKb(actualBytes, Math.ceil)} KB. Raise the target.`;
}

function clamp(value, low, high) {
    return Math.min(high, Math.max(low, value));
}

/** Pixels to points at IMAGE_DPI. */
export function pixelsToPoints(pixels) {
    return (pixels * POINTS_PER_INCH) / IMAGE_DPI;
}

/**
 * Where one image sits on one page.
 *
 * `fit` sizes the page to the image and draws it edge to edge — no letterboxing
 * and no cropping, which is what "photos into a PDF" means to almost everybody
 * who types it. A fixed size is the explicit choice: the page is A4 or Letter,
 * the image is scaled to fit inside the margins with its aspect ratio kept, and
 * it is centred in whatever room is left over.
 *
 * Scaling UP to fill a fixed page is deliberate and free. A PDF draw is a matrix
 * applied to a stream, so an image shown larger than its pixels costs nothing
 * and resamples nothing — refusing to do it would leave a stamp-sized photo in
 * the corner of an A4 sheet.
 *
 * Pure arithmetic, no writer, so every case here is unit testable.
 *
 * @param {number} imageWidth   in pixels
 * @param {number} imageHeight  in pixels
 * @param {{ pageSize?: string, orientation?: string|null, margin?: number }} [options]
 * @returns {{ pageWidth: number, pageHeight: number, x: number, y: number, width: number, height: number }}
 */
export function pageGeometry(imageWidth, imageHeight, {
    pageSize = PAGE_SIZE_FIT,
    orientation = null,
    margin = DEFAULT_MARGIN_POINTS,
} = {}) {
    const imagePoints = {
        width: Math.max(1, pixelsToPoints(imageWidth)),
        height: Math.max(1, pixelsToPoints(imageHeight)),
    };

    const gap = clamp(Number.isFinite(margin) ? margin : 0, 0, MAX_MARGIN_POINTS);

    if (pageSize !== PAGE_SIZE_A4 && pageSize !== PAGE_SIZE_LETTER) {
        // The page IS the image. A margin, if one was asked for, grows the page
        // rather than shrinking the picture — the picture is the point.
        const scale = Math.min(
            1,
            MAX_PAGE_POINTS / (imagePoints.width + (gap * 2)),
            MAX_PAGE_POINTS / (imagePoints.height + (gap * 2)),
        );

        const width = imagePoints.width * scale;
        const height = imagePoints.height * scale;
        const inset = gap * scale;

        return {
            pageWidth: width + (inset * 2),
            pageHeight: height + (inset * 2),
            x: inset,
            y: inset,
            width,
            height,
        };
    }

    const [shortSide, longSide] = FIXED_PAGE_POINTS[pageSize];
    const landscape = orientation === LANDSCAPE;

    const pageWidth = landscape ? longSide : shortSide;
    const pageHeight = landscape ? shortSide : longSide;

    const boxWidth = Math.max(1, pageWidth - (gap * 2));
    const boxHeight = Math.max(1, pageHeight - (gap * 2));

    const scale = Math.min(boxWidth / imagePoints.width, boxHeight / imagePoints.height);
    const width = imagePoints.width * scale;
    const height = imagePoints.height * scale;

    return {
        pageWidth,
        pageHeight,
        x: (pageWidth - width) / 2,
        y: (pageHeight - height) / 2,
        width,
        height,
    };
}

/* --------------------------------------------------------------- parsers */

/** Strict, and in the shape every other parser in this repo answers with. */
export function parsePageSize(raw) {
    if (raw === null || raw === undefined || String(raw).trim() === '') {
        return { ok: true, value: PAGE_SIZE_FIT };
    }

    const value = String(raw).trim().toLowerCase();
    if (PAGE_SIZES.includes(value)) return { ok: true, value };

    return { ok: false, error: `Page size must be ${PAGE_SIZES.join(', ')}.` };
}

export function parsePageOrientation(raw) {
    if (raw === null || raw === undefined || String(raw).trim() === '') {
        return { ok: true, value: PORTRAIT };
    }

    const value = String(raw).trim().toLowerCase();
    if (PAGE_ORIENTATIONS.includes(value)) return { ok: true, value };

    return { ok: false, error: `Page orientation must be ${PAGE_ORIENTATIONS.join(' or ')}.` };
}

export function parseMarginPoints(raw) {
    if (raw === null || raw === undefined || String(raw).trim() === '') {
        return { ok: true, value: DEFAULT_MARGIN_POINTS };
    }

    const value = Number(String(raw).trim());
    if (!Number.isFinite(value) || value < 0 || value > MAX_MARGIN_POINTS) {
        return { ok: false, error: `Margin must be between 0 and ${MAX_MARGIN_POINTS} points.` };
    }

    return { ok: true, value };
}

/* ------------------------------------------------------- metadata strip */

const SEGMENT_START = 0xFF;
const MARKER_SOI = 0xD8;
const MARKER_EOI = 0xD9;
const MARKER_SOS = 0xDA;

/**
 * findJpegScanEnd's answer when a file has no end to its picture.
 *
 * The function returns an INDEX — one past the EOI — so the sentinel is -1, the
 * same one indexOf has always used. It is NAMED, and every caller compares
 * against the name, so nobody has to know or care which value it is: a bare -1
 * is the thing that gets compared with `<` on a value that was never an offset,
 * and a bare null is the thing that gets treated as a zero length.
 */
export const NO_SCAN_END = -1;

/**
 * Segments dropped on the way into a PDF.
 *
 *   APP1  Exif (camera, timestamp, GPS) and XMP
 *   APP2  ICC profiles — dropped for the same reason the rest of the engine
 *         drops them, so a PDF page and a /convert output agree about colour
 *   APP13 Photoshop / IPTC
 *   APP15 vendor junk
 *   COM   free-text comments
 *
 * APP0 and APP14 are deliberately KEPT. Neither carries anything about a person:
 * APP0 is the JFIF header with the density units, and APP14 is the Adobe marker
 * whose transform flag is how a decoder knows whether a three or four component
 * scan is YCbCr, RGB, YCCK or CMYK. Dropping APP14 would not be a privacy
 * measure, it would be a colour bug.
 */
function isDroppableSegment(marker) {
    if (marker === 0xFE) return true;                       // COM
    if (marker === 0xE0 || marker === 0xEE) return false;    // APP0 JFIF, APP14 Adobe
    return marker >= 0xE1 && marker <= 0xEF;                // APP1..APP15
}

/**
 * Where the primary image ends: one past its EOI, or NO_SCAN_END if it has none.
 *
 * THE FILE DOES NOT END WHERE THE PICTURE DOES. A phone writes more after the
 * primary image's EOI and every JPEG decoder ignores it, so nothing ever
 * noticed:
 *
 *   Apple    MPF secondary images for an HDR gain map, each a whole JPEG with
 *            its OWN APP1 Exif and GPS block
 *   Samsung  Motion Photo — an MP4 of the seconds around the shot
 *   Google   the same, and editors leave thumbnails there
 *
 * Copying "SOS to the end of the file" therefore copies a second photograph,
 * with a second set of coordinates, into a document whose own page says the
 * coordinates were stripped. Stopping at the EOI loses nothing about the
 * picture — a decoder would not have read those bytes either.
 *
 * FINDING THE EOI MEANS WALKING COMPRESSED DATA, and 0xFF 0xD9 occurs inside it
 * by chance, so an indexOf truncates real photos mid-picture. The rules the walk
 * below is built on, and there are only three:
 *
 *   FF 00      a stuffed byte — the encoder's way of writing a literal 0xFF
 *   FF D0..D7  a restart marker, which is part of the stream
 *   FF xx      anything else is a real marker
 *
 * A real marker is not the end either. A progressive JPEG is SEVERAL scans with
 * their own Huffman tables between them, so a marker that carries a length word
 * is stepped over and the walk continues; only EOI stops it. Fill bytes (a run
 * of 0xFF before a marker) are legal and skipped.
 *
 * AN EOI THAT NO SCAN LED TO IS NOT AN END. A header with nothing under it —
 * or a header whose scan was cut off before it started — is not a picture, and
 * answering with a length would hand the copy lane a file that has no image in
 * it. Only an EOI reached after a start of scan counts.
 *
 * Exported because it is the one piece of this that is worth asserting on
 * directly: every other symptom of getting it wrong — a leaked coordinate, a
 * truncated picture — is measured through a whole document.
 *
 * @param {Uint8Array} bytes
 * @param {number} [from]  where to start walking; 2 is the first marker after SOI
 * @returns {number} one past the EOI, or NO_SCAN_END when there is no bounded end
 */
export function findJpegScanEnd(bytes, from = 2) {
    let at = from;
    let started = false;

    while (at + 1 < bytes.length) {
        if (bytes[at] !== SEGMENT_START) {
            at += 1;
            continue;
        }

        let markerAt = at + 1;
        while (markerAt < bytes.length && bytes[markerAt] === SEGMENT_START) markerAt += 1;
        if (markerAt >= bytes.length) return NO_SCAN_END;

        const marker = bytes[markerAt];

        if (marker === MARKER_EOI) return started ? markerAt + 1 : NO_SCAN_END;

        // Stuffing, restart markers and TEM carry no length and no meaning here.
        if (marker === 0x00 || (marker >= 0xD0 && marker <= 0xD7) || marker === 0x01) {
            at = markerAt + 1;
            continue;
        }

        // A second SOI before the first EOI is not a JPEG this may reason about.
        if (marker === MARKER_SOI) return NO_SCAN_END;

        if (marker === MARKER_SOS) started = true;

        // Everything else is a segment with a length word — another scan's
        // header, a Huffman table, a DNL. Step over it and keep walking.
        const lengthAt = markerAt + 1;
        if (lengthAt + 2 > bytes.length) return NO_SCAN_END;

        const length = (bytes[lengthAt] << 8) | bytes[lengthAt + 1];
        if (length < 2 || lengthAt + length > bytes.length) return NO_SCAN_END;

        at = lengthAt + length;
    }

    return NO_SCAN_END;
}

/**
 * The same JPEG with its metadata segments removed and its trailer cut off.
 *
 * Walks the segment table to SOS, then walks the compressed data to the primary
 * image's EOI — see findJpegScanEnd for why the second walk cannot be an
 * indexOf. Nothing is decoded, nothing is re-encoded, and every byte of the
 * picture itself is bit-identical.
 *
 * Returns the SAME array when there was nothing to drop and the file ends where
 * the picture does, so a JPEG that carries no metadata — which is every file
 * this engine has already written — costs nothing at all here.
 *
 * NULL MEANS "DO NOT COPY THIS FILE". A scan whose end cannot be found cannot be
 * bounded, and copying to the end of the file is exactly the bug this function
 * exists to stop. The caller drops it onto the decode/re-encode lane instead,
 * which rebuilds the bytes and is safe by construction.
 *
 * A file that does not parse as far as a scan is handed back untouched. The
 * alternative is refusing a JPEG that a decoder might still have been able to
 * read, and the embedder is about to parse the same header anyway and will say
 * so properly.
 *
 * @param {Uint8Array} bytes
 * @returns {Uint8Array|null}
 */
export function stripJpegMetadata(bytes) {
    if (!(bytes instanceof Uint8Array) || bytes.length < 4) return bytes;
    if (bytes[0] !== SEGMENT_START || bytes[1] !== MARKER_SOI) return bytes;

    const keep = [{ start: 0, end: 2 }];
    let dropped = 0;
    let at = 2;
    let reachedScan = false;

    while (at + 4 <= bytes.length) {
        if (bytes[at] !== SEGMENT_START) return bytes;

        let markerAt = at + 1;
        while (bytes[markerAt] === SEGMENT_START && markerAt + 1 < bytes.length) markerAt += 1;

        const marker = bytes[markerAt];

        // Standalone markers carry no length word, so there is no segment to
        // measure: the compressed data starts here and the second walk takes over.
        if (marker === MARKER_SOS || marker === MARKER_EOI || marker === MARKER_SOI
            || (marker >= 0xD0 && marker <= 0xD7) || marker === 0x01) {
            reachedScan = true;
            break;
        }

        const lengthAt = markerAt + 1;
        if (lengthAt + 2 > bytes.length) return bytes;

        const length = (bytes[lengthAt] << 8) | bytes[lengthAt + 1];
        if (length < 2) return bytes;

        const next = lengthAt + length;
        if (next > bytes.length) return bytes;

        if (isDroppableSegment(marker)) {
            dropped += next - at;
        } else {
            keep.push({ start: at, end: next });
        }

        at = next;
    }

    // Never reached the compressed data, so there is no picture to bound and
    // nothing was going to be dropped from it either.
    if (!reachedScan) return bytes;

    const scanEnd = findJpegScanEnd(bytes, at);
    if (scanEnd === NO_SCAN_END) return null;

    const trailing = bytes.length - scanEnd;

    // Nothing to drop and nothing stapled on the end: the file is already
    // exactly the picture, and this is the common case for anything this engine
    // wrote itself.
    if (dropped === 0 && trailing === 0) return bytes;

    // A trailer and no metadata: one allocation the size of the PICTURE, which
    // is the same second copy the metadata path below makes and the same one
    // PDF_EMBED_FILE_COPIES already charges for. A view would have been free
    // here and wrong later — it pins the whole source buffer, video and all, for
    // as long as the document holds the stream, which on a pile of Motion Photos
    // is the difference between one trailer alive and twenty.
    if (dropped === 0) return bytes.slice(0, scanEnd);

    // The tail — the start of scan and every compressed byte up to the primary
    // image's EOI. This is where the picture actually lives and it is never
    // touched; what comes after the EOI is another file's problem.
    keep.push({ start: at, end: scanEnd });

    const stripped = new Uint8Array(bytes.length - dropped - trailing);
    let offset = 0;
    for (const range of keep) {
        stripped.set(bytes.subarray(range.start, range.end), offset);
        offset += range.end - range.start;
    }

    return stripped;
}

/* ------------------------------------------------------------ page bytes */

function isBlobLike(value) {
    return typeof Blob !== 'undefined' && value instanceof Blob;
}

/**
 * Every byte of whatever the caller had: a File from the picker, a Blob, or a
 * buffer transferred into the worker.
 *
 * Exported for lib/image-client/pdf-merge.js, which reads its sources exactly
 * the same way and must refuse a non-file with the same sentence rather than a
 * second one worded differently.
 */
export async function readAllBytes(source) {
    if (isBlobLike(source)) return new Uint8Array(await source.arrayBuffer());
    if (source instanceof Uint8Array) return source;
    if (ArrayBuffer.isView(source)) return new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
    if (source instanceof ArrayBuffer) return new Uint8Array(source);
    throw new Error('No valid file was provided.');
}

/**
 * A refusal this module cannot phrase as a JobError.
 *
 * JobError lives in lib/image-client/operations.js, which imports this file —
 * importing it back would close a cycle. So the code and the suggestion are
 * carried on a plain Error and runJpgToPdf rebuilds them into the JobError the
 * worker knows how to put on the wire. Nothing is lost and nothing is circular.
 */
function refusal(assessment) {
    return Object.assign(new Error(assessment.reason), {
        code: assessment.code,
        suggestion: assessment.suggestion ?? null,
    });
}

/** True when this file can go on a page without being opened. */
export function canEmbedWithoutDecoding({ format, orientation = ORIENTATION_NONE } = {}) {
    return format === 'jpeg' && (orientation ?? ORIENTATION_NONE) === ORIENTATION_NONE;
}

/**
 * The bytes for the cheap lane, or null when this file cannot take it.
 *
 * A function of its own so that a file which falls through — a JPEG too big for
 * its share of a size target — drops the bytes it just read the moment this
 * returns. Left inline, the read copy and the stripped copy would both still be
 * reachable through the whole decode below, which is up to 40 MB the memory gate
 * was never told about.
 *
 * TWO WAYS TO FALL OFF THE LANE, and they mean the same thing to the caller.
 * Over its share of a size target is the ordinary one. The other is a JPEG with
 * no whole picture in it, which is the check below.
 *
 * NOTHING ELSE DOWNSTREAM WILL EVER NOTICE A MISSING PICTURE. embedJpg reads a
 * width and a height out of the SOF and copies the bytes in; that is the whole
 * reason this lane is cheap, and it means the writer is not a validator. A photo
 * whose download stopped still has an SOI and an SOF, so it was accepted, a page
 * was written, and what a reader drew was whatever it could make of a scan that
 * ends in the middle — a band over grey in one reader, a blank sheet in another.
 * Handed the identical bytes, every other tool on this site opens them and says
 * something true about them. This is where the two are made to agree.
 *
 * The ONE walk answers it — see findJpegScanEnd, and there must not be a second.
 * It is asked here rather than left to stripJpegMetadata because that function
 * has bail-outs that hand a file back untouched: a JPEG cut off before its scan
 * ever starts never reaches the part of it that bounds a picture, and came out
 * of it looking exactly like a file with no metadata to drop.
 *
 * A file that fails is NOT refused here. It falls through to the decode lane,
 * where the same codec /convert uses gets the same say over it that it gets
 * everywhere else on the site: the partial picture where one can be recovered,
 * and the decoder's own refusal where it cannot.
 */
async function copyLaneBytes(image, budgetBytes) {
    const raw = await readAllBytes(image.source);

    if (findJpegScanEnd(raw) === NO_SCAN_END) return null;

    const stripped = stripJpegMetadata(raw);

    if (!stripped) return null;

    return (budgetBytes === null || stripped.byteLength <= budgetBytes) ? stripped : null;
}

/**
 * The JPEG bytes for one page, by whichever lane the file qualifies for.
 *
 * `budgetBytes` is a share of a whole-document size target. It only ever makes
 * a file take a more expensive route, never a cheaper one: a copy that is
 * already inside its share is kept as it is, and one that is not falls through
 * to the same bounded quality search /compress uses.
 *
 * Nothing decoded here outlives the call. That is the "one image alive at a
 * time" rule, and it is why this is a function rather than a stage that
 * accumulates.
 */
async function pageJpegBytes(image, {
    quality,
    budgetBytes = null,
    deadline,
    now,
    guard = null,
    device = undefined,
}) {
    guard?.();

    if (canEmbedWithoutDecoding(image)) {
        const copied = await copyLaneBytes(image, budgetBytes);

        if (copied) {
            return { bytes: copied, reencoded: false, iterations: 0, quality: null, fitsBudget: true };
        }
        // Over its share of the target, so the free lane cannot be used and the
        // file is decoded like any other. Falls through.
    }

    const decoded = await decodeToImageData(image.source, { mimeOrSniff: image.format });
    guard?.();

    // The gate could not cost this page before it was decoded — nothing knew how
    // big it was. Now something does, so it is costed before the encoder is
    // handed a surface, exactly as decodePixels re-costs a single-image job.
    const recheck = assessPixels({
        sourceWidth: decoded.width,
        sourceHeight: decoded.height,
        fileBytes: Number(image.fileBytes) || 0,
        operation: PDF_OPERATION,
        // Already upright: every route out of decodeToImageData applies the tag.
        orientation: ORIENTATION_NONE,
        ...(device ? { device } : {}),
    });

    if (!recheck.ok) throw refusal(recheck);

    // A JPEG page has no alpha channel to carry, so the compositing decision is
    // made here rather than left to MozJPEG, which would ignore the alpha byte
    // and leave whatever happened to be under it.
    const pixels = flattenImageData(decoded.data, PAGE_BACKGROUND);

    if (budgetBytes === null) {
        const encoded = await encodeImageData(pixels, { format: 'jpeg', quality });
        return {
            bytes: new Uint8Array(await encoded.blob.arrayBuffer()),
            reencoded: true,
            iterations: 1,
            quality: encoded.quality,
            fitsBudget: true,
        };
    }

    // The bounded search from lib/image-client/target-bytes.js, driven directly
    // rather than through compressToTargetBytes: that wrapper returns null when
    // nothing fits, and a page still has to exist. Here the smallest attempt is
    // kept and reported as a miss, which is the honest answer — the alternative
    // is a document with a hole in it.
    const search = await searchQuality({
        targetBytes: budgetBytes,
        maxIterations: TARGET_SEARCH_ITERATIONS,
        deadline,
        now,
        probe: async (probeQuality) => {
            guard?.();
            const encoded = await encodeImageData(pixels, { format: 'jpeg', quality: probeQuality });
            return {
                bytes: encoded.bytes,
                payload: { bytes: new Uint8Array(await encoded.blob.arrayBuffer()), quality: probeQuality },
            };
        },
    });

    const chosen = search.fit ?? search.floor;

    if (!chosen) {
        // The deadline expired before a single probe finished. One plain encode
        // rather than a failed job: the person gets their PDF and is told the
        // size was missed.
        const encoded = await encodeImageData(pixels, { format: 'jpeg', quality });
        return {
            bytes: new Uint8Array(await encoded.blob.arrayBuffer()),
            reencoded: true,
            iterations: search.iterations,
            quality: encoded.quality,
            fitsBudget: false,
        };
    }

    return {
        bytes: chosen.bytes,
        reencoded: true,
        iterations: search.iterations,
        quality: chosen.quality,
        fitsBudget: Boolean(search.fit),
    };
}

/* ----------------------------------------------------------------- build */

function totalOf(images) {
    return images.reduce((sum, image) => sum + (Number(image.fileBytes) || 0), 0);
}

/**
 * How much of a size target each image may spend.
 *
 * Proportional to what the file already weighs, after the document's own
 * overhead has been reserved. Proportional rather than equal because a
 * twenty-page document is rarely twenty identical photos, and giving a 4 MB
 * photo and a 200 KB screenshot the same allowance would flatten the photo to
 * meet a target the screenshot was never going to spend.
 *
 * This is the opening plan and not the last word: whatever a page does not
 * spend is carried to the next one by the loop in buildPdf, so an image that
 * comes in under its share buys quality for the images after it rather than
 * having its allowance thrown away.
 *
 * Exported because it is the one piece of the target path worth asserting on
 * directly: everything else about it is measured from the finished file.
 */
export function shareBudgets(images, targetBytes) {
    const overhead = PDF_BASE_OVERHEAD_BYTES + (images.length * PDF_PAGE_OVERHEAD_BYTES);
    const spendable = Math.max(0, targetBytes - overhead);
    const total = totalOf(images);

    if (total <= 0) {
        const even = Math.floor(spendable / Math.max(1, images.length));
        return images.map(() => even);
    }

    return images.map((image) => Math.floor((spendable * (Number(image.fileBytes) || 0)) / total));
}

/**
 * Builds the document.
 *
 * The order of `images` is the order of the pages, exactly, with no sorting and
 * no grouping. A person who dragged page 3 above page 2 has already told us what
 * they want and there is nothing to be clever about.
 *
 * @param {object} input
 * @param {Array<{ source: Blob|Uint8Array|ArrayBuffer, name?: string, format: string,
 *                 orientation?: number, fileBytes?: number }>} input.images
 * @param {string} [input.pageSize]      'fit' | 'a4' | 'letter'
 * @param {string} [input.orientation]   'portrait' | 'landscape'; fixed sizes only
 * @param {number} [input.margin]        points
 * @param {number} [input.quality]       for the re-encode lane
 * @param {number|null} [input.targetBytes]  a maximum size for the whole PDF
 * @param {number} [input.deadline]      wall clock stop for the size search
 * @param {function} [input.now]
 * @param {function} [input.guard]       throws to abort a cancelled job
 * @param {(index: number, total: number) => void} [input.onPage]
 * @param {object} [input.device]        injected for tests
 * @returns {Promise<{ blob: Blob, bytes: number, pageCount: number, reencodedCount: number,
 *                     iterations: number, targetBytes: number|null, targetMet: boolean|null,
 *                     sharesMet: boolean|null, quality: number|null, pageSize: string }>}
 */
export async function buildPdf({
    images,
    pageSize = PAGE_SIZE_FIT,
    orientation = PORTRAIT,
    margin = DEFAULT_MARGIN_POINTS,
    quality = PDF_JPEG_QUALITY,
    targetBytes = null,
    deadline = Number.POSITIVE_INFINITY,
    now = Date.now,
    guard = null,
    onPage = null,
    device = undefined,
} = {}) {
    const list = Array.isArray(images) ? images : [];
    if (list.length === 0) throw new Error('No images were provided.');

    const PDFDocument = await loadPdfWriter();
    const pdf = await PDFDocument.create();

    const budgets = targetBytes === null ? null : shareBudgets(list, targetBytes);

    let reencodedCount = 0;
    let iterations = 0;
    let sharesMet = true;

    // What the pages before this one did not spend. A photo of a flat wall that
    // lands far under its share hands the difference to the next page instead of
    // wasting it, which is the difference between a document that meets its
    // target and one that meets it while looking worse than it had to.
    let carry = 0;

    for (let index = 0; index < list.length; index += 1) {
        guard?.();

        const share = budgets ? budgets[index] + carry : null;

        const page = await pageJpegBytes(list[index], {
            quality,
            budgetBytes: share,
            deadline,
            now,
            guard,
            device,
        });

        if (share !== null) carry = Math.max(0, share - page.bytes.byteLength);
        if (page.reencoded) reencodedCount += 1;
        iterations += page.iterations;
        if (!page.fitsBudget) sharesMet = false;

        // Embedded inside the loop, on purpose. The decoded surface for this
        // page is unreachable from here on and the next iteration cannot start
        // until its bytes are in the document, which is what keeps exactly one
        // image alive at a time.
        const embedded = await pdf.embedJpg(page.bytes);
        const geometry = pageGeometry(embedded.width, embedded.height, { pageSize, orientation, margin });

        const sheet = pdf.addPage([geometry.pageWidth, geometry.pageHeight]);
        sheet.drawImage(embedded, {
            x: geometry.x,
            y: geometry.y,
            width: geometry.width,
            height: geometry.height,
        });

        onPage?.(index + 1, list.length);
    }

    guard?.();

    const saved = await pdf.save();
    const blob = new Blob([saved], { type: 'application/pdf' });

    return {
        blob,
        bytes: blob.size,
        pageCount: list.length,
        reencodedCount,
        iterations,
        targetBytes,
        // Measured on the finished file, never inferred from the per-page
        // searches: the pages are only a plan, and the document is the answer.
        // `sharesMet` is reported alongside but is NOT the verdict, for exactly
        // that reason: a page that overshot its own share can still leave the
        // document inside the target, and answering from the plan would be a
        // lie in the pessimistic direction.
        targetMet: targetBytes === null ? null : blob.size <= targetBytes,
        sharesMet: targetBytes === null ? null : sharesMet,
        // Null whenever a size target drove the encodes: the pages then carry
        // whatever quality the search landed on, one number each, and reporting
        // the requested one would name a value nothing used.
        quality: (reencodedCount > 0 && targetBytes === null) ? quality : null,
        pageSize,
    };
}

/* ---------------------------------------------------------- print sheet */

/**
 * What a name is worth on a sheet of passport photos: nothing to the person
 * printing it and everything to whoever finds the file afterwards. Same
 * guarantee lib/image-client/pdf-merge.js makes about somebody else's Info
 * dictionary, kept here for a document this build writes from scratch.
 */
const SHEET_PRODUCER = 'Resizo';

/**
 * Cut guides are grey and the measuring line is black, the same two colours
 * lib/image-client/sheet.js paints.
 *
 * THEIR WIDTH IS THE LAYOUT'S, NOT A POINT SIZE CHOSEN HERE. This file used to
 * stroke a fixed 0.5 pt hairline down the middle of each mark, which is a
 * different set of pixels from the ones the JPEG gets — half a thickness wider
 * at each end, and offset by half a thickness sideways. The measuring line was
 * the case that mattered: 50.04 mm on the raster against about 50.4 mm here, on
 * the page that asks people to check it with a ruler. So the rectangles come
 * from lib/format/print-sheet.js and this file only converts them to points.
 */
const SHEET_GUIDE_GREY = 90 / 255;

/**
 * One print sheet as a single-page PDF.
 *
 * THE PAGE IS MEASURED IN MILLIMETRES AND THE PHOTOS IN PIXELS, which is the
 * one thing to understand here. layout.paper.widthPt came straight off the
 * paper's physical size, so a 4 x 6 in page is 288 x 432 pt whether the sheet
 * was laid out at 150 DPI or 1200. The cells inside it are converted from the
 * integer pixel layout — px / dpi x 72 — so the raster sheet and this document
 * put the photos in the same physical places, to within a rounding of a
 * pixel. Deriving the page from the pixels instead would make "4 x 6 in" mean
 * a slightly different size at every resolution, which is exactly the drift
 * that makes a print come out at 99.4 %.
 *
 * ONE EMBEDDED IMAGE, DRAWN N TIMES. Every copy on the sheet is the same
 * resampled photo, so it is embedded once and referenced by each cell: a
 * thirty-up A4 sheet is the size of one photo plus thirty page references,
 * not thirty photos.
 *
 * PDF SPACE COUNTS FROM THE BOTTOM LEFT, the layout counts from the top left.
 * That flip is the single most likely thing to be wrong here and is why the
 * tests read the finished document back rather than trusting this function.
 *
 * @param {object} input
 * @param {Uint8Array} input.photoJpegBytes  the photo, already at cell size
 * @param {object} input.layout              from layoutSheet, ok: true
 * @returns {Promise<{ blob: Blob, bytes: number, pageCount: 1 }>}
 */
export async function buildSheetPdf({ photoJpegBytes, layout } = {}) {
    if (!layout || layout.ok !== true) {
        const error = new Error('There is no sheet layout to write.');
        error.code = 'sheet-layout';
        throw error;
    }

    if (!photoJpegBytes || photoJpegBytes.byteLength === 0) {
        const error = new Error('There is no photo to put on the sheet.');
        error.code = 'sheet-photo-size';
        throw error;
    }

    const { PDFDocument, rgb } = await loadPdfLib();
    const pdf = await PDFDocument.create();

    pdf.setTitle('');
    pdf.setProducer(SHEET_PRODUCER);
    pdf.setCreator(SHEET_PRODUCER);

    const pageWidth = layout.paper.widthPt;
    const pageHeight = layout.paper.heightPt;
    const page = pdf.addPage([pageWidth, pageHeight]);

    const toPoints = (pixels) => (pixels / layout.dpi) * POINTS_PER_INCH;
    const fromTop = (pixels) => pageHeight - toPoints(pixels);

    const embedded = await pdf.embedJpg(photoJpegBytes);

    for (const cell of layout.cells) {
        page.drawImage(embedded, {
            x: toPoints(cell.x),
            y: fromTop(cell.y + cell.height),
            width: toPoints(cell.width),
            height: toPoints(cell.height),
        });
    }

    // One filled rectangle per mark, in the paper pixels the compositor fills
    // and flipped into PDF space, where y counts from the bottom of the page.
    const paint = (rect, colour) => page.drawRectangle({
        x: toPoints(rect.x),
        y: fromTop(rect.y + rect.height),
        width: toPoints(rect.width),
        height: toPoints(rect.height),
        color: colour,
    });

    const grey = rgb(SHEET_GUIDE_GREY, SHEET_GUIDE_GREY, SHEET_GUIDE_GREY);
    for (const rect of guideRects(layout)) paint(rect, grey);

    const black = rgb(0, 0, 0);
    for (const rect of referenceRects(layout)) paint(rect, black);

    const saved = await pdf.save();
    const blob = new Blob([saved], { type: 'application/pdf' });

    return { blob, bytes: blob.size, pageCount: 1 };
}

export default buildPdf;
