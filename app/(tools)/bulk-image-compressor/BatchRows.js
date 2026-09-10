'use client';

/**
 * BatchRows
 *
 * One row per file a batch touched — both halves of it. Most rows are the
 * engine's own settled outcomes (success, unmet, unsafe, cancelled); the rest
 * never reached the engine at all, because BulkCompressTool bounced them at
 * intake (the wrong format, or too large for this device before a byte was
 * read) and keeps them as a plain {id, name, status, error}. Both shapes render
 * in the one list, because a visitor who dropped twenty files needs one place
 * that accounts for all twenty — including the ones that never got to run.
 *
 * Every [data-field] cell is conditional on the row actually carrying that
 * data, rather than a row template with blanks standing in for "not measured
 * yet" and "will never be measured" — the two are different facts and read
 * differently: a still-waiting row already knows its own size and target, a
 * bounced file knows neither.
 */
import { formatFileSize } from '@/lib/format/bytes';
import { formatSavings, savingsPercent } from '@/lib/format/submit-helpers';
import { STATUS, STATUS_LABELS, limitLabel } from '@/lib/upload/compress-batch';

/** The only statuses where "met the target, yes or no" is a fact worth stating. */
const SETTLED_TARGET_STATUSES = new Set([STATUS.success, STATUS.unmet, STATUS.unsafe, STATUS.cancelled]);

/** The statuses that end in a sentence instead of a download. */
const FAILURE_STATUSES = new Set([STATUS.unmet, STATUS.unsupported, STATUS.unsafe, STATUS.cancelled]);

function Cell({ label, field, children }) {
    if (children === null || children === undefined) return null;

    return (
        <div className="flex flex-col">
            <dt className="text-micro text-ink-muted">{label}</dt>
            <dd data-field={field} className="font-data text-ui text-ink">{children}</dd>
        </div>
    );
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

export default function BatchRows({ rows, onDownload }) {
    const list = Array.isArray(rows) ? rows : [];
    if (list.length === 0) return null;

    return (
        <ul aria-label="Results" className="flex flex-col gap-2">
            {list.map((row) => {
                const dims = dimensionsText(row);
                const reduction = formatSavings(savingsPercent(row.originalBytes, row.resultBytes));
                const showTarget = Number.isFinite(row.targetBytes) && SETTLED_TARGET_STATUSES.has(row.status);

                return (
                    <li
                        key={row.id}
                        data-status={row.status}
                        data-name={row.name}
                        className="rounded-panel border border-line bg-surface-raised p-3"
                    >
                        <p className="min-w-0 truncate text-ui text-ink" title={row.name}>
                            {row.name}
                        </p>

                        <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
                            <Cell label="Status" field="status">{STATUS_LABELS[row.status] ?? row.status}</Cell>

                            {Number.isFinite(row.originalBytes) ? (
                                <Cell label="Original" field="original">{formatFileSize(row.originalBytes)}</Cell>
                            ) : null}

                            {Number.isFinite(row.resultBytes) ? (
                                <Cell label="Result" field="result">{formatFileSize(row.resultBytes)}</Cell>
                            ) : null}

                            {showTarget ? (
                                <Cell label="Target" field="target">
                                    {`≤ ${limitLabel(row.targetBytes)} ${row.status === STATUS.success ? '✓' : '✗'}`}
                                </Cell>
                            ) : null}

                            {dims ? <Cell label="Dimensions" field="dimensions">{dims}</Cell> : null}
                            {reduction ? <Cell label="Reduction" field="reduction">{reduction}</Cell> : null}
                        </dl>

                        {row.status === STATUS.success ? (
                            <button
                                type="button"
                                onClick={() => onDownload?.(row.id)}
                                className="mt-2 rounded-button border border-line px-3 py-1.5 text-ui font-semibold text-ink transition-colors duration-120 ease-snap hover:bg-surface-sunken"
                            >
                                {`Download ${row.filename ?? row.name}`}
                            </button>
                        ) : null}

                        {FAILURE_STATUSES.has(row.status) && row.error ? (
                            <p className="mt-2 text-ui text-ink-muted">{row.error}</p>
                        ) : null}
                    </li>
                );
            })}
        </ul>
    );
}
