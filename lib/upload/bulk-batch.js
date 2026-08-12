/**
 * Client-side bulk orchestration.
 *
 * Bulk used to POST every file as one multipart body to /api/resize-bulk, which
 * dies at the 4.5MB serverless body cap — roughly four phone photos. Instead
 * this processes each file individually through the ordinary single-file path
 * (direct or Blob per its size), collecting each result, then assembles the ZIP
 * in the browser. There is no combined-body limit left to hit, and the server
 * never holds a whole batch in memory at once.
 *
 * Files are processed one at a time on purpose: twenty parallel Sharp requests
 * would spike server memory and the browser would hold twenty decoded results
 * at once. A single file failing is recorded and skipped — a bad frame in the
 * middle of a batch must not lose the nineteen good ones.
 */
import JSZip from 'jszip';

import { uniqueName } from '@/lib/image/filename';
import { messageForStatus } from '@/lib/hooks/submit-helpers';
import { submitFile as defaultSubmitFile } from '@/lib/upload/submit-file';

const ZIP_FILENAME = 'resizo-bulk.zip';

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
 * @param {Array<{id, name, file, fields, endpoint, sourceWidth?, sourceHeight?}>} options.items
 * @param {function} [options.onProgress]  (id, { status, originalBytes?, resultBytes?, error? }) => void
 * @param {function} [options.submitFile]  per-file submit; this is the seam the
 *   local-first submitter in lib/upload/local-first-submit.js plugs into, and
 *   it is injectable for tests
 * @param {function} [options.assemble]    ZIP assembler; injectable for tests
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<{ok:boolean, aborted?:boolean, zipBlob:Blob|null, filename?:string,
 *   rows:Array<{id, name, originalBytes, resultBytes}>, failures:Array<{id, name, error}>}>}
 */
export async function processBatch({
    items,
    onProgress = () => {},
    submitFile = defaultSubmitFile,
    assemble = assembleZip,
    signal,
} = {}) {
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
            result = await submitFile({
                endpoint: item.endpoint,
                file: item.file,
                fields: item.fields,
                // Measured at intake by lib/hooks/useImageUpload. A submitter
                // that runs the job on this device needs them BEFORE it
                // decodes, because that is the last moment the memory gate can
                // still refuse; the server submitter ignores them.
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
            result = { ok: false, error: messageForStatus(0) };
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
