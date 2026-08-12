'use client';

/**
 * Process an image on this device, get a downloadable result back.
 *
 * The local twin of useToolSubmit, and deliberately the same shape:
 *
 *   { submit, download, reset, cancel, isProcessing, progress, error, result, setError }
 *
 * Same names, same types, same contract — `submit` resolves to the result or to
 * null and never rejects, `error` is a sentence, `progress` is 0-100, `result`
 * carries `{ blob, filename, originalBytes, resultBytes, savedPercent }`. A tool
 * page switches builds by changing which hook it imports and swapping
 * `endpoint: '/api/resize'` for `op: 'resize'`. Nothing else in the page moves.
 *
 * `phase` and `suggestion` are additions, not replacements. Nothing has to read
 * them; a page that ignores them behaves exactly as it did.
 *
 * WHAT IS NO LONGER TRUE, NOW THAT THERE IS NO REQUEST
 *
 *  - Progress is stages, not bytes. The old bar was honest: 0-75% was a
 *    measured upload and the rest was the server thinking. Here nothing is
 *    uploaded, so the bar reports which stage of decode → resize → encode the
 *    engine has reached. The one place it is genuinely granular is the
 *    exact-size search, which ticks per probe.
 *  - There is no timeout. A 120-second guard existed because a stalled request
 *    can hang forever with no signal. A local job either finishes, throws or is
 *    cancelled; there is no third state to guard against.
 *  - There is no rate limit and nothing to upload, so `remaining` is always
 *    null and `headers` is always empty. Both are kept so a result panel
 *    written against the server shape keeps working.
 *  - Cancel actually cancels. Aborting a request stopped us listening; the
 *    server finished the work anyway. Here the job stops.
 *
 * The object URL is revoked on a timer rather than immediately: Safari and
 * Firefox both abort a download whose blob URL is revoked in the same tick as
 * the click. Same reason, same 1500 ms, as useToolSubmit.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { processImage } from '@/lib/image-client/client';
import { fileFromFormData, optionsFromFormData } from '@/lib/image-client/form-options';

const REVOKE_DELAY_MS = 1500;

const FALLBACK_MESSAGE = 'Something went wrong while processing that image. Try again.';

function triggerDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename || 'resizo-output';
    anchor.rel = 'noopener';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS);
}

function isFormDataLike(value) {
    return Boolean(value) && typeof value.get === 'function' && typeof value.has === 'function';
}

/**
 * Works out what the caller handed over.
 *
 * A FormData is read with the field names its route used, so an existing page
 * needs no changes. A File goes through as-is with the extra keys of the second
 * argument as its options. A plain object may carry the file under `file`.
 */
function resolveInput(op, input, extras) {
    if (isFormDataLike(input)) {
        return { file: fileFromFormData(input), options: { ...optionsFromFormData(op, input), ...extras } };
    }

    if (typeof input?.arrayBuffer === 'function' || input instanceof ArrayBuffer || ArrayBuffer.isView(input)) {
        return { file: input, options: { ...extras } };
    }

    if (input && typeof input === 'object') {
        const { file, ...rest } = input;
        return { file: file ?? null, options: { ...rest, ...extras } };
    }

    return { file: null, options: { ...extras } };
}

/**
 * @param {object}   options
 * @param {string}   options.op            'resize' | 'crop' | 'compress' | 'convert' | 'heic'
 * @param {boolean}  options.autoDownload  fire the download as soon as the job finishes
 * @param {function} options.onSuccess     (result) => void
 */
export function useLocalProcess({ op, autoDownload = false, onSuccess } = {}) {
    const [isProcessing, setIsProcessing] = useState(false);
    const [progress, setProgress] = useState(0);
    const [phase, setPhase] = useState(null);
    const [error, setError] = useState(null);
    const [suggestion, setSuggestion] = useState(null);
    const [result, setResult] = useState(null);

    const controllerRef = useRef(null);
    const mountedRef = useRef(true);

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
        setProgress(0);
        setPhase(null);
        setError(null);
        setSuggestion(null);
        setResult(null);
    }, []);

    const cancel = useCallback(() => {
        controllerRef.current?.abort();
    }, []);

    /**
     * @param {FormData|File|Blob|object} input
     * @param {object} [options] filename / originalBytes / meta, plus
     *   sourceWidth and sourceHeight — pass those whenever the page has
     *   measured the image (useImageUpload does at intake). Without them the
     *   memory gate cannot run until the decode has already allocated, which is
     *   the one thing the gate exists to get in front of.
     * @returns {Promise<object|null>} the result, or null when it failed or was cancelled
     */
    const submit = useCallback((input, {
        filename = null,
        originalBytes = null,
        meta = null,
        ...rest
    } = {}) => {
        if (!op) throw new Error('useLocalProcess requires an op.');

        controllerRef.current?.abort();

        const { file, options } = resolveInput(op, input, rest);

        setIsProcessing(true);
        setProgress(0);
        setPhase(null);
        setError(null);
        setSuggestion(null);
        setResult(null);

        const fail = (message, hint = null) => {
            if (!mountedRef.current) return null;
            controllerRef.current = null;
            setIsProcessing(false);
            setProgress(0);
            setPhase(null);
            setError(message);
            setSuggestion(hint);
            return null;
        };

        if (!file) return Promise.resolve(fail('No file provided in the request.'));

        const controller = new AbortController();
        controllerRef.current = controller;

        return processImage(op, file, options, {
            signal: controller.signal,
            onProgress: (value, stage) => {
                if (!mountedRef.current) return;
                setProgress(value);
                setPhase(stage);
            },
        }).then((outcome) => {
            if (!mountedRef.current) return null;

            controllerRef.current = null;
            setIsProcessing(false);
            setProgress(100);
            setPhase('done');

            const payload = {
                ...outcome,
                // The engine measured the file itself, so its count wins; the
                // caller's is only a fallback for a source that had no size.
                originalBytes: outcome.originalBytes || originalBytes,
                filename: filename || outcome.filename,
                headers: {},
                meta,
            };

            setResult(payload);
            if (autoDownload) triggerDownload(payload.blob, payload.filename);
            onSuccess?.(payload);

            return payload;
        }).catch((failure) => {
            // A cancel is not an error. It clears the bar and says nothing,
            // exactly as an aborted request did.
            if (failure?.code === 'cancelled') {
                if (!mountedRef.current) return null;
                controllerRef.current = null;
                setIsProcessing(false);
                setProgress(0);
                setPhase(null);
                return null;
            }

            return fail(failure?.message || FALLBACK_MESSAGE, failure?.suggestion ?? null);
        });
    }, [autoDownload, onSuccess, op]);

    /** Re-fires the browser download for a result already in hand. */
    const download = useCallback((override) => {
        const payload = override ?? result;
        if (!payload?.blob) return false;
        triggerDownload(payload.blob, payload.filename);
        return true;
    }, [result]);

    return {
        submit,
        download,
        reset,
        cancel,
        isProcessing,
        progress,
        error,
        result,
        setError,
        // Local-only additions. Nothing has to read them.
        phase,
        suggestion,
    };
}

export default useLocalProcess;
