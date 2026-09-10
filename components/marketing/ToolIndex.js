/**
 * ToolIndex
 *
 * A curated set of jobs, sized by what each one is actually worth rather than
 * by a loop over an array. Twelve columns, rows of unequal spans — never the
 * equal-column card row on the reject list, and never an icon tile above a
 * heading: the identity mark is a typographic operation token in mono.
 *
 * It used to hold one cell per tool and BE the homepage's directory, which is
 * what made the homepage read as a catalogue of a resizer rather than as a
 * front door to a family. The directory is /tools now. The caller names a
 * handful of slugs in the order it judges most useful — a tool or
 * an intent, mixed freely, because "compress to 50 KB" is a job in exactly the
 * way "compress" is — and this resolves each one against the registry.
 *
 * Resolving rather than trusting is the point: a slug the registry does not
 * know renders nothing at all, so a renamed route leaves a gap on the homepage
 * instead of a link into a 404. The title and the href are always the
 * registry's. `line` is the caller's when it writes one, and the registry's
 * description or blurb when it does not, so a cell can never be blank.
 */
import Link from 'next/link';

import OperationMark, { markFor } from '@/components/tools/OperationMark';
import { getIntent, getTool } from '@/lib/catalog';

/**
 * An intent's identity mark, derived from what the page preconfigures rather
 * than stored beside it: a byte ceiling reads `→50KB`, a conversion reads
 * `PNG→JPG` off its own slug, and anything else falls back to the mark of the
 * tool it sets up.
 */
function intentMark(intent) {
    if (intent.kind === 'target' && intent.preset?.targetKb) {
        return `→${intent.preset.targetKb}KB`;
    }

    if (intent.kind === 'conversion') {
        const [from, to] = intent.slug.split('-to-');
        if (from && to) return `${from.toUpperCase()}→${to.toUpperCase()}`;
    }

    return markFor(intent.tool)?.mark ?? null;
}

/** One curated entry, resolved against the registry it names. */
function resolve(item) {
    if (item.kind === 'intent') {
        const intent = getIntent(item.slug);
        if (!intent) return null;

        return {
            href: intent.path,
            title: intent.label,
            line: item.line ?? intent.blurb,
            // No sr-only name on the mark: an intent's label IS the heading
            // that follows it, and reading "Compress to 50 KB" twice in a row
            // is noise rather than information.
            mark: intentMark(intent),
            markLabel: null,
        };
    }

    const tool = getTool(item.slug);
    if (!tool) return null;

    return {
        href: tool.href,
        title: tool.title,
        line: item.line ?? tool.description,
        mark: markFor(tool.slug)?.mark ?? null,
        markLabel: markFor(tool.slug)?.label ?? tool.title,
    };
}

export default function ToolIndex({ items = [], className = '' }) {
    return (
        <ul className={`grid gap-4 md:grid-cols-12 ${className}`.trim()}>
            {items.map((item) => {
                const entry = resolve(item);
                if (!entry) return null;

                const isLead = item.weight === 'lead';

                return (
                    <li
                        key={item.slug}
                        className={[
                            'flex flex-col rounded-panel border border-line bg-surface-raised shadow-edge',
                            'transition-colors duration-120 ease-snap hover:border-ink-muted',
                            isLead ? 'p-6' : 'p-5',
                            item.span,
                        ].filter(Boolean).join(' ')}
                    >
                        <OperationMark
                            mark={entry.mark}
                            label={entry.markLabel}
                            size={isLead ? 'title' : 'lead'}
                        />

                        <h3
                            className={[
                                'mt-2 font-display font-bold text-ink',
                                isLead ? 'text-headline' : 'text-title',
                            ].join(' ')}
                        >
                            <Link
                                href={entry.href}
                                className="rounded-input transition-opacity duration-120 ease-snap hover:opacity-80"
                            >
                                {entry.title}
                                <span aria-hidden="true">&nbsp;→</span>
                            </Link>
                        </h3>

                        <p className={`mt-2 flex-1 text-ink-muted ${isLead ? 'text-base' : 'text-ui'}`}>
                            {entry.line}
                        </p>

                        {item.extra ? (
                            <p className="mt-4">
                                <Link
                                    href={item.extra.href}
                                    className="rounded-input text-ui text-accent underline underline-offset-4 transition-opacity duration-120 ease-snap hover:opacity-80"
                                >
                                    {item.extra.label}
                                    <span aria-hidden="true">&nbsp;→</span>
                                </Link>
                            </p>
                        ) : null}
                    </li>
                );
            })}
        </ul>
    );
}
