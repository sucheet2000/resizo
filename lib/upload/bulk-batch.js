/**
 * Bulk orchestration, entirely in the browser.
 *
 * Bulk used to POST every file as one multipart body to /api/resize-bulk, which
 * died at the 4.5MB serverless body cap — roughly four phone photos. It then
 * posted them one at a time. Now nothing is posted at all: each file goes
 * through the engine in this tab, and the ZIP is assembled here from the
 * results. This module is the sequencing and the archive; where the pixels are
 * worked on is lib/upload/process-file.js's business.
 *
 * Files are processed one at a time on purpose. Peak memory is what kills a
 * phone tab, and twenty decoded surfaces at once is exactly how you reach it. A
 * single file failing is recorded and skipped — a bad frame in the middle of a
 * batch must not lose the nineteen good ones.
 *
 * OUTPUT NAMES KEEP THE FOLDER THEY CAME FROM
 *
 * An item may carry a `folder`, which a folder pick fills in from the file's
 * relative path (lib/hooks/useImageUpload.js) and every other intake path
 * leaves empty. When it is there the ZIP entry is `<folder>/<name>`, so the
 * archive unzips back into the shape that was picked and two photos called
 * IMG_0001.jpg from two different months stay two distinguishable files. The
 * dedup is unchanged and now keys on the WHOLE path, which is strictly stronger
 * than it was: same name in different folders is no longer even a collision,
 * and same name in the same folder still lands on `-2`.
 *
 * THE ARCHIVE IS MEASURED AS IT GROWS, NOT ESTIMATED BEFORE IT DOES
 *
 * The pre-flight gate (assessBatchJob) costs a batch from the target format's
 * expansion factor, which is the only thing knowable before any work happens.
 * That factor cannot be both safe and non-punitive, because expansion is
 * content-dependent: the same JPEG-to-PNG conversion measured 3.25x on one of
 * this repo's sample photos and 8.69x on another, and both were JPEGs off the
 * same camera. Pick the high number and small honest batches are refused; pick
 * the low one and the tab is killed silently on iOS, which is the failure this
 * whole engine exists to prevent.
 *
 * So the archive is bounded HERE as well, with no estimate in it at all. Every
 * finished file's REAL output size is added up, and when the next one would push
 * the total past what capability.js says this device can hold, the run stops and
 * the ZIP of everything that already finished is STILL delivered. A batch that
 * would once have killed the tab now returns seventeen of twenty images and a
 * sentence saying why the other three are not there.
 */
import { batchArchiveBudgetBytes } from '@/lib/image-client/capability';
import { joinZipPath, uniqueName } from '@/lib/image/filename';

/**
 * The archive name when a caller does not choose one.
 *
 * It IS a parameter now, because four tools are growing a bulk tab and four
 * archives called resizo-bulk.zip land in one Downloads folder as
 * resizo-bulk.zip, resizo-bulk (1).zip and resizo-bulk (2).zip — three names
 * that say nothing about which one holds the converted images. Every tool should
 * pass its own; this default only keeps a caller that forgets from getting no
 * name at all.
 */
export const DEFAULT_ZIP_FILENAME = 'resizo-bulk.zip';

const FAILED_MESSAGE = 'That image could not be processed on this device.';

/**
 * JSZip, loaded on first use and never at module scope.
 *
 * This module is reached from /resize, /resize-jpg and /resize-png, and a
 * top-level import put the whole archiver into the first load of all three —
 * paid in full by the visitor who resizes ONE image and never opens the bulk
 * tab. It is the same rule @cantoo/pdf-lib follows in lib/image-client/pdf.js
 * (loadPdfLib) and every WASM codec follows in lib/image-client/codecs.js, and
 * this was the one heavy dependency that had escaped it.
 *
 * The PROMISE is memoised rather than the module, so a twenty-file batch does
 * not re-enter the import per file, and a failed load is evicted so the next
 * attempt retries instead of replaying the failure forever.
 */
let modulePromise = null;

function loadZipWriter() {
    if (!modulePromise) {
        modulePromise = import('jszip')
            .then((module) => module.default)
            .catch((error) => {
                modulePromise = null;
                throw error;
            });
    }
    return modulePromise;
}

/** Test seam. Drops the memoised writer; does not unload anything. */
export function resetZipWriter() {
    modulePromise = null;
}

/**
 * Zips the processed blobs in the browser. Names are already unique by the time
 * they arrive here, but the set is threaded through uniqueName anyway so a
 * caller that skips the dedup still cannot silently overwrite an entry.
 *
 * @param {Array<{name:string, blob:Blob}>} entries
 * @returns {Promise<Blob>} an application/zip blob
 */
export async function assembleZip(entries) {
    const JSZip = await loadZipWriter();
    const zip = new JSZip();
    const used = new Set();

    for (const { name, blob } of entries) {
        const buffer = await blob.arrayBuffer();
        zip.file(uniqueName(name, used), buffer);
    }

    const output = await zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' });
    return new Blob([output], { type: 'application/zip' });
}

/** The name of a file for the left-out list, however little the item carries. */
function nameOf(item) {
    return item?.name ?? item?.file?.name ?? 'image';
}

/**
 * The sentence a person reads when the archive filled before the batch did.
 *
 * It leads with the number that is GOOD NEWS — how many images they actually
 * got — because the ZIP is downloading either way and a message that opens with
 * a failure reads as though the whole run was lost. The limit is named as the
 * device's, which is what it is: the same batch on a laptop would finish.
 */
function leftOutMessageFor(addedCount, leftOutCount) {
    if (leftOutCount <= 0) return null;

    const images = leftOutCount === 1 ? 'image was' : 'images were';

    if (addedCount === 0) {
        return `None of those images could go in a ZIP on this device — the first one alone came out bigger than the archive this device can hold. Try a smaller output format, or do them one at a time.`;
    }

    return `${addedCount} of your ${addedCount + leftOutCount} images are in the ZIP. The last ${leftOutCount} ${images} left out because the archive reached what this device can hold.`;
}

/**
 * @param {object}   options
 * @param {Array<{id, name, file, fields, folder?, sourceWidth?, sourceHeight?}>} options.items
 * @param {function} [options.onProgress]  (id, { status, originalBytes?, resultBytes?, error?, note? }) => void
 * @param {function} options.processFile   per-file processor; this is the seam
 *   lib/upload/process-file.js plugs into, and it is injectable for tests
 * @param {function} [options.assemble]    ZIP assembler; injectable for tests
 * @param {AbortSignal} [options.signal]
 * @param {string} [options.filename]      the archive's download name
 * @param {string} [options.operation]     what each file runs, so the archive
 *   budget can subtract the right per-file working set
 * @param {object} [options.device]        the travelling device profile
 * @param {number} [options.archiveBudgetBytes]  the ceiling on TOTAL OUTPUT
 *   bytes, in place of deriving one from the device. Injectable for tests, which
 *   is the only way to exercise this without allocating hundreds of megabytes.
 * @returns {Promise<{ok:boolean, aborted?:boolean, zipBlob:Blob|null, filename?:string,
 *   rows:Array<{id, name, originalBytes, resultBytes}>, failures:Array<{id, name, error}>,
 *   leftOut:Array<{id, name}>, leftOutMessage:string|null}>}
 */
export async function processBatch({
    items,
    onProgress = () => {},
    processFile,
    assemble = assembleZip,
    signal,
    filename = DEFAULT_ZIP_FILENAME,
    operation,
    device,
    archiveBudgetBytes = null,
} = {}) {
    if (typeof processFile !== 'function') throw new Error('processBatch requires a processFile.');

    const list = Array.isArray(items) ? items : [];
    const successes = [];
    const failures = [];
    const leftOut = [];
    const usedNames = new Set();
    let aborted = false;
    let archivedBytes = 0;

    // Derived ONCE, from the whole intake, because the per-file working set it
    // subtracts is the largest file's and that does not change as the run goes.
    const ceiling = Number.isFinite(archiveBudgetBytes) && archiveBudgetBytes >= 0
        ? archiveBudgetBytes
        : batchArchiveBudgetBytes({
            files: list.map((item) => ({
                fileBytes: item?.file?.size ?? 0,
                sourceWidth: item?.sourceWidth ?? null,
                sourceHeight: item?.sourceHeight ?? null,
            })),
            ...(operation ? { operation } : {}),
            ...(device ? { device } : {}),
        });

    for (let index = 0; index < list.length; index += 1) {
        const item = list[index];

        if (signal?.aborted) {
            aborted = true;
            break;
        }

        onProgress(item.id, { status: 'processing' });

        let result;
        try {
            result = await processFile({
                file: item.file,
                fields: item.fields,
                // Measured at intake by lib/hooks/useImageUpload. The processor
                // needs them BEFORE it decodes, because that is the last moment
                // the memory gate can still refuse.
                sourceWidth: item.sourceWidth ?? null,
                sourceHeight: item.sourceHeight ?? null,
                signal,
            });
        } catch (error) {
            // An abort stops the whole batch and is not counted as a file
            // failure; any other throw is treated as this file's failure.
            if (signal?.aborted || error?.name === 'AbortError') {
                aborted = true;
                break;
            }
            result = { ok: false, error: FAILED_MESSAGE };
        }

        if (result.ok) {
            const name = uniqueName(joinZipPath(item.folder, result.filename), usedNames);
            const originalBytes = Number.isFinite(result.originalBytes)
                ? result.originalBytes
                : (item.file?.size ?? null);
            const resultBytes = Number.isFinite(result.resultBytes)
                ? result.resultBytes
                : (result.blob?.size ?? null);

            // THE MEASUREMENT, not an estimate. The file is finished and its
            // real size is known, so this is the last honest moment to decide
            // whether it can join the archive — and the first moment anything
            // could have known. A blob whose size cannot be read is charged
            // nothing, because inventing a number here would be the guess this
            // whole check exists to remove.
            const archiveBytes = Number.isFinite(resultBytes) ? resultBytes : 0;

            if (archivedBytes + archiveBytes > ceiling) {
                // This file and every one after it. The blob is dropped
                // unreferenced on the next line, so the surface it holds is
                // released rather than carried to the end of the run.
                for (const remaining of list.slice(index)) {
                    leftOut.push({ id: remaining.id, name: nameOf(remaining) });
                }
                break;
            }

            archivedBytes += archiveBytes;
            successes.push({ id: item.id, name, blob: result.blob, originalBytes, resultBytes });
            onProgress(item.id, { status: 'done', originalBytes, resultBytes });
        } else {
            failures.push({ id: item.id, name: nameOf(item), error: result.error });
            onProgress(item.id, { status: 'failed', error: result.error });
        }
    }

    const leftOutMessage = leftOutMessageFor(successes.length, leftOut.length);

    // Told once, per file, so a panel listing rows can show which ones and a
    // panel showing one sentence can show leftOutMessage. Emitted after the loop
    // because until it ends there is no count to put in the sentence.
    for (const entry of leftOut) {
        onProgress(entry.id, { status: 'skipped', note: leftOutMessage });
    }

    if (aborted) {
        return { ok: false, aborted: true, zipBlob: null, rows: [], failures, leftOut, leftOutMessage };
    }

    if (successes.length === 0) {
        return { ok: false, zipBlob: null, rows: [], failures, leftOut, leftOutMessage };
    }

    const zipBlob = await assemble(successes.map(({ name, blob }) => ({ name, blob })));
    const rows = successes.map(({ id, name, originalBytes, resultBytes }) => ({
        id,
        name,
        originalBytes,
        resultBytes,
    }));

    return { ok: true, zipBlob, filename, rows, failures, leftOut, leftOutMessage };
}

export default processBatch;
