'use client';

/**
 * Modal
 *
 * Traps Tab, closes on Escape, restores focus to whatever opened it, and
 * locks the page behind it from scrolling. None of the three modals in this
 * app did any of that; Tab walked straight out of the dialog into the page
 * underneath and there was no way back.
 */
import { useCallback, useEffect, useId, useRef } from 'react';

const FOCUSABLE = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled]):not([type="hidden"])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
].join(',');

function focusableWithin(root) {
    if (!root) return [];
    return Array.from(root.querySelectorAll(FOCUSABLE)).filter(
        (element) => element.offsetParent !== null || element === document.activeElement,
    );
}

export default function Modal({
    open = true,
    onClose,
    title,
    description,
    children,
    footer,
    className = '',
    closeLabel = 'Close',
    initialFocusRef,
}) {
    const dialogRef = useRef(null);
    const restoreRef = useRef(null);
    const generatedId = useId();
    const titleId = `${generatedId}-title`;
    const descriptionId = description ? `${generatedId}-description` : undefined;

    const close = useCallback(() => {
        onClose?.();
    }, [onClose]);

    // Remember the trigger before the dialog steals focus, and hand focus back
    // to it on unmount — otherwise the visitor lands at the top of the document.
    useEffect(() => {
        if (!open) return undefined;

        restoreRef.current = document.activeElement;

        const target = initialFocusRef?.current ?? focusableWithin(dialogRef.current)[0] ?? dialogRef.current;
        target?.focus?.();

        return () => {
            const restore = restoreRef.current;
            if (restore && typeof restore.focus === 'function' && document.contains(restore)) {
                restore.focus();
            }
        };
    }, [initialFocusRef, open]);

    useEffect(() => {
        if (!open) return undefined;

        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';

        const onKeyDown = (event) => {
            if (event.key === 'Escape') {
                event.stopPropagation();
                close();
                return;
            }

            if (event.key !== 'Tab') return;

            const items = focusableWithin(dialogRef.current);
            if (items.length === 0) {
                event.preventDefault();
                dialogRef.current?.focus();
                return;
            }

            const first = items[0];
            const last = items[items.length - 1];
            const active = document.activeElement;

            if (event.shiftKey && (active === first || !dialogRef.current?.contains(active))) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && active === last) {
                event.preventDefault();
                first.focus();
            }
        };

        document.addEventListener('keydown', onKeyDown, true);

        return () => {
            document.removeEventListener('keydown', onKeyDown, true);
            document.body.style.overflow = previousOverflow;
        };
    }, [close, open]);

    if (!open) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            {/* Backdrop. A plain wash, no blur — blur is on the reject list.
                Hidden from the accessibility tree: it is a click target for a
                pointer, and exposing it published a second "Close" button that
                a screen reader read out ahead of the real one. Escape and the
                header control are the non-pointer paths. */}
            <button
                type="button"
                aria-hidden="true"
                tabIndex={-1}
                onClick={close}
                className="absolute inset-0 cursor-default bg-overlay"
            />

            <div
                ref={dialogRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                aria-describedby={descriptionId}
                tabIndex={-1}
                className={[
                    'relative flex max-h-[90dvh] w-full max-w-md flex-col overflow-hidden',
                    'rounded-panel border border-line bg-surface-raised shadow-raised',
                    'animate-result-in',
                    className,
                ].filter(Boolean).join(' ')}
            >
                <div className="flex items-start justify-between gap-4 border-b border-line px-6 py-4">
                    <div className="min-w-0">
                        <h2 id={titleId} className="font-display text-lead font-bold text-ink">
                            {title}
                        </h2>
                        {description ? (
                            <p id={descriptionId} className="mt-1 text-ui text-ink-muted">
                                {description}
                            </p>
                        ) : null}
                    </div>

                    <button
                        type="button"
                        onClick={close}
                        aria-label={closeLabel}
                        className="-mr-1 rounded-button p-1.5 text-ink-muted transition-colors duration-120 ease-snap hover:bg-surface-sunken hover:text-ink"
                    >
                        <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none">
                            <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                        </svg>
                    </button>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">{children}</div>

                {footer ? <div className="border-t border-line px-6 py-4">{footer}</div> : null}
            </div>
        </div>
    );
}
