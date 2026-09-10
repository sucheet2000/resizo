/**
 * The batch platform — one list of files, one operation, one set of answers.
 *
 * This is everything about running a batch that has no opinion about what the
 * batch DOES. The row shape, the sequencing, the download names, the
 * cancellation rule, the summary and the ZIP manifest were written for the bulk
 * compressor and are not about compression at all: the converter asks the same
 * questions of the same rows and would otherwise have needed a second copy of
 * every one of them.
 *
 * `settings` is opaque here on purpose. The compressor's are a byte ceiling and
 * a mode, the converter's are an output format, a quality and a background, and
 * this module reads neither — it copies them onto every seeded row so the panel
 * can say which settings produced what is on screen, and hands them to the
 * per-file processor, which is the only thing that knows what they mean.
 *
 * Pure module: no React, no catalog, no codec.
 */
import { readImageSize } from '@/lib/image-client/requirements';
import { joinZipPath, uniqueName } from '@/lib/image/filename';
import { assembleZip } from '@/lib/upload/bulk-batch';

export const STATUS = {
    waiting: 'waiting',
    processing: 'processing',
    success: 'success',
    unmet: 'unmet',
    unsupported: 'unsupported',
    unsafe: 'unsafe',
    cancelled: 'cancelled',
    failed: 'failed',
};

export const STATUS_LABELS = {
    waiting: 'Waiting',
    processing: 'Processing',
    success: 'Success',
    unmet: 'Could not meet target',
    unsupported: 'Unsupported',
    unsafe: 'Too large for this device',
    cancelled: 'Cancelled',
    failed: 'Failed',
};

export const ZIP_FAILED_MESSAGE = 'Resizo couldn’t create the ZIP. Your processed images are still available individually.';

/**
 * The row a file gets when the work fell over and the tool named no sentence of
 * its own. Deliberately says nothing about why: the thrown error is a codec's
 * or a container parser's, its text is written for a developer, and putting it
 * on screen tells a visitor nothing they can act on.
 */
const FAILED_MESSAGE = 'That image could not be processed on this device.';

const HEADER_PROBE_BYTES = 64 * 1024;

/**
 * A blob's own dimensions and alpha flag, read from its header by a parser that
 * never saw the request that produced it.
 *
 * The head is sliced rather than the whole blob read, because a 20 MB result
 * would otherwise be copied into memory to learn three facts. Metadata is
 * stripped from everything this engine encodes, so the size marker is always
 * inside the first few hundred bytes — the fallback to the whole blob is there
 * for the day that stops being true, not because it is expected to run.
 */
export async function readBlobSize(blob) {
    if (!blob || typeof blob.arrayBuffer !== 'function') return null;

    const head = typeof blob.slice === 'function' ? blob.slice(0, HEADER_PROBE_BYTES) : blob;
    const size = readImageSize(new Uint8Array(await head.arrayBuffer()));
    if (size) return size;

    if (head === blob || blob.size <= HEADER_PROBE_BYTES) return null;
    return readImageSize(new Uint8Array(await blob.arrayBuffer()));
}

/**
 * The first 64 KB of a blob, as bytes an independent parser can read.
 *
 * Exported because a verifier needs the same head the size reader used: format,
 * dimensions, density and the alpha flag are all declared in a container's
 * header, so a check that read the whole file would copy megabytes to learn
 * what the first few hundred bytes already say.
 */
export async function readBlobHead(blob) {
    if (!blob || typeof blob.arrayBuffer !== 'function') return null;

    const head = typeof blob.slice === 'function' ? blob.slice(0, HEADER_PROBE_BYTES) : blob;
    return new Uint8Array(await head.arrayBuffer());
}

/**
 * Whether an error is the person having pressed Stop rather than the work
 * having gone wrong. One rule, in one place: a cancellation is re-thrown all
 * the way up to the sequencer, and everything else fails one row.
 */
export function isCancellation(error, signal) {
    return Boolean(signal?.aborted) || error?.name === 'AbortError' || error?.code === 'cancelled';
}

/**
 * The rows a batch starts as: one per file, waiting, carrying the settings the
 * run will use.
 *
 * Exported because the panel seeds the list the moment the action is pressed —
 * before the first decode, so twenty files appear at once rather than one at a
 * time — and the sequencer seeds it again as it starts. A second copy of this
 * shape in a hook is how a panel ends up rendering a field the batch layer
 * stopped producing.
 */
export function seedRows(items, settings = {}) {
    return (Array.isArray(items) ? items : []).map((item) => seedRow(item, settings));
}

function seedRow(item, settings) {
    return {
        id: item.id,
        name: item.name,
        folder: item.folder ?? null,
        status: STATUS.waiting,
        originalBytes: item.file?.size ?? null,
        resultBytes: null,
        width: null,
        height: null,
        sourceWidth: item.sourceWidth ?? null,
        sourceHeight: item.sourceHeight ?? null,
        format: item.format ?? null,
        ...settings,
        blob: null,
        filename: null,
        error: null,
        resized: false,
        // Stable from the first render: a row that gains a field only once it
        // succeeds is a row the panel has to guard on every read.
        kept: false,
        note: null,
    };
}

/**
 * The rows a batch produces, one per file, in the order they were chosen.
 *
 * Sequential, and not negotiable: peak memory is what kills a phone tab, and
 * twenty decoded surfaces at once is exactly how you reach it. Everything a row
 * needs is written into a NEW object rather than onto the seeded one, so a
 * failure on file twenty cannot reach back and edit what file one said.
 *
 * @param {object} options
 * @param {Array<{id, name, file, folder, sourceWidth, sourceHeight, format}>} options.items
 * @param {object} [options.settings]     the same settings for every file in the run
 * @param {function} options.processFile  the per-file processor; the test seam
 * @param {function} [options.onProgress] (id, patch) => void, per state change
 * @param {function} [options.onFailure]  (item) => row patch, for a processor
 *   that threw. A tool with a better sentence than "could not be processed"
 *   supplies it here; the compressor's is its own missed-target sentence, which
 *   is why this is a callback and not a string.
 * @param {AbortSignal} [options.signal]
 * @param {string[]} [options.reservedNames]
 * @returns {Promise<{rows: Array<object>, aborted: boolean}>}
 */
export async function runBatch({
    items,
    settings = {},
    processFile,
    onProgress = () => {},
    onFailure = null,
    signal,
    reservedNames = [],
} = {}) {
    if (typeof processFile !== 'function') throw new Error('runBatch requires a processFile.');

    const list = Array.isArray(items) ? items : [];
    const rows = list.map((item) => seedRow(item, settings));
    let aborted = false;
    // Two photos called IMG_0001.jpg must not come back as two buttons offering
    // the same download. Names already held by rows a retry leaves in place
    // are reserved first, so a re-run cannot collide with them either.
    const usedNames = new Set(Array.from(reservedNames ?? []).filter((name) => typeof name === 'string'));

    /** This file and every one behind it: never tried, so never failed. */
    const cancelFrom = (index) => {
        for (let rest = index; rest < rows.length; rest += 1) {
            rows[rest] = { ...rows[rest], status: STATUS.cancelled };
            onProgress(rows[rest].id, { status: STATUS.cancelled });
        }
        aborted = true;
    };

    for (let index = 0; index < list.length; index += 1) {
        const item = list[index];

        if (signal?.aborted) {
            cancelFrom(index);
            break;
        }

        onProgress(item.id, { status: STATUS.processing });

        let result;
        try {
            result = await processFile({
                // The settings go on FIRST so that a stray setting sharing a
                // name with one of the file's own facts cannot overwrite it.
                // The file, its name and its measurements are not negotiable.
                ...settings,
                file: item.file,
                name: item.name,
                folder: item.folder ?? null,
                sourceWidth: item.sourceWidth ?? null,
                sourceHeight: item.sourceHeight ?? null,
                format: item.format ?? null,
                signal,
            });
        } catch (error) {
            // The processor re-throws a cancellation, which is the person
            // having pressed Stop. Anything else that escaped is this file's
            // failure and nobody else's.
            if (isCancellation(error, signal)) {
                cancelFrom(index);
                break;
            }
            result = onFailure?.(item) ?? { status: STATUS.failed, error: FAILED_MESSAGE };
        }

        if (result?.status === STATUS.success && typeof result.filename === 'string') {
            result = { ...result, filename: uniqueName(result.filename, usedNames) };
        }
        rows[index] = { ...rows[index], ...result };
        onProgress(item.id, { ...result });
    }

    return { rows, aborted };
}

/**
 * The batch as one set of numbers.
 *
 * Every status is counted, the unsettled ones included, because a summary that
 * silently dropped 'waiting' would read as though a cancelled run had finished.
 * The bytes are summed over successes ALONE: a 9 MB file that failed did not
 * save anything, and letting it into the input total would invent a reduction
 * percentage out of work that never happened.
 *
 * `savedBytes` and `differenceBytes` are the same measurement read from the two
 * ends a tool cares about. A compressor's answer is always a reduction and says
 * so; a converter's may be either, and a PNG that came out larger than the JPEG
 * it started as has to be able to say '+2.4 MB' rather than a negative saving.
 */
export function summarize(rows) {
    const list = Array.isArray(rows) ? rows : [];

    const counts = {
        waiting: 0,
        processing: 0,
        success: 0,
        unmet: 0,
        unsupported: 0,
        unsafe: 0,
        cancelled: 0,
        failed: 0,
    };

    let kept = 0;
    let inputBytes = 0;
    let outputBytes = 0;

    for (const row of list) {
        if (row?.status in counts) counts[row.status] += 1;

        if (row?.status === STATUS.success) {
            if (row.kept === true) kept += 1;
            inputBytes += Number.isFinite(row.originalBytes) ? row.originalBytes : 0;
            outputBytes += Number.isFinite(row.resultBytes) ? row.resultBytes : 0;
        }
    }

    const savedBytes = inputBytes - outputBytes;

    return {
        selected: list.length,
        successful: counts.success,
        kept,
        failed: counts.failed,
        unmet: counts.unmet,
        unsupported: counts.unsupported,
        unsafe: counts.unsafe,
        cancelled: counts.cancelled,
        waiting: counts.waiting,
        processing: counts.processing,
        inputBytes,
        outputBytes,
        savedBytes,
        differenceBytes: outputBytes - inputBytes,
        reductionPercent: counts.success > 0 && inputBytes > 0 ? Math.round((savedBytes / inputBytes) * 100) : null,
    };
}

/**
 * What goes into the archive: the successes, in the order they were chosen,
 * each under the folder it was picked from.
 *
 * Names are threaded through uniqueName, so two photos called IMG_0001.jpg in
 * one folder do not silently overwrite each other inside the ZIP. The entry
 * count therefore always equals the success count.
 */
export function zipEntries(rows) {
    const used = new Set();

    return (Array.isArray(rows) ? rows : [])
        .filter((row) => row?.status === STATUS.success && row.blob && row.filename)
        .map((row) => ({
            id: row.id,
            name: uniqueName(joinZipPath(row.folder, row.filename), used),
            blob: row.blob,
        }));
}

/**
 * The archive, built from the finished blobs.
 *
 * assembleZip is what loads JSZip, and it does so on first use — which is here,
 * behind a button, rather than in the first load of a page whose visitor may
 * only ever download one image. Throwing on an empty manifest is deliberate:
 * the caller hides the button at zero successes, so reaching this line at all
 * means something upstream lost track of the rows.
 *
 * The filename is required rather than defaulted, because there is no name that
 * would be right for both tools and a download called after the wrong one is a
 * bug nobody notices until the file is on someone's desktop.
 */
export async function buildZip(rows, { assemble = assembleZip, filename } = {}) {
    if (typeof filename !== 'string' || filename === '') throw new Error('buildZip requires a filename.');

    const entries = zipEntries(rows);
    if (entries.length === 0) throw new Error('nothing-to-zip');

    const blob = await assemble(entries.map(({ name, blob: file }) => ({ name, blob: file })));
    return { blob, filename, count: entries.length };
}

/**
 * The rows a retry could plausibly change.
 *
 * unmet, unsafe and failed all depend on something the visitor can move — a
 * higher limit, a different output format, a smaller batch — and cancelled
 * files were never tried at all. An unsupported file is not on the list: it will
 * be the same file type next time, and offering to retry it is offering a
 * button that cannot work.
 */
export function retryableIds(rows) {
    const retryable = new Set([STATUS.unmet, STATUS.unsafe, STATUS.cancelled, STATUS.failed]);

    return (Array.isArray(rows) ? rows : [])
        .filter((row) => retryable.has(row?.status))
        .map((row) => row.id);
}
