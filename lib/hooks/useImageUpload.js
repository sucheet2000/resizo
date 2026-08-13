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
} from '@/lib/limits';
import {
    acceptAttribute,
    checkBatchLimits,
    checkDimensions,
    checkFileSize,
    constraintsLine,
    dropzoneState,
    rejectReason,
} from '@/lib/format/upload-helpers';
import { sanitizeFolderPath } from '@/lib/image/filename';
import { SIGNATURE_BYTES, sniffImageType } from '@/lib/image/magic-bytes';
import { folderPickMessage, relativePathOf, scanFolderPick } from '@/lib/upload/folder-select';

let entrySequence = 0;

function nextId() {
    entrySequence += 1;
    return `upload-${entrySequence}`;
}

async function sniffFile(file, sniff) {
    try {
        const head = await file.slice(0, SIGNATURE_BYTES).arrayBuffer();
        return sniff(new Uint8Array(head));
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
 * @param {string[]|null} options.previewFormats  when set, only these formats get an
 *   object URL and a dimension probe; every other accepted format is taken with no
 *   thumbnail and no measurement. This exists for a tool whose accept list MIXES
 *   the two — /jpg-to-pdf takes JPEG, PNG, WebP and HEIC — where `previews: false`
 *   would throw away the thumbnails and the dimensions of the three formats a
 *   browser can read, and `previews: true` would reject every HEIC as unreadable
 *   because the probe cannot decode one outside Safari.
 * @param {(bytes: Uint8Array) => string|null} options.sniff  what the first 16
 *   bytes mean. Defaults to sniffImageType, which is right for six of the seven
 *   tools and has no answer at all for the seventh: a PDF is not an image type
 *   and must never be returned by a function whose result feeds an image codec.
 *   /merge-pdf passes its own reader instead of that check being loosened.
 * @param {(formats: string[]) => string} options.rejectWrongType  the sentence a
 *   file that failed the sniff is refused with. Paired with `sniff` because the
 *   two always change together — a tool that reads different bytes is refusing
 *   for a different reason, and "not a PDF image" is what one message for both
 *   produces.
 */
export function useImageUpload({
    accept = RASTER_INPUT_FORMATS,
    multiple = false,
    maxBytes = MAX_FILE_SIZE,
    maxFiles = MAX_BULK_FILES,
    maxTotalBytes = MAX_BULK_TOTAL_BYTES,
    maxDimension = 0,
    previews = true,
    previewFormats = null,
    sniff = sniffImageType,
    rejectWrongType = rejectReason.wrongType,
} = {}) {
    const [entries, setEntries] = useState([]);
    const [error, setError] = useState(null);
    // Separate from `error` on purpose. "312 images found, the first 20 were
    // added" is not something going wrong, and rendering it in the red
    // role="alert" slot would say it was.
    const [notice, setNotice] = useState(null);
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

        const sniffed = await sniffFile(file, sniff);
        if (!sniffed || !acceptedFormats.includes(sniffed)) {
            return { error: rejectWrongType(acceptedFormats) };
        }

        const canPreview = previews
            && (previewFormats === null || previewFormats.includes(sniffed));
        const previewUrl = canPreview ? URL.createObjectURL(file) : null;

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

        // Empty for a drop and for a plain file pick; a folder pick is the one
        // path where the browser says where the file sat. Reading it here means
        // no caller has to special-case the two — the placement simply travels
        // with the entry when there is one.
        const relativePath = relativePathOf(file);

        return {
            entry: {
                id: nextId(),
                file,
                name: file.name,
                relativePath,
                folder: sanitizeFolderPath(relativePath),
                size: file.size,
                format: sniffed,
                previewUrl,
                width,
                height,
                selected: true,
            },
        };
    }, [acceptedFormats, maxBytes, maxDimension, previewFormats, previews, rejectWrongType, sniff]);

    const selectFiles = useCallback(async (input) => {
        const incoming = Array.from(input ?? []).filter(Boolean);
        setIsDragging(false);
        setNotice(null);

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

    /**
     * A whole folder, recursively, from one `<input webkitdirectory>` pick.
     *
     * Three things happen here that a plain multi-file pick does not need:
     *
     *   THE TREE IS FILTERED BY ITS BYTES. A folder contains whatever is on the
     *   disk. lib/upload/folder-select.js sniffs each file with the same
     *   signature reader this hook uses, so a `.jpg` that is really a PDF is
     *   left out here rather than reaching a decoder.
     *
     *   THE FOLDER IS COUNTED IN FULL, then trimmed to what the batch can hold.
     *   selectFiles refuses an over-cap selection outright, which is the right
     *   answer for a drop of twenty-five files someone chose by hand and the
     *   wrong one for a folder of three hundred nobody can "remove a few" from.
     *
     *   THE NUMBERS ARE SAID OUT LOUD. `notice` carries how many images were
     *   found, how many were added and why the rest were not. Nothing is trimmed
     *   silently.
     *
     * The entries themselves are still built by selectFiles, so acceptance,
     * previews, dimensions and the object-URL lifecycle have exactly one
     * implementation.
     */
    const selectFolder = useCallback(async (input) => {
        const incoming = Array.from(input ?? []).filter(Boolean);
        setIsDragging(false);
        setNotice(null);
        setError(null);

        if (incoming.length === 0) return [];

        setIsReading(true);

        const held = entriesRef.current;
        const summary = await scanFolderPick({
            files: incoming,
            accept: acceptedFormats,
            maxBytes,
            capacityFiles: maxFiles - held.length,
            capacityBytes: maxTotalBytes - held.reduce((sum, entry) => sum + (Number(entry.size) || 0), 0),
            sniff,
        });

        const message = folderPickMessage(summary, {
            accept: acceptedFormats,
            maxBytes,
            maxFiles,
            maxTotalBytes,
        });

        if (summary.files.length === 0) {
            setIsReading(false);
            setNotice(message);
            return [];
        }

        // selectFiles clears the notice as it starts, which is right for every
        // other caller — so this one sets it afterwards.
        const accepted = await selectFiles(summary.files);
        setNotice(message);
        return accepted;
    }, [acceptedFormats, maxBytes, maxFiles, maxTotalBytes, selectFiles, sniff]);

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

    /**
     * Moves one file `offset` places through the list.
     *
     * Order is data for /jpg-to-pdf — it IS the page order — so it lives here
     * with the entries rather than in a second array a tool keeps alongside
     * them, which is how the list and its order would drift apart. Out-of-range
     * moves are a no-op instead of wrapping around: a control at the top of the
     * list is disabled, and a keyboard repeat that overshoots must not send
     * page one to the back.
     */
    const moveFile = useCallback((id, offset) => {
        setEntries((current) => {
            const from = current.findIndex((entry) => entry.id === id);
            if (from === -1) return current;

            const to = from + Math.trunc(Number(offset) || 0);
            if (to === from || to < 0 || to >= current.length) return current;

            const next = [...current];
            const [moved] = next.splice(from, 1);
            next.splice(to, 0, moved);
            return next;
        });
    }, []);

    const clear = useCallback(() => {
        setEntries((current) => {
            for (const entry of current) revoke(entry.previewUrl);
            return [];
        });
        setError(null);
        setNotice(null);
        setIsDragging(false);
    }, []);

    const clearError = useCallback(() => setError(null), []);

    const file = multiple ? null : (entries[0] ?? null);

    return {
        // state
        file,
        files: entries,
        error,
        notice,
        isDragging,
        isReading,
        hasFiles: entries.length > 0,
        state: dropzoneState({ isDragging, hasFile: entries.length > 0, error }),
        // actions
        selectFiles,
        selectFolder,
        removeFile,
        updateFile,
        moveFile,
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
