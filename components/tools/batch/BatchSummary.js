'use client';

/**
 * BatchSummary (shared)
 *
 * The "Batch summary" panel extracted from the bulk compressor: a heading a
 * caller focuses once a run ends, an optional headline moment (the
 * compressor's "You saved 880 KB — 88% smaller"; the converter has none),
 * a <dl> of whatever [label, value] pairs the caller counted, the ZIP and
 * Retry actions, and the ZIP failure alert.
 *
 * Every number here is the caller's. This component knows nothing about
 * compression or conversion — it only lays out what it is given, which is
 * what lets the compressor's ten-row summary and the converter's
 * nine-row-plus-signed-difference summary share one implementation.
 *
 * `ref` is the heading itself (React 19 accepts `ref` as an ordinary prop on
 * a function component), because the caller is the one that knows WHEN a run
 * has ended and needs to move focus there — this component has no opinion
 * about that moment.
 */
export default function BatchSummary({
    ref,
    headingId,
    heading = 'Batch summary',
    headline,
    entries,
    zip,
    retry,
    zipError,
}) {
    const rows = Array.isArray(entries) ? entries : [];

    return (
        <section
            aria-labelledby={headingId}
            className="rounded-panel border border-line bg-surface-raised p-4"
        >
            <h2
                id={headingId}
                ref={ref}
                tabIndex={-1}
                className="font-display text-title font-bold tracking-tight text-ink focus:outline-none"
            >
                {heading}
            </h2>

            {headline ? (
                <p className="mt-2 font-display text-lead font-bold text-ink">{headline}</p>
            ) : null}

            <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 font-data text-ui sm:grid-cols-3">
                {rows.map(([label, value]) => (
                    <div key={label}>
                        <dt className="text-ink-muted">{label}</dt>
                        <dd className="text-ink">{value}</dd>
                    </div>
                ))}
            </dl>

            <div className="mt-4 flex flex-wrap items-center gap-3">
                {zip?.count > 0 ? (
                    <button
                        type="button"
                        onClick={zip.onClick}
                        aria-busy={zip.busy || undefined}
                        className="inline-flex items-center justify-center gap-2 rounded-button bg-accent px-5 py-3 text-base font-semibold text-accent-ink transition-[filter] duration-180 ease-snap hover:brightness-95"
                    >
                        {`Download all as ZIP (${zip.count})`}
                    </button>
                ) : null}

                {retry?.count > 0 ? (
                    <button
                        type="button"
                        onClick={retry.onClick}
                        className="rounded-button border border-line px-4 py-3 text-base text-ink transition-colors duration-120 ease-snap hover:bg-surface-sunken"
                    >
                        {`Retry failed (${retry.count})`}
                    </button>
                ) : null}
            </div>

            {zipError ? <p role="alert">{zipError}</p> : null}
        </section>
    );
}
