/**
 * The tool registry — the core products.
 *
 * One entry per tool, in the order the site presents them. `hasOwnPage: false`
 * means the tool lives inside another route (bulk resize is a tab on /resize),
 * so it is linked but never emitted as a separate sitemap entry. `category` is
 * the id of a row in lib/catalog/categories.js — the need a visitor arrives
 * with — and lib/catalog/validate.js refuses an id that does not exist there.
 *
 * This package holds COPY: titles, descriptions and blurbs that change whenever
 * the marketing does. It is deliberately separate from lib/limits.js, which
 * holds the numbers and format lists the image engine reads. They used to be
 * one module, so the chunk the engine and the WEB WORKER depend on carried
 * tool descriptions the worker can never use, and editing a description
 * invalidated the engine's chunk.
 */
export const TOOLS = [
    {
        slug: 'resize',
        href: '/resize',
        title: 'Resize Image',
        shortTitle: 'Resize',
        description: 'Change image dimensions with pixel-perfect precision.',
        hasOwnPage: true,
        nav: true,
        category: 'resize-crop',
    },
    {
        slug: 'bulk-resize',
        href: '/resize#bulk',
        title: 'Bulk Resize',
        shortTitle: 'Bulk Resize',
        description: 'Resize up to 20 images at once and download them as a ZIP.',
        hasOwnPage: false,
        nav: false,
        category: 'resize-crop',
    },
    {
        slug: 'compress',
        href: '/compress',
        title: 'Compress Image',
        shortTitle: 'Compress',
        description: 'Reduce file size without visible quality loss.',
        hasOwnPage: true,
        nav: true,
        category: 'compress',
    },
    {
        slug: 'convert',
        href: '/convert',
        title: 'Convert Format',
        shortTitle: 'Convert',
        description: 'Convert between JPEG, PNG and WebP instantly.',
        hasOwnPage: true,
        nav: true,
        category: 'convert',
    },
    {
        slug: 'crop',
        href: '/crop',
        title: 'Crop Image',
        shortTitle: 'Crop',
        description: 'Remove unwanted areas with exact pixel control.',
        hasOwnPage: true,
        nav: true,
        category: 'resize-crop',
    },
    {
        slug: 'heic',
        href: '/heic',
        title: 'Convert HEIC',
        shortTitle: 'HEIC to JPEG',
        description: 'Convert iPhone HEIC photos to universal JPEG.',
        hasOwnPage: true,
        nav: true,
        category: 'convert',
    },
    // An image tool whose output happens to be a document. It is listed here,
    // beside the other five, and deliberately NOT under a "PDF tools" heading:
    // there is no PDF hub, no PDF section in the navigation and no second
    // product. A visitor arrives with photos and leaves with a file they can
    // email, which is the same shape as every other entry above — and the
    // category it sits in is named for that need, not for the file type.
    {
        slug: 'jpg-to-pdf',
        href: '/jpg-to-pdf',
        title: 'JPG to PDF',
        shortTitle: 'JPG to PDF',
        description: 'Combine photos into one PDF, in the order you choose.',
        hasOwnPage: true,
        nav: true,
        category: 'combine',
    },
    // The second entry whose files are documents, and it sits in this same flat
    // list for the same reason /jpg-to-pdf does. A visitor arrives with a
    // handful of files and leaves with one they can send, which is the shape of
    // every row above.
    {
        slug: 'merge-pdf',
        href: '/merge-pdf',
        title: 'Merge PDF',
        shortTitle: 'Merge PDF',
        description: 'Combine several PDFs into one file, in the order you choose.',
        hasOwnPage: true,
        nav: true,
        category: 'combine',
    },
];

export function getTool(slug) {
    return TOOLS.find((tool) => tool.slug === slug) ?? null;
}

export function sitemapTools() {
    return TOOLS.filter((tool) => tool.hasOwnPage);
}
