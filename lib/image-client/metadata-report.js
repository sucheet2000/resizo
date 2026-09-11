/**
 * Everything a file says about itself, in one report a page can print.
 *
 * THE TOOL THIS EXISTS FOR. /image-metadata-viewer is the only thing on this
 * site that tells a person something they did not already know about their own
 * photograph, and the thing they most often want to know is whether it records
 * where they live. So this reads and never writes: the bytes are not decoded,
 * not modified and not uploaded, and the report is built on the main thread the
 * moment a file is dropped.
 *
 * IT ASSEMBLES, IT DOES NOT PARSE. Every fact comes from a module that already
 * owns it — sniffImageType for the format, readImageSize for the pixels,
 * readResolution for the density, locateMetadata for where each block sits,
 * readExif for the TIFF inside it, readIccProfile for the colour profile, and
 * inspectMetadata for whether the remover would take anything out. A second
 * implementation of any of those would be a second thing to be wrong, and the
 * two would disagree in front of a visitor.
 *
 * THREE RULES THE WHOLE FILE IS BUILT AROUND:
 *
 *   EVERY VALUE IS TEXT. Nothing leaving here is markup, a Date or a buffer. A
 *   `<script>` inside an XMP description comes back as a string that happens to
 *   contain angle brackets, and the page renders it as a React text node, so
 *   there is nothing to escape and nothing to trust.
 *
 *   THE CONTAINER OUTRANKS THE METADATA. Width and height come from the frame
 *   header, never from EXIF's PixelXDimension, and the format comes from the
 *   magic bytes, never from the filename. Both are things a file can lie about,
 *   and a viewer that repeats the lie is worse than no viewer.
 *
 *   ONE BAD BLOCK COSTS ONE SECTION. Every parse is bounded and nothing throws
 *   for a container this module recognises: a broken EXIF directory adds a
 *   sentence to `problems` and the file facts, the resolution and the colour
 *   profile are all still reported.
 */
import { contentTypeFor } from '@/lib/image/filename';
import { sniffImageType } from '@/lib/image/magic-bytes';
import { METADATA_INPUT_FORMATS } from '@/lib/limits';
import { readResolution } from '@/lib/image-client/dpi';
import { readExif } from '@/lib/image-client/exif';
import { readIccProfile } from '@/lib/image-client/icc';
import { inspectMetadata, locateMetadata } from '@/lib/image-client/metadata-strip';
import { readImageSize } from '@/lib/image-client/image-size';

/* ------------------------------------------------------------------ caps */

/**
 * Every cap here is on somebody else's text, and each one is a size a person
 * could plausibly read rather than a size a file could plausibly hold.
 */
const MAX_TEXT_CHARS = 2000;
const MAX_PACKET_CHARS = 65536;
const MAX_RAW_CHARS = 20_000;
const MAX_TEXT_ITEMS = 64;
const MAX_XMP_ITEMS = 32;
const MAX_RAW_ROWS = 2048;

/** A profile larger than this is not a profile; four megabytes is generous. */
const MAX_ICC_BYTES = 4 * 1024 * 1024;

/* ---------------------------------------------------------------- tables */

const EXPECTED_EXTENSIONS = new Map([
    ['jpeg', ['jpg', 'jpeg', 'jpe', 'jfif']],
    ['png', ['png']],
    ['webp', ['webp']],
]);

/**
 * What a viewer does to the stored pixels, per Orientation value. `description`
 * is the sentence a page prints; `transform` is the same instruction as a code,
 * for anything that needs to switch on it without matching English.
 */
const ORIENTATIONS = new Map([
    [1, ['Normal', 'none']],
    [2, ['Mirrored horizontally', 'flip-horizontal']],
    [3, ['Rotate 180°', 'rotate-180']],
    [4, ['Mirrored vertically', 'flip-vertical']],
    [5, ['Mirror horizontally, then rotate 90° counter-clockwise', 'transpose']],
    [6, ['Rotate 90° clockwise', 'rotate-90-clockwise']],
    [7, ['Mirror horizontally, then rotate 90° clockwise', 'transverse']],
    [8, ['Rotate 90° counter-clockwise', 'rotate-90-counter-clockwise']],
]);

const METERING_MODES = new Map([
    [0, 'Unknown'], [1, 'Average'], [2, 'Centre-weighted average'], [3, 'Spot'],
    [4, 'Multi-spot'], [5, 'Pattern'], [6, 'Partial'], [255, 'Other'],
]);

const WHITE_BALANCE = new Map([[0, 'Automatic'], [1, 'Manual']]);

/** Bit 5 says the camera has no flash at all; bit 0 says it fired. */
const FLASH_NO_FUNCTION = 0x20;
const FLASH_FIRED = 0x01;

const GPS_SIGNS = new Map([['N', 1], ['S', -1], ['E', 1], ['W', -1]]);

/** The IIM datasets worth showing. Record 2 is the editorial record. */
const IPTC_RECORD = 2;
const IPTC_RESOURCE = 0x0404;
const IPTC_DATASETS = new Map([
    [5, 'Object name'], [80, 'By-line'], [85, 'By-line title'], [90, 'City'],
    [101, 'Country'], [105, 'Headline'], [110, 'Credit'], [115, 'Source'],
    [116, 'Copyright notice'], [120, 'Caption'], [122, 'Caption writer'],
]);

const XMP_FIELDS = [
    { id: 'dc:creator', label: 'Creator', join: false },
    { id: 'dc:title', label: 'Title', join: false },
    { id: 'dc:description', label: 'Description', join: false },
    { id: 'dc:rights', label: 'Rights', join: false },
    { id: 'dc:subject', label: 'Keywords', join: true },
    { id: 'xmp:CreatorTool', label: 'Created with', join: false },
    { id: 'xmp:CreateDate', label: 'Created', join: false },
    { id: 'xmp:ModifyDate', label: 'Modified', join: false },
    { id: 'xmp:MetadataDate', label: 'Metadata changed', join: false },
    { id: 'photoshop:DateCreated', label: 'Date created', join: false },
    { id: 'xmpMM:DocumentID', label: 'Document ID', join: false },
];

/** The five entities XMP is allowed to use. Everything else stays literal. */
const ENTITIES = new Map([
    ['&amp;', '&'], ['&lt;', '<'], ['&gt;', '>'], ['&quot;', '"'], ['&apos;', "'"],
]);

const PRIVACY_CATEGORIES = [
    ['location', 'GPS coordinates'],
    ['capture-time', 'Capture date and time'],
    ['device', 'Camera make and model'],
    ['creator', 'Name or copyright'],
    ['software', 'Editing software'],
    ['text', 'Comments or descriptions'],
    ['thumbnail', 'Embedded preview image'],
    ['extra-images', 'Extra images after the picture'],
];

const PROBLEM_EXIF = 'Some EXIF fields could not be read.';
const PROBLEM_GPS = 'Some location fields could not be read.';
const PROBLEM_XMP_LARGE = 'The XMP packet was too large to show in full.';
const PROBLEM_XMP_COMPRESSED = 'The XMP packet is compressed, so its fields could not be read.';

/* -------------------------------------------------------------- plumbing */

function toBytes(value) {
    if (value instanceof Uint8Array) return value;
    if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    return null;
}

function round(value, places) {
    const factor = 10 ** places;
    return Math.round(value * factor) / factor;
}

function pad(value, width = 2) {
    return String(value).padStart(width, '0');
}

function decodeText(bytes, start, end) {
    return new TextDecoder('utf-8').decode(bytes.subarray(start, end));
}

function asciiAt(bytes, at, length) {
    let out = '';
    for (let index = at; index < at + length; index += 1) out += String.fromCharCode(bytes[index]);
    return out;
}

function readU16BE(bytes, at) {
    return bytes[at] * 256 + bytes[at + 1];
}

function readU32BE(bytes, at) {
    return bytes[at] * 16777216 + bytes[at + 1] * 65536 + bytes[at + 2] * 256 + bytes[at + 3];
}

function blocksOfKind(blocks, kind) {
    return blocks.filter((block) => block.kind === kind);
}

function firstOfKind(blocks, kind) {
    return blocks.find((block) => block.kind === kind) ?? null;
}

/* ---------------------------------------------------------- entry lookups */

function entryOf(entries, name) {
    return entries.find((entry) => entry.name === name) ?? null;
}

function textOf(entries, name) {
    const entry = entryOf(entries, name);
    if (!entry || typeof entry.value !== 'string') return null;
    const trimmed = entry.value.trim();
    return trimmed === '' ? null : trimmed;
}

function rationalValue(value) {
    if (!value || typeof value !== 'object') return null;
    const { numerator, denominator } = value;
    if (typeof numerator !== 'number' || typeof denominator !== 'number') return null;
    return denominator === 0 ? null : numerator / denominator;
}

function numberOf(entries, name) {
    const entry = entryOf(entries, name);
    if (!entry) return null;
    if (typeof entry.value === 'number') return entry.value;
    return rationalValue(entry.value);
}

function rationalList(entries, name) {
    const entry = entryOf(entries, name);
    if (!entry || entry.value === null) return null;
    return Array.isArray(entry.value) ? entry.value : [entry.value];
}

/* ------------------------------------------------------------ file facts */

function extensionOf(name) {
    if (typeof name !== 'string') return null;
    const dot = name.lastIndexOf('.');
    if (dot <= 0 || dot === name.length - 1) return null;
    return name.slice(dot + 1).toLowerCase();
}

/**
 * Whether the file is animated, from the container and never from the name.
 *
 * A PNG says so with an acTL chunk; a WebP with the VP8X animation flag or an
 * ANIM chunk, and the two disagree in files written by older encoders, so
 * either one counts. A JPEG cannot animate.
 */
function animatedFrom(blocks) {
    if (firstOfKind(blocks, 'png-actl')) return true;
    if (firstOfKind(blocks, 'webp-anim')) return true;

    const vp8x = firstOfKind(blocks, 'webp-vp8x');
    return vp8x ? vp8x.animation === true : false;
}

function buildFile(bytes, format, name, blocks) {
    const size = readImageSize(bytes);
    const extension = extensionOf(name);
    const expected = EXPECTED_EXTENSIONS.get(format) ?? [];

    return {
        name: typeof name === 'string' ? name : null,
        extension,
        format,
        mimeType: contentTypeFor(format),
        bytes: bytes.length,
        width: size ? size.width : null,
        height: size ? size.height : null,
        megapixels: size ? round((size.width * size.height) / 1000000, 1) : null,
        alphaChannel: size ? size.hasAlpha : null,
        animated: animatedFrom(blocks),
        extensionMismatch: extension !== null && !expected.includes(extension),
        expectedExtensions: expected,
    };
}

/* ------------------------------------------------------------ resolution */

/**
 * readResolution is the ONLY source of a density on this site, and it already
 * normalises every container's unit to dots per inch — a JFIF header in
 * centimetres, an EXIF ResolutionUnit of 3, a pHYs in pixels per metre. So `x`
 * and `y` are always inches here, and `raw` keeps the file's own declaration
 * for a page that wants to show what was actually written.
 *
 * It refuses a format with no density field by throwing, which is a perfectly
 * good ANSWER for a report — WebP has nowhere to put one — so the throw becomes
 * "not present" rather than taking the report down.
 */
function buildResolution(bytes, size) {
    let raw = null;
    try {
        raw = readResolution(bytes);
    } catch {
        raw = null;
    }

    const dpi = raw ? raw.dpi : null;
    if (!dpi) {
        return {
            present: false, x: null, y: null, unit: null, source: null, printSize: null, raw,
        };
    }

    const printable = size && dpi.x > 0 && dpi.y > 0;

    return {
        present: true,
        x: dpi.x,
        y: dpi.y,
        unit: 'inch',
        source: raw.source,
        printSize: printable
            ? { widthIn: round(size.width / dpi.x, 2), heightIn: round(size.height / dpi.y, 2) }
            : null,
        raw,
    };
}

/* ------------------------------------------------------------------ EXIF */

function formatExposure(value) {
    const seconds = rationalValue(value);
    if (seconds === null || seconds <= 0) return null;
    if (seconds >= 1) return `${round(seconds, 1)} s`;
    return `1/${Math.round(1 / seconds)} s`;
}

function formatAperture(value) {
    const stop = rationalValue(value);
    return stop === null || stop <= 0 ? null : `f/${round(stop, 1)}`;
}

function formatMillimetres(value, suffix) {
    if (value === null) return null;
    return `${round(value, 1)} mm${suffix}`;
}

function formatBias(value) {
    const stops = rationalValue(value);
    return stops === null ? null : `${round(stops, 1)} EV`;
}

function formatFlash(value) {
    if (typeof value !== 'number') return null;
    if ((value & FLASH_NO_FUNCTION) !== 0) return 'No flash function';
    return (value & FLASH_FIRED) === FLASH_FIRED ? 'Flash fired' : 'Flash did not fire';
}

function fromTable(table, value) {
    return typeof value === 'number' ? table.get(value) ?? null : null;
}

/** 'YYYY:MM:DD hh:mm:ss' as stored, with only the date separators changed. */
function displayDate(stored) {
    if (stored === null) return null;
    return stored.replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3');
}

const EXIF_FIELDS = [
    ['make', 'Camera make', (read) => textOf(read.ifd0, 'Make')],
    ['model', 'Camera model', (read) => textOf(read.ifd0, 'Model')],
    ['lens', 'Lens', (read) => textOf(read.exif, 'LensModel') ?? textOf(read.exif, 'LensMake')],
    ['software', 'Software', (read) => textOf(read.ifd0, 'Software')],
    ['dateTimeOriginal', 'Date taken', (read) => displayDate(textOf(read.exif, 'DateTimeOriginal'))],
    ['dateTimeDigitized', 'Date digitised', (read) => displayDate(textOf(read.exif, 'DateTimeDigitized'))],
    ['dateTime', 'File changed', (read) => displayDate(textOf(read.ifd0, 'DateTime'))],
    ['exposureTime', 'Exposure time', (read) => formatExposure(entryOf(read.exif, 'ExposureTime')?.value)],
    ['fNumber', 'Aperture', (read) => formatAperture(entryOf(read.exif, 'FNumber')?.value)],
    ['iso', 'ISO', (read) => {
        const iso = numberOf(read.exif, 'ISOSpeedRatings');
        return iso === null ? null : String(round(iso, 0));
    }],
    ['focalLength', 'Focal length', (read) => formatMillimetres(numberOf(read.exif, 'FocalLength'), '')],
    ['focalLength35', 'Focal length (35 mm)', (read) => formatMillimetres(numberOf(read.exif, 'FocalLengthIn35mmFilm'), ' equivalent')],
    ['exposureBias', 'Exposure compensation', (read) => formatBias(entryOf(read.exif, 'ExposureBiasValue')?.value)],
    ['flash', 'Flash', (read) => formatFlash(entryOf(read.exif, 'Flash')?.value)],
    ['meteringMode', 'Metering mode', (read) => fromTable(METERING_MODES, entryOf(read.exif, 'MeteringMode')?.value)],
    ['whiteBalance', 'White balance', (read) => fromTable(WHITE_BALANCE, entryOf(read.exif, 'WhiteBalance')?.value)],
    ['artist', 'Artist', (read) => textOf(read.ifd0, 'Artist')],
    ['copyright', 'Copyright', (read) => textOf(read.ifd0, 'Copyright')],
    ['imageDescription', 'Description', (read) => textOf(read.ifd0, 'ImageDescription')],
    ['userComment', 'User comment', (read) => textOf(read.exif, 'UserComment')],
    ['imageUniqueId', 'Image unique ID', (read) => textOf(read.exif, 'ImageUniqueID')],
    ['serials', 'Serial number', (read) => textOf(read.exif, 'BodySerialNumber') ?? textOf(read.exif, 'LensSerialNumber')],
];

const DATE_FIELDS = [
    ['dateTimeOriginal', 'Date taken', 'exif', 'DateTimeOriginal', 'OffsetTimeOriginal', 'SubSecTimeOriginal'],
    ['dateTimeDigitized', 'Date digitised', 'exif', 'DateTimeDigitized', 'OffsetTimeDigitized', 'SubSecTimeDigitized'],
    ['dateTime', 'File changed', 'ifd0', 'DateTime', 'OffsetTime', 'SubSecTime'],
];

/**
 * The dates, KEPT AS THEY WERE STORED.
 *
 * An Exif timestamp has no time zone: it is whatever the camera's clock said,
 * and the offset tags that would explain it are optional and usually absent. So
 * nothing here builds a Date, nothing converts, and nothing assumes UTC — a
 * report that quietly shifted a photograph by an hour would be lying with more
 * confidence than the file deserves. `display` changes two colons to hyphens
 * and stops there.
 */
function buildDates(read) {
    const dates = [];

    for (const [id, label, group, tag, offsetTag, subTag] of DATE_FIELDS) {
        const stored = textOf(read[group], tag);
        if (stored === null) continue;

        const offset = textOf(read.exif, offsetTag);
        dates.push({
            id,
            label,
            stored,
            display: displayDate(stored),
            offset,
            subseconds: textOf(read.exif, subTag),
            note: offset === null
                ? 'Local time as stored, no time zone recorded'
                : `Local time as stored, with the time zone offset ${offset} recorded`,
        });
    }

    return dates;
}

function buildExifSection(read, present) {
    if (!present) {
        return {
            present: false,
            byteOrder: null,
            fields: [],
            orientation: { value: null, description: null, transform: null },
            dates: [],
            entryCount: 0,
            problems: [],
        };
    }

    const fields = [];
    for (const [id, label, build] of EXIF_FIELDS) {
        const value = build(read);
        if (value !== null && value !== '') fields.push({ id, label, value });
    }

    const stored = entryOf(read.ifd0, 'Orientation')?.value;
    const described = ORIENTATIONS.get(stored) ?? null;

    return {
        present: true,
        byteOrder: read.byteOrder,
        fields,
        orientation: described
            ? { value: stored, description: described[0], transform: described[1] }
            : { value: null, description: null, transform: null },
        dates: buildDates(read),
        entryCount: read.ifd0.length + read.exif.length + read.gps.length + read.ifd1.entries,
        problems: read.problems,
    };
}

/* ------------------------------------------------------------------- GPS */

/**
 * Degrees, minutes and seconds to a decimal — AND THE SIGN FROM THE REFERENCE.
 *
 * The magnitude and the hemisphere are stored apart: three rationals say "51
 * degrees, 28 minutes, 40.2 seconds" and a single letter says whether that is
 * north or south. A reader that takes the numbers and ignores the letter puts
 * every southern and western photograph in the wrong hemisphere — Greenwich,
 * five arc-seconds west of the meridian, comes out on the wrong side of it —
 * so a missing letter is a refusal rather than an assumption of north.
 */
function coordinate(entries, valueTag, refTag, limit, problems) {
    const parts = rationalList(entries, valueTag);
    if (parts === null) return null;

    const ref = textOf(entries, refTag);
    const sign = ref === null ? null : GPS_SIGNS.get(ref.trim().charAt(0).toUpperCase()) ?? null;

    if (sign === null) {
        problems.push('A coordinate was stored without the letter that says north, south, east or west, so it could not be read.');
        return null;
    }

    const units = [1, 60, 3600];
    let total = 0;

    for (let index = 0; index < Math.min(parts.length, 3); index += 1) {
        const value = rationalValue(parts[index]);
        if (value === null) {
            problems.push('A coordinate was stored with a value this reader cannot divide, so it could not be read.');
            return null;
        }
        // The magnitude only: the letter decides the hemisphere, so a rational
        // stored negative cannot quietly contradict it.
        total += Math.abs(value) / units[index];
    }

    const decimal = total * sign;
    if (!Number.isFinite(decimal) || Math.abs(decimal) > limit) {
        problems.push('A coordinate was stored outside the range of real coordinates, so it could not be read.');
        return null;
    }

    return decimal;
}

function buildAltitude(entries) {
    const metres = numberOf(entries, 'GPSAltitude');
    if (metres === null || !Number.isFinite(metres)) return null;

    return {
        metres: round(Math.abs(metres), 1),
        belowSeaLevel: numberOf(entries, 'GPSAltitudeRef') === 1,
    };
}

/**
 * The GPS timestamp is UTC BY THE SPECIFICATION, which makes it the one time in
 * an Exif block that means the same thing everywhere — and, paired with the
 * coordinates, the one that says exactly where somebody was at a given moment.
 */
function buildTimestamp(entries) {
    const parts = rationalList(entries, 'GPSTimeStamp');
    const stamp = textOf(entries, 'GPSDateStamp');

    let time = null;
    if (parts && parts.length >= 3) {
        const numbers = parts.slice(0, 3).map(rationalValue);
        if (numbers.every((value) => value !== null && Number.isFinite(value) && value >= 0)) {
            const [hours, minutes, seconds] = numbers;
            if (hours < 24 && minutes < 60 && seconds < 61) {
                time = `${pad(Math.floor(hours))}:${pad(Math.floor(minutes))}:${pad(Math.floor(seconds))}`;
            }
        }
    }

    const date = stamp === null || !/^\d{4}:\d{2}:\d{2}$/.test(stamp)
        ? null
        : stamp.replace(/:/g, '-');

    return date === null && time === null ? null : { date, time, utc: true };
}

function buildGps(read, present) {
    if (!present) {
        return {
            present: false,
            latitude: null,
            longitude: null,
            altitude: null,
            timestamp: null,
            raw: {
                latitude: null, latitudeRef: null, longitude: null, longitudeRef: null,
            },
            problems: [],
        };
    }

    const problems = [];
    const entries = read.gps;

    return {
        present: true,
        latitude: coordinate(entries, 'GPSLatitude', 'GPSLatitudeRef', 90, problems),
        longitude: coordinate(entries, 'GPSLongitude', 'GPSLongitudeRef', 180, problems),
        altitude: buildAltitude(entries),
        timestamp: buildTimestamp(entries),
        raw: {
            latitude: rationalList(entries, 'GPSLatitude'),
            latitudeRef: textOf(entries, 'GPSLatitudeRef'),
            longitude: rationalList(entries, 'GPSLongitude'),
            longitudeRef: textOf(entries, 'GPSLongitudeRef'),
        },
        problems,
    };
}

/* ------------------------------------------------------------------- XMP */

/**
 * XMP fields by BOUNDED TEXT SCANNING, and deliberately not by an XML parser.
 *
 * A packet is RDF/XML and parsing it properly would mean either a dependency or
 * DOMParser — and DOMParser on a stranger's markup, in a page that then renders
 * what comes out, is the exact shape of an injection bug. Nothing here builds a
 * node: it finds a tag by name, takes the characters between it and its close,
 * decodes the five entities XMP is allowed to use, and hands back a string.
 * Anything that looks like markup stays as characters, which is the point.
 */
function decodeEntities(text) {
    return text.replace(/&(?:amp|lt|gt|quot|apos);/g, (match) => ENTITIES.get(match) ?? match);
}

function tidy(text) {
    const value = decodeEntities(text).trim();
    return value.length > MAX_TEXT_CHARS ? value.slice(0, MAX_TEXT_CHARS) : value;
}

function elementContent(packet, name) {
    const open = packet.indexOf(`<${name}`);
    if (open === -1) return null;

    const gt = packet.indexOf('>', open);
    if (gt === -1 || packet[gt - 1] === '/') return null;

    const close = packet.indexOf(`</${name}>`, gt);
    return close === -1 ? null : packet.slice(gt + 1, close);
}

function listItems(inner) {
    const items = [];
    let at = 0;

    while (items.length < MAX_XMP_ITEMS) {
        const open = inner.indexOf('<rdf:li', at);
        if (open === -1) break;

        const gt = inner.indexOf('>', open);
        if (gt === -1) break;

        const close = inner.indexOf('</rdf:li>', gt);
        if (close === -1) break;

        items.push(inner.slice(gt + 1, close));
        at = close + 1;
    }

    return items;
}

function attributeValue(packet, name) {
    for (const quote of ['"', "'"]) {
        const marker = `${name}=${quote}`;
        const at = packet.indexOf(marker);
        if (at === -1) continue;

        const start = at + marker.length;
        const close = packet.indexOf(quote, start);
        if (close !== -1) return packet.slice(start, close);
    }
    return null;
}

function xmpValue(packet, field) {
    const inner = elementContent(packet, field.id);

    if (inner !== null) {
        const items = listItems(inner);
        if (items.length > 0) {
            return field.join
                ? items.map(tidy).filter(Boolean).join(', ')
                : tidy(items[0]);
        }
        // A container this reader does not understand is not a value.
        if (inner.includes('<rdf:')) return null;
        return tidy(inner);
    }

    const attribute = attributeValue(packet, field.id);
    return attribute === null ? null : tidy(attribute);
}

function buildXmp(bytes, blocks, problems) {
    const pieces = blocks.filter((block) => block.kind === 'xmp'
        || (block.kind === 'png-text' && block.xmp === true));

    if (pieces.length === 0) {
        return {
            present: false, bytes: 0, extended: false, fields: [], packet: null, truncated: false,
        };
    }

    const size = pieces.reduce((total, block) => total + (block.end - block.start), 0);
    const extended = pieces.some((block) => block.extended === true);
    const readable = pieces.filter((block) => block.compressed !== true);

    if (readable.length === 0) {
        problems.push(PROBLEM_XMP_COMPRESSED);
        return {
            present: true, bytes: size, extended, fields: [], packet: null, truncated: false,
        };
    }

    let packet = '';
    let truncated = false;

    for (const block of readable) {
        // Four bytes per character is the widest UTF-8 sequence, so this cannot
        // cut a packet that would have fitted inside the character cap.
        const limit = Math.min(block.end, block.start + MAX_PACKET_CHARS * 4);
        packet += decodeText(bytes, block.start, limit);
        if (limit < block.end) truncated = true;
        if (packet.length >= MAX_PACKET_CHARS) break;
    }

    if (packet.length > MAX_PACKET_CHARS) {
        packet = packet.slice(0, MAX_PACKET_CHARS);
        truncated = true;
    }

    if (truncated) problems.push(PROBLEM_XMP_LARGE);

    const fields = [];
    for (const field of XMP_FIELDS) {
        const value = xmpValue(packet, field);
        if (value !== null && value !== '') fields.push({ id: field.id, label: field.label, value });
    }

    return {
        present: true, bytes: size, extended, fields, packet, truncated,
    };
}

/* ------------------------------------------------------------------- ICC */

/**
 * A JPEG splits a profile across as many APP2 segments as it needs, each
 * numbered. They are joined IN SEQUENCE ORDER rather than in file order,
 * because the numbering is what the format says to trust.
 */
function joinIcc(bytes, pieces) {
    const ordered = [...pieces].sort((left, right) => (left.sequence ?? 1) - (right.sequence ?? 1));

    let total = 0;
    for (const piece of ordered) total += piece.end - piece.start;

    const size = Math.min(total, MAX_ICC_BYTES);
    const out = new Uint8Array(size);

    let at = 0;
    for (const piece of ordered) {
        if (at >= size) break;
        const end = Math.min(piece.end, piece.start + (size - at));
        out.set(bytes.subarray(piece.start, end), at);
        at += end - piece.start;
    }

    return out;
}

function buildIcc(bytes, blocks, format) {
    const pieces = blocksOfKind(blocks, 'icc');

    if (pieces.length === 0) {
        return {
            present: false,
            bytes: 0,
            source: null,
            description: null,
            colourSpace: null,
            version: null,
            compressed: false,
        };
    }

    const size = pieces.reduce((total, block) => total + (block.end - block.start), 0);

    // A PNG's profile is zlib-compressed and there is no inflater in this
    // engine. Its keyword is reported and the profile is not opened.
    if (format === 'png') {
        return {
            present: true,
            bytes: size,
            source: 'iCCP',
            description: null,
            colourSpace: null,
            version: null,
            compressed: true,
        };
    }

    const profile = readIccProfile(joinIcc(bytes, pieces));

    return {
        present: true,
        bytes: profile.bytes,
        source: format === 'jpeg' ? 'app2' : 'ICCP',
        description: profile.description,
        colourSpace: profile.colourSpace,
        version: profile.version,
        compressed: false,
    };
}

/* ------------------------------------------------------------------ text */

function textItem(source, keyword, bytes, block, compressed) {
    const size = block.end - block.start;

    if (compressed) {
        return {
            source, keyword, value: '', truncated: false, bytes: size, compressed: true,
        };
    }

    const limit = Math.min(block.end, block.start + MAX_TEXT_CHARS * 4);
    const decoded = decodeText(bytes, block.start, limit).replace(/\0+$/, '');
    const cut = decoded.length > MAX_TEXT_CHARS;

    return {
        source,
        keyword,
        value: cut ? decoded.slice(0, MAX_TEXT_CHARS) : decoded,
        truncated: cut || limit < block.end,
        bytes: size,
        compressed: false,
    };
}

/** IIM datasets inside one 8BIM resource: a marker, a record, a dataset, a size. */
function iimRecords(bytes, from, to) {
    const items = [];

    let at = from;
    while (at + 5 <= to && items.length < MAX_TEXT_ITEMS) {
        if (bytes[at] !== 0x1C) break;

        const record = bytes[at + 1];
        const dataset = bytes[at + 2];
        const size = readU16BE(bytes, at + 3);

        // The high bit marks an extended length, which is a different encoding
        // this reader does not follow.
        if ((size & 0x8000) !== 0) break;

        const start = at + 5;
        if (start + size > to) break;

        if (record === IPTC_RECORD && IPTC_DATASETS.has(dataset)) {
            items.push(textItem('iptc', IPTC_DATASETS.get(dataset), bytes, { start, end: start + size }, false));
        }

        at = start + size;
    }

    return items;
}

/**
 * A Photoshop image resource block: 'Photoshop 3.0\0', then '8BIM' resources,
 * each with a numeric id, a Pascal name padded to an even length, a size and
 * its data padded the same way. Only resource 0x0404 holds IPTC.
 */
function iptcItems(bytes, block) {
    const items = [];
    const end = block.end;

    let at = block.start;
    if (asciiAt(bytes, at, 14) === 'Photoshop 3.0\0') at += 14;

    while (at + 12 <= end && items.length < MAX_TEXT_ITEMS) {
        if (asciiAt(bytes, at, 4) !== '8BIM') break;

        const id = readU16BE(bytes, at + 4);
        const nameLength = bytes[at + 6];
        let cursor = at + 7 + nameLength;
        if ((nameLength + 1) % 2 === 1) cursor += 1;

        if (cursor + 4 > end) break;
        const size = readU32BE(bytes, cursor);
        cursor += 4;
        if (cursor + size > end) break;

        if (id === IPTC_RESOURCE) items.push(...iimRecords(bytes, cursor, cursor + size));
        at = cursor + size + (size % 2);
    }

    return items;
}

function userCommentItem(read) {
    const entry = entryOf(read.exif, 'UserComment');
    if (!entry || typeof entry.value !== 'string' || entry.value.trim() === '') return null;

    const cut = entry.value.length > MAX_TEXT_CHARS;

    return {
        source: 'user-comment',
        keyword: 'UserComment',
        value: cut ? entry.value.slice(0, MAX_TEXT_CHARS) : entry.value,
        truncated: cut || entry.truncated === true,
        bytes: entry.count,
        compressed: false,
    };
}

function buildText(bytes, blocks, read, problems) {
    const items = [];

    for (const block of blocks) {
        if (items.length >= MAX_TEXT_ITEMS) break;

        if (block.kind === 'comment') {
            items.push(textItem('comment', null, bytes, block, false));
        } else if (block.kind === 'png-text' && block.xmp !== true) {
            items.push(textItem('png-text', block.keyword || null, bytes, block, block.compressed));
        } else if (block.kind === 'iptc') {
            items.push(...iptcItems(bytes, block));
        } else if (block.kind === 'exif') {
            const comment = userCommentItem(read);
            if (comment) items.push(comment);
        }
    }

    // A value the page will shorten is a display cut, not a read failure: the
    // item carries `truncated` and its byte size, and the page says so beside it.
    return items.slice(0, MAX_TEXT_ITEMS);
}

/* ----------------------------------------------------------------- other */

function pngTimeOf(bytes, block) {
    if (!block || block.end - block.start < 7) return null;

    const at = block.start;
    const year = readU16BE(bytes, at);
    const [month, day, hour, minute, second] = [
        bytes[at + 2], bytes[at + 3], bytes[at + 4], bytes[at + 5], bytes[at + 6],
    ];

    const sane = month >= 1 && month <= 12 && day >= 1 && day <= 31
        && hour <= 23 && minute <= 59 && second <= 60;
    if (!sane) return null;

    return `${pad(year, 4)}-${pad(month)}-${pad(day)} ${pad(hour)}:${pad(minute)}:${pad(second)} UTC`;
}

function buildOther(bytes, blocks, read) {
    const jfif = firstOfKind(blocks, 'jfif');
    const trailer = firstOfKind(blocks, 'trailer');
    const jfxx = blocks.some((block) => block.kind === 'other' && block.identifier === 'JFXX');

    return {
        thumbnail: read.ifd1.present || jfxx || (jfif ? jfif.thumbnail === true : false),
        iptc: Boolean(firstOfKind(blocks, 'iptc')),
        mpf: Boolean(firstOfKind(blocks, 'mpf')),
        trailer: Boolean(trailer),
        trailerBytes: trailer ? trailer.end - trailer.start : 0,
        pngTime: pngTimeOf(bytes, firstOfKind(blocks, 'png-time')),
        jfif: jfif
            ? {
                version: jfif.version,
                units: jfif.units,
                xDensity: jfif.xDensity,
                yDensity: jfif.yDensity,
                thumbnail: jfif.thumbnail,
            }
            : null,
        adobe: Boolean(firstOfKind(blocks, 'adobe')),
    };
}

/* --------------------------------------------------------------- privacy */

function hasField(section, ...ids) {
    return section.fields.some((entry) => ids.includes(entry.id) && entry.value !== '');
}

/**
 * `removable` is the REMOVER'S OWN VERDICT, not a second opinion.
 *
 * The page puts a link to /remove-image-metadata behind this flag, and offering
 * that link for a file with nothing to take out is the one answer that wastes a
 * person's time. So it comes from inspectMetadata, which is the same walk
 * stripMetadata plans its work from.
 */
function removableFrom(bytes) {
    try {
        return inspectMetadata(bytes).found.some((entry) => entry.removable);
    } catch {
        return false;
    }
}

function buildPrivacy(bytes, sections) {
    const {
        exif, gps, xmp, text, other,
    } = sections;

    const present = new Map([
        ['location', gps.present],
        ['capture-time', exif.dates.length > 0 || other.pngTime !== null
            || hasField(xmp, 'xmp:CreateDate', 'xmp:ModifyDate', 'photoshop:DateCreated')],
        ['device', hasField(exif, 'make', 'model')],
        ['creator', hasField(exif, 'artist', 'copyright') || hasField(xmp, 'dc:creator', 'dc:rights')],
        ['software', hasField(exif, 'software') || hasField(xmp, 'xmp:CreatorTool')],
        ['text', text.length > 0 || hasField(xmp, 'dc:title', 'dc:description', 'dc:subject')],
        ['thumbnail', other.thumbnail],
        ['extra-images', other.trailer || other.mpf],
    ]);

    return {
        location: gps.present,
        categories: PRIVACY_CATEGORIES.map(([id, summary]) => ({
            id, present: present.get(id) === true, summary,
        })),
        removable: removableFrom(bytes),
    };
}

/* ------------------------------------------------------------------- raw */

const CONTAINER_GROUPS = new Map([['jpeg', 'JPEG'], ['png', 'PNG'], ['webp', 'WebP']]);

const JPEG_TAGS = new Map([
    ['jfif', 'APP0'], ['exif', 'APP1'], ['xmp', 'APP1'], ['icc', 'APP2'], ['mpf', 'APP2'],
    ['iptc', 'APP13'], ['adobe', 'APP14'], ['comment', 'COM'], ['trailer', 'Trailer'],
]);

const PNG_TAGS = new Map([
    ['png-ihdr', 'IHDR'], ['png-time', 'tIME'], ['png-phys', 'pHYs'], ['png-actl', 'acTL'],
    ['exif', 'eXIf'], ['icc', 'iCCP'], ['trailer', 'Trailer'],
]);

const WEBP_TAGS = new Map([
    ['webp-vp8x', 'VP8X'], ['webp-anim', 'ANIM'], ['exif', 'EXIF'], ['xmp', 'XMP '],
    ['icc', 'ICCP'], ['trailer', 'Trailer'],
]);

const BLOCK_NAMES = new Map([
    ['jfif', 'JFIF density header'], ['exif', 'EXIF block'], ['xmp', 'XMP packet'],
    ['icc', 'ICC profile'], ['mpf', 'Multi-picture index'], ['iptc', 'IPTC record'],
    ['adobe', 'Adobe colour transform'], ['comment', 'Comment'],
    ['trailer', 'Data after the picture'], ['png-ihdr', 'Image header'],
    ['png-time', 'Last changed'], ['png-phys', 'Physical pixel size'],
    ['png-actl', 'Animation control'], ['webp-vp8x', 'Extended format flags'],
    ['webp-anim', 'Animation control'],
]);

function containerTag(format, block) {
    if (format === 'jpeg') return JPEG_TAGS.get(block.kind) ?? block.marker ?? 'APP';
    if (format === 'png') return PNG_TAGS.get(block.kind) ?? block.type ?? 'chunk';
    return WEBP_TAGS.get(block.kind) ?? block.type ?? 'chunk';
}

function renderScalar(value) {
    if (value === null || value === undefined) return '';
    if (typeof value === 'string') return value;
    if (typeof value === 'number') return String(value);
    if (typeof value === 'object' && typeof value.numerator === 'number') {
        return `${value.numerator}/${value.denominator}`;
    }
    if (typeof value === 'object' && typeof value.bytes === 'number') return `${value.bytes} bytes`;
    return '';
}

function renderValue(value) {
    return Array.isArray(value) ? value.map(renderScalar).join(', ') : renderScalar(value);
}

function rawRow(group, tag, name, value, alreadyCut = false) {
    const text = renderValue(value);
    const cut = text.length > MAX_RAW_CHARS;

    return {
        group, tag, name, value: cut ? text.slice(0, MAX_RAW_CHARS) : text, truncated: cut || alreadyCut,
    };
}

function hexTag(tag) {
    return `0x${tag.toString(16).toUpperCase().padStart(4, '0')}`;
}

function buildRaw(format, blocks, read, xmp, icc) {
    const rows = [];
    const group = CONTAINER_GROUPS.get(format);

    for (const block of blocks) {
        rows.push(rawRow(
            group,
            containerTag(format, block),
            BLOCK_NAMES.get(block.kind) ?? block.keyword ?? block.type ?? block.marker ?? null,
            `${block.end - block.start} bytes`,
        ));
    }

    for (const [directory, entries] of [['IFD0', read.ifd0], ['Exif', read.exif], ['GPS', read.gps]]) {
        for (const entry of entries) {
            rows.push(rawRow(directory, hexTag(entry.tag), entry.name, entry.value, entry.truncated === true));
        }
    }

    for (const field of xmp.fields) rows.push(rawRow('XMP', field.id, field.label, field.value));

    if (icc.present) {
        if (icc.compressed) {
            const chunk = firstOfKind(blocks, 'icc');
            rows.push(rawRow('ICC', 'iCCP', chunk ? chunk.name ?? null : null, `Compressed profile, ${icc.bytes} bytes`));
        } else {
            for (const [tag, name, value] of [
                ['desc', 'Description', icc.description],
                ['spac', 'Colour space', icc.colourSpace],
                ['vers', 'Version', icc.version],
                ['size', 'Profile size', `${icc.bytes} bytes`],
            ]) {
                if (value !== null) rows.push(rawRow('ICC', tag, name, value));
            }
        }
    }

    return rows.slice(0, MAX_RAW_ROWS);
}

/* -------------------------------------------------------------- the door */

function refusal(code, format, message) {
    return {
        ok: false, code, format, message,
    };
}

/**
 * What this file is carrying, read from its own bytes and nothing else.
 *
 * Never throws for a container it recognises. A JPG, PNG or WebP always comes
 * back as a report — with `problems` naming anything it could not read — and
 * everything else comes back as a refusal with a sentence a page can print.
 *
 * @param {Uint8Array|ArrayBuffer|ArrayBufferView} input the whole file
 * @param {{ name?: string }} options the filename, for the extension check only
 * @returns {object} the report, or `{ ok: false, code, format, message }`
 */
export function inspectImageMetadata(input, { name = null } = {}) {
    const bytes = toBytes(input);
    if (!bytes) return refusal('unsupported', null, 'This file could not be read as an image.');

    const format = sniffImageType(bytes);
    if (!format || !METADATA_INPUT_FORMATS.includes(format)) {
        return refusal(
            'unsupported',
            format,
            'Metadata can only be read from a JPG, PNG or WebP.',
        );
    }

    let located;
    try {
        located = locateMetadata(bytes);
    } catch {
        return refusal(
            'invalid',
            format,
            'This file is damaged or incomplete, so its metadata could not be read.',
        );
    }

    return buildReport(bytes, format, name, located.blocks);
}

function buildReport(bytes, format, name, blocks) {
    const problems = [];

    const exifBlock = firstOfKind(blocks, 'exif');
    const read = exifBlock
        ? readExif(bytes, { tiffStart: exifBlock.tiffStart, end: exifBlock.end })
        : readExif(null, { tiffStart: 0, end: 0 });

    const exif = buildExifSection(read, Boolean(exifBlock));
    const gps = buildGps(read, Boolean(exifBlock) && read.gps.length > 0);
    const xmp = buildXmp(bytes, blocks, problems);
    const icc = buildIcc(bytes, blocks, format);
    const text = buildText(bytes, blocks, read, problems);
    const other = buildOther(bytes, blocks, read);

    if (exif.problems.length > 0) problems.push(PROBLEM_EXIF);
    if (gps.problems.length > 0) problems.push(PROBLEM_GPS);

    const file = buildFile(bytes, format, name, blocks);

    return {
        ok: true,
        file,
        resolution: buildResolution(bytes, file.width === null ? null : file),
        exif,
        gps,
        xmp,
        icc,
        text,
        other,
        privacy: buildPrivacy(bytes, {
            exif, gps, xmp, text, other,
        }),
        problems: [...new Set(problems)],
        raw: buildRaw(format, blocks, read, xmp, icc),
    };
}
