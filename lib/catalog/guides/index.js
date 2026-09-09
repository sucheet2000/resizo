/**
 * The guide registry — one page per thing this site measured or verified.
 *
 * A guide is not a tool page with more words and it is never generated from a
 * template of numbers, formats or platforms. It exists because a benchmark was
 * run against the real tool, or because an official source says something, and
 * a reader arriving with one specific question is better off for having read
 * it. The finding comes first, the method that produced it is on the page, and
 * the sources carry the date they were checked.
 *
 * Same arrangement as lib/catalog/intents/: one module per guide, imported
 * here by hand because the bundler needs a static list and an entry that is
 * written but never imported is caught by the dead-code rule in
 * tests/architecture/no-dead-code.test.js. The contract every entry meets is
 * lib/catalog/guides/validate.js, checked while
 * app/(marketing)/guides/[slug]/page.js collects its static params, so a
 * broken entry fails `next build` rather than shipping.
 *
 * `path` is derived from the slug rather than stored: there is exactly one URL
 * shape for a guide, and a second copy of it would only drift.
 *
 * THE LIST IS EMPTY ON PURPOSE. The first two guides are written from
 * benchmarks/results/, which does not exist yet — a guide invented ahead of
 * its measurement is the exact thing this content type refuses to be. An empty
 * registry is a valid registry: /guides is noindex until an entry lands, the
 * route prerenders nothing, and the sitemap gains no URL.
 */
import jpegVsWebpAtTheSameSize from './jpeg-vs-webp-at-the-same-size';
import largePhotoTo20Kb from './large-photo-to-20-kb';

/** Registry order: the order the index lists them. */
const ENTRIES = [largePhotoTo20Kb, jpegVsWebpAtTheSameSize];

export const GUIDES = ENTRIES.map((guide) => ({ ...guide, path: `/guides/${guide.slug}` }));

export function getGuide(slug) {
    return GUIDES.find((guide) => guide.slug === slug) ?? null;
}

/**
 * The entries the index page lists and the sitemap advertises. A guide can be
 * written and held back — `indexable: false` — while its numbers are being
 * re-checked, and this is the one filter that decides.
 */
export function indexableGuides() {
    return GUIDES.filter((guide) => guide.indexable !== false);
}
