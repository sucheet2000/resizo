'use client';

/**
 * POST a tool's FormData, get a downloadable result back.
 *
 * XHR rather than fetch, for one reason: fetch cannot report upload progress,
 * and the progress bar is part of the design. The bar is real — 0-75% is the
 * measured upload, the last quarter is the server's processing time.
 *
 * A file over the direct-upload cap cannot ride the request body (Vercel
 * rejects a body past 4.5 MB), so it is uploaded straight to Vercel Blob first
 * and the route is then called with the blob URL instead of the bytes. That
 * leg reports its own progress, so the bar reads the same either way. See
 * lib/hooks/blob-upload.js for the threshold and the upload itself.
 *
 * The download anchor's object URL is revoked on a timer, not immediately.
 * Safari and Firefox both abort a download whose blob URL is revoked in the
 * same tick as the click.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import {
    LARGE_FILE_UNAVAILABLE_MESSAGE,
    shouldUploadToBlob,
    toProcessBody,
    uploadToBlob,
} from '@/lib/hooks/blob-upload';
import {
    parseHeaders,
    progressFromUpload,
    readErrorMessage,
    resultStats,
    TIMEOUT_MESSAGE,
} from '@/lib/hooks/submit-helpers';

const REVOKE_DELAY_MS = 1500;

// A stalled request must not hang the UI at 75% forever. Two minutes is
// comfortably above the server's own processing budget for a 20 MB file, so
// this only fires when something is genuinely wrong (a dropped connection, a
// wedged proxy) rather than clipping a slow-but-live upload.
const REQUEST_TIMEOUT_MS = 120_000;

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

function filenameFromDisposition(value) {
    if (typeof value !== 'string') return null;

    const utf8 = value.match(/filename\*=UTF-8''([^;]+)/i);
    if (utf8) {
        try {
            return decodeURIComponent(utf8[1]);
        } catch {
            // Malformed percent-encoding: fall through to the ASCII form.
        }
    }

    const ascii = value.match(/filename="([^"]+)"/i);
    return ascii ? ascii[1] : null;
}

/**
 * @param {object}   options
 * @param {string}   options.endpoint       e.g. '/api/compress'
 * @param {boolean}  options.autoDownload   fire the download as soon as the response lands
 * @param {function} options.onSuccess      (result) => void
 */
export function useToolSubmit({ endpoint, autoDownload = false, onSuccess } = {}) {
    const [isProcessing, setIsProcessing] = useState(false);
    const [progress, setProgress] = useState(0);
    const [error, setError] = useState(null);
    const [result, setResult] = useState(null);

    const requestRef = useRef(null);
    const mountedRef = useRef(true);

    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
            requestRef.current?.abort();
        };
    }, []);

    const reset = useCallback(() => {
        requestRef.current?.abort();
        requestRef.current = null;
        setIsProcessing(false);
        setProgress(0);
        setError(null);
        setResult(null);
    }, []);

    const cancel = useCallback(() => {
        requestRef.current?.abort();
    }, []);

    /**
     * @param {FormData} formData
     * @param {{ filename?: string, originalBytes?: number, meta?: object }} options
     * @returns {Promise<object|null>} the result, or null when the request failed
     */
    const submit = useCallback((formData, { filename, originalBytes = null, meta = null } = {}) => {
        if (!endpoint) throw new Error('useToolSubmit requires an endpoint.');

        requestRef.current?.abort();

        setIsProcessing(true);
        setProgress(0);
        setError(null);
        setResult(null);

        // Terminal state transition, shared by both transports. Returns the
        // payload (or null) rather than resolving a promise, so the caller owns
        // the resolve — the direct path resolves its own promise, the Blob path
        // returns this value up its async chain.
        const finish = (payload, message) => {
            if (!mountedRef.current) return null;
            requestRef.current = null;
            setIsProcessing(false);

            if (message) {
                setProgress(0);
                setError(message);
                return null;
            }

            setProgress(100);
            setResult(payload);
            if (autoDownload) triggerDownload(payload.blob, payload.filename);
            onSuccess?.(payload);
            return payload;
        };

        // The processing request itself. XHR rather than fetch, for upload
        // progress. `trackUpload` is off for the Blob path's process leg: the
        // body is a few bytes of JSON, so its upload is instant and mapping it
        // onto the bar would only dip 75% back to 0 and up again.
        const runProcess = (body, { trackUpload = true } = {}) => new Promise((resolve) => {
            const xhr = new XMLHttpRequest();
            requestRef.current = { abort: () => xhr.abort() };

            xhr.open('POST', endpoint, true);
            xhr.responseType = 'blob';
            xhr.timeout = REQUEST_TIMEOUT_MS;

            xhr.upload.onprogress = (event) => {
                if (!trackUpload || !event.lengthComputable || !mountedRef.current) return;
                setProgress(progressFromUpload(event.loaded, event.total));
            };

            xhr.upload.onload = () => {
                if (mountedRef.current) setProgress(75);
            };

            xhr.onerror = () => resolve(finish(null, readErrorMessage('', 0)));
            xhr.ontimeout = () => resolve(finish(null, TIMEOUT_MESSAGE));
            xhr.onabort = () => {
                if (!mountedRef.current) return resolve(null);
                requestRef.current = null;
                setIsProcessing(false);
                setProgress(0);
                resolve(null);
            };

            xhr.onload = async () => {
                const headers = parseHeaders(xhr.getAllResponseHeaders());
                const blob = xhr.response;

                if (xhr.status < 200 || xhr.status >= 300) {
                    // The body is a blob because responseType said so; a 413 or a
                    // proxy error puts HTML in it, so it is read as text and run
                    // through readErrorMessage rather than JSON.parse'd blind.
                    let text = '';
                    try {
                        text = blob && typeof blob.text === 'function' ? await blob.text() : '';
                    } catch {
                        text = '';
                    }
                    return resolve(finish(null, readErrorMessage(text, xhr.status)));
                }

                if (!blob || blob.size === 0) {
                    return resolve(finish(null, readErrorMessage('', 500)));
                }

                const resolvedName = filename
                    || filenameFromDisposition(headers['content-disposition'])
                    || 'resizo-output';

                return resolve(finish({
                    blob,
                    filename: resolvedName,
                    headers,
                    meta,
                    ...resultStats({ headers, originalBytes, blobBytes: blob.size }),
                }));
            };

            xhr.send(body);
        });

        const file = typeof formData?.get === 'function' ? formData.get('file') : null;

        // Small file: the current fast path, byte-for-byte unchanged.
        if (!shouldUploadToBlob(file)) {
            return runProcess(formData);
        }

        // Large file: upload straight to Blob (0-75% of the bar), then call the
        // processing route with the blob URL in place of the bytes (the last
        // quarter is the server's processing time).
        const controller = new AbortController();
        requestRef.current = { abort: () => controller.abort() };

        return (async () => {
            let blobUrl;
            try {
                blobUrl = await uploadToBlob(file, {
                    signal: controller.signal,
                    onProgress: (loaded, total) => {
                        if (mountedRef.current) setProgress(progressFromUpload(loaded, total));
                    },
                });
            } catch (err) {
                if (controller.signal.aborted || !mountedRef.current) {
                    if (mountedRef.current) {
                        requestRef.current = null;
                        setIsProcessing(false);
                        setProgress(0);
                    }
                    return null;
                }
                return finish(
                    null,
                    err?.code === 'unavailable' ? LARGE_FILE_UNAVAILABLE_MESSAGE : readErrorMessage('', 0),
                );
            }

            if (!mountedRef.current) return null;
            setProgress(75);

            return runProcess(toProcessBody(formData, { blobUrl, filename: file.name }), { trackUpload: false });
        })();
    }, [autoDownload, endpoint, onSuccess]);

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
    };
}

export default useToolSubmit;
