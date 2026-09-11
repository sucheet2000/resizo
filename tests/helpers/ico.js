/**
 * An ICO reader written from Microsoft's own structure — A TEST HELPER, NOT
 * PRODUCT CODE.
 *
 * IT NEVER IMPORTS lib/image-client/ico.js, AND THAT IS THE WHOLE POINT. The
 * engine writes a favicon.ico and then reads its own file back to check it.
 * That check is worth having, but it can only ever prove the writer agrees
 * with the reader sitting next to it: one wrong constant shared by both — an
 * offset counted from the first entry instead of from the file, a dimension
 * byte written little-endian — is invisible from inside. This file is the
 * second opinion, written from the document rather than from the code:
 *
 *   Microsoft, "Icons" (John Hornick, MSDN archive, updated 2021-12-02)
 *   https://learn.microsoft.com/en-us/previous-versions/ms997538(v=msdn.10)
 *
 *     ICONDIR       WORD idReserved   always 0
 *                   WORD idType       1 for an icon, 2 for a cursor
 *                   WORD idCount      how many images follow
 *
 *     ICONDIRENTRY  BYTE bWidth       pixels across, 0 meaning 256
 *                   BYTE bHeight      pixels down,   0 meaning 256
 *                   BYTE bColorCount  0 when the image is 8 bpp or deeper
 *                   BYTE bReserved    always 0
 *                   WORD wPlanes
 *                   WORD wBitCount
 *                   DWORD dwBytesInRes    the payload's length
 *                   DWORD dwImageOffset   where the payload starts IN THE FILE
 *
 *   every field little-endian, idCount entries directly after the ICONDIR, and
 *   the payloads after those.
 *
 * PNG-COMPRESSED PAYLOADS ARE NOT IN THAT 1995 DOCUMENT. It describes DIB
 * images, and a modern favicon.ico carries PNGs instead — which browsers
 * accept and the document cannot promise. So this reader REPORTS whether a
 * payload is a PNG (`isPng`) rather than assuming it, and reads the size out
 * of the PNG's own IHDR so the directory's claim can be checked against the
 * picture it describes. Whether a browser renders it is a different question
 * and not one a parser can answer: the E2E suite settles that by decoding the
 * generated file in an <img> in Chromium, Firefox and WebKit.
 *
 * WHAT IT THROWS ON, and why each one is a fault rather than a curiosity:
 *
 *   a non-zero idReserved / an idType that is not 1   not an icon file at all
 *   idCount 0                                          an icon file with no icons
 *   a payload that starts inside the directory         two structures over one byte
 *   a payload that runs past the end of the file       a truncated download
 *   two payloads that overlap                          one image inside another
 *   a PNG whose IHDR disagrees with the directory      the entry a browser picks
 *                                                      by size is not that size
 *
 * The last one is the failure worth the most: a browser chooses an entry by
 * the DIRECTORY's numbers and then draws what the payload actually holds, so
 * an ICO whose 32 × 32 slot contains a 31 × 31 picture looks fine in a viewer
 * that ignores the directory and wrong in the tab bar.
 *
 * CommonJS on purpose: the Playwright specs require it and the vitest suite
 * imports it, and one reader means a flow and a unit test cannot disagree
 * about what "three entries, no overlap" means.
 */

const ICONDIR_SIZE = 6;
const ICONDIRENTRY_SIZE = 16;

/** 137 80 78 71 13 10 26 10 — the PNG signature, from the PNG spec. */
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);

/** signature (8) + length (4) + "IHDR" (4) + width (4) + height (4). */
const IHDR_END = 24;

/** A dimension byte of 0 means 256; the byte cannot hold 256 itself. */
const WIDE_DIMENSION = 256;

function toBuffer(input) {
    if (Buffer.isBuffer(input)) return input;
    if (input instanceof ArrayBuffer) return Buffer.from(input);
    if (ArrayBuffer.isView(input)) return Buffer.from(input.buffer, input.byteOffset, input.byteLength);
    if (Array.isArray(input)) return Buffer.from(input);
    throw new Error(`parseIco needs bytes, not ${input === null ? 'null' : typeof input}`);
}

/** The first few bytes as hex, so a "not a PNG" failure says what it found. */
function head(bytes, count = 8) {
    return [...bytes.subarray(0, count)].map((byte) => byte.toString(16).padStart(2, '0')).join(' ');
}

/**
 * The size the PNG itself claims, or null when the payload is not a PNG.
 *
 * The IHDR is the first chunk of every PNG by the spec, so its width and
 * height sit at fixed offsets 16 and 20. A payload that carries the signature
 * and then does not carry an IHDR is corrupt rather than "not a PNG", and says
 * so.
 */
function pngSize(payload, where) {
    if (payload.length < PNG_SIGNATURE.length) return null;
    if (!payload.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) return null;

    if (payload.length < IHDR_END) {
        throw new Error(`${where}: a PNG payload of ${payload.length} bytes is too short to hold an IHDR`);
    }

    const type = payload.subarray(12, 16).toString('latin1');
    if (type !== 'IHDR') {
        throw new Error(`${where}: the PNG signature is followed by a "${type}" chunk, not IHDR`);
    }

    return { width: payload.readUInt32BE(16), height: payload.readUInt32BE(20) };
}

/**
 * Reads an ICO and reports everything in it, or throws naming the fault.
 *
 * @param {Buffer|Uint8Array|ArrayBuffer|number[]} input  the file's bytes
 * @returns {{
 *   bytes: number,
 *   header: { reserved: number, type: number, count: number },
 *   entries: Array<{
 *     index: number,
 *     width: number, height: number,
 *     rawWidth: number, rawHeight: number,
 *     colorCount: number, planes: number, bitCount: number,
 *     bytes: number, offset: number,
 *     isPng: boolean, pngWidth: number|null, pngHeight: number|null,
 *     data: Buffer,
 *   }>,
 *   trailing: number,
 * }}
 *   `width`/`height` are resolved (0 read as 256); `rawWidth`/`rawHeight` are
 *   the bytes as stored, so a test can tell a 256 from a zero. `trailing` is
 *   whatever sits after the last payload — not a fault on its own, but a place
 *   bytes can hide.
 */
function parseIco(input) {
    const buffer = toBuffer(input);

    if (buffer.length < ICONDIR_SIZE) {
        throw new Error(`not an ICO: ${buffer.length} bytes is shorter than the 6-byte ICONDIR`);
    }

    const reserved = buffer.readUInt16LE(0);
    if (reserved !== 0) throw new Error(`not an ICO: idReserved is ${reserved}, not 0`);

    const type = buffer.readUInt16LE(2);
    if (type !== 1) {
        throw new Error(`not an ICO: idType is ${type}, not 1${type === 2 ? ' (2 is a cursor)' : ''}`);
    }

    const count = buffer.readUInt16LE(4);
    if (count === 0) throw new Error('not an ICO: idCount is 0 — an icon file with no images in it');

    const directoryEnd = ICONDIR_SIZE + ICONDIRENTRY_SIZE * count;
    if (buffer.length < directoryEnd) {
        throw new Error(
            `truncated ICO: ${count} entries need ${directoryEnd} bytes of directory, `
            + `but the file is ${buffer.length} bytes`,
        );
    }

    const entries = [];

    for (let index = 0; index < count; index += 1) {
        const at = ICONDIR_SIZE + ICONDIRENTRY_SIZE * index;
        const where = `entry ${index}`;

        const rawWidth = buffer.readUInt8(at);
        const rawHeight = buffer.readUInt8(at + 1);
        const entryReserved = buffer.readUInt8(at + 3);
        const bytes = buffer.readUInt32LE(at + 8);
        const offset = buffer.readUInt32LE(at + 12);

        if (entryReserved !== 0) {
            throw new Error(`${where}: bReserved is ${entryReserved}, not 0`);
        }
        if (bytes === 0) {
            throw new Error(`${where}: dwBytesInRes is 0 — a directory entry with no image behind it`);
        }
        if (offset < directoryEnd) {
            throw new Error(
                `${where}: dwImageOffset ${offset} is inside the ${directoryEnd}-byte directory`,
            );
        }
        if (offset + bytes > buffer.length) {
            throw new Error(
                `${where}: bytes ${offset}..${offset + bytes} run past the end of the `
                + `${buffer.length}-byte file`,
            );
        }

        const width = rawWidth === 0 ? WIDE_DIMENSION : rawWidth;
        const height = rawHeight === 0 ? WIDE_DIMENSION : rawHeight;
        const data = buffer.subarray(offset, offset + bytes);
        const png = pngSize(data, where);

        if (png && (png.width !== width || png.height !== height)) {
            throw new Error(
                `${where}: the directory says ${width} × ${height} but the PNG's IHDR says `
                + `${png.width} × ${png.height}`,
            );
        }

        entries.push({
            index,
            width,
            height,
            rawWidth,
            rawHeight,
            colorCount: buffer.readUInt8(at + 2),
            planes: buffer.readUInt16LE(at + 4),
            bitCount: buffer.readUInt16LE(at + 6),
            bytes,
            offset,
            isPng: png !== null,
            pngWidth: png ? png.width : null,
            pngHeight: png ? png.height : null,
            data,
        });
    }

    // Overlap is checked across the whole file rather than pairwise in
    // directory order: entries may legally be listed in any order, and two
    // payloads sharing a byte is a fault whichever way round they are stored.
    const byOffset = [...entries].sort((a, b) => a.offset - b.offset);
    for (let i = 1; i < byOffset.length; i += 1) {
        const previous = byOffset[i - 1];
        const current = byOffset[i];
        const previousEnd = previous.offset + previous.bytes;
        if (current.offset < previousEnd) {
            throw new Error(
                `entries ${previous.index} and ${current.index} overlap: `
                + `${previous.offset}..${previousEnd} and ${current.offset}..${current.offset + current.bytes}`,
            );
        }
    }

    const lastEnd = byOffset.length > 0
        ? byOffset[byOffset.length - 1].offset + byOffset[byOffset.length - 1].bytes
        : directoryEnd;

    return {
        bytes: buffer.length,
        header: { reserved, type, count },
        entries,
        trailing: buffer.length - lastEnd,
    };
}

/**
 * `parseIco`, plus the two things a favicon.ico this product wrote must also be
 * true of: every payload is a PNG, and the entries are exactly the sizes asked
 * for, in order.
 *
 * Kept separate from `parseIco` because they are different questions. A BMP
 * payload is a legal ICO and a wrong Resizo output; a parser that refused to
 * read one could not tell a test which of the two it was looking at.
 *
 * @param {Buffer|Uint8Array|ArrayBuffer|number[]} input  the file's bytes
 * @param {{ sizes?: number[] }} [expected]  the square sizes, in directory order
 */
function assertPngIco(input, { sizes } = {}) {
    const ico = parseIco(input);

    for (const entry of ico.entries) {
        if (!entry.isPng) {
            throw new Error(
                `entry ${entry.index} (${entry.width} × ${entry.height}) is not a PNG — `
                + `it starts ${head(entry.data)}`,
            );
        }
    }

    if (sizes) {
        const found = ico.entries.map((entry) => `${entry.width}x${entry.height}`);
        const wanted = sizes.map((size) => `${size}x${size}`);
        if (found.join(',') !== wanted.join(',')) {
            throw new Error(`the ICO holds ${found.join(', ')} — expected ${wanted.join(', ')}`);
        }
    }

    return ico;
}

module.exports = {
    assertPngIco,
    parseIco,
    ICONDIR_SIZE,
    ICONDIRENTRY_SIZE,
    PNG_SIGNATURE,
};
