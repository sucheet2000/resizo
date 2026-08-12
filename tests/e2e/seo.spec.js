const { expect, test } = require('@playwright/test');

/**
 * The canonical bug that de-indexed the whole site was a single inherited
 * layout tag, invisible in unit tests. These assert the RENDERED HTML: every
 * page owns its canonical, its og:url, and at least one parseable JSON-LD block.
 */
const PAGES = [
    { path: '/', canonical: 'https://www.resizo.net' },
    { path: '/resize', canonical: 'https://www.resizo.net/resize' },
    { path: '/compress', canonical: 'https://www.resizo.net/compress' },
    { path: '/heic-to-jpg', canonical: 'https://www.resizo.net/heic-to-jpg' },
];

function attr(html, tagRegex, name) {
    const tag = html.match(tagRegex)?.[0];
    if (!tag) return null;
    return tag.match(new RegExp(`${name}="([^"]*)"`))?.[1] ?? null;
}

const noSlash = (url) => (url ?? '').replace(/\/$/, '');

for (const { path, canonical } of PAGES) {
    test(`${path} emits its own canonical, og:url and valid JSON-LD`, async ({ request }) => {
        const res = await request.get(path);
        expect(res.status()).toBe(200);
        const html = await res.text();

        const canonicalLinks = html.match(/<link[^>]*rel="canonical"[^>]*>/g) ?? [];
        expect(canonicalLinks).toHaveLength(1);
        expect(noSlash(attr(html, /<link[^>]*rel="canonical"[^>]*>/, 'href'))).toBe(canonical);

        expect(noSlash(attr(html, /<meta[^>]*property="og:url"[^>]*>/, 'content'))).toBe(canonical);

        const ldBlocks = [...html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/g)];
        expect(ldBlocks.length).toBeGreaterThan(0);
        for (const [, json] of ldBlocks) {
            expect(() => JSON.parse(json)).not.toThrow();
        }
    });
}

test('every page has exactly one h1', async ({ request }) => {
    for (const { path } of PAGES) {
        const html = await (await request.get(path)).text();
        const h1s = html.match(/<h1[\s>]/g) ?? [];
        expect(h1s, `${path} h1 count`).toHaveLength(1);
    }
});

/**
 * The snippet is the pitch. Without these directives Google clips it to its own
 * short default and shows no thumbnail, which is how a page can sit at position
 * 9 on a million impressions and be passed over.
 */
test('every page lets Google show a full snippet and a large image', async ({ request }) => {
    for (const { path } of PAGES) {
        const html = await (await request.get(path)).text();

        const tags = html.match(/<meta[^>]*name="robots"[^>]*>/g) ?? [];
        expect(tags, `${path} should carry exactly one robots meta`).toHaveLength(1);

        const content = attr(html, /<meta[^>]*name="robots"[^>]*>/, 'content') ?? '';
        expect(content, `${path} robots`).not.toContain('noindex');
        expect(content, `${path} robots`).toContain('index');
        expect(content, `${path} robots`).toContain('follow');
        expect(content, `${path} robots`).toContain('max-snippet:-1');
        expect(content, `${path} robots`).toContain('max-image-preview:large');
        expect(content, `${path} robots`).toContain('max-video-preview:-1');

        // One statement, read by every crawler. A googlebot-specific copy left
        // Bing and the rest with a clipped snippet and could drift from this.
        expect(html, `${path} carries a second, googlebot-only copy`).not.toMatch(
            /name="googlebot"/i,
        );

        expect(
            attr(html, /<meta[^>]*property="og:image:type"[^>]*>/, 'content'),
            `${path} og:image:type`,
        ).toMatch(/^image\//);
    }
});

test('a page that must stay out of the index still says noindex', async ({ request }) => {
    const html = await (await request.get('/no-such-page-here')).text();
    const content = attr(html, /<meta[^>]*name="robots"[^>]*>/, 'content') ?? '';

    expect(content).toContain('noindex');
    expect(content).not.toContain('max-snippet');
});

/**
 * Google indexes mobile-first: copy hidden on a phone does not exist for the
 * crawler that ranks the page. The intro used to be `hidden … sm:block`.
 */
test('the tool intro is on the page for a phone, below the panel', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto('/jpg-to-webp');

    const intro = page.locator('header:has(h1) + p');
    const panel = page.locator('section[aria-label$="tool"]');

    await expect(intro).toBeVisible();

    const introTop = await intro.evaluate((el) => el.getBoundingClientRect().top);
    const panelBottom = await panel.evaluate((el) => el.getBoundingClientRect().bottom);
    expect(introTop, 'on a phone the intro is painted after the tool').toBeGreaterThan(panelBottom);

    // And the tool is still the first thing painted.
    const dropTop = await page
        .locator('.checkerboard')
        .first()
        .evaluate((el) => el.getBoundingClientRect().top);
    expect(dropTop).toBeLessThan(800);
});

test('the tool intro sits under the headline on a desktop', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/jpg-to-webp');

    const intro = page.locator('header:has(h1) + p');
    await expect(intro).toBeVisible();

    const introBottom = await intro.evaluate((el) => el.getBoundingClientRect().bottom);
    const panelTop = await page
        .locator('section[aria-label$="tool"]')
        .evaluate((el) => el.getBoundingClientRect().top);

    expect(introBottom).toBeLessThan(panelTop);
});

/**
 * THE DIRECT ANSWER, IN PIXELS.
 *
 * The paragraph that a featured snippet can quote has to be on the phone screen
 * — it is checked in the unit suite for a `hidden` class, but only a real
 * browser can prove it is laid out, has height, and did not push the drop zone
 * off the fold on the way.
 */
const ANSWER_SELECTOR = 'div:has(> section[aria-label$="tool"]) + p';

test('the direct answer is rendered on a phone, under the panel', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 640 });
    await page.goto('/compress-image-to-100kb');

    const answer = page.locator(ANSWER_SELECTOR);
    await expect(answer).toBeVisible();
    await expect(answer).toContainText('On Resizo');

    const box = await answer.boundingBox();
    expect(box.height, 'a collapsed paragraph is not a snippet').toBeGreaterThan(20);

    const panelBottom = await page
        .locator('section[aria-label$="tool"]')
        .evaluate((el) => el.getBoundingClientRect().bottom);
    expect(box.y, 'the answer belongs below the tool, never in front of it').toBeGreaterThan(panelBottom - 1);

    // The tool is still the hero: the drop zone stays on the first screen.
    const dropTop = await page
        .locator('.checkerboard')
        .first()
        .evaluate((el) => el.getBoundingClientRect().top);
    expect(dropTop, 'the answer must not push the drop zone off a 640px phone').toBeLessThan(640);
});

test('every tool route carries its own direct answer', async ({ request }) => {
    const seen = new Map();

    for (const path of ['/resize', '/compress', '/convert', '/crop', '/heic', '/resize-jpg', '/png-to-webp']) {
        const html = await (await request.get(path)).text();
        const match = html.match(/On Resizo[^<]{40,}/);

        expect(match, `${path} renders no direct answer in its HTML`).not.toBeNull();
        expect(seen.has(match[0]), `${path} repeats the answer from ${seen.get(match[0])}`).toBe(false);
        seen.set(match[0], path);
    }
});

test('no ad script loads on any page — the site carries no advertising', async ({ request }) => {
    for (const path of ['/', '/resize', '/about']) {
        const html = await (await request.get(path)).text();
        expect(html, `${path} must not carry an ad tag`).not.toContain('adsbygoogle');
        expect(html, `${path} must not reference the ad network`).not.toContain('googlesyndication');
    }
});
