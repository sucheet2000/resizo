'use client';

/**
 * Local first, server second — the one place that decision is made.
 *
 * A tool page should not know where its work happens. It hands over the same
 * FormData it always built and reads back the same nine fields it always read
 * ({ submit, download, reset, cancel, isProcessing, progress, error, result,
 * setError }), because useLocalProcess and useToolSubmit were deliberately given
 * the same shape. This hook holds both, picks one per submit, and presents
 * whichever is live. The other four tools adopt it by swapping the hook they
 * import — the choosing logic is written once, here.
 *
 * WHEN THE SERVER IS USED
 *
 *   1. WebAssembly is off. A CSP without 'wasm-unsafe-eval', or a browser with
 *      it disabled, cannot run a single codec.
 *   2. The capability gate refuses the file. That covers the memory refusals
 *      (this device cannot hold this many pixels) and the plain invalid ones (a
 *      45 MB upload, a file that is not a file) — the server answers those with
 *      the same sentence it always did, so nothing is lost by deferring.
 *   3. The engine started and then failed. A worker that would not load, a
 *      codec that threw, a decode the browser refused.
 *
 * Case 3 is a fallback, not an error. The visitor asked for one cropped image;
 * they get one cropped image, and the failed first attempt is never shown. The
 * local lane is reset on the way out so its message cannot surface later.
 *
 * THE ONE NULL THAT MUST NOT FALL BACK
 *
 * A cancelled job resolves to null with no error, exactly as a failed one does.
 * Telling them apart from state alone is not possible inside a callback, so
 * cancellation is recorded on a ref at the moment Cancel is pressed. Quietly
 * re-running a cancelled job on the server is the opposite of what was asked.
 *
 * DIMENSIONS ARE NOT OPTIONAL
 *
 * `sourceWidth`/`sourceHeight` come from lib/hooks/useImageUpload, which
 * measures every file at intake. They are passed to the gate here — before the
 * engine is even asked — and passed on to the engine itself. Without them the
 * memory gate cannot run until a decode has already allocated, which is the one
 * thing it exists to get in front of: on iOS an over-committed tab is killed
 * silently, with no exception to catch.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import useLocalProcess from '@/lib/hooks/useLocalProcess';
import useToolSubmit from '@/lib/hooks/useToolSubmit';
import { assessFile, wasmSupported } from '@/lib/image-client/capability';
import { terminateWorker } from '@/lib/image-client/client';
import { fileFromFormData } from '@/lib/image-client/form-options';

export const LOCAL = 'local';
export const SERVER = 'server';

/**
 * A measurement, or nothing. A page with no preview to measure (the HEIC tool
 * creates none — no browser decodes HEIC) reports 0 or undefined, and the gate
 * treats 0 as "could not be read" and refuses. Absent is the honest answer
 * there: the gate then defers, and the engine re-costs the job the moment the
 * decoder reports the real size.
 */
function positiveOrNull(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : null;
}

/** The file out of whatever the page handed over: a FormData, a File, or `{ file }`. */
function fileFrom(input) {
    if (!input) return null;
    const fromForm = fileFromFormData(input);
    if (fromForm) return fromForm;
    if (typeof input.arrayBuffer === 'function') return input;
    return typeof input.file?.arrayBuffer === 'function' ? input.file : null;
}

/**
 * Can this job run on this device, at all?
 *
 * Exported because it is the honest answer to "will this be private?", which a
 * page may want to say out loud before anything is submitted.
 *
 * @param {File|Blob} file
 * @param {{ op: string, sourceWidth?: number|null, sourceHeight?: number|null,
 *           targetWidth?: number|null, targetHeight?: number|null }} options
 */
export function canProcessLocally(file, {
    op,
    sourceWidth = null,
    sourceHeight = null,
    targetWidth = null,
    targetHeight = null,
} = {}) {
    if (!op || !file) return false;
    if (!wasmSupported()) return false;

    return assessFile(file, {
        operation: op,
        sourceWidth: positiveOrNull(sourceWidth),
        sourceHeight: positiveOrNull(sourceHeight),
        targetWidth: positiveOrNull(targetWidth),
        targetHeight: positiveOrNull(targetHeight),
    }).ok;
}

/**
 * @param {object}   options
 * @param {string}   options.op            'resize' | 'crop' | 'compress' | 'convert' | 'heic'
 * @param {string}   options.endpoint      the route that does the same job server-side
 * @param {boolean}  options.autoDownload  fire the download as soon as the job finishes
 * @param {function} options.onSuccess     (result) => void — called once, by whichever lane won
 */
export function useLocalFirstProcess({ op, endpoint, autoDownload = false, onSuccess } = {}) {
    const [lane, setLane] = useState(SERVER);

    const local = useLocalProcess({ op, autoDownload, onSuccess });
    const server = useToolSubmit({ endpoint, autoDownload, onSuccess });

    const cancelledRef = useRef(false);
    const mountedRef = useRef(true);

    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
            // An idle worker still holds every codec heap it grew — tens of
            // megabytes the rest of the site would rather have on a phone.
            terminateWorker();
        };
    }, []);

    /**
     * @param {FormData|File|object} input   whatever the tool already builds
     * @param {{ sourceWidth?: number, sourceHeight?: number, targetWidth?: number,
     *           targetHeight?: number, filename?: string, originalBytes?: number,
     *           meta?: object }} [options]
     * @returns {Promise<object|null>} the result, or null when it failed or was cancelled
     */
    const submit = useCallback(async (input, options = {}) => {
        cancelledRef.current = false;

        const {
            sourceWidth = null,
            sourceHeight = null,
            targetWidth = null,
            targetHeight = null,
        } = options;

        const runsLocally = canProcessLocally(fileFrom(input), {
            op,
            sourceWidth,
            sourceHeight,
            targetWidth,
            targetHeight,
        });

        if (runsLocally) {
            setLane(LOCAL);

            const outcome = await local.submit(input, options);
            if (outcome || cancelledRef.current || !mountedRef.current) return outcome;

            // The engine started and could not finish. Clear what it left
            // behind so its message never reaches the page, and carry on.
            local.reset();
        }

        if (!mountedRef.current) return null;

        setLane(SERVER);
        return server.submit(input, options);
    }, [local, op, server]);

    const cancel = useCallback(() => {
        cancelledRef.current = true;
        local.cancel();
        server.cancel();
    }, [local, server]);

    const reset = useCallback(() => {
        cancelledRef.current = false;
        setLane(SERVER);
        local.reset();
        server.reset();
    }, [local, server]);

    const active = lane === LOCAL ? local : server;

    const download = useCallback(
        (override) => active.download(override),
        [active],
    );

    return {
        submit,
        download,
        reset,
        cancel,
        isProcessing: active.isProcessing,
        progress: active.progress,
        error: active.error,
        result: active.result,
        setError: active.setError,
        // Where the work actually happened. Nothing has to read these.
        lane,
        phase: lane === LOCAL ? local.phase : null,
        suggestion: lane === LOCAL ? local.suggestion : null,
    };
}

export default useLocalFirstProcess;
