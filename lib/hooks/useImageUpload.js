'use client';

/**
 * File intake for every tool.
 *
 * Owns the four things that were previously reimplemented in six places and
 * drifted in all six: the signature check, the object-URL lifecycle, the drag
 * state, and the dimension probe.
 *
 * Two rules worth stating out loud:
 *  - The dimension probe uses `new window.Image()`. A bare `new Image()` in a
 *    module that also imports next/image resolves to the React component and
 *    throws; that is what broke /crop.
 *  - Every object URL created here is revoked here — on replace, on remove and
 *    on unmount. A leaked blob URL pins the whole decoded bitmap in memory.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
    MAX_BULK_FILES,
    MAX_BULK_TOTAL_BYTES,
    MAX_FILE_SIZE,
    RASTER_INPUT_FORMATS,
} from '@/lib/constants';
import {
    acceptAttribute,
    checkBatchLimits,
    checkDimensions,
    checkFileSize,
    constraintsLine,
    dropzoneState,
    rejectReason,
} from '@/lib/hooks/upload-helpers';
import { sniffImageType } from '@/lib/image/magic-bytes';

const SIGNATURE_BYTES = 16;

let entrySequence = 0;

function nextId() {
    entrySequence += 1;
    return `upload-${entrySequence}`;
}

async function sniffFile(file) {
    try {
        const head = await file.slice(0, SIGNATURE_BYTES).arrayBuffer();
        return sniffImageType(new Uint8Array(head));
    } catch {
        return null;
    }
}

function readDimensions(objectUrl) {
    return new Promise((resolve) => {
        // window.Image, never bare Image — see the note at the top of the file.
        const probe = new window.Image();
        probe.onload = () => resolve({ width: probe.naturalWidth, height: probe.naturalHeight });
        probe.onerror = () => resolve(null);
        probe.src = objectUrl;
    });
}

function revoke(url) {
    if (typeof url === 'string' && url.startsWith('blob:')) URL.revokeObjectURL(url);
}

/**
 * @param {object}   options
 * @param {string[]} options.accept          sniffed formats this tool accepts
 * @param {boolean}  options.multiple        batch mode
 * @param {number}   options.maxBytes        per-file cap
 * @param {number}   options.maxFiles        batch file-count cap
 * @param {number}   options.maxTotalBytes   batch byte cap
 * @param {number}   options.maxDimension    optional hard per-side cap; 0 (the default) measures without gating
 * @param {boolean}  options.previews        create object URLs (false for HEIC, which no browser decodes)
 */
export function useImageUpload({
    accept = RASTER_INPUT_FORMATS,
    multiple = false,
    maxBytes = MAX_FILE_SIZE,
    maxFiles = MAX_BULK_FILES,
    maxTotalBytes = MAX_BULK_TOTAL_BYTES,
    maxDimension = 0,
    previews = true,
} = {}) {
    const [entries, setEntries] = useState([]);
    const [error, setError] = useState(null);
    const [isDragging, setIsDragging] = useState(false);
    const [isReading, setIsReading] = useState(false);

    // Mirrors `entries` so unmount cleanup can revoke without re-running on
    // every selection (an effect keyed on `entries` would revoke live URLs).
    const entriesRef = useRef([]);
    useEffect(() => {
        entriesRef.current = entries;
    }, [entries]);

    useEffect(() => () => {
        for (const entry of entriesRef.current) revoke(entry.previewUrl);
    }, []);

    const acceptedFormats = useMemo(
        () => (Array.isArray(accept) && accept.length > 0 ? accept : RASTER_INPUT_FORMATS),
        [accept],
    );

    const buildEntry = useCallback(async (file) => {
        const sizeError = checkFileSize(file, maxBytes);
        if (sizeError) return { error: sizeError };

        const sniffed = await sniffFile(file);
        if (!sniffed || !acceptedFormats.includes(sniffed)) {
            return { error: rejectReason.wrongType(acceptedFormats) };
        }

        const previewUrl = previews ? URL.createObjectURL(file) : null;

        let width = null;
        let height = null;

        // Reading the source dimensions is a MEASUREMENT, not a gate. The
        // server accepts large sources and bounds only the OUTPUT (resize
        // targets, the decode ceiling), so a source is never rejected here for
        // being big — a 12000×9000 panorama is accepted and simply downscaled.
        // The width/height are needed for the aspect-ratio maths and the
        // preview card. A caller can still opt into a hard cap by passing a
        // positive `maxDimension`; no tool does today.
        if (previewUrl) {
            const measured = await readDimensions(previewUrl);
            if (!measured) {
                revoke(previewUrl);
                return { error: rejectReason.unreadable() };
            }

            if (maxDimension > 0) {
                const dimensionError = checkDimensions(measured.width, measured.height, maxDimension);
                if (dimensionError) {
                    revoke(previewUrl);
                    return { error: dimensionError };
                }
            }

            width = measured.width;
            height = measured.height;
        }

        return {
            entry: {
                id: nextId(),
                file,
                name: file.name,
                size: file.size,
                format: sniffed,
                previewUrl,
                width,
                height,
                selected: true,
            },
        };
    }, [acceptedFormats, maxBytes, maxDimension, previews]);

    const selectFiles = useCallback(async (input) => {
        const incoming = Array.from(input ?? []).filter(Boolean);
        setIsDragging(false);

        if (incoming.length === 0) return [];

        const candidates = multiple ? incoming : incoming.slice(0, 1);

        if (multiple) {
            const existing = entriesRef.current;
            const batchError = checkBatchLimits({
                incomingCount: candidates.length,
                existingCount: existing.length,
                incomingBytes: candidates.reduce((sum, file) => sum + (Number(file.size) || 0), 0),
                existingBytes: existing.reduce((sum, entry) => sum + (Number(entry.size) || 0), 0),
                maxFiles,
                maxTotalBytes,
            });

            if (batchError) {
                setError(batchError);
                return [];
            }
        }

        setIsReading(true);
        setError(null);

        const accepted = [];
        let firstError = null;

        for (const file of candidates) {
            // Sequential on purpose: a 20-file batch decoding in parallel spikes
            // memory on a mid-tier phone hard enough to lose the tab.
            const result = await buildEntry(file);
            if (result.entry) accepted.push(result.entry);
            else if (!firstError) firstError = result.error;
        }

        setIsReading(false);

        if (accepted.length === 0) {
            setError(firstError ?? rejectReason.unreadable());
            return [];
        }

        if (firstError) setError(firstError);

        setEntries((current) => {
            if (!multiple) {
                for (const entry of current) revoke(entry.previewUrl);
                return accepted;
            }
            return [...current, ...accepted];
        });

        return accepted;
    }, [buildEntry, maxFiles, maxTotalBytes, multiple]);

    const removeFile = useCallback((id) => {
        setEntries((current) => {
            const target = current.find((entry) => entry.id === id);
            if (target) revoke(target.previewUrl);
            return current.filter((entry) => entry.id !== id);
        });
        setError(null);
    }, []);

    const updateFile = useCallback((id, patch) => {
        setEntries((current) => current.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)));
    }, []);

    const clear = useCallback(() => {
        setEntries((current) => {
            for (const entry of current) revoke(entry.previewUrl);
            return [];
        });
        setError(null);
        setIsDragging(false);
    }, []);

    const clearError = useCallback(() => setError(null), []);

    const file = multiple ? null : (entries[0] ?? null);

    return {
        // state
        file,
        files: entries,
        error,
        isDragging,
        isReading,
        hasFiles: entries.length > 0,
        state: dropzoneState({ isDragging, hasFile: entries.length > 0, error }),
        // actions
        selectFiles,
        removeFile,
        updateFile,
        clear,
        clearError,
        setDragging: setIsDragging,
        setError,
        // control copy, so the zone's constraints and its errors agree
        accept: acceptAttribute(acceptedFormats),
        constraints: constraintsLine({
            formats: acceptedFormats,
            maxBytes,
            maxFiles: multiple ? maxFiles : undefined,
        }),
    };
}

export default useImageUpload;
