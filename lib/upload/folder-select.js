/**
 * Folder picking for the bulk path.
 *
 * A single `<input webkitdirectory>` hands back every file under a chosen
 * folder, recursively, in one pick. It is not a moat — anything with a file
 * input can do the same — it is simply the right control for the job people
 * actually bring to a bulk resizer, which is "resize this folder of photos"
 * rather than "drag twenty files out of a window".
 *
 * WHAT THIS MODULE IS FOR
 *
 * A folder is not a selection. It is whatever happens to be on the disk: the
 * documents, the .DS_Store, the video the phone recorded next to the photos,
 * and — the part that matters — often hundreds of images where the tool takes
 * twenty. So the tree has to be read, filtered and COUNTED before anything is
 * added, and the person has to be told the real numbers.
 *
 * NOTHING IS TRUSTED EXCEPT THE BYTES
 *
 * The filter is the same magic-byte sniff every other intake path uses. An
 * extension is a claim, not evidence: a `.jpg` that is really a PDF must be
 * left out here, not discovered later by a decoder.
 *
 * THE COUNT LIMIT IS NOT RAISED, AND HERE IS WHY
 *
 * MAX_BULK_FILES is 20 and MAX_BULK_TOTAL_BYTES is 80 MB. Costed against
 * lib/image-client/capability.js on its own floor device — a 2021 phone, 4 GB,
 * so a 1024 MB tab budget, and 614 MB after the iOS haircut:
 *
 *   ONE IMAGE AT A TIME    a 12 MP source is a 48 MB RGBA surface; the decode
 *                          stage holds DECODE_SURFACE_COPIES of it plus the
 *                          file bytes, and WASM_BASELINE_BYTES sits underneath
 *                          — about 125 MB, and it is released before the next
 *                          file starts. This does not grow with the batch.
 *
 *   THE ZIP                does. JSZip holds every finished image's bytes,
 *                          generateAsync serialises the whole archive into a
 *                          second copy, and the Blob is a third — the same
 *                          three resident copies capability.js already charges
 *                          a PDF (PDF_DOCUMENT_COPIES). Bounded by the 80 MB
 *                          byte cap, that is up to 240 MB.
 *
 * 125 + 240 is ~365 MB against a 614 MB iOS budget. The headroom is real, and
 * it is the BYTE cap that produces it. Raising the file count buys nothing: the
 * ZIP is priced in bytes, twenty phone photos already reach 80 MB, and a folder
 * of three hundred photos is closer to 900 MB — no count limit makes that fit.
 * MAX_BULK_FILES is also shared with /jpg-to-pdf and /merge-pdf, whose peak IS
 * dominated by an accumulating document, so moving it here would quietly move
 * it there too.
 *
 * So the cap stays, and the honesty is in the UI instead: the folder is counted
 * in full, the first N that fit are added, and the message says how many images
 * were found, how many were added and why the rest were not.
 */
import {
    MAX_BULK_FILES,
    MAX_BULK_TOTAL_BYTES,
    MAX_FILE_SIZE,
    RASTER_INPUT_FORMATS,
} from '@/lib/limits';
import { formatFileSize } from '@/lib/format-bytes';
import { formatProse } from '@/lib/format/upload-helpers';
import { SIGNATURE_BYTES, sniffImageType } from '@/lib/image/magic-bytes';

/**
 * How many files deep into a folder the signature check goes.
 *
 * Reading a folder tree is cheap — a directory pick of 600 files was measured
 * at 127 ms — but sniffing is one small disk read per file, and a picked
 * Pictures folder can hold tens of thousands. A thousand is far past the point
 * where the answer can change (the batch takes twenty) and keeps the worst case
 * to well under a second. When the folder is bigger than this, the message says
 * so rather than reporting a count that is quietly a floor.
 */
export const FOLDER_SCAN_LIMIT = 1000;

/**
 * True when this browser's file input can take a whole folder.
 *
 * Read off the prototype rather than off an element, so it can be answered
 * before anything is rendered. Cross-browser Baseline since August 2025, but
 * the detect stays: where it is false the folder control is not rendered at all
 * and the drag-and-drop and file-picker paths are exactly what they were.
 *
 * Deliberately NOT showDirectoryPicker: that is the File System Access API,
 * which is Chromium-only — Firefox filed a "harmful" standards position and
 * WebKit opposed it — so it could never be the primary way in.
 */
export function folderPickSupported(scope = globalThis) {
    const InputElement = scope?.HTMLInputElement;
    if (typeof InputElement !== 'function' || !InputElement.prototype) return false;
    return 'webkitdirectory' in InputElement.prototype;
}

/** Where a picked file sat, as the browser reported it. '' for a drop or a plain pick. */
export function relativePathOf(file) {
    const path = file?.webkitRelativePath;
    return typeof path === 'string' ? path : '';
}

/**
 * True for anything inside a dot-directory or named with a leading dot.
 * .DS_Store, .thumbnails and Windows' hidden folders are noise a person did not
 * choose and should never be counted as "files that were not images".
 */
export function isHiddenPath(relativePath) {
    return String(relativePath ?? '')
        .split(/[\\/]/)
        .some((segment) => segment.startsWith('.'));
}

/** Tree order is not name order; a person predicting "the first twenty" reads names. */
function byPath(a, b) {
    const left = relativePathOf(a) || a?.name || '';
    const right = relativePathOf(b) || b?.name || '';
    return left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' });
}

async function sniffHead(file, sniff) {
    try {
        const head = await file.slice(0, SIGNATURE_BYTES).arrayBuffer();
        return sniff(new Uint8Array(head));
    } catch {
        return null;
    }
}

/**
 * Reads a folder pick and decides what of it can be added.
 *
 * @param {object} input
 * @param {File[]} input.files            everything the directory input handed back
 * @param {string[]} [input.accept]       formats this tool takes, as sniffed names
 * @param {number} [input.maxBytes]       per-file cap
 * @param {number} [input.capacityFiles]  how many more files the batch can hold
 * @param {number} [input.capacityBytes]  how many more bytes the batch can hold
 * @param {function} [input.sniff]        injectable signature reader
 * @param {number} [input.scanLimit]
 * @returns {Promise<object>} the counts, and `files` — the ones to add, in name order
 */
export async function scanFolderPick({
    files,
    accept = RASTER_INPUT_FORMATS,
    maxBytes = MAX_FILE_SIZE,
    capacityFiles = MAX_BULK_FILES,
    capacityBytes = MAX_BULK_TOTAL_BYTES,
    sniff = sniffImageType,
    scanLimit = FOLDER_SCAN_LIMIT,
} = {}) {
    const all = (Array.isArray(files) ? files : Array.from(files ?? [])).filter(Boolean);
    const visible = all.filter((file) => !isHiddenPath(relativePathOf(file)));
    const scanned = visible.slice(0, scanLimit).sort(byPath);

    const taken = [];
    let takenBytes = 0;
    let usable = 0;
    let notImages = 0;
    let tooBig = 0;

    for (const file of scanned) {
        const size = Number(file?.size);

        // An empty entry is what a browser reports for the folder itself and
        // for anything it could not read. Not an image, and not worth counting
        // as a file someone chose.
        if (!Number.isFinite(size) || size <= 0) continue;

        if (size > maxBytes) {
            // Costs one signature read to say "an image, but too big" rather
            // than lumping a 40 MB photo in with the spreadsheets.
            if (accept.includes(await sniffHead(file, sniff))) tooBig += 1;
            else notImages += 1;
            continue;
        }

        const format = await sniffHead(file, sniff);
        if (!format || !accept.includes(format)) {
            notImages += 1;
            continue;
        }

        usable += 1;

        if (taken.length < capacityFiles && takenBytes + size <= capacityBytes) {
            taken.push(file);
            takenBytes += size;
        }
    }

    return {
        files: taken,
        total: all.length,
        scanned: scanned.length,
        scanTruncated: visible.length > scanned.length,
        usable,
        added: taken.length,
        leftOver: usable - taken.length,
        notImages,
        tooBig,
        bytes: takenBytes,
    };
}

function count(n, singular, plural) {
    return `${n} ${n === 1 ? singular : plural}`;
}

function leftovers(summary, maxBytes) {
    const parts = [];
    if (summary.tooBig > 0) {
        parts.push(`${count(summary.tooBig, 'image was', 'images were')} over ${formatFileSize(maxBytes)} and ${summary.tooBig === 1 ? 'was' : 'were'} left out.`);
    }
    if (summary.notImages > 0) {
        parts.push(summary.notImages === 1
            ? '1 other file in there is not an image this tool reads.'
            : `${summary.notImages} other files in there are not images this tool reads.`);
    }
    return parts;
}

/**
 * The sentence a person reads after picking a folder.
 *
 * It always states the real number of usable images, even when most of them
 * could not be added — a batch that quietly kept twenty and said nothing about
 * the other two hundred would be the worst version of this feature.
 */
export function folderPickMessage(summary, {
    accept = RASTER_INPUT_FORMATS,
    maxBytes = MAX_FILE_SIZE,
    maxFiles = MAX_BULK_FILES,
    maxTotalBytes = MAX_BULK_TOTAL_BYTES,
} = {}) {
    if (!summary || summary.total === 0) return 'That folder has nothing in it.';

    const sentences = [];

    if (summary.scanTruncated) {
        sentences.push(`That folder holds more than ${summary.scanned} files, so the first ${summary.scanned} by name were checked.`);
    }

    if (summary.usable === 0) {
        sentences.push(`No ${formatProse(accept, 'or')} images were found in that folder.`);
        sentences.push(...leftovers(summary, maxBytes));
        return sentences.join(' ');
    }

    if (summary.added === 0) {
        sentences.push(`That folder has ${count(summary.usable, 'image', 'images')}, and this batch is already full at ${maxFiles} images and ${formatFileSize(maxTotalBytes)}.`);
        sentences.push('Resize these first, or remove a few to make room.');
        return sentences.join(' ');
    }

    if (summary.leftOver > 0) {
        sentences.push(`That folder has ${count(summary.usable, 'image', 'images')}. The first ${summary.added} by name ${summary.added === 1 ? 'was' : 'were'} added — one batch takes up to ${maxFiles} images and ${formatFileSize(maxTotalBytes)} in total, so the other ${summary.leftOver} ${summary.leftOver === 1 ? 'was' : 'were'} left out.`);
        // Deliberately not "pick the folder again": a second pick starts from
        // the same place and would hand back the same first twenty.
        sentences.push('Drag the rest in when these are done, or pick a subfolder.');
    } else {
        sentences.push(`Added ${count(summary.added, 'image', 'images')} from that folder.`);
    }

    sentences.push(...leftovers(summary, maxBytes));
    return sentences.join(' ');
}

export default scanFolderPick;
