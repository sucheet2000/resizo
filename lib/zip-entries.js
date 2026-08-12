/**
 * ZIP Central Directory Reader
 *
 * The bulk route answers with a ZIP and nothing else, so the only way the
 * batch result panel can print a real "after" size for each file — which
 * DESIGN.md requires, per-file `old → new  −N%` rows plus a total line — is to
 * read the archive's own index.
 *
 * That index is 46 bytes of header per entry sitting at the end of the file.
 * Reading it costs nothing and needs no unzip library in the browser bundle;
 * decompressing twenty images client-side just to measure them would cost tens
 * of megabytes of phone memory for numbers the archive already states.
 *
 * Entries come back in central-directory order, which is the order they were
 * added, which is the order the files were uploaded.
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
