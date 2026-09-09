/**
 * ChangesList
 *
 * The two lists every indexable intent page carries: what this page does to a
 * file, and what it leaves exactly as it was.
 *
 * It sits directly under the direct answer because it is the question a visitor
 * actually arrives with. "Will this strip my EXIF?", "will it resize the
 * picture?", "does it touch the original?" — those are answered today by
 * reading four sections and inferring, which nobody does. Two lists of plain
 * sentences answer them before the fold, and lib/catalog/validate.js refuses an
 * entry that does not write them.
 *
 * Two h2 regions rather than one, because the second list is the half people
 * come for and a nested heading buries it. Both are ContentSection, so the
 * outline and the measure are the same as every other block on the page.
 */
import { InlineText } from '@/components/content/ContentBlocks';
import ContentSection from '@/components/content/ContentSection';

function ChangeItems({ items }) {
    return (
        <ul className="flex list-disc flex-col gap-2 pl-5">
            {items.map((item) => (
                <li key={item}>
                    <InlineText text={item} />
                </li>
            ))}
        </ul>
    );
}

export default function ChangesList({ id, changes }) {
    const does = Array.isArray(changes?.does) ? changes.does : [];
    const doesNot = Array.isArray(changes?.doesNot) ? changes.doesNot : [];

    if (does.length === 0 && doesNot.length === 0) return null;

    return (
        <>
            {does.length > 0 ? (
                <ContentSection id={`${id}-does`} heading="What this changes">
                    <ChangeItems items={does} />
                </ContentSection>
            ) : null}

            {doesNot.length > 0 ? (
                <ContentSection id={`${id}-does-not`} heading="What stays the same">
                    <ChangeItems items={doesNot} />
                </ContentSection>
            ) : null}
        </>
    );
}
