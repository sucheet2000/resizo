const { expect, test } = require('@playwright/test');

/**
 * WHAT A CRAWLER ACTUALLY GETS, FROM A REAL BUILD
 *
 * The unit suite proves what robots.js and sitemap.js return. This proves what
 * the server sends, which is a different question and the one that has bitten
 * this site before: metadata inherits shallowly, a static route can be shadowed
 * by a dynamic one, and a canonical is a string the framework assembles at
 * render time. None of that is visible from the source of the route file.
 *
 * The three things checked here are the three ways a crawl goes wrong.
 *
 * 1. Query strings. Every one of these routes is reachable with parameters
 *    nobody here put there — a utm_ tag from a shared link, a tracking suffix
 *    from an aggregator, a "?page=2" a crawler invented. Each is a distinct URL
 *    to a crawler, and each is served the same page, so unless the canonical
 *    points at the clean route the site publishes an unbounded number of
 *    duplicates of its ten busiest pages.
 *
 * 2. robots.txt as text. A group naming one crawler REPLACES the wildcard group
 *    for it rather than adding to it, so the file is asserted to name no bot at
 *    all. The field name is matched case-insensitively because robots.txt says
 *    it is case-insensitive and Next writes "User-Agent".
 *
 * 3. The sitemap as a promise. Every URL in it is a request the site asked a
 *    crawler to make. One that 404s or comes back noindex spends someone's
 *    crawl budget on nothing and tells Search Console the file is unreliable.
 */

const noSlash = (url) => (url ?? '').replace(/\/$/, '');

function attr(html, tagRegex, name) {
    const tag = html.match(tagRegex)?.[0];
    if (!tag) return null;
    return tag.match(new RegExp(`${name}="([^"]*)"`))?.[1] ?? null;
}

const canonicalOf = (html) => noSlash(attr(html, /<link[^>]*rel="canonical"[^>]*>/, 'href'));

const metaRobotsOf = (html) => attr(html, /<meta[^>]*name="robots"[^>]*>/, 'content');

/**
 * The parameters a page is reached with in the wild: a tool setting somebody
 * pasted, a pair of dimensions, a campaign tag, and a pagination parameter on a
 * directory that has exactly one page.
 */
const QUERY_URLS = [
    { url: '/compress?target=73kb', route: '/compress' },
    { url: '/resize?w=800&h=600', route: '/resize' },
    { url: '/compress-image-to-20kb?utm_source=x', route: '/compress-image-to-20kb' },
    { url: '/tools?page=2', route: '/tools' },
];

const SITE = 'https://www.resizo.net';

test('a URL reached with a query string canonicalises to the route without it', async ({ request }) => {
    for (const { url, route } of QUERY_URLS) {
        const res = await request.get(url);
        expect(res.status(), `${url} status`).toBe(200);

        const html = await res.text();
        expect(canonicalOf(html), `${url} must canonicalise to ${route}`).toBe(`${SITE}${route}`);

        // A parameter must never end up inside the canonical: that would make
        // the duplicate self-canonical and publish it as a page of its own.
        expect(canonicalOf(html), `${url} canonical carries the query string`).not.toContain('?');
    }
});

test('robots.txt is one wildcard group and names no crawler', async ({ request }) => {
    const res = await request.get('/robots.txt');
    expect(res.status()).toBe(200);

    const text = await res.text();
    expect(text.length, 'robots.txt is empty').toBeGreaterThan(20);

    // Field names are case-insensitive in robots.txt, and Next writes
    // "User-Agent" where the spec's examples write "User-agent".
    expect(text).toMatch(/^user-agent:\s*\*$/im);
    expect(text).toMatch(/^allow:\s*\/$/im);
    expect(text).toMatch(/^disallow:\s*\/api\/$/im);
    expect(text).toMatch(/^sitemap:\s*https:\/\/www\.resizo\.net\/sitemap\.xml$/im);

    // One named group is a policy for that crawler and nothing else on the
    // site can show it. These two are the ones a rule would most likely name.
    expect(text, 'a bot-specific group replaces the wildcard one for that bot').not.toContain('OAI-SearchBot');
    expect(text).not.toContain('GPTBot');

    const agents = [...text.matchAll(/^user-agent:\s*(.+)$/gim)].map(([, agent]) => agent.trim());
    expect(agents, 'robots.txt names a crawler').toEqual(['*']);
});

test('the sitemap advertises canonical URLs only', async ({ request }) => {
    const res = await request.get('/sitemap.xml');
    expect(res.status()).toBe(200);

    const xml = await res.text();
    const urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(([, url]) => url);

    expect(urls.length, 'the sitemap is empty').toBeGreaterThanOrEqual(19);

    for (const url of urls) {
        expect(url.startsWith(`${SITE}/`), `${url} is not on the canonical host`).toBe(true);
        expect(url, `${url} carries a query string`).not.toContain('?');
        expect(url, `${url} carries a fragment`).not.toContain('#');
    }

    expect(new Set(urls).size, 'a URL is listed twice').toBe(urls.length);
});

test('every URL in the sitemap is served and asks to be indexed', async ({ request }) => {
    const xml = await (await request.get('/sitemap.xml')).text();
    const urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(([, url]) => url);

    expect(urls.length).toBeGreaterThanOrEqual(19);

    for (const url of urls) {
        const pathname = new URL(url).pathname;
        const res = await request.get(pathname);
        expect(res.status(), `${pathname} is in the sitemap and does not resolve`).toBe(200);

        const html = await res.text();
        const robots = metaRobotsOf(html) ?? '';

        expect(robots, `${pathname} sends no meta robots`).not.toBe('');
        expect(robots, `${pathname} is advertised in the sitemap and asks not to be indexed`).not.toContain('noindex');
        expect(robots, `${pathname} does not ask to be indexed`).toMatch(/\bindex\b/);
        expect(canonicalOf(html), `${pathname} canonical`).toBe(noSlash(url));
    }
});
