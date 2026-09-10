/**
 * Image containers, built and taken apart from the format specs.
 *
 * EVERY PARSER HERE IS THE TESTS' OWN. A JPEG segment walker, a PNG chunk
 * walker with its own CRC32, a RIFF walker, a hand-built Exif TIFF and the
 * splicers that put segments and chunks into real files are written from the
 * specs and never imported from lib/. Checking a container module with its own
 * parser would prove only that it agrees with itself; these give a second,
 * independent opinion, and the same opinion to every suite that needs one —
 * the metadata stripper, the metadata viewer and the fixtures both are fed.
 *
 * Test-only. Nothing under lib/ or app/ may import this file.
 */
import { EXIF_MARKER } from '../lib/image-client/helpers/fixtures.js';

export const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
        let c = n;
        for (let k = 0; k < 8; k += 1) c = (c & 1) === 1 ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        table[n] = c >>> 0;
    }
    return table;
})();

/** PNG's CRC-32, written here from the spec so a chunk's CRC can be checked. */
export function crc32(bytes) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i += 1) {
        c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    }
    return (c ^ 0xFFFFFFFF) >>> 0;
}

export const PNG_SIGNATURE = '89504e470d0a1a0a';

/**
 * Every chunk of a PNG, with its raw bytes and whether its stored CRC still
 * matches what the type and data hash to. `trailing` is whatever sits after
 * IEND — a place a whole second file can hide.
 */
export function pngChunks(input) {
    const buffer = Buffer.from(input);
    if (buffer.subarray(0, 8).toString('hex') !== PNG_SIGNATURE) throw new Error('not a PNG');

    const chunks = [];
    let at = 8;
    while (at + 12 <= buffer.length) {
        const length = buffer.readUInt32BE(at);
        const end = at + 12 + length;
        if (end > buffer.length) throw new Error('truncated PNG chunk');

        const type = buffer.subarray(at + 4, at + 8).toString('latin1');
        chunks.push({
            type,
            // Offsets INTO THE FILE. A subarray's own byteOffset is relative
            // to whatever Buffer.from allocated, which for a small input is a
            // shared pool — so it is not the file position and must never be
            // used as one.
            at,
            dataAt: at + 8,
            data: buffer.subarray(at + 8, at + 8 + length),
            raw: buffer.subarray(at, end),
            crcOk: buffer.readUInt32BE(at + 8 + length) === crc32(buffer.subarray(at + 4, at + 8 + length)),
        });

        at = end;
        if (type === 'IEND') break;
    }

    return { chunks, trailing: buffer.length - at };
}

/** The keyword of a tEXt/zTXt/iTXt chunk: everything before the first NUL. */
export function textKeyword(chunk) {
    const nul = chunk.data.indexOf(0);
    return chunk.data.subarray(0, nul === -1 ? chunk.data.length : nul).toString('latin1');
}

/**
 * A JPEG taken apart: the segments in front of the first scan, where that scan
 * starts, where the primary image's EOI ends, and how much file is stapled on
 * after it.
 *
 * The EOI walk is deliberately shaped differently from the module's — a flat
 * scan over pairs rather than a marker-length loop — so the two cannot be wrong
 * in the same way.
 */
export function jpegSegments(input) {
    const buffer = Buffer.from(input);
    if (buffer[0] !== 0xFF || buffer[1] !== 0xD8) throw new Error('not a JPEG');

    const segments = [];
    let at = 2;
    let scanStart = -1;

    while (at + 4 <= buffer.length) {
        if (buffer[at] !== 0xFF) throw new Error(`expected a marker at ${at}`);
        const marker = buffer[at + 1];
        if (marker === 0xDA) {
            scanStart = at;
            break;
        }

        const length = buffer.readUInt16BE(at + 2);
        segments.push({
            marker,
            // See pngChunks above: file positions, not subarray byteOffsets.
            at,
            payloadAt: at + 4,
            payload: buffer.subarray(at + 4, at + 2 + length),
            raw: buffer.subarray(at, at + 2 + length),
        });
        at += 2 + length;
    }

    let scanEnd = -1;
    if (scanStart !== -1) {
        let i = scanStart + 2;
        while (i + 1 < buffer.length) {
            if (buffer[i] !== 0xFF) {
                i += 1;
                continue;
            }

            const next = buffer[i + 1];
            if (next === 0xFF) {
                i += 1;
                continue;
            }
            // A stuffed 0xFF and a restart marker are both part of the stream.
            if (next === 0x00 || (next >= 0xD0 && next <= 0xD7)) {
                i += 2;
                continue;
            }
            if (next === 0xD9) {
                scanEnd = i + 2;
                break;
            }
            // Another scan's header or its tables, in a progressive file.
            i += 2 + buffer.readUInt16BE(i + 2);
        }
    }

    return {
        segments,
        scanStart,
        scanEnd,
        scan: scanEnd === -1 ? null : buffer.subarray(scanStart, scanEnd),
        trailing: scanEnd === -1 ? 0 : buffer.length - scanEnd,
    };
}

/** Every RIFF chunk of a WebP, honouring the pad byte an odd size carries. */
export function riffChunks(input) {
    const buffer = Buffer.from(input);
    if (buffer.subarray(0, 4).toString('latin1') !== 'RIFF') throw new Error('not a RIFF');

    const chunks = [];
    let at = 12;
    while (at + 8 <= buffer.length) {
        const type = buffer.subarray(at, at + 4).toString('latin1');
        const size = buffer.readUInt32LE(at + 4);
        if (at + 8 + size > buffer.length) throw new Error('truncated RIFF chunk');

        // See pngChunks above: file positions, not subarray byteOffsets.
        chunks.push({
            type, size, at, payloadAt: at + 8, payload: buffer.subarray(at + 8, at + 8 + size),
        });
        at += 8 + size + (size % 2);
    }

    return {
        form: buffer.subarray(8, 12).toString('latin1'),
        riffSize: buffer.readUInt32LE(4),
        chunks,
        length: buffer.length,
    };
}

export function chunkOfType(parsed, type) {
    return parsed.chunks.find((chunk) => chunk.type === type) ?? null;
}

export function containsText(bytes, text) {
    return Buffer.from(bytes).includes(Buffer.from(text, 'latin1'));
}

export const EXIF_PREFIX = Buffer.from('Exif\0\0', 'latin1');

/**
 * A hand-built Exif block, because sharp will not write the two structures that
 * matter most here: a GPS IFD is reachable only through the 0x8825 pointer in
 * IFD0, and an IFD1 — the embedded thumbnail, a second visible copy of the
 * photograph — is something sharp never emits at all (its IFD0 always points at
 * 0). Both are what a phone actually writes, so both are built by hand.
 *
 * Returns the TIFF only. A JPEG APP1 needs 'Exif\0\0' in front of it; a PNG
 * eXIf chunk is the TIFF on its own.
 */
export function buildExifTiff({ gps = false, thumbnail = false, text = EXIF_MARKER } = {}) {
    const ascii = Buffer.from(`${text}\0`, 'latin1');

    const ifd0Count = gps ? 2 : 1;
    const ifd0At = 8;
    const ifd1At = ifd0At + 2 + ifd0Count * 12 + 4;
    const gpsAt = ifd1At + (thumbnail ? 2 + 12 + 4 : 0);
    const asciiAt = gpsAt + (gps ? 2 + 12 + 4 : 0);

    const tiff = Buffer.alloc(asciiAt + ascii.length);
    tiff.write('II', 0, 'latin1');
    tiff.writeUInt16LE(42, 2);
    tiff.writeUInt32LE(ifd0At, 4);

    let at = ifd0At;
    tiff.writeUInt16LE(ifd0Count, at);
    at += 2;

    // ImageDescription, an ASCII string held out of line.
    tiff.writeUInt16LE(0x010E, at);
    tiff.writeUInt16LE(2, at + 2);
    tiff.writeUInt32LE(ascii.length, at + 4);
    tiff.writeUInt32LE(asciiAt, at + 8);
    at += 12;

    if (gps) {
        // The GPS IFD pointer. Nothing else says a file knows where it was taken.
        tiff.writeUInt16LE(0x8825, at);
        tiff.writeUInt16LE(4, at + 2);
        tiff.writeUInt32LE(1, at + 4);
        tiff.writeUInt32LE(gpsAt, at + 8);
        at += 12;
    }

    tiff.writeUInt32LE(thumbnail ? ifd1At : 0, at);
    at += 4;

    if (thumbnail) {
        tiff.writeUInt16LE(1, at);
        tiff.writeUInt16LE(0x0103, at + 2);
        tiff.writeUInt16LE(3, at + 4);
        tiff.writeUInt32LE(1, at + 6);
        tiff.writeUInt16LE(6, at + 10);
        tiff.writeUInt32LE(0, at + 14);
        at += 18;
    }

    if (gps) {
        tiff.writeUInt16LE(1, at);
        tiff.writeUInt16LE(0x0000, at + 2);
        tiff.writeUInt16LE(1, at + 4);
        tiff.writeUInt32LE(4, at + 6);
        tiff.writeUInt8(2, at + 10);
        tiff.writeUInt8(3, at + 11);
        tiff.writeUInt32LE(0, at + 14);
        at += 18;
    }

    ascii.copy(tiff, asciiAt);
    return tiff;
}

/** Inserts segments straight after the SOI, where a writer puts its metadata. */
export function spliceJpegSegments(jpeg, entries) {
    const buffer = Buffer.from(jpeg);
    const parts = [buffer.subarray(0, 2)];

    for (const { marker, payload } of entries) {
        const body = Buffer.from(payload);
        const header = Buffer.alloc(4);
        header[0] = 0xFF;
        header[1] = marker;
        header.writeUInt16BE(body.length + 2, 2);
        parts.push(header, body);
    }

    parts.push(buffer.subarray(2));
    return Buffer.concat(parts);
}

export function pngChunk(type, data) {
    const body = Buffer.concat([Buffer.from(type, 'latin1'), Buffer.from(data)]);
    const out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(body.length - 4, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc32(body), body.length + 4);
    return out;
}

/**
 * A PNG with chunks put in and, optionally, chunks taken out.
 *
 * `drop` exists because sharp writes a pHYs of its own into every PNG it
 * encodes — 1000 pixels per metre, which reads back as 25 DPI — so a fixture
 * that is supposed to carry NO resolution metadata carries one anyway unless
 * it is removed. IHDR, IDAT and IEND are not droppable: without them there is
 * no picture to hold the metadata being tested.
 */
export function withPngChunks(png, { afterIhdr = [], beforeIend = [], drop = [] } = {}) {
    const structural = ['IHDR', 'IDAT', 'IEND'].filter((type) => drop.includes(type));
    if (structural.length > 0) throw new Error(`cannot drop ${structural.join(', ')} — that is the picture`);

    const { chunks } = pngChunks(png);
    const parts = [Buffer.from(png).subarray(0, 8)];

    for (const chunk of chunks) {
        if (chunk.type === 'IEND') parts.push(...beforeIend);
        if (!drop.includes(chunk.type)) parts.push(chunk.raw);
        if (chunk.type === 'IHDR') parts.push(...afterIhdr);
    }

    return Buffer.concat(parts);
}

export function riffChunk(type, payload) {
    const body = Buffer.from(payload);
    const header = Buffer.alloc(8);
    header.write(type, 0, 'latin1');
    header.writeUInt32LE(body.length, 4);
    return body.length % 2 === 0
        ? Buffer.concat([header, body])
        : Buffer.concat([header, body, Buffer.alloc(1)]);
}

export function buildWebp(chunks) {
    const body = Buffer.concat(chunks.map((chunk) => riffChunk(chunk.type, chunk.payload)));
    const header = Buffer.alloc(12);
    header.write('RIFF', 0, 'latin1');
    header.writeUInt32LE(4 + body.length, 4);
    header.write('WEBP', 8, 'latin1');
    return Buffer.concat([header, body]);
}

/** A JFIF APP0: kept, because it is the density header and names nobody. */
export const JFIF_PAYLOAD = Buffer.from([
    0x4A, 0x46, 0x49, 0x46, 0x00, // 'JFIF\0'
    0x01, 0x02, // version 1.2
    0x01, // units: dots per inch
    0x00, 0x48, 0x00, 0x48, // 72 x 72
    0x00, 0x00, // no thumbnail
]);

/**
 * A JFIF APP0 payload with a density of your choosing.
 *
 * JFIF_PAYLOAD above is the 72 x 72 one the stripper's tests want fixed. This
 * builds any other: `units` is 0 (aspect ratio only), 1 (dots per inch) or 2
 * (dots per centimetre), and the two densities are 16-bit.
 */
export function jfifPayload({ units = 1, xDensity = 72, yDensity = 72 } = {}) {
    const payload = Buffer.alloc(14);
    payload.write('JFIF\0', 0, 'latin1');
    payload[5] = 1;
    payload[6] = 2;
    payload[7] = units;
    payload.writeUInt16BE(xDensity, 8);
    payload.writeUInt16BE(yDensity, 10);
    return payload;
}

/* ------------------------------------------------------ TIFF, in general */

/**
 * WHY A SECOND TIFF WRITER LIVES BESIDE buildExifTiff.
 *
 * buildExifTiff above answers one question — "is there an Exif block, a GPS
 * IFD and a thumbnail here at all" — and that is all the stripper ever needs
 * to know, because the stripper deletes the block without reading a field in
 * it. A metadata VIEWER reads every field, so its fixtures have to contain
 * real values of every TIFF type: a shutter speed is a RATIONAL, an exposure
 * bias is an SRATIONAL, a make is ASCII, an orientation is a SHORT, and a set
 * of coordinates is three RATIONALs whose denominators decide how precise the
 * answer is. None of that can be expressed by "gps: true".
 *
 * So this writes a TIFF the way a camera writes one: a header, IFD0, an Exif
 * IFD and a GPS IFD reached through their pointer tags, an optional IFD1 for
 * the thumbnail, and one pool of out-of-line data for every value too big to
 * sit in an entry's four bytes. Both byte orders, because a viewer that
 * assumed little-endian would read every Canon file backwards.
 *
 * It is deliberately NOT a validator. Handed a nonsense offset or a count that
 * runs off the end it writes exactly that, which is the only way to build the
 * malformed fixtures a parser has to survive.
 */
export const TIFF_TYPES = {
    BYTE: 1,
    ASCII: 2,
    SHORT: 3,
    LONG: 4,
    RATIONAL: 5,
    SBYTE: 6,
    UNDEFINED: 7,
    SSHORT: 8,
    SLONG: 9,
    SRATIONAL: 10,
    FLOAT: 11,
    DOUBLE: 12,
};

/** Bytes one value of each type costs. The array length times this is the count. */
const TIFF_TYPE_BYTES = {
    1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8,
};

export const TAG_EXIF_IFD = 0x8769;
export const TAG_GPS_IFD = 0x8825;
export const TAG_THUMBNAIL_OFFSET = 0x0201;
export const TAG_THUMBNAIL_LENGTH = 0x0202;

const putU16 = (buffer, at, value, little) => (little
    ? buffer.writeUInt16LE(value, at)
    : buffer.writeUInt16BE(value, at));

const putU32 = (buffer, at, value, little) => (little
    ? buffer.writeUInt32LE(value, at)
    : buffer.writeUInt32BE(value, at));

const putI16 = (buffer, at, value, little) => (little
    ? buffer.writeInt16LE(value, at)
    : buffer.writeInt16BE(value, at));

const putI32 = (buffer, at, value, little) => (little
    ? buffer.writeInt32LE(value, at)
    : buffer.writeInt32BE(value, at));

/**
 * One entry's value, as bytes, and how many values that is.
 *
 * ASCII takes a string and gets its NUL; UNDEFINED takes bytes and gets
 * nothing added. Every numeric type takes an ARRAY, and a rational takes an
 * array of [numerator, denominator] pairs — `[[1, 250]]` is one shutter speed,
 * not two longs. Requiring the array everywhere costs two characters at the
 * call site and removes the one ambiguity that would matter: whether `[3, 1]`
 * means one rational or two shorts.
 */
function encodeTiffValues(tag, type, values, little) {
    const label = `tag 0x${tag.toString(16).padStart(4, '0').toUpperCase()}`;

    if (type === TIFF_TYPES.ASCII) {
        const text = typeof values === 'string' ? values : Buffer.from(values).toString('latin1');
        const data = Buffer.from(`${text}\0`, 'latin1');
        return { count: data.length, data };
    }

    if (type === TIFF_TYPES.UNDEFINED) {
        const data = typeof values === 'string' ? Buffer.from(values, 'latin1') : Buffer.from(values);
        return { count: data.length, data };
    }

    const size = TIFF_TYPE_BYTES[type];
    if (!size) throw new TypeError(`${label}: ${type} is not a TIFF type`);
    if (!Array.isArray(values)) throw new TypeError(`${label}: type ${type} takes an array of values`);

    const data = Buffer.alloc(values.length * size);

    values.forEach((value, index) => {
        const at = index * size;

        if (type === TIFF_TYPES.RATIONAL || type === TIFF_TYPES.SRATIONAL) {
            if (!Array.isArray(value) || value.length !== 2) {
                throw new TypeError(`${label}: a rational is [numerator, denominator]`);
            }
            const write = type === TIFF_TYPES.RATIONAL ? putU32 : putI32;
            write(data, at, value[0], little);
            write(data, at + 4, value[1], little);
            return;
        }

        if (typeof value !== 'number') throw new TypeError(`${label}: ${value} is not a number`);

        if (type === TIFF_TYPES.BYTE) data.writeUInt8(value, at);
        else if (type === TIFF_TYPES.SBYTE) data.writeInt8(value, at);
        else if (type === TIFF_TYPES.SHORT) putU16(data, at, value, little);
        else if (type === TIFF_TYPES.SSHORT) putI16(data, at, value, little);
        else if (type === TIFF_TYPES.LONG) putU32(data, at, value, little);
        else if (type === TIFF_TYPES.SLONG) putI32(data, at, value, little);
        else if (type === TIFF_TYPES.FLOAT) {
            if (little) data.writeFloatLE(value, at); else data.writeFloatBE(value, at);
        } else if (little) data.writeDoubleLE(value, at);
        else data.writeDoubleBE(value, at);
    });

    return { count: values.length, data };
}

/**
 * A TIFF, from entries.
 *
 * `{ byteOrder: 'II'|'MM', ifd0: [{ tag, type, values }], exif: [...],
 *    gps: [...], ifd1: [...]|null }`.
 *
 * The Exif and GPS pointer entries are written for you when those arrays hold
 * anything, so a caller states the fields and never the offsets. Passing your
 * own 0x8769 or 0x8825 alongside a non-empty array is refused rather than
 * silently duplicated — but passing one with the array left empty is allowed
 * and is how a fixture points at nothing on purpose.
 *
 * `thumbnail` takes the BYTES of an embedded preview and writes a real one:
 * the JPEGInterchangeFormat pair goes into IFD1 pointing at the bytes, which
 * are appended after the value pool. A thumbnail is the second visible copy of
 * a photograph, so a fixture that only claimed to have one — an IFD1 with a
 * Compression tag and an offset pointing at nothing — would prove nothing
 * about a viewer that says "this file contains an embedded preview image".
 *
 * Returns the TIFF only. A JPEG APP1 needs 'Exif\0\0' in front of it, a PNG
 * eXIf chunk and a WebP EXIF chunk are the TIFF on its own.
 */
export function buildTiff({
    byteOrder = 'II', ifd0 = [], exif = [], gps = [], ifd1 = null, thumbnail = null,
} = {}) {
    if (byteOrder !== 'II' && byteOrder !== 'MM') {
        throw new TypeError(`byteOrder is 'II' or 'MM', not ${byteOrder}`);
    }
    const little = byteOrder === 'II';

    const clash = (tag, entries, name) => {
        if (entries.length > 0 && ifd0.some((entry) => entry.tag === tag)) {
            throw new Error(`pass the ${name} entries or your own pointer to them, not both`);
        }
    };
    clash(TAG_EXIF_IFD, exif, 'Exif');
    clash(TAG_GPS_IFD, gps, 'GPS');

    // A TIFF IFD holds its entries in ascending tag order and a reader is
    // entitled to binary-search them.
    const sort = (entries) => [...entries].sort((a, b) => a.tag - b.tag);
    const blockBytes = (count) => 2 + count * 12 + 4;

    const preview = thumbnail === null ? null : Buffer.from(thumbnail);
    if (preview !== null && ifd1 === null) throw new Error('a thumbnail lives in IFD1 — pass ifd1 as well');

    const exifEntries = sort(exif);
    const gpsEntries = sort(gps);
    const ifd1Entries = ifd1 === null ? null : sort([
        ...ifd1,
        // Patched with the real offset once the pool below has been laid out.
        ...(preview === null ? [] : [
            { tag: TAG_THUMBNAIL_OFFSET, type: TIFF_TYPES.LONG, values: [0] },
            { tag: TAG_THUMBNAIL_LENGTH, type: TIFF_TYPES.LONG, values: [preview.length] },
        ]),
    ]);

    const ifd0At = 8;
    const ifd0Count = ifd0.length + (exifEntries.length > 0 ? 1 : 0) + (gpsEntries.length > 0 ? 1 : 0);
    const exifAt = ifd0At + blockBytes(ifd0Count);
    const gpsAt = exifAt + (exifEntries.length > 0 ? blockBytes(exifEntries.length) : 0);
    const ifd1At = gpsAt + (gpsEntries.length > 0 ? blockBytes(gpsEntries.length) : 0);
    const poolAt = ifd1At + (ifd1Entries === null ? 0 : blockBytes(ifd1Entries.length));

    const ifd0Entries = sort([
        ...ifd0,
        ...(exifEntries.length > 0 ? [{ tag: TAG_EXIF_IFD, type: TIFF_TYPES.LONG, values: [exifAt] }] : []),
        ...(gpsEntries.length > 0 ? [{ tag: TAG_GPS_IFD, type: TIFF_TYPES.LONG, values: [gpsAt] }] : []),
    ]);

    const blocks = [
        { at: ifd0At, entries: ifd0Entries, next: ifd1Entries === null ? 0 : ifd1At },
        ...(exifEntries.length > 0 ? [{ at: exifAt, entries: exifEntries, next: 0 }] : []),
        ...(gpsEntries.length > 0 ? [{ at: gpsAt, entries: gpsEntries, next: 0 }] : []),
        ...(ifd1Entries === null ? [] : [{ at: ifd1At, entries: ifd1Entries, next: 0 }]),
    ];

    // One pool for everything wider than an entry's four bytes, in the order
    // the entries are written, each padded to an even offset the way a TIFF
    // writer is expected to.
    let poolSize = 0;
    for (const block of blocks) {
        block.items = block.entries.map((entry) => {
            const value = encodeTiffValues(entry.tag, entry.type, entry.values, little);
            if (value.data.length > 4) {
                value.at = poolAt + poolSize;
                poolSize += value.data.length + (value.data.length % 2);
            }
            return { entry, value };
        });
    }

    const previewAt = poolAt + poolSize + ((poolAt + poolSize) % 2);
    const tiff = Buffer.alloc(preview === null ? poolAt + poolSize : previewAt + preview.length);
    tiff.write(byteOrder, 0, 'latin1');
    putU16(tiff, 2, 42, little);
    putU32(tiff, 4, ifd0At, little);

    for (const block of blocks) {
        putU16(tiff, block.at, block.items.length, little);

        block.items.forEach(({ entry, value }, index) => {
            const at = block.at + 2 + index * 12;
            putU16(tiff, at, entry.tag, little);
            putU16(tiff, at + 2, entry.type, little);
            putU32(tiff, at + 4, value.count, little);

            if (value.data.length > 4) {
                putU32(tiff, at + 8, value.at, little);
                value.data.copy(tiff, value.at);
            } else {
                // A short value sits in the entry itself, left-justified, in
                // both byte orders.
                value.data.copy(tiff, at + 8);
            }

            if (preview !== null && entry.tag === TAG_THUMBNAIL_OFFSET && block.at === ifd1At) {
                putU32(tiff, at + 8, previewAt, little);
            }
        });

        putU32(tiff, block.at + 2 + block.items.length * 12, block.next, little);
    }

    if (preview !== null) preview.copy(tiff, previewAt);

    return tiff;
}

/** An Exif APP1 payload: the 'Exif\0\0' header and then the TIFF. */
export function exifApp1(tiff) {
    return Buffer.concat([EXIF_PREFIX, Buffer.from(tiff)]);
}

/* --------------------------------------------------------- GPS, as written */

/**
 * Degrees, minutes and seconds as the three RATIONALs a GPS IFD holds.
 *
 * The seconds denominator comes from how many decimals the seconds were
 * written with, which is the whole point: 40.2 becomes 402/10 and not
 * 40/1, so a fixture can state a coordinate to the precision a phone states
 * it to and a parser that truncated the fraction is caught.
 */
export function dmsRationals({ degrees, minutes, seconds }) {
    const text = String(seconds);
    const decimals = text.includes('.') ? text.split('.')[1].length : 0;
    const scale = 10 ** decimals;
    return [[degrees, 1], [minutes, 1], [Math.round(seconds * scale), scale]];
}

/**
 * The same three rationals back as one signed decimal — the tests' own
 * arithmetic, so an expected coordinate is derived from the bytes that were
 * written rather than from a number typed twice.
 */
export function dmsDecimal(rationals, ref) {
    const [degrees, minutes, seconds] = rationals.map(([numerator, denominator]) => numerator / denominator);
    const magnitude = degrees + minutes / 60 + seconds / 3600;
    return ref === 'S' || ref === 'W' ? -magnitude : magnitude;
}

/* ------------------------------------------------------------------- XMP */

/**
 * An XMP packet around the properties given, with the namespaces a photo
 * actually carries already declared.
 *
 * The packet is UTF-8 and is returned as bytes, because that is what goes
 * into a JPEG APP1, a PNG iTXt and a WebP 'XMP ' chunk, and because the one
 * thing a viewer must never do to it is parse it as XML.
 *
 * `attributes` writes properties in their OTHER legal form — as attributes on
 * rdf:Description rather than as child elements. Real files use both, often in
 * the same packet, so a fixture that only used one would let a scanner that
 * handles only that one pass.
 */
export function xmpPacket(properties, { attributes = '' } = {}) {
    return Buffer.from(
        '<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>'
        + '<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="Resizo Fixtures">'
        + '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">'
        + '<rdf:Description rdf:about=""'
        + ' xmlns:dc="http://purl.org/dc/elements/1.1/"'
        + ' xmlns:xmp="http://ns.adobe.com/xap/1.0/"'
        + ' xmlns:photoshop="http://ns.adobe.com/photoshop/1.0/"'
        + ' xmlns:xmpMM="http://ns.adobe.com/xap/1.0/mm/"'
        + (attributes ? ` ${attributes}` : '')
        + '>'
        + properties
        + '</rdf:Description></rdf:RDF></x:xmpmeta>'
        + '<?xpacket end="w"?>',
        'utf8',
    );
}

export const XMP_APP1_HEADER = Buffer.from('http://ns.adobe.com/xap/1.0/\0', 'latin1');

/** The APP1 payload a JPEG carries an XMP packet in. */
export function xmpApp1(packet) {
    return Buffer.concat([XMP_APP1_HEADER, Buffer.from(packet)]);
}

/* ------------------------------------------------------------------- ICC */

/** s15Fixed16: the number format every XYZ value in an ICC profile uses. */
const s15f16 = (value) => Math.round(value * 65536);

function iccXyzTag(x, y, z) {
    const data = Buffer.alloc(20);
    data.write('XYZ ', 0, 'latin1');
    data.writeInt32BE(s15f16(x), 8);
    data.writeInt32BE(s15f16(y), 12);
    data.writeInt32BE(s15f16(z), 16);
    return data;
}

/** A one-entry 'curv', which ICC reads as a plain gamma in u8Fixed8. */
function iccCurveTag(gamma) {
    const data = Buffer.alloc(14);
    data.write('curv', 0, 'latin1');
    data.writeUInt32BE(1, 8);
    data.writeUInt16BE(Math.round(gamma * 256), 12);
    return data;
}

function iccTextTag(text) {
    const body = Buffer.from(`${text}\0`, 'latin1');
    const data = Buffer.alloc(8 + body.length);
    data.write('text', 0, 'latin1');
    body.copy(data, 8);
    return data;
}

/**
 * A v2 'desc' tag — textDescription: an ASCII run, then an empty Unicode run,
 * then the 70-byte Macintosh ScriptCode block that nothing has used since
 * about 1998 and every profile still carries.
 */
function iccDescriptionTag(text) {
    const ascii = Buffer.from(`${text}\0`, 'latin1');
    const data = Buffer.alloc(12 + ascii.length + 8 + 3 + 67);
    data.write('desc', 0, 'latin1');
    data.writeUInt32BE(ascii.length, 8);
    ascii.copy(data, 12);
    return data;
}

/**
 * A small but genuinely valid ICC profile, written here rather than taken from
 * libvips.
 *
 * WHY NOT sharp's BUILT-IN sRGB. Because the description string is the thing
 * under test, and `withMetadata({ icc: 'srgb' })` copies whatever profile the
 * installed libvips carries — a string that changes with a dependency bump and
 * differs between machines. A fixture whose asserted value is supplied by a
 * third party is not a fixture. This one is 100% ours: fixed creation date,
 * fixed tag order, the same bytes on every machine forever.
 *
 * The numbers in it are real: the D50-adapted sRGB primaries and white point
 * every v2 sRGB profile stores, and a 2.2 gamma curve. So it is an sRGB
 * profile in substance as well as in name, and lcms will not reject it.
 */
export function buildIccProfile({
    description = 'Resizo Fixture sRGB',
    copyright = 'Public domain — generated for Resizo tests',
    colourSpace = 'RGB ',
    pcs = 'XYZ ',
    deviceClass = 'mntr',
    version = [2, 1],
} = {}) {
    const curve = iccCurveTag(2.2);
    const tags = [
        ['desc', iccDescriptionTag(description)],
        ['cprt', iccTextTag(copyright)],
        ['wtpt', iccXyzTag(0.9642, 1.0, 0.8249)],
        ['rXYZ', iccXyzTag(0.4360, 0.2225, 0.0139)],
        ['gXYZ', iccXyzTag(0.3851, 0.7169, 0.0971)],
        ['bXYZ', iccXyzTag(0.1431, 0.0606, 0.7139)],
        ['rTRC', curve],
        ['gTRC', curve],
        ['bTRC', curve],
    ];

    const tableAt = 128;
    let at = tableAt + 4 + tags.length * 12;
    const placed = tags.map(([signature, data]) => {
        const entry = { signature, data, at };
        at += data.length + ((4 - (data.length % 4)) % 4);
        return entry;
    });

    const profile = Buffer.alloc(at);
    profile.writeUInt32BE(at, 0);
    profile[8] = version[0];
    profile[9] = (version[1] << 4) & 0xF0;
    profile.write(deviceClass, 12, 'latin1');
    profile.write(colourSpace, 16, 'latin1');
    profile.write(pcs, 20, 'latin1');

    // A fixed creation date. A clock here would make every regeneration a diff.
    profile.writeUInt16BE(2024, 24);
    profile.writeUInt16BE(5, 26);
    profile.writeUInt16BE(1, 28);
    profile.writeUInt16BE(12, 30);

    profile.write('acsp', 36, 'latin1');

    // The PCS illuminant is D50 by definition, and a profile that says
    // otherwise is malformed.
    profile.writeInt32BE(s15f16(0.9642), 68);
    profile.writeInt32BE(s15f16(1.0), 72);
    profile.writeInt32BE(s15f16(0.8249), 76);

    profile.writeUInt32BE(placed.length, tableAt);
    placed.forEach((entry, index) => {
        const row = tableAt + 4 + index * 12;
        profile.write(entry.signature, row, 'latin1');
        profile.writeUInt32BE(entry.at, row + 4);
        profile.writeUInt32BE(entry.data.length, row + 8);
        entry.data.copy(profile, entry.at);
    });

    return profile;
}

export const ICC_APP2_HEADER = Buffer.from('ICC_PROFILE\0', 'latin1');

/** The APP2 payload a JPEG carries one piece of an ICC profile in. */
export function iccApp2(profile, { sequence = 1, total = 1 } = {}) {
    const header = Buffer.concat([ICC_APP2_HEADER, Buffer.from([sequence, total])]);
    return Buffer.concat([header, Buffer.from(profile)]);
}

/* ------------------------------------------------------------ WebP VP8X */

/**
 * The 10-byte VP8X payload that turns a plain WebP into an extended one: the
 * feature flags, then the canvas size as two 24-bit little-endian numbers
 * holding width - 1 and height - 1.
 *
 * A WebP carrying EXIF, XMP or an ICC profile MUST have this chunk first and
 * MUST set the matching flag, so this is what makes a metadata-bearing WebP
 * fixture a real file rather than a chunk salad.
 */
export function vp8xPayload({
    width, height, alpha = false, animation = false, exif = false, xmp = false, icc = false,
}) {
    if (!(width >= 1 && height >= 1)) throw new RangeError('a VP8X canvas is at least 1 x 1');

    const payload = Buffer.alloc(10);
    payload[0] = (icc ? 0x20 : 0) | (alpha ? 0x10 : 0) | (exif ? 0x08 : 0)
        | (xmp ? 0x04 : 0) | (animation ? 0x02 : 0);

    payload.writeUIntLE(width - 1, 4, 3);
    payload.writeUIntLE(height - 1, 7, 3);
    return payload;
}

/* --------------------------------------------------- TIFF, read back again */

/**
 * A TIFF taken apart, so a fixture's fields can be checked without asking the
 * writer above what it thinks it wrote.
 *
 * It is deliberately shaped the other way round from buildTiff: that one lays
 * out blocks and computes offsets, this one follows offsets it is handed and
 * computes nothing. So the two cannot be wrong in the same way — a writer that
 * put a value four bytes early produces a reader result that is visibly wrong
 * rather than symmetrically wrong.
 *
 * Returns `{ byteOrder, ifd0, exif, gps, ifd1, thumbnail }`, where each IFD is
 * an object keyed by tag number holding `{ tag, type, count, values }` and
 * `values` is a string for ASCII, a Buffer for UNDEFINED, an array of
 * [numerator, denominator] pairs for the rationals and an array of numbers
 * for everything else.
 */
export function readTiff(input) {
    const buffer = Buffer.from(input);
    const byteOrder = buffer.subarray(0, 2).toString('latin1');
    if (byteOrder !== 'II' && byteOrder !== 'MM') throw new Error(`not a TIFF, byte order ${byteOrder}`);

    const little = byteOrder === 'II';
    const u16 = (at) => (little ? buffer.readUInt16LE(at) : buffer.readUInt16BE(at));
    const u32 = (at) => (little ? buffer.readUInt32LE(at) : buffer.readUInt32BE(at));
    const i32 = (at) => (little ? buffer.readInt32LE(at) : buffer.readInt32BE(at));
    const i16 = (at) => (little ? buffer.readInt16LE(at) : buffer.readInt16BE(at));

    if (u16(2) !== 42) throw new Error('not a TIFF, the magic number is not 42');

    function readValues(type, count, from) {
        const size = TIFF_TYPE_BYTES[type];
        if (!size) throw new Error(`type ${type} is not a TIFF type`);
        if (from + size * count > buffer.length) throw new Error(`a value at ${from} runs past the end`);

        if (type === TIFF_TYPES.ASCII) {
            return buffer.subarray(from, from + count).toString('latin1').replace(/\0+$/, '');
        }
        if (type === TIFF_TYPES.UNDEFINED) return Buffer.from(buffer.subarray(from, from + count));

        const values = [];
        for (let i = 0; i < count; i += 1) {
            const at = from + i * size;
            if (type === TIFF_TYPES.RATIONAL) values.push([u32(at), u32(at + 4)]);
            else if (type === TIFF_TYPES.SRATIONAL) values.push([i32(at), i32(at + 4)]);
            else if (type === TIFF_TYPES.BYTE) values.push(buffer.readUInt8(at));
            else if (type === TIFF_TYPES.SBYTE) values.push(buffer.readInt8(at));
            else if (type === TIFF_TYPES.SHORT) values.push(u16(at));
            else if (type === TIFF_TYPES.SSHORT) values.push(i16(at));
            else if (type === TIFF_TYPES.LONG) values.push(u32(at));
            else if (type === TIFF_TYPES.SLONG) values.push(i32(at));
            else if (type === TIFF_TYPES.FLOAT) values.push(little ? buffer.readFloatLE(at) : buffer.readFloatBE(at));
            else values.push(little ? buffer.readDoubleLE(at) : buffer.readDoubleBE(at));
        }
        return values;
    }

    function readIfd(at) {
        if (at + 2 > buffer.length) throw new Error(`an IFD at ${at} is past the end`);
        const count = u16(at);
        const entries = {};

        for (let index = 0; index < count; index += 1) {
            const entry = at + 2 + index * 12;
            const tag = u16(entry);
            const type = u16(entry + 2);
            const length = u32(entry + 4);
            const wide = (TIFF_TYPE_BYTES[type] ?? 0) * length > 4;
            entries[tag] = {
                tag,
                type,
                count: length,
                values: readValues(type, length, wide ? u32(entry + 8) : entry + 8),
            };
        }

        return { entries, next: u32(at + 2 + count * 12) };
    }

    const ifd0 = readIfd(u32(4));
    const exifAt = ifd0.entries[TAG_EXIF_IFD]?.values?.[0] ?? null;
    const gpsAt = ifd0.entries[TAG_GPS_IFD]?.values?.[0] ?? null;
    const ifd1 = ifd0.next === 0 ? null : readIfd(ifd0.next);

    const offset = ifd1?.entries?.[TAG_THUMBNAIL_OFFSET]?.values?.[0] ?? null;
    const length = ifd1?.entries?.[TAG_THUMBNAIL_LENGTH]?.values?.[0] ?? null;

    return {
        byteOrder,
        ifd0: ifd0.entries,
        exif: exifAt === null ? null : readIfd(exifAt).entries,
        gps: gpsAt === null ? null : readIfd(gpsAt).entries,
        ifd1: ifd1 === null ? null : ifd1.entries,
        thumbnail: offset === null || length === null
            ? null
            : Buffer.from(buffer.subarray(offset, offset + length)),
    };
}

/* ---------------------------------------------------- ICC, read back again */

/**
 * The header and tag table of an ICC profile, plus the description a 'desc'
 * tag holds — enough to check that a profile fixture says what it was built to
 * say, read straight from the spec's byte offsets.
 */
export function readIccTags(input) {
    const buffer = Buffer.from(input);
    if (buffer.length < 132) throw new Error('too short to be an ICC profile');
    if (buffer.subarray(36, 40).toString('latin1') !== 'acsp') throw new Error("no 'acsp' signature");

    const count = buffer.readUInt32BE(128);
    const tags = {};
    for (let index = 0; index < count; index += 1) {
        const row = 132 + index * 12;
        tags[buffer.subarray(row, row + 4).toString('latin1')] = {
            at: buffer.readUInt32BE(row + 4),
            size: buffer.readUInt32BE(row + 8),
        };
    }

    let description = null;
    const desc = tags.desc;
    if (desc && buffer.subarray(desc.at, desc.at + 4).toString('latin1') === 'desc') {
        const ascii = buffer.readUInt32BE(desc.at + 8);
        description = buffer.subarray(desc.at + 12, desc.at + 12 + ascii).toString('latin1').replace(/\0+$/, '');
    }

    return {
        size: buffer.readUInt32BE(0),
        version: `${buffer[8]}.${buffer[9] >> 4}`,
        deviceClass: buffer.subarray(12, 16).toString('latin1'),
        colourSpace: buffer.subarray(16, 20).toString('latin1'),
        pcs: buffer.subarray(20, 24).toString('latin1'),
        tags,
        description,
    };
}
