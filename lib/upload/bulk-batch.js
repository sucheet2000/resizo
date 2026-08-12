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
 */
import JSZip from 'jszip';

import { uniqueName } from '@/lib/image/filename';

const ZIP_FILENAME = 'resizo-bulk.zip';

const FAILED_MESSAGE = 'That image could not be processed on this device.';

/**
 * Zips the processed blobs in the browser. Names are already unique by the time
 * they arrive here, but the set is threaded through uniqueName anyway so a
 * caller that skips the dedup still cannot silently overwrite an entry.
 *
 * @param {Array<{name:string, blob:Blob}>} entries
 * @returns {Promise<Blob>} an application/zip blob
 */
export async function assembleZip(entries) {
    const zip = new JSZip();
    const used = new Set();

    for (const { name, blob } of entries) {
        const buffer = await blob.arrayBuffer();
        zip.file(uniqueName(name, used), buffer);
    }

    const output = await zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' });
    return new Blob([output], { type: 'application/zip' });
}

/**
 * @param {object}   options
 * @param {Array<{id, name, file, fields, sourceWidth?, sourceHeight?}>} options.items
 * @param {function} [options.onProgress]  (id, { status, originalBytes?, resultBytes?, error? }) => void
 * @param {function} options.processFile   per-file processor; this is the seam
 *   lib/upload/process-file.js plugs into, and it is injectable for tests
 * @param {function} [options.assemble]    ZIP assembler; injectable for tests
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<{ok:boolean, aborted?:boolean, zipBlob:Blob|null, filename?:string,
 *   rows:Array<{id, name, originalBytes, resultBytes}>, failures:Array<{id, name, error}>}>}
 */
export async function processBatch({
    items,
    onProgress = () => {},
    processFile,
    assemble = assembleZip,
    signal,
} = {}) {
    if (typeof processFile !== 'function') throw new Error('processBatch requires a processFile.');

    const list = Array.isArray(items) ? items : [];
    const successes = [];
    const failures = [];
    const usedNames = new Set();
    let aborted = false;

    for (const item of list) {
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
            const name = uniqueName(result.filename, usedNames);
            const originalBytes = Number.isFinite(result.originalBytes)
                ? result.originalBytes
                : (item.file?.size ?? null);
            const resultBytes = Number.isFinite(result.resultBytes)
                ? result.resultBytes
                : (result.blob?.size ?? null);

            successes.push({ id: item.id, name, blob: result.blob, originalBytes, resultBytes });
            onProgress(item.id, { status: 'done', originalBytes, resultBytes });
        } else {
            failures.push({ id: item.id, name: item.name ?? item.file?.name ?? 'image', error: result.error });
            onProgress(item.id, { status: 'failed', error: result.error });
        }
    }

    if (aborted) {
        return { ok: false, aborted: true, zipBlob: null, rows: [], failures };
    }

    if (successes.length === 0) {
        return { ok: false, zipBlob: null, rows: [], failures };
    }

    const zipBlob = await assemble(successes.map(({ name, blob }) => ({ name, blob })));
    const rows = successes.map(({ id, name, originalBytes, resultBytes }) => ({
        id,
        name,
        originalBytes,
        resultBytes,
    }));

    return { ok: true, zipBlob, filename: ZIP_FILENAME, rows, failures };
}

export default processBatch;
