'use client';

/**
 * ResultPanel
 *
 * The payoff. A bare "your file is ready, click download" throws away the one
 * moment where the product can prove it worked, so this panel prints the real
 * numbers: before and after bytes in mono, and the reduction as one oversized
 * numeral. Growth is shown honestly as `+4%` rather than hidden.
 *
 * The batch variant is the same idea per row plus a total line set large.
 */
import { useEffect, useRef } from 'react';

import { formatFileSize } from '@/lib/format/bytes';
import {
    batchTotals,
    formatSavings,
    savingsPercent,
} from '@/lib/format/submit-helpers';

/**
 * The result region — announced when it appears, and given the keyboard.
 *
 * ToolShell's CTA morph unmounts the submit button the moment a result exists.
 * That button is what the visitor had just activated, so removing it dropped
 * `document.activeElement` back to `<body>`: the next Tab restarted from the
 * top of the page, and nothing was spoken. Measured across all seven tools.
 *
 * What made that specifically wrong rather than merely unpolished is that the
 * FAILURE path was already handled — Alert carries role="alert" and the action
 * stays mounted — so success was the only outcome a screen-reader user could
 * not tell apart from nothing having happened.
 *
 * Both things are done deliberately. `role="status"` announces the savings line
 * and the Download label on insert; moving focus puts a keyboard user on the
 * result rather than at the top of the document. Either alone is weaker: live
 * regions are unevenly honoured across screen readers, and focus alone leaves
 * a sighted mouse user with no announcement. Focus is taken ONCE, on first
 * appearance, so a re-render — a settings change, a progress tick — can never
 * snatch it back while someone is typing.
 */
function ResultRegion({ className, children }) {
    const region = useRef(null);
    const claimed = useRef(false);

    useEffect(() => {
        if (claimed.current || !region.current) return;
        claimed.current = true;
        region.current.focus();
    }, []);

    return (
        <div ref={region} role="status" tabIndex={-1} className={className}>
            {children}
        </div>
    );
}

function DownloadButton({ onClick, children, className = '' }) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={[
                'inline-flex items-center justify-center gap-2 rounded-button bg-accent px-5 py-3',
                'text-base font-semibold text-accent-ink',
                'transition-[filter] duration-180 ease-snap hover:brightness-95',
                className,
            ].filter(Boolean).join(' ')}
        >
            <span aria-hidden="true" className="font-data">✓</span>
            {children}
        </button>
    );
}

function Numeral({ percent }) {
    const text = formatSavings(percent);
    if (text === null) return null;

    return (
        <p className="font-data text-numeral font-bold leading-none text-accent">
            {text}
            <span className="sr-only">
                {percent > 0
                    ? ` smaller than the original`
                    : percent < 0
                        ? ` larger than the original`
                        : ` — the same size as the original`}
            </span>
        </p>
    );
}

/**
 * The hero for a tool whose result is not a reduction.
 *
 * Numeral above answers "how much smaller?", which is the right question for
 * six of the seven tools and the wrong one for /change-image-dpi: that tool
 * rewrites a header and leaves the compressed picture data byte for byte where
 * it was, so its percentage is permanently 0% and its screen-reader suffix
 * announced a successful job as a compression that achieved nothing.
 *
 * `payoff` takes the slot instead — same oversized mono figure, same accent, a
 * caller-supplied value and a label under it. The byte pair below is untouched:
 * the real before and after are still the truth about the file, and what the
 * payoff removes is only the framing that called their difference a saving.
 */
function Payoff({ value, label }) {
    if (!value) return null;

    return (
        <div>
            <p className="font-data text-numeral font-bold leading-none text-accent">{value}</p>
            {label ? <p className="mt-1.5 text-ui text-ink-muted">{label}</p> : null}
        </div>
    );
}

function Transition({ before, after, dimensions, comparison = true }) {
    return (
        <dl className="flex flex-wrap items-baseline gap-x-6 gap-y-2 font-data text-ui">
            {comparison ? (
                <>
                    <div className="flex items-baseline gap-2">
                        <dt className="text-ink-muted">Before</dt>
                        <dd className="text-ink">{formatFileSize(before)}</dd>
                    </div>
                    <div className="flex items-baseline gap-2">
                        <dt className="text-ink-muted">After</dt>
                        <dd className="text-ink">{formatFileSize(after)}</dd>
                    </div>
                </>
            ) : (
                <div className="flex items-baseline gap-2">
                    <dt className="text-ink-muted">File</dt>
                    <dd className="text-ink">{formatFileSize(after)}</dd>
                </div>
            )}
            {dimensions ? (
                <div className="flex items-baseline gap-2">
                    <dt className="text-ink-muted">Size</dt>
                    <dd className="text-ink">{dimensions}</dd>
                </div>
            ) : null}
        </dl>
    );
}

function SingleResult({
    previewUrl,
    alt,
    filename,
    originalBytes,
    resultBytes,
    width,
    height,
    onDownload,
    downloadLabel,
    onReset,
    resetLabel,
    footnote,
    payoff,
    comparison = true,
}) {
    const percent = savingsPercent(originalBytes, resultBytes);
    const dimensions = Number.isFinite(width) && Number.isFinite(height) ? `${width}×${height}` : null;

    return (
        <ResultRegion className="animate-result-in rounded-panel border border-line bg-surface-raised p-5 focus:outline-none">
            {previewUrl ? (
                <div className="checkerboard mb-5 flex max-h-[420px] items-center justify-center overflow-hidden rounded-panel border border-line p-3">
                    {/* eslint-disable-next-line @next/next/no-img-element -- blob: URL from the visitor's own result; next/image cannot optimise it. */}
                    <img
                        src={previewUrl}
                        alt={alt || 'Processed image'}
                        className="max-h-[396px] w-auto max-w-full object-contain"
                    />
                </div>
            ) : null}

            <div className="flex flex-wrap items-end justify-between gap-6">
                <div className="min-w-0">
                    {payoff?.value
                        ? <Payoff value={payoff.value} label={payoff.label} />
                        : <Numeral percent={percent} />}
                    <div className="mt-3">
                        <Transition before={originalBytes} after={resultBytes} dimensions={dimensions} comparison={comparison} />
                    </div>
                    {filename ? (
                        <p className="mt-2 truncate font-data text-micro text-ink-muted" title={filename}>
                            {filename}
                        </p>
                    ) : null}
                </div>

                <div className="flex flex-wrap items-center gap-3">
                    {onReset ? (
                        <button
                            type="button"
                            onClick={onReset}
                            className="rounded-button border border-line px-4 py-3 text-base text-ink transition-colors duration-120 ease-snap hover:bg-surface-sunken"
                        >
                            {resetLabel}
                        </button>
                    ) : null}
                    <DownloadButton onClick={onDownload}>{downloadLabel}</DownloadButton>
                </div>
            </div>

            {footnote ? <p className="mt-4 text-micro text-ink-muted">{footnote}</p> : null}
        </ResultRegion>
    );
}

function BatchResult({
    rows,
    onDownload,
    downloadLabel,
    onReset,
    resetLabel,
    footnote,
}) {
    const totals = batchTotals(rows);

    return (
        <ResultRegion className="animate-result-in rounded-panel border border-line bg-surface-raised p-5 focus:outline-none">
            <ul className="flex flex-col divide-y divide-line">
                {rows.map((row) => {
                    const percent = savingsPercent(row.originalBytes, row.resultBytes);
                    return (
                        <li
                            key={row.id ?? row.name}
                            className="flex items-baseline justify-between gap-4 py-2.5"
                        >
                            <span className="min-w-0 flex-1 truncate text-ui text-ink" title={row.name}>
                                {row.name}
                            </span>
                            <span className="shrink-0 font-data text-ui text-ink-muted">
                                {formatFileSize(row.originalBytes)}
                                <span aria-hidden="true"> → </span>
                                <span className="sr-only"> to </span>
                                <span className="text-ink">{formatFileSize(row.resultBytes)}</span>
                            </span>
                            <span className="w-16 shrink-0 text-right font-data text-ui font-medium text-accent">
                                {formatSavings(percent) ?? '—'}
                            </span>
                        </li>
                    );
                })}
            </ul>

            {totals ? (
                <div className="mt-6 flex flex-wrap items-end justify-between gap-6 border-t border-line pt-6">
                    <div>
                        <p className="font-display text-headline font-bold text-ink">
                            You saved{' '}
                            <span className="font-data text-accent">{formatFileSize(totals.savedBytes)}</span>
                            {Number.isFinite(totals.savedPercent) ? (
                                <>
                                    {' — '}
                                    <span className="font-data text-accent">{totals.savedPercent}%</span>
                                    {' smaller'}
                                </>
                            ) : null}
                        </p>
                        <p className="mt-2 font-data text-ui text-ink-muted">
                            {totals.count} {totals.count === 1 ? 'file' : 'files'} ·{' '}
                            {formatFileSize(totals.originalBytes)}
                            <span aria-hidden="true"> → </span>
                            <span className="sr-only"> to </span>
                            {formatFileSize(totals.resultBytes)}
                        </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-3">
                        {onReset ? (
                            <button
                                type="button"
                                onClick={onReset}
                                className="rounded-button border border-line px-4 py-3 text-base text-ink transition-colors duration-120 ease-snap hover:bg-surface-sunken"
                            >
                                {resetLabel}
                            </button>
                        ) : null}
                        <DownloadButton onClick={onDownload}>{downloadLabel}</DownloadButton>
                    </div>
                </div>
            ) : null}

            {footnote ? <p className="mt-4 text-micro text-ink-muted">{footnote}</p> : null}
        </ResultRegion>
    );
}

/**
 * @param {object}   props
 * @param {'single'|'batch'} props.variant
 * @param {string}   props.previewUrl        single: object URL of the result
 * @param {number}   props.originalBytes     single: source size
 * @param {number}   props.resultBytes       single: output size
 * @param {number}   props.width|height      single: output dimensions
 * @param {boolean}  props.comparison        single: false hides Before/After for a document
 *                                           that is new rather than a smaller copy of the source
 * @param {object}   props.payoff            single: { value, label } — replaces the
 *   savings numeral for a tool whose result is not a reduction. Absent on every
 *   compression tool, which keeps the percentage.
 * @param {Array}    props.rows              batch: [{ id, name, originalBytes, resultBytes }]
 * @param {function} props.onDownload        fires the browser download
 * @param {function} props.onReset           clears the panel back to the drop zone
 */
export default function ResultPanel({
    variant = 'single',
    downloadLabel,
    resetLabel = 'Start over',
    rows = [],
    ...rest
}) {
    if (variant === 'batch') {
        if (!Array.isArray(rows) || rows.length === 0) return null;
        return (
            <BatchResult
                rows={rows}
                downloadLabel={downloadLabel ?? 'Download all as ZIP'}
                resetLabel={resetLabel}
                {...rest}
            />
        );
    }

    return (
        <SingleResult
            downloadLabel={downloadLabel ?? 'Download'}
            resetLabel={resetLabel}
            {...rest}
        />
    );
}
