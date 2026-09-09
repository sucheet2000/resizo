/**
 * SEO INFRASTRUCTURE CONTRACT
 *
 * Three route files (sitemap, robots, manifest) plus one source-level audit of
 * every page in app/.
 *
 * The audit exists because the single worst defect this codebase has shipped
 * was a canonical declared once, in the root layout, and inherited by every
 * route — eleven URLs all telling Google they were duplicates of the homepage.
 * Nothing about that was visible in a diff. It is visible here: this suite
 * reads every page.js and fails if one of them stops declaring its own path.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { describe, expect, it } from 'vitest';

import manifest from '@/app/manifest';
import robots from '@/app/robots';
import sitemap, { CORE_PATHS, INTENT_PATHS } from '@/app/sitemap';
import { INTENTS, sitemapTools } from '@/lib/catalog';
import { DEFAULT_OG_IMAGE, SITE_NAME, SITE_URL } from '@/lib/seo';
import { THEME_COLORS } from '@/lib/theme';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const APP = path.join(ROOT, 'app');
const PUBLIC = path.join(ROOT, 'public');

/**
 * The one dynamic route. It has no single canonical to read off its source —
 * it serves every intent in the registry through generateMetadata — so it is
 * audited by resolving that function per intent, below, rather than by the
 * source scan the static pages get.
 */
const INTENT_ROUTE = path.join(APP, '(tools)', '[slug]', 'page.js');

/**
 * The date every page in the Wave 2 overhaul was last actually rewritten, and
 * now the FLOOR rather than the answer: a page whose copy changes afterwards
 * gets its own, later date. Nothing may sit below this line, because that would
 * mean a date invented rather than recorded.
 */
const OVERHAUL_DATE = '2026-08-11';

/* ------------------------------------------------------------------ *
 * Page discovery
 * ------------------------------------------------------------------ */

function walk(dir) {
    const out = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const absolute = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
            out.push(...walk(absolute));
        } else if (entry.isFile() && entry.name === 'page.js') {
            out.push(absolute);
        }
    }
    return out;
}

/** app/(marketing)/about/page.js → /about   ·   app/(marketing)/page.js → / */
function routeOf(file) {
    const segments = path
        .relative(APP, path.dirname(file))
        .split(path.sep)
        .filter((segment) => segment !== '' && segment !== '.')
        .filter((segment) => !(segment.startsWith('(') && segment.endsWith(')')));

    return segments.length === 0 ? '/' : `/${segments.join('/')}`;
}

const PAGES = walk(APP)
    .filter((file) => file !== INTENT_ROUTE)
    .map((file) => ({
        file,
        relative: path.relative(ROOT, file).split(path.sep).join('/'),
        route: routeOf(file),
        source: fs.readFileSync(file, 'utf8'),
    }))
    .sort((a, b) => a.route.localeCompare(b.route));

/** A page is indexable unless its own metadata says otherwise. */
function isNoindex(page) {
    return /robots\s*:\s*\{[^}]*index\s*:\s*false/.test(page.source);
}

const INDEXABLE = PAGES.filter((page) => !isNoindex(page));

/**
 * The `path:` handed to buildMetadata — either a literal or the `PATH` const
 * every page in this codebase declares at the top of the file.
 */
function declaredPath(page) {
    const call = page.source.match(/buildMetadata\(\{([\s\S]*?)\n\s*\}\)/);
    if (!call) return null;

    const argument = call[1].match(/^\s*path:\s*(.+?),?\s*$/m);
    if (!argument) return null;

    const value = argument[1].trim().replace(/,$/, '');
    if (/^['"].*['"]$/.test(value)) return value.slice(1, -1);

    const constant = page.source.match(new RegExp(`const ${value} = ['"]([^'"]+)['"]`));
    return constant ? constant[1] : null;
}

function declaredOgImage(page) {
    const match = page.source.match(/ogImage:\s*['"]([^'"]+)['"]/);
    return match ? match[1] : DEFAULT_OG_IMAGE;
}

/* ------------------------------------------------------------------ *
 * sitemap.xml
 * ------------------------------------------------------------------ */

describe('sitemap', () => {
    const entries = sitemap();
    const urls = entries.map((entry) => entry.url);

    it('emits an entry for every page', () => {
        expect(entries.length).toBeGreaterThan(8);
    });

    it('builds every URL from the canonical host in lib/seo', () => {
        for (const url of urls) {
            expect(url.startsWith(`${SITE_URL}/`)).toBe(true);
            expect(url).not.toMatch(/net\/\//);
        }
    });

    it('hardcodes the host nowhere in the file', () => {
        const source = fs.readFileSync(path.join(APP, 'sitemap.js'), 'utf8');
        expect(source).not.toContain('resizo.net');
    });

    it('lists every tool that has its own page', () => {
        for (const tool of sitemapTools()) {
            expect(urls).toContain(`${SITE_URL}${tool.href}`);
        }
    });

    it('lists the homepage and the about page', () => {
        expect(CORE_PATHS).toEqual(['/', '/about']);
        for (const route of CORE_PATHS) {
            expect(urls).toContain(`${SITE_URL}${route}`);
        }
    });

    it('reads the intent routes off the registry rather than a second list', () => {
        expect(INTENT_PATHS).toEqual(INTENTS.map((page) => page.path));
        expect(INTENT_PATHS.length).toBeGreaterThan(0);
    });

    it('honours the lastModified each intent carries in the registry', () => {
        for (const page of INTENTS) {
            const entry = entries.find((candidate) => candidate.url === `${SITE_URL}${page.path}`);
            expect(entry, `${page.path} is missing from the sitemap`).toBeTruthy();
            expect(entry.lastModified).toBe(page.lastModified);
        }
    });

    it('lists every indexable page that exists in app/', () => {
        for (const page of INDEXABLE) {
            expect(urls, `${page.relative} is missing from the sitemap`).toContain(
                `${SITE_URL}${page.route}`,
            );
        }
    });

    /**
     * The other direction, and the one that matters: a URL in the sitemap that
     * has no page behind it is a 404 handed straight to a crawler. A URL is
     * backed either by a page.js on disk or by an intent the [slug] route
     * prerenders; anything else is an orphan.
     */
    it('lists no URL without a page or a registered intent behind it', () => {
        const built = new Set(PAGES.map((page) => `${SITE_URL}${page.route}`));
        const pending = new Set(INTENT_PATHS.map((route) => `${SITE_URL}${route}`));

        const orphans = urls.filter((url) => !built.has(url) && !pending.has(url));
        expect(orphans, `sitemap URLs with no page:\n${orphans.join('\n')}`).toEqual([]);
    });

    it('never lists a fragment, an API route or /auth', () => {
        for (const url of urls) {
            expect(url).not.toContain('#');
            expect(url).not.toContain('/api/');
            expect(url).not.toContain('/auth');
        }
    });

    it('lists each URL exactly once', () => {
        expect(new Set(urls).size).toBe(urls.length);
    });

    /**
     * This used to assert every entry contained OVERHAUL_DATE literally, which
     * only held while nothing had been edited since. It now checks the property
     * that was always the real one: a hand-recorded calendar date, never read
     * off the clock. The source scan is the half that a value check cannot do —
     * new Date() would still produce a plausible-looking string.
     */
    it('carries a real per-page lastModified, not the build clock', () => {
        // Comments are stripped first: the file explains at length why
        // new Date() was removed, and naming the mistake must not trip the
        // check for the mistake.
        const code = fs
            .readFileSync(path.join(APP, 'sitemap.js'), 'utf8')
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/\/\/.*$/gm, '');

        expect(code, 'a build-time clock republishes every URL on every deploy').not.toMatch(
            /new Date\s*\(/,
        );

        for (const entry of entries) {
            expect(entry.lastModified, `${entry.url} has no lastModified`).toBeTruthy();
            expect(String(entry.lastModified), `${entry.url} is not an ISO date`).toMatch(
                /^\d{4}-\d{2}-\d{2}$/,
            );
            expect(
                String(entry.lastModified) >= OVERHAUL_DATE,
                `${entry.url} predates the overhaul that rewrote it`,
            ).toBe(true);
        }
    });

    /**
     * A long-tail date is edited on the registry entry, next to the blurb, so
     * that changing a page's copy and changing its lastmod are the same diff.
     * Reading it anywhere else — a second list, a default that swallows it — is
     * how the two drift apart, and drift is what makes Google stop trusting the
     * signal. No test can know whether copy really changed; this one at least
     * guarantees there is exactly one place to record that it did.
     */
    it('takes every intent date from the registry entry and nowhere else', () => {
        for (const page of INTENTS) {
            const entry = entries.find((candidate) => candidate.url === `${SITE_URL}${page.path}`);
            expect(entry.lastModified, `${page.path} does not use its registry date`).toBe(
                page.lastModified,
            );
        }

        // If every entry were falling through to the shared floor, the check
        // above would still pass. The pages have diverged, and must be able to.
        const dates = new Set(INTENTS.map((page) => page.lastModified));
        expect(
            dates.size,
            'every intent page carries the same date — either nothing has been '
            + 'edited since the overhaul, or a bulk find-and-replace swept the registry',
        ).toBeGreaterThan(1);
    });

    /**
     * NO DATE IN THE FUTURE.
     *
     * lastmod is a signal Google discounts wholesale once it finds it
     * unreliable, and a date that has not happened yet is the clearest possible
     * way to look unreliable. The dates here are typed by hand — that is the
     * whole design, so a page's copy and its date are edited together — and a
     * hand-typed date is exactly the kind that gets a year or a month wrong.
     *
     * Compared in UTC because that is what a sitemap date means. A machine in
     * PDT is already on the next UTC day for seven hours, and treating its
     * local date as the ceiling would fail a date that is perfectly correct.
     */
    it('never claims a page was modified in the future', () => {
        const todayUtc = new Date().toISOString().slice(0, 10);
        const ahead = sitemap()
            .filter((entry) => String(entry.lastModified) > todayUtc)
            .map((entry) => `${entry.url} — ${entry.lastModified}`);

        expect(ahead, `today is ${todayUtc} UTC`).toEqual([]);
    });

    it('returns the same dates on every call — new Date() would not', () => {
        expect(sitemap()).toEqual(entries);
    });

    it('drops changeFrequency and priority, which Google ignores', () => {
        for (const entry of entries) {
            expect(Object.keys(entry).sort()).toEqual(['lastModified', 'url']);
        }
    });
});

/* ------------------------------------------------------------------ *
 * robots.txt
 * ------------------------------------------------------------------ */

describe('robots', () => {
    const result = robots();
    const [rule] = result.rules;

    it('has exactly one rule, for every crawler', () => {
        expect(result.rules).toHaveLength(1);
        expect(rule.userAgent).toBe('*');
    });

    it('allows the whole site with one entry, not a stale allowlist', () => {
        const allow = Array.isArray(rule.allow) ? rule.allow : [rule.allow];
        expect(allow).toEqual(['/']);
    });

    it('disallows the API and the auth callback and nothing else', () => {
        expect(rule.disallow).toEqual(['/api/', '/auth/']);
    });

    it('points at the sitemap on the canonical host', () => {
        expect(result.sitemap).toBe(`${SITE_URL}/sitemap.xml`);
    });

    it('hardcodes the host nowhere in the file', () => {
        const source = fs.readFileSync(path.join(APP, 'robots.js'), 'utf8');
        expect(source).not.toContain('resizo.net');
    });
});

/* ------------------------------------------------------------------ *
 * manifest.webmanifest
 * ------------------------------------------------------------------ */

describe('manifest', () => {
    const result = manifest();

    it('names the site', () => {
        expect(result.name).toContain(SITE_NAME);
        expect(result.short_name).toBe(SITE_NAME);
        expect(result.description.length).toBeGreaterThan(30);
    });

    it('starts at the homepage and is scoped to the whole site', () => {
        expect(result.start_url).toBe('/');
        expect(result.scope).toBe('/');
        expect(result.display).toBe('standalone');
    });

    it('takes both colours from the token mirror, never a literal hex', () => {
        expect(result.background_color).toBe(THEME_COLORS.light);
        expect(result.theme_color).toBe(THEME_COLORS.light);

        const source = fs.readFileSync(path.join(APP, 'manifest.js'), 'utf8');
        expect(source).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    });

    it('declares the icons that exist on disk', () => {
        expect(result.icons.length).toBeGreaterThan(0);

        for (const icon of result.icons) {
            expect(icon.type).toBe('image/png');
            expect(icon.sizes).toMatch(/^\d+x\d+$/);
            expect(
                fs.existsSync(path.join(APP, icon.src.replace(/^\//, ''))),
                `${icon.src} is declared in the manifest but not in app/`,
            ).toBe(true);
        }
    });

    it('ships a 512px icon, the size an install prompt requires', () => {
        expect(result.icons.some((icon) => icon.sizes === '512x512')).toBe(true);
    });
});

/* ------------------------------------------------------------------ *
 * Icons — one source of truth
 * ------------------------------------------------------------------ */

describe('icons', () => {
    it('keeps the favicon on the app/ file convention only', () => {
        expect(fs.existsSync(path.join(APP, 'favicon.ico'))).toBe(true);
        expect(
            fs.existsSync(path.join(PUBLIC, 'favicon.ico')),
            'public/favicon.ico competes with app/favicon.ico — two <link rel="icon"> tags',
        ).toBe(false);
    });

    it('ships the tab icon and the iOS home-screen icon', () => {
        expect(fs.existsSync(path.join(APP, 'icon.png'))).toBe(true);
        expect(fs.existsSync(path.join(APP, 'apple-icon.png'))).toBe(true);
    });

    it('does not re-declare icons in the root layout metadata', () => {
        const source = fs.readFileSync(path.join(APP, 'layout.js'), 'utf8');
        expect(
            source,
            'the file convention already emits <link rel="icon"> — a metadata.icons entry duplicates it',
        ).not.toMatch(/\n\s{4}icons:\s*\{/);
    });
});

/* ------------------------------------------------------------------ *
 * Per-page metadata audit
 * ------------------------------------------------------------------ */

describe('page metadata audit', () => {
    it('found the pages', () => {
        expect(PAGES.length).toBeGreaterThan(8);
        expect(PAGES.map((page) => page.route)).toContain('/');
    });

    it('audits the intent route separately, because it exists', () => {
        expect(fs.existsSync(INTENT_ROUTE)).toBe(true);
        expect(PAGES.map((page) => page.file)).not.toContain(INTENT_ROUTE);
    });

    it.each(PAGES.map((page) => [page.relative, page]))(
        '%s exports metadata',
        (_relative, page) => {
            expect(page.source).toMatch(/export const metadata\b|export async function generateMetadata\b/);
        },
    );

    it.each(PAGES.map((page) => [page.relative, page]))(
        '%s builds it through buildMetadata, so it cannot inherit a canonical',
        (_relative, page) => {
            expect(page.source).toContain('buildMetadata(');
        },
    );

    it.each(PAGES.map((page) => [page.relative, page]))(
        '%s canonicalises to its own route',
        (_relative, page) => {
            expect(declaredPath(page)).toBe(page.route);
        },
    );

    it.each(PAGES.map((page) => [page.relative, page]))(
        '%s points at an OG image that exists',
        (_relative, page) => {
            const image = declaredOgImage(page);
            expect(image.startsWith('/')).toBe(true);
            expect(
                fs.existsSync(path.join(PUBLIC, image.replace(/^\//, ''))),
                `${image} is referenced but missing from public/`,
            ).toBe(true);
        },
    );

    it('declares no canonical, OG url, OG title or twitter block in the root layout', () => {
        const layout = fs.readFileSync(path.join(APP, 'layout.js'), 'utf8');
        expect(layout).not.toContain('alternates');
        expect(layout).not.toMatch(/\btwitter\s*:/);
        expect(layout).not.toMatch(/\burl\s*:\s*['"`]/);
        expect(layout).not.toMatch(/\bkeywords\s*:/);
    });

    it('gives every indexable page a distinct canonical', () => {
        const routes = INDEXABLE.map((page) => declaredPath(page));
        expect(new Set(routes).size).toBe(routes.length);
    });

    it('gives every intent a canonical of its own that no static page claims', async () => {
        const route = await import(/* @vite-ignore */ pathToFileURL(INTENT_ROUTE).href);
        const staticRoutes = new Set(INDEXABLE.map((page) => declaredPath(page)));

        for (const intent of INTENTS) {
            const metadata = await route.generateMetadata({ params: Promise.resolve({ slug: intent.slug }) });
            expect(metadata.alternates.canonical).toBe(`${SITE_URL}${intent.path}`);
            expect(staticRoutes.has(intent.path), `${intent.path} is both a static page and an intent`).toBe(false);
        }
    });

    it('leaves every page indexable — nothing is noindex now', () => {
        const noindexed = PAGES.filter(isNoindex).map((page) => page.route);
        expect(noindexed).toEqual([]);
    });
});

/* ------------------------------------------------------------------ *
 * Snippet directives — the resolved metadata, not the source
 * ------------------------------------------------------------------ */

/**
 * The audit above reads source text, which cannot tell whether the object a
 * page exports actually carries the directives. These import the page module
 * and look at the metadata Next will render.
 *
 * The defect they exist for: buildMetadata emitted no `robots` at all, so
 * Google clipped every snippet to its default length and showed no image
 * preview — on a site whose entire problem is a 3.1% click-through rate at an
 * average position of 9.
 */
describe('snippet directives', () => {
    const load = (page) => import(/* @vite-ignore */ pathToFileURL(page.file).href);

    /**
     * Every metadata object the site can render: the static pages' exports,
     * and the intent route's generateMetadata resolved once per registered
     * intent — the same call Next makes at build time.
     */
    const SUBJECTS = [
        ...INDEXABLE.map((page) => ({
            relative: page.relative,
            load: async () => (await load(page)).metadata,
        })),
        ...INTENTS.filter((intent) => intent.indexable !== false).map((intent) => ({
            relative: `app/(tools)/[slug]/page.js → ${intent.path}`,
            load: async () => {
                const route = await import(/* @vite-ignore */ pathToFileURL(INTENT_ROUTE).href);
                return route.generateMetadata({ params: Promise.resolve({ slug: intent.slug }) });
            },
        })),
    ];

    it('resolves a metadata object for every static page and every intent', () => {
        expect(SUBJECTS.length).toBe(INDEXABLE.length + INTENTS.filter((intent) => intent.indexable !== false).length);
        expect(SUBJECTS.length).toBeGreaterThanOrEqual(19);
    });

    it.each(SUBJECTS.map((page) => [page.relative, page]))(
        '%s lets Google show a full snippet and a large image',
        async (_relative, page) => {
            const metadata = await page.load();

            expect(metadata.robots, `${page.relative} declares no robots directives`).toBeTruthy();
            expect(metadata.robots).toMatchObject({
                index: true,
                follow: true,
                'max-snippet': -1,
                'max-image-preview': 'large',
                'max-video-preview': -1,
            });
        },
    );

    it.each(SUBJECTS.map((page) => [page.relative, page]))(
        '%s names the MIME type of its OG image',
        async (_relative, page) => {
            const metadata = await page.load();
            const [image] = metadata.openGraph.images;

            expect(image.type, `${page.relative} OG image has no og:image:type`).toMatch(/^image\//);
        },
    );

    /**
     * The no-upload claim has to survive truncation.
     *
     * Google truncates a snippet by pixel width and rewrites descriptions often,
     * so 155 characters is a conservative stand-in rather than a spec. What the
     * rule really protects is an ordering decision: the one sentence that
     * separates Resizo from iloveimg, tinypng and every other free image tool
     * belongs at the FRONT of the description, not behind a feature list.
     *
     * Measured against the built HTML, 18 of 19 pages already did this. The
     * homepage — the most valuable page on the site — did not: its claim began
     * at character 154 and the snippet cut it mid-word.
     *
     *   "…crop, and turn iPhone HEIC photos into JPG — w|ithout uploading anything."
     *
     * The pattern is deliberately loose about wording. The pages say it several
     * different ways ("without uploading", "on your own device", "nothing
     * leaving your computer", "without adding them to a server") and forcing one
     * phrase on all of them would make every snippet read the same.
     */
    const SNIPPET_BUDGET = 155;

    const NO_UPLOAD_CLAIM =
        /(?:no|not|never|without|nothing)[^.,;—]{0,40}(?:upload|uploading|leaving|leaves|server|install)|(?:on )?your own (?:device|computer)|in (?:your|this) browser/i;

    it.each(SUBJECTS.map((page) => [page.relative, page]))(
        '%s makes its no-upload claim before the snippet is cut',
        async (_relative, page) => {
            const metadata = await page.load();
            const description = metadata.description ?? '';
            const match = description.match(NO_UPLOAD_CLAIM);

            expect(
                match,
                `${page.relative} description never says the work stays on the device`,
            ).toBeTruthy();

            const endsAt = match.index + match[0].length;
            expect(
                endsAt,
                `${page.relative}: "${match[0]}" ends at character ${endsAt}, past the ` +
                    `${SNIPPET_BUDGET}-character snippet budget — move the claim to the front`,
            ).toBeLessThanOrEqual(SNIPPET_BUDGET);
        },
    );

    /**
     * The one page that must NOT be indexed. buildMetadata now sets robots for
     * everyone, so the check that matters is that a page saying otherwise still
     * wins.
     */
    it('leaves the 404 page noindex', async () => {
        const { metadata } = await import('@/app/not-found');

        expect(metadata.robots.index).toBe(false);
        expect(metadata.robots['max-snippet']).toBeUndefined();
    });

    /**
     * The root layout cannot be imported here — next/font only exists inside
     * Next's compiler — so its half is checked as source. What matters is that
     * it points at the same object rather than restating the directives, which
     * is how the two ended up disagreeing in the first place.
     */
    it('gives the root layout the same object rather than a second copy', () => {
        const source = fs.readFileSync(path.join(APP, 'layout.js'), 'utf8');

        expect(source).toMatch(/robots:\s*INDEXABLE_ROBOTS/);

        // Comments are stripped first: the file explains at length which
        // mistake was removed, and naming it must not trip the check for it.
        const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

        expect(code, 'the layout and buildMetadata must share one object').not.toMatch(
            /['"]max-snippet['"]/,
        );

        // A googleBot block alongside the top-level one is a second copy of the
        // same statement: Google reads <meta name="robots"> too, and the two
        // only ever drift apart — while every non-Google crawler reads neither.
        expect(code).not.toMatch(/googleBot/);
    });
});
