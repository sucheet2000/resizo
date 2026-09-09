'use client';

/**
 * Process an image on this device, get a downloadable result back.
 *
 * This is the only way a tool page does work. There used to be two — this hook
 * and useToolSubmit, with useLocalFirstProcess in the middle choosing between
 * them per submit and quietly deferring to the server whenever the tab could
 * not cope. The server is gone, so the choice is gone, and all three files have
 * collapsed into this one. A page hands over the FormData it always built and
 * reads back the same fields it always read:
 *
 *   { submit, download, reset, cancel, isProcessing, progress, error, result, setError }
 *
 * `submit` resolves to the result or to null and never rejects, `error` is a
 * sentence, `progress` is 0-100, `result` carries
 * `{ blob, filename, originalBytes, resultBytes, savedPercent }`.
 *
 * `phase`, `suggestion` and `code` are additions, not replacements. Nothing has to read
 * them; a page that ignores them behaves exactly as it did.
 *
 * THE GATE IS THE WHOLE ANSWER NOW
 *
 * Before anything decodes, assessJob costs the job against what this device can
 * actually spare. That used to be a routing decision — refused here, posted
 * there — and a refusal was invisible to the visitor. It is now the outcome:
 * there is nowhere else to send the work, so the refusal is what they see, and
 * it is shown as the gate's own sentence plus its own suggestion rather than a
 * generic failure. `sourceWidth`/`sourceHeight` come from lib/hooks/useImageUpload,
 * which measures every file at intake, and they must reach the gate BEFORE the
 * engine is asked: on iOS an over-committed tab is killed silently, with no
 * exception to catch, so a gate that only runs after the decode has allocated is
 * a gate that runs too late.
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
 *  - Cancel actually cancels. Aborting a request stopped us listening; the
 *    server finished the work anyway. Here the job stops.
 *  - `headers` is always empty. It is kept so a result panel written against the
 *    old server shape keeps working.
 *
 * The object URL is revoked on a timer rather than immediately: Safari and
 * Firefox both abort a download whose blob URL is revoked in the same tick as
 * the click.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import {
    assessJob,
    assessPdfMergeJob,
    refusalMessage,
    MERGE_OPERATION,
} from '@/lib/image-client/capability';
import { processImage, terminateWorker } from '@/lib/image-client/client';
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
 * @param {string}   options.op            'resize' | 'crop' | 'compress' | 'convert' | 'heic' | 'pdf' | 'merge'
 * @param {boolean}  options.autoDownload  fire the download as soon as the job finishes
 * @param {function} options.onSuccess     (result) => void
 */
export function useLocalProcess({ op, autoDownload = false, onSuccess } = {}) {
    const [isProcessing, setIsProcessing] = useState(false);
    const [progress, setProgress] = useState(0);
    const [phase, setPhase] = useState(null);
    const [error, setError] = useState(null);
    const [suggestion, setSuggestion] = useState(null);
    const [code, setCode] = useState(null);
    const [result, setResult] = useState(null);

    const controllerRef = useRef(null);
    const mountedRef = useRef(true);

    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
            controllerRef.current?.abort();
            // An idle worker still holds every codec heap it grew — tens of
            // megabytes the rest of the site would rather have on a phone.
            terminateWorker();
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
        setCode(null);
        setResult(null);
    }, []);

    const cancel = useCallback(() => {
        controllerRef.current?.abort();
    }, []);

    /**
     * @param {FormData|File|Blob|object} input  a multi-file op passes
     *   `{ file: [File, ...], ...options }`, in the order the pages are wanted
     * @param {object} [options] filename / originalBytes / meta, plus
     *   sourceWidth, sourceHeight, targetWidth and targetHeight — pass those
     *   whenever the page has measured or chosen them. Without the source pair
     *   the memory gate cannot run until the decode has already allocated,
     *   which is the one thing the gate exists to get in front of. A list
     *   carries `sizes: [{ width, height } | null, ...]` on the input instead,
     *   one entry per file; a hole means "not measured".
     * @returns {Promise<object|null>} the result, or null when it was refused,
     *   failed or was cancelled
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
        setCode(null);
        setResult(null);

        const fail = (message, hint = null, failureCode = null) => {
            if (!mountedRef.current) return null;
            controllerRef.current = null;
            setIsProcessing(false);
            setProgress(0);
            setPhase(null);
            setError(message);
            setSuggestion(hint);
            setCode(failureCode);
            return null;
        };

        // Pre-flight. Nothing is allocated, nothing is decoded, and a refusal
        // here is the final answer rather than a hand-off.
        //
        // A multi-file op — /jpg-to-pdf is the only one — hands over a LIST, and
        // every file in it is gated on its own, in order, so the first unusable
        // file is the one named rather than whichever the loop noticed. Its
        // measurements arrive as `sizes`, lined up with the files, because there
        // is no single sourceWidth to pass. An empty list still asks once, with
        // nothing, which is how it gets the "no image was provided" refusal
        // instead of silently passing an empty job to the worker.
        // /merge-pdf is the exception, and it has to be: assessJob's file check
        // is an image file check — its allowlist is `image/*` — so running a
        // PDF through it would refuse every document before anything looked at
        // it, in a sentence about images. A merge decodes nothing, so it has no
        // pixels to cost either; the whole job is priced in bytes by
        // assessPdfMergeJob, which is the same gate the engine runs.
        const isList = Array.isArray(file);
        const sources = isList ? file : [file];

        let assessment = { ok: true };

        if (op === MERGE_OPERATION) {
            assessment = assessPdfMergeJob({
                files: sources
                    .filter(Boolean)
                    .map((entry) => ({ fileBytes: Number(entry?.size) || 0 })),
            });
        } else {
            for (let index = 0; index < Math.max(sources.length, 1); index += 1) {
                // `options`, not `rest`. A list carries `sizes` on the INPUT
                // object — which is what the JSDoc above says and what
                // JpgToPdfTool passes — and resolveInput folds the input's
                // remaining keys into `options`. Reading `rest.sizes` was
                // therefore always undefined, so every per-file gate ran with
                // no dimensions and could only apply the file checks. The
                // refusal still happened inside the worker, but a pre-flight
                // whose whole job is to refuse BEFORE the worker starts was
                // doing nothing.
                const measured = isList ? (options.sizes?.[index] ?? null) : null;

                assessment = assessJob(sources[index] ?? null, {
                    operation: op,
                    sourceWidth: isList ? measured?.width : rest.sourceWidth,
                    sourceHeight: isList ? measured?.height : rest.sourceHeight,
                    targetWidth: rest.targetWidth,
                    targetHeight: rest.targetHeight,
                });

                if (!assessment.ok) break;
            }
        }

        if (!assessment.ok) {
            return Promise.resolve(fail(refusalMessage(assessment), assessment.suggestion ?? null, assessment.code ?? null));
        }

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

            return fail(failure?.message || FALLBACK_MESSAGE, failure?.suggestion ?? null, failure?.code ?? null);
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
        // Additions. Nothing has to read them.
        phase,
        suggestion,
        code,
    };
}

export default useLocalProcess;
