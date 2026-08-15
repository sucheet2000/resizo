'use client';

/**
 * Bulk resize, orchestrated in the browser.
 *
 * Wraps processBatch with the state the panel needs: a live per-file row that
 * moves pending → resizing → done/failed, an overall progress reading, the
 * assembled ZIP once every file has settled, and a cancel that aborts the file
 * in flight and stops the rest.
 *
 * Every file is processed in this tab and nothing is uploaded. A file this
 * device cannot take is recorded as that one file's failure, in the capability
 * gate's own words, and the other nineteen still finish and still zip.
 *
 * The ZIP's object URL is revoked on a timer, not in the same tick as the
 * click — Safari and Firefox both abort a download whose blob URL disappears
 * immediately.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { processBatch } from '@/lib/upload/bulk-batch';
import { createFileProcessor } from '@/lib/upload/process-file';

const REVOKE_DELAY_MS = 1500;

const ALL_FAILED_MESSAGE = 'None of those images could be resized. Check the files and try again.';

/**
 * The images were fine; the archive was not. Every per-file failure is absorbed
 * inside processBatch, so the only thing that can throw out of it is the last
 * step — `import('jszip')` or `zip.generateAsync`. A chunk that 404s after a
 * redeploy, a dropped connection, or a failed ~80 MB allocation on a phone all
 * land here, and the wording has to say which half went wrong so that "try
 * again" reads as advice rather than a shrug. loadZipWriter evicts its memoised
 * promise on failure, so a retry genuinely retries.
 */
const ZIP_FAILED_MESSAGE = 'Those images were resized, but the ZIP could not be built. Try again.';

function triggerDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename || 'resizo-bulk.zip';
    anchor.rel = 'noopener';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS);
}

/**
 * @param {object} [options]
 * @param {string} [options.op]  the engine operation each file runs
 */
export function useBulkResize({ op = 'resize' } = {}) {
    const [isProcessing, setIsProcessing] = useState(false);
    const [progressRows, setProgressRows] = useState([]);
    const [result, setResult] = useState(null);
    const [error, setError] = useState(null);

    const controllerRef = useRef(null);
    const mountedRef = useRef(true);

    const processFile = useMemo(() => createFileProcessor({ op }), [op]);

    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
            controllerRef.current?.abort();
        };
    }, []);

    const reset = useCallback(() => {
        controllerRef.current?.abort();
        controllerRef.current = null;
        setIsProcessing(false);
        setProgressRows([]);
        setResult(null);
        setError(null);
    }, []);

    const cancel = useCallback(() => {
        controllerRef.current?.abort();
    }, []);

    const run = useCallback(async (items) => {
        const list = Array.isArray(items) ? items : [];
        if (list.length === 0) return null;

        controllerRef.current?.abort();
        const controller = new AbortController();
        controllerRef.current = controller;

        setIsProcessing(true);
        setError(null);
        setResult(null);
        setProgressRows(list.map((item) => ({ id: item.id, name: item.name, status: 'pending' })));

        const onProgress = (id, next) => {
            if (!mountedRef.current) return;
            setProgressRows((rows) => rows.map((row) => (row.id === id ? { ...row, ...next } : row)));
        };

        let outcome;
        try {
            outcome = await processBatch({
                items: list,
                processFile,
                signal: controller.signal,
                onProgress,
            });
        } catch {
            // Nothing above this line can throw — processBatch absorbs every
            // per-file failure — so this is the ZIP step, and it is the one
            // path that used to leave the panel spinning with no words in it:
            // the button stuck at "Resizing 100%", the dropzone disabled, and
            // twenty finished images discarded on the next reload.
            if (!mountedRef.current || controllerRef.current !== controller) return null;
            controllerRef.current = null;
            setIsProcessing(false);
            setError(ZIP_FAILED_MESSAGE);
            return null;
        }

        // A newer run (or a reset) has replaced this controller: its state is
        // authoritative now, so this stale completion must not write over it.
        if (!mountedRef.current || controllerRef.current !== controller) return null;

        controllerRef.current = null;
        setIsProcessing(false);

        // Cancelled: the rows already show where it stopped; no result, no error.
        if (outcome.aborted) return null;

        if (outcome.ok) {
            setResult(outcome);
            return outcome;
        }

        setError(ALL_FAILED_MESSAGE);
        return null;
    }, [processFile]);

    const progress = useMemo(() => {
        if (progressRows.length === 0) return 0;
        const settled = progressRows.filter((row) => row.status === 'done' || row.status === 'failed').length;
        return Math.round((settled / progressRows.length) * 100);
    }, [progressRows]);

    /**
     * The two things a person watching a long batch needs: how far through it
     * is, and which file is being worked on right now. A percentage on its own
     * is unreadable at twenty files — "3 of 20" is not.
     *
     * `current` is the row the engine is holding. There is never more than one:
     * processBatch awaits each file before starting the next.
     */
    const counts = useMemo(() => {
        const total = progressRows.length;
        const done = progressRows.filter((row) => row.status === 'done').length;
        const failed = progressRows.filter((row) => row.status === 'failed').length;
        const current = progressRows.find((row) => row.status === 'processing') ?? null;

        return { total, done, failed, settled: done + failed, current: current?.name ?? null };
    }, [progressRows]);

    const download = useCallback(() => {
        if (!result?.zipBlob) return false;
        triggerDownload(result.zipBlob, result.filename);
        return true;
    }, [result]);

    return {
        run,
        cancel,
        reset,
        download,
        isProcessing,
        progress,
        counts,
        progressRows,
        result,
        error,
    };
}

export default useBulkResize;
