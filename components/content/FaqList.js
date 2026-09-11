/**
 * FaqList
 *
 * The visible FAQ. It takes the SAME array that feeds `faqPage()` in
 * lib/schema.js, so the markup can never describe questions the page does not
 * show — a mismatch there is a manual-action risk, not a ranking trick.
 *
 * Questions are h3 under the section's h2, which keeps the outline at
 * h1 → h2 → h3 with no skipped level.
 *
 * An answer is written like a section: plain text with `[label](/path)` for a
 * link, rendered through the same InlineText the content blocks use — so a
 * link reads as a link, and a long URL never becomes one unbreakable token
 * that pushes a phone layout sideways. faqPage() reduces the same syntax to
 * plain text, so the markup and the page still say the same thing.
 *
 * @param {Array<{ question: string, answer: string }>} items
 */
import { InlineText } from '@/components/content/ContentBlocks';

export default function FaqList({
    items,
    heading = 'Frequently asked questions',
    id = 'faq',
    className = '',
}) {
    const list = (Array.isArray(items) ? items : []).filter((item) => item?.question && item?.answer);
    if (list.length === 0) return null;

    return (
        <section aria-labelledby={id} className={className}>
            <h2 id={id} className="font-display text-title font-bold tracking-tight text-ink">
                {heading}
            </h2>

            <ul className="mt-4 flex flex-col gap-6">
                {list.map((item) => (
                    <li key={item.question}>
                        <h3 className="text-base font-semibold text-ink">{item.question}</h3>
                        <p className="mt-1.5 text-base text-ink-muted"><InlineText text={item.answer} /></p>
                    </li>
                ))}
            </ul>
        </section>
    );
}
