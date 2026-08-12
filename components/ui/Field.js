/**
 * Field
 *
 * The wrapper that makes an unassociated label impossible: `id` is required
 * and is what `htmlFor` points at, so a control rendered as a child either
 * carries that id or the field is obviously wrong in review.
 *
 * `hint` and `error` get ids the caller wires to aria-describedby.
 */
export default function Field({
    id,
    label,
    hint,
    error,
    children,
    className = '',
    labelClassName = '',
    suffix,
    labelHidden = false,
}) {
    const hintId = hint ? `${id}-hint` : undefined;
    const errorId = error ? `${id}-error` : undefined;

    return (
        <div className={`flex flex-col gap-1.5 ${className}`.trim()}>
            <label
                htmlFor={id}
                className={[
                    'text-ui text-ink',
                    labelHidden ? 'sr-only' : '',
                    labelClassName,
                ].filter(Boolean).join(' ')}
            >
                {label}
            </label>

            {suffix ? (
                <div className="flex items-stretch gap-1.5">
                    <div className="min-w-0 flex-1">{children}</div>
                    {suffix}
                </div>
            ) : (
                children
            )}

            {hint ? (
                <p id={hintId} className="text-micro text-ink-muted">
                    {hint}
                </p>
            ) : null}

            {error ? (
                <p id={errorId} className="text-micro text-accent">
                    <span className="sr-only">Error: </span>
                    {error}
                </p>
            ) : null}
        </div>
    );
}

/**
 * The describedby value for a control inside a Field. Kept next to the
 * component so the id scheme lives in exactly one place.
 */
export function fieldDescribedBy(id, { hint, error } = {}) {
    const ids = [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean);
    return ids.length > 0 ? ids.join(' ') : undefined;
}
