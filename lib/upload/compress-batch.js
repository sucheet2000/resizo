/**
 * Bulk image compressor — the batch layer over the compress operation.
 *
 * Pure module: no React, no catalog. Constants are shared with the page; the
 * processor, the sequencer, the summary and the ZIP manifest are built here.
 */
import { assessJob, refusalMessage } from '@/lib/image-client/capability';
import { processImage } from '@/lib/image-client/client';
import { readImageSize } from '@/lib/image-client/requirements';
import { buildOutputFilename, joinZipPath, uniqueName } from '@/lib/image/filename';
import { assembleZip } from '@/lib/upload/bulk-batch';
import { MAX_TARGET_BYTES, MIN_TARGET_BYTES } from '@/lib/limits';
import { bytesToKb, parseTargetBytes } from '@/lib/image-client/target-bytes';

export const KB = 1024;

export const STATUS = {
    waiting: 'waiting',
    processing: 'processing',
    success: 'success',
    unmet: 'unmet',
    unsupported: 'unsupported',
    unsafe: 'unsafe',
    cancelled: 'cancelled',
};

export const STATUS_LABELS = {
    waiting: 'Waiting',
    processing: 'Processing',
    success: 'Success',
    unmet: 'Could not meet target',
    unsupported: 'Unsupported',
    unsafe: 'Too large for this device',
    cancelled: 'Cancelled',
};

export const MODES = ['preserve', 'fit'];

export const LIMIT_PRESETS = [
    { kb: 50, label: '50 KB' },
    { kb: 100, label: '100 KB' },
    { kb: 200, label: '200 KB' },
    { kb: 500, label: '500 KB' },
    { kb: 1024, label: '1 MB' },
];

export const DEFAULT_LIMIT_KB = 200;
export const MIN_LIMIT_KB = MIN_TARGET_BYTES / KB;
export const MAX_LIMIT_KB = MAX_TARGET_BYTES / KB;

export const ZIP_FILENAME = 'resizo-compressed-images.zip';
export const ZIP_FAILED_MESSAGE = 'Resizo couldn’t create the ZIP. Your processed images are still available individually.';

/**
 * A whole number with thousands separators, written here rather than taken
 * from toLocaleString: the bounds sentence is asserted character for character
 * by the tests and by the panel's hint, and a locale-dependent separator would
 * make that sentence depend on where the build ran.
 */
function group(value) {
    return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

const LIMIT_RANGE_ERROR = `Enter a whole number of KB between ${group(MIN_LIMIT_KB)} and ${group(MAX_LIMIT_KB)}.`;

const WHOLE_NUMBER_PATTERN = /^[0-9]+$/;

/**
 * The typed limit, in the unit a person actually types it in.
 *
 * The engine's parser works in bytes and says so ("between 10 KB and 20 MB"),
 * which is the right sentence for a field that takes bytes and the wrong one
 * for a field labelled "Custom limit (KB)". So the KB is validated as KB here —
 * whole numbers only, because half a kilobyte is not a thing a form asks for —
 * and the bounds themselves still come from parseTargetBytes rather than being
 * re-typed, so raising MAX_TARGET_BYTES moves this field with it.
 */
export function parseLimitKb(raw) {
    let kb;

    if (typeof raw === 'number') {
        if (!Number.isSafeInteger(raw)) return { ok: false, error: LIMIT_RANGE_ERROR };
        kb = raw;
    } else if (typeof raw === 'string') {
        const trimmed = raw.trim();
        if (!WHOLE_NUMBER_PATTERN.test(trimmed)) return { ok: false, error: LIMIT_RANGE_ERROR };
        kb = Number(trimmed);
        if (!Number.isSafeInteger(kb)) return { ok: false, error: LIMIT_RANGE_ERROR };
    } else {
        return { ok: false, error: LIMIT_RANGE_ERROR };
    }

    const bytes = parseTargetBytes(kb * KB, { min: MIN_TARGET_BYTES, max: MAX_TARGET_BYTES });
    if (!bytes.ok) return { ok: false, error: LIMIT_RANGE_ERROR };

    return { ok: true, kb, bytes: bytes.value };
}

const MB = KB * KB;

/**
 * The limit as the visitor set it: '200 KB', '1 MB', '1.5 MB'.
 *
 * KB is the smallest unit this tool speaks, because the field and the chips are
 * both in KB and a message that answered '51,300 bytes' would not match
 * anything on screen. Above a megabyte one decimal is kept, so 1.5 MB does not
 * read as 1 MB or as 1,536 KB.
 */
export function limitLabel(bytes) {
    const value = typeof bytes === 'number' && Number.isFinite(bytes) && bytes > 0 ? bytes : 0;

    if (value >= MB) return `${parseFloat((value / MB).toFixed(1))} MB`;

    return `${bytesToKb(value)} KB`;
}

/** photo.jpg → photo-compressed.jpg, in whatever format came back. */
export function outputName(name, format) {
    return buildOutputFilename({ name, suffix: 'compressed', format });
}

/**
 * Why one file did not get under the limit, in the words that tell a person
 * what to do next.
 *
 * The engine has its own sentence for an unreachable target and it is dropped
 * on purpose: it talks about targets and search floors, and it is written for
 * one file being worked on alone. In a list of twenty rows the useful sentence
 * names the file, quotes the limit the way the chips do, and says which of the
 * two modes would have had a chance — which for a PNG under preserve is neither
 * quality (this build has no quantiser) nor luck.
 */
export function unmetMessage({ name, targetBytes, mode, format } = {}) {
    const limit = limitLabel(targetBytes);
    const file = name || 'that image';

    if (mode === 'fit') {
        return `Resizo couldn’t reduce ${file} below ${limit} even at the smallest size it allows.`;
    }

    if (format === 'png') {
        return `Resizo couldn’t reduce ${file} below ${limit} — PNG has no quality setting, `
            + 'so only Fit under limit can shrink it.';
    }

    return `Resizo couldn’t reduce ${file} below ${limit} without changing its dimensions.`;
}

const HEADER_PROBE_BYTES = 64 * KB;

/**
 * The finished file's own dimensions, read from its header by a parser that
 * never saw the request.
 *
 * The head is sliced rather than the whole blob read, because a 20 MB result
 * would otherwise be copied into memory to learn two numbers. Metadata is
 * stripped from everything this engine encodes, so the size marker is always
 * inside the first few hundred bytes — the fallback to the whole blob is there
 * for the day that stops being true, not because it is expected to run.
 */
async function readBlobSize(blob) {
    if (!blob || typeof blob.arrayBuffer !== 'function') return null;

    const head = typeof blob.slice === 'function' ? blob.slice(0, HEADER_PROBE_BYTES) : blob;
    const size = readImageSize(new Uint8Array(await head.arrayBuffer()));
    if (size) return size;

    if (head === blob || blob.size <= HEADER_PROBE_BYTES) return null;
    return readImageSize(new Uint8Array(await blob.arrayBuffer()));
}

/**
 * The format the file arrived in is the format it must leave in.
 *
 * A PNG handed back as a JPEG has lost its transparency, and a batch that made
 * that trade quietly would return logos on black rectangles. The engine is
 * asked for 'original' and its answer is checked anyway, because "asked
 * politely" is not a guarantee.
 */
function sameFormat(returned, source) {
    if (typeof returned !== 'string' || typeof source !== 'string') return false;
    const one = returned.toLowerCase() === 'jpg' ? 'jpeg' : returned.toLowerCase();
    const two = source.toLowerCase() === 'jpg' ? 'jpeg' : source.toLowerCase();
    return one === two;
}

/**
 * Whether the finished picture is the shape the mode promised.
 *
 * preserve is exact: the same two numbers, or the mode did not do what it says.
 * fit is allowed to shrink, but only along the diagonal it came in on — the
 * cross-product is compared instead of a ratio so there is no floating-point
 * epsilon to argue about, and one pixel of integer rounding (853 rather than
 * 853.33) is inside the tolerance while a re-cropped shape is not.
 */
function dimensionsHonour(mode, size, sourceWidth, sourceHeight) {
    if (mode !== 'fit') return size.width === sourceWidth && size.height === sourceHeight;

    if (size.width > sourceWidth || size.height > sourceHeight) return false;

    const skew = Math.abs(size.width * sourceHeight - size.height * sourceWidth);
    return skew <= Math.max(sourceWidth, sourceHeight);
}

function isCancellation(error, signal) {
    return Boolean(signal?.aborted) || error?.name === 'AbortError' || error?.code === 'cancelled';
}

/**
 * Builds the per-file processor runCompressBatch calls.
 *
 * The engine, the header reader and the memory gate are all injectable, which
 * is what lets the batch bookkeeping be tested without encoding a pixel.
 *
 * @param {object}   [seams]
 * @param {function} [seams.process]   the engine
 * @param {function} [seams.readSize]  the independent header reader
 * @param {function} [seams.assess]    the memory gate
 */
export function createCompressProcessor({
    process = processImage,
    readSize = readBlobSize,
    assess = assessJob,
} = {}) {
    return async function processOne({
        file,
        name,
        targetBytes,
        mode,
        sourceWidth = null,
        sourceHeight = null,
        format,
        signal,
    } = {}) {
        const assessment = assess(file, { operation: 'compress', sourceWidth, sourceHeight });
        if (!assessment.ok) return { status: STATUS.unsafe, error: refusalMessage(assessment) };

        const unmet = () => ({ status: STATUS.unmet, error: unmetMessage({ name, targetBytes, mode, format }) });

        let outcome;
        try {
            outcome = await process('compress', file, {
                targetBytes,
                policy: mode === 'fit' ? 'fit' : 'keep',
                format: 'original',
                sourceWidth,
                sourceHeight,
            }, { signal });
        } catch (error) {
            if (isCancellation(error, signal)) throw error;
            return unmet();
        }

        // THE ENGINE'S ANSWER IS NOT EVIDENCE FOR ITSELF.
        //
        // targetMet, width, height and format all come from the code that made
        // the file, and the whole value of this tool is a claim about numbers
        // the visitor cannot see: "this is under 50 KB, and it is still the
        // picture you gave me". So none of them is read. The blob's real length
        // is measured, its header is parsed by a reader that never saw the
        // request, and the row is only a success when both agree with what was
        // asked for. A file one byte over is a file a form rejects.
        const blob = outcome?.blob ?? null;
        const resultBytes = blob?.size ?? null;
        if (!Number.isFinite(resultBytes) || resultBytes > targetBytes) return unmet();

        let size;
        try {
            size = await readSize(blob);
        } catch (error) {
            if (isCancellation(error, signal)) throw error;
            return unmet();
        }
        if (!size) return unmet();

        if (!sameFormat(outcome?.format, format)) return unmet();

        const measured = Boolean(sourceWidth) && Boolean(sourceHeight);
        if (measured && !dimensionsHonour(mode, size, sourceWidth, sourceHeight)) return unmet();

        return {
            status: STATUS.success,
            blob,
            filename: outputName(name, outcome.format),
            originalBytes: file?.size ?? null,
            resultBytes,
            width: size.width,
            height: size.height,
            sourceWidth,
            sourceHeight,
            format: outcome.format,
            resized: measured && (size.width !== sourceWidth || size.height !== sourceHeight),
        };
    };
}

/**
 * The rows a batch starts as: one per file, waiting, carrying the settings the
 * run will use.
 *
 * Exported because the panel seeds the list the moment Compress is pressed —
 * before the first decode, so twenty files appear at once rather than one at a
 * time — and the sequencer seeds it again as it starts. A second copy of this
 * shape in the hook is how a panel ends up rendering a field the batch layer
 * stopped producing.
 */
export function seedRows(items, { targetBytes, mode } = {}) {
    return (Array.isArray(items) ? items : []).map((item) => seedRow(item, targetBytes, mode));
}

function seedRow(item, targetBytes, mode) {
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
        targetBytes,
        mode,
        blob: null,
        filename: null,
        error: null,
        resized: false,
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
 * @param {number} options.targetBytes   the same ceiling for every file in the run
 * @param {'preserve'|'fit'} options.mode
 * @param {function} options.processFile  the per-file processor; the test seam
 * @param {function} [options.onProgress] (id, patch) => void, per state change
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<{rows: Array<object>, aborted: boolean}>}
 */
export async function runCompressBatch({
    items,
    targetBytes,
    mode,
    processFile,
    onProgress = () => {},
    signal,
} = {}) {
    if (typeof processFile !== 'function') throw new Error('runCompressBatch requires a processFile.');

    const list = Array.isArray(items) ? items : [];
    const rows = list.map((item) => seedRow(item, targetBytes, mode));
    let aborted = false;

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
                file: item.file,
                name: item.name,
                targetBytes,
                mode,
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
            result = { status: STATUS.unmet, error: unmetMessage({ name: item.name, targetBytes, mode, format: item.format }) };
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
    };

    let inputBytes = 0;
    let outputBytes = 0;

    for (const row of list) {
        if (row?.status in counts) counts[row.status] += 1;

        if (row?.status === STATUS.success) {
            inputBytes += Number.isFinite(row.originalBytes) ? row.originalBytes : 0;
            outputBytes += Number.isFinite(row.resultBytes) ? row.resultBytes : 0;
        }
    }

    const savedBytes = inputBytes - outputBytes;

    return {
        selected: list.length,
        successful: counts.success,
        unmet: counts.unmet,
        unsupported: counts.unsupported,
        unsafe: counts.unsafe,
        cancelled: counts.cancelled,
        waiting: counts.waiting,
        processing: counts.processing,
        inputBytes,
        outputBytes,
        savedBytes,
        reductionPercent: counts.success > 0 && inputBytes > 0 ? Math.round((savedBytes / inputBytes) * 100) : null,
    };
}

/**
 * What goes into the archive: the successes, in the order they were chosen,
 * each under the folder it was picked from.
 *
 * Names are threaded through uniqueName, so two photos called IMG_0001.jpg in
 * one folder become IMG_0001-compressed.jpg and IMG_0001-compressed-2.jpg
 * rather than one file silently overwriting the other inside the ZIP. The
 * entry count therefore always equals the success count.
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
 */
export async function buildZip(rows, { assemble = assembleZip } = {}) {
    const entries = zipEntries(rows);
    if (entries.length === 0) throw new Error('nothing-to-zip');

    const blob = await assemble(entries.map(({ name, blob: file }) => ({ name, blob: file })));
    return { blob, filename: ZIP_FILENAME, count: entries.length };
}

/**
 * The rows a retry could plausibly change.
 *
 * unmet and unsafe both depend on settings the visitor can move — a higher
 * limit, Fit under limit instead of Preserve, a smaller batch — and cancelled
 * files were never tried at all. An unsupported file is not on the list: it will
 * be the same file type next time, and offering to retry it is offering a
 * button that cannot work.
 */
export function retryableIds(rows) {
    const retryable = new Set([STATUS.unmet, STATUS.unsafe, STATUS.cancelled]);

    return (Array.isArray(rows) ? rows : [])
        .filter((row) => retryable.has(row?.status))
        .map((row) => row.id);
}
