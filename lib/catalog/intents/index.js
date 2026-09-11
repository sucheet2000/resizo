/**
 * The intent registry — one indexable page per materially distinct user job.
 *
 * Each entry is a whole page: the parent tool it preconfigures, the headline,
 * the metadata, the direct answer, the procedure, the sections, the FAQ and
 * the relationships that link it into the site. app/(tools)/[slug]/page.js
 * renders whichever entry a slug names; the sitemap, the hub blocks on the
 * parent tool pages and the /tools directory read this same list, so a route
 * that exists is always linked and never a 404. The contract every entry has
 * to meet is lib/catalog/validate.js, and it is checked at build time.
 *
 * One module per intent, imported here by hand: the bundler needs a static
 * list, and an entry that is written but not imported is caught by the
 * dead-code rule in tests/architecture/no-dead-code.test.js.
 *
 * `path` is derived from the slug rather than stored — there is exactly one
 * URL shape for an intent page, and a second copy of it would only drift.
 * `tool` is the slug in TOOLS the page belongs to, which is what the hub
 * blocks group by. `label` is the breadcrumb leaf and the link text. `blurb`
 * is the situation that would send a visitor there, so a link block reads as
 * a sentence rather than as a list of keywords.
 */
import avifToJpg from './avif-to-jpg';
import avifToPng from './avif-to-png';
import compressImageTo100kb from './compress-image-to-100kb';
import compressImageTo200kb from './compress-image-to-200kb';
import compressImageTo20kb from './compress-image-to-20kb';
import compressImageTo50kb from './compress-image-to-50kb';
import heicToJpg from './heic-to-jpg';
import heicToPng from './heic-to-png';
import jpgToPng from './jpg-to-png';
import jpgToWebp from './jpg-to-webp';
import pngToJpg from './png-to-jpg';
import pngToWebp from './png-to-webp';
import resizeJpg from './resize-jpg';
import resizePng from './resize-png';
import resizeWebp from './resize-webp';
import webpToJpg from './webp-to-jpg';
import webpToPng from './webp-to-png';

/** Registry order: grouped by parent tool, in the order TOOLS lists them. */
const ENTRIES = [
    resizeJpg,
    resizePng,
    resizeWebp,
    compressImageTo20kb,
    compressImageTo50kb,
    compressImageTo100kb,
    compressImageTo200kb,
    pngToJpg,
    jpgToPng,
    jpgToWebp,
    pngToWebp,
    webpToJpg,
    webpToPng,
    avifToJpg,
    avifToPng,
    heicToJpg,
    heicToPng,
];

export const INTENTS = ENTRIES.map((intent) => ({ ...intent, path: `/${intent.slug}` }));

export function getIntent(slug) {
    return INTENTS.find((intent) => intent.slug === slug) ?? null;
}

/**
 * The intents belonging to one tool, optionally without the page you are
 * already on — which is what turns the same list into a hub block on the
 * parent and a sibling block on a spoke.
 */
export function intentsFor(toolSlug, { exclude } = {}) {
    return INTENTS.filter((intent) => intent.tool === toolSlug && intent.slug !== exclude);
}
