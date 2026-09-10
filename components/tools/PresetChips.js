'use client';

/**
 * PresetChips
 *
 * The flat, horizontally-scrolling row of intent chips a visitor picks instead
 * of typing numbers: /resize's platform sizes and /crop's aspect ratios both
 * render this row. It is presentational only and imports nothing from
 * lib/catalog/ — the caller injects `items`, so a /resize chip's `detail`
 * reads "1080×1440" and a /crop chip's reads "4:5" without this component
 * knowing where either string came from.
 *
 * No collapse/disclosure behaviour lives here. /resize hides this row behind
 * a mobile toggle to protect the fold above the drop zone (see PlatformSizes
 * in app/(tools)/resize/ResizeSettings.js); /crop's controls only render
 * after a file is chosen, so there is no fold to defend and the row is always
 * visible. A `collapsible` flag driving two behaviours out of one component
 * was rejected on purpose — disclosure is the caller's decision, not this
 * component's.
 *
 * `labelHidden` mirrors components/ui/Field.js's own prop of the same name:
 * the group still needs an accessible name even when a caller already renders
 * its own visible heading elsewhere (PlatformSizes does), so the label is
 * kept for aria-label and just not painted twice.
 */
export default function PresetChips({ label, items, value, onSelect, labelHidden = false, className = '' }) {
    const showLabel = Boolean(label) && !labelHidden;

    return (
        <div className={className}>
            {showLabel ? <p className="text-ui text-ink">{label}</p> : null}

            <div
                role="group"
                aria-label={label}
                className={[
                    showLabel ? 'mt-1.5' : '',
                    'flex gap-2 overflow-x-auto pb-1 md:flex-wrap md:overflow-x-visible',
                ].filter(Boolean).join(' ')}
            >
                {items.map((item) => {
                    const active = item.id === value;
                    return (
                        <button
                            key={item.id}
                            type="button"
                            aria-pressed={active}
                            title={item.title}
                            onClick={() => onSelect(active ? null : item)}
                            // The row scrolls sideways on a phone and a chip
                            // half outside it still takes focus; the browser
                            // only scrolls for a fully hidden element.
                            onFocus={(event) => event.currentTarget.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })}
                            className={[
                                'flex shrink-0 items-baseline gap-2 rounded-pill border px-3 py-1.5 transition-colors duration-120 ease-snap',
                                active
                                    ? 'border-accent bg-accent text-accent-ink'
                                    : 'border-line text-ink hover:bg-surface-sunken',
                            ].join(' ')}
                        >
                            <span className="whitespace-nowrap text-ui">{item.label}</span>
                            {item.detail ? (
                                <span className={`font-data text-micro ${active ? '' : 'text-ink-muted'}`.trim()}>{item.detail}</span>
                            ) : null}
                        </button>
                    );
                })}
            </div>
        </div>
    );
}
