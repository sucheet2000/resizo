/**
 * sitemap.xml
 *
 * Driven by the registries, not by a hand-kept list of URLs. The tool entries
 * and the intent entries both come from lib/catalog/, so a route added
 * there cannot be forgotten here, and every URL is built by lib/seo.js so the
 * host is stated once.
 *
 * `lastModified` is a real calendar date per page. It used to be `new Date()`
 * on all nine entries, and this route is statically generated, so the call
 * froze at build time: every URL republished with the timestamp of the last
 * deploy, and a dependency bump moved `lastmod` on a page whose copy had not
 * changed at all. Google discounts
 * a lastmod it finds unreliable, so the signal was being spent for nothing.
 * Bump a date when that page's *content* changes — never on deploy.
 *
 * `changeFrequency` and `priority` are deliberately absent. Google ignores
 * both, and emitting them only implies a precision the file does not have.
 */
import { INTENTS, sitemapTools } from '@/lib/catalog';
import { absoluteUrl } from '@/lib/seo';

/**
 * Every route on the site was rewritten in the Wave 2 overhaul, so they started
 * from one shared date. This is the floor, not a default that hides drift: the
 * moment one page's copy changes on its own it gets its own date, either in
 * PAGE_DATES below or — for a long-tail page — on its registry entry.
 *
 * That has now happened, which is the point of the mechanism. Eight of the ten
 * intent pages carry 2026-08-12 in the registry because the no-upload copy
 * pass genuinely rewrote them: the PNG encoder in the browser build has no
 * quantiser, so every sentence about a PNG being shrunk by reducing its colours
 * was false and had to go. /resize-jpg and /heic-to-jpg were read line by line
 * in that same pass and needed no correction, so that pass did not move their
 * dates. Entries sitting on different dates is the signal working, not drift.
 */
const OVERHAUL = '2026-08-11';

/**
 * Per-page overrides for the core and tool routes, which have no date of their
 * own in the registry. An intent page carries its date on its registry entry
 * instead, so its copy and its lastmod are edited in the same place.
 *
 * /jpg-to-pdf and /merge-pdf are here because neither existed during the
 * overhaul — dating them 2026-08-11 like the rest would be a date invented
 * rather than recorded.
 *
 * /crop is here because the aspect-ratio chips changed what the page teaches:
 * its "Crop to a specific aspect ratio" section walked a visitor through the
 * multiplication by hand ("for 16:9 the height is the width multiplied by
 * 0.5625"), which the six chips now do for them, so the section, the answer,
 * the procedure and the FAQ were rewritten. A copy change, not a deploy.
 */
const PAGE_DATES = {
    '/jpg-to-pdf': '2026-08-12',
    '/merge-pdf': '2026-08-12',
    '/crop': '2026-08-15',
    // The directory did not exist before this date.
    '/tools': '2026-09-09',
};

export const CORE_PATHS = ['/', '/about', '/tools'];

/** The intent routes that belong in the index, in registry order. */
const INDEXABLE_INTENTS = INTENTS.filter((intent) => intent.indexable !== false);

export const INTENT_PATHS = INDEXABLE_INTENTS.map((intent) => intent.path);

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
        ...INDEXABLE_INTENTS.map((intent) => entryFor(intent.path, intent.lastModified)),
    ];
}
