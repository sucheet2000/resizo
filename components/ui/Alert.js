/**
 * Alert
 *
 * Inline, in the panel, never a toast. Errors carry an sr-only "Error: "
 * prefix so a screen reader hears what kind of message it is before hearing
 * the message, and they clear the moment the input is corrected — which is
 * the caller's job: render nothing rather than rendering an empty Alert.
 */
export default function Alert({
    tone = 'error',
    children,
    id,
    className = '',
    role,
    tabIndex,
}) {
    if (children === null || children === undefined || children === false || children === '') {
        return null;
    }

    const isError = tone === 'error';

    return (
        <div
            id={id}
            // assertive for an error the visitor just caused, polite for
            // information they did not ask for.
            role={role ?? (isError ? 'alert' : 'status')}
            tabIndex={tabIndex}
            className={[
                'flex items-start gap-2 rounded-button border px-3 py-2.5 text-ui',
                isError
                    ? 'border-accent bg-accent-wash text-ink'
                    : 'border-line bg-surface-sunken text-ink-muted',
                className,
            ].filter(Boolean).join(' ')}
        >
            <span
                aria-hidden="true"
                className={`mt-0.5 select-none font-data leading-none ${isError ? 'text-accent' : 'text-ink-muted'}`}
            >
                {isError ? '!' : 'i'}
            </span>
            <p className="min-w-0">
                {isError ? <span className="sr-only">Error: </span> : null}
                {children}
            </p>
        </div>
    );
}
