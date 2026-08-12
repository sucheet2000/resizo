/**
 * SEO SURFACE CONTRACT
 *
 * The three generated files that describe the site to a crawler — sitemap.xml,
 * robots.txt and the web manifest — plus a source-level audit of the metadata
 * every page exports.
 *
 * The audit exists because of the defect it prevents. `alternates.canonical`
 * once lived in the root layout, Next merged it shallowly into every route, and
 * all eleven URLs told Google they were duplicates of the homepage. That is a
 * one-line mistake with a site-wide blast radius and nothing in the build
 * complains about it, so the check has to read the source and say so here.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import manifest from '@/app/manifest';
import robots from '@/app/robots';
import sitemap, { CORE_PATHS, LONGTAIL_PATHS } from '@/app/sitemap';
import { sitemapTools } from '@/lib/constants';
import { DEFAULT_OG_IMAGE, SITE_URL, absoluteUrl } from '@/lib/seo';
import { THEME_COLORS } from '@/lib/theme';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/* ------------------------------------------------------------------ *
 * Page discovery
 * ------------------------------------------------------------------ */

function walk(dir) {
    const out = [];
    const absolute = path.join(ROOT, dir);
    if (!fs.existsSync(absolute)) return out;

    for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
        const relative = `${dir}/${entry.name}`;
        if (entry.isDirectory()) {
            if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
            out.push(...walk(relative));
        } else if (entry.isFile() && entry.name === 'page.js') {
            out.push(relative);
        }
    }

    return out;
}

/** 'app/(tools)/compress/page.js' -> '/compress'; 'app/(marketing)/page.js' -> '/' */
function routePathOf(file) {
    const segments = file
        .split('/')
        .slice(1, -1)
        .filter((segment) => !(segment.startsWith('(') && segment.endsWith(')')));

    return segments.length === 0 ? '/' : `/${segments.join('/')}`;
}

const PAGE_FILES = walk('app')
    // A dynamic segment has no single canonical to check statically.
    .filter((file) => !file.includes('['))
    .sort();

const PAGES = PAGE_FILES.map((file) => ({
    file,
    route: routePathOf(file),
    source: fs.readFileSync(path.join(ROOT, file), 'utf8'),
}));

const ROUTES_ON_DISK = new Set(PAGES.map((page) => page.route));

/* ------------------------------------------------------------------ *
 * Static resolution of the metadata each page declares
 * ------------------------------------------------------------------ */

/** The argument object of the page's buildMetadata() call, as raw source. */
function buildMetadataBody(source) {
    const match = source.match(/buildMetadata\(\{([\s\S]*?)\n\s*\}\)/);
    return match ? match[1] : null;
}

/**
 * Resolves `path: PATH` / `path: '/about'` to a literal. Returns null when the
 * expression is neither a string nor a const declared in the same file — a
 * page is then held to the weaker rule in the audit below.
 */
function resolveValue(source, expression) {
    const trimmed = expression.trim().replace(/,$/, '');

    const quoted = trimmed.match(/^['"`]([^'"`]*)['"`]$/);
    if (quoted) return quoted[1];

    if (/^[A-Za-z_$][\w$]*$/.test(trimmed)) {
        const declaration = source.match(
            new RegExp(`const\\s+${trimmed}\\s*=\\s*['"\`]([^'"\`]*)['"\`]`),
        );
        if (declaration) return declaration[1];
    }

    return null;
}

function keyOf(body, key) {
    const match = body.match(new RegExp(`(?:^|[\\s{,])${key}:\\s*([^\\n]+)`));
    return match ? match[1] : null;
}

/* ------------------------------------------------------------------ *
 * sitemap.xml
 * ------------------------------------------------------------------ */

describe('sitemap', () => {
    const entries = sitemap();
    const urls = entries.map((entry) => entry.url);

    it('emits every core page, every tool page and every long-tail page', () => {
        const expected = [
            ...CORE_PATHS,
            ...sitemapTools().map((tool) => tool.href),
            ...LONGTAIL_PATHS,
        ].map(absoluteUrl);

        expect(urls).toEqual(expected);
    });

    it('derives the tool URLs from the registry rather than a hand-kept list', () => {
        for (const tool of sitemapTools()) {
            expect(urls).toContain(absoluteUrl(tool.href));
        }
    });

    it('omits the tools that do not have their own page', () => {
        // Bulk resize is a mode of /resize, not a URL. A sitemap entry for it
        // would be a duplicate of /resize with a fragment.
        expect(urls).not.toContain(absoluteUrl('/resize#bulk'));
        expect(urls.some((url) => url.includes('#'))).toBe(false);
    });

    it('lists every URL exactly once', () => {
        expect(new Set(urls).size).toBe(urls.length);
    });

    it('builds every URL from the one base in lib/seo.js', () => {
        for (const url of urls) {
            expect(url.startsWith(`${SITE_URL}/`)).toBe(true);
            expect(url).not.toMatch(/net\/\//);
        }
    });

    it('carries a real calendar date on every entry, never new Date()', () => {
        // The route is statically generated, so new Date() froze at build time
        // and republished all nine URLs with the timestamp of the last deploy.
        for (const entry of entries) {
            expect(typeof entry.lastModified, `${entry.url} lastModified`).toBe('string');
            expect(entry.lastModified).toMatch(ISO_DATE);
            expect(Number.isNaN(Date.parse(entry.lastModified))).toBe(false);
        }
    });

    it('drops changeFrequency and priority — Google ignores both', () => {
        for (const entry of entries) {
            expect(entry).not.toHaveProperty('changeFrequency');
            expect(entry).not.toHaveProperty('priority');
        }
    });

    it('never advertises a core or tool URL that has no page on disk', () => {
        const advertised = [...CORE_PATHS, ...sitemapTools().map((tool) => tool.href)];
        const missing = advertised.filter((route) => !ROUTES_ON_DISK.has(route));

        expect(missing, `sitemap lists routes with no page.js:\n${missing.join('\n')}`).toEqual([]);
    });

    it('leaves no indexable page out — a route is in here or it is noindex', () => {
        const orphans = PAGES
            .filter((page) => !urls.includes(absoluteUrl(page.route)))
            .filter((page) => !/index:\s*false/.test(page.source))
            .map((page) => page.route);

        expect(
            orphans,
            `these routes are neither in the sitemap nor noindex:\n${orphans.join('\n')}`,
        ).toEqual([]);
    });

    it('keeps the long-tail list to well-formed, unique, lower-case paths', () => {
        for (const route of LONGTAIL_PATHS) {
            expect(route, `${route} must be an absolute path`).toMatch(/^\/[a-z0-9-]+$/);
        }
        expect(new Set(LONGTAIL_PATHS).size).toBe(LONGTAIL_PATHS.length);
        expect(LONGTAIL_PATHS.some((route) => CORE_PATHS.includes(route))).toBe(false);
    });
});

/* ------------------------------------------------------------------ *
 * robots.txt
 * ------------------------------------------------------------------ */

describe('robots', () => {
    const result = robots();
    const [rule] = result.rules;
    const allow = [rule.allow].flat();
    const disallow = [rule.disallow].flat();

    it('applies to every crawler', () => {
        expect(rule.userAgent).toBe('*');
    });

    it('allows the site with one rule, not a drifting allowlist', () => {
        // The old list named four paths and had fallen out of sync with the
        // routes twice. `Allow: /` already matches everything.
        expect(allow).toEqual(['/']);
    });

    it('disallows only the two paths that never render indexable HTML', () => {
        expect(disallow).toEqual(['/api/', '/auth/']);
    });

    it('does not block /dashboard — a crawl block is not an index block', () => {
        // Google can index a disallowed URL from inbound links alone, and the
        // block is exactly what stops it reading the noindex the page serves.
        expect(disallow).not.toContain('/dashboard');
        expect(disallow.some((entry) => entry.startsWith('/dashboard'))).toBe(false);
    });

    it('points at the sitemap on the canonical host', () => {
        expect(result.sitemap).toBe(absoluteUrl('/sitemap.xml'));
        expect(result.sitemap.startsWith(SITE_URL)).toBe(true);
    });
});

/* ------------------------------------------------------------------ *
 * manifest.webmanifest
 * ------------------------------------------------------------------ */

describe('manifest', () => {
    const result = manifest();

    it('names the app and gives it a short name that fits a home screen', () => {
        expect(result.name.length).toBeGreaterThan(0);
        expect(result.short_name).toBe('Resizo');
        expect(result.short_name.length).toBeLessThanOrEqual(12);
        expect(result.description.length).toBeGreaterThan(20);
    });

    it('starts at the homepage and scopes to the whole site', () => {
        expect(result.start_url).toBe('/');
        expect(result.scope).toBe('/');
        expect(result.display).toBe('standalone');
    });

    it('takes both colours from the token mirror, never a literal hex', () => {
        expect(result.theme_color).toBe(THEME_COLORS.light);
        expect(result.background_color).toBe(THEME_COLORS.light);
    });

    it('declares icons that exist as files', () => {
        expect(result.icons.length).toBeGreaterThan(0);

        for (const icon of result.icons) {
            expect(icon.type).toBe('image/png');
            expect(icon.sizes).toMatch(/^\d+x\d+$/);

            const file = path.join(ROOT, 'app', icon.src.replace(/^\//, ''));
            expect(fs.existsSync(file), `${icon.src} is declared but missing`).toBe(true);
        }
    });

    it('ships a 512px icon, the size an installed app is rendered from', () => {
        expect(result.icons.some((icon) => icon.sizes === '512x512')).toBe(true);
    });
});

/* ------------------------------------------------------------------ *
 * Icons: one source of truth
 * ------------------------------------------------------------------ */

describe('icons', () => {
    it('keeps the file-convention icons in app/ and nothing competing in public/', () => {
        for (const file of ['app/favicon.ico', 'app/icon.png', 'app/apple-icon.png']) {
            expect(fs.existsSync(path.join(ROOT, file)), `${file} is missing`).toBe(true);
        }

        // Two favicons produced two competing <link rel="icon"> tags.
        expect(
            fs.existsSync(path.join(ROOT, 'public', 'favicon.ico')),
            'public/favicon.ico duplicates the app/ file convention — keep one source',
        ).toBe(false);
    });

    it('does not re-declare icons in the root layout metadata', () => {
        const layout = fs.readFileSync(path.join(ROOT, 'app', 'layout.js'), 'utf8');
        expect(layout).not.toMatch(/\bicons:\s*\{/);
    });
});

/* ------------------------------------------------------------------ *
 * Source audit: one canonical per page, and it points at itself
 * ------------------------------------------------------------------ */

describe('page metadata source audit', () => {
    it('finds the pages to audit', () => {
        expect(PAGES.length).toBeGreaterThan(5);
        expect(PAGES.map((page) => page.route)).toContain('/');
    });

    it.each(PAGES.map((page) => [page.route, page]))(
        '%s builds its metadata through lib/seo.js',
        (_route, page) => {
            expect(
                page.source,
                `${page.file} must export metadata built by buildMetadata()`,
            ).toMatch(/buildMetadata\(/);
            expect(page.source).toMatch(/export const metadata|export async function generateMetadata/);
        },
    );

    it.each(PAGES.map((page) => [page.route, page]))(
        '%s canonicalises to its own path',
        (route, page) => {
            const body = buildMetadataBody(page.source);
            expect(body, `${page.file}: could not read the buildMetadata() call`).toBeTruthy();

            const expression = keyOf(body, 'path');
            expect(
                expression,
                `${page.file}: buildMetadata() has no path, so it canonicalises to "/" `
                + 'and declares itself a duplicate of the homepage',
            ).toBeTruthy();

            const resolved = resolveValue(page.source, expression);

            if (resolved === null) {
                // A computed path cannot be checked statically. The route must
                // at least appear in the file as a literal so a reader can see
                // which URL the page claims.
                expect(
                    page.source.includes(`'${route}'`) || page.source.includes(`"${route}"`),
                    `${page.file}: path is computed (${expression.trim()}) and "${route}" `
                    + 'never appears as a literal — make the canonical readable',
                ).toBe(true);
                return;
            }

            expect(resolved, `${page.file} canonicalises to ${resolved}, not ${route}`).toBe(route);
        },
    );

    it.each(PAGES.map((page) => [page.route, page]))(
        '%s carries its own title and description',
        (_route, page) => {
            const body = buildMetadataBody(page.source);
            expect(keyOf(body, 'title'), `${page.file} has no title`).toBeTruthy();
            expect(keyOf(body, 'description'), `${page.file} has no description`).toBeTruthy();
        },
    );

    it.each(PAGES.map((page) => [page.route, page]))(
        '%s points at an OG image that exists',
        (_route, page) => {
            const body = buildMetadataBody(page.source);
            const expression = keyOf(body, 'ogImage');
            const image = expression
                ? resolveValue(page.source, expression)
                : DEFAULT_OG_IMAGE;

            if (image === null) return;

            const file = path.join(ROOT, 'public', image.replace(/^\//, ''));
            expect(fs.existsSync(file), `${page.file} references ${image}, which is missing`).toBe(true);
        },
    );

    it('never lets the root layout declare a page-level canonical or OG block', () => {
        const layout = fs.readFileSync(path.join(ROOT, 'app', 'layout.js'), 'utf8');

        expect(layout, 'a canonical in the root layout is inherited by every route').not.toMatch(
            /alternates:/,
        );
        expect(layout).not.toMatch(/\btwitter:\s*\{/);

        const openGraph = layout.match(/openGraph:\s*\{([\s\S]*?)\n {4}\}/);
        expect(openGraph, 'the root layout should still hold the site-wide OG defaults').toBeTruthy();
        for (const key of ['url:', 'title:', 'description:', 'images:']) {
            expect(
                openGraph[1],
                `openGraph.${key.replace(':', '')} in the root layout is inherited by every route`,
            ).not.toContain(key);
        }
    });

    it('keeps the dashboard out of the index without a crawl block', () => {
        const dashboard = PAGES.find((page) => page.route === '/dashboard');
        expect(dashboard).toBeTruthy();
        expect(dashboard.source).toMatch(/index:\s*false/);
        expect(dashboard.source).toMatch(/follow:\s*false/);
    });
});
