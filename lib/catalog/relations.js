/**
 * Internal-link relationships between products.
 *
 * Which pages point at which is a property of the registry, not of any one
 * page: the Related Tools block on every tool page, the hub blocks on the
 * parent tool pages, the sibling blocks on the spokes and the links written
 * into the copy are all derivable from the data, so a route that exists is
 * always linked, a route that is renamed moves everywhere at once, and a test
 * can say "nothing links to this page" before a crawler finds that out.
 */
import { categoriesWithProducts, toolsInCategory } from './categories';
import { inlineLinks } from './inline';
import { INTENTS, getIntent, intentsFor } from './intents';
import { TOOLS, getTool } from './tools';

/** Every other tool with a page of its own — the Related Tools block. */
export function relatedTools(slug) {
    return TOOLS.filter((tool) => tool.hasOwnPage && tool.slug !== slug);
}

/** A site path without its fragment: a link to /resize#bulk reaches /resize. */
function pathOf(href) {
    return href.split('#')[0];
}

/**
 * Every site path an intent page links to, each once: the parent tool in the
 * breadcrumb, the sibling intents when the entry renders a sibling block, the
 * links written into the copy, and the Related Tools block the tool shell
 * renders under every page. External targets are not part of the site graph.
 */
export function intentLinks(intent) {
    const tool = getTool(intent.tool);
    const found = new Set();

    if (tool) found.add(tool.href);

    if (intent.siblingLinks) {
        for (const sibling of intentsFor(intent.tool, { exclude: intent.slug })) found.add(sibling.path);
    }

    // intentCopy() reduces links to their labels, so the targets are read off
    // the raw blocks instead.
    for (const section of intent.sections ?? []) {
        for (const block of section.blocks ?? []) {
            const texts = block.type === 'ul' ? block.items : block.type === 'p' ? [block.text] : [];
            for (const link of texts.flatMap(inlineLinks)) {
                if (link.href.startsWith('/')) found.add(pathOf(link.href));
            }
        }
    }

    for (const related of relatedTools(intent.tool)) found.add(related.href);

    found.delete(intent.path);

    return [...found];
}

/**
 * The site's link graph as the two groupings it is actually built from.
 *
 * `tools` is hub and spoke: a tool page and the intent pages that preconfigure
 * it, which is the shape the IntentLinks block on the tool page and the sibling
 * block on each intent both render. `categories` is the sideways grouping the
 * /tools directory renders — the tools that answer the same need.
 *
 * Only routes appear here. Bulk resize is a tab on /resize rather than a URL of
 * its own, so it is neither a hub nor a category member, for the same reason
 * the sitemap leaves it out: a link to `/resize#bulk` is a link to /resize.
 *
 * Derived, never stored. A tool or an intent added to the registry joins its
 * cluster with no edit here, which is what lets a test say "nothing links to
 * this page" before a crawler discovers it.
 */
export function clusters() {
    const pages = TOOLS.filter((tool) => tool.hasOwnPage);

    return {
        tools: pages.map((tool) => ({
            hub: tool.href,
            spokes: intentsFor(tool.slug).map((intent) => intent.path),
        })),
        categories: categoriesWithProducts().map((category) => ({
            category: category.id,
            members: toolsInCategory(category.id)
                .filter((tool) => tool.hasOwnPage)
                .map((tool) => tool.href),
        })),
    };
}

/** The slugs of every intent whose page links to `path`. */
export function inboundLinks(path) {
    return INTENTS
        .filter((intent) => intent.path !== path && intentLinks(intent).includes(path))
        .map((intent) => intent.slug);
}

export { getIntent };
