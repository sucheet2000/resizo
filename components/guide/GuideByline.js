/**
 * GuideByline
 *
 * The one line under a guide's headline: who wrote it, when it was published,
 * when it was last revised.
 *
 * It is not decoration. A guide's entire claim is that something was measured
 * on a particular day by a particular person, and a reader deciding whether to
 * trust a number wants all three before the first paragraph. The same three
 * facts go into the Article JSON-LD from the same registry entry, so the markup
 * can never date a page differently from the page itself.
 *
 * Both dates are `<time>` elements carrying the ISO value, with the readable
 * form as the text — a reader should not have to parse 2026-09-05, and a
 * machine should not have to parse "September 5, 2026".
 */
const LONG_DATE = { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' };

/**
 * A registry date is a calendar day in UTC, not an instant. Parsing it as
 * midnight UTC and formatting it back in UTC is what stops a machine west of
 * Greenwich from rendering the day before.
 */
export function formatGuideDate(iso) {
    if (typeof iso !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return '';
    return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', LONG_DATE);
}

export default function GuideByline({ author, published, modified, className = '' }) {
    return (
        <p className={`text-micro text-ink-muted ${className}`.trim()}>
            By <span className="font-medium text-ink">{author}</span>
            <span aria-hidden="true" className="px-2 text-line">·</span>
            Published <time dateTime={published}>{formatGuideDate(published)}</time>
            <span aria-hidden="true" className="px-2 text-line">·</span>
            Updated <time dateTime={modified}>{formatGuideDate(modified)}</time>
        </p>
    );
}
