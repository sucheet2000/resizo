'use client';

/**
 * BatchRows (shared)
 *
 * One row per file a batch touched, for ANY batch tool — the bulk compressor
 * and the bulk converter both render this list, and a third batch tool would
 * too. Extracted from the compressor's own BatchRows, which is now a thin
 * wrapper here: the row model, the sequencer and the summary all moved to
 * lib/upload/batch.js for the same reason, and this component is the other
 * half of that split — the one piece of it that is UI.
 *
 * This component carries no opinion about what a row's fields mean. Every
 * fact — the status text, the labelled cells, the note, the failure sentence,
 * whether a download exists — comes from `describe(row)`, which the caller
 * supplies. The compressor's describe reproduces its five byte/target/
 * dimension cells; the converter's describe reproduces its input/output pair.
 * Neither describe function is this component's concern, which is what lets
 * one row renderer serve two very different sets of columns without an
 * `operation` prop for it to branch on.
 *
 * Every [data-field] cell — including "status", rendered the same way as
 * every other cell — appears only when describe() actually returned it,
 * rather than a row template with blanks standing in for "not measured yet"
 * and "will never be measured". A still-waiting row already knows some of its
 * own facts; a rejected row (bounced before the engine ever saw it) knows
 * almost none, and describe() is what tells the two apart.
 */

function Cell({ label, field, children }) {
    if (children === null || children === undefined) return null;

    return (
        <div className="flex flex-col">
            <dt className="text-micro text-ink-muted">{label}</dt>
            <dd data-field={field} className="font-data text-ui text-ink">{children}</dd>
        </div>
    );
}

export default function BatchRows({ rows, onDownload, describe }) {
    const list = Array.isArray(rows) ? rows : [];
    if (list.length === 0) return null;

    return (
        <ul aria-label="Results" className="flex flex-col gap-2">
            {list.map((row) => {
                const info = describe(row);
                const cells = Array.isArray(info?.cells) ? info.cells : [];

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
                            <Cell label="Status" field="status">{info?.status}</Cell>
                            {cells.map((cell) => (
                                <Cell key={cell.field} label={cell.label} field={cell.field}>{cell.value}</Cell>
                            ))}
                        </dl>

                        {/* A note explains a SUCCESSFUL row that still is not the
                            ordinary case (a file kept unchanged, a background a
                            transparent source landed on); an error explains one
                            that did not succeed. describe() decides which — if
                            either — applies, so both are rendered the same way. */}
                        {info?.note ? (
                            <p className="mt-2 text-ui text-ink-muted">{info.note}</p>
                        ) : null}

                        {info?.download ? (
                            // min-w-0 + max-w-full let the button shrink below its
                            // text's natural width instead of forcing the row wider
                            // than the phone screen — measured at 442px wide inside a
                            // 349px row with an ordinary Android filename. The full
                            // sentence still IS the accessible name and the title;
                            // only the VISIBLE label truncates, on the inner span.
                            <button
                                type="button"
                                onClick={() => onDownload?.(row.id)}
                                title={info.download}
                                className="mt-2 inline-flex min-h-11 max-w-full min-w-0 items-center rounded-button border border-line px-3 py-1.5 text-ui font-semibold text-ink transition-colors duration-120 ease-snap hover:bg-surface-sunken"
                            >
                                <span className="min-w-0 truncate">{info.download}</span>
                            </button>
                        ) : null}

                        {info?.error ? (
                            <p className="mt-2 text-ui text-ink-muted">{info.error}</p>
                        ) : null}
                    </li>
                );
            })}
        </ul>
    );
}
