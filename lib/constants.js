/**
 * Shared Limits and Tool Registry
 *
 * The single source of truth for every upload/processing limit and for the
 * tool catalogue that drives navigation, the Related Tools blocks and the
 * sitemap. Nothing here may be re-declared in a route or a component.
 */

export const MAX_FILE_SIZE = 20 * 1024 * 1024;

export const MAX_DIMENSION = 8000;

// Total-pixel budget for a single OUTPUT. 8000x8000 alone is 64MP, so the
// dimension cap on its own does not bound the working set. It is deliberately
// not a decode budget: downscaling a 48MP phone photo is the core job here.
export const MAX_PIXELS = 40_000_000;

// Decode ceiling handed to sharp's limitInputPixels. This is sharp's own
// default, stated explicitly so the source-side limit is visible in one place.
export const MAX_DECODE_PIXELS = 268_435_456;

export const MAX_SCALE_PERCENT = 400;

export const MAX_BULK_FILES = 20;

export const MAX_BULK_TOTAL_BYTES = 80 * 1024 * 1024;

export const DEFAULT_QUALITY = 80;

// Bounds for the exact-size target on /api/compress. The floor exists because
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

// AVIF is a /convert-only format, in and out. It stays off RASTER_INPUT_FORMATS
// and ALLOWED_OUTPUT_FORMATS on purpose: compress/crop/resize/bulk keep the
// three formats every browser can display without a fallback.
export const CONVERT_INPUT_FORMATS = ['jpeg', 'png', 'webp', 'avif'];

export const CONVERT_OUTPUT_FORMATS = ['jpeg', 'png', 'webp', 'avif'];

export const RESIZE_INPUT_FORMATS = ['jpeg', 'png', 'webp', 'gif'];

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
        description: 'Switch between JPEG, PNG, and WebP instantly.',
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
