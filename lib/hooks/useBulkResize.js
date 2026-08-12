'use client';

/**
 * Bulk resize, orchestrated in the browser.
 *
 * Wraps processBatch with the state the panel needs: a live per-file row that
 * moves pending → resizing → done/failed, an overall progress reading, the
 * assembled ZIP once every file has settled, and a cancel that aborts the file
 * in flight and stops the rest.
 *
 * Each file goes through the local-first submitter, so the ordinary batch is
 * processed on this device and nothing is uploaded; a file the engine cannot
 * take falls back to the route on its own, without costing the rest of the
 * batch. The ZIP is assembled by the same lib/upload/bulk-batch code either
 * way — the archive was already built in the browser, only the bytes going
 * into it have moved.
 *
 * The ZIP's object URL is revoked on a timer, not in the same tick as the
 * click — Safari and Firefox both abort a download whose blob URL disappears
 * immediately, the same reason useToolSubmit does it this way.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { processBatch } from '@/lib/upload/bulk-batch';
import { createLocalFirstSubmit } from '@/lib/upload/local-first-submit';

const REVOKE_DELAY_MS = 1500;

const ALL_FAILED_MESSAGE = 'None of those images could be resized. Check the files and try again.';

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
 * @param {string} [options.endpoint]  the route each file falls back to
 * @param {string} [options.op]        the engine operation each file runs first
 */
export function useBulkResize({ endpoint = '/api/resize', op = 'resize' } = {}) {
    const [isProcessing, setIsProcessing] = useState(false);
    const [progressRows, setProgressRows] = useState([]);
    const [result, setResult] = useState(null);
    const [error, setError] = useState(null);

    const controllerRef = useRef(null);
    const mountedRef = useRef(true);

    const submitFile = useMemo(() => createLocalFirstSubmit({ op }), [op]);

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

        const outcome = await processBatch({
            items: list.map((item) => ({ ...item, endpoint })),
            submitFile,
            signal: controller.signal,
            onProgress,
        });

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
    }, [endpoint, submitFile]);

    const progress = useMemo(() => {
        if (progressRows.length === 0) return 0;
        const settled = progressRows.filter((row) => row.status === 'done' || row.status === 'failed').length;
        return Math.round((settled / progressRows.length) * 100);
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
        progressRows,
        result,
        error,
    };
}

export default useBulkResize;
