/**
 * Bulk image compressor — the compress-shaped half of the batch platform.
 *
 * The row model, the sequencer, the summary, the ZIP manifest and the retry
 * list live in lib/upload/batch.js: none of them is about compression, and the
 * bulk converter runs on the same ones. What is left here is everything that IS
 * about compression — the limits a person can ask for, the words for a target
 * that could not be met, and the processor that refuses to believe the engine
 * about whether it met one.
 *
 * Every export this module had before the split still exists, with the same
 * name and the same behaviour: the compressor's suites are the proof that the
 * move changed nothing, so they were not touched.
 *
 * Pure module: no React, no catalog.
 */
import { assessJob, refusalMessage } from '@/lib/image-client/capability';
import { processImage } from '@/lib/image-client/client';
import { buildOutputFilename } from '@/lib/image/filename';
// One line, and it has to stay one line: tests/helpers/import-graph.js reads
// this edge with a regex that does not span newlines, and an edge it cannot see
// is an edge the layering rules do not check.
import { STATUS, STATUS_LABELS, ZIP_FAILED_MESSAGE, buildZip as buildBatchZip, isCancellation, readBlobSize, retryableIds, runBatch, seedRows as seedBatchRows, summarize as summarizeBatch, zipEntries } from '@/lib/upload/batch';
import { MAX_TARGET_BYTES, MIN_TARGET_BYTES } from '@/lib/limits';
import { bytesToKb, parseTargetBytes } from '@/lib/image-client/target-bytes';

export { STATUS, STATUS_LABELS, ZIP_FAILED_MESSAGE, retryableIds, zipEntries };

export const KB = 1024;

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

/**
 * What the panel says about a file nobody re-encoded.
 *
 * It has to answer the question the row otherwise raises — why is the result
 * the same size as the original? — and it has to be true about what DID happen
 * to the file, which is that its metadata was removed.
 */
function keptNote(targetBytes) {
    return `Already under ${limitLabel(targetBytes)} — kept at its size, metadata removed.`;
}

/** The kept path when even the stripper could not open the file: nothing was changed at all. */
function keptUntouchedNote(targetBytes) {
    return `Already under ${limitLabel(targetBytes)} — kept exactly as it arrived.`;
}

/** A file already under the limit that failed its read-back — its own sentence, never a missed target. */
function unreadableMessage(name) {
    return `Resizo couldn’t check ${name} after removing its metadata, so it was left out.`;
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
        const unmet = () => ({ status: STATUS.unmet, error: unmetMessage({ name, targetBytes, mode, format }) });
        const measured = Boolean(sourceWidth) && Boolean(sourceHeight);

        // THE ENGINE'S ANSWER IS NOT EVIDENCE FOR ITSELF.
        //
        // targetMet, width, height and format all come from the code that made
        // the file, and the whole value of this tool is a claim about numbers
        // the visitor cannot see: "this is under 50 KB, and it is still the
        // picture you gave me". So none of them is read. The blob's real length
        // is measured, its header is parsed by a reader that never saw the
        // request, and the row is only a success when both agree with what was
        // asked for. A file one byte over is a file a form rejects.
        //
        // Returns null for anything that does not check out, which every caller
        // turns into the row's own unmet sentence. `shape` is the rule the
        // dimensions are held to: the kept path passes 'preserve' whatever the
        // mode, because a file nobody re-encoded has no business being a
        // different size.
        const verify = async (outcome, shape) => {
            const blob = outcome?.blob ?? null;
            const resultBytes = blob?.size ?? null;
            if (!Number.isFinite(resultBytes) || resultBytes > targetBytes) return null;

            const size = await readSize(blob);
            if (!size) return null;

            if (!sameFormat(outcome?.format, format)) return null;
            if (measured && !dimensionsHonour(shape, size, sourceWidth, sourceHeight)) return null;

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

        // A FILE THAT ALREADY MEETS THE LIMIT IS NOT RE-ENCODED.
        //
        // Measured on the benchmark: three PNGs already under their limit were
        // re-encoded anyway and came back two to three times LARGER — 24.0 KB
        // to 72.5 KB, 51.7 KB to 99.5 KB, 25.0 KB to 61.9 KB — every one of
        // them reported as a success. There is no PNG quantiser in this build,
        // so re-encoding an already-optimised PNG can only lose, and handing
        // back a bigger file than the one you were given is the one thing a
        // compressor must never do.
        //
        // The bytes still go through the metadata stripper, which touches no
        // pixels: lib/catalog/behaviour.js promises EXIF, GPS and XMP are gone
        // from every output of this tool, and a file that was left alone has to
        // keep that promise too. No memory gate on this path — nothing here
        // decodes, so there is no working set to cost.
        if (Number.isFinite(file?.size) && file.size <= targetBytes) {
            let stripped = null;
            try {
                stripped = await process('strip', file, {}, { signal });
            } catch (error) {
                if (isCancellation(error, signal)) throw error;
                // A stripper that cannot read a container must not cost the
                // visitor the file — and must not send it to the encoder
                // either, which is how a file already under the limit came
                // back three times larger. The original bytes are the answer.
                stripped = null;
            }

            const source = stripped ?? { blob: file, format };
            let row;
            try {
                row = await verify(source, 'preserve');
            } catch (error) {
                if (isCancellation(error, signal)) throw error;
                row = null;
            }
            if (!row) return { status: STATUS.unsupported, error: unreadableMessage(name) };

            // `stripped.kept` is the engine's OWN field — the list of metadata
            // blocks it deliberately left in, an ICC profile among them. It is
            // not this flag, and nothing about the outcome is spread here, so
            // the two cannot be confused.
            return {
                ...row,
                kept: true,
                resized: false,
                note: stripped ? keptNote(targetBytes) : keptUntouchedNote(targetBytes),
            };
        }

        const assessment = assess(file, { operation: 'compress', sourceWidth, sourceHeight });
        if (!assessment.ok) return { status: STATUS.unsafe, error: refusalMessage(assessment) };

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

        let row;
        try {
            row = await verify(outcome, mode);
        } catch (error) {
            if (isCancellation(error, signal)) throw error;
            return unmet();
        }
        if (!row) return unmet();

        return { ...row, kept: false, note: null };
    };
}

/**
 * The rows a compress batch starts as. The core seeds any batch; this states
 * which two settings a compress row carries, so the panel and the sequencer
 * cannot disagree about the shape of a row.
 */
export function seedRows(items, { targetBytes, mode } = {}) {
    return seedBatchRows(items, { targetBytes, mode });
}

/**
 * One compress run, in the order the files were chosen.
 *
 * The sequencing is the core's. What is compress-specific is the pair of
 * settings and the sentence a file gets when its processor threw: a missed
 * target, in the tool's own words, rather than the platform's generic failure.
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
    reservedNames = [],
} = {}) {
    if (typeof processFile !== 'function') throw new Error('runCompressBatch requires a processFile.');

    return runBatch({
        items,
        settings: { targetBytes, mode },
        processFile,
        onProgress,
        signal,
        reservedNames,
        onFailure: (item) => ({
            status: STATUS.unmet,
            error: unmetMessage({ name: item.name, targetBytes, mode, format: item.format }),
        }),
    });
}

/**
 * The batch as one set of numbers, in the shape this panel reads.
 *
 * The core counts three things a compressor has no use for — kept files, failed
 * files and a difference that can point either way. This tool has no failed
 * status at all, says which of its successes were kept in each row's own words,
 * and only ever reduces, so it reports a saving. They are dropped here rather
 * than rendered and ignored.
 */
export function summarize(rows) {
    const { kept, failed, differenceBytes, ...summary } = summarizeBatch(rows);
    return summary;
}

/** The archive, under this tool's own download name. */
export async function buildZip(rows, { assemble } = {}) {
    return buildBatchZip(rows, { ...(assemble ? { assemble } : {}), filename: ZIP_FILENAME });
}
