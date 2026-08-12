/**
 * manifest.webmanifest
 *
 * What makes an installed or home-screen-saved copy of the site look like a
 * product rather than a bookmark: a name, an icon, and browser chrome painted
 * in the page's own ground colour instead of the browser's default grey.
 *
 * The two colours come from lib/theme.js, the one module allowed to hold a
 * literal hex, so a token change in globals.css cannot leave the install
 * banner painting last season's background. A manifest carries a single
 * theme_color and no media queries, so it states the light value; the dark
 * one is served through `viewport.themeColor` in app/layout.js, which does
 * take a prefers-color-scheme pair.
 */
import { SITE_NAME } from '@/lib/seo';
import { THEME_COLORS } from '@/lib/theme';

export default function manifest() {
    return {
        name: `${SITE_NAME} — Image Tools`,
        short_name: SITE_NAME,
        description:
            'Resize images to exact pixel dimensions, compress to a target file size, convert '
            + 'between JPEG, PNG and WebP, crop, and turn iPhone HEIC photos into JPG.',
        lang: 'en-US',
        // A stable identity for the installed app. Without it the browser
        // derives one from start_url, so changing start_url later would strand
        // every existing install as a second, unrelated app.
        id: '/',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: THEME_COLORS.light,
        theme_color: THEME_COLORS.light,
        // Both are file-convention routes served out of app/, so the icon the
        // install prompt uses and the icon in the browser tab are the same
        // artwork from the same source — there is no second copy in public/
        // to fall out of date.
        icons: [
            { src: '/icon.png', sizes: '512x512', type: 'image/png' },
            { src: '/apple-icon.png', sizes: '180x180', type: 'image/png' },
        ],
    };
}
