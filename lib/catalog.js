/**
 * Site Catalogue
 *
 * The tool registry, the long-tail intent routes and the social presets — the
 * lists that drive navigation, the Related Tools blocks, the hub link blocks
 * and the sitemap. A route added in one place and forgotten in another is how
 * an orphan page happens, so every one of them reads this file.
 *
 * This is a LEAF, and it holds COPY: titles, descriptions and blurbs that
 * change whenever the marketing does. It is deliberately separate from
 * lib/limits.js, which holds the numbers and format lists the image engine
 * reads. They used to be one module, so the chunk the engine and the WEB WORKER
 * depend on carried tool descriptions the worker can never use, and editing a
 * description invalidated the engine's chunk.
 */

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
    // An image tool whose output happens to be a document. It is listed here,
    // beside the other five, and deliberately NOT under a "PDF tools" heading:
    // there is no PDF hub, no PDF section in the navigation and no second
    // product. A visitor arrives with photos and leaves with a file they can
    // email, which is the same shape as every other entry above.
    {
        slug: 'jpg-to-pdf',
        href: '/jpg-to-pdf',
        title: 'JPG to PDF',
        shortTitle: 'JPG to PDF',
        description: 'Combine photos into one PDF, in the order you choose.',
        hasOwnPage: true,
    },
    // The second entry whose files are documents, and it sits in this same flat
    // list for the same reason /jpg-to-pdf does. There is no "PDF tools"
    // heading, no /pdf hub and no second product — a visitor arrives with a
    // handful of files and leaves with one they can send, which is the shape of
    // every row above.
    {
        slug: 'merge-pdf',
        href: '/merge-pdf',
        title: 'Merge PDF',
        shortTitle: 'Merge PDF',
        description: 'Combine several PDFs into one file, in the order you choose.',
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
        lastModified: '2026-08-12',
    },
    {
        slug: 'compress-image-to-100kb',
        path: '/compress-image-to-100kb',
        tool: 'compress',
        label: 'Compress to 100 KB',
        blurb: 'A form that rejects anything over 100 KB — job portals and government uploads mostly',
        lastModified: '2026-08-12',
    },
    {
        slug: 'compress-image-to-200kb',
        path: '/compress-image-to-200kb',
        tool: 'compress',
        label: 'Compress to 200 KB',
        blurb: 'A 200 KB ceiling, which is enough for a full-width photo that still looks right',
        lastModified: '2026-08-12',
    },
    {
        slug: 'png-to-jpg',
        path: '/png-to-jpg',
        tool: 'convert',
        label: 'PNG to JPG',
        blurb: 'A photograph saved as a PNG, many times heavier than it needs to be',
        lastModified: '2026-08-12',
    },
    {
        slug: 'jpg-to-png',
        path: '/jpg-to-png',
        tool: 'convert',
        label: 'JPG to PNG',
        blurb: 'Something downstream demands a PNG and will not take the JPG you have',
        lastModified: '2026-08-12',
    },
    {
        slug: 'jpg-to-webp',
        path: '/jpg-to-webp',
        tool: 'convert',
        label: 'JPG to WebP',
        blurb: 'Photos going onto a web page, where 30 percent off every file is the whole point',
        lastModified: '2026-08-12',
    },
    {
        slug: 'png-to-webp',
        path: '/png-to-webp',
        tool: 'convert',
        label: 'PNG to WebP',
        blurb: 'A transparent graphic that has to get smaller and stay transparent',
        lastModified: '2026-08-12',
    },
    {
        slug: 'webp-to-jpg',
        path: '/webp-to-jpg',
        tool: 'convert',
        label: 'WebP to JPG',
        blurb: 'You saved an image from a web page and now nothing on your computer will open it',
        lastModified: '2026-08-12',
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
 * Every entry must stay inside MAX_DIMENSION and the MAX_PIXELS output budget
 * in lib/limits.js — a preset that cannot be honoured is worse than no preset.
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
