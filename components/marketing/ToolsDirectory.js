/**
 * ToolsDirectory
 *
 * Every product on the site, grouped by the need a visitor arrived with: the
 * categories from lib/catalog/categories.js, each tool with a page under its
 * category, and under each tool the intent pages that preconfigure it — with
 * the situation that would send someone there, so a row reads as a sentence
 * rather than a keyword. Nothing here is typed by hand; a tool or an intent
 * added to the registry appears in the directory with it, and a category with
 * nothing in it is not shown at all.
 *
 * Rows of type, never a grid of icon tiles: the identity mark is the same
 * typographic operation token the tool pages use, and the layout is the
 * divided list the 404 page already uses for the same job.
 *
 * `registry` lets a test hand in a synthetic set of tools, categories and
 * intents to prove the hiding rule without shipping an empty category.
 */
import Link from 'next/link';

import OperationMark from '@/components/tools/OperationMark';
import { CATEGORIES, INTENTS, TOOLS, categoriesWithProducts, toolsInCategory } from '@/lib/catalog';

const toolLinkClass =
    'rounded-input transition-opacity duration-120 ease-snap hover:opacity-80';

const intentLinkClass =
    'rounded-input font-medium text-accent underline underline-offset-4 transition-opacity duration-120 ease-snap hover:opacity-80';

/**
 * The formats a visitor types, and the pairs they will not think to
 * distinguish: someone who types "jpeg" means the rows that say JPG, and
 * someone who types "heif" means the HEIC ones.
 */
const FORMAT_ALIASES = [
    ['jpg', 'jpeg'],
    ['heic', 'heif'],
];

function withFormatAliases(text) {
    const extra = FORMAT_ALIASES
        .flatMap(([a, b]) => {
            if (text.includes(a) && !text.includes(b)) return [b];
            if (text.includes(b) && !text.includes(a)) return [a];
            return [];
        });

    return extra.length > 0 ? `${text} ${extra.join(' ')}` : text;
}

/**
 * "Compress to 50 KB" is also typed "50kb", and the slug already spells it
 * that way — this folds both spellings in whichever one the source used.
 */
function withByteCeilings(text) {
    const found = new Set();
    for (const [, digits] of text.matchAll(/(\d+)\s*kb\b/g)) found.add(`${digits} kb`).add(`${digits}kb`);
    return found.size > 0 ? `${text} ${[...found].join(' ')}` : text;
}

function searchTerms(parts) {
    const text = parts
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    return withByteCeilings(withFormatAliases(text));
}

/**
 * What the filter island searches, as a small flat array it can be handed as a
 * prop: one entry per row the directory renders — its href, the row it nests
 * under, and the words that should find it. Built here rather than in the
 * island because the island is a client module and the registry it would have
 * to import is the whole catalogue — page copy, intent bodies and all — in the
 * first load of a page a crawler reads for its links (CLAUDE.md, rule 6).
 *
 * `parent` is what lets the island answer "keep the tool whose page matched"
 * without reading the DOM to find out which row nests inside which: filtering
 * for "50 kb" has to leave Compress Image standing as the heading its match
 * sits under.
 *
 * The terms deliberately reach past the row's own words: a tool carries its
 * category, an intent carries the tool it preconfigures, and both carry the
 * format tokens and byte ceilings people actually type.
 */
export function filterIndex({ tools = TOOLS, categories = CATEGORIES, intents = INTENTS } = {}) {
    const categoryOf = (id) => categories.find((category) => category.id === id) ?? null;

    const toolEntries = tools.map((tool) => {
        const category = categoryOf(tool.category);
        return {
            href: tool.href,
            parent: null,
            terms: searchTerms([
                tool.title,
                tool.shortTitle,
                tool.description,
                tool.slug,
                category?.title,
                category?.id,
            ]),
        };
    });

    const intentEntries = intents.map((intent) => {
        const parent = tools.find((tool) => tool.slug === intent.tool) ?? null;
        const category = parent ? categoryOf(parent.category) : null;

        return {
            href: intent.path,
            parent: parent?.href ?? null,
            terms: searchTerms([
                intent.label,
                intent.blurb,
                intent.slug,
                parent?.title,
                category?.title,
                category?.id,
            ]),
        };
    });

    return [...toolEntries, ...intentEntries];
}

export default function ToolsDirectory({ registry = {}, className = '' }) {
    const tools = registry.tools ?? TOOLS;
    const categories = registry.categories ?? CATEGORIES;
    const intents = registry.intents ?? INTENTS;

    return (
        <div className={`flex flex-col gap-12 ${className}`.trim()}>
            {categoriesWithProducts({ tools, categories }).map((category) => {
                const members = toolsInCategory(category.id, tools);
                const withPage = members.filter((tool) => tool.hasOwnPage);
                const inside = members.filter((tool) => !tool.hasOwnPage);

                return (
                    <section
                        key={category.id}
                        id={category.id}
                        data-filter-group={category.id}
                        aria-labelledby={`tools-${category.id}`}
                        className="scroll-mt-24"
                    >
                        <h2
                            id={`tools-${category.id}`}
                            className="font-display text-title font-bold tracking-tight text-ink"
                        >
                            {category.title}
                        </h2>
                        <p className="mt-2 max-w-[72ch] text-base text-ink-muted">{category.blurb}</p>

                        <ul className="mt-5 flex flex-col divide-y divide-line border-y border-line">
                            {withPage.map((tool) => {
                                const spokes = intents.filter((intent) => intent.tool === tool.slug);

                                return (
                                    <li key={tool.slug} data-filter-key={tool.href} className="py-5">
                                        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                                            <h3 className="font-display text-lead font-bold text-ink">
                                                <Link href={tool.href} className={toolLinkClass}>
                                                    {tool.title}
                                                    <span aria-hidden="true">&nbsp;→</span>
                                                </Link>
                                            </h3>
                                            <OperationMark tool={tool.slug} />
                                        </div>
                                        <p className="mt-1 max-w-[72ch] text-base text-ink-muted">{tool.description}</p>

                                        {spokes.length > 0 ? (
                                            <ul className="mt-3 flex flex-col gap-2 pl-4">
                                                {spokes.map((intent) => (
                                                    <li
                                                        key={intent.slug}
                                                        data-filter-key={intent.path}
                                                        className="text-ui text-ink-muted"
                                                    >
                                                        {intent.blurb}
                                                        {' — '}
                                                        <Link href={intent.path} className={intentLinkClass}>
                                                            {intent.label}
                                                            <span aria-hidden="true">&nbsp;→</span>
                                                        </Link>
                                                    </li>
                                                ))}
                                            </ul>
                                        ) : null}
                                    </li>
                                );
                            })}
                        </ul>

                        {inside.map((tool) => (
                            <p key={tool.slug} data-filter-key={tool.href} className="mt-4 text-ui text-ink-muted">
                                {tool.description}{' '}
                                <Link href={tool.href} className={intentLinkClass}>
                                    {tool.title}
                                    <span aria-hidden="true">&nbsp;→</span>
                                </Link>
                            </p>
                        ))}
                    </section>
                );
            })}
        </div>
    );
}
