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

test('no ad script loads on any page — the site carries no advertising', async ({ request }) => {
    for (const path of ['/', '/resize', '/privacy', '/terms']) {
        const html = await (await request.get(path)).text();
        expect(html, `${path} must not carry an ad tag`).not.toContain('adsbygoogle');
        expect(html, `${path} must not reference the ad network`).not.toContain('googlesyndication');
    }
});
