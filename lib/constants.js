/**
 * Shared Limits and Tool Registry
 *
 * The single source of truth for every upload/processing limit and for the
 * tool catalogue that drives navigation, the Related Tools blocks and the
 * sitemap. Nothing here may be re-declared in a route or a component.
 */

// The per-file cap, and now a published product promise rather than a platform
// one. It was chosen for a serverless function's memory; the binding constraint
// is the visitor's device, which lib/image-client/capability.js costs directly
// from what the browser reports. 20MB is left exactly where it is: it is quoted
// on every drop zone and in the page copy, the capability gate refuses anything
// this device genuinely cannot hold long before the file size becomes the
// reason, and moving a published number is a product decision, not a cleanup.
export const MAX_FILE_SIZE = 20 * 1024 * 1024;

export const MAX_DIMENSION = 8000;

// Total-pixel budget for a single OUTPUT. 8000x8000 alone is 64MP, so the
// dimension cap on its own does not bound the working set. It is deliberately
// not a decode budget: downscaling a 48MP phone photo is the core job here.
// The SOURCE side is bounded separately and more tightly, by
// HARD_MAX_SOURCE_PIXELS in lib/image-client/capability.js — a tab has no
// equivalent of sharp's 268MP decode headroom and cannot buy it back.
export const MAX_PIXELS = 40_000_000;

export const MAX_SCALE_PERCENT = 400;

export const MAX_BULK_FILES = 20;

export const MAX_BULK_TOTAL_BYTES = 80 * 1024 * 1024;

export const DEFAULT_QUALITY = 80;

// Bounds for the exact-size target on /compress. The floor exists because
// no photograph survives below it and the search would burn eight encodes to
// fail anyway; the ceiling is the upload cap, since a target above it can only
// ever be met by the untouched original.
export const MIN_TARGET_BYTES = 10 * 1024;

export const MAX_TARGET_BYTES = MAX_FILE_SIZE;

// Encode budget for one size-targeting search phase. Binary search over the
// 1-100 quality range needs 7 probes to isolate a single value, so 8 covers it
// with a spare and bounds the worst case at eight encodes per phase.
export const TARGET_SEARCH_ITERATIONS = 8;

export const ALLOWED_OUTPUT_FORMATS = ['jpeg', 'png', 'webp'];

export const RASTER_INPUT_FORMATS = ['jpeg', 'png', 'webp'];

// Every allowlist below is the same three formats, and AVIF and GIF are
// deliberately absent from all of them. AVIF used to be a /convert-only format
// in both directions and GIF a /resize-only input; both are gone because the
// image work now happens in the browser, where there is no AVIF decoder and no
// GIF decoder available, and where an AVIF *encode* costs 823 KB of extra
// download and 15-30 seconds per image on a phone.
//
// Recognising the two formats is still correct and still happens:
// lib/image/magic-bytes.js sniffs AVIF and GIF precisely so an upload can be
// refused for what it actually is rather than slipping through as something
// else. Accepting one would be a promise this stack cannot keep.
export const CONVERT_INPUT_FORMATS = ['jpeg', 'png', 'webp'];

export const CONVERT_OUTPUT_FORMATS = ['jpeg', 'png', 'webp'];

export const RESIZE_INPUT_FORMATS = ['jpeg', 'png', 'webp'];

export const HEIC_INPUT_FORMATS = ['heic'];

export const HEIC_MIME_TYPES = ['image/heic', 'image/heif'];

export const HEIC_EXTENSIONS = ['.heic', '.heif'];

/**
 * Tool catalogue. `hasOwnPage: false` means the tool lives inside another
 * route (bulk resize is a tab on /resize), so it is linked but never emitted
 * as a separate sitemap entry.
 */
export const TOOLS = [
    {
        slug: 'resize',
        href: '/resize',
        title: 'Resize Image',
        shortTitle: 'Resize',
        description: 'Change image dimensions with pixel-perfect precision.',
        hasOwnPage: true,
    },
    {
        slug: 'bulk-resize',
        href: '/resize#bulk',
        title: 'Bulk Resize',
        shortTitle: 'Bulk Resize',
        description: 'Resize up to 20 images at once and download them as a ZIP.',
        hasOwnPage: false,
    },
    {
        slug: 'compress',
        href: '/compress',
        title: 'Compress Image',
        shortTitle: 'Compress',
        description: 'Reduce file size without visible quality loss.',
        hasOwnPage: true,
    },
    {
        slug: 'convert',
        href: '/convert',
        title: 'Convert Format',
        shortTitle: 'Convert',
        description: 'Convert between JPEG, PNG and WebP instantly.',
        hasOwnPage: true,
    },
    {
        slug: 'crop',
        href: '/crop',
        title: 'Crop Image',
        shortTitle: 'Crop',
        description: 'Remove unwanted areas with exact pixel control.',
        hasOwnPage: true,
    },
    {
        slug: 'heic',
        href: '/heic',
        title: 'Convert HEIC',
        shortTitle: 'HEIC to JPEG',
        description: 'Convert iPhone HEIC photos to universal JPEG.',
        hasOwnPage: true,
    },
];

/**
 * Long-tail intent routes.
 *
 * Each one is a real page — the parent tool preconfigured for that exact job,
 * plus copy written for that job and nothing else. They are listed here rather
 * than in the sitemap so the sitemap, the hub link blocks on the parent tool
 * pages and the pages themselves all read one list; a route added in one place
 * and forgotten in another is how an orphan page happens.
 *
 * `tool` is the slug in TOOLS the page belongs to, which is what the hub blocks
 * group by. `label` is the breadcrumb leaf and the link text. `blurb` is the
 * situation that would send a visitor there, so a link block reads as a
 * sentence rather than as a list of keywords.
 */
export const LONGTAIL_PAGES = [
    {
        slug: 'resize-jpg',
        path: '/resize-jpg',
        tool: 'resize',
        label: 'Resize a JPG',
        blurb: 'Photograph from a camera or a phone, and you want it smaller without the artefacts showing',
        lastModified: '2026-08-11',
    },
    {
        slug: 'resize-png',
        path: '/resize-png',
        tool: 'resize',
        label: 'Resize a PNG',
        blurb: 'Logo, icon or screenshot, where the transparency and the hard edges have to survive',
        lastModified: '2026-08-11',
    },
    {
        slug: 'compress-image-to-100kb',
        path: '/compress-image-to-100kb',
        tool: 'compress',
        label: 'Compress to 100 KB',
        blurb: 'A form that rejects anything over 100 KB — job portals and government uploads mostly',
        lastModified: '2026-08-11',
    },
    {
        slug: 'compress-image-to-200kb',
        path: '/compress-image-to-200kb',
        tool: 'compress',
        label: 'Compress to 200 KB',
        blurb: 'A 200 KB ceiling, which is enough for a full-width photo that still looks right',
        lastModified: '2026-08-11',
    },
    {
        slug: 'png-to-jpg',
        path: '/png-to-jpg',
        tool: 'convert',
        label: 'PNG to JPG',
        blurb: 'A photograph saved as a PNG, many times heavier than it needs to be',
        lastModified: '2026-08-11',
    },
    {
        slug: 'jpg-to-png',
        path: '/jpg-to-png',
        tool: 'convert',
        label: 'JPG to PNG',
        blurb: 'Something downstream demands a PNG and will not take the JPG you have',
        lastModified: '2026-08-11',
    },
    {
        slug: 'jpg-to-webp',
        path: '/jpg-to-webp',
        tool: 'convert',
        label: 'JPG to WebP',
        blurb: 'Photos going onto a web page, where 30 percent off every file is the whole point',
        lastModified: '2026-08-11',
    },
    {
        slug: 'png-to-webp',
        path: '/png-to-webp',
        tool: 'convert',
        label: 'PNG to WebP',
        blurb: 'A transparent graphic that has to get smaller and stay transparent',
        lastModified: '2026-08-11',
    },
    {
        slug: 'webp-to-jpg',
        path: '/webp-to-jpg',
        tool: 'convert',
        label: 'WebP to JPG',
        blurb: 'You saved an image from a web page and now nothing on your computer will open it',
        lastModified: '2026-08-11',
    },
    {
        slug: 'heic-to-jpg',
        path: '/heic-to-jpg',
        tool: 'heic',
        label: 'HEIC to JPG',
        blurb: 'An iPhone photo that Windows, Android and most upload forms refuse',
        lastModified: '2026-08-11',
    },
];

export function getLongtailPage(slug) {
    return LONGTAIL_PAGES.find((page) => page.slug === slug) ?? null;
}

/**
 * The long-tail pages belonging to one tool, optionally without the page you
 * are already on — which is what turns the same list into a hub block on the
 * parent and a sibling block on a spoke.
 */
export function longtailPagesFor(toolSlug, { exclude } = {}) {
    return LONGTAIL_PAGES.filter((page) => page.tool === toolSlug && page.slug !== exclude);
}

/**
 * Published pixel dimensions for the platforms people actually resize for.
 * `group` is the platform heading the preset renders under; `label` is the
 * literal placement, so a chip reads "Instagram story" and never an abbreviation.
 *
 * Every entry must stay inside MAX_DIMENSION and the MAX_PIXELS output budget —
 * a preset that cannot be honoured is worse than no preset.
 */
export const SOCIAL_PRESETS = [
    { id: 'instagram-post', label: 'Instagram post', width: 1080, height: 1080, group: 'Instagram' },
    { id: 'instagram-portrait', label: 'Instagram portrait', width: 1080, height: 1350, group: 'Instagram' },
    { id: 'instagram-story', label: 'Instagram story', width: 1080, height: 1920, group: 'Instagram' },
    { id: 'instagram-profile', label: 'Instagram profile', width: 320, height: 320, group: 'Instagram' },
    { id: 'youtube-thumbnail', label: 'YouTube thumbnail', width: 1280, height: 720, group: 'YouTube' },
    { id: 'linkedin-post', label: 'LinkedIn post', width: 1200, height: 627, group: 'LinkedIn' },
    { id: 'linkedin-banner', label: 'LinkedIn banner', width: 1584, height: 396, group: 'LinkedIn' },
    { id: 'x-post', label: 'X post', width: 1600, height: 900, group: 'X' },
    { id: 'facebook-cover', label: 'Facebook cover', width: 851, height: 315, group: 'Facebook' },
    { id: 'whatsapp-profile', label: 'WhatsApp profile', width: 500, height: 500, group: 'WhatsApp' },
    { id: 'discord-avatar', label: 'Discord avatar', width: 512, height: 512, group: 'Discord' },
    { id: 'pinterest-pin', label: 'Pinterest pin', width: 1000, height: 1500, group: 'Pinterest' },
];

export function getSocialPreset(id) {
    return SOCIAL_PRESETS.find((preset) => preset.id === id) ?? null;
}

/**
 * The presets in platform order, as [{ group, presets }], so a grouped select
 * or chip row never has to re-derive the grouping.
 */
export function socialPresetGroups() {
    const groups = [];
    for (const preset of SOCIAL_PRESETS) {
        const existing = groups.find((entry) => entry.group === preset.group);
        if (existing) existing.presets.push(preset);
        else groups.push({ group: preset.group, presets: [preset] });
    }
    return groups;
}

export function getTool(slug) {
    return TOOLS.find((tool) => tool.slug === slug) ?? null;
}

export function relatedTools(slug) {
    return TOOLS.filter((tool) => tool.hasOwnPage && tool.slug !== slug);
}

export function sitemapTools() {
    return TOOLS.filter((tool) => tool.hasOwnPage);
}
