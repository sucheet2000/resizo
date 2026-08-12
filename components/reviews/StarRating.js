/**
 * StarRating
 *
 * Display and input in one file, and neither one is five anonymous buttons.
 * The display form is a single `role="img"` with one accessible name — the old
 * markup gave all five SVGs the identical label "Star rating", so a screen
 * reader heard the same three words five times and learned nothing. The input
 * form names the value each control sets.
 *
 * No directive: the display half renders inside a server component, and the
 * input half only ever appears inside a client one.
 */
const STAR_PATH =
    'M12 3.4l2.6 5.27 5.82.85-4.21 4.1.99 5.79L12 16.68l-5.2 2.73.99-5.79-4.21-4.1 5.82-.85z';

function Star({ filled, size }) {
    return (
        <svg
            aria-hidden="true"
            focusable="false"
            width={size}
            height={size}
            viewBox="0 0 24 24"
            className={filled ? 'text-accent' : 'text-line'}
        >
            <path d={STAR_PATH} fill="currentColor" />
        </svg>
    );
}

export default function StarRating({ value, max = 5, size = 16, className = '' }) {
    const score = Math.max(0, Math.min(max, Math.round(Number(value) || 0)));

    return (
        <span
            role="img"
            aria-label={`${score} out of ${max} stars`}
            className={`inline-flex items-center gap-0.5 ${className}`.trim()}
        >
            {Array.from({ length: max }, (_, index) => (
                <Star key={index} filled={index < score} size={size} />
            ))}
        </span>
    );
}

/**
 * Real buttons, so each one takes the app-wide focus ring and announces the
 * value it sets. `aria-pressed` carries the current choice.
 */
export function StarRatingInput({ value, onChange, max = 5, label = 'Rating', size = 26 }) {
    return (
        <div className="flex items-center gap-2">
            <div role="group" aria-label={label} className="flex items-center gap-0.5">
                {Array.from({ length: max }, (_, index) => index + 1).map((star) => (
                    <button
                        key={star}
                        type="button"
                        aria-pressed={star === value}
                        aria-label={star === 1 ? 'Rate 1 star' : `Rate ${star} stars`}
                        onClick={() => onChange(star)}
                        className="rounded-input p-0.5 transition-opacity duration-120 ease-snap hover:opacity-80"
                    >
                        <Star filled={star <= value} size={size} />
                    </button>
                ))}
            </div>
            <span className="font-data text-ui text-ink-muted">{value}/{max}</span>
        </div>
    );
}
