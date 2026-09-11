/**
 * favicon.ico — the container, written and read back.
 *
 * WHY THIS FORMAT IS STILL HERE IN 2026
 *
 * An .ico is not an image format. It is a directory of images in one file, and
 * that is the whole reason it survived: a browser, a desktop shortcut and a
 * taskbar all want the same icon at different sizes, and one file answers all
 * three. Browsers still look for /favicon.ico at the site root whether or not a
 * page links to one, so it is the single file that works with no markup at all.
 *
 * THE STRUCTURE, FROM MICROSOFT'S OWN DOCUMENTATION
 *
 *   ICONDIR      { WORD idReserved = 0; WORD idType = 1; WORD idCount }
 *   ICONDIRENTRY { BYTE bWidth; BYTE bHeight; BYTE bColorCount; BYTE bReserved;
 *                  WORD wPlanes; WORD wBitCount; DWORD dwBytesInRes;
 *                  DWORD dwImageOffset }
 *
 * All little-endian. The dimensions are ONE BYTE each, so 256 is stored as 0 —
 * the one piece of this format that cannot be guessed from reading the fields.
 * bColorCount is 0 for anything with 8 or more bits per pixel, which is every
 * image this file will ever write.
 *
 * WHY THE PAYLOADS ARE PNGs AND WHAT THAT COSTS
 *
 * The 1995 structure above predates PNG entirely: its payloads were DIB
 * bitmaps, and a writer producing those would owe a 1-bit AND mask and a
 * bottom-up row order. Every current browser also accepts a whole PNG file as
 * the payload, which is smaller, keeps real alpha and is exactly what the
 * engine has already encoded for the loose 16 and 32 icons. Support for it is
 * not in the document above, so this project proves it rather than asserting
 * it: the E2E suite decodes a generated favicon.ico in an <img> in Chromium,
 * Firefox and WebKit. That is the only claim the page makes about it.
 *
 * WHY THE READER IS IN THE SAME FILE AS THE WRITER
 *
 * It is not an independent check — the tests own one of those, written from the
 * structure above and importing nothing from here. This one is the ENGINE's
 * check: the icons op parses its own favicon.ico before offering it, because
 * every way this file can be wrong is invisible. A browser handed a directory
 * whose offsets are one byte out draws its default icon and reports nothing, in
 * any console, on any platform. So a wrong offset has to be caught here or it
 * ships.
 *
 * Nothing in this file allocates a pixel surface or imports a codec. It moves
 * bytes, and it is a leaf on purpose.
 */

const HEADER_BYTES = 6;
const ENTRY_BYTES = 16;

/** 0 in a one-byte dimension field means 256. */
const LARGEST_SIZE = 256;

/** One plane, 32 bits per pixel — an RGBA image, which is all this writes. */
const PLANES = 1;
const BIT_COUNT = 32;

const PNG_SIGNATURE = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];

/** Signature (8) + length (4) + 'IHDR' (4) + width (4) + height (4). */
const IHDR_END = 24;

function toBytes(input) {
    if (input instanceof Uint8Array) return input;
    if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
    if (input instanceof ArrayBuffer) return new Uint8Array(input);
    return null;
}

/** The byte a dimension is stored in: the size itself, or 0 for 256. */
function dimensionByte(size) {
    return size === LARGEST_SIZE ? 0 : size;
}

/** What a stored dimension byte means. */
function dimensionValue(byte) {
    return byte === 0 ? LARGEST_SIZE : byte;
}

function isSquareSize(value) {
    return Number.isInteger(value) && value >= 1 && value <= LARGEST_SIZE;
}

/** '16 × 16' — how every message below names the entry it is about. */
function describe(width, height) {
    return `${width} × ${height}`;
}

function big32(bytes, at) {
    return ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0;
}

/**
 * Writes an ICO whose payloads are whole PNG files.
 *
 * Entries are written in the order given and the offsets are cumulative from
 * the end of the directory, which is where every reader expects the first
 * payload to start. Nothing here inspects a payload: the directory states what
 * the caller said, and readIco is what holds the caller to it — a writer that
 * silently corrected a mismatch would hide the bug rather than report it.
 *
 * @param {Array<{ size: number, png: Uint8Array }>} entries
 * @returns {Uint8Array}
 */
export function buildIco(entries) {
    if (!Array.isArray(entries) || entries.length === 0) {
        throw new Error('An icon file needs at least one image.');
    }

    if (entries.length > 0xFFFF) {
        throw new Error('An icon file cannot hold that many images.');
    }

    const payloads = entries.map((entry, index) => {
        if (!isSquareSize(entry?.size)) {
            throw new Error(`Image ${index + 1} has no usable icon size.`);
        }

        const png = toBytes(entry.png);
        if (!png || png.length === 0) {
            throw new Error(`Image ${index + 1} (${describe(entry.size, entry.size)}) has no bytes.`);
        }

        return { size: entry.size, png };
    });

    const directoryEnd = HEADER_BYTES + payloads.length * ENTRY_BYTES;
    const total = payloads.reduce((sum, entry) => sum + entry.png.length, directoryEnd);

    const bytes = new Uint8Array(total);
    const data = new DataView(bytes.buffer);

    data.setUint16(0, 0, true);
    data.setUint16(2, 1, true);
    data.setUint16(4, payloads.length, true);

    let offset = directoryEnd;

    payloads.forEach((entry, index) => {
        const at = HEADER_BYTES + index * ENTRY_BYTES;

        bytes[at] = dimensionByte(entry.size);
        bytes[at + 1] = dimensionByte(entry.size);
        bytes[at + 2] = 0;
        bytes[at + 3] = 0;
        data.setUint16(at + 4, PLANES, true);
        data.setUint16(at + 6, BIT_COUNT, true);
        data.setUint32(at + 8, entry.png.length, true);
        data.setUint32(at + 12, offset, true);

        bytes.set(entry.png, offset);
        offset += entry.png.length;
    });

    return bytes;
}

/**
 * Reads an ICO back and refuses anything inconsistent.
 *
 * Throws a plain Error naming the fault — the caller turns it into a refusal a
 * person can read, and nothing in these messages is a stack trace or a codec
 * string. The checks run in the order a fault makes the next one meaningless:
 * the header, then every entry's bounds, then whether any two payloads overlap,
 * and only then what the payloads actually contain.
 *
 * @param {Uint8Array|ArrayBuffer} input
 * @returns {{ count: number, entries: Array<{ width: number, height: number,
 *             bytes: Uint8Array, offset: number, isPng: boolean,
 *             pngWidth: number, pngHeight: number }> }}
 */
export function readIco(input) {
    const bytes = toBytes(input);

    if (!bytes) throw new Error('There are no bytes to read as an icon file.');
    if (bytes.length < HEADER_BYTES) throw new Error('These bytes are too short to be an icon file.');

    const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

    const reserved = data.getUint16(0, true);
    if (reserved !== 0) throw new Error(`The icon's reserved word is ${reserved}, not 0.`);

    const type = data.getUint16(2, true);
    if (type !== 1) throw new Error(`The icon's type is ${type}, not 1 (an icon).`);

    const count = data.getUint16(4, true);
    if (count === 0) throw new Error('The icon directory has no entries.');

    const directoryEnd = HEADER_BYTES + count * ENTRY_BYTES;
    if (bytes.length < directoryEnd) {
        throw new Error(`The icon directory needs ${directoryEnd} bytes and the file holds ${bytes.length}.`);
    }

    const entries = [];

    for (let index = 0; index < count; index += 1) {
        const at = HEADER_BYTES + index * ENTRY_BYTES;
        const width = dimensionValue(bytes[at]);
        const height = dimensionValue(bytes[at + 1]);
        const length = data.getUint32(at + 8, true);
        const offset = data.getUint32(at + 12, true);
        const name = `Entry ${index + 1} (${describe(width, height)})`;

        if (length === 0) throw new Error(`${name} has no payload.`);
        if (offset < directoryEnd) throw new Error(`${name} overlaps the icon directory.`);
        if (offset + length > bytes.length) throw new Error(`${name} lies outside the file.`);

        entries.push({ index, width, height, offset, length, name });
    }

    for (let a = 0; a < entries.length; a += 1) {
        for (let b = a + 1; b < entries.length; b += 1) {
            const first = entries[a];
            const second = entries[b];
            const overlaps = first.offset < second.offset + second.length
                && second.offset < first.offset + first.length;

            if (overlaps) {
                throw new Error(`${first.name} and ${second.name} overlap in the file.`);
            }
        }
    }

    return {
        count,
        entries: entries.map((entry) => {
            const payload = bytes.subarray(entry.offset, entry.offset + entry.length);

            const isPng = payload.length >= IHDR_END
                && PNG_SIGNATURE.every((byte, at) => payload[at] === byte);

            if (!isPng) throw new Error(`${entry.name} is not a PNG.`);

            const pngWidth = big32(payload, 16);
            const pngHeight = big32(payload, 20);

            if (pngWidth !== entry.width || pngHeight !== entry.height) {
                throw new Error(
                    `${entry.name} carries a ${describe(pngWidth, pngHeight)} PNG.`,
                );
            }

            return {
                width: entry.width,
                height: entry.height,
                bytes: payload,
                offset: entry.offset,
                isPng: true,
                pngWidth,
                pngHeight,
            };
        }),
    };
}
