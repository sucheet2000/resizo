'use client';

/**
 * Local first, server second — for ONE file inside a batch.
 *
 * lib/hooks/useLocalFirstProcess.js makes this decision for a single-file tool
 * and holds React state while it does. A batch cannot use it: twenty files are
 * one submit, one progress bar and one result, so the choice has to be made per
 * file inside processBatch instead. What is shared is the decision itself —
 * canProcessLocally is imported, never re-derived — and the shape either lane
 * answers in, which is exactly lib/upload/submit-file.js's:
 *
 *   { ok: true, blob, filename, originalBytes, resultBytes, savedPercent }
 *   { ok: false, error }
 *
 * so processBatch, the ZIP assembler and the result panel cannot tell which
 * lane produced a given entry, and none of them had to change.
 *
 * WHAT THIS IS WORTH
 *
 * Twenty phone photos is up to 80 MB uploaded and a ZIP downloaded back. Run
 * here, nothing is uploaded at all — which is also why the per-file fallback
 * matters: one file the engine cannot handle should cost that one file an
 * upload, not the other nineteen.
 *
 * ONE AT A TIME IS NOT NEGOTIABLE
 *
 * processBatch already awaits each file before starting the next, and
 * lib/image-client/client.js queues jobs so only one is ever inside the worker.
 * Both are deliberate. Peak memory, not throughput, is what kills a phone tab,
 * and the measured 3.8x on this path comes from shrinking before encoding —
 * not from running files in parallel, which would only multiply the peak.
 *
 * A CANCEL IS RE-THROWN, NEVER FALLEN BACK
 *
 * Any other failure is this DEVICE failing, not this file, so the server still
 * gets its turn and the visitor sees one resized image rather than an error.
 * A cancel is the opposite: the person asked for the work to stop, and quietly
 * posting the same file to the server is the one thing they did not ask for.
 * processBatch reads the re-thrown abort and stops the whole run.
 */
import { canProcessLocally } from '@/lib/hooks/useLocalFirstProcess';
import { MAX_DIMENSION } from '@/lib/constants';
import { explicitTargetDimensions, parsePositiveInt } from '@/lib/image/dimensions';
import { processImage } from '@/lib/image-client/client';
import { submitFile as postToServer } from '@/lib/upload/submit-file';

function isCancellation(error, signal) {
    return Boolean(signal?.aborted) || error?.name === 'AbortError' || error?.code === 'cancelled';
}

/**
 * The output size this file is heading for, so the memory gate costs the real
 * job rather than a same-size re-encode. Nulls mean "not knowable yet", which
 * the gate reads as the source size — the honest answer when the fields are
 * empty, and the safe one when they are out of range (the engine then refuses
 * in the same words the route would have).
 */
function targetFor(fields, sourceWidth, sourceHeight) {
    const width = parsePositiveInt(fields?.width, { max: MAX_DIMENSION });
    const height = parsePositiveInt(fields?.height, { max: MAX_DIMENSION });

    if (!width.ok && !height.ok) return { width: null, height: null };

    const resolved = explicitTargetDimensions(sourceWidth, sourceHeight, {
        width: width.ok ? width.value : null,
        height: height.ok ? height.value : null,
    });

    return resolved.ok ? { width: resolved.width, height: resolved.height } : { width: null, height: null };
}

/**
 * Builds the per-file submitter processBatch calls.
 *
 * @param {object}   [options]
 * @param {string}   [options.op]          engine operation, e.g. 'resize'
 * @param {function} [options.process]     the engine; injectable for tests
 * @param {function} [options.submitFile]  the server lane; injectable for tests
 * @returns {function} ({ endpoint, file, fields, sourceWidth, sourceHeight, signal }) => Promise<object>
 */
export function createLocalFirstSubmit({
    op = 'resize',
    process = processImage,
    submitFile = postToServer,
} = {}) {
    return async function submitOne({
        endpoint,
        file,
        fields = {},
        sourceWidth = null,
        sourceHeight = null,
        signal,
    } = {}) {
        const target = targetFor(fields, sourceWidth, sourceHeight);

        const runsLocally = canProcessLocally(file, {
            op,
            sourceWidth,
            sourceHeight,
            targetWidth: target.width,
            targetHeight: target.height,
        });

        if (runsLocally) {
            try {
                // The field names the route reads are the names the engine
                // reads for resize, which is why `fields` goes through whole
                // rather than being re-mapped here.
                const outcome = await process(op, file, { ...fields, sourceWidth, sourceHeight }, { signal });

                return {
                    ok: true,
                    blob: outcome.blob,
                    filename: outcome.filename,
                    originalBytes: outcome.originalBytes ?? file?.size ?? null,
                    resultBytes: outcome.resultBytes ?? outcome.blob?.size ?? null,
                    savedPercent: outcome.savedPercent ?? null,
                };
            } catch (error) {
                if (isCancellation(error, signal)) throw error;
                // Silent on purpose: the visitor gets one resized image, not a
                // failure followed by a retry.
            }
        }

        return submitFile({ endpoint, file, fields, signal });
    };
}

export default createLocalFirstSubmit;
