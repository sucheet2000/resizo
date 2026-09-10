'use client';

/**
 * BatchRows — the /bulk-image-compressor row description.
 *
 * The row model, the rendering and the accessible-name/data-* contract now
 * live in components/tools/batch/BatchRows.js, shared with the bulk
 * converter. What is left here is everything that is genuinely about
 * COMPRESSION: which cells a compress row shows (original/result/target/
 * dimensions/reduction), the ✓/✗/— target verdict, and which statuses end in
 * a failure sentence versus a note.
 *
 * describeCompressRow reproduces exactly what the old, compressor-only
 * BatchRows rendered — this file's whole job is that tests/components/tools/
 * batch-rows.test.jsx, unedited, is the proof nothing about the compressor
 * changed.
 */
import BatchRows from '@/components/tools/batch/BatchRows';
import { formatFileSize } from '@/lib/format/bytes';
import { formatSavings, savingsPercent } from '@/lib/format/submit-helpers';
import { STATUS, STATUS_LABELS, limitLabel } from '@/lib/upload/compress-batch';

/** The only statuses where "did this row even have a target ceiling" is a fact worth stating. */
const SETTLED_TARGET_STATUSES = new Set([
    STATUS.success, STATUS.unmet, STATUS.unsafe, STATUS.cancelled, STATUS.unsupported,
]);

/** The statuses that end in a sentence instead of a download. */
const FAILURE_STATUSES = new Set([STATUS.unmet, STATUS.unsupported, STATUS.unsafe, STATUS.cancelled]);

/**
 * ✓ means the target was met, ✗ means it genuinely was not — an unmet row is
 * the only settled outcome that ever failed AT the target. Cancelled, unsafe
 * and unsupported never got far enough to fail it or clear it, so an em dash
 * says "no verdict", not "no".
 */
function targetMark(status) {
    if (status === STATUS.success) return '✓';
    if (status === STATUS.unmet) return '✗';
    return '—';
}

/** '1600 × 1067' unchanged, or '1600 × 1067 → 1280 × 853' when it was actually resized. */
function dimensionsText(row) {
    if (!Number.isFinite(row.sourceWidth) || !Number.isFinite(row.sourceHeight)) return null;

    const source = `${row.sourceWidth} × ${row.sourceHeight}`;
    if (row.resized && Number.isFinite(row.width) && Number.isFinite(row.height)) {
        return `${source} → ${row.width} × ${row.height}`;
    }
    return source;
}

function describeCompressRow(row) {
    const dims = dimensionsText(row);
    const reduction = formatSavings(savingsPercent(row.originalBytes, row.resultBytes));
    const showTarget = Number.isFinite(row.targetBytes) && SETTLED_TARGET_STATUSES.has(row.status);

    const cells = [];
    if (Number.isFinite(row.originalBytes)) {
        cells.push({ field: 'original', label: 'Original', value: formatFileSize(row.originalBytes) });
    }
    if (Number.isFinite(row.resultBytes)) {
        cells.push({ field: 'result', label: 'Result', value: formatFileSize(row.resultBytes) });
    }
    if (showTarget) {
        cells.push({ field: 'target', label: 'Target', value: `≤ ${limitLabel(row.targetBytes)} ${targetMark(row.status)}` });
    }
    if (dims) cells.push({ field: 'dimensions', label: 'Dimensions', value: dims });
    if (reduction) cells.push({ field: 'reduction', label: 'Reduction', value: reduction });

    return {
        status: STATUS_LABELS[row.status] ?? row.status,
        cells,
        // row.note is the engine's own explanation for a SUCCESSFUL row that
        // still isn't the ordinary case — today that means row.kept: a file
        // already at or under its limit, handed back unencoded with only its
        // metadata stripped.
        note: row.status === STATUS.success && row.note ? row.note : null,
        error: FAILURE_STATUSES.has(row.status) && row.error ? row.error : null,
        download: row.status === STATUS.success ? `Download ${row.filename ?? row.name}` : null,
    };
}

export default function CompressBatchRows({ rows, onDownload }) {
    return <BatchRows rows={rows} onDownload={onDownload} describe={describeCompressRow} />;
}
