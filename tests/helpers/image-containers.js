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
import { EXIF_MARKER } from '../lib/image-client/helpers/fixtures';

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

        chunks.push({ type, size, payload: buffer.subarray(at + 8, at + 8 + size) });
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

export function withPngChunks(png, { afterIhdr = [], beforeIend = [] } = {}) {
    const { chunks } = pngChunks(png);
    const parts = [Buffer.from(png).subarray(0, 8)];

    for (const chunk of chunks) {
        if (chunk.type === 'IEND') parts.push(...beforeIend);
        parts.push(chunk.raw);
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
