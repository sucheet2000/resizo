/**
 * ReviewList
 *
 * A server component, deliberately. The reviews used to be fetched in the
 * browser after hydration, which meant they were absent from the HTML Google
 * reads — and they are the source of the AggregateRating in the page's
 * structured data. Markup that claims a rating the page does not visibly show
 * is the kind of mismatch that earns a manual action, so the schema and the
 * cards now come from the same server-side read.
 *
 * @param {Array<{id, name, role, rating, review, created_at}>} reviews
 */
import StarRating from '@/components/reviews/StarRating';

const DATE_FORMAT = new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    timeZone: 'UTC',
});

function monthOf(value) {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : DATE_FORMAT.format(date);
}

export default function ReviewList({ reviews, className = '' }) {
    const list = Array.isArray(reviews) ? reviews.filter((review) => review?.review) : [];

    if (list.length === 0) {
        return (
            <p className={`text-base text-ink-muted ${className}`.trim()}>
                No reviews yet. If one of these tools saved you a job, yours would be the first.
            </p>
        );
    }

    return (
        <ul className={`grid gap-4 md:grid-cols-2 lg:grid-cols-3 ${className}`.trim()}>
            {list.map((review) => {
                const month = monthOf(review.created_at);

                return (
                    <li
                        key={review.id ?? `${review.name}-${review.created_at}`}
                        className="flex flex-col rounded-panel border border-line bg-surface-raised p-5 shadow-edge"
                    >
                        <div className="flex items-center justify-between gap-3">
                            <StarRating value={review.rating} />
                            {month ? (
                                <time
                                    dateTime={new Date(review.created_at).toISOString().slice(0, 10)}
                                    className="font-data text-micro text-ink-muted"
                                >
                                    {month}
                                </time>
                            ) : null}
                        </div>

                        <blockquote className="mt-3 flex-1 text-base text-ink">
                            {review.review}
                        </blockquote>

                        <p className="mt-4 text-ui text-ink">
                            {review.name}
                            {review.role ? (
                                <span className="text-ink-muted"> · {review.role}</span>
                            ) : null}
                        </p>
                    </li>
                );
            })}
        </ul>
    );
}
