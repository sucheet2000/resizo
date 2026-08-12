'use client';

/**
 * POST a tool's FormData, get a downloadable result back.
 *
 * XHR rather than fetch, for one reason: fetch cannot report upload progress,
 * and the progress bar is part of the design. The bar is real — 0-75% is the
 * measured upload, the last quarter is the server's processing time.
 *
 * The download anchor's object URL is revoked on a timer, not immediately.
 * Safari and Firefox both abort a download whose blob URL is revoked in the
 * same tick as the click.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import {
    parseHeaders,
    progressFromUpload,
    readErrorMessage,
    resultStats,
} from '@/lib/hooks/submit-helpers';

const REVOKE_DELAY_MS = 1500;

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

        return new Promise((resolve) => {
            const xhr = new XMLHttpRequest();
            requestRef.current = xhr;

            const finish = (payload, message) => {
                if (!mountedRef.current) return resolve(null);
                requestRef.current = null;
                setIsProcessing(false);

                if (message) {
                    setProgress(0);
                    setError(message);
                    return resolve(null);
                }

                setProgress(100);
                setResult(payload);
                if (autoDownload) triggerDownload(payload.blob, payload.filename);
                onSuccess?.(payload);
                return resolve(payload);
            };

            xhr.open('POST', endpoint, true);
            xhr.responseType = 'blob';

            xhr.upload.onprogress = (event) => {
                if (!event.lengthComputable || !mountedRef.current) return;
                setProgress(progressFromUpload(event.loaded, event.total));
            };

            xhr.upload.onload = () => {
                if (mountedRef.current) setProgress(75);
            };

            xhr.onerror = () => finish(null, readErrorMessage('', 0));
            xhr.ontimeout = () => finish(null, readErrorMessage('', 408));
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
                    return finish(null, readErrorMessage(text, xhr.status));
                }

                if (!blob || blob.size === 0) {
                    return finish(null, readErrorMessage('', 500));
                }

                const resolvedName = filename
                    || filenameFromDisposition(headers['content-disposition'])
                    || 'resizo-output';

                return finish({
                    blob,
                    filename: resolvedName,
                    headers,
                    meta,
                    ...resultStats({ headers, originalBytes, blobBytes: blob.size }),
                });
            };

            xhr.send(formData);
        });
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
