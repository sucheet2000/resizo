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
import { INTENTS, indexableGuides, sitemapTools } from '@/lib/catalog';
import { absoluteUrl } from '@/lib/seo';

/**
 * Every route on the site was rewritten in the Wave 2 overhaul, so they started
 * from one shared date. This is the floor, not a default that hides drift: the
 * moment one page's copy changes on its own it gets its own date, either in
 * PAGE_DATES below or — for a long-tail page — on its registry entry.
 *
 * That has happened twice. The no-upload copy pass of 2026-08-12 rewrote eight
 * of the then ten intent pages and left two alone, so the dates diverged. On
 * 2026-09-09 the content-quality contract added the changes lists, the limits
 * and the formats line to every intent page, so every one of them carries that
 * day — fifteen identical dates that are each true. The signal is a date that
 * moves with the page's content, whether or not its neighbours moved too;
 * tests/app/metadata.test.js refuses a future date and a date earlier than
 * content the page carries.
 */
export const OVERHAUL = '2026-08-11';

/**
 * Per-page overrides for the core and tool routes, which have no date of their
 * own in the registry. An intent page carries its date on its registry entry
 * instead, so its copy and its lastmod are edited in the same place.
 *
 * /jpg-to-pdf and /merge-pdf are here because neither existed during the
 * overhaul — dating them 2026-08-11 like the rest would be a date invented
 * rather than recorded.
 *
 * /crop first moved for the aspect-ratio chips, which changed what the page
 * teaches: its "Crop to a specific aspect ratio" section walked a visitor
 * through the multiplication by hand, which the six chips now do for them. A
 * copy change, not a deploy.
 */
const PAGE_DATES = {
    // The homepage and /about stopped promising the project would never be
    // commercial and now state the promise the product keeps — every core
    // tool free to use, no account, no watermark, no daily quota. A copy change.
    '/': '2026-09-09',
    '/about': '2026-09-09',
    '/jpg-to-pdf': '2026-08-12',
    '/merge-pdf': '2026-08-12',
    // Three tool pages whose visible content changed with the September
    // expansion and the growth system: /compress gained the shrink-to-fit
    // control and a measured before/after figure, /crop a figure, /heic the
    // Save as control and the block linking its two intent pages. /resize
    // and /convert changed only in markup a reader does not see, so they keep
    // their dates.
    '/compress': '2026-09-09',
    '/crop': '2026-09-09',
    '/heic': '2026-09-09',
    // The directory did not exist before this date.
    '/tools': '2026-09-09',
    // The guides index, likewise. Its date is its own: the page states what a
    // guide is on this site, which is copy that changes when that answer does,
    // not every time an entry is added to the list underneath it.
    '/guides': '2026-09-09',
    // The three tools the September expansion added.
    '/signature-resizer': '2026-09-09',
    '/change-image-dpi': '2026-09-09',
    '/remove-image-metadata': '2026-09-09',
    // The requirement fitter. Its own date because it did not exist before
    // it — and because its four presets carry a verifiedAt of the same day,
    // so the page's content and the sources behind it were written together.
    '/passport-photo': '2026-09-10',
    // The batch compressor, likewise dated the day it was written rather than
    // the overhaul floor: nothing at this URL existed before it.
    '/bulk-image-compressor': '2026-09-10',
};

export const CORE_PATHS = ['/', '/about', '/tools', '/guides'];

/** The intent routes that belong in the index, in registry order. */
const INDEXABLE_INTENTS = INTENTS.filter((intent) => intent.indexable !== false);

export const INTENT_PATHS = INDEXABLE_INTENTS.map((intent) => intent.path);

/**
 * The guide pages that belong in the index, newest revision first — the order
 * /guides itself lists them in.
 *
 * A guide carries its own `modified`, so its copy and its lastmod are edited in
 * the same file, exactly as an intent's are, and neither can be moved by a
 * deploy. The registry ships empty, so today this contributes nothing while
 * /guides itself is listed above as a core page.
 */
const INDEXABLE_GUIDES = indexableGuides()
    .slice()
    .sort((a, b) => b.modified.localeCompare(a.modified));

export const GUIDE_PATHS = INDEXABLE_GUIDES.map((guide) => guide.path);

/**
 * The demonstration figures, by the page that carries them. Next turns these
 * into <image:image> children of the URL, which is the only way an image on a
 * page can be found on its own — nothing links to a file in public/, so a
 * crawler that never renders the page never learns these exist.
 *
 * /change-image-dpi's figure is an SVG diagram and is listed like the
 * rasters: Google's image documentation names SVG among the formats Google
 * Images indexes, beside BMP, GIF, JPEG, PNG, WebP and AVIF.
 *
 * tests/app/demo-assets.test.js holds both halves of this — every demo on a
 * page appears here, and every path here is a file that exists.
 */
const PAGE_IMAGES = {
    '/compress': ['/demos/photo-source-800x534.jpg', '/demos/photo-compressed-100kb.jpg'],
    '/crop': ['/demos/photo-source-800x534.jpg', '/demos/photo-crop-900x600.jpg'],
    '/signature-resizer': ['/demos/signature-source-600x200.png', '/demos/signature-fitted-240x80.jpg'],
    '/change-image-dpi': ['/demos/dpi-print-size.svg'],
    // The one intent route with a figure. Its blocks live in
    // lib/catalog/intents/png-to-jpg.js rather than in a page file, which
    // changes nothing here: the path is the path, and an image on it still has
    // to be listed to be findable on its own.
    '/png-to-jpg': ['/demos/transparent-source-480x320.png', '/demos/transparent-on-white-480x320.jpg'],
    '/passport-photo': ['/demos/portrait-source-480x640.jpg', '/demos/portrait-passport-600x600.jpg'],
    '/bulk-image-compressor': ['/demos/photo-source-800x534.jpg', '/demos/bulk-compressed-photo-200kb.jpg'],
};

function entryFor(path, lastModified) {
    const images = PAGE_IMAGES[path];

    return {
        url: absoluteUrl(path),
        lastModified: PAGE_DATES[path] ?? lastModified ?? OVERHAUL,
        ...(images ? { images: images.map(absoluteUrl) } : {}),
    };
}

export default function sitemap() {
    return [
        ...CORE_PATHS.map((path) => entryFor(path)),
        // hasOwnPage filters out bulk resize, which is a mode of /resize rather
        // than a URL of its own.
        ...sitemapTools().map((tool) => entryFor(tool.href)),
        ...INDEXABLE_INTENTS.map((intent) => entryFor(intent.path, intent.lastModified)),
        ...INDEXABLE_GUIDES.map((guide) => entryFor(guide.path, guide.modified)),
    ];
}
