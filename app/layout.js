import { Bricolage_Grotesque, Inclusive_Sans, JetBrains_Mono } from 'next/font/google';

import { SITE_NAME, SITE_URL } from '@/lib/seo';
import { THEME_COLORS } from '@/lib/theme';

import './globals.css';

/**
 * Three faces, self-hosted at build time by next/font so no request ever
 * leaves for Google at runtime. Display is roman-only by construction —
 * Bricolage Grotesque ships no italic.
 */
const display = Bricolage_Grotesque({
    subsets: ['latin'],
    weight: ['600', '700', '800'],
    variable: '--font-display',
    display: 'swap',
});

const body = Inclusive_Sans({
    subsets: ['latin'],
    weight: ['400', '500', '600', '700'],
    variable: '--font-body',
    display: 'swap',
});

const mono = JetBrains_Mono({
    subsets: ['latin'],
    weight: ['400', '500', '600', '700'],
    variable: '--font-mono',
    display: 'swap',
});

/**
 * SITE-WIDE DEFAULTS ONLY.
 *
 * Next merges metadata shallowly from the root down, so anything page-specific
 * declared here is inherited verbatim by every route. A canonical, an OG url,
 * an OG title and a twitter block once lived here and made all eleven routes
 * self-declare as duplicates of the homepage. Pages supply their own through
 * lib/seo.js buildMetadata — never from this file.
 */
export const metadata = {
    metadataBase: new URL(SITE_URL),
    title: {
        default: 'Resize, Compress and Convert Images Online — Resizo',
        template: '%s',
    },
    description:
        'Free online image tools. Resize to exact pixel dimensions, compress to a target file size, convert between JPEG, PNG and WebP, crop, and turn iPhone HEIC photos into JPG. No account, no watermark.',
    applicationName: SITE_NAME,
    authors: [{ name: SITE_NAME }],
    creator: SITE_NAME,
    publisher: SITE_NAME,
    openGraph: {
        siteName: SITE_NAME,
        locale: 'en_US',
        type: 'website',
    },
    robots: {
        index: true,
        follow: true,
        googleBot: {
            index: true,
            follow: true,
            'max-video-preview': -1,
            'max-image-preview': 'large',
            'max-snippet': -1,
        },
    },
    verification: {
        google: 'UpVu1P-3pwb4PT-bldHEQBwTYRC6xBKuLQnvz8gWT5A',
    },
    // No `icons` entry. app/favicon.ico, app/icon.png and app/apple-icon.png
    // are picked up by Next's file convention, and app/manifest.js declares
    // the install icons. Declaring them here as well emitted two competing
    // <link rel="icon"> tags pointing at two different files.
};

/**
 * Both surface tokens, so browser chrome follows the theme the page is
 * actually painting rather than guessing from the first paint.
 */
export const viewport = {
    themeColor: [
        { media: '(prefers-color-scheme: light)', color: THEME_COLORS.light },
        { media: '(prefers-color-scheme: dark)', color: THEME_COLORS.dark },
    ],
    colorScheme: 'light dark',
};

export default function RootLayout({ children }) {
    return (
        <html lang="en" className={`${display.variable} ${body.variable} ${mono.variable}`}>
            <body className="bg-surface text-ink" suppressHydrationWarning>
                {children}
            </body>
        </html>
    );
}
