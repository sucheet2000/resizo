/**
 * DocPage
 *
 * The long-form reading frame, used by /about. It exists because the doc pages
 * each carried their own fixed header, their own footer and their own heading
 * styles; the chrome now comes from the (marketing) layout and the type comes
 * from here, so a change to the reading column is one edit.
 *
 * The prose column is capped at 68ch — DESIGN.md puts the body measure at 72ch
 * and the muted ink runs slightly tighter to stay comfortable. The optional
 * aside is where a page puts its numbers, in mono, beside the prose rather
 * than inside it.
 */
import Breadcrumb from '@/components/seo/Breadcrumb';

const PROSE = 'flex max-w-[68ch] flex-col gap-4 text-base text-ink-muted';

export const docLinkClass =
    'rounded-input text-accent underline underline-offset-4 transition-opacity duration-120 ease-snap hover:opacity-80';

/**
 * One h2 section. `id` doubles as the anchor target and the label association,
 * so a section can be linked to and is announced with its own heading.
 */
export function DocSection({ id, heading, children, className = '' }) {
    return (
        <section
            id={id}
            aria-labelledby={`${id}-heading`}
            className={`scroll-mt-24 ${className}`.trim()}
        >
            <h2 id={`${id}-heading`} className="font-display text-title font-bold text-ink">
                {heading}
            </h2>
            <div className={`mt-4 ${PROSE}`}>{children}</div>
        </section>
    );
}

/**
 * The aside's mono table: a label and a value per row. Values are the real
 * constants, imported by the caller, so the published limits cannot drift from
 * the ones the API enforces.
 *
 * @param {{ heading: string, rows: Array<{ label: string, value: string }> }} props
 */
export function DocSpecList({ heading, rows, note }) {
    // Derived from the heading rather than a constant: two spec lists on one
    // page would otherwise share an id, and useId is not available to a server
    // component.
    const headingId = `spec-${heading.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;

    return (
        <div className="rounded-panel border border-line bg-surface-raised p-5">
            <h2 id={headingId} className="text-micro font-semibold text-ink">
                {heading}
            </h2>
            <dl aria-labelledby={headingId} className="mt-4 flex flex-col gap-3">
                {rows.map((row) => (
                    <div key={row.label} className="flex items-baseline justify-between gap-4">
                        <dt className="text-ui text-ink-muted">{row.label}</dt>
                        <dd className="font-data text-ui text-ink">{row.value}</dd>
                    </div>
                ))}
            </dl>
            {note ? <p className="mt-4 border-t border-line pt-4 text-micro text-ink-muted">{note}</p> : null}
        </div>
    );
}

export default function DocPage({
    breadcrumb,
    title,
    intro,
    updated,
    aside,
    children,
}) {
    return (
        <article className="shell py-12 md:py-16">
            {breadcrumb ? <Breadcrumb items={breadcrumb} className="mb-8" /> : null}

            <header>
                {/* The measure is set per element: a display-size h1 wants a
                    much shorter line than the lead paragraph under it, and
                    capping the shared parent would clamp both to the shorter. */}
                <h1 className="max-w-[16ch] font-display text-display font-bold tracking-tight text-ink">
                    {title}
                </h1>
                {intro ? <p className="mt-5 max-w-[60ch] text-lead text-ink-muted">{intro}</p> : null}
                {updated ? (
                    <p className="mt-5 font-data text-micro text-ink-muted">
                        Last updated <time dateTime={updated}>{updated}</time>
                    </p>
                ) : null}
            </header>

            <div className="mt-12 flex flex-col gap-12 lg:mt-16 lg:flex-row lg:items-start lg:gap-16">
                <div className="flex min-w-0 flex-1 flex-col gap-12">{children}</div>
                {aside ? (
                    <aside className="w-full shrink-0 lg:sticky lg:top-8 lg:w-72">{aside}</aside>
                ) : null}
            </div>
        </article>
    );
}
