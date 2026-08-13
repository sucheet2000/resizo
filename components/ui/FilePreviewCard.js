'use client';

/**
 * FilePreviewCard
 *
 * The accepted-file state of the panel. Dimensions, bytes and format are the
 * interface here, so all three are set in mono with tabular figures; the
 * thumbnail sits on the checkerboard so a transparent PNG reads as transparent
 * rather than as a white rectangle.
 */
import { formatFileSize } from '@/lib/format/bytes';
import { formatLabel } from '@/lib/format/upload-helpers';

export default function FilePreviewCard({
    name,
    size,
    format,
    width,
    height,
    previewUrl,
    onRemove,
    removeLabel = 'Remove file',
    selected,
    onToggleSelected,
    meta,
    className = '',
}) {
    const dimensions = Number.isFinite(width) && Number.isFinite(height) ? `${width}×${height}` : null;

    const facts = [
        dimensions,
        Number.isFinite(size) ? formatFileSize(size) : null,
        format ? formatLabel(format) : null,
    ].filter(Boolean);

    return (
        <div
            className={[
                'flex items-center gap-3 rounded-panel border border-line bg-surface-raised p-3',
                className,
            ].filter(Boolean).join(' ')}
        >
            {onToggleSelected ? (
                <input
                    type="checkbox"
                    checked={Boolean(selected)}
                    onChange={(event) => onToggleSelected(event.target.checked)}
                    aria-label={`Include ${name}`}
                    className="size-4 shrink-0 accent-[var(--accent)]"
                />
            ) : null}

            <div className="checkerboard size-14 shrink-0 overflow-hidden rounded-input border border-line">
                {previewUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element -- blob: URL from the visitor's own file; next/image cannot optimise it.
                    <img
                        src={previewUrl}
                        alt=""
                        className="size-full object-contain"
                    />
                ) : (
                    <span
                        aria-hidden="true"
                        className="flex size-full items-center justify-center font-data text-micro text-ink-muted"
                    >
                        {format ? formatLabel(format) : '—'}
                    </span>
                )}
            </div>

            <div className="min-w-0 flex-1">
                <p className="truncate text-ui text-ink" title={name}>
                    {name}
                </p>
                {facts.length > 0 ? (
                    <p className="font-data text-micro text-ink-muted">{facts.join(' · ')}</p>
                ) : null}
                {meta}
            </div>

            {onRemove ? (
                <button
                    type="button"
                    onClick={onRemove}
                    aria-label={`${removeLabel}: ${name}`}
                    className="shrink-0 rounded-button p-1.5 text-ink-muted transition-colors duration-120 ease-snap hover:bg-surface-sunken hover:text-ink"
                >
                    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none">
                        <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    </svg>
                </button>
            ) : null}
        </div>
    );
}
