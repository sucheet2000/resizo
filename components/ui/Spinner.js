/**
 * Spinner
 *
 * Always aria-hidden. The state it represents is announced by the button
 * label or the surrounding live region, never by the graphic.
 */
export default function Spinner({ size = 16, className = '' }) {
    return (
        <svg
            aria-hidden="true"
            focusable="false"
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            className={`shrink-0 animate-spin ${className}`.trim()}
        >
            <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" opacity="0.25" />
            <path
                d="M21 12a9 9 0 0 0-9-9"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
            />
        </svg>
    );
}
