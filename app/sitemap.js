/**
 * sitemap.xml
 *
 * Driven by the registries, not by a hand-kept list of URLs. The tool entries
 * and the long-tail entries both come from lib/constants.js, so a route added
 * there cannot be forgotten here, and every URL is built by lib/seo.js so the
 * host is stated once.
 *
 * `lastModified` is a real calendar date per page. It used to be `new Date()`
 * on all nine entries, and this route is statically generated, so the call
 * froze at build time: every URL republished with the timestamp of the last
 * deploy, and a dependency bump moved `lastmod` on /privacy. Google discounts
 * a lastmod it finds unreliable, so the signal was being spent for nothing.
 * Bump a date when that page's *content* changes — never on deploy.
 *
 * `changeFrequency` and `priority` are deliberately absent. Google ignores
 * both, and emitting them only implies a precision the file does not have.
 */
import { LONGTAIL_PAGES, sitemapTools } from '@/lib/constants';
import { absoluteUrl } from '@/lib/seo';

/**
 * Every route on the site was rewritten in the Wave 2 overhaul, so they
 * honestly share one date. This is the floor, not a default that hides drift:
 * the moment one page's copy changes on its own it gets its own date, either
 * in PAGE_DATES below or — for a long-tail page — on its registry entry.
 */
const OVERHAUL = '2026-08-11';

/**
 * Per-page overrides for the core and tool routes, which have no date of their
 * own in the registry. Empty is correct today: nothing has changed since the
 * overhaul. A long-tail page carries its date on its LONGTAIL_PAGES entry
 * instead, so its copy and its lastmod are edited in the same place.
 */
const PAGE_DATES = {};

export const CORE_PATHS = ['/', '/about', '/privacy', '/terms'];

/** The long-tail intent routes, in registry order. */
export const LONGTAIL_PATHS = LONGTAIL_PAGES.map((page) => page.path);

function entryFor(path, lastModified) {
    return {
        url: absoluteUrl(path),
        lastModified: PAGE_DATES[path] ?? lastModified ?? OVERHAUL,
    };
}

export default function sitemap() {
    return [
        ...CORE_PATHS.map((path) => entryFor(path)),
        // hasOwnPage filters out bulk resize, which is a mode of /resize rather
        // than a URL of its own.
        ...sitemapTools().map((tool) => entryFor(tool.href)),
        ...LONGTAIL_PAGES.map((page) => entryFor(page.path, page.lastModified)),
    ];
}
