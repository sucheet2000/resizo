'use client';

/**
 * One file inside a batch, processed on this device.
 *
 * lib/hooks/useLocalProcess.js does this for a single-file tool and holds React
 * state while it does. A batch cannot use it: twenty files are one submit, one
 * progress bar and one result, so the gate and the engine have to be driven per
 * file inside processBatch instead. What is shared is the gate itself —
 * assessJob is imported, never re-derived — and the shape processBatch reads:
 *
 *   { ok: true, blob, filename, originalBytes, resultBytes, savedPercent }
 *   { ok: false, error }
 *
 * so processBatch, the ZIP assembler and the result panel are unchanged.
 *
 * WHAT THIS IS WORTH
 *
 * Twenty phone photos used to be up to 80 MB uploaded and a ZIP downloaded
 * back. Nothing is uploaded now, at all — and a file this device cannot handle
 * is recorded as that one file's failure, with the gate's own words, so the
 * other nineteen still finish and still zip.
 *
 * ONE AT A TIME IS NOT NEGOTIABLE
 *
 * processBatch already awaits each file before starting the next, and
 * lib/image-client/client.js queues jobs so only one is ever inside the worker.
 * Both are deliberate. Peak memory, not throughput, is what kills a phone tab,
 * and the measured 3.8x on this path comes from shrinking before encoding —
 * not from running files in parallel, which would only multiply the peak.
 *
 * A CANCEL IS RE-THROWN, NEVER RECORDED AS A FAILURE
 *
 * The person asked for the work to stop, so processBatch reads the re-thrown
 * abort and stops the whole run rather than marking nineteen files failed.
 */
import { MAX_DIMENSION } from '@/lib/limits';
import { explicitTargetDimensions, parsePositiveInt } from '@/lib/image/dimensions';
import { assessJob, refusalMessage } from '@/lib/image-client/capability';
import { processImage } from '@/lib/image-client/client';

const FAILED_MESSAGE = 'That image could not be processed on this device.';

function isCancellation(error, signal) {
    return Boolean(signal?.aborted) || error?.name === 'AbortError' || error?.code === 'cancelled';
}

/**
 * The output size this file is heading for, so the memory gate costs the real
 * job rather than a same-size re-encode. Nulls mean "not knowable yet", which
 * the gate reads as the source size — the honest answer when the fields are
 * empty, and the safe one when they are out of range (the engine then refuses
 * in its own words).
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
 * Builds the per-file processor processBatch calls.
 *
 * @param {object}   [options]
 * @param {string}   [options.op]       engine operation, e.g. 'resize'
 * @param {function} [options.process]  the engine; injectable for tests
 * @returns {function} ({ file, fields, sourceWidth, sourceHeight, signal }) => Promise<object>
 */
export function createFileProcessor({ op = 'resize', process = processImage } = {}) {
    return async function processOne({
        file,
        fields = {},
        sourceWidth = null,
        sourceHeight = null,
        signal,
    } = {}) {
        const target = targetFor(fields, sourceWidth, sourceHeight);

        const assessment = assessJob(file, {
            operation: op,
            sourceWidth,
            sourceHeight,
            targetWidth: target.width,
            targetHeight: target.height,
        });

        if (!assessment.ok) return { ok: false, error: refusalMessage(assessment) };

        try {
            // The field names the engine reads for resize are the names the
            // bulk panel already builds, which is why `fields` goes through
            // whole rather than being re-mapped here.
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
            return { ok: false, error: error?.message || FAILED_MESSAGE };
        }
    };
}

export default createFileProcessor;
