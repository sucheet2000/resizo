/**
 * Metadata removal that does not touch the picture.
 *
 * THE CLAIM THIS FILE HAS TO HOLD. A person drops a photo, is told the camera
 * make, the timestamp and the coordinates are gone, and gets a file back. Two
 * things have to be true at once, and a test that checks only one of them
 * passes for a build that is badly wrong:
 *
 *   1. THE METADATA IS ACTUALLY GONE. Not "sharp no longer reports it" — the
 *      marker strings are searched for across every byte of the output, because
 *      a stripper that moves an Exif block into a segment sharp does not parse
 *      still leaks the coordinates to anything that greps the file.
 *
 *   2. THE PICTURE IS UNTOUCHED, BYTE FOR BYTE. This is the whole reason the
 *      module exists rather than being one more decode/re-encode. A JPEG that
 *      went through MozJPEG at quality 100 would pass a pixel comparison with a
 *      generous tolerance and would still have thrown away the original's
 *      coefficients. So the compressed data is compared as BYTES — JPEG
 *      SOS-to-EOI, every kept PNG chunk including IDAT, the WebP image chunks —
 *      and the decoded pixels are compared with Buffer.equals, exactly.
 *
 * EVERY PARSER BELOW IS THIS FILE'S OWN. A JPEG segment walker, a PNG chunk
 * walker with its own CRC32, and a RIFF walker are written here from the format
 * specs and never imported from the module under test. Checking a stripper with
 * the stripper's own parser proves that it is self-consistent and nothing else:
 * both halves would agree about a segment neither of them understands.
 *
 * sharp is a fixture tool and an independent reference. It builds the inputs and
 * it reads the outputs back — a second, unrelated libvips opinion on whether the
 * Exif really went and whether the ICC profile really stayed. It is never on the
 * path under test.
 */
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import { METADATA_INPUT_FORMATS } from '@/lib/limits';
import { inspectMetadata, runStrip, stripMetadata } from '@/lib/image-client/metadata-strip';
import {
    EXIF_MARKER,
    GPS_MARKER,
    TRAILER_EXIF_MARKER,
    TRAILER_GPS_MARKER,
    jpegWithExifAndGps,
    makeFile,
    noiseJpeg,
} from './helpers/fixtures';

/* ------------------------------------------------- independent parsers */

const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
        let c = n;
        for (let k = 0; k < 8; k += 1) c = (c & 1) === 1 ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        table[n] = c >>> 0;
    }
    return table;
})();

/** PNG's CRC-32, written here from the spec so a chunk's CRC can be checked. */
function crc32(bytes) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i += 1) {
        c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    }
    return (c ^ 0xFFFFFFFF) >>> 0;
}

const PNG_SIGNATURE = '89504e470d0a1a0a';

/**
 * Every chunk of a PNG, with its raw bytes and whether its stored CRC still
 * matches what the type and data hash to. `trailing` is whatever sits after
 * IEND — a place a whole second file can hide.
 */
function pngChunks(input) {
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
function textKeyword(chunk) {
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
function jpegSegments(input) {
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
function riffChunks(input) {
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

function chunkOfType(parsed, type) {
    return parsed.chunks.find((chunk) => chunk.type === type) ?? null;
}

function containsText(bytes, text) {
    return Buffer.from(bytes).includes(Buffer.from(text, 'latin1'));
}

function ids(found) {
    return found.map((entry) => entry.id);
}

/* ------------------------------------------------------------ fixtures */

const EXIF_PREFIX = Buffer.from('Exif\0\0', 'latin1');
const XMP_MARKER = 'RESIZO-XMP-MARKER';
const IPTC_MARKER = 'RESIZO-IPTC-MARKER';
const COMMENT_MARKER = 'RESIZO-COMMENT-MARKER';
const TEXT_MARKER = 'RESIZO-TEXT-MARKER';
const EXTENDED_XMP_MARKER = 'RESIZO-XMP-EXTENSION-MARKER';
const VENDOR_MARKER = 'RESIZO-VENDOR-MARKER';

const cache = new Map();

async function memo(key, build) {
    if (!cache.has(key)) cache.set(key, await build());
    return cache.get(key);
}

const canvas = () => sharp({
    create: { width: 60, height: 40, channels: 3, background: { r: 200, g: 40, b: 80 } },
});

const alphaCanvas = () => sharp({
    create: { width: 40, height: 30, channels: 4, background: { r: 10, g: 120, b: 200, alpha: 0.5 } },
});

const SHARP_EXIF = {
    IFD0: { Copyright: EXIF_MARKER, Software: EXIF_MARKER },
    IFD3: {
        GPSLatitudeRef: 'N',
        GPSLatitude: '51/1 30/1 26/1',
        GPSLongitudeRef: 'W',
        GPSLongitude: '0/1 7/1 39/1',
        GPSDateStamp: GPS_MARKER,
    },
};

const XMP_PACKET = `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">`
    + `<rdf:Description rdf:about=""><dc:title>${XMP_MARKER}</dc:title></rdf:Description></rdf:RDF></x:xmpmeta>`;

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
function buildExifTiff({ gps = false, thumbnail = false, text = EXIF_MARKER } = {}) {
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
function spliceJpegSegments(jpeg, entries) {
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

function pngChunk(type, data) {
    const body = Buffer.concat([Buffer.from(type, 'latin1'), Buffer.from(data)]);
    const out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(body.length - 4, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc32(body), body.length + 4);
    return out;
}

function withPngChunks(png, { afterIhdr = [], beforeIend = [] } = {}) {
    const { chunks } = pngChunks(png);
    const parts = [Buffer.from(png).subarray(0, 8)];

    for (const chunk of chunks) {
        if (chunk.type === 'IEND') parts.push(...beforeIend);
        parts.push(chunk.raw);
        if (chunk.type === 'IHDR') parts.push(...afterIhdr);
    }

    return Buffer.concat(parts);
}

function riffChunk(type, payload) {
    const body = Buffer.from(payload);
    const header = Buffer.alloc(8);
    header.write(type, 0, 'latin1');
    header.writeUInt32LE(body.length, 4);
    return body.length % 2 === 0
        ? Buffer.concat([header, body])
        : Buffer.concat([header, body, Buffer.alloc(1)]);
}

function buildWebp(chunks) {
    const body = Buffer.concat(chunks.map((chunk) => riffChunk(chunk.type, chunk.payload)));
    const header = Buffer.alloc(12);
    header.write('RIFF', 0, 'latin1');
    header.writeUInt32LE(4 + body.length, 4);
    header.write('WEBP', 8, 'latin1');
    return Buffer.concat([header, body]);
}

/* -------------------------------------------------------- JPEG fixtures */

/** A JFIF APP0: kept, because it is the density header and names nobody. */
const JFIF_PAYLOAD = Buffer.from([
    0x4A, 0x46, 0x49, 0x46, 0x00, // 'JFIF\0'
    0x01, 0x02, // version 1.2
    0x01, // units: dots per inch
    0x00, 0x48, 0x00, 0x48, // 72 x 72
    0x00, 0x00, // no thumbnail
]);

const plainJpeg = () => memo('jpeg:plain', async () => spliceJpegSegments(
    await canvas().jpeg().toBuffer(),
    [{ marker: 0xE0, payload: JFIF_PAYLOAD }],
));

const jpegXmp = () => memo('jpeg:xmp', () => canvas().withXmp(XMP_PACKET).jpeg().toBuffer());

const jpegIcc = () => memo('jpeg:icc', () => canvas().withIccProfile('srgb').jpeg().toBuffer());

/**
 * A comment and a Photoshop IRB, spliced in by hand: sharp writes neither, and
 * both are what a desktop editor leaves behind.
 */
const jpegCommentAndIptc = () => memo('jpeg:com-iptc', async () => {
    const iptc = Buffer.concat([
        Buffer.from('Photoshop 3.0\0', 'latin1'),
        Buffer.from('8BIM', 'latin1'),
        Buffer.from([0x04, 0x04, 0x00, 0x00]), // IPTC-NAA resource, empty name
        (() => {
            const value = Buffer.concat([
                Buffer.from([0x1C, 0x02, 0x78]), // IPTC 2:120 Caption
                (() => {
                    const size = Buffer.alloc(2);
                    size.writeUInt16BE(IPTC_MARKER.length);
                    return size;
                })(),
                Buffer.from(IPTC_MARKER, 'latin1'),
            ]);
            const size = Buffer.alloc(4);
            size.writeUInt32BE(value.length);
            return Buffer.concat([size, value]);
        })(),
    ]);

    return spliceJpegSegments(await canvas().jpeg().toBuffer(), [
        { marker: 0xED, payload: iptc },
        { marker: 0xFE, payload: Buffer.from(COMMENT_MARKER, 'latin1') },
    ]);
});

/**
 * The Apple shape: an APP2 'MPF\0' index at the front, and a whole second JPEG
 * — with its own Exif and its own coordinates — after the primary image's EOI.
 * Its markers are distinct from the primary's, so a leak can be named.
 */
const jpegWithTrailer = () => memo('jpeg:trailer', async () => {
    const primary = await jpegWithExifAndGps();
    const secondary = await jpegWithExifAndGps({
        width: 24,
        height: 16,
        exifMarker: TRAILER_EXIF_MARKER,
        gpsMarker: TRAILER_GPS_MARKER,
    });

    const mpf = Buffer.concat([
        Buffer.from('MPF\0', 'latin1'),
        Buffer.from('II*\0\b\0\0\0', 'latin1'),
    ]);

    return Buffer.concat([
        spliceJpegSegments(primary, [{ marker: 0xE2, payload: mpf }]),
        Buffer.from(secondary),
    ]);
});

const progressiveJpeg = () => memo('jpeg:progressive', () => canvas()
    .withExif(SHARP_EXIF)
    .jpeg({ progressive: true })
    .toBuffer());

const trailerImage = () => jpegWithExifAndGps({
    width: 24,
    height: 16,
    exifMarker: TRAILER_EXIF_MARKER,
    gpsMarker: TRAILER_GPS_MARKER,
});

/**
 * A real photograph's worth of entropy-coded data — 475 stuffed 0xFF 0x00 pairs,
 * measured — with metadata in front of it and a second image behind it.
 *
 * Every other JPEG here is a flat colour whose scan is a few hundred bytes and
 * contains no stuffing at all, so none of them can tell a correct walk from one
 * that reads FF 00 as a marker with a length word. Noise cannot be compressed,
 * which is what puts the stuffed bytes there.
 */
const stuffedJpeg = () => memo('jpeg:stuffed', async () => Buffer.concat([
    spliceJpegSegments(await noiseJpeg({ width: 400, height: 300, quality: 92 }), [
        { marker: 0xE1, payload: Buffer.concat([EXIF_PREFIX, buildExifTiff({ gps: true })]) },
    ]),
    Buffer.from(await trailerImage()),
]));

/**
 * A restart marker sitting in the middle of the compressed data, followed by two
 * bytes that a walker mistaking it for a segment would read as a length.
 *
 * sharp will not write a restart marker — libvips exposes no restart interval —
 * so it is spliced in, which does make the entropy stream undecodable. That
 * costs this fixture the pixel comparison and nothing else: the question it asks
 * is about the CONTAINER walk, which must treat FF D0..D7 as part of the stream.
 *
 * THE TWO BYTES AFTER IT ARE CHOSEN, and that is the whole design. A restart
 * marker carries no length word, so whatever follows it is compressed data the
 * encoder happened to emit — any value at all, including one that reads as a
 * 53,000-byte length. Left to random noise the mistake is survivable and the
 * test proves nothing; it was measured passing against a build with the restart
 * case deleted. Sized to jump past the primary image's EOI, the same mistake
 * swallows the trailer, and the second photograph's coordinates come out in the
 * "stripped" file — which is the failure this is here to catch.
 */
const restartMarkerJpeg = () => memo('jpeg:restart', async () => {
    const source = Buffer.from(await noiseJpeg({ width: 400, height: 300, quality: 92 }));
    const { scanStart, scanEnd } = jpegSegments(source);

    // Somewhere in the middle, clear of any existing 0xFF so the splice cannot
    // land inside a stuffed pair.
    let at = scanStart + Math.floor((scanEnd - scanStart) / 2);
    while (source[at] === 0xFF || source[at - 1] === 0xFF) at += 1;

    // Far enough to clear the primary EOI and land inside the appended image.
    let length = scanEnd + 2 - at + 200;
    while ((length >> 8) === 0xFF || (length & 0xFF) === 0xFF) length += 1;
    expect(length).toBeLessThan(0x10000);

    return Buffer.concat([
        source.subarray(0, at),
        Buffer.from([0xFF, 0xD0, (length >> 8) & 0xFF, length & 0xFF]),
        source.subarray(at),
        Buffer.from(await trailerImage()),
    ]);
});

/** The two structures sharp will not write: a GPS pointer and an IFD1. */
const jpegWithThumbnail = () => memo('jpeg:thumbnail', async () => spliceJpegSegments(
    await canvas().jpeg().toBuffer(),
    [{ marker: 0xE1, payload: Buffer.concat([EXIF_PREFIX, buildExifTiff({ gps: true, thumbnail: true })]) }],
));

/* --------------------------------------------------------- PNG fixtures */

const plainPng = () => memo('png:plain', () => canvas().png().toBuffer());

const pngExifGps = () => memo('png:exif', async () => withPngChunks(await canvas().png().toBuffer(), {
    afterIhdr: [pngChunk('eXIf', buildExifTiff({ gps: true }))],
}));

const pngIcc = () => memo('png:icc', () => canvas().withIccProfile('srgb').png().toBuffer());

/**
 * The three text shapes at once: a plain tEXt, the zTXt sharp writes for an XMP
 * packet (keyword 'XML:com.adobe.xmp', which is what makes it XMP rather than a
 * comment), an iTXt carrying the same keyword, and a tIME.
 */
const pngTextAndTime = () => memo('png:text', async () => withPngChunks(
    await canvas().withXmp(XMP_PACKET).png().toBuffer(),
    {
        afterIhdr: [
            pngChunk('tEXt', Buffer.from(`Comment\0${TEXT_MARKER}`, 'latin1')),
            pngChunk('tIME', Buffer.from([0x07, 0xE8, 0x03, 0x0E, 0x0C, 0x00, 0x00])),
        ],
    },
));

/** An APNG's chunk order, so the animation control chunks are proved to survive. */
const apngShaped = () => memo('png:apng', async () => {
    const source = await canvas().png().toBuffer();
    const { chunks } = pngChunks(source);
    const idat = chunks.find((chunk) => chunk.type === 'IDAT');

    const actl = Buffer.alloc(8);
    actl.writeUInt32BE(2, 0);
    actl.writeUInt32BE(0, 4);

    const fctl = Buffer.alloc(26);
    fctl.writeUInt32BE(0, 0);
    fctl.writeUInt32BE(60, 4);
    fctl.writeUInt32BE(40, 8);

    const fdat = Buffer.concat([Buffer.from([0, 0, 0, 1]), idat.data]);

    return withPngChunks(source, {
        afterIhdr: [
            pngChunk('acTL', actl),
            pngChunk('tEXt', Buffer.from(`Comment\0${TEXT_MARKER}`, 'latin1')),
            pngChunk('fcTL', fctl),
        ],
        beforeIend: [pngChunk('fdAT', fdat)],
    });
});

/* -------------------------------------------------------- WebP fixtures */

const plainWebp = () => memo('webp:plain', () => canvas().webp().toBuffer());

const webpExif = () => memo('webp:exif', () => canvas().withExif(SHARP_EXIF).webp().toBuffer());

const webpIcc = () => memo('webp:icc', () => canvas().withIccProfile('srgb').webp().toBuffer());

const webpLosslessAlpha = () => memo('webp:lossless', () => alphaCanvas()
    .withExif(SHARP_EXIF)
    .webp({ lossless: true })
    .toBuffer());

const webpLossyAlpha = () => memo('webp:alpha', () => alphaCanvas()
    .withExif(SHARP_EXIF)
    .webp()
    .toBuffer());

/**
 * A WebP whose chunks do not all have even lengths. The pad byte is the one
 * piece of RIFF arithmetic that is invisible when every chunk happens to be
 * even — which is every file sharp writes — and getting it wrong shifts every
 * later chunk by one byte.
 */
const webpOddChunks = () => memo('webp:odd', async () => {
    const parsed = riffChunks(await webpExif());
    const chunks = parsed.chunks.map((chunk) => ({ type: chunk.type, payload: chunk.payload }));

    const vp8x = chunks.find((chunk) => chunk.type === 'VP8X');
    const flags = Buffer.from(vp8x.payload);
    flags[0] |= 0x04; // the XMP bit, since one is about to be added
    vp8x.payload = flags;

    // Both of these are deliberately an odd number of bytes long — one that is
    // dropped and one that is kept, so the pad byte is exercised on both sides.
    const xmp = Buffer.from(`<x>${XMP_MARKER}</x>\n`, 'latin1');
    expect(xmp.length % 2).toBe(1);

    chunks.push({ type: 'XMP ', payload: xmp });
    chunks.push({ type: 'TEST', payload: Buffer.from('odd', 'latin1') });

    return buildWebp(chunks);
});

/* ------------------------------------------------------------- helpers */

async function rawPixels(bytes) {
    return sharp(Buffer.from(bytes)).raw().toBuffer();
}

function stripContext(bytes, overrides = {}) {
    const progress = [];
    const guards = [];
    return {
        progress,
        guards,
        context: {
            file: makeFile(Buffer.from(bytes), { name: 'photo.jpg', type: 'image/jpeg' }),
            name: 'photo.jpg',
            options: {},
            sourceFormat: 'jpeg',
            sourceWidth: 60,
            sourceHeight: 40,
            report: (value, phase) => progress.push([value, phase]),
            guard: () => guards.push(progress.length),
            ...overrides,
        },
    };
}

/* --------------------------------------------------------------- tests */

describe('inspectMetadata', () => {
    it('reads the module allowlist rather than restating it', () => {
        expect(METADATA_INPUT_FORMATS).toEqual(['jpeg', 'png', 'webp']);
    });

    it('names the Exif block and the GPS IFD inside it separately', async () => {
        const report = inspectMetadata(new Uint8Array(await jpegWithExifAndGps()));

        expect(report.format).toBe('jpeg');
        expect(ids(report.found)).toEqual(['exif', 'gps']);
        expect(report.found.every((entry) => entry.removable)).toBe(true);
        expect(report.found[0].count).toBe(1);
    });

    it('names an embedded thumbnail, which is a second copy of the photograph', async () => {
        const report = inspectMetadata(new Uint8Array(await jpegWithThumbnail()));

        expect(ids(report.found)).toEqual(['exif', 'gps', 'thumbnail']);
    });

    it('names an XMP packet', async () => {
        expect(ids(inspectMetadata(new Uint8Array(await jpegXmp())).found)).toEqual(['xmp']);
    });

    it('names IPTC and comments', async () => {
        expect(ids(inspectMetadata(new Uint8Array(await jpegCommentAndIptc())).found))
            .toEqual(['iptc', 'comment']);
    });

    it('names the trailer and the MPF index that points into it', async () => {
        const report = inspectMetadata(new Uint8Array(await jpegWithTrailer()));

        expect(ids(report.found)).toEqual(['exif', 'gps', 'trailer']);
        // The APP2 index and the appended image are two separate removals.
        expect(report.found.find((entry) => entry.id === 'trailer').count).toBe(2);
    });

    it('reports an ICC profile as present and NOT removable', async () => {
        const report = inspectMetadata(new Uint8Array(await jpegIcc()));

        expect(report.found).toEqual([{ id: 'icc', count: 1, removable: false }]);
    });

    it('reads a PNG eXIf chunk and its GPS pointer', async () => {
        const report = inspectMetadata(new Uint8Array(await pngExifGps()));

        expect(report.format).toBe('png');
        expect(ids(report.found)).toEqual(['exif', 'gps']);
    });

    it('tells a PNG XMP packet apart from an ordinary text chunk', async () => {
        const report = inspectMetadata(new Uint8Array(await pngTextAndTime()));

        expect(ids(report.found)).toEqual(['xmp', 'text', 'time']);
    });

    it('reads a WebP EXIF chunk', async () => {
        const report = inspectMetadata(new Uint8Array(await webpExif()));

        expect(report.format).toBe('webp');
        expect(ids(report.found)).toEqual(['exif', 'gps']);
    });

    it('reports nothing for files that carry nothing', async () => {
        for (const bytes of [await plainJpeg(), await plainPng(), await plainWebp()]) {
            expect(inspectMetadata(new Uint8Array(bytes)).found).toEqual([]);
        }
    });

    it('refuses a HEIC, which cannot be rewritten without a decode', () => {
        const heic = new Uint8Array(16);
        heic[3] = 16;
        for (const [text, at] of [['ftyp', 4], ['heic', 8]]) {
            for (let i = 0; i < text.length; i += 1) heic[at + i] = text.charCodeAt(i);
        }

        expect(() => inspectMetadata(heic)).toThrow(
            expect.objectContaining({ code: 'unsupported-format' }),
        );
    });

    it('refuses bytes that are not an image at all', () => {
        expect(() => inspectMetadata(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])))
            .toThrow(expect.objectContaining({ code: 'unsupported-format' }));
    });

    it('refuses a truncated JPEG, PNG and WebP as invalid rather than unsupported', async () => {
        const cases = [await jpegWithExifAndGps(), await pngExifGps(), await webpExif()];

        for (const bytes of cases) {
            const truncated = new Uint8Array(Buffer.from(bytes).subarray(0, 40));
            expect(() => inspectMetadata(truncated))
                .toThrow(expect.objectContaining({ code: 'invalid-file' }));
        }
    });

    it('refuses a JPEG whose scan never ends', async () => {
        const source = Buffer.from(await jpegWithExifAndGps());
        const parsed = jpegSegments(source);
        // Everything up to the scan, and half a scan with no EOI behind it.
        const cut = source.subarray(0, parsed.scanEnd - 40);

        expect(() => inspectMetadata(new Uint8Array(cut)))
            .toThrow(expect.objectContaining({ code: 'invalid-file' }));
    });

    it('refuses a PNG whose chunk length runs past the end of the file', async () => {
        const source = Buffer.from(await plainPng());
        const broken = Buffer.from(source);
        broken.writeUInt32BE(0x0FFFFFFF, 8);

        expect(() => inspectMetadata(new Uint8Array(broken)))
            .toThrow(expect.objectContaining({ code: 'invalid-file' }));
    });

    it('refuses a WebP whose chunk length runs past the end of the file', async () => {
        const source = Buffer.from(await plainWebp());
        const broken = Buffer.from(source);
        broken.writeUInt32LE(0x0FFFFFFF, 16);

        expect(() => inspectMetadata(new Uint8Array(broken)))
            .toThrow(expect.objectContaining({ code: 'invalid-file' }));
    });
});

describe('stripMetadata, JPEG', () => {
    it('removes the Exif block and the coordinates inside it', async () => {
        const source = await jpegWithExifAndGps();
        const result = stripMetadata(new Uint8Array(source));

        expect(containsText(source, EXIF_MARKER)).toBe(true);
        expect(containsText(source, GPS_MARKER)).toBe(true);
        expect(containsText(result.bytes, EXIF_MARKER)).toBe(false);
        expect(containsText(result.bytes, GPS_MARKER)).toBe(false);
        expect(result.removed).toEqual([{ id: 'exif', count: 1 }, { id: 'gps', count: 1 }]);
        expect(result.kept).toEqual([]);
    });

    it('leaves the compressed scan byte for byte where it was', async () => {
        const source = Buffer.from(await jpegWithExifAndGps());
        const result = stripMetadata(new Uint8Array(source));

        const before = jpegSegments(source);
        const after = jpegSegments(result.bytes);

        expect(after.scan).not.toBeNull();
        expect(Buffer.from(after.scan).equals(Buffer.from(before.scan))).toBe(true);
        expect(after.trailing).toBe(0);
    });

    it('gives back exactly the pixels it was given', async () => {
        const source = await jpegWithExifAndGps();
        const result = stripMetadata(new Uint8Array(source));

        expect((await rawPixels(result.bytes)).equals(await rawPixels(source))).toBe(true);
    });

    it('satisfies sharp that the Exif is gone', async () => {
        const result = stripMetadata(new Uint8Array(await jpegWithExifAndGps()));
        const metadata = await sharp(Buffer.from(result.bytes)).metadata();

        expect(metadata.exif).toBeUndefined();
        expect(metadata.xmp).toBeUndefined();
    });

    it('keeps every segment a decoder needs, byte for byte', async () => {
        const source = Buffer.from(await plainJpeg());
        const result = stripMetadata(new Uint8Array(source));

        const before = jpegSegments(source);
        const after = jpegSegments(result.bytes);

        expect(after.segments.map((segment) => segment.marker))
            .toEqual(before.segments.map((segment) => segment.marker));

        for (let i = 0; i < after.segments.length; i += 1) {
            expect(Buffer.from(after.segments[i].raw).equals(Buffer.from(before.segments[i].raw)))
                .toBe(true);
        }

        // The JFIF header is one of them, and it is not metadata about a person.
        expect(after.segments.some((segment) => segment.marker === 0xE0)).toBe(true);
        expect(result.removed).toEqual([]);
        expect(Buffer.from(result.bytes).equals(source)).toBe(true);
    });

    it('keeps an ICC profile and says it kept it', async () => {
        const source = await jpegIcc();
        const result = stripMetadata(new Uint8Array(source));

        expect(result.removed).toEqual([]);
        expect(result.kept).toEqual([{ id: 'icc', count: 1 }]);
        expect((await sharp(Buffer.from(result.bytes)).metadata()).icc).toBeDefined();

        const app2 = jpegSegments(result.bytes).segments.find((segment) => segment.marker === 0xE2);
        expect(app2).toBeDefined();
        expect(Buffer.from(app2.payload).subarray(0, 12).toString('latin1')).toBe('ICC_PROFILE\0');
    });

    it('removes an XMP packet', async () => {
        const source = await jpegXmp();
        const result = stripMetadata(new Uint8Array(source));

        expect(containsText(source, XMP_MARKER)).toBe(true);
        expect(containsText(result.bytes, XMP_MARKER)).toBe(false);
        expect(result.removed).toEqual([{ id: 'xmp', count: 1 }]);
    });

    it('removes an extended-XMP chunk, which is a second APP1 with its own namespace', async () => {
        const source = await memo('jpeg:xmp-extended', async () => spliceJpegSegments(
            await canvas().withXmp(XMP_PACKET).jpeg().toBuffer(),
            [{
                marker: 0xE1,
                payload: Buffer.from(
                    `http://ns.adobe.com/xmp/extension/\0${EXTENDED_XMP_MARKER}`,
                    'latin1',
                ),
            }],
        ));

        const result = stripMetadata(new Uint8Array(source));

        expect(containsText(source, EXTENDED_XMP_MARKER)).toBe(true);
        expect(containsText(result.bytes, EXTENDED_XMP_MARKER)).toBe(false);
        expect(result.removed).toEqual([{ id: 'xmp', count: 2 }]);
    });

    it('removes an application segment it has never heard of', async () => {
        const source = await memo('jpeg:vendor', async () => spliceJpegSegments(
            await canvas().jpeg().toBuffer(),
            [
                { marker: 0xE3, payload: Buffer.from(`Vendor\0${VENDOR_MARKER}`, 'latin1') },
                { marker: 0xEF, payload: Buffer.from(`Other\0${VENDOR_MARKER}`, 'latin1') },
            ],
        ));

        const result = stripMetadata(new Uint8Array(source));

        // APPn is an allowlist: a segment nobody named is exactly the one most
        // likely to be carrying something about a person.
        expect(containsText(result.bytes, VENDOR_MARKER)).toBe(false);
        expect(result.removed).toEqual([{ id: 'other', count: 2 }]);
        expect((await rawPixels(result.bytes)).equals(await rawPixels(source))).toBe(true);
    });

    it('removes IPTC and comments', async () => {
        const source = await jpegCommentAndIptc();
        const result = stripMetadata(new Uint8Array(source));

        expect(containsText(result.bytes, IPTC_MARKER)).toBe(false);
        expect(containsText(result.bytes, COMMENT_MARKER)).toBe(false);
        expect(result.removed).toEqual([{ id: 'iptc', count: 1 }, { id: 'comment', count: 1 }]);
    });

    it('cuts off a trailer, which is a second photograph with its own coordinates', async () => {
        const source = await jpegWithTrailer();
        const result = stripMetadata(new Uint8Array(source));

        expect(containsText(source, TRAILER_GPS_MARKER)).toBe(true);
        expect(containsText(result.bytes, TRAILER_EXIF_MARKER)).toBe(false);
        expect(containsText(result.bytes, TRAILER_GPS_MARKER)).toBe(false);
        expect(containsText(result.bytes, 'MPF\0')).toBe(false);

        const bytes = Buffer.from(result.bytes);
        expect(bytes[bytes.length - 2]).toBe(0xFF);
        expect(bytes[bytes.length - 1]).toBe(0xD9);
        expect(jpegSegments(bytes).trailing).toBe(0);
    });

    it('walks a progressive JPEG to the end of its last scan', async () => {
        const source = Buffer.from(await progressiveJpeg());
        const result = stripMetadata(new Uint8Array(source));

        const before = jpegSegments(source);
        const after = jpegSegments(result.bytes);

        expect(Buffer.from(after.scan).equals(Buffer.from(before.scan))).toBe(true);
        expect(containsText(result.bytes, EXIF_MARKER)).toBe(false);
        expect((await rawPixels(result.bytes)).equals(await rawPixels(source))).toBe(true);
    });

    it('walks a scan full of stuffed 0xFF 0x00 pairs without losing the picture', async () => {
        const source = Buffer.from(await stuffedJpeg());
        const result = stripMetadata(new Uint8Array(source));

        const before = jpegSegments(source);
        const after = jpegSegments(result.bytes);

        // The fixture earns its keep only if the stuffing is really there.
        let stuffed = 0;
        for (let i = before.scanStart; i < before.scanEnd - 1; i += 1) {
            if (source[i] === 0xFF && source[i + 1] === 0x00) stuffed += 1;
        }
        expect(stuffed).toBeGreaterThan(100);

        expect(Buffer.from(after.scan).equals(Buffer.from(before.scan))).toBe(true);
        expect(after.trailing).toBe(0);
        expect(containsText(result.bytes, EXIF_MARKER)).toBe(false);
        expect(containsText(result.bytes, TRAILER_GPS_MARKER)).toBe(false);
        expect((await rawPixels(result.bytes)).equals(await rawPixels(source))).toBe(true);
    });

    it('steps over a restart marker instead of ending the picture at it', async () => {
        const source = Buffer.from(await restartMarkerJpeg());
        const result = stripMetadata(new Uint8Array(source));

        const before = jpegSegments(source);
        const after = jpegSegments(result.bytes);

        let restarts = 0;
        for (let i = before.scanStart; i < before.scanEnd - 1; i += 1) {
            if (source[i] === 0xFF && source[i + 1] >= 0xD0 && source[i + 1] <= 0xD7) restarts += 1;
        }
        expect(restarts).toBeGreaterThan(0);

        expect(Buffer.from(after.scan).equals(Buffer.from(before.scan))).toBe(true);
        expect(after.trailing).toBe(0);
        expect(containsText(result.bytes, TRAILER_GPS_MARKER)).toBe(false);
    });

    it('removes an embedded thumbnail with the block that held it', async () => {
        const source = await jpegWithThumbnail();
        const result = stripMetadata(new Uint8Array(source));

        expect(result.removed).toEqual([
            { id: 'exif', count: 1 },
            { id: 'gps', count: 1 },
            { id: 'thumbnail', count: 1 },
        ]);
        expect(jpegSegments(result.bytes).segments.some((segment) => segment.marker === 0xE1))
            .toBe(false);
    });
});

describe('stripMetadata, PNG', () => {
    it('removes the eXIf chunk and keeps every other chunk byte for byte', async () => {
        const source = Buffer.from(await pngExifGps());
        const result = stripMetadata(new Uint8Array(source));

        const before = pngChunks(source);
        const after = pngChunks(result.bytes);

        expect(after.chunks.map((chunk) => chunk.type)).toEqual(['IHDR', 'pHYs', 'IDAT', 'IEND']);
        expect(after.chunks.every((chunk) => chunk.crcOk)).toBe(true);

        for (const chunk of after.chunks) {
            const original = before.chunks.find((entry) => entry.type === chunk.type);
            expect(Buffer.from(chunk.raw).equals(Buffer.from(original.raw))).toBe(true);
        }

        expect(containsText(result.bytes, EXIF_MARKER)).toBe(false);
        expect(result.removed).toEqual([{ id: 'exif', count: 1 }, { id: 'gps', count: 1 }]);
    });

    it('gives back exactly the pixels it was given', async () => {
        const source = await pngExifGps();
        const result = stripMetadata(new Uint8Array(source));

        expect((await rawPixels(result.bytes)).equals(await rawPixels(source))).toBe(true);
        expect((await sharp(Buffer.from(result.bytes)).metadata()).exif).toBeUndefined();
    });

    it('removes text and time chunks, and tells XMP apart from a comment', async () => {
        const source = Buffer.from(await pngTextAndTime());
        const result = stripMetadata(new Uint8Array(source));

        const after = pngChunks(result.bytes);
        expect(after.chunks.some((chunk) => ['tEXt', 'zTXt', 'iTXt', 'tIME'].includes(chunk.type)))
            .toBe(false);
        expect(containsText(result.bytes, TEXT_MARKER)).toBe(false);
        expect(containsText(result.bytes, XMP_MARKER)).toBe(false);
        expect(result.removed).toEqual([
            { id: 'xmp', count: 1 },
            { id: 'text', count: 1 },
            { id: 'time', count: 1 },
        ]);

        // The XMP one is a zTXt with the Adobe keyword — proved, not assumed.
        const xmp = pngChunks(source).chunks.find((chunk) => chunk.type === 'zTXt');
        expect(textKeyword(xmp)).toBe('XML:com.adobe.xmp');
    });

    it('keeps an iCCP profile', async () => {
        const source = await pngIcc();
        const result = stripMetadata(new Uint8Array(source));

        expect(result.kept).toEqual([{ id: 'icc', count: 1 }]);
        expect(pngChunks(result.bytes).chunks.some((chunk) => chunk.type === 'iCCP')).toBe(true);
        expect((await sharp(Buffer.from(result.bytes)).metadata()).icc).toBeDefined();
    });

    it('keeps the APNG control chunks and their order', async () => {
        const source = Buffer.from(await apngShaped());
        const result = stripMetadata(new Uint8Array(source));

        const after = pngChunks(result.bytes);
        expect(after.chunks.map((chunk) => chunk.type))
            .toEqual(['IHDR', 'acTL', 'fcTL', 'pHYs', 'IDAT', 'fdAT', 'IEND']);
        expect(after.chunks.every((chunk) => chunk.crcOk)).toBe(true);
        expect(result.removed).toEqual([{ id: 'text', count: 1 }]);
    });

    it('returns a file with nothing to remove unchanged', async () => {
        const source = Buffer.from(await plainPng());
        const result = stripMetadata(new Uint8Array(source));

        expect(Buffer.from(result.bytes).equals(source)).toBe(true);
        expect(result.removed).toEqual([]);
    });
});

describe('stripMetadata, WebP', () => {
    it('drops the EXIF chunk, clears the VP8X flag and fixes the RIFF size', async () => {
        const source = Buffer.from(await webpExif());
        const result = stripMetadata(new Uint8Array(source));

        const before = riffChunks(source);
        const after = riffChunks(result.bytes);

        expect(chunkOfType(before, 'EXIF')).not.toBeNull();
        expect(chunkOfType(after, 'EXIF')).toBeNull();
        expect(after.riffSize).toBe(after.length - 8);

        expect(chunkOfType(before, 'VP8X').payload[0] & 0x08).toBe(0x08);
        expect(chunkOfType(after, 'VP8X').payload[0] & 0x08).toBe(0);
        expect(chunkOfType(after, 'VP8X').payload[0] & 0x04).toBe(0);

        expect(containsText(result.bytes, EXIF_MARKER)).toBe(false);
        expect(containsText(result.bytes, GPS_MARKER)).toBe(false);
        expect(result.removed).toEqual([{ id: 'exif', count: 1 }, { id: 'gps', count: 1 }]);
    });

    it('leaves the image chunk byte for byte where it was', async () => {
        const source = Buffer.from(await webpExif());
        const result = stripMetadata(new Uint8Array(source));

        const before = chunkOfType(riffChunks(source), 'VP8 ');
        const after = chunkOfType(riffChunks(result.bytes), 'VP8 ');

        expect(Buffer.from(after.payload).equals(Buffer.from(before.payload))).toBe(true);
        expect((await rawPixels(result.bytes)).equals(await rawPixels(source))).toBe(true);
    });

    it('keeps a lossless image and its alpha flag', async () => {
        const source = Buffer.from(await webpLosslessAlpha());
        const result = stripMetadata(new Uint8Array(source));

        const before = riffChunks(source);
        const after = riffChunks(result.bytes);

        expect(Buffer.from(chunkOfType(after, 'VP8L').payload)
            .equals(Buffer.from(chunkOfType(before, 'VP8L').payload))).toBe(true);
        // The ALPHA bit says the picture has transparency and must survive.
        expect(chunkOfType(after, 'VP8X').payload[0] & 0x10).toBe(0x10);
        expect((await rawPixels(result.bytes)).equals(await rawPixels(source))).toBe(true);
    });

    it('keeps a separate ALPH chunk', async () => {
        const source = Buffer.from(await webpLossyAlpha());
        const result = stripMetadata(new Uint8Array(source));

        const before = riffChunks(source);
        const after = riffChunks(result.bytes);

        expect(Buffer.from(chunkOfType(after, 'ALPH').payload)
            .equals(Buffer.from(chunkOfType(before, 'ALPH').payload))).toBe(true);
        expect(Buffer.from(chunkOfType(after, 'VP8 ').payload)
            .equals(Buffer.from(chunkOfType(before, 'VP8 ').payload))).toBe(true);
        expect((await rawPixels(result.bytes)).equals(await rawPixels(source))).toBe(true);
    });

    it('keeps an ICCP chunk', async () => {
        const source = await webpIcc();
        const result = stripMetadata(new Uint8Array(source));

        expect(result.kept).toEqual([{ id: 'icc', count: 1 }]);
        expect(chunkOfType(riffChunks(result.bytes), 'ICCP')).not.toBeNull();
        expect((await sharp(Buffer.from(result.bytes)).metadata()).icc).toBeDefined();
    });

    it('honours the pad byte an odd-length chunk carries', async () => {
        const source = Buffer.from(await webpOddChunks());
        const result = stripMetadata(new Uint8Array(source));

        const after = riffChunks(result.bytes);

        expect(chunkOfType(after, 'XMP ')).toBeNull();
        expect(containsText(result.bytes, XMP_MARKER)).toBe(false);

        // An unknown chunk is not metadata this module claims to understand, so
        // it survives — and it survives at the right offset, which is what the
        // pad byte decides.
        const test = chunkOfType(after, 'TEST');
        expect(test).not.toBeNull();
        expect(Buffer.from(test.payload).toString('latin1')).toBe('odd');
        expect(after.riffSize).toBe(after.length - 8);
        expect((await rawPixels(result.bytes)).equals(await rawPixels(source))).toBe(true);
    });

    it('returns a file with nothing to remove unchanged', async () => {
        const source = Buffer.from(await plainWebp());
        const result = stripMetadata(new Uint8Array(source));

        expect(Buffer.from(result.bytes).equals(source)).toBe(true);
        expect(result.removed).toEqual([]);
    });
});

describe('stripMetadata, refusals', () => {
    it('produces no output for a file it refuses', async () => {
        const truncated = new Uint8Array(Buffer.from(await webpExif()).subarray(0, 20));

        expect(() => stripMetadata(truncated))
            .toThrow(expect.objectContaining({ code: 'invalid-file' }));
    });

    it('refuses a HEIC rather than decoding it', () => {
        const heic = new Uint8Array(16);
        heic[3] = 16;
        for (const [text, at] of [['ftyp', 4], ['heic', 8]]) {
            for (let i = 0; i < text.length; i += 1) heic[at + i] = text.charCodeAt(i);
        }

        expect(() => stripMetadata(heic)).toThrow(
            expect.objectContaining({ code: 'unsupported-format' }),
        );
    });

    it('carries a sentence a person can act on, and no internals', () => {
        try {
            stripMetadata(new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]));
            throw new Error('expected a refusal');
        } catch (error) {
            expect(error.code).toBe('unsupported-format');
            expect(error.message).toMatch(/JPG|PNG|WebP/);
            expect(error.message).not.toMatch(/undefined|Uint8Array|at \w+ \(/);
        }
    });

    it('never hands back the caller\'s own array', async () => {
        const bytes = new Uint8Array(await plainJpeg());
        const result = stripMetadata(bytes);

        expect(result.bytes).not.toBe(bytes);
        expect(Buffer.from(result.bytes).equals(Buffer.from(bytes))).toBe(true);
    });
});

describe('runStrip', () => {
    it('returns the blob, the counts and the source dimensions', async () => {
        const source = await jpegWithExifAndGps();
        const { context, progress, guards } = stripContext(source);

        const result = await runStrip(context);

        expect(result.format).toBe('jpeg');
        expect(result.type).toBe('image/jpeg');
        expect(result.width).toBe(60);
        expect(result.height).toBe(40);
        expect(result.bytes).toBe(result.blob.size);
        expect(result.blob.type).toBe('image/jpeg');
        expect(ids(result.detected)).toEqual(['exif', 'gps']);
        expect(result.removed).toEqual([{ id: 'exif', count: 1 }, { id: 'gps', count: 1 }]);
        expect(result.kept).toEqual([]);

        const written = new Uint8Array(await result.blob.arrayBuffer());
        expect(containsText(written, GPS_MARKER)).toBe(false);

        expect(progress.map(([value]) => value)).toEqual([5, 95]);
        expect(guards.length).toBe(2);
    });

    it('returns a copy of a file that had nothing to remove', async () => {
        const source = await plainPng();
        const { context } = stripContext(source, {
            file: makeFile(Buffer.from(source), { name: 'flat.png', type: 'image/png' }),
            sourceFormat: 'png',
        });

        const result = await runStrip(context);

        expect(result.format).toBe('png');
        expect(result.type).toBe('image/png');
        expect(result.removed).toEqual([]);
        expect(Buffer.from(await result.blob.arrayBuffer()).equals(Buffer.from(source))).toBe(true);
    });

    it('refuses a HEIC through the same codes the panel already knows', async () => {
        const heic = new Uint8Array(16);
        heic[3] = 16;
        for (const [text, at] of [['ftyp', 4], ['heic', 8]]) {
            for (let i = 0; i < text.length; i += 1) heic[at + i] = text.charCodeAt(i);
        }

        const { context } = stripContext(heic, {
            file: makeFile(Buffer.from(heic), { name: 'photo.heic', type: 'image/heic' }),
            sourceFormat: 'heic',
        });

        await expect(runStrip(context)).rejects.toThrow(
            expect.objectContaining({ code: 'unsupported-format' }),
        );
    });
});
