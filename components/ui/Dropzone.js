'use client';

/**
 * Dropzone
 *
 * Four states, one component: rest, dragover, accepted (a ~100ms snap on
 * accept), and reject-with-reason. The constraints line lives INSIDE the zone
 * because that is where a visitor reads it — never as a caption above.
 *
 * Keyboard path: a real <button> inside the zone opens the picker. The zone
 * itself is a plain div, so there is no nested-interactive trap and no
 * div-with-onClick that only a mouse can reach.
 */
import { useCallback, useRef, useState } from 'react';

const STATE_CLASSES = {
    rest: 'border-line',
    dragover: 'border-accent bg-accent-wash',
    accepted: 'border-accent',
    reject: 'border-accent bg-accent-wash',
};

export default function Dropzone({
    id,
    label,
    constraints,
    accept,
    multiple = false,
    state = 'rest',
    reason,
    onFiles,
    onDragChange,
    disabled = false,
    browseLabel = 'Browse files',
    className = '',
    children,
}) {
    const inputRef = useRef(null);
    const [isOver, setIsOver] = useState(false);

    // A reject outranks a hover: the reason must not disappear because the
    // visitor is still dragging the same bad file around.
    const effectiveState = state === 'reject' ? 'reject' : (isOver ? 'dragover' : state);
    const describedBy = [constraints ? `${id}-constraints` : null, reason ? `${id}-reason` : null]
        .filter(Boolean)
        .join(' ') || undefined;

    const setDragging = useCallback((next) => {
        setIsOver(next);
        onDragChange?.(next);
    }, [onDragChange]);

    const openPicker = useCallback(() => {
        if (disabled) return;
        inputRef.current?.click();
    }, [disabled]);

    const handleDrop = useCallback((event) => {
        event.preventDefault();
        setDragging(false);
        if (disabled) return;
        const files = Array.from(event.dataTransfer?.files ?? []);
        if (files.length > 0) onFiles?.(files);
    }, [disabled, onFiles, setDragging]);

    const handleChange = useCallback((event) => {
        const files = Array.from(event.target.files ?? []);
        if (files.length > 0) onFiles?.(files);
        // Reset so re-picking the same file still fires a change event.
        event.target.value = '';
    }, [onFiles]);

    return (
        <div
            onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
            onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
            onDragLeave={(event) => {
                event.preventDefault();
                if (!event.currentTarget.contains(event.relatedTarget)) setDragging(false);
            }}
            onDrop={handleDrop}
            data-state={effectiveState}
            className={[
                'checkerboard flex flex-col items-center justify-center gap-3 rounded-panel border-2 border-dashed px-6 py-12 text-center',
                'transition-colors duration-120 ease-snap',
                STATE_CLASSES[effectiveState] ?? STATE_CLASSES.rest,
                disabled ? 'opacity-60' : '',
                className,
            ].filter(Boolean).join(' ')}
        >
            {/* tabIndex -1 on purpose. The input is visually hidden, so a tab
                stop on it is a focus ring nobody can see — the keyboard path is
                the Browse button below, which is a real, visible control. */}
            <input
                ref={inputRef}
                id={id}
                type="file"
                accept={accept}
                multiple={multiple}
                disabled={disabled}
                onChange={handleChange}
                tabIndex={-1}
                className="sr-only"
                aria-describedby={describedBy}
            />

            {/* A <label>, not a heading: the input needs an accessible name,
                and marking this up as an <h3> put an h3 before the page's
                first h2 on four pages. */}
            <label htmlFor={id} className="text-lead text-ink">{label}</label>

            <button
                type="button"
                onClick={openPicker}
                disabled={disabled}
                className="rounded-button bg-accent px-4 py-2 text-ui font-semibold text-accent-ink transition-opacity duration-120 ease-snap hover:opacity-90 disabled:opacity-60"
            >
                {browseLabel}
            </button>

            {constraints ? (
                <p id={`${id}-constraints`} className="font-data text-micro text-ink-muted">
                    {constraints}
                </p>
            ) : null}

            {reason ? (
                <p id={`${id}-reason`} role="alert" className="max-w-[46ch] text-ui text-accent">
                    <span className="sr-only">Error: </span>
                    {reason}
                </p>
            ) : null}

            {children}
        </div>
    );
}
