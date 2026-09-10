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
                                    {`≤ ${limitLabel(row.targetBytes)} ${targetMark(row.status)}`}
                                </Cell>
                            ) : null}

                            {dims ? <Cell label="Dimensions" field="dimensions">{dims}</Cell> : null}
                            {reduction ? <Cell label="Reduction" field="reduction">{reduction}</Cell> : null}
                        </dl>

                        {/* row.note is the engine's own explanation for a SUCCESSFUL
                            row that still isn't the ordinary case — today that means
                            row.kept: a file already at or under its limit, handed
                            back unencoded with only its metadata stripped. Rendered
                            in the same muted style as a failure sentence, because it
                            is the same kind of fact: why this row is what it is. */}
                        {row.status === STATUS.success && row.note ? (
                            <p className="mt-2 text-ui text-ink-muted">{row.note}</p>
                        ) : null}

                        {row.status === STATUS.success ? (
                            // min-w-0 + max-w-full let the button shrink below its
                            // text's natural width instead of forcing the row wider
                            // than the phone screen — measured at 442px wide inside a
                            // 349px row with an ordinary Android filename. The full
                            // sentence still IS the accessible name and the title;
                            // only the VISIBLE label truncates, on the inner span.
                            <button
                                type="button"
                                onClick={() => onDownload?.(row.id)}
                                title={`Download ${row.filename ?? row.name}`}
                                className="mt-2 inline-flex min-h-11 max-w-full min-w-0 items-center rounded-button border border-line px-3 py-1.5 text-ui font-semibold text-ink transition-colors duration-120 ease-snap hover:bg-surface-sunken"
                            >
                                <span className="min-w-0 truncate">{`Download ${row.filename ?? row.name}`}</span>
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
