'use client';

/**
 * Bulk compression, orchestrated in the browser.
 *
 * Wraps runCompressBatch with the state the panel needs: a live row per file
 * that moves waiting → processing → success/unmet/unsafe/cancelled, a progress
 * reading, a record of the settings the results on screen were made with, a
 * retry that touches only the rows a retry could change, and two downloads —
 * one image, or the archive.
 *
 * Every image is compressed in this tab and nothing is uploaded. A file this
 * device cannot take is that one file's row, in the memory gate's own words,
 * and the other nineteen still finish and still zip.
 *
 * THE SETTINGS ARE RECORDED, NOT ASSUMED
 *
 * `settings` is the limit and mode of the LAST RUN, which is not the same thing
 * as what the controls currently say. A person who compresses at 200 KB, then
 * drags the limit to 50 KB and reads the rows, is reading results from the
 * first number — so the panel needs both to be able to say so. Without it the
 * table quietly lies about which limit produced it.
 *
 * THE ZIP IS BUILT ON DEMAND
 *
 * buildZip is what reaches assembleZip, which is what loads JSZip. Keeping it
 * behind the button means the archiver is downloaded by the visitor who asks
 * for an archive, and by nobody else.
 *
 * The ZIP's object URL is revoked on a timer, not in the same tick as the
 * click — Safari and Firefox both abort a download whose blob URL disappears
 * immediately.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
    buildZip,
    createCompressProcessor,
    retryableIds,
    runCompressBatch,
    seedRows,
    summarize,
    STATUS,
    ZIP_FAILED_MESSAGE,
    ZIP_FILENAME,
} from '@/lib/upload/compress-batch';

const REVOKE_DELAY_MS = 1500;

const SETTLED = new Set([STATUS.success, STATUS.unmet, STATUS.unsupported, STATUS.unsafe, STATUS.cancelled]);

function triggerDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename || ZIP_FILENAME;
    anchor.rel = 'noopener';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS);
}

/**
 * Replaces the rows a run produced, leaving every other row exactly where and
 * as it was. A retry re-runs two files out of twenty and the other eighteen
 * must not move on screen or lose the blobs they are holding.
 */
function mergeRows(current, produced) {
    if (produced.length === 0) return current;

    const byId = new Map(produced.map((row) => [row.id, row]));
    return current.map((row) => byId.get(row.id) ?? row);
}

/**
 * @param {object}   [options]
 * @param {function} [options.processFile]  the per-file processor; injectable
 *   for tests, and the real one by default
 */
export function useBulkCompress({ processFile } = {}) {
    const [rows, setRows] = useState([]);
    const [settings, setSettings] = useState(null);
    const [isProcessing, setIsProcessing] = useState(false);
    const [isZipping, setIsZipping] = useState(false);
    const [zipError, setZipError] = useState(null);

    const controllerRef = useRef(null);
    const mountedRef = useRef(true);

    const defaultProcessor = useMemo(() => createCompressProcessor(), []);
    const processor = processFile ?? defaultProcessor;

    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
            controllerRef.current?.abort();
        };
    }, []);

    const cancel = useCallback(() => {
        controllerRef.current?.abort();
    }, []);

    const reset = useCallback(() => {
        controllerRef.current?.abort();
        controllerRef.current = null;
        setRows([]);
        setSettings(null);
        setIsProcessing(false);
        setIsZipping(false);
        setZipError(null);
    }, []);

    /**
     * One pass over a list of files. `keep` is the rows a retry is preserving;
     * a fresh run keeps nothing, which is what clears the last run's results
     * and stops a stale archive being built from rows nobody can see.
     */
    const execute = useCallback(async (items, { targetBytes, mode } = {}, keep = null) => {
        const list = Array.isArray(items) ? items : [];
        if (list.length === 0) return null;

        controllerRef.current?.abort();
        const controller = new AbortController();
        controllerRef.current = controller;

        const seeded = seedRows(list, { targetBytes, mode });
        setRows(keep ? mergeRows(keep, seeded) : seeded);
        setSettings({ targetBytes, mode });
        setZipError(null);
        setIsProcessing(true);

        const onProgress = (id, patch) => {
            if (!mountedRef.current) return;
            setRows((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)));
        };

        let outcome;
        try {
            outcome = await runCompressBatch({
                items: list,
                targetBytes,
                mode,
                processFile: processor,
                onProgress,
                signal: controller.signal,
            });
        } catch {
            // runCompressBatch absorbs every per-file failure, so nothing should
            // reach here — and if something ever does, the panel must not be
            // left disabled and spinning with twenty finished images behind it.
            if (!mountedRef.current || controllerRef.current !== controller) return null;
            controllerRef.current = null;
            setIsProcessing(false);
            return null;
        }

        // A newer run (or a reset) has replaced this controller: its state is
        // authoritative now, so this stale completion must not write over it.
        if (!mountedRef.current || controllerRef.current !== controller) return null;

        controllerRef.current = null;
        setIsProcessing(false);
        setRows((current) => mergeRows(current, outcome.rows));

        return outcome;
    }, [processor]);

    const run = useCallback((items, options) => execute(items, options, null), [execute]);

    /**
     * Re-runs the rows a retry could change and nothing else.
     *
     * The successes keep their blobs — redoing them would throw away finished
     * work — and an unsupported file is not on the list at all, because it will
     * be the same file type next time.
     */
    const retry = useCallback((items, options) => {
        const wanted = new Set(retryableIds(rows));
        const again = (Array.isArray(items) ? items : []).filter((item) => wanted.has(item.id));
        if (again.length === 0) return Promise.resolve(null);

        return execute(again, options, rows);
    }, [execute, rows]);

    const downloadOne = useCallback((id) => {
        const row = rows.find((candidate) => candidate.id === id);
        if (!row?.blob || !row.filename) return false;

        triggerDownload(row.blob, row.filename);
        return true;
    }, [rows]);

    const downloadZip = useCallback(async () => {
        setIsZipping(true);
        setZipError(null);

        try {
            const archive = await buildZip(rows);
            triggerDownload(archive.blob, archive.filename);
            return true;
        } catch {
            // The images were fine; the archive was not. They are all still on
            // screen and still downloadable one at a time, which is what the
            // sentence has to leave the visitor knowing.
            if (mountedRef.current) setZipError(ZIP_FAILED_MESSAGE);
            return false;
        } finally {
            if (mountedRef.current) setIsZipping(false);
        }
    }, [rows]);

    const summary = useMemo(() => summarize(rows), [rows]);

    const counts = useMemo(() => {
        const settled = rows.filter((row) => SETTLED.has(row.status)).length;
        const current = rows.find((row) => row.status === STATUS.processing) ?? null;

        return { total: rows.length, settled, current: current?.name ?? null };
    }, [rows]);

    const progress = rows.length === 0 ? 0 : Math.round((counts.settled / rows.length) * 100);

    return {
        run,
        retry,
        cancel,
        reset,
        rows,
        summary,
        settings,
        counts,
        progress,
        isProcessing,
        isZipping,
        zipError,
        downloadOne,
        downloadZip,
    };
}

export default useBulkCompress;
