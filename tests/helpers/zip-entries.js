/**
 * ZIP Central Directory Reader — A TEST HELPER, NOT PRODUCT CODE
 *
 * It reads the 46-byte central-directory header per entry that sits at the end
 * of a ZIP, so a test can assert what lib/upload/bulk-batch.js actually put in
 * the archive — the names, the folder paths and the sizes — without pulling an
 * unzip library into the suite or decompressing twenty images to measure them.
 *
 * Entries come back in central-directory order, which is the order they were
 * added, which is the order the files were picked.
 *
 * IT LIVED IN lib/ AND NOTHING IN lib/ EVER IMPORTED IT. Sitting beside the
 * engine it read as production ZIP-reading capability the site does not have:
 * the bulk result panel gets its per-file sizes from the batch loop, which
 * measured every blob before it was ever zipped, and never by reading the
 * archive back. Only tests call this, so it lives with them.
 */

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;

const EOCD_FIXED_SIZE = 22;
const CENTRAL_FIXED_SIZE = 46;

// A ZIP comment is a uint16 length, so the end-of-central-directory record can
// never sit further than this from the last byte.
const MAX_COMMENT_LENGTH = 0xFFFF;

// MS-DOS directory attribute, the second of the two ways a ZIP marks a folder.
const DOS_DIRECTORY_FLAG = 0x10;

function toView(input) {
    if (input instanceof ArrayBuffer) return new DataView(input);
    if (ArrayBuffer.isView(input)) {
        return new DataView(input.buffer, input.byteOffset, input.byteLength);
    }
    return null;
}

function findEndOfCentralDirectory(view) {
    const last = view.byteLength - EOCD_FIXED_SIZE;
    const first = Math.max(0, last - MAX_COMMENT_LENGTH);

    // Scanned backwards: a stored file may legally contain these four bytes,
    // and the real record is always the last match.
    for (let offset = last; offset >= first; offset -= 1) {
        if (view.getUint32(offset, true) === EOCD_SIGNATURE) return offset;
    }

    return -1;
}

function decodeName(view, start, length) {
    if (length === 0) return '';
    const bytes = new Uint8Array(view.buffer, view.byteOffset + start, length);
    try {
        return new TextDecoder('utf-8').decode(bytes);
    } catch {
        return '';
    }
}

/**
 * @param {ArrayBuffer|ArrayBufferView} input the whole archive
 * @returns {Array<{ name: string, size: number, compressedSize: number }>}
 *          uncompressed sizes in bytes, directories omitted. Returns [] for
 *          anything that is not a readable ZIP rather than throwing — a result
 *          panel that cannot show a number must still show the download.
 */
export function readZipEntries(input) {
    const view = toView(input);
    if (!view || view.byteLength < EOCD_FIXED_SIZE) return [];

    const eocd = findEndOfCentralDirectory(view);
    if (eocd < 0) return [];

    const total = view.getUint16(eocd + 10, true);
    let offset = view.getUint32(eocd + 16, true);

    const entries = [];

    for (let index = 0; index < total; index += 1) {
        if (offset < 0 || offset + CENTRAL_FIXED_SIZE > view.byteLength) break;
        if (view.getUint32(offset, true) !== CENTRAL_SIGNATURE) break;

        const compressedSize = view.getUint32(offset + 20, true);
        const size = view.getUint32(offset + 24, true);
        const nameLength = view.getUint16(offset + 28, true);
        const extraLength = view.getUint16(offset + 30, true);
        const commentLength = view.getUint16(offset + 32, true);
        const externalAttributes = view.getUint32(offset + 38, true);

        const nameStart = offset + CENTRAL_FIXED_SIZE;
        if (nameStart + nameLength > view.byteLength) break;

        const name = decodeName(view, nameStart, nameLength);
        const isDirectory = name.endsWith('/') || (externalAttributes & DOS_DIRECTORY_FLAG) !== 0;

        if (!isDirectory) entries.push({ name, size, compressedSize });

        offset = nameStart + nameLength + extraLength + commentLength;
    }

    return entries;
}

export default readZipEntries;
