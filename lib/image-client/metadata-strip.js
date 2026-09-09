/**
 * Metadata removal that never opens the picture.
 *
 * Every other operation in this engine decodes, works on pixels and encodes
 * again. This one does not, and must not: a photograph handed to a stripper
 * comes back with its camera, its timestamp and its coordinates gone AND with
 * the picture unchanged — not "visually identical", unchanged. A re-encode at
 * quality 100 looks the same and is not the same. It throws away the original
 * coefficients, it costs a decode surface on a phone, and it turns a job that is
 * a few array copies into the most expensive thing the tab does.
 *
 * So all three formats are treated as what they are — CONTAINERS with a compressed
 * payload inside — and only the container is rewritten:
 *
 *   JPEG  a chain of marker segments, then the entropy-coded scan. The metadata
 *         is in the APPn and COM segments in front of the scan; the picture is
 *         the bytes from SOS to EOI and they are copied verbatim.
 *   PNG   a chain of length-type-data-CRC chunks. The metadata is eXIf, tIME and
 *         the three text chunks; every other chunk, IDAT included, is copied
 *         with its original CRC untouched — nothing is re-hashed, so nothing can
 *         be re-hashed wrongly.
 *   WebP  RIFF chunks. EXIF and 'XMP ' go, the image chunks stay, and the VP8X
 *         flag bits that advertised the two removed chunks are cleared so the
 *         file does not promise something it no longer carries.
 *
 * WHY HEIC IS NOT HERE. lib/limits.js METADATA_INPUT_FORMATS is the allowlist and
 * it holds three formats. Rewriting an ISOBMFF box tree is a different job with a
 * different failure mode, and the only way to fake it — decode with libheif and
 * re-encode — is exactly the lossless claim this module exists to keep honest. A
 * HEIC is refused by name instead.
 *
 * WHAT IS DELIBERATELY KEPT. An ICC profile is colour, not identity: dropping it
 * shifts every pixel a viewer draws while telling the person their privacy
 * improved. It is DETECTED and reported so a page can say it stayed, and it is
 * never removed. On JPEG the same reasoning keeps APP0 (the JFIF density header)
 * and APP14 (the Adobe marker whose transform flag is how a decoder knows
 * whether a scan is YCbCr, RGB, YCCK or CMYK — dropping it is a colour bug, not
 * a privacy measure).
 *
 * THE FILE DOES NOT END WHERE THE PICTURE DOES. A phone writes more after the
 * primary image's EOI and every decoder ignores it: Apple MPF secondary images,
 * each a whole JPEG with its own Exif and its own coordinates, and Samsung and
 * Google Motion Photo video. Those bytes are a second photograph hiding inside
 * the first, so they are cut off, and so is the APP2 'MPF\0' index that pointed
 * at them. Anything stapled on after a PNG's IEND or outside a WebP's RIFF size
 * is dropped for the same reason and reported under the same name.
 *
 * NO CODEC IS LOADED AND NOTHING IS IMPORTED FROM decode/encode/codecs. A page
 * calls inspectMetadata() on the main thread to tell a visitor what a file they
 * just dropped is carrying, before any job is costed or any buffer allocated, so
 * this module has to stay small enough to be free.
 */
import { contentTypeFor } from '@/lib/image/filename';
import { sniffImageType } from '@/lib/image/magic-bytes';
import { METADATA_INPUT_FORMATS } from '@/lib/limits';

/**
 * The categories, in the order a report lists them. Fixed ids: the page turns
 * each one into a sentence, so a new kind of metadata means a new id here and a
 * new sentence there, never a value from inside someone's file reaching a
 * screen.
 *
 * The order is roughly "how much it says about a person" — the Exif block and
 * the coordinates in it first, the container housekeeping last, and 'icc' at the
 * end because it is the one entry that is reported without being removed.
 *
 * Not exported: every list this module hands out is already in this order, so a
 * caller that needed the array would only be re-sorting something sorted. The
 * page owns the id-to-sentence map, because wording is page copy and the engine
 * never carries page copy.
 */
const METADATA_CATEGORIES = [
    'exif',
    'gps',
    'thumbnail',
    'xmp',
    'iptc',
    'comment',
    'trailer',
    'text',
    'time',
    'other',
    'icc',
];

/** The categories that are found and reported but never removed. */
const KEPT_CATEGORIES = new Set(['icc']);

const PROGRESS_START = 5;
const PROGRESS_DONE = 95;

/**
 * A refusal this module cannot phrase as a JobError.
 *
 * JobError lives in lib/image-client/operations.js, which registers this op —
 * importing it back would close a cycle, and would drag the whole operation
 * table into a page that only wanted to look at a file. So the code and the
 * suggestion ride on a plain Error and the caller rebuilds them, exactly as
 * lib/image-client/pdf.js does.
 */
function refusal(message, code, suggestion = null) {
    return Object.assign(new Error(message), { code, suggestion });
}

function unsupported() {
    return refusal(
        'Metadata can only be removed from a JPG, PNG or WebP.',
        'unsupported-format',
        'Convert the file to JPG or PNG first, then remove its metadata.',
    );
}

function invalid() {
    return refusal(
        'This file is damaged or incomplete, so it cannot be rewritten without changing the picture.',
        'invalid-file',
        'Try exporting it again from the app that made it.',
    );
}

/* ----------------------------------------------------------- byte helpers */

function toBytes(value) {
    if (value instanceof Uint8Array) return value;
    if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    return null;
}

function signature(text) {
    return Array.from(text, (character) => character.charCodeAt(0));
}

function startsWith(bytes, at, expected) {
    if (at < 0 || at + expected.length > bytes.length) return false;
    for (let i = 0; i < expected.length; i += 1) {
        if (bytes[at + i] !== expected[i]) return false;
    }
    return true;
}

function ascii(bytes, at, length) {
    let out = '';
    for (let i = at; i < at + length; i += 1) out += String.fromCharCode(bytes[i]);
    return out;
}

// Multiplication rather than shifts: a 32-bit length read with `<< 24` comes
// back negative for anything above 2 GB, and a negative length passes a
// `> bytes.length` bounds check.
function readU32BE(bytes, at) {
    return bytes[at] * 16777216 + bytes[at + 1] * 65536 + bytes[at + 2] * 256 + bytes[at + 3];
}

function readU32LE(bytes, at) {
    return bytes[at] + bytes[at + 1] * 256 + bytes[at + 2] * 65536 + bytes[at + 3] * 16777216;
}

function writeU32LE(bytes, at, value) {
    bytes[at] = value & 0xFF;
    bytes[at + 1] = (value >>> 8) & 0xFF;
    bytes[at + 2] = (value >>> 16) & 0xFF;
    bytes[at + 3] = (value >>> 24) & 0xFF;
}

/** One new array holding the kept ranges, in order. Never a view on the input. */
function joinRanges(bytes, ranges) {
    let total = 0;
    for (const range of ranges) total += range.end - range.start;

    const out = new Uint8Array(total);
    let offset = 0;
    for (const range of ranges) {
        out.set(bytes.subarray(range.start, range.end), offset);
        offset += range.end - range.start;
    }
    return out;
}

/* -------------------------------------------------------------- counting */

function tally() {
    const removed = new Map();
    const kept = new Map();

    return {
        removed,
        kept,
        drop(id, count = 1) {
            removed.set(id, (removed.get(id) ?? 0) + count);
        },
        keep(id, count = 1) {
            kept.set(id, (kept.get(id) ?? 0) + count);
        },
    };
}

/**
 * `count` is how many separate PIECES were found, not how many kinds. Two Exif
 * blocks in one file are `{ id: 'exif', count: 2 }`, and an Apple photo's MPF
 * index plus the image it points at are `{ id: 'trailer', count: 2 }` — two
 * removals, because they are two places the same secret was written.
 */
function toList(counts) {
    const out = [];
    for (const id of METADATA_CATEGORIES) {
        const count = counts.get(id) ?? 0;
        if (count > 0) out.push({ id, count });
    }
    return out;
}

function toFound(plan) {
    const out = [];
    for (const id of METADATA_CATEGORIES) {
        const count = (plan.removed.get(id) ?? 0) + (plan.kept.get(id) ?? 0);
        if (count > 0) out.push({ id, count, removable: !KEPT_CATEGORIES.has(id) });
    }
    return out;
}

/* ------------------------------------------------------------------ Exif */

const EXIF_HEADER = signature('Exif\0\0');
const GPS_IFD_POINTER = 0x8825;
const TIFF_MAGIC = 42;

/**
 * What an Exif block carries beyond itself: a GPS IFD, and an IFD1 (the embedded
 * thumbnail — a second, smaller, VISIBLE copy of the photograph, which survives
 * a crop and has more than once shown what a redaction was hiding).
 *
 * Both are pointers rather than values. GPS is reachable only through tag 0x8825
 * in IFD0, and the thumbnail only through the next-IFD offset that follows IFD0's
 * entries; neither is visible to a scan for a string.
 *
 * Accepts the block with or without its 'Exif\0\0' header, because a JPEG APP1
 * carries the header, a PNG eXIf chunk is the bare TIFF, and a WebP EXIF chunk
 * is written both ways by different encoders.
 *
 * NEVER THROWS. It is describing something that is being deleted either way, so
 * a malformed block must cost the report a line, not cost the person their file.
 */
function readExifExtras(bytes, start, end) {
    const none = { gps: false, thumbnail: false };

    let tiff = start;
    if (startsWith(bytes, tiff, EXIF_HEADER)) tiff += EXIF_HEADER.length;
    if (tiff + 8 > end) return none;

    const little = bytes[tiff] === 0x49 && bytes[tiff + 1] === 0x49;
    const big = bytes[tiff] === 0x4D && bytes[tiff + 1] === 0x4D;
    if (!little && !big) return none;

    const u16 = (at) => (little ? bytes[at] + bytes[at + 1] * 256 : bytes[at] * 256 + bytes[at + 1]);
    const u32 = (at) => (little ? readU32LE(bytes, at) : readU32BE(bytes, at));

    if (u16(tiff + 2) !== TIFF_MAGIC) return none;

    const ifd0 = tiff + u32(tiff + 4);
    if (ifd0 + 2 > end) return none;

    const entries = u16(ifd0);
    const afterEntries = ifd0 + 2 + entries * 12;
    if (afterEntries + 4 > end) return none;

    let gps = false;
    for (let i = 0; i < entries; i += 1) {
        if (u16(ifd0 + 2 + i * 12) === GPS_IFD_POINTER) {
            gps = true;
            break;
        }
    }

    const nextIfd = u32(afterEntries);
    return { gps, thumbnail: nextIfd !== 0 && tiff + nextIfd + 2 <= end };
}

/* ------------------------------------------------------------------ JPEG */

const MARKER_START = 0xFF;
const MARKER_SOI = 0xD8;
const MARKER_EOI = 0xD9;
const MARKER_SOS = 0xDA;
const MARKER_TEM = 0x01;
const MARKER_COM = 0xFE;
const MARKER_APP0 = 0xE0;
const MARKER_APP1 = 0xE1;
const MARKER_APP2 = 0xE2;
const MARKER_APP13 = 0xED;
const MARKER_APP14 = 0xEE;
const MARKER_APP15 = 0xEF;

const SIGNATURE_XMP = signature('http://ns.adobe.com/xap/1.0/\0');
const SIGNATURE_XMP_EXTENDED = signature('http://ns.adobe.com/xmp/extension/\0');
const SIGNATURE_ICC = signature('ICC_PROFILE\0');
const SIGNATURE_MPF = signature('MPF\0');

function isRestart(marker) {
    return marker >= 0xD0 && marker <= 0xD7;
}

/**
 * Which category a segment belongs to and whether it survives.
 *
 * APPn IS AN ALLOWLIST HERE, not a blocklist: APP0, APP2/ICC_PROFILE and APP14
 * are named as kept and every other application segment goes. Vendors write
 * whatever they like into APP3-APP15 — Kodak, FlashPix, Ducky, camera-maker
 * blobs — and a blocklist would keep every one this file has not heard of, which
 * is precisely the set most likely to be carrying something about a person.
 */
function classifyJpegSegment(bytes, marker, payloadStart, payloadEnd, counts) {
    if (marker === MARKER_COM) {
        counts.drop('comment');
        return false;
    }

    if (marker === MARKER_APP13) {
        counts.drop('iptc');
        return false;
    }

    if (marker === MARKER_APP0 || marker === MARKER_APP14) return true;

    if (marker === MARKER_APP1) {
        if (startsWith(bytes, payloadStart, EXIF_HEADER)) {
            counts.drop('exif');
            const extras = readExifExtras(bytes, payloadStart, payloadEnd);
            if (extras.gps) counts.drop('gps');
            if (extras.thumbnail) counts.drop('thumbnail');
            return false;
        }

        // Extended XMP is a second APP1 with its own namespace, and a stripper
        // that only knew the first one would leave the overflow behind.
        if (startsWith(bytes, payloadStart, SIGNATURE_XMP)
            || startsWith(bytes, payloadStart, SIGNATURE_XMP_EXTENDED)) {
            counts.drop('xmp');
            return false;
        }

        counts.drop('other');
        return false;
    }

    if (marker === MARKER_APP2) {
        if (startsWith(bytes, payloadStart, SIGNATURE_ICC)) {
            counts.keep('icc');
            return true;
        }

        if (startsWith(bytes, payloadStart, SIGNATURE_MPF)) {
            counts.drop('trailer');
            return false;
        }

        counts.drop('other');
        return false;
    }

    if (marker > MARKER_APP0 && marker <= MARKER_APP15) {
        counts.drop('other');
        return false;
    }

    // DQT, DHT, SOF*, DRI and the rest of the tables a decoder cannot work
    // without.
    return true;
}

/**
 * One past the primary image's EOI, or -1 when the picture has no end.
 *
 * FINDING THE EOI MEANS WALKING COMPRESSED DATA, and 0xFF 0xD9 occurs inside it
 * by chance, so an indexOf truncates real photographs mid-picture. Three rules:
 *
 *   FF 00      a stuffed byte, the encoder writing a literal 0xFF
 *   FF D0..D7  a restart marker, part of the stream
 *   FF xx      a real marker
 *
 * And a real marker is still not the end. A progressive JPEG is several scans
 * with their own Huffman tables between them, so a marker carrying a length word
 * is stepped over and the walk continues. Only EOI stops it.
 */
function findScanEnd(bytes, from) {
    let at = from;

    while (at + 1 < bytes.length) {
        if (bytes[at] !== MARKER_START) {
            at += 1;
            continue;
        }

        // A run of 0xFF before a marker is legal fill.
        let markerAt = at + 1;
        while (markerAt < bytes.length && bytes[markerAt] === MARKER_START) markerAt += 1;
        if (markerAt >= bytes.length) return -1;

        const marker = bytes[markerAt];
        if (marker === MARKER_EOI) return markerAt + 1;

        if (marker === 0x00 || marker === MARKER_TEM || isRestart(marker)) {
            at = markerAt + 1;
            continue;
        }

        // A second SOI before the first EOI is not a file this may reason about.
        if (marker === MARKER_SOI) return -1;

        const lengthAt = markerAt + 1;
        if (lengthAt + 2 > bytes.length) return -1;

        const length = (bytes[lengthAt] << 8) | bytes[lengthAt + 1];
        if (length < 2 || lengthAt + length > bytes.length) return -1;

        at = lengthAt + length;
    }

    return -1;
}

function planJpeg(bytes) {
    if (bytes.length < 4 || bytes[0] !== MARKER_START || bytes[1] !== MARKER_SOI) throw invalid();

    const counts = tally();
    const keep = [{ start: 0, end: 2 }];

    let at = 2;
    let scanStart = -1;

    while (at + 4 <= bytes.length) {
        if (bytes[at] !== MARKER_START) throw invalid();

        let markerAt = at + 1;
        while (markerAt < bytes.length && bytes[markerAt] === MARKER_START) markerAt += 1;
        if (markerAt >= bytes.length) throw invalid();

        const marker = bytes[markerAt];
        if (marker === MARKER_SOS) {
            scanStart = markerAt - 1;
            break;
        }

        // A standalone marker where a segment has to be: there is no length word
        // to step over, so the rest of the file cannot be bounded.
        if (marker === MARKER_EOI || marker === MARKER_SOI || marker === MARKER_TEM
            || isRestart(marker)) {
            throw invalid();
        }

        const lengthAt = markerAt + 1;
        if (lengthAt + 2 > bytes.length) throw invalid();

        const length = (bytes[lengthAt] << 8) | bytes[lengthAt + 1];
        const next = lengthAt + length;
        if (length < 2 || next > bytes.length) throw invalid();

        if (classifyJpegSegment(bytes, marker, lengthAt + 2, next, counts)) {
            keep.push({ start: at, end: next });
        }

        at = next;
    }

    if (scanStart === -1) throw invalid();

    // Start the scan walk after the SOS header rather than inside it: the header
    // holds component ids and table selectors, and one of those bytes being 0xFF
    // would otherwise look like a marker.
    const sosLengthAt = scanStart + 2;
    if (sosLengthAt + 2 > bytes.length) throw invalid();

    const sosLength = (bytes[sosLengthAt] << 8) | bytes[sosLengthAt + 1];
    if (sosLength < 2 || sosLengthAt + sosLength > bytes.length) throw invalid();

    const scanEnd = findScanEnd(bytes, sosLengthAt + sosLength);
    if (scanEnd === -1) throw invalid();

    keep.push({ start: scanStart, end: scanEnd });
    if (bytes.length > scanEnd) counts.drop('trailer');

    return {
        format: 'jpeg',
        removed: counts.removed,
        kept: counts.kept,
        build: () => joinRanges(bytes, keep),
    };
}

/* ------------------------------------------------------------------- PNG */

const PNG_SIGNATURE = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
const PNG_TEXT_CHUNKS = new Set(['tEXt', 'zTXt', 'iTXt']);
const PNG_XMP_KEYWORD = 'XML:com.adobe.xmp';
const PNG_MAX_KEYWORD_LENGTH = 79;

function pngKeyword(bytes, start, end) {
    let out = '';
    const limit = Math.min(end, start + PNG_MAX_KEYWORD_LENGTH);
    for (let at = start; at < limit; at += 1) {
        if (bytes[at] === 0) break;
        out += String.fromCharCode(bytes[at]);
    }
    return out;
}

/**
 * PNG is a DROP LIST, where JPEG's application segments are a keep list, and the
 * asymmetry is deliberate. A PNG chunk's name says what it is: the case of the
 * first letter marks it critical, and a critical chunk this file has not heard
 * of is one the decoder needs. Dropping unknown chunks here would not remove
 * metadata, it would break images. There is no PNG equivalent of a vendor
 * writing a private blob into a slot every file has.
 */
function planPng(bytes) {
    if (bytes.length < 12 || !startsWith(bytes, 0, PNG_SIGNATURE)) throw invalid();
    if (ascii(bytes, 12, 4) !== 'IHDR') throw invalid();

    const counts = tally();
    const keep = [{ start: 0, end: 8 }];

    let at = 8;
    let closed = false;

    while (at + 12 <= bytes.length) {
        const length = readU32BE(bytes, at);
        const end = at + 12 + length;
        if (end > bytes.length) throw invalid();

        const type = ascii(bytes, at + 4, 4);
        const dataAt = at + 8;
        const dataEnd = dataAt + length;

        if (PNG_TEXT_CHUNKS.has(type)) {
            const keyword = pngKeyword(bytes, dataAt, dataEnd);
            counts.drop(keyword === PNG_XMP_KEYWORD ? 'xmp' : 'text');
        } else if (type === 'eXIf') {
            counts.drop('exif');
            const extras = readExifExtras(bytes, dataAt, dataEnd);
            if (extras.gps) counts.drop('gps');
            if (extras.thumbnail) counts.drop('thumbnail');
        } else if (type === 'tIME') {
            counts.drop('time');
        } else {
            if (type === 'iCCP') counts.keep('icc');
            // Copied with its stored CRC. Nothing is re-hashed, so nothing can be
            // re-hashed wrongly.
            keep.push({ start: at, end });
        }

        at = end;
        if (type === 'IEND') {
            closed = true;
            break;
        }
    }

    if (!closed) throw invalid();
    if (bytes.length > at) counts.drop('trailer');

    return {
        format: 'png',
        removed: counts.removed,
        kept: counts.kept,
        build: () => joinRanges(bytes, keep),
    };
}

/* ------------------------------------------------------------------ WebP */

const RIFF_SIGNATURE = signature('RIFF');
const WEBP_SIGNATURE = signature('WEBP');

const WEBP_DROPPED_CHUNKS = new Map([['EXIF', 'exif'], ['XMP ', 'xmp']]);

const VP8X_EXIF_FLAG = 0x08;
const VP8X_XMP_FLAG = 0x04;
// Everything except the two bits that advertise the chunks being removed. The
// ALPHA and ANIMATION bits are properties of the picture and must survive.
const VP8X_KEEP_MASK = 0xFF & ~(VP8X_EXIF_FLAG | VP8X_XMP_FLAG);

function buildWebp(bytes, pieces) {
    let total = 0;
    for (const piece of pieces) total += 8 + piece.size + (piece.size % 2);

    const out = new Uint8Array(12 + total);
    out.set(bytes.subarray(0, 12), 0);
    // The declared size is the file minus the 'RIFF' tag and the size word
    // itself. Recomputed rather than adjusted: an arithmetic slip on a delta is
    // silent, and a wrong RIFF size makes some decoders stop early.
    writeU32LE(out, 4, 4 + total);

    let offset = 12;
    for (const piece of pieces) {
        out.set(bytes.subarray(piece.start, piece.dataEnd), offset);
        if (piece.type === 'VP8X') out[offset + 8] &= VP8X_KEEP_MASK;
        // The pad byte an odd size needs is already zero from the allocation.
        offset += 8 + piece.size + (piece.size % 2);
    }

    return out;
}

function planWebp(bytes) {
    if (bytes.length < 16
        || !startsWith(bytes, 0, RIFF_SIGNATURE)
        || !startsWith(bytes, 8, WEBP_SIGNATURE)) {
        throw invalid();
    }

    const riffSize = readU32LE(bytes, 4);
    if (riffSize < 4 || riffSize + 8 > bytes.length) throw invalid();

    const counts = tally();
    const limit = riffSize + 8;
    const pieces = [];

    let at = 12;
    while (at + 8 <= limit) {
        const type = ascii(bytes, at, 4);
        const size = readU32LE(bytes, at + 4);
        const dataAt = at + 8;
        const dataEnd = dataAt + size;
        if (dataEnd > limit) throw invalid();

        const dropped = WEBP_DROPPED_CHUNKS.get(type);
        if (dropped) {
            counts.drop(dropped);
            if (dropped === 'exif') {
                const extras = readExifExtras(bytes, dataAt, dataEnd);
                if (extras.gps) counts.drop('gps');
                if (extras.thumbnail) counts.drop('thumbnail');
            }
        } else {
            if (type === 'ICCP') counts.keep('icc');
            pieces.push({ type, start: at, dataEnd, size });
        }

        // An odd chunk is followed by a pad byte that is not part of its payload.
        at = dataEnd + (size % 2);
    }

    // Whatever sits outside the last chunk — bytes past the declared RIFF size,
    // or a stub too short to be a chunk header — is not part of the picture.
    if (bytes.length > at) counts.drop('trailer');

    return {
        format: 'webp',
        removed: counts.removed,
        kept: counts.kept,
        build: () => buildWebp(bytes, pieces),
    };
}

/* -------------------------------------------------------------- the door */

function planStrip(input) {
    const bytes = toBytes(input);
    if (!bytes) throw unsupported();

    // The one signature check on the site. A partial one is how an SVG polyglot
    // reached a decoder once already.
    const format = sniffImageType(bytes);
    if (!format || !METADATA_INPUT_FORMATS.includes(format)) throw unsupported();

    if (format === 'jpeg') return planJpeg(bytes);
    if (format === 'png') return planPng(bytes);
    return planWebp(bytes);
}

/**
 * What this file is carrying, without changing anything.
 *
 * Cheap enough to run on the main thread the moment a file is dropped, which is
 * the point: a person decides whether to strip a photo by being told what is in
 * it, and being told before the job is costed rather than after it has run.
 *
 * @param {Uint8Array|ArrayBuffer|ArrayBufferView} bytes
 * @returns {{ format: 'jpeg'|'png'|'webp', found: Array<{ id: string, count: number, removable: boolean }> }}
 */
export function inspectMetadata(bytes) {
    const plan = planStrip(bytes);
    return { format: plan.format, found: toFound(plan) };
}

/**
 * The same file with its metadata removed and its picture untouched.
 *
 * ALWAYS A NEW ARRAY, even when nothing was removed. Handing back the input
 * would make the result alias a buffer the caller still owns, and a file with
 * nothing to strip is a perfectly good answer that has to be shaped like every
 * other answer.
 *
 * @param {Uint8Array|ArrayBuffer|ArrayBufferView} bytes
 * @returns {{ bytes: Uint8Array, removed: Array<{ id: string, count: number }>, kept: Array<{ id: string, count: number }> }}
 */
export function stripMetadata(bytes) {
    const plan = planStrip(bytes);
    return {
        bytes: plan.build(),
        removed: toList(plan.removed),
        kept: toList(plan.kept),
    };
}

/**
 * The op the worker runs.
 *
 * There is no decode stage, no encode stage and no quality, so the progress bar
 * has only the two honest points it can have: the file has been read and looked
 * at, and the file has been written. The width and the height come from what
 * intake already measured, because this operation cannot change them and opening
 * the picture to confirm a number would undo the whole reason it exists.
 */
export async function runStrip(context) {
    const { file, sourceWidth, sourceHeight, report, guard } = context;

    report(PROGRESS_START, 'checked');
    guard();

    const bytes = new Uint8Array(await file.arrayBuffer());
    const plan = planStrip(bytes);
    const output = plan.build();

    guard();
    report(PROGRESS_DONE, 'encoded');

    const type = contentTypeFor(plan.format);

    return {
        blob: new Blob([output], { type }),
        bytes: output.length,
        format: plan.format,
        type,
        width: sourceWidth ?? null,
        height: sourceHeight ?? null,
        detected: toFound(plan),
        removed: toList(plan.removed),
        kept: toList(plan.kept),
    };
}
