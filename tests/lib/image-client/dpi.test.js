/**
 * /change-image-dpi, the engine.
 *
 * The whole claim of this tool is that NOTHING BUT THE NUMBER CHANGES. A print
 * shop asks for 300 DPI, the person sends the same photograph back with a
 * different label on it, and every pixel they captured is still the pixel they
 * captured. That is only true if the file is rewritten as bytes — no decoder, no
 * encoder, no resampler anywhere near it — so this suite is built to catch a
 * build that quietly decoded and re-encoded, which is the one failure a
 * before/after picture comparison would never show.
 *
 * FOUR THINGS THIS FILE EXISTS TO STOP
 *
 *  1. A RE-ENCODE WEARING A REWRITE'S CLOTHES. A JPEG re-encoded at quality 100
 *     looks identical and is not identical. So the compressed scan is compared
 *     BYTE FOR BYTE from the first start-of-scan marker to the end of the file,
 *     and every PNG chunk that is not pHYs is compared byte for byte in order.
 *     A decode-and-re-encode cannot survive either check.
 *
 *  2. THE OTHER HALF OF THE FILE BEING LEFT BEHIND. sharp writes JPEG density
 *     into EXIF and emits no JFIF APP0 at all, and libvips READS EXIF in
 *     preference to JFIF — proved below with a file whose two blocks disagree.
 *     So a build that inserts a JFIF header and leaves a stale EXIF resolution
 *     behind produces a file that still reports the old number to half the
 *     software in the world. Both blocks are asserted, separately.
 *
 *     A PNG HAS THE SAME PROBLEM, which is what these assertions caught. sharp
 *     writes an eXIf chunk beside every pHYs, holding the same TIFF block a JPEG
 *     keeps in APP1, and libvips reads that one first: an early build here
 *     rewrote pHYs alone, and sharp read the 144 DPI file back as 144 after it
 *     had been set to 300. Both PNG blocks are asserted too.
 *
 *  3. THE EXIF BLOCK MOVING. Every offset inside a TIFF block is relative to the
 *     block's own start, so growing it or shifting it by a byte invalidates
 *     every pointer in it — including the ones this module never touches, like
 *     the thumbnail and the Exif sub-IFD. The block's exact length is asserted,
 *     and so is the fact that only the resolution fields inside it differ.
 *
 *  4. A HALF-WRITTEN FILE. A truncated or corrupt input is refused with a code
 *     and a sentence, and produces no output at all. There is no partial answer.
 *
 * EVERY PARSER BELOW IS THIS FILE'S OWN — a JPEG segment walker, a TIFF/EXIF
 * reader and a PNG chunk walker with a bit-by-bit CRC32, all written from the
 * specifications rather than imported from the module under test. Checking a
 * writer with its own reader proves only that it is self-consistent. The module
 * uses the standard 256-entry CRC table; the one here shifts a polynomial eight
 * times per byte, so the two agree only if both are right.
 *
 * sharp is the second independent opinion, and a fixture tool, never on the path
 * under test. One caveat it forces: libvips discards an implausibly low
 * resolution and reports its own 72 DPI default instead, so a density of 1 comes
 * back from sharp as 72. Those two boundary cases are asserted with the parsers
 * here, which report what is actually in the bytes.
 */
import sharp from 'sharp';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { MAX_DPI, MIN_DPI } from '@/lib/limits';
import { readResolution, runDpi, writeResolution } from '@/lib/image-client/dpi';

/* ------------------------------------------------------------- assertions */

/** The error a call was supposed to refuse with, or a failure saying it did not. */
function refusal(run) {
    try {
        run();
    } catch (error) {
        return error;
    }
    throw new Error('expected a refusal, got a result');
}

async function asyncRefusal(promise) {
    try {
        await promise;
    } catch (error) {
        return error;
    }
    throw new Error('expected a refusal, got a result');
}

/* ------------------------------------------------- independent JPEG walker */

const MARKER_SOI = 0xD8;
const MARKER_SOS = 0xDA;
const MARKER_APP0 = 0xE0;
const MARKER_APP1 = 0xE1;

function latin1(bytes, at, length) {
    let out = '';
    for (let index = at; index < at + length; index += 1) out += String.fromCharCode(bytes[index]);
    return out;
}

function big16(bytes, at) {
    return (bytes[at] << 8) | bytes[at + 1];
}

function viewOf(bytes) {
    return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

/**
 * Every marker segment in front of the compressed scan, and where the scan
 * starts. Written from the JPEG specification: a segment is FF, a marker, a
 * two-byte length that counts itself, then the payload. Runs of FF before a
 * marker are legal fill and are skipped.
 */
function walkJpeg(bytes) {
    if (bytes.length < 4 || bytes[0] !== 0xFF || bytes[1] !== MARKER_SOI) {
        throw new Error('fixture: not a JPEG');
    }

    const segments = [];
    let at = 2;

    while (at + 4 <= bytes.length) {
        if (bytes[at] !== 0xFF) throw new Error(`fixture: no marker at ${at}`);

        let markerAt = at + 1;
        while (bytes[markerAt] === 0xFF) markerAt += 1;

        const marker = bytes[markerAt];
        if (marker === MARKER_SOS) return { segments, scanAt: at };

        const length = big16(bytes, markerAt + 1);
        const end = markerAt + 1 + length;

        segments.push({
            marker,
            at,
            end,
            dataAt: markerAt + 3,
            bytes: bytes.subarray(at, end),
        });

        at = end;
    }

    return { segments, scanAt: -1 };
}

function jfifSegmentOf(bytes) {
    const { segments } = walkJpeg(bytes);
    return segments.find((segment) => segment.marker === MARKER_APP0
        && latin1(bytes, segment.dataAt, 5) === 'JFIF\0') ?? null;
}

/** What a JFIF APP0 says about density, straight out of its fixed layout. */
function readJfif(bytes) {
    const segment = jfifSegmentOf(bytes);
    if (!segment) return null;

    const at = segment.dataAt;
    return {
        version: [bytes[at + 5], bytes[at + 6]],
        units: bytes[at + 7],
        x: big16(bytes, at + 8),
        y: big16(bytes, at + 10),
        thumbnail: [bytes[at + 12], bytes[at + 13]],
        segmentLength: segment.end - segment.at,
        segmentAt: segment.at,
    };
}

const TAG_X_RESOLUTION = 0x011A;
const TAG_Y_RESOLUTION = 0x011B;
const TAG_RESOLUTION_UNIT = 0x0128;

/**
 * The three resolution fields of IFD0, with the file offsets they live at.
 *
 * A TIFF block is a byte order, a magic 42, an offset to the first directory,
 * and twelve-byte entries of tag/type/count/value. A RATIONAL does not fit in
 * the four-byte value slot so it is stored at an offset, counted from the start
 * of the TIFF header — which is exactly why the block may never move.
 */
function tiffFields(bytes, tiffAt) {
    const little = latin1(bytes, tiffAt, 2) === 'II';
    const view = viewOf(bytes);
    const read16 = (at) => view.getUint16(at, little);
    const read32 = (at) => view.getUint32(at, little);

    const ifd0 = tiffAt + read32(tiffAt + 4);
    const count = read16(ifd0);

    const found = { tiffAt, little, x: null, y: null, unit: null };

    for (let index = 0; index < count; index += 1) {
        const entry = ifd0 + 2 + (index * 12);
        const tag = read16(entry);

        if (tag === TAG_X_RESOLUTION || tag === TAG_Y_RESOLUTION) {
            const valueAt = tiffAt + read32(entry + 8);
            const rational = {
                at: valueAt,
                numerator: read32(valueAt),
                denominator: read32(valueAt + 4),
                value: read32(valueAt) / read32(valueAt + 4),
            };
            if (tag === TAG_X_RESOLUTION) found.x = rational;
            else found.y = rational;
        }

        if (tag === TAG_RESOLUTION_UNIT) {
            found.unit = { at: entry + 8, value: read16(entry + 8) };
        }
    }

    return found;
}

function readExif(bytes) {
    const { segments } = walkJpeg(bytes);
    const segment = segments.find((candidate) => candidate.marker === MARKER_APP1
        && latin1(bytes, candidate.dataAt, 6) === 'Exif\0\0');
    if (!segment) return null;

    return {
        segmentAt: segment.at,
        segmentLength: segment.end - segment.at,
        ...tiffFields(bytes, segment.dataAt + 6),
    };
}

/** The same TIFF block where a PNG keeps it: the eXIf chunk's data, with no identifier. */
function readPngExif(bytes) {
    const chunk = walkPng(bytes).find((candidate) => candidate.type === 'eXIf');
    if (!chunk) return null;
    return { chunk, ...tiffFields(bytes, chunk.dataAt) };
}

/**
 * Rewrites the three resolution fields of a TIFF block that is already there.
 *
 * The fixture builder for the centimetre cases, because sharp will not write a
 * ResolutionUnit of 3 — asked for one it stores inches anyway. Writing the bytes
 * here is the only way to get a file that measures its resolution in
 * centimetres, which is what a scanner in most of the world produces.
 */
function patchTiff(bytes, fields, { value, unit }) {
    const out = Uint8Array.from(bytes);
    const view = viewOf(out);

    for (const rational of [fields.x, fields.y]) {
        if (!rational) continue;
        view.setUint32(rational.at, value, fields.little);
        view.setUint32(rational.at + 4, 1, fields.little);
    }
    if (fields.unit) view.setUint16(fields.unit.at, unit, fields.little);

    return out;
}

/** Everything from the first start-of-scan marker to the last byte of the file. */
function scanTail(bytes) {
    const { scanAt } = walkJpeg(bytes);
    if (scanAt === -1) throw new Error('fixture: no scan');
    return bytes.subarray(scanAt);
}

/** The segments a resolution rewrite has no business touching. */
function untouchedSegments(bytes) {
    return walkJpeg(bytes).segments
        .filter((segment) => segment.marker !== MARKER_APP0 && segment.marker !== MARKER_APP1)
        .map((segment) => ({ marker: segment.marker, bytes: Buffer.from(segment.bytes).toString('hex') }));
}

/* -------------------------------------------------- independent PNG walker */

const PNG_SIGNATURE = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];

/**
 * CRC32 the long way round: no lookup table, the polynomial shifted eight times
 * per byte. The module builds the standard 256-entry table instead, so this
 * agrees with it only if both implement the same function.
 */
function crc32(bytes) {
    let crc = 0xFFFFFFFF;
    for (const byte of bytes) {
        crc ^= byte;
        for (let bit = 0; bit < 8; bit += 1) {
            crc = (crc & 1) ? ((crc >>> 1) ^ 0xEDB88320) : (crc >>> 1);
        }
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
}

function walkPng(bytes) {
    for (let index = 0; index < PNG_SIGNATURE.length; index += 1) {
        if (bytes[index] !== PNG_SIGNATURE[index]) throw new Error('fixture: not a PNG');
    }

    const view = viewOf(bytes);
    const chunks = [];
    let at = 8;

    while (at + 8 <= bytes.length) {
        const length = view.getUint32(at);
        const type = latin1(bytes, at + 4, 4);
        const dataAt = at + 8;
        const crcAt = dataAt + length;
        if (crcAt + 4 > bytes.length) throw new Error(`fixture: chunk ${type} runs past the end`);

        chunks.push({
            type,
            at,
            length,
            dataAt,
            crc: view.getUint32(crcAt),
            data: bytes.subarray(dataAt, crcAt),
            bytes: bytes.subarray(at, crcAt + 4),
        });

        at = crcAt + 4;
        if (type === 'IEND') break;
    }

    return chunks;
}

function physOf(bytes) {
    const chunk = walkPng(bytes).find((candidate) => candidate.type === 'pHYs');
    if (!chunk) return null;

    const view = viewOf(bytes);
    return {
        x: view.getUint32(chunk.dataAt),
        y: view.getUint32(chunk.dataAt + 4),
        unit: bytes[chunk.dataAt + 8],
        crc: chunk.crc,
        computedCrc: crc32(bytes.subarray(chunk.at + 4, chunk.dataAt + chunk.length)),
        length: chunk.length,
        index: walkPng(bytes).findIndex((candidate) => candidate.type === 'pHYs'),
    };
}

function chunkNames(bytes) {
    return walkPng(bytes).map((chunk) => chunk.type);
}

function chunksExcept(bytes, type) {
    return walkPng(bytes)
        .filter((chunk) => chunk.type !== type)
        .map((chunk) => ({ type: chunk.type, bytes: Buffer.from(chunk.bytes).toString('hex') }));
}

function withoutChunk(bytes, type) {
    const kept = walkPng(bytes).filter((chunk) => chunk.type !== type);
    const total = kept.reduce((sum, chunk) => sum + chunk.bytes.length, 8);
    const out = new Uint8Array(total);
    out.set(bytes.subarray(0, 8), 0);

    let at = 8;
    for (const chunk of kept) {
        out.set(chunk.bytes, at);
        at += chunk.bytes.length;
    }
    return out;
}

/* ---------------------------------------------------------------- sources */

function flat({ width = 60, height = 40 } = {}) {
    return sharp({ create: { width, height, channels: 3, background: { r: 200, g: 40, b: 80 } } });
}

async function bytesOf(pipeline) {
    return new Uint8Array(await pipeline.toBuffer());
}

/**
 * sharp's JPEG with a density, which is an APP1 Exif block and NO JFIF APP0 —
 * verified by the segment assertions below rather than assumed.
 */
function jpegWithExif(density = 144) {
    return bytesOf(flat().withMetadata({ density }).jpeg());
}

/** sharp's plain JPEG: no APP0, no APP1, nothing that says anything about size. */
function jpegBare() {
    return bytesOf(flat().jpeg());
}

/**
 * A JFIF APP0 built here from the specification and spliced in behind the SOI,
 * because libvips will not write one. 16 is the length word counting itself;
 * version 1.02; a zero-by-zero thumbnail.
 */
function jfifSegment({ units = 1, x = 300, y = 300 } = {}) {
    const segment = new Uint8Array(18);
    const view = new DataView(segment.buffer);
    segment[0] = 0xFF;
    segment[1] = MARKER_APP0;
    view.setUint16(2, 16);
    segment.set([0x4A, 0x46, 0x49, 0x46, 0x00], 4);
    segment[9] = 1;
    segment[10] = 2;
    segment[11] = units;
    view.setUint16(12, x);
    view.setUint16(14, y);
    segment[16] = 0;
    segment[17] = 0;
    return segment;
}

function spliceAfterSoi(bytes, segment) {
    const out = new Uint8Array(bytes.length + segment.length);
    out.set(bytes.subarray(0, 2), 0);
    out.set(segment, 2);
    out.set(bytes.subarray(2), 2 + segment.length);
    return out;
}

async function jpegWithJfif(options) {
    return spliceAfterSoi(await jpegBare(), jfifSegment(options));
}

/**
 * sharp's PNG with a density, which is a pHYs chunk AND an eXIf chunk carrying
 * the same number a second time — the case that caught this module out. libvips
 * reads the eXIf one in preference, so rewriting only pHYs leaves a file that
 * still reports its old resolution.
 */
function pngWithPhys(density = 144) {
    return bytesOf(flat().withMetadata({ density }).png());
}

/** The same file with only the PNG-native field, for the plain single-block case. */
async function pngPhysOnly(density = 144) {
    return withoutChunk(await pngWithPhys(density), 'eXIf');
}

async function pngWithoutPhys() {
    return withoutChunk(await pngWithPhys(), 'pHYs');
}

/** A PNG that says nothing about its size: sharp's default pHYs dropped, no eXIf. */
async function pngBare() {
    return withoutChunk(await bytesOf(flat().png()), 'pHYs');
}

/**
 * 118 dots per centimetre, which is 299.72 and reads as 300 DPI.
 *
 * The number a European scanner writes. Everything else in this suite is already
 * in inches, so nothing here would notice a build that echoed a file's own
 * ResolutionUnit back instead of converting it to the inches this tool promises.
 */
const DOTS_PER_CM = 118;
const CM_UNIT = 3;

/** sharp's EXIF JPEG, re-stated in centimetres. */
async function jpegWithExifInCm() {
    const input = await jpegWithExif(144);
    return patchTiff(input, readExif(input), { value: DOTS_PER_CM, unit: CM_UNIT });
}

/** A PNG whose only resolution is an eXIf block measured in centimetres. */
async function pngWithExifInCm() {
    const input = await pngWithoutPhys();
    const patched = patchTiff(input, readPngExif(input), { value: DOTS_PER_CM, unit: CM_UNIT });

    // The chunk's own bytes changed, so its CRC has to be rebuilt or no reader
    // will look inside it.
    const chunk = readPngExif(patched).chunk;
    viewOf(patched).setUint32(chunk.dataAt + chunk.length,
        crc32(patched.subarray(chunk.at + 4, chunk.dataAt + chunk.length)));

    return patched;
}

function webpBytes() {
    return bytesOf(flat().webp());
}

function gifBytes() {
    return bytesOf(flat().gif());
}

/**
 * The two formats this module has to refuse. Built once, because every refusal
 * assertion wants the same real file rather than a hand-typed header.
 */
let webpSource;
let gifSource;

beforeAll(async () => {
    webpSource = await webpBytes();
    gifSource = await gifBytes();
});

const density = async (bytes) => (await sharp(Buffer.from(bytes)).metadata()).density;
const shape = async (bytes) => {
    const meta = await sharp(Buffer.from(bytes)).metadata();
    return { width: meta.width, height: meta.height };
};
const rawPixels = (bytes) => sharp(Buffer.from(bytes)).raw().toBuffer();

/* ------------------------------------------------------------------ reads */

describe('readResolution', () => {
    it('reads a sharp JPEG density out of EXIF, and agrees with sharp about it', async () => {
        const bytes = await jpegWithExif(144);
        const read = readResolution(bytes);

        expect(read.format).toBe('jpeg');
        expect(read.dpi).toEqual({ x: 144, y: 144 });
        expect(read.source).toBe('exif');
        expect(read.exif).toEqual({ xResolution: 144, yResolution: 144, unit: 2 });
        expect(read.jfif).toBeNull();
        expect(read.phys).toBeNull();

        expect(await density(bytes)).toBe(144);
    });

    it('reads a JFIF APP0 density, in dots per inch', async () => {
        const bytes = await jpegWithJfif({ units: 1, x: 300, y: 300 });
        const read = readResolution(bytes);

        expect(read.jfif).toEqual({ units: 1, xDensity: 300, yDensity: 300 });
        expect(read.dpi).toEqual({ x: 300, y: 300 });
        expect(read.source).toBe('jfif');
        expect(read.exif).toBeNull();

        expect(await density(bytes)).toBe(300);
    });

    it('converts a JFIF density stored in dots per centimetre', async () => {
        const read = readResolution(await jpegWithJfif({ units: 2, x: 118, y: 118 }));

        expect(read.jfif).toEqual({ units: 2, xDensity: 118, yDensity: 118 });
        expect(read.dpi).toEqual({ x: 300, y: 300 });
        expect(read.source).toBe('jfif');
    });

    it('reports no DPI for a JFIF that carries only an aspect ratio', async () => {
        const read = readResolution(await jpegWithJfif({ units: 0, x: 1, y: 1 }));

        expect(read.jfif).toEqual({ units: 0, xDensity: 1, yDensity: 1 });
        expect(read.dpi).toBeNull();
        expect(read.source).toBeNull();
    });

    it('falls back to EXIF when the JFIF block carries only an aspect ratio', async () => {
        const bytes = spliceAfterSoi(await jpegWithExif(200), jfifSegment({ units: 0, x: 1, y: 1 }));
        const read = readResolution(bytes);

        expect(read.dpi).toEqual({ x: 200, y: 200 });
        expect(read.source).toBe('exif');
        expect(read.jfif).not.toBeNull();
    });

    it('returns both blocks when a file carries both, and names JFIF as the source', async () => {
        const bytes = spliceAfterSoi(await jpegWithExif(144), jfifSegment({ units: 1, x: 300, y: 300 }));
        const read = readResolution(bytes);

        expect(read.jfif.xDensity).toBe(300);
        expect(read.exif.xResolution).toBe(144);
        expect(read.source).toBe('jfif');
        expect(read.dpi).toEqual({ x: 300, y: 300 });

        // And the reason both have to be written: libvips reads the other one.
        expect(await density(bytes)).toBe(144);
    });

    it('reports nothing at all for a JPEG that says nothing', async () => {
        const read = readResolution(await jpegBare());

        expect(read.format).toBe('jpeg');
        expect(read.jfif).toBeNull();
        expect(read.exif).toBeNull();
        expect(read.dpi).toBeNull();
        expect(read.source).toBeNull();
    });

    it('reads a PNG pHYs chunk and agrees with sharp about it', async () => {
        const bytes = await pngPhysOnly(144);
        const read = readResolution(bytes);

        expect(read.format).toBe('png');
        expect(read.phys).toEqual({ xPixelsPerUnit: 5669, yPixelsPerUnit: 5669, unit: 1 });
        expect(read.dpi).toEqual({ x: 144, y: 144 });
        expect(read.source).toBe('phys');
        expect(read.jfif).toBeNull();
        expect(read.exif).toBeNull();

        expect(await density(bytes)).toBe(144);
    });

    it('reads the eXIf chunk a PNG can carry alongside pHYs, and names pHYs as the source', async () => {
        const bytes = await pngWithPhys(144);
        const read = readResolution(bytes);

        expect(chunkNames(bytes)).toContain('eXIf');
        expect(read.phys).toEqual({ xPixelsPerUnit: 5669, yPixelsPerUnit: 5669, unit: 1 });
        expect(read.exif).toEqual({ xResolution: 144, yResolution: 144, unit: 2 });
        expect(read.source).toBe('phys');
        expect(read.dpi).toEqual({ x: 144, y: 144 });
    });

    it('falls back to a PNG eXIf block when there is no pHYs chunk', async () => {
        const read = readResolution(await pngWithoutPhys());

        expect(read.phys).toBeNull();
        expect(read.exif).toEqual({ xResolution: 144, yResolution: 144, unit: 2 });
        expect(read.dpi).toEqual({ x: 144, y: 144 });
        expect(read.source).toBe('exif');
    });

    it('reports no DPI for a pHYs whose unit is unknown', async () => {
        const withUnknownUnit = await pngPhysOnly(144);
        const chunk = walkPng(withUnknownUnit).find((candidate) => candidate.type === 'pHYs');
        const patched = Uint8Array.from(withUnknownUnit);
        patched[chunk.dataAt + 8] = 0;
        const view = viewOf(patched);
        view.setUint32(chunk.dataAt + chunk.length, crc32(patched.subarray(chunk.at + 4, chunk.dataAt + chunk.length)));

        const read = readResolution(patched);
        expect(read.phys).toEqual({ xPixelsPerUnit: 5669, yPixelsPerUnit: 5669, unit: 0 });
        expect(read.dpi).toBeNull();
        expect(read.source).toBeNull();
    });

    it('reports nothing at all for a PNG that carries neither block', async () => {
        const read = readResolution(await pngBare());

        expect(read.format).toBe('png');
        expect(read.phys).toBeNull();
        expect(read.exif).toBeNull();
        expect(read.dpi).toBeNull();
        expect(read.source).toBeNull();
    });

    it('refuses a WebP, which has no density field to read', () => {
        const error = refusal(() => readResolution(webpSource));
        expect(error.code).toBe('unsupported-format');
        expect(error.suggestion).toBeTruthy();
    });

    it('refuses a GIF, and anything that is not an image at all', () => {
        expect(refusal(() => readResolution(gifSource)).code).toBe('unsupported-format');
        expect(refusal(() => readResolution(new Uint8Array(0))).code).toBe('unsupported-format');
        expect(refusal(() => readResolution(new Uint8Array([1, 2, 3, 4]))).code).toBe('unsupported-format');
        expect(refusal(() => readResolution(null)).code).toBe('unsupported-format');
    });
});

/* --------------------------------------------------------------- JPEG writes */

describe('writeResolution, JPEG', () => {
    it('inserts a JFIF header and rewrites the EXIF resolution in place', async () => {
        const input = await jpegWithExif(144);
        const { bytes, changed, inserted } = writeResolution(input, 300);

        expect(inserted).toBe(true);
        expect(changed).toContain('jfif');
        expect(changed).toContain('exif');

        // The value the world reads back, from the independent opinion.
        expect(await density(bytes)).toBe(300);

        const jfif = readJfif(bytes);
        expect(jfif).toMatchObject({ units: 1, x: 300, y: 300, version: [1, 2], segmentLength: 18 });
        expect(jfif.segmentAt).toBe(2);

        const exif = readExif(bytes);
        expect(exif.x).toMatchObject({ numerator: 300, denominator: 1 });
        expect(exif.y).toMatchObject({ numerator: 300, denominator: 1 });
        expect(exif.unit.value).toBe(2);
    });

    it('never grows or moves the EXIF block, and changes nothing in it but the three fields', async () => {
        const input = await jpegWithExif(144);
        const before = readExif(input);
        const { bytes } = writeResolution(input, 600);
        const after = readExif(bytes);

        expect(after.segmentLength).toBe(before.segmentLength);
        // Moved by exactly the inserted JFIF segment and not one byte more.
        expect(after.segmentAt).toBe(before.segmentAt + 18);

        const original = Buffer.from(input.subarray(before.segmentAt, before.segmentAt + before.segmentLength));
        const written = Buffer.from(bytes.subarray(after.segmentAt, after.segmentAt + after.segmentLength));

        // Blank the fields that were supposed to change; everything else — the
        // thumbnail pointer, the Exif sub-IFD offset, the orientation tag —
        // has to match to the byte.
        for (const [source, block, base] of [[before, original, before.segmentAt], [after, written, after.segmentAt]]) {
            block.fill(0, source.x.at - base, source.x.at - base + 8);
            block.fill(0, source.y.at - base, source.y.at - base + 8);
            block.fill(0, source.unit.at - base, source.unit.at - base + 2);
        }

        expect(written.equals(original)).toBe(true);
    });

    it('copies the compressed scan and every other segment byte for byte', async () => {
        const input = await jpegWithExif(144);
        const { bytes } = writeResolution(input, 300);

        expect(Buffer.from(scanTail(bytes)).equals(Buffer.from(scanTail(input)))).toBe(true);
        expect(untouchedSegments(bytes)).toEqual(untouchedSegments(input));

        expect(await shape(bytes)).toEqual(await shape(input));
        expect((await rawPixels(bytes)).equals(await rawPixels(input))).toBe(true);
    });

    it('updates a JFIF header that is already there, in place', async () => {
        const input = await jpegWithJfif({ units: 1, x: 72, y: 72 });
        const { bytes, changed, inserted } = writeResolution(input, 300);

        expect(inserted).toBe(false);
        expect(changed).toEqual(['jfif']);
        expect(bytes.length).toBe(input.length);
        expect(readJfif(bytes)).toMatchObject({ units: 1, x: 300, y: 300, segmentLength: 18 });
        expect(await density(bytes)).toBe(300);

        expect(Buffer.from(scanTail(bytes)).equals(Buffer.from(scanTail(input)))).toBe(true);
        expect(untouchedSegments(bytes)).toEqual(untouchedSegments(input));
    });

    it('forces a centimetre-based JFIF header on to inches', async () => {
        const input = await jpegWithJfif({ units: 2, x: 118, y: 118 });
        const { bytes } = writeResolution(input, 300);

        expect(readJfif(bytes)).toMatchObject({ units: 1, x: 300, y: 300 });
        expect(readResolution(bytes).dpi).toEqual({ x: 300, y: 300 });
    });

    it('inserts a whole JFIF header into a JPEG that has neither block', async () => {
        const input = await jpegBare();
        const { bytes, changed, inserted } = writeResolution(input, 300);

        expect(inserted).toBe(true);
        expect(changed).toEqual(['jfif']);
        expect(bytes.length).toBe(input.length + 18);

        expect(readJfif(bytes)).toEqual({
            version: [1, 2],
            units: 1,
            x: 300,
            y: 300,
            thumbnail: [0, 0],
            segmentLength: 18,
            segmentAt: 2,
        });
        expect(readExif(bytes)).toBeNull();

        expect(await density(bytes)).toBe(300);
        expect(Buffer.from(scanTail(bytes)).equals(Buffer.from(scanTail(input)))).toBe(true);
        expect(untouchedSegments(bytes)).toEqual(untouchedSegments(input));
        expect((await rawPixels(bytes)).equals(await rawPixels(input))).toBe(true);
    });

    it('reads back exactly what it wrote', async () => {
        const { bytes } = writeResolution(await jpegWithExif(144), 240);
        const read = readResolution(bytes);

        expect(read.dpi).toEqual({ x: 240, y: 240 });
        expect(read.source).toBe('jfif');
        expect(read.jfif).toEqual({ units: 1, xDensity: 240, yDensity: 240 });
        expect(read.exif).toEqual({ xResolution: 240, yResolution: 240, unit: 2 });
    });

    /**
     * The centimetre case, in the block that is hardest to see.
     *
     * A JPEG measured in centimetres must come out measured in inches, because
     * the number a person typed is a DPI and the file has to say so. Echoing the
     * file's own ResolutionUnit back would leave 300 sitting under a unit of 3,
     * which every reader would report as 762 DPI.
     */
    it('converts an EXIF block measured in centimetres, on the way in and out', async () => {
        const input = await jpegWithExifInCm();

        expect(readExif(input).unit.value).toBe(CM_UNIT);
        const before = readResolution(input);
        expect(before.exif).toEqual({ xResolution: DOTS_PER_CM, yResolution: DOTS_PER_CM, unit: CM_UNIT });
        expect(before.dpi).toEqual({ x: 300, y: 300 });
        expect(before.source).toBe('exif');

        const { bytes, changed } = writeResolution(input, 300);
        expect(changed).toContain('exif');

        // This suite's own parser, on the bytes.
        const written = readExif(bytes);
        expect(written.unit.value).toBe(2);
        expect(written.x).toMatchObject({ numerator: 300, denominator: 1 });
        expect(written.y).toMatchObject({ numerator: 300, denominator: 1 });

        const after = readResolution(bytes);
        expect(after.dpi).toEqual({ x: 300, y: 300 });
        expect(after.exif).toEqual({ xResolution: 300, yResolution: 300, unit: 2 });

        // And the independent opinion, which reads EXIF ahead of the JFIF header
        // and would report 762 if the unit had been left in centimetres.
        expect(await density(bytes)).toBe(300);
    });
});

/* ---------------------------------------------------------------- PNG writes */

describe('writeResolution, PNG', () => {
    it('replaces an existing pHYs chunk and leaves every other chunk alone', async () => {
        const input = await pngPhysOnly(144);
        const { bytes, changed, inserted } = writeResolution(input, 300);

        expect(inserted).toBe(false);
        expect(changed).toEqual(['phys']);
        expect(bytes.length).toBe(input.length);

        const phys = physOf(bytes);
        expect(phys.x).toBe(Math.round(300 / 0.0254));
        expect(phys.y).toBe(Math.round(300 / 0.0254));
        expect(phys.unit).toBe(1);
        expect(phys.crc).toBe(phys.computedCrc);

        expect(chunkNames(bytes)).toEqual(chunkNames(input));
        expect(chunksExcept(bytes, 'pHYs')).toEqual(chunksExcept(input, 'pHYs'));

        expect(await density(bytes)).toBe(300);
        expect(await shape(bytes)).toEqual(await shape(input));
        expect((await rawPixels(bytes)).equals(await rawPixels(input))).toBe(true);
    });

    /**
     * The regression this module was rewritten for. A pHYs-only rewrite left the
     * eXIf chunk saying 144, and libvips reads eXIf first — so sharp reported the
     * file as unchanged. Both blocks, or the tool half works.
     */
    it('rewrites the eXIf chunk beside pHYs, so no stale resolution survives', async () => {
        const input = await pngWithPhys(144);
        expect(chunkNames(input)).toContain('eXIf');

        const { bytes, changed, inserted } = writeResolution(input, 300);

        expect(inserted).toBe(false);
        expect(changed).toEqual(['phys', 'exif']);
        expect(bytes.length).toBe(input.length);
        expect(chunkNames(bytes)).toEqual(chunkNames(input));

        const read = readResolution(bytes);
        expect(read.phys).toEqual({ xPixelsPerUnit: 11811, yPixelsPerUnit: 11811, unit: 1 });
        expect(read.exif).toEqual({ xResolution: 300, yResolution: 300, unit: 2 });

        // The independent opinion, which reads the block pHYs alone would not fix.
        expect(await density(bytes)).toBe(300);

        // The rewritten chunk still has to verify, and nothing else may move.
        const written = walkPng(bytes).find((chunk) => chunk.type === 'eXIf');
        expect(written.crc).toBe(crc32(bytes.subarray(written.at + 4, written.dataAt + written.length)));
        expect(written.length).toBe(walkPng(input).find((chunk) => chunk.type === 'eXIf').length);

        expect(chunksExcept(withoutChunk(bytes, 'eXIf'), 'pHYs'))
            .toEqual(chunksExcept(withoutChunk(input, 'eXIf'), 'pHYs'));
        expect((await rawPixels(bytes)).equals(await rawPixels(input))).toBe(true);
    });

    it('inserts a pHYs directly after IHDR when there is none, ahead of the first IDAT', async () => {
        const input = await pngWithoutPhys();
        expect(chunkNames(input)).not.toContain('pHYs');

        const { bytes, changed, inserted } = writeResolution(input, 300);

        expect(inserted).toBe(true);
        expect(changed).toEqual(['phys', 'exif']);
        expect(bytes.length).toBe(input.length + 21);

        const names = chunkNames(bytes);
        expect(names[0]).toBe('IHDR');
        expect(names[1]).toBe('pHYs');
        expect(names.indexOf('pHYs')).toBeLessThan(names.indexOf('IDAT'));

        const phys = physOf(bytes);
        expect(phys).toMatchObject({ x: 11811, y: 11811, unit: 1, length: 9 });
        expect(phys.crc).toBe(phys.computedCrc);

        expect(await density(bytes)).toBe(300);
        expect((await rawPixels(bytes)).equals(await rawPixels(input))).toBe(true);
    });

    it('writes the density a file already has as the identical file', async () => {
        const input = await pngPhysOnly(144);
        const { bytes } = writeResolution(input, 144);

        expect(Buffer.from(bytes).equals(Buffer.from(input))).toBe(true);
    });

    it('reads back exactly what it wrote', async () => {
        const { bytes } = writeResolution(await pngBare(), 96);
        const read = readResolution(bytes);

        expect(read.dpi).toEqual({ x: 96, y: 96 });
        expect(read.source).toBe('phys');
        expect(read.phys).toEqual({ xPixelsPerUnit: 3780, yPixelsPerUnit: 3780, unit: 1 });
        expect(read.exif).toBeNull();
    });

    /** The same centimetre trap, in the TIFF block a PNG carries. */
    it('converts an eXIf block measured in centimetres, on the way in and out', async () => {
        const input = await pngWithExifInCm();

        expect(readPngExif(input).unit.value).toBe(CM_UNIT);
        const before = readResolution(input);
        expect(before.phys).toBeNull();
        expect(before.exif).toEqual({ xResolution: DOTS_PER_CM, yResolution: DOTS_PER_CM, unit: CM_UNIT });
        expect(before.dpi).toEqual({ x: 300, y: 300 });
        expect(before.source).toBe('exif');

        const { bytes, changed } = writeResolution(input, 300);
        expect(changed).toEqual(['phys', 'exif']);

        const written = readPngExif(bytes);
        expect(written.unit.value).toBe(2);
        expect(written.x).toMatchObject({ numerator: 300, denominator: 1 });
        expect(written.crc ?? written.chunk.crc)
            .toBe(crc32(bytes.subarray(written.chunk.at + 4, written.chunk.dataAt + written.chunk.length)));

        const after = readResolution(bytes);
        expect(after.dpi).toEqual({ x: 300, y: 300 });
        expect(after.exif).toEqual({ xResolution: 300, yResolution: 300, unit: 2 });

        expect(await density(bytes)).toBe(300);
    });
});

/* --------------------------------------------------------------- the bounds */

describe('the DPI a caller may ask for', () => {
    it('round-trips the lowest and the highest allowed value, in both formats', async () => {
        expect(MIN_DPI).toBe(1);
        expect(MAX_DPI).toBe(10000);

        for (const dpi of [MIN_DPI, MAX_DPI]) {
            const jpeg = writeResolution(await jpegWithExif(144), dpi).bytes;
            expect(readResolution(jpeg).dpi).toEqual({ x: dpi, y: dpi });
            expect(readJfif(jpeg)).toMatchObject({ units: 1, x: dpi, y: dpi });
            expect(readExif(jpeg).x).toMatchObject({ numerator: dpi, denominator: 1 });

            const png = writeResolution(await pngWithPhys(144), dpi).bytes;
            expect(readResolution(png).dpi).toEqual({ x: dpi, y: dpi });
            expect(physOf(png).crc).toBe(physOf(png).computedCrc);
        }

        // libvips discards a resolution it considers implausible and reports its
        // own 72 DPI default, so the low boundary is only checkable in the bytes.
        expect(await density(writeResolution(await jpegWithExif(144), MAX_DPI).bytes)).toBe(MAX_DPI);
    });

    it('refuses anything that is not a whole number in range, and writes nothing', async () => {
        const input = await jpegWithExif(144);

        for (const bad of [0, -1, MAX_DPI + 1, 300.5, '300.5', 'abc', '', null, undefined, NaN, Infinity, {}]) {
            const error = refusal(() => writeResolution(input, bad));
            expect(error.code).toBe('invalid-dpi');
            expect(error.suggestion).toBeTruthy();
            expect(error.message).toContain(String(MAX_DPI));
        }
    });

    it('takes a whole number written as a string', async () => {
        const { bytes } = writeResolution(await pngWithPhys(144), '300');
        expect(readResolution(bytes).dpi).toEqual({ x: 300, y: 300 });
    });

    it('refuses a format that has nowhere to put a density', async () => {
        expect(refusal(() => writeResolution(webpSource, 300)).code).toBe('unsupported-format');
        expect(refusal(() => writeResolution(gifSource, 300)).code).toBe('unsupported-format');
    });
});

/* ------------------------------------------------------------ broken files */

describe('files that cannot be rewritten', () => {
    it('refuses a JPEG whose segment length runs past the end of the file', async () => {
        const input = await jpegWithExif(144);
        // Inside the APP2 ICC segment sharp writes after the Exif block: the
        // walker meets a declared length with nothing behind it.
        const truncated = input.subarray(0, 400);

        const error = refusal(() => writeResolution(truncated, 300));
        expect(error.code).toBe('invalid-file');
        expect(error.suggestion).toBeTruthy();
    });

    it('refuses a JPEG with no start of scan', async () => {
        const input = await jpegWithExif(144);
        const { scanAt } = walkJpeg(input);
        const headerOnly = input.subarray(0, scanAt);

        expect(refusal(() => writeResolution(headerOnly, 300)).code).toBe('invalid-file');
    });

    it('refuses a JPEG whose declared segment length is a lie', async () => {
        const input = Uint8Array.from(await jpegWithExif(144));
        const { segments } = walkJpeg(input);
        const app1 = segments.find((segment) => segment.marker === MARKER_APP1);
        viewOf(input).setUint16(app1.at + 2, 0xFFFF);

        expect(refusal(() => writeResolution(input, 300)).code).toBe('invalid-file');
    });

    it('refuses a JPEG whose segment length is smaller than the length word', async () => {
        const input = Uint8Array.from(await jpegWithExif(144));
        const { segments } = walkJpeg(input);
        viewOf(input).setUint16(segments[0].at + 2, 1);

        expect(refusal(() => writeResolution(input, 300)).code).toBe('invalid-file');
    });

    it('refuses a PNG truncated inside a chunk', async () => {
        const input = await pngWithPhys(144);
        const truncated = input.subarray(0, input.length - 20);

        const error = refusal(() => writeResolution(truncated, 300));
        expect(error.code).toBe('invalid-file');
        expect(error.suggestion).toBeTruthy();
    });

    it('refuses a PNG whose first chunk is not IHDR', async () => {
        const input = Uint8Array.from(await pngWithPhys(144));
        input.set([0x49, 0x48, 0x44, 0x52 ^ 0x20], 12);

        expect(refusal(() => writeResolution(input, 300)).code).toBe('invalid-file');
    });

    it('refuses a PNG whose declared chunk length runs past the end', async () => {
        const input = Uint8Array.from(await pngWithPhys(144));
        const idat = walkPng(input).find((chunk) => chunk.type === 'IDAT');
        viewOf(input).setUint32(idat.at, 0x7FFFFFFF);

        expect(refusal(() => writeResolution(input, 300)).code).toBe('invalid-file');
    });
});

/* ------------------------------------------------------------------- the op */

describe('runDpi', () => {
    function context(bytes, { name = 'photo.jpg', type = 'image/jpeg', options = { dpi: 300 } } = {}) {
        return {
            file: new File([bytes], name, { type }),
            name,
            options,
            sourceFormat: type === 'image/png' ? 'png' : 'jpeg',
            sourceWidth: 60,
            sourceHeight: 40,
            report: vi.fn(),
            guard: vi.fn(),
        };
    }

    it('returns the result shape the worker puts on the wire, for a JPEG', async () => {
        const input = await jpegWithExif(144);
        const job = context(input);
        const result = await runDpi(job);

        expect(result.format).toBe('jpeg');
        expect(result.type).toBe('image/jpeg');
        expect(result.width).toBe(60);
        expect(result.height).toBe(40);
        expect(result.inserted).toBe(true);
        expect(result.changed).toEqual(expect.arrayContaining(['jfif', 'exif']));
        expect(result.dpi.before.dpi).toEqual({ x: 144, y: 144 });
        expect(result.dpi.after.dpi).toEqual({ x: 300, y: 300 });

        expect(result.blob).toBeInstanceOf(Blob);
        expect(result.blob.type).toBe('image/jpeg');
        expect(result.bytes).toBe(result.blob.size);

        const out = new Uint8Array(await result.blob.arrayBuffer());
        expect(Buffer.from(out).equals(Buffer.from(writeResolution(input, 300).bytes))).toBe(true);
        expect(await density(out)).toBe(300);
    });

    it('returns the same shape for a PNG', async () => {
        const input = await pngWithoutPhys();
        const result = await runDpi(context(input, { name: 'chart.png', type: 'image/png' }));

        expect(result.format).toBe('png');
        expect(result.type).toBe('image/png');
        expect(result.inserted).toBe(true);
        expect(result.changed).toEqual(['phys', 'exif']);
        expect(result.dpi.before.dpi).toEqual({ x: 144, y: 144 });
        expect(result.dpi.after.dpi).toEqual({ x: 300, y: 300 });
        expect(await density(new Uint8Array(await result.blob.arrayBuffer()))).toBe(300);
    });

    it('bookends the work with progress and a cancellation check', async () => {
        const job = context(await jpegWithExif(144));
        await runDpi(job);

        expect(job.report.mock.calls.map(([percent]) => percent)).toEqual([5, 95]);
        expect(job.guard.mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    it('stops on a cancelled job before it reads a byte', async () => {
        const job = context(await jpegWithExif(144));
        job.guard = vi.fn(() => { throw new Error('cancelled'); });

        await expect(runDpi(job)).rejects.toThrow('cancelled');
    });

    it('refuses an option that is not a whole DPI', async () => {
        for (const dpi of ['abc', '300.5', '0', String(MAX_DPI + 1), undefined]) {
            const error = await asyncRefusal(runDpi(context(await jpegBare(), { options: { dpi } })));
            expect(error.code).toBe('invalid-dpi');
        }
    });

    it('refuses a file whose format carries no density', async () => {
        const error = await asyncRefusal(runDpi(context(webpSource, { name: 'a.webp', type: 'image/webp' })));
        expect(error.code).toBe('unsupported-format');
        expect(error.suggestion).toBeTruthy();
    });

    it('refuses a damaged file without producing anything', async () => {
        const input = (await pngWithPhys(144)).subarray(0, 40);
        const error = await asyncRefusal(runDpi(context(input, { name: 'a.png', type: 'image/png' })));
        expect(error.code).toBe('invalid-file');
    });
});
