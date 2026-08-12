/**
 * Logo
 *
 * A frame with a corner handle — the resize gesture itself, drawn in the two
 * colours the design system has. Not an icon tile: it never appears above a
 * heading, only beside the wordmark.
 */
export default function Logo({
    size = 22,
    withWordmark = true,
    wordmarkClassName = '',
    className = '',
}) {
    return (
        <span className={`inline-flex items-center gap-2 ${className}`.trim()}>
            <svg
                aria-hidden="true"
                focusable="false"
                width={size}
                height={size}
                viewBox="0 0 24 24"
                fill="none"
                className="shrink-0"
            >
                <rect
                    x="2.5"
                    y="2.5"
                    width="19"
                    height="19"
                    rx="3"
                    stroke="currentColor"
                    strokeWidth="1.75"
                />
                <path
                    d="M9 15h6V9"
                    stroke="var(--accent)"
                    strokeWidth="2"
                    strokeLinecap="square"
                />
            </svg>

            {withWordmark ? (
                <span
                    className={`font-display text-lead font-bold tracking-tight ${wordmarkClassName}`.trim()}
                >
                    Resizo
                </span>
            ) : null}
        </span>
    );
}
