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
        lastModified: '2026-08-14',
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
        lastModified: '2026-08-14',
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
        lastModified: '2026-08-14',
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
