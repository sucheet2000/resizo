/**
 * GuidesList
 *
 * The guides, offered where the tools are. A guide is written from a
 * measurement of the tools above it, so /tools is the page that lists them —
 * rows of type in registry order, the headline as the link and the first
 * sentence of the answer under it. Nothing renders while the registry has no
 * guide to show: an empty "Guides" heading is a promise the page cannot keep.
 *
 * Server-rendered, no client JavaScript. Reads the barrel, which a server
 * component may (rule 6 fences only client modules).
 */
import Link from 'next/link';

import { indexableGuides } from '@/lib/catalog';

const guideLinkClass = 'rounded-input text-ink transition-colors duration-120 ease-snap hover:text-accent';

function firstSentence(text) {
    const match = String(text ?? '').match(/^.*?[.!?](?=\s|$)/);
    return match ? match[0] : String(text ?? '');
}

export default function GuidesList({ guides = indexableGuides(), className = '' }) {
    const listed = guides.filter((guide) => guide.indexable !== false);
    if (listed.length === 0) return null;

    return (
        <section aria-labelledby="guides-heading" className={className}>
            <h2 id="guides-heading" className="font-display text-title font-bold tracking-tight text-ink">
                Guides
            </h2>
            <p className="mt-2 max-w-[72ch] text-base text-ink-muted">
                Measured on the tools above, with the method printed beside every number.
            </p>
            <ul className="mt-5 flex flex-col divide-y divide-line border-y border-line">
                {listed.map((guide) => (
                    <li key={guide.slug} className="py-5">
                        <h3 className="font-display text-lead font-bold text-ink">
                            <Link href={guide.path} className={guideLinkClass}>
                                {guide.h1}
                            </Link>
                        </h3>
                        <p className="mt-1 max-w-[72ch] text-base text-ink-muted">{firstSentence(guide.answer)}</p>
                    </li>
                ))}
            </ul>
        </section>
    );
}
