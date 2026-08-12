/**
 * ContentSection
 *
 * One prose section below a tool. It exists so the heading level, the heading
 * face and the measure are decided once: the four tool pages previously had a
 * single h2 each — "Related Tools" — and the outline ran h1 → h3 → h2.
 *
 * The heading is always an h2 sitting under the page's one h1, and the section
 * is labelled by it, so the outline cannot skip a level by accident.
 */
export default function ContentSection({ id, heading, children, className = '' }) {
    return (
        <section aria-labelledby={id} className={className}>
            <h2 id={id} className="font-display text-title font-bold tracking-tight text-ink">
                {heading}
            </h2>
            <div className="mt-3 flex flex-col gap-3 text-base text-ink-muted">{children}</div>
        </section>
    );
}
