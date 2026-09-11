/**
 * The TIFF directory inside an Exif block, read as untrusted input.
 *
 * WHAT THIS IS FOR. /image-metadata-viewer shows a visitor what their own photo
 * is carrying. Nothing here is written back, nothing is decoded, and the file is
 * never modified — this reader exists so a person can SEE the camera, the
 * timestamp and the coordinates before deciding whether to strip them.
 *
 * EVERY BYTE IT READS CAME FROM A STRANGER'S FILE, and a metadata parser is a
 * classic place to be attacked because the format is a graph of offsets: a
 * 32-bit pointer at the front of a 12-byte entry, pointing anywhere the writer
 * likes. So four rules hold, and each one has a test that fails without it:
 *
 *   BOUNDED. Every offset is resolved against [tiffStart, end) — the END OF THE
 *            BLOCK, not the end of the file. A JPEG keeps its Exif in an APP1
 *            segment with the picture immediately behind it, so a value allowed
 *            to run past the segment would print entropy-coded data, or a
 *            trailing second image's coordinates, as a camera model.
 *   CAPPED.  512 entries per directory, 4,096 characters of text, 64 numbers,
 *            16 rationals. A count word is two bytes and costs a writer nothing;
 *            60,000 of them cost the reader everything.
 *   SHALLOW. IFD0 leads to the Exif IFD and the GPS IFD and stops. The
 *            interoperability IFD is not followed, IFD1 is counted and not read,
 *            and there is no recursion anywhere, so a directory pointing at
 *            itself is a bounded read rather than a hung tab.
 *   QUIET.   Nothing throws. A malformed anything costs one sentence in
 *            `problems` and the rest of the report still stands, because a
 *            person whose photo has one broken tag should still be told where it
 *            was taken.
 *
 * BINARY IS NEVER RETURNED. An UNDEFINED value comes back as `{ bytes: n }`, not
 * as its content: the one exception is UserComment, which is text behind an
 * eight-byte charset header and is the only place a camera puts a sentence.
 * Everything a page renders from here is a string or a number.
 *
 * Imports nothing. Plain arithmetic over bytes, so it costs a page nothing to
 * call on the main thread the moment a file is dropped.
 */

/* ------------------------------------------------------------------ caps */

/** A directory longer than this is a claim, not a camera. */
const MAX_ENTRIES_PER_IFD = 512;

/** Characters of one text value. A camera model is 20; 4,096 is generous. */
const MAX_TEXT_CHARS = 4096;

/** Values of one numeric list, and of one rational list. */
const MAX_NUMERIC_VALUES = 64;
const MAX_RATIONAL_VALUES = 16;

/* ----------------------------------------------------------------- types */

const TYPE_BYTE = 1;
const TYPE_ASCII = 2;
const TYPE_SHORT = 3;
const TYPE_LONG = 4;
const TYPE_RATIONAL = 5;
const TYPE_SBYTE = 6;
const TYPE_UNDEFINED = 7;
const TYPE_SSHORT = 8;
const TYPE_SLONG = 9;
const TYPE_SRATIONAL = 10;
const TYPE_FLOAT = 11;
const TYPE_DOUBLE = 12;

/** How many bytes one value of each type occupies. An unknown type is skipped. */
const TYPE_SIZES = new Map([
    [TYPE_BYTE, 1], [TYPE_ASCII, 1], [TYPE_SHORT, 2], [TYPE_LONG, 4], [TYPE_RATIONAL, 8],
    [TYPE_SBYTE, 1], [TYPE_UNDEFINED, 1], [TYPE_SSHORT, 2], [TYPE_SLONG, 4],
    [TYPE_SRATIONAL, 8], [TYPE_FLOAT, 4], [TYPE_DOUBLE, 8],
]);

const IFD_ENTRY_LENGTH = 12;
const TIFF_MAGIC = 42;
const VALUE_SLOT_BYTES = 4;

const EXIF_IFD_POINTER = 0x8769;
const GPS_IFD_POINTER = 0x8825;
const USER_COMMENT = 0x9286;

/* ----------------------------------------------------------------- names */

/**
 * The tags this site is willing to name, and nothing else.
 *
 * A CURATED TABLE RATHER THAN AN EXHAUSTIVE ONE. Cameras write hundreds of
 * private tags — a maker note is a whole nested format of its own — and naming
 * them would mean shipping a dictionary bigger than this module for values a
 * visitor cannot act on. Anything not here keeps `name: null` and is shown as
 * its hex tag in the full-field list, which is honest: the reader saw an entry
 * and does not claim to know what it means.
 */
const IFD0_NAMES = new Map([
    [0x010E, 'ImageDescription'], [0x010F, 'Make'], [0x0110, 'Model'],
    [0x0112, 'Orientation'], [0x011A, 'XResolution'], [0x011B, 'YResolution'],
    [0x0128, 'ResolutionUnit'], [0x0131, 'Software'], [0x0132, 'DateTime'],
    [0x013B, 'Artist'], [0x013C, 'HostComputer'], [0x0213, 'YCbCrPositioning'],
    [0x8298, 'Copyright'], [EXIF_IFD_POINTER, 'ExifIFDPointer'],
    [GPS_IFD_POINTER, 'GPSInfoIFDPointer'],
]);

const EXIF_NAMES = new Map([
    [0x829A, 'ExposureTime'], [0x829D, 'FNumber'], [0x8822, 'ExposureProgram'],
    [0x8827, 'ISOSpeedRatings'], [0x9000, 'ExifVersion'], [0x9003, 'DateTimeOriginal'],
    [0x9004, 'DateTimeDigitized'], [0x9010, 'OffsetTime'], [0x9011, 'OffsetTimeOriginal'],
    [0x9012, 'OffsetTimeDigitized'], [0x9201, 'ShutterSpeedValue'], [0x9202, 'ApertureValue'],
    [0x9203, 'BrightnessValue'], [0x9204, 'ExposureBiasValue'], [0x9205, 'MaxApertureValue'],
    [0x9207, 'MeteringMode'], [0x9208, 'LightSource'], [0x9209, 'Flash'],
    [0x920A, 'FocalLength'], [USER_COMMENT, 'UserComment'], [0x9290, 'SubSecTime'],
    [0x9291, 'SubSecTimeOriginal'], [0x9292, 'SubSecTimeDigitized'], [0xA001, 'ColorSpace'],
    [0xA002, 'PixelXDimension'], [0xA003, 'PixelYDimension'], [0xA217, 'SensingMethod'],
    [0xA301, 'SceneType'], [0xA402, 'ExposureMode'], [0xA403, 'WhiteBalance'],
    [0xA404, 'DigitalZoomRatio'], [0xA405, 'FocalLengthIn35mmFilm'], [0xA406, 'SceneCaptureType'],
    [0xA420, 'ImageUniqueID'], [0xA430, 'CameraOwnerName'], [0xA431, 'BodySerialNumber'],
    [0xA432, 'LensSpecification'], [0xA433, 'LensMake'], [0xA434, 'LensModel'],
    [0xA435, 'LensSerialNumber'],
]);

const GPS_NAMES = new Map([
    [0x0000, 'GPSVersionID'], [0x0001, 'GPSLatitudeRef'], [0x0002, 'GPSLatitude'],
    [0x0003, 'GPSLongitudeRef'], [0x0004, 'GPSLongitude'], [0x0005, 'GPSAltitudeRef'],
    [0x0006, 'GPSAltitude'], [0x0007, 'GPSTimeStamp'], [0x0008, 'GPSSatellites'],
    [0x0009, 'GPSStatus'], [0x000A, 'GPSMeasureMode'], [0x000B, 'GPSDOP'],
    [0x000C, 'GPSSpeedRef'], [0x000D, 'GPSSpeed'], [0x000E, 'GPSTrackRef'],
    [0x000F, 'GPSTrack'], [0x0010, 'GPSImgDirectionRef'], [0x0011, 'GPSImgDirection'],
    [0x0012, 'GPSMapDatum'], [0x0017, 'GPSDestBearingRef'], [0x0018, 'GPSDestBearing'],
    [0x001B, 'GPSProcessingMethod'], [0x001D, 'GPSDateStamp'], [0x001F, 'GPSHPositioningError'],
]);

/* ------------------------------------------------------------- sentences */

const PROBLEM_NOT_TIFF = 'The EXIF block does not start with a readable TIFF header.';
const PROBLEM_DIRECTORY = 'An EXIF directory pointed outside the block and was skipped.';
const PROBLEM_TOO_MANY = 'An EXIF directory claimed more entries than this reader will follow.';
const PROBLEM_ENTRY = 'Some EXIF entries ran past the end of the block and were skipped.';
const PROBLEM_VALUE = 'Some EXIF values pointed outside the block and were skipped.';
const PROBLEM_TYPE = 'Some EXIF entries used a value type this reader does not know.';

/* --------------------------------------------------------------- reading */

function toBytes(value) {
    if (value instanceof Uint8Array) return value;
    if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    return null;
}

function emptyResult(problems) {
    return {
        ok: false,
        byteOrder: null,
        ifd0: [],
        exif: [],
        gps: [],
        interop: null,
        ifd1: { present: false, entries: 0 },
        problems,
    };
}

/**
 * Everything the walk needs, resolved once: the bytes, the two bounds, the byte
 * order's readers and a problem list that never says the same thing twice.
 *
 * De-duplicating is not cosmetic. A file with 300 broken entries would
 * otherwise hand a page 300 identical sentences to render.
 */
function context(bytes, tiffStart, end, problems) {
    const little = bytes[tiffStart] === 0x49 && bytes[tiffStart + 1] === 0x49;

    const u16 = (at) => (little
        ? bytes[at] + bytes[at + 1] * 256
        : bytes[at] * 256 + bytes[at + 1]);
    // Multiplication rather than shifts: `<< 24` comes back negative above 2 GB,
    // and a negative offset passes a `> end` bounds check.
    const u32 = (at) => (little
        ? bytes[at] + bytes[at + 1] * 256 + bytes[at + 2] * 65536 + bytes[at + 3] * 16777216
        : bytes[at] * 16777216 + bytes[at + 1] * 65536 + bytes[at + 2] * 256 + bytes[at + 3]);

    return {
        bytes,
        tiffStart,
        end,
        little,
        u16,
        u32,
        note(message) {
            if (!problems.includes(message)) problems.push(message);
        },
    };
}

function signed(value, bits) {
    const limit = 2 ** (bits - 1);
    return value >= limit ? value - 2 ** bits : value;
}

function readNumber(ctx, type, at) {
    if (type === TYPE_BYTE || type === TYPE_UNDEFINED) return ctx.bytes[at];
    if (type === TYPE_SBYTE) return signed(ctx.bytes[at], 8);
    if (type === TYPE_SHORT) return ctx.u16(at);
    if (type === TYPE_SSHORT) return signed(ctx.u16(at), 16);
    if (type === TYPE_LONG) return ctx.u32(at);
    if (type === TYPE_SLONG) return signed(ctx.u32(at), 32);

    const view = new DataView(ctx.bytes.buffer, ctx.bytes.byteOffset, ctx.bytes.byteLength);
    if (type === TYPE_FLOAT) return view.getFloat32(at, ctx.little);
    return view.getFloat64(at, ctx.little);
}

function readRational(ctx, type, at) {
    const numerator = ctx.u32(at);
    const denominator = ctx.u32(at + 4);

    return type === TYPE_SRATIONAL
        ? { numerator: signed(numerator, 32), denominator: signed(denominator, 32) }
        : { numerator, denominator };
}

/**
 * A NUL-terminated string, decoded as UTF-8.
 *
 * The specification says ASCII and cameras write UTF-8 anyway — a Japanese lens
 * name, a photographer's name with an accent — so a Latin-1 read would garble
 * exactly the values a person most wants to recognise. TextDecoder never throws
 * on bad input; it substitutes, which is the right answer for a report.
 */
function readText(ctx, at, count) {
    const limit = Math.min(at + count, ctx.end);

    let stop = limit;
    for (let index = at; index < limit; index += 1) {
        if (ctx.bytes[index] === 0) {
            stop = index;
            break;
        }
    }

    // Four bytes per character is the widest UTF-8 sequence, so this cannot cut
    // a string that would have fitted inside the character cap.
    const capped = Math.min(stop, at + MAX_TEXT_CHARS * 4);
    const text = new TextDecoder('utf-8').decode(ctx.bytes.subarray(at, capped));

    return text.length > MAX_TEXT_CHARS
        ? { value: text.slice(0, MAX_TEXT_CHARS), truncated: true }
        : { value: text, truncated: false };
}

function readUtf16(ctx, at, length) {
    let out = '';
    for (let index = 0; index + 1 < length; index += 2) {
        const unit = ctx.little
            ? ctx.bytes[at + index] + ctx.bytes[at + index + 1] * 256
            : ctx.bytes[at + index] * 256 + ctx.bytes[at + index + 1];
        if (unit === 0) break;
        if (out.length >= MAX_TEXT_CHARS) return { value: out, truncated: true };
        out += String.fromCharCode(unit);
    }
    return { value: out, truncated: false };
}

/**
 * UserComment: eight bytes naming a character set, then the comment.
 *
 * Only ASCII and UNICODE are decoded. JIS and an all-zero header mean bytes this
 * module has no encoding for, and guessing at them would put mojibake — or
 * somebody's binary — on a page. Those come back as a size, like any other
 * UNDEFINED value.
 */
function readUserComment(ctx, at, count) {
    const size = { bytes: count };
    if (count <= 8) return { value: size, truncated: false };

    let charset = '';
    for (let index = at; index < at + 8; index += 1) {
        charset += String.fromCharCode(ctx.bytes[index]);
    }

    const start = at + 8;
    const length = Math.min(count - 8, ctx.end - start);
    if (length <= 0) return { value: size, truncated: false };

    if (charset.startsWith('ASCII')) return readText(ctx, start, length);
    if (charset.startsWith('UNICODE')) return readUtf16(ctx, start, length);
    return { value: size, truncated: false };
}

function readValue(ctx, tag, type, count, at) {
    if (type === TYPE_ASCII) return readText(ctx, at, count);

    if (type === TYPE_UNDEFINED) {
        if (tag === USER_COMMENT) return readUserComment(ctx, at, count);
        return { value: { bytes: count }, truncated: false };
    }

    if (count === 0) return { value: null, truncated: false };

    const rational = type === TYPE_RATIONAL || type === TYPE_SRATIONAL;
    const cap = rational ? MAX_RATIONAL_VALUES : MAX_NUMERIC_VALUES;
    const size = TYPE_SIZES.get(type);
    const kept = Math.min(count, cap);

    const values = [];
    for (let index = 0; index < kept; index += 1) {
        const valueAt = at + index * size;
        values.push(rational
            ? readRational(ctx, type, valueAt)
            : readNumber(ctx, type, valueAt));
    }

    return { value: count === 1 ? values[0] : values, truncated: count > kept };
}

function readEntry(ctx, at, names) {
    const tag = ctx.u16(at);
    const type = ctx.u16(at + 2);
    const count = ctx.u32(at + 4);

    const size = TYPE_SIZES.get(type);
    if (size === undefined) {
        ctx.note(PROBLEM_TYPE);
        return null;
    }

    const total = size * count;
    let valueAt = at + 8;

    // Four bytes or fewer live in the entry itself; anything larger is a
    // pointer, relative to the TIFF header and not to the file.
    if (total > VALUE_SLOT_BYTES) {
        valueAt = ctx.tiffStart + ctx.u32(at + 8);
        if (valueAt < ctx.tiffStart || valueAt + total > ctx.end) {
            ctx.note(PROBLEM_VALUE);
            return null;
        }
    }

    const { value, truncated } = readValue(ctx, tag, type, count, valueAt);

    return {
        tag, name: names.get(tag) ?? null, type, count, value, truncated,
    };
}

/**
 * One directory: a count, that many twelve-byte entries, and a pointer to the
 * next one. Returns null when the directory itself is unreachable.
 */
function readDirectory(ctx, at, names) {
    if (at < ctx.tiffStart || at + 2 > ctx.end) {
        ctx.note(PROBLEM_DIRECTORY);
        return null;
    }

    const declared = ctx.u16(at);
    const kept = Math.min(declared, MAX_ENTRIES_PER_IFD);
    if (declared > MAX_ENTRIES_PER_IFD) ctx.note(PROBLEM_TOO_MANY);

    const entries = [];
    for (let index = 0; index < kept; index += 1) {
        const entryAt = at + 2 + index * IFD_ENTRY_LENGTH;
        if (entryAt + IFD_ENTRY_LENGTH > ctx.end) {
            ctx.note(PROBLEM_ENTRY);
            break;
        }

        const entry = readEntry(ctx, entryAt, names);
        if (entry) entries.push(entry);
    }

    const nextAt = at + 2 + declared * IFD_ENTRY_LENGTH;
    const nextIfd = nextAt + 4 <= ctx.end ? ctx.u32(nextAt) : 0;

    return { entries, nextIfd };
}

/** The value of a pointer entry, when it is one plain LONG and nothing else. */
function pointerValue(entries, tag) {
    const entry = entries.find((candidate) => candidate.tag === tag);
    if (!entry) return null;
    return typeof entry.value === 'number' && entry.value > 0 ? entry.value : null;
}

function readSubdirectory(ctx, entries, tag, names) {
    const offset = pointerValue(entries, tag);
    if (offset === null) return [];

    const directory = readDirectory(ctx, ctx.tiffStart + offset, names);
    return directory ? directory.entries : [];
}

/* ------------------------------------------------------------ the reader */

/**
 * Everything a TIFF block says, as values a page can print.
 *
 * @param {Uint8Array|ArrayBuffer|ArrayBufferView} input the whole file
 * @param {{ tiffStart: number, end: number }} bounds where the TIFF header
 *   starts and where its block ends — both from locateMetadata, never guessed
 * @returns {{ ok: boolean, byteOrder: 'II'|'MM'|null,
 *             ifd0: Array<object>, exif: Array<object>, gps: Array<object>,
 *             interop: null, ifd1: { present: boolean, entries: number },
 *             problems: string[] }}
 */
export function readExif(input, { tiffStart = 0, end = null } = {}) {
    const problems = [];
    const bytes = toBytes(input);

    if (!bytes) {
        problems.push(PROBLEM_NOT_TIFF);
        return emptyResult(problems);
    }

    const start = Number.isInteger(tiffStart) ? tiffStart : 0;
    const limit = Number.isInteger(end) ? Math.min(end, bytes.length) : bytes.length;

    if (start < 0 || start + 8 > limit) {
        problems.push(PROBLEM_NOT_TIFF);
        return emptyResult(problems);
    }

    try {
        return parse(bytes, start, limit, problems);
    } catch {
        // Belt as well as braces. Every path above is bounds-checked, so this is
        // unreachable by design — and a report is not worth a thrown page if the
        // design is ever wrong.
        problems.push(PROBLEM_NOT_TIFF);
        return emptyResult(problems);
    }
}

function parse(bytes, tiffStart, end, problems) {
    const little = bytes[tiffStart] === 0x49 && bytes[tiffStart + 1] === 0x49;
    const big = bytes[tiffStart] === 0x4D && bytes[tiffStart + 1] === 0x4D;

    if (!little && !big) {
        problems.push(PROBLEM_NOT_TIFF);
        return emptyResult(problems);
    }

    const ctx = context(bytes, tiffStart, end, problems);
    if (ctx.u16(tiffStart + 2) !== TIFF_MAGIC) {
        problems.push(PROBLEM_NOT_TIFF);
        return emptyResult(problems);
    }

    const first = readDirectory(ctx, tiffStart + ctx.u32(tiffStart + 4), IFD0_NAMES);
    if (!first) return emptyResult(problems);

    // IFD1 is the embedded thumbnail — a second, smaller, VISIBLE copy of the
    // photograph. Its entries are counted and never read: what a report needs is
    // "there is another picture in here", and reading it would mean following a
    // second image's offsets to describe an image nobody asked about.
    const thumbnailAt = tiffStart + first.nextIfd;
    const thumbnail = first.nextIfd > 0 && thumbnailAt + 2 <= end
        ? { present: true, entries: Math.min(ctx.u16(thumbnailAt), MAX_ENTRIES_PER_IFD) }
        : { present: false, entries: 0 };

    return {
        ok: true,
        byteOrder: little ? 'II' : 'MM',
        ifd0: first.entries,
        exif: readSubdirectory(ctx, first.entries, EXIF_IFD_POINTER, EXIF_NAMES),
        gps: readSubdirectory(ctx, first.entries, GPS_IFD_POINTER, GPS_NAMES),
        // The interoperability IFD holds a version string and a conformance
        // code. Nothing a person would read, and one more graph edge to bound.
        interop: null,
        ifd1: thumbnail,
        problems,
    };
}
