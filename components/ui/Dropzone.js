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
 *
 * A batch zone may also offer a FOLDER control, which is a second input
 * carrying `webkitdirectory` — one pick, the whole tree. It renders only when
 * the caller asks for it AND the browser has the attribute, and that second
 * answer is read through useSyncExternalStore so the server render and the
 * hydration pass agree on "no". Where it is unsupported nothing about this
 * component changes: same single input, same single button, same three intake
 * paths.
 */
import { useCallback, useRef, useState, useSyncExternalStore } from 'react';

import { folderPickSupported } from '@/lib/upload/folder-select';

/**
 * Whether this browser's file input takes a folder, read the way a client-only
 * fact has to be read in an app that server-renders: `false` on the server and
 * for the hydration pass, the real answer immediately after. Never changes
 * afterwards, so the subscribe callback has nothing to subscribe to.
 */
const NO_SUBSCRIPTION = () => () => {};
const clientFolderSupport = () => folderPickSupported();
const serverFolderSupport = () => false;

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
    onFolderFiles,
    onDragChange,
    disabled = false,
    browseLabel = 'Browse files',
    folderLabel = null,
    className = '',
    children,
}) {
    const inputRef = useRef(null);
    const folderInputRef = useRef(null);
    const [isOver, setIsOver] = useState(false);
    const canPickFolder = useSyncExternalStore(NO_SUBSCRIPTION, clientFolderSupport, serverFolderSupport);

    const showFolder = Boolean(folderLabel && onFolderFiles && canPickFolder);

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

    const openFolderPicker = useCallback(() => {
        if (disabled) return;
        folderInputRef.current?.click();
    }, [disabled]);

    const handleChange = useCallback((event) => {
        const files = Array.from(event.target.files ?? []);
        if (files.length > 0) onFiles?.(files);
        // Reset so re-picking the same file still fires a change event.
        event.target.value = '';
    }, [onFiles]);

    const handleFolderChange = useCallback((event) => {
        const files = Array.from(event.target.files ?? []);
        if (files.length > 0) onFolderFiles?.(files);
        event.target.value = '';
    }, [onFolderFiles]);

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

            {/* webkitdirectory is lower-case on purpose: React passes an
                all-lower-case unknown attribute straight through to the DOM.
                `directory` sits beside it as the standardised spelling. */}
            {showFolder ? (
                <input
                    ref={folderInputRef}
                    id={`${id}-folder`}
                    type="file"
                    multiple
                    webkitdirectory=""
                    directory=""
                    disabled={disabled}
                    onChange={handleFolderChange}
                    tabIndex={-1}
                    aria-label={folderLabel}
                    className="sr-only"
                    aria-describedby={describedBy}
                />
            ) : null}

            <div className="flex flex-wrap items-center justify-center gap-2">
                <button
                    type="button"
                    onClick={openPicker}
                    disabled={disabled}
                    className="rounded-button bg-accent px-4 py-2 text-ui font-semibold text-accent-ink transition-opacity duration-120 ease-snap hover:opacity-90 disabled:opacity-60"
                >
                    {browseLabel}
                </button>

                {showFolder ? (
                    <button
                        type="button"
                        onClick={openFolderPicker}
                        disabled={disabled}
                        className="rounded-button border border-line bg-surface-raised px-4 py-2 text-ui font-semibold text-ink transition-colors duration-120 ease-snap hover:bg-surface-sunken disabled:opacity-60"
                    >
                        {folderLabel}
                    </button>
                ) : null}
            </div>

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
