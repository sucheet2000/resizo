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
                    <section key={category.id} aria-labelledby={`tools-${category.id}`}>
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
                                    <li key={tool.slug} className="py-5">
                                        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                                            <h3 className="font-display text-lead font-bold text-ink">
                                                <Link href={tool.href} className={toolLinkClass}>
                                                    {tool.title}
                                                    <span aria-hidden="true"> →</span>
                                                </Link>
                                            </h3>
                                            <OperationMark tool={tool.slug} />
                                        </div>
                                        <p className="mt-1 max-w-[72ch] text-base text-ink-muted">{tool.description}</p>

                                        {spokes.length > 0 ? (
                                            <ul className="mt-3 flex flex-col gap-2 pl-4">
                                                {spokes.map((intent) => (
                                                    <li key={intent.slug} className="text-ui text-ink-muted">
                                                        {intent.blurb}
                                                        {' — '}
                                                        <Link href={intent.path} className={intentLinkClass}>
                                                            {intent.label}
                                                            <span aria-hidden="true"> →</span>
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
                            <p key={tool.slug} className="mt-4 text-ui text-ink-muted">
                                {tool.description}{' '}
                                <Link href={tool.href} className={intentLinkClass}>
                                    {tool.title}
                                    <span aria-hidden="true"> →</span>
                                </Link>
                            </p>
                        ))}
                    </section>
                );
            })}
        </div>
    );
}
