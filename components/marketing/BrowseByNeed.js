/**
 * BrowseByNeed
 *
 * The homepage's second path in, and the one that scales. "Start with a job"
 * is a curated handful and stays that way; this block is the categories
 * themselves, so a tool added to the registry joins the homepage the moment it
 * names a category, with no edit here.
 *
 * It is a summary, never a second directory: the category, the category's own
 * blurb, up to three representative tools with pages of their own, and a link
 * into the /tools section that holds the rest. The count beside the heading
 * says what is behind that link — every row the directory renders in that
 * section, tools and preconfigured pages together — so the link is a promise
 * with a number on it rather than a vague "see more".
 *
 * Rows of type, never a grid of icon tiles, and no operation mark: a category
 * is not an operation, and inventing a token for one would put a decorative
 * glyph where the tool pages carry a meaningful one.
 *
 * `registry` lets a test hand in a synthetic set to prove the hiding rule
 * without shipping an empty category to production to watch it disappear.
 */
import Link from 'next/link';

import { CATEGORIES, INTENTS, TOOLS, categoriesWithProducts, toolsInCategory } from '@/lib/catalog';

const MAX_REPRESENTATIVES = 3;

export default function BrowseByNeed({ registry = {}, className = '' }) {
    const tools = registry.tools ?? TOOLS;
    const categories = registry.categories ?? CATEGORIES;
    const intents = registry.intents ?? INTENTS;

    return (
        <ul className={`grid gap-4 md:grid-cols-2 ${className}`.trim()}>
            {categoriesWithProducts({ tools, categories }).map((category) => {
                const members = toolsInCategory(category.id, tools);
                const withPage = members.filter((tool) => tool.hasOwnPage);
                const shown = withPage.slice(0, MAX_REPRESENTATIVES);

                // What the deep link leads to: every row /tools prints under
                // this heading — the tools, the one that lives inside another
                // route, and the pages that preconfigure them.
                const pages = members.length
                    + intents.filter((intent) => withPage.some((tool) => tool.slug === intent.tool)).length;

                return (
                    <li
                        key={category.id}
                        className="rounded-panel border border-line bg-surface-raised p-5"
                    >
                        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                            <h3 className="font-display text-lead font-bold text-ink">{category.title}</h3>
                            <p className="font-data text-micro text-ink-muted">
                                {pages} {pages === 1 ? 'page' : 'pages'}
                            </p>
                        </div>

                        <p className="mt-1 text-ui text-ink-muted">{category.blurb}</p>

                        <p className="mt-3 text-ui">
                            {shown.map((tool, index) => (
                                <span key={tool.slug}>
                                    {index > 0 ? <span className="text-ink-muted"> · </span> : null}
                                    <Link
                                        href={tool.href}
                                        className="rounded-input text-ink underline decoration-line underline-offset-4 transition-colors duration-120 ease-snap hover:decoration-accent"
                                    >
                                        {tool.title}
                                    </Link>
                                </span>
                            ))}
                        </p>

                        <p className="mt-3">
                            <Link
                                href={`/tools#${category.id}`}
                                className="rounded-input text-ui text-accent underline underline-offset-4 transition-opacity duration-120 ease-snap hover:opacity-80"
                            >
                                All of {category.title}
                                <span aria-hidden="true"> →</span>
                            </Link>
                        </p>
                    </li>
                );
            })}
        </ul>
    );
}
