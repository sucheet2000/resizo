/**
 * Submit Helpers
 *
 * The pure half of useToolSubmit. The important one is readErrorMessage: a
 * platform 413 or a proxy 502 returns HTML or an empty body, and the old
 * clients ran `await res.json()` on it unguarded, so a file-too-large answer
 * surfaced to the visitor as "Unexpected token '<'".
 */
import { formatFileSize } from '@/lib/format-bytes';

const STATUS_MESSAGES = {
    0: 'The upload could not reach the server. Check your connection and try again.',
    401: 'You need to be signed in to do that.',
    403: 'That request was refused.',
    404: 'That tool endpoint could not be found.',
    408: 'The upload timed out before it finished. Try again.',
    413: 'That file is larger than the server will accept. Compress it first, or pick a smaller one.',
    415: 'That file type is not supported by this tool.',
    429: 'Too many requests. Wait a minute and try again.',
    500: 'The server could not process that image. Try again.',
    502: 'The server did not answer. Try again in a moment.',
    503: 'The server is busy right now. Try again in a moment.',
    504: 'The server took too long to process that image. Try a smaller file.',
};

const FALLBACK_MESSAGE = 'Something went wrong while processing that image. Try again.';

/**
 * Shown when the client's own request timer fires before the server answers.
 * Distinct from an HTTP 408 (which the server returns and the status table
 * already covers): this is the guard that stops a stalled request from pinning
 * the progress bar at 75% forever.
 */
export const TIMEOUT_MESSAGE = 'That took too long — try a smaller file, or try again.';

/** A human sentence for a status code that carried no usable body. */
export function messageForStatus(status) {
    const code = Number(status);
    if (STATUS_MESSAGES[code]) return STATUS_MESSAGES[code];
    if (code >= 500) return STATUS_MESSAGES[500];
    if (code >= 400) return FALLBACK_MESSAGE;
    return FALLBACK_MESSAGE;
}

/**
 * Extracts the message from an error body of unknown shape. JSON `{ error }`
 * wins; anything else (HTML, plain text, an empty body) falls back to the
 * status sentence rather than being printed at the visitor.
 */
export function readErrorMessage(bodyText, status) {
    const text = typeof bodyText === 'string' ? bodyText.trim() : '';
    if (text === '') return messageForStatus(status);

    if (text.startsWith('{') || text.startsWith('[')) {
        try {
            const parsed = JSON.parse(text);
            const message = parsed?.error ?? parsed?.message;
            if (typeof message === 'string' && message.trim() !== '') return message.trim();
        } catch {
            // Body claimed to be JSON and was not.
        }
        // A body that looked like JSON but yielded no message is never shown
        // raw — '{"ok":false}' is not a sentence.
        return messageForStatus(status);
    }

    // Markup or a stack trace is never shown to a visitor.
    if (text.startsWith('<') || text.length > 200) return messageForStatus(status);

    // Neither is a bare HTTP reason phrase. A platform 413 answers with the
    // words 'Request Entity Too Large' as plain text, which is a protocol
    // label, not a sentence that tells anyone what to do about it — and a
    // body of literally 'undefined' is worse. Only a finished sentence is
    // passed through; everything else falls back to the status sentence.
    if (!/[.!?]$/.test(text)) return messageForStatus(status);

    return text;
}

/**
 * Parses the raw XHR header block into a lower-cased lookup. Header names are
 * case-insensitive on the wire; lower-casing once here means no caller has to
 * guess how the runtime spelled 'X-Output-Size'.
 */
export function parseHeaders(rawHeaders) {
    const out = {};
    if (typeof rawHeaders !== 'string') return out;

    for (const line of rawHeaders.trim().split(/[\r\n]+/)) {
        const separator = line.indexOf(':');
        if (separator <= 0) continue;
        const key = line.slice(0, separator).trim().toLowerCase();
        const value = line.slice(separator + 1).trim();
        if (key) out[key] = value;
    }

    return out;
}

function headerNumber(headers, name) {
    const value = Number(headers?.[name]);
    return Number.isFinite(value) && value >= 0 ? value : null;
}

/**
 * Result statistics. The routes report X-Original-Size / X-Output-Size where
 * they can; the blob's own length is the fallback so the panel always has a
 * real "after" number to print.
 */
export function resultStats({ headers = {}, originalBytes = null, blobBytes = null } = {}) {
    const before = headerNumber(headers, 'x-original-size') ?? (Number.isFinite(originalBytes) ? originalBytes : null);
    const after = headerNumber(headers, 'x-output-size') ?? (Number.isFinite(blobBytes) ? blobBytes : null);

    return {
        originalBytes: before,
        resultBytes: after,
        savedPercent: savingsPercent(before, after),
        targetBytes: headerNumber(headers, 'x-target-size'),
        remaining: headerNumber(headers, 'x-ratelimit-remaining'),
    };
}

/**
 * Whole-percent reduction. Returns a negative number when the output grew,
 * which is a real outcome for a PNG re-encode and must not be hidden.
 */
export function savingsPercent(before, after) {
    if (!Number.isFinite(before) || !Number.isFinite(after) || before <= 0) return null;
    return Math.round(((before - after) / before) * 100);
}

/** '-87%' / '+4%' / '0%' — the payoff numeral, using a real minus sign. */
export function formatSavings(percent) {
    if (!Number.isFinite(percent)) return null;
    if (percent > 0) return `−${percent}%`;
    if (percent < 0) return `+${Math.abs(percent)}%`;
    return '0%';
}

/** 'old → new' for a result row, both sides formatted by the one formatter. */
export function formatTransition(before, after) {
    return `${formatFileSize(before)} → ${formatFileSize(after)}`;
}

/**
 * Upload progress mapped onto the bar. The upload is 75% of the bar and the
 * server's processing time is the last quarter, so the bar never sits at 100%
 * while the request is still open.
 */
export function progressFromUpload(loaded, total) {
    if (!Number.isFinite(loaded) || !Number.isFinite(total) || total <= 0) return 0;
    const ratio = Math.min(Math.max(loaded / total, 0), 1);
    return Math.round(ratio * 75);
}

/** Sums the reductions across a batch. Returns null when nothing is measurable. */
export function batchTotals(rows) {
    const list = Array.isArray(rows) ? rows : [];

    let before = 0;
    let after = 0;
    let counted = 0;

    for (const row of list) {
        const from = Number(row?.originalBytes);
        const to = Number(row?.resultBytes);
        if (!Number.isFinite(from) || !Number.isFinite(to) || from <= 0) continue;
        before += from;
        after += to;
        counted += 1;
    }

    if (counted === 0) return null;

    return {
        count: counted,
        originalBytes: before,
        resultBytes: after,
        savedBytes: before - after,
        savedPercent: savingsPercent(before, after),
    };
}
