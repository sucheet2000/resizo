/**
 * Internal-link relationships between products.
 *
 * Which pages point at which is a property of the registry, not of any one
 * page: the Related Tools block on every tool page, the hub blocks on the
 * parent tool pages and the sibling blocks on the spokes all read from here,
 * so a route that exists is always linked and a route that is renamed moves
 * everywhere at once.
 */
import { TOOLS } from './tools';

/** Every other tool with a page of its own — the Related Tools block. */
export function relatedTools(slug) {
    return TOOLS.filter((tool) => tool.hasOwnPage && tool.slug !== slug);
}
