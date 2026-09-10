/**
 * BehaviourSpec
 *
 * "What this tool changes" — the one thing every tool page was missing and
 * every visitor wanted: not a promise about privacy, a specification of the
 * output. Pixels re-encoded or copied. EXIF removed or kept. The colour profile
 * that survives a metadata strip and the one that does not survive a
 * conversion. It renders on every tool page and every intent page, in the same
 * place and the same shape, so the answer is where a reader learned to look.
 *
 * A definition list rather than a table: each row is one property and one
 * value, which is what a `<dl>` is, and a table would promise columns that do
 * not exist. Values are words, never icons — a tick beside "EXIF" says nothing
 * about whether the tick means kept or removed, and the row has to be
 * unambiguous read aloud.
 *
 * NO STATE, NO HOOKS, NO DIRECTIVE. It is rendered inside ToolShell, which
 * every tool client imports, so it is part of a client chunk — but it holds
 * nothing that needs a browser, and it reads `@/lib/catalog/behaviour` rather
 * than the catalogue barrel, which would drag the copy of every page on the
 * site into that chunk (CLAUDE.md rule 6).
 */
import { behaviourFor } from '@/lib/catalog/behaviour';

export default function BehaviourSpec({ slug, preset = undefined, className = '' }) {
    const behaviour = behaviourFor(slug, preset);
    if (!behaviour || behaviour.rows.length === 0) return null;

    const headingId = `${slug}-behaviour`;

    return (
        <section aria-labelledby={headingId} className={`max-w-[72ch] ${className}`.trim()}>
            <h2 id={headingId} className="font-display text-title font-bold tracking-tight text-ink">
                What this tool changes
            </h2>

            <dl className="mt-4 border-t border-line">
                {behaviour.rows.map((row) => (
                    <div
                        key={row.key}
                        className="flex flex-col gap-0.5 border-b border-line py-2 sm:flex-row sm:gap-4"
                    >
                        <dt className="text-ui font-medium text-ink sm:w-40 sm:shrink-0">{row.label}</dt>
                        <dd className="text-base text-ink-muted">{row.detail}</dd>
                    </div>
                ))}
            </dl>

            {behaviour.note ? <p className="mt-3 text-micro text-ink-muted">{behaviour.note}</p> : null}
        </section>
    );
}
