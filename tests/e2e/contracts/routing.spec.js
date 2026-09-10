const { expect, test } = require('../fixtures/resizo');

/**
 * The intent pages, served by one dynamic route from a real production build.
 *
 * Unit tests prove the registry and the renderer; what only a built server
 * can prove is routing: that a static tool route still wins over the [slug]
 * segment beside it, that every intent in the sitemap is actually served
 * with its own canonical, and that a slug nobody registered is a 404. The
 * hydration of the lazily loaded tool on an intent page is a flow, in
 * tests/e2e/flows/convert.spec.js.
 */
const noSlash = (url) => (url ?? '').replace(/\/$/, '');

function attr(html, tagRegex, name) {
    const tag = html.match(tagRegex)?.[0];
    if (!tag) return null;
    return tag.match(new RegExp(`${name}="([^"]*)"`))?.[1] ?? null;
}

function jsonLd(html) {
    return [...html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/g)]
        .flatMap(([, json]) => JSON.parse(json));
}

test('every URL in the sitemap is served with its own canonical, one h1 and valid JSON-LD', async ({ request }) => {
    const xml = await (await request.get('/sitemap.xml')).text();
    const urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(([, url]) => url);
    expect(urls.length).toBeGreaterThanOrEqual(19);

    for (const url of urls) {
        const pathname = new URL(url).pathname;
        const res = await request.get(pathname);
        expect(res.status(), `${pathname} status`).toBe(200);

        const html = await res.text();
        expect(noSlash(attr(html, /<link[^>]*rel="canonical"[^>]*>/, 'href')), `${pathname} canonical`).toBe(noSlash(url));
        expect(html.match(/<h1[\s>]/g) ?? [], `${pathname} h1 count`).toHaveLength(1);
        expect(() => jsonLd(html), `${pathname} JSON-LD`).not.toThrow();
        expect(attr(html, /<meta[^>]*name="robots"[^>]*>/, 'content') ?? '', `${pathname} robots`).not.toContain('noindex');
    }
});

test('a static tool route still wins over the dynamic segment beside it', async ({ request }) => {
    const html = await (await request.get('/resize')).text();
    expect(html).toContain('Resize an Image Online');
    expect(html).not.toContain('Resize a JPG</h1>');
});

test('an intent page renders its own headline, preset and structured data', async ({ request }) => {
    const html = await (await request.get('/compress-image-to-100kb')).text();

    expect(html).toMatch(/<h1[^>]*>Compress an Image to 100 KB<\/h1>/);
    expect(html).toContain('value="100"');
    expect(jsonLd(html).map((node) => node['@type'])).toEqual(['SoftwareApplication', 'BreadcrumbList', 'HowTo', 'FAQPage']);
    expect(jsonLd(html)[0].name).toBe('Compress Image to 100 KB');
});

test('a slug the registry does not know is a 404 that stays out of the index', async ({ request }) => {
    const res = await request.get('/png-to-tiff');
    expect(res.status()).toBe(404);

    const html = await res.text();
    expect(attr(html, /<meta[^>]*name="robots"[^>]*>/, 'content') ?? '').toContain('noindex');
});
