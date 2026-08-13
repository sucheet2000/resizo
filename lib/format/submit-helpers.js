/**
 * Result Helpers
 *
 * The arithmetic and the wording behind "how much smaller did that get?", used
 * by the single-file result panel, the batch total line and the engine itself.
 * All pure, all shared, none of it aware of where the work happened.
 *
 * This file used to be the pure half of useToolSubmit and was mostly about a
 * response: a status-code sentence table, an error-body reader that would not
 * print a stack trace at a visitor, a raw-header parser, and a progress bar that
 * mapped bytes uploaded onto its first three quarters. Nothing is uploaded any
 * more and there is no response to read, so all of that went with the routes
 * rather than being left in place to describe a transport that no longer exists.
 *
 * NO REACT, AND THAT IS LOAD-BEARING — the same reason its neighbour
 * upload-helpers.js gives at length. Both used to sit in lib/hooks/ beside four
 * 'use client' React hooks while the WORKER engine imported them directly, so
 * the worker stayed React-free only as long as nobody added a useState to a
 * file in a directory called hooks. lib/format/ makes the boundary the
 * directory instead of the habit.
 */
import { formatFileSize } from '@/lib/format-bytes';

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
