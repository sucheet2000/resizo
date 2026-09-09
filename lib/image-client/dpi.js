/**
 * Resolution metadata, changed without opening the picture
 *
 * A print shop asks for 300 DPI. A university portal asks for 96. Neither is
 * asking for a different photograph, and neither is asking for a different
 * number of pixels — DPI is a LABEL a file carries saying how large it claims to
 * be on paper, and every tool that offers to "change the DPI" by decoding and
 * re-encoding has just thrown away image quality to edit a number.
 *
 * So nothing here touches a pixel. This module reads the container's own
 * resolution field, writes a new one, and copies every other byte across
 * unchanged. There is no decoder, no encoder and no codec: it does not import
 * decode.js, encode.js or codecs.js, and a page can import readResolution() on
 * the main thread the moment a file is dropped without pulling a megabyte of
 * WebAssembly behind it.
 *
 * FOUR PLACES A FILE CAN KEEP ITS RESOLUTION, and BOTH formats can hold two of
 * them at once, disagreeing:
 *
 *   JFIF APP0   a 16-bit density pair and a units byte, in a fixed-layout header
 *               right behind the SOI. Units 1 is dots per inch, 2 is dots per
 *               centimetre, and 0 means the pair is only an aspect ratio and
 *               says nothing about physical size.
 *   EXIF APP1   XResolution and YResolution as TIFF rationals in IFD0, with a
 *               ResolutionUnit of 2 (inch) or 3 (cm).
 *   PNG pHYs    pixels per unit on each axis, where the unit is either the metre
 *               or "unknown" — and "unknown" is again an aspect ratio only.
 *   PNG eXIf    the same TIFF block a JPEG keeps in APP1, added to the PNG
 *               specification in 2017 and written by sharp beside every pHYs.
 *
 * WHICH MEANS EVERY FILE HAS TO BE WRITTEN TWICE. sharp writes JPEG density into
 * EXIF and emits no JFIF header at all; other encoders do the opposite; libvips
 * reads EXIF in preference to both JFIF and pHYs, and plenty of software does
 * the reverse. Writing one block and leaving the other stale produces a file
 * that reports the old number to half the world, which is the exact failure this
 * tool exists to fix — and it was measured, not guessed: a 144 DPI PNG whose
 * pHYs alone was rewritten to 300 still came back from sharp as 144.
 *
 * So a JPEG gets a JFIF header — rewritten where one exists, inserted behind the
 * SOI where one does not — and a PNG gets a pHYs chunk on the same terms. Then
 * either one's TIFF block, wherever it lives, has its resolution fields
 * rewritten too when it has them. A block that is absent is never created: the
 * native field is the one this tool guarantees.
 *
 * THE EXIF BLOCK MAY NEVER MOVE OR GROW. Every offset inside a TIFF block is
 * counted from that block's own start, including the ones nothing here
 * understands: the thumbnail, the Exif sub-IFD, the maker note. Inserting a byte
 * would leave all of them pointing at the wrong place. XResolution and
 * YResolution are RATIONALs, which are eight bytes at an offset, and
 * ResolutionUnit is a SHORT stored inline — so all three can be overwritten
 * exactly where they already sit, and that is the only edit made. A tag that is
 * absent is not added.
 *
 * WHAT IS COPIED BYTE FOR BYTE, in every case: the entire entropy-coded scan
 * from the first SOS onwards, anything a phone stapled on after the EOI, every
 * other JPEG segment, and every PNG chunk that is not pHYs or eXIf, in the order
 * it was in. tests/lib/image-client/dpi.test.js compares those ranges directly
 * against the input with its own parsers, because a build that decoded and
 * re-encoded at quality 100 would pass any comparison made on the picture.
 *
 * A BROKEN FILE PRODUCES NOTHING. A segment or chunk whose declared length runs
 * past the end, a JPEG with no scan, a PNG that does not open with IHDR — each
 * is refused with a code and a sentence before a single byte of output is
 * allocated. Reading is deliberately more forgiving than writing: readResolution
 * reports whatever blocks it can find and nulls for the rest, because it runs on
 * a dropped file to fill in a readout and refusing there would tell a person
 * nothing they can act on.
 *
 * WHY THE ERRORS ARE PLAIN. JobError lives in operations.js, which will import
 * this file — importing it back would close a cycle. So a refusal is a plain
 * Error carrying `.code` and `.suggestion`, exactly as lib/image-client/pdf.js
 * does, and the op wrapper there rebuilds it into the JobError the worker knows
 * how to put on the wire.
 */
import { DPI_INPUT_FORMATS, MAX_DPI, MIN_DPI } from '@/lib/limits';
import { contentTypeFor } from '@/lib/image/filename';
import { sniffImageType } from '@/lib/image/magic-bytes';

/* --------------------------------------------------------------- refusals */

/**
 * A refusal this module cannot phrase as a JobError — see the header. The code
 * and the suggestion ride on a plain Error and runDpi's caller puts them back.
 */
function refuse(code, message, suggestion) {
    return Object.assign(new Error(message), { code, suggestion });
}

/** What a format is called on a page. Presentation only; the list is limits.js's. */
function formatLabel(format) {
    return format === 'jpeg' ? 'JPG' : format.toUpperCase();
}

function unsupportedFormat() {
    const names = DPI_INPUT_FORMATS.map(formatLabel).join(' and ');
    return refuse(
        'unsupported-format',
        `Only ${names} files store a resolution that can be changed.`,
        `Convert this image to ${names} first, then set the DPI.`,
    );
}

function invalidFile() {
    return refuse(
        'invalid-file',
        'This file is damaged and cannot be rewritten.',
        'Open it in another app and save a fresh copy, then try again.',
    );
}

function invalidDpi() {
    return refuse(
        'invalid-dpi',
        `Resolution must be a whole number between ${MIN_DPI} and ${MAX_DPI} DPI.`,
        'Most print work asks for 300; screens use 72 or 96.',
    );
}

/* ---------------------------------------------------------------- numbers */

/** Metres per inch — the pHYs conversion, and the only magic number here. */
const METRES_PER_INCH = 0.0254;

/** Centimetres per inch, for JFIF units 2 and EXIF ResolutionUnit 3. */
export const CM_PER_INCH = 2.54;

/**
 * The only value this module will write, checked once for every entry point.
 *
 * A whole number, because every container stores one: JFIF has 16 unsigned bits
 * per axis and pHYs stores an integer count per metre, so "300.5 DPI" cannot be
 * represented and rounding it silently would answer a different question from
 * the one that was asked. Strings are accepted because the option arrives from a
 * form field.
 */
function parseDpi(raw) {
    if (raw === null || raw === undefined) throw invalidDpi();

    const text = String(raw).trim();
    if (text === '') throw invalidDpi();

    const value = Number(text);
    if (!Number.isInteger(value) || value < MIN_DPI || value > MAX_DPI) throw invalidDpi();

    return value;
}

function toBytes(input) {
    if (input instanceof Uint8Array) return input;
    if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
    if (input instanceof ArrayBuffer) return new Uint8Array(input);
    return null;
}

function viewOf(bytes) {
    return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function big16(bytes, at) {
    return (bytes[at] << 8) | bytes[at + 1];
}

function setBig16(bytes, at, value) {
    bytes[at] = (value >>> 8) & 0xFF;
    bytes[at + 1] = value & 0xFF;
}

function ascii(bytes, at, length) {
    let out = '';
    for (let index = at; index < at + length; index += 1) out += String.fromCharCode(bytes[index]);
    return out;
}

/**
 * The format, or a refusal. The allowlist is DPI_INPUT_FORMATS in limits.js and
 * the signature check is the shared strict sniffer — neither is restated here,
 * so a format added to the list is a format this module is asked about.
 */
function formatOf(bytes) {
    const format = bytes === null ? null : sniffImageType(bytes);
    if (format === null || !DPI_INPUT_FORMATS.includes(format)) throw unsupportedFormat();
    return format;
}

/* -------------------------------------------------------------- JPEG bytes */

const MARKER_PREFIX = 0xFF;
const MARKER_SOI = 0xD8;
const MARKER_EOI = 0xD9;
const MARKER_SOS = 0xDA;
const MARKER_TEM = 0x01;
const MARKER_RST0 = 0xD0;
const MARKER_RST7 = 0xD7;
const MARKER_APP0 = 0xE0;
const MARKER_APP1 = 0xE1;

/** 'JFIF\0' and 'Exif\0\0', the two segment identifiers that matter here. */
const JFIF_ID = 'JFIF\0';
const EXIF_ID = 'Exif\0\0';

/** Identifier, version, units, two densities and a thumbnail size. */
const JFIF_DATA_LENGTH = 14;

/** FF E0, a length word of 16, and those 14 bytes. */
const JFIF_SEGMENT_LENGTH = 18;

const JFIF_UNITS_INCH = 1;
const JFIF_UNITS_CM = 2;

const EXIF_UNIT_INCH = 2;
const EXIF_UNIT_CM = 3;

const TAG_X_RESOLUTION = 0x011A;
const TAG_Y_RESOLUTION = 0x011B;
const TAG_RESOLUTION_UNIT = 0x0128;

const TYPE_SHORT = 3;
const TYPE_RATIONAL = 5;

const IFD_ENTRY_LENGTH = 12;

/** walkJpeg's answer when a file has no compressed scan in it. */
const NO_SCAN = -1;

/**
 * Every marker segment in front of the scan, and where the scan begins.
 *
 * A segment is FF, a marker byte, a two-byte length that counts itself, then the
 * payload; a run of FF before the marker is legal fill. The walk stops at SOS
 * because everything from there on is compressed data, which cannot be walked
 * this way and is never edited here anyway.
 *
 * `error` is a reason rather than a throw so the one walk serves both entry
 * points: readResolution ignores it and reports whatever segments were found
 * before the file went wrong, writeResolution turns it into a refusal.
 */
function walkJpeg(bytes) {
    const segments = [];
    let at = 2;

    while (at + 4 <= bytes.length) {
        if (bytes[at] !== MARKER_PREFIX) return { segments, scanAt: NO_SCAN, error: 'marker' };

        let markerAt = at + 1;
        while (markerAt < bytes.length && bytes[markerAt] === MARKER_PREFIX) markerAt += 1;
        if (markerAt >= bytes.length) return { segments, scanAt: NO_SCAN, error: 'truncated' };

        const marker = bytes[markerAt];

        if (marker === MARKER_SOS) return { segments, scanAt: at, error: null };

        // Standalone markers carry no length word, so there is no segment to
        // measure and no scan this walk can reach.
        if (marker === MARKER_EOI || marker === MARKER_SOI || marker === MARKER_TEM
            || (marker >= MARKER_RST0 && marker <= MARKER_RST7)) {
            return { segments, scanAt: NO_SCAN, error: 'no-scan' };
        }

        const lengthAt = markerAt + 1;
        if (lengthAt + 2 > bytes.length) return { segments, scanAt: NO_SCAN, error: 'truncated' };

        const length = big16(bytes, lengthAt);
        const end = lengthAt + length;
        if (length < 2 || end > bytes.length) return { segments, scanAt: NO_SCAN, error: 'truncated' };

        segments.push({ marker, at, end, dataAt: lengthAt + 2 });
        at = end;
    }

    return { segments, scanAt: NO_SCAN, error: 'no-scan' };
}

/**
 * The JFIF header's density fields, or null.
 *
 * A short APP0 that cannot hold them counts as null: it is not a header this
 * module can edit in place, and writeResolution puts a valid one in front of it
 * rather than growing it — a decoder reads the first APP0, so the valid one is
 * the one that answers.
 */
function jfifBlock(bytes, segments) {
    const segment = segments.find((candidate) => candidate.marker === MARKER_APP0
        && ascii(bytes, candidate.dataAt, JFIF_ID.length) === JFIF_ID);

    if (!segment || segment.dataAt + JFIF_DATA_LENGTH > segment.end) return null;

    return {
        segment,
        units: bytes[segment.dataAt + 7],
        xDensity: big16(bytes, segment.dataAt + 8),
        yDensity: big16(bytes, segment.dataAt + 10),
    };
}

/**
 * The three resolution fields of a TIFF block's IFD0, with the file offsets they
 * occupy.
 *
 * TWO CONTAINERS SHARE THIS. A JPEG keeps its TIFF block in an APP1 segment
 * behind an 'Exif\0\0' identifier; a PNG keeps the identical structure in an
 * eXIf chunk, and the chunk data begins at the TIFF header with no identifier in
 * front of it. Everything after that byte is the same format, so it is the same
 * reader — and, more to the point, the same writer.
 *
 * Only IFD0, and only an entry whose type and count are the ones the standard
 * gives it — a RATIONAL of one for the two resolutions, a SHORT of one for the
 * unit. Anything else is a field this module does not recognise and will not
 * overwrite. Every offset is bounds-checked against the end of the block, so a
 * damaged pointer yields a missing field rather than a write into the picture.
 *
 * Returns null when the block cannot be parsed at all, which is deliberate: a
 * file whose EXIF is unreadable still gets a correct native header, and its EXIF
 * is left exactly as it was rather than half-repaired.
 */
function tiffResolution(bytes, tiffAt, limit) {
    if (tiffAt + 8 > limit) return null;

    const order = big16(bytes, tiffAt);
    const little = order === 0x4949;
    if (!little && order !== 0x4D4D) return null;

    const view = viewOf(bytes);
    if (view.getUint16(tiffAt + 2, little) !== 42) return null;

    const ifd0 = tiffAt + view.getUint32(tiffAt + 4, little);
    if (ifd0 + 2 > limit) return null;

    const count = view.getUint16(ifd0, little);
    const found = { little, x: null, y: null, unit: null };

    for (let index = 0; index < count; index += 1) {
        const entry = ifd0 + 2 + (index * IFD_ENTRY_LENGTH);
        if (entry + IFD_ENTRY_LENGTH > limit) break;

        const tag = view.getUint16(entry, little);
        const type = view.getUint16(entry + 2, little);
        const items = view.getUint32(entry + 4, little);

        if ((tag === TAG_X_RESOLUTION || tag === TAG_Y_RESOLUTION)
            && type === TYPE_RATIONAL && items === 1) {
            const valueAt = tiffAt + view.getUint32(entry + 8, little);
            if (valueAt + 8 > limit) continue;

            const rational = {
                at: valueAt,
                numerator: view.getUint32(valueAt, little),
                denominator: view.getUint32(valueAt + 4, little),
            };
            if (tag === TAG_X_RESOLUTION) found.x = rational;
            else found.y = rational;
        }

        if (tag === TAG_RESOLUTION_UNIT && type === TYPE_SHORT && items === 1) {
            found.unit = { at: entry + 8, value: view.getUint16(entry + 8, little) };
        }
    }

    return (found.x || found.y || found.unit) ? found : null;
}

/**
 * Overwrites the resolution fields where they already sit.
 *
 * `shift` is how far the block has moved in the output — non-zero only when a
 * JFIF header was inserted in front of it. The block itself never changes
 * length, and no field is created: a tag that was absent stays absent.
 */
function patchTiffResolution(out, fields, dpi, shift = 0) {
    const view = viewOf(out);
    const { little } = fields;

    for (const rational of [fields.x, fields.y]) {
        if (!rational) continue;
        view.setUint32(rational.at + shift, dpi, little);
        view.setUint32(rational.at + shift + 4, 1, little);
    }

    if (fields.unit) view.setUint16(fields.unit.at + shift, EXIF_UNIT_INCH, little);
}

/** The TIFF block a JPEG carries in its APP1 segment. */
function exifBlock(bytes, segments) {
    const segment = segments.find((candidate) => candidate.marker === MARKER_APP1
        && ascii(bytes, candidate.dataAt, EXIF_ID.length) === EXIF_ID);

    if (!segment) return null;

    const fields = tiffResolution(bytes, segment.dataAt + EXIF_ID.length, segment.end);
    return fields ? { segment, ...fields } : null;
}

/** A valid, thumbnail-free JFIF APP0 announcing one density in dots per inch. */
function jfifSegmentBytes(dpi) {
    const segment = new Uint8Array(JFIF_SEGMENT_LENGTH);

    segment[0] = MARKER_PREFIX;
    segment[1] = MARKER_APP0;
    setBig16(segment, 2, JFIF_SEGMENT_LENGTH - 2);
    for (let index = 0; index < JFIF_ID.length; index += 1) {
        segment[4 + index] = JFIF_ID.charCodeAt(index);
    }
    segment[9] = 1;
    segment[10] = 2;
    segment[11] = JFIF_UNITS_INCH;
    setBig16(segment, 12, dpi);
    setBig16(segment, 14, dpi);

    return segment;
}

/* --------------------------------------------------------------- PNG bytes */

const PNG_SIGNATURE = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];

/** A length word, a four-character type and a CRC. */
const CHUNK_OVERHEAD = 12;

const TYPE_IHDR = 'IHDR';
const TYPE_IEND = 'IEND';
const TYPE_PHYS = 'pHYs';
const TYPE_EXIF = 'eXIf';

const PHYS_DATA_LENGTH = 9;

// Unit 1 is the metre. Unit 0 is "unknown", which makes the pair an aspect
// ratio and not a resolution, so it is read as no DPI and never written.
const PHYS_UNIT_METRE = 1;

/**
 * The standard PNG CRC-32 table, built once on first use.
 *
 * Written out rather than depended on: it is fourteen lines, and this module is
 * imported on the main thread to fill in a readout, where a package for one
 * polynomial would be a poor trade. Lazy because a page that only ever reads a
 * resolution never needs it.
 */
let crcTable = null;

function crc32(bytes) {
    if (crcTable === null) {
        crcTable = new Uint32Array(256);
        for (let index = 0; index < 256; index += 1) {
            let value = index;
            for (let bit = 0; bit < 8; bit += 1) {
                value = (value & 1) ? (0xEDB88320 ^ (value >>> 1)) : (value >>> 1);
            }
            crcTable[index] = value >>> 0;
        }
    }

    let crc = 0xFFFFFFFF;
    for (let index = 0; index < bytes.length; index += 1) {
        crc = crcTable[(crc ^ bytes[index]) & 0xFF] ^ (crc >>> 8);
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
}

function hasPngSignature(bytes) {
    if (bytes.length < PNG_SIGNATURE.length) return false;
    return PNG_SIGNATURE.every((byte, index) => bytes[index] === byte);
}

/**
 * Every chunk, in order, or a reason the file cannot be rewritten.
 *
 * Same contract as walkJpeg: the error is returned rather than thrown so the
 * tolerant reader and the strict writer share one walk. A file must open with
 * IHDR and close with IEND to be written; anything after IEND is a trailer and
 * is carried across untouched.
 */
function walkPng(bytes) {
    const chunks = [];

    if (!hasPngSignature(bytes)) return { chunks, tailAt: 0, error: 'signature' };

    const view = viewOf(bytes);
    let at = PNG_SIGNATURE.length;
    let sawEnd = false;

    while (at + CHUNK_OVERHEAD <= bytes.length) {
        const length = view.getUint32(at);
        const end = at + CHUNK_OVERHEAD + length;
        if (end > bytes.length) return { chunks, tailAt: at, error: 'truncated' };

        const type = ascii(bytes, at + 4, 4);
        chunks.push({ type, at, end, dataAt: at + 8, length });
        at = end;

        if (type === TYPE_IEND) {
            sawEnd = true;
            break;
        }
    }

    if (chunks.length === 0 || chunks[0].type !== TYPE_IHDR) {
        return { chunks, tailAt: at, error: 'ihdr' };
    }
    if (!sawEnd) return { chunks, tailAt: at, error: 'truncated' };

    return { chunks, tailAt: at, error: null };
}

/** One pHYs chunk stating a density in pixels per metre, CRC and all. */
function physChunkBytes(dpi) {
    const perMetre = Math.round(dpi / METRES_PER_INCH);

    const chunk = new Uint8Array(CHUNK_OVERHEAD + PHYS_DATA_LENGTH);
    const view = viewOf(chunk);

    view.setUint32(0, PHYS_DATA_LENGTH);
    for (let index = 0; index < 4; index += 1) chunk[4 + index] = TYPE_PHYS.charCodeAt(index);
    view.setUint32(8, perMetre);
    view.setUint32(12, perMetre);
    chunk[16] = PHYS_UNIT_METRE;
    view.setUint32(17, crc32(chunk.subarray(4, 17)));

    return chunk;
}

function physBlock(bytes, chunks) {
    const chunk = chunks.find((candidate) => candidate.type === TYPE_PHYS);
    if (!chunk || chunk.length < PHYS_DATA_LENGTH) return null;

    const view = viewOf(bytes);
    return {
        chunk,
        xPixelsPerUnit: view.getUint32(chunk.dataAt),
        yPixelsPerUnit: view.getUint32(chunk.dataAt + 4),
        unit: bytes[chunk.dataAt + 8],
    };
}

/**
 * A PNG'S OTHER RESOLUTION, and the reason this module writes two blocks for a
 * PNG as well as for a JPEG.
 *
 * The eXIf chunk was added to the PNG specification in 2017 and carries a whole
 * TIFF block, XResolution and ResolutionUnit included. sharp writes one beside
 * every pHYs, and libvips then reads the eXIf value in PREFERENCE to pHYs — so a
 * build that rewrote only pHYs produced a file that still reported its old
 * resolution to libvips, to ImageMagick and to everything else that looks at
 * Exif first. Measured: a 144 DPI PNG rewritten to 300 came back from
 * sharp as 144. tests/lib/image-client/dpi.test.js pins that case.
 *
 * The chunk data begins at the TIFF header. Some writers wrongly put an
 * 'Exif\0\0' identifier in front of it, so that prefix is skipped when present.
 */
function pngExifBlock(bytes, chunks) {
    const chunk = chunks.find((candidate) => candidate.type === TYPE_EXIF);
    if (!chunk) return null;

    const prefixed = ascii(bytes, chunk.dataAt, EXIF_ID.length) === EXIF_ID;
    const tiffAt = chunk.dataAt + (prefixed ? EXIF_ID.length : 0);

    const fields = tiffResolution(bytes, tiffAt, chunk.dataAt + chunk.length);
    return fields ? { chunk, ...fields } : null;
}

/* ------------------------------------------------------------- what it says */

/**
 * Dots per inch, rounded to a whole number.
 *
 * Rounded because that is what the number MEANS to whoever reads it: a pHYs
 * chunk holding 5669 pixels per metre is a file saying 144 DPI, and reporting
 * 143.99 would be arithmetic pretending to be precision. The exact stored values
 * stay available in the jfif/exif/phys blocks readResolution returns alongside.
 */
function scaled(x, y, factor) {
    if (!x || !y) return null;
    return { x: Math.round(x * factor), y: Math.round(y * factor) };
}

function jfifDpi(jfif) {
    if (!jfif) return null;
    if (jfif.units === JFIF_UNITS_INCH) return scaled(jfif.xDensity, jfif.yDensity, 1);
    if (jfif.units === JFIF_UNITS_CM) return scaled(jfif.xDensity, jfif.yDensity, CM_PER_INCH);
    // Units 0 is an aspect ratio and says nothing about physical size.
    return null;
}

function rationalValue(rational) {
    if (!rational || !rational.denominator) return null;
    return rational.numerator / rational.denominator;
}

function exifDpi(exif) {
    if (!exif) return null;

    const x = rationalValue(exif.x);
    const y = rationalValue(exif.y);
    // The TIFF default is inches, so a block with the two rationals and no
    // ResolutionUnit still states a real resolution.
    const unit = exif.unit === null ? EXIF_UNIT_INCH : exif.unit.value;

    if (unit === EXIF_UNIT_INCH) return scaled(x, y, 1);
    if (unit === EXIF_UNIT_CM) return scaled(x, y, CM_PER_INCH);
    return null;
}

function physDpi(phys) {
    if (!phys || phys.unit !== PHYS_UNIT_METRE) return null;
    return scaled(phys.xPixelsPerUnit, phys.yPixelsPerUnit, METRES_PER_INCH);
}

/** The EXIF half of a reading, in the same shape whichever container held it. */
function reportedExif(exif) {
    if (!exif) return null;
    return {
        xResolution: rationalValue(exif.x),
        yResolution: rationalValue(exif.y),
        unit: exif.unit === null ? null : exif.unit.value,
    };
}

/**
 * What a viewer would say this file's resolution is, and where it read it from.
 *
 * Cheap enough to run on the main thread the instant a file is dropped: it walks
 * a header, never the picture. Deliberately forgiving — a file it cannot parse
 * comes back with nulls rather than a refusal, because the readout's job is to
 * say what is known, and writeResolution is where a damaged file is stopped.
 *
 * When a JPEG carries both blocks, `source` names JFIF. Both are returned either
 * way, because they can disagree and a person deserves to see that they do.
 *
 * @param {Uint8Array} bytes
 * @returns {{ format: string,
 *             jfif: { units: number, xDensity: number, yDensity: number }|null,
 *             exif: { xResolution: number|null, yResolution: number|null, unit: number|null }|null,
 *             phys: { xPixelsPerUnit: number, yPixelsPerUnit: number, unit: number }|null,
 *             dpi: { x: number, y: number }|null,
 *             source: 'jfif'|'exif'|'phys'|null }}
 */
export function readResolution(input) {
    const bytes = toBytes(input);
    const format = formatOf(bytes);

    if (format === 'png') {
        const { chunks } = walkPng(bytes);
        const phys = physBlock(bytes, chunks);
        const exif = pngExifBlock(bytes, chunks);

        const fromPhys = physDpi(phys);
        const dpi = fromPhys ?? exifDpi(exif);

        return {
            format,
            jfif: null,
            exif: reportedExif(exif),
            phys: phys ? {
                xPixelsPerUnit: phys.xPixelsPerUnit,
                yPixelsPerUnit: phys.yPixelsPerUnit,
                unit: phys.unit,
            } : null,
            dpi,
            source: dpi === null ? null : (fromPhys ? 'phys' : 'exif'),
        };
    }

    const { segments } = walkJpeg(bytes);
    const jfif = jfifBlock(bytes, segments);
    const exif = exifBlock(bytes, segments);

    const fromJfif = jfifDpi(jfif);
    const dpi = fromJfif ?? exifDpi(exif);

    return {
        format,
        jfif: jfif ? { units: jfif.units, xDensity: jfif.xDensity, yDensity: jfif.yDensity } : null,
        exif: reportedExif(exif),
        phys: null,
        dpi,
        source: dpi === null ? null : (fromJfif ? 'jfif' : 'exif'),
    };
}

/* ----------------------------------------------------------------- writing */

function writeJpeg(bytes, dpi) {
    const { segments, error } = walkJpeg(bytes);
    if (error) throw invalidFile();

    const jfif = jfifBlock(bytes, segments);
    const exif = exifBlock(bytes, segments);

    const inserted = jfif === null;
    const shift = inserted ? JFIF_SEGMENT_LENGTH : 0;
    const changed = ['jfif'];

    let out;
    if (inserted) {
        // Behind the SOI, which is where the standard puts it and where every
        // decoder looks. Everything that was there moves along intact.
        out = new Uint8Array(bytes.length + JFIF_SEGMENT_LENGTH);
        out.set(bytes.subarray(0, 2), 0);
        out.set(jfifSegmentBytes(dpi), 2);
        out.set(bytes.subarray(2), 2 + JFIF_SEGMENT_LENGTH);
    } else {
        out = Uint8Array.from(bytes);
        const at = jfif.segment.dataAt;
        out[at + 7] = JFIF_UNITS_INCH;
        setBig16(out, at + 8, dpi);
        setBig16(out, at + 10, dpi);
    }

    // In place, in the block's own byte order, and never a byte longer — see the
    // header for why a TIFF block that moves is a TIFF block that lies.
    if (exif) {
        patchTiffResolution(out, exif, dpi, shift);
        changed.push('exif');
    }

    return { bytes: out, changed, inserted };
}

/**
 * The eXIf chunk with its resolution rewritten and its CRC recomputed.
 *
 * A copy rather than an edit of the source, because the source is what every
 * other piece of the output is a view onto and this is the one chunk whose bytes
 * differ. Same length, so nothing downstream of it moves.
 */
function patchedExifChunk(bytes, exif, dpi) {
    const copy = bytes.slice(exif.chunk.at, exif.chunk.end);
    patchTiffResolution(copy, exif, dpi, -exif.chunk.at);

    const crcAt = copy.length - 4;
    viewOf(copy).setUint32(crcAt, crc32(copy.subarray(4, crcAt)));

    return copy;
}

function writePng(bytes, dpi) {
    const { chunks, tailAt, error } = walkPng(bytes);
    if (error) throw invalidFile();

    const chunk = physChunkBytes(dpi);
    const inserted = !chunks.some((candidate) => candidate.type === TYPE_PHYS);
    const exif = pngExifBlock(bytes, chunks);
    const changed = ['phys'];

    const pieces = [bytes.subarray(0, PNG_SIGNATURE.length)];
    let written = false;

    for (const existing of chunks) {
        if (existing.type === TYPE_PHYS) {
            // The standard allows one. A second is a file that was already
            // wrong, and keeping it would leave the wrong one readable.
            if (!written) {
                pieces.push(chunk);
                written = true;
            }
            continue;
        }

        if (exif && existing.at === exif.chunk.at) {
            pieces.push(patchedExifChunk(bytes, exif, dpi));
            changed.push('exif');
            continue;
        }

        pieces.push(bytes.subarray(existing.at, existing.end));

        // pHYs has to precede the first IDAT, and directly after IHDR is the
        // one position that is always legal.
        if (existing.type === TYPE_IHDR && inserted) {
            pieces.push(chunk);
            written = true;
        }
    }

    if (tailAt < bytes.length) pieces.push(bytes.subarray(tailAt));

    const out = new Uint8Array(pieces.reduce((sum, piece) => sum + piece.length, 0));
    let at = 0;
    for (const piece of pieces) {
        out.set(piece, at);
        at += piece.length;
    }

    return { bytes: out, changed, inserted };
}

/**
 * The same file, claiming a different resolution.
 *
 * Nothing is decoded and nothing is re-encoded: the picture in the output is the
 * identical compressed data that came in, and every segment or chunk this
 * module does not own is copied across byte for byte. A JPEG is written twice —
 * a JFIF header always, its EXIF resolution fields as well when it has them —
 * because different software reads different ones.
 *
 * @param {Uint8Array} bytes
 * @param {number|string} dpi  a whole number within MIN_DPI..MAX_DPI
 * @returns {{ bytes: Uint8Array, changed: string[], inserted: boolean }}
 *          `changed` names the blocks this write reached ('jfif', 'exif',
 *          'phys'); `inserted` is true when the block had to be created rather
 *          than rewritten.
 */
export function writeResolution(input, dpi) {
    const bytes = toBytes(input);
    const format = formatOf(bytes);
    const value = parseDpi(dpi);

    return format === 'png' ? writePng(bytes, value) : writeJpeg(bytes, value);
}

/* ---------------------------------------------------------------- the op */

/**
 * Progress bookends. The numbers PROGRESS.checked and PROGRESS.encoded carry in
 * operations.js, written out rather than imported: that module will import this
 * one, and importing it back would close a cycle.
 */
const PROGRESS_START = 5;
const PROGRESS_DONE = 95;

/**
 * /change-image-dpi as the engine's op contract sees it.
 *
 * The width and the height come straight back from what the page measured,
 * unchanged and unexamined, because this operation cannot change them — that is
 * the whole promise, and re-deriving them would mean opening the picture to
 * confirm something no code path could have altered.
 *
 * @param {{ file: Blob, name?: string, options: object, sourceFormat?: string,
 *           sourceWidth?: number, sourceHeight?: number,
 *           report: (percent: number, phase: string) => void, guard: () => void }} context
 */
export async function runDpi(context) {
    const { file, sourceWidth, sourceHeight, report, guard } = context;

    const dpi = parseDpi((context.options ?? {}).dpi);

    report(PROGRESS_START, 'reading');
    guard();

    const bytes = new Uint8Array(await file.arrayBuffer());

    const before = readResolution(bytes);
    const written = writeResolution(bytes, dpi);
    const after = readResolution(written.bytes);

    guard();
    report(PROGRESS_DONE, 'written');

    const type = contentTypeFor(before.format);

    return {
        blob: new Blob([written.bytes], { type }),
        bytes: written.bytes.byteLength,
        format: before.format,
        type,
        width: sourceWidth,
        height: sourceHeight,
        dpi: { before, after },
        inserted: written.inserted,
        changed: written.changed,
    };
}

export default runDpi;
