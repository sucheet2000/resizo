/**
 * An ICC profile's header and its name — nothing else, and no colour maths.
 *
 * WHY A VIEWER NEEDS THIS AT ALL. metadata-strip.js keeps ICC profiles on
 * purpose: a profile is colour, not identity, and dropping it shifts every
 * pixel a viewer draws while telling the person their privacy improved. That
 * decision is only defensible if the page can SAY what stayed, so this reads
 * the four facts a person can act on — what it is called, what colour space it
 * describes, which version wrote it, and how big it is.
 *
 * THE TAG TABLE IS ATTACKER-CONTROLLED. Behind a fixed 128-byte header sits a
 * count and that many (signature, offset, size) triples, every number chosen by
 * whoever wrote the file. A description can claim to start past the end of the
 * profile and to run for 400 MB. So the count is capped, every offset is
 * resolved against the profile's own length, and a failure is a null rather
 * than a throw: a page that cannot name a colour profile still has a photograph
 * to describe.
 *
 * TWO SHAPES, BOTH REAL. ICC v2 stores its name as a `desc` textDescription —
 * a count and an ASCII string. ICC v4 stores it as `mluc`, a table of language
 * records holding UTF-16BE, and that is what a modern sRGB profile carries. The
 * first record is used; picking a locale would mean carrying a locale.
 *
 * A PNG's iCCP profile is zlib-compressed and is NOT handed here. There is no
 * inflater in this engine and adding one is a dependency, so a PNG's profile is
 * reported by name and size and never opened. locateMetadata marks it
 * `compressed`.
 *
 * Imports nothing.
 */

/** Where the tag table's count sits, and how long one table entry is. */
const HEADER_LENGTH = 128;
const TAG_COUNT_OFFSET = 128;
const TAG_TABLE_OFFSET = 132;
const TAG_ENTRY_LENGTH = 12;

/** No real profile has more; a claim of half a million is not a profile. */
const MAX_TAGS = 256;

/** A profile's name is a name. Anything longer is not being read by a person. */
const MAX_DESCRIPTION_CHARS = 256;

const DESCRIPTION_TAG = 'desc';
const TEXT_DESCRIPTION_TYPE = 'desc';
const MULTI_LOCALISED_TYPE = 'mluc';

/** textDescription: signature, reserved, ASCII count, then the string. */
const TEXT_ASCII_COUNT_OFFSET = 8;
const TEXT_ASCII_OFFSET = 12;

/** mluc: signature, reserved, record count, record size, then the records. */
const MLUC_RECORD_COUNT_OFFSET = 8;
const MLUC_FIRST_RECORD_OFFSET = 16;
const MLUC_LENGTH_OFFSET = 4;
const MLUC_OFFSET_OFFSET = 8;

const EMPTY = {
    bytes: 0,
    version: null,
    deviceClass: null,
    colourSpace: null,
    pcs: null,
    description: null,
};

function toBytes(value) {
    if (value instanceof Uint8Array) return value;
    if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    return null;
}

function readU32BE(bytes, at) {
    return bytes[at] * 16777216 + bytes[at + 1] * 65536 + bytes[at + 2] * 256 + bytes[at + 3];
}

function readU16BE(bytes, at) {
    return bytes[at] * 256 + bytes[at + 1];
}

/** A four-character signature, trimmed: 'RGB ' is the space-padded 'RGB'. */
function signature(bytes, at) {
    let out = '';
    for (let index = at; index < at + 4; index += 1) out += String.fromCharCode(bytes[index]);
    return out.replace(/\0/g, '').trim() || null;
}

/**
 * '4.2' from the two bytes that hold it: a major number, then a minor and a bug
 * fix packed into one byte's nibbles. Only the first two are shown, because
 * that is what a profile calls itself.
 */
function versionOf(bytes) {
    return `${bytes[8]}.${(bytes[9] >> 4) & 0x0F}`;
}

function trimText(text) {
    const cleaned = text.replace(/\0+$/, '').trim();
    if (!cleaned) return null;
    return cleaned.length > MAX_DESCRIPTION_CHARS
        ? cleaned.slice(0, MAX_DESCRIPTION_CHARS)
        : cleaned;
}

function readAscii(bytes, at, length) {
    let out = '';
    for (let index = at; index < at + length; index += 1) {
        const byte = bytes[index];
        if (byte === 0) break;
        if (out.length >= MAX_DESCRIPTION_CHARS) break;
        out += String.fromCharCode(byte);
    }
    return trimText(out);
}

function readUtf16BE(bytes, at, length) {
    let out = '';
    for (let index = 0; index + 1 < length; index += 2) {
        const unit = readU16BE(bytes, at + index);
        if (unit === 0) break;
        if (out.length >= MAX_DESCRIPTION_CHARS) break;
        out += String.fromCharCode(unit);
    }
    return trimText(out);
}

function readTextDescription(bytes, at, size, end) {
    if (at + TEXT_ASCII_OFFSET > end) return null;

    const declared = readU32BE(bytes, at + TEXT_ASCII_COUNT_OFFSET);
    const start = at + TEXT_ASCII_OFFSET;
    // The declared count has to fit inside the tag AND inside the profile. A
    // string that claims to run past either is not a string this will read.
    if (declared === 0 || start + declared > end || TEXT_ASCII_OFFSET + declared > size) return null;

    return readAscii(bytes, start, declared);
}

function readMultiLocalised(bytes, at, end) {
    if (at + MLUC_FIRST_RECORD_OFFSET + 12 > end) return null;
    if (readU32BE(bytes, at + MLUC_RECORD_COUNT_OFFSET) === 0) return null;

    const record = at + MLUC_FIRST_RECORD_OFFSET;
    const length = readU32BE(bytes, record + MLUC_LENGTH_OFFSET);
    // Every offset inside an mluc is relative to the start of the tag itself.
    const start = at + readU32BE(bytes, record + MLUC_OFFSET_OFFSET);

    if (length === 0 || start < at || start + length > end) return null;
    return readUtf16BE(bytes, start, length);
}

/** The 'desc' tag's range, from the tag table. Null when there is not one. */
function findDescription(bytes, end) {
    if (TAG_TABLE_OFFSET > end) return null;

    const declared = readU32BE(bytes, TAG_COUNT_OFFSET);
    const count = Math.min(declared, MAX_TAGS);

    for (let index = 0; index < count; index += 1) {
        const slot = TAG_TABLE_OFFSET + index * TAG_ENTRY_LENGTH;
        if (slot + TAG_ENTRY_LENGTH > end) return null;

        if (signature(bytes, slot) !== DESCRIPTION_TAG) continue;

        const at = readU32BE(bytes, slot + 4);
        const size = readU32BE(bytes, slot + 8);
        if (at < HEADER_LENGTH || size < 8 || at + size > end) return null;

        return { at, size };
    }

    return null;
}

function descriptionOf(bytes, end) {
    const tag = findDescription(bytes, end);
    if (!tag) return null;

    const type = signature(bytes, tag.at);
    const limit = tag.at + tag.size;

    if (type === TEXT_DESCRIPTION_TYPE) return readTextDescription(bytes, tag.at, tag.size, limit);
    if (type === MULTI_LOCALISED_TYPE) return readMultiLocalised(bytes, tag.at, limit);
    return null;
}

/**
 * What an ICC profile says about itself.
 *
 * Takes the profile bytes as they sit in the file — a WebP ICCP chunk, or a
 * JPEG's APP2 pieces already joined in sequence order. Never the container.
 *
 * @param {Uint8Array|ArrayBuffer|ArrayBufferView} input
 * @returns {{ bytes: number, version: string|null, deviceClass: string|null,
 *             colourSpace: string|null, pcs: string|null, description: string|null }}
 */
export function readIccProfile(input) {
    const bytes = toBytes(input);
    if (!bytes || bytes.length < HEADER_LENGTH) return { ...EMPTY, bytes: bytes ? bytes.length : 0 };

    try {
        return {
            bytes: bytes.length,
            version: versionOf(bytes),
            deviceClass: signature(bytes, 12),
            colourSpace: signature(bytes, 16),
            pcs: signature(bytes, 20),
            description: descriptionOf(bytes, bytes.length),
        };
    } catch {
        // Unreachable by design — every read above is bounded — and a colour
        // profile is never worth taking a report down for.
        return { ...EMPTY, bytes: bytes.length };
    }
}
