const path = require('node:path');

const { test, expect } = require('../e2e/fixtures/resizo');
const { inspect } = require('../e2e/helpers/output');

/**
 * IS THE DEPLOYMENT ALIVE, AND IS IT THE ONE WE THINK IT IS?
 *
 * Everything else in this repository tests the code. This tests the *site* —
 * the thing at `baseURL`, already serving people, whose build finished
 * somewhere else. The suite starts no server (playwright.production.config.js
 * has no `webServer`), so it cannot pass by accidentally testing a local build.
 *
 * It is small on purpose. A deploy check that takes four minutes gets run once
 * and then skipped, and the failures it would have caught are all in the first
 * ten seconds: the wrong commit shipped, a page 500s, the sitemap points at the
 * preview host, robots.txt got a Disallow it should not have. Depth belongs in
 * the E2E suite, which runs against a build before it is a deployment.
 *
 * THE SHARED FIXTURE IS DELIBERATE. `test` here is the one from
 * tests/e2e/fixtures/resizo.js, so the no-upload guard and the browser-error
 * guard come along for free — and because `baseURL` is the production origin,
 * the guard is now proving something it cannot prove locally: that the live
 * site, with whatever a deploy added to it, still makes no request off its own
 * origin while a real photograph is being processed. A test that opens no page
 * pays nothing for the guards; the fixture returns early when the request log
 * is empty and nothing was processed.
 *
 * THE COMMIT IS NEVER ASSUMED. `EXPECTED_PRODUCTION_SHA` is opt-in because the
 * deployed SHA is not the checkout's SHA — a deploy is asynchronous, a rollback
 * moves it backwards, and a self-hosted build reports "dev". Unset, the run
 * reports what it found and asserts only that the endpoint answered. Set, it is
 * a promotion gate.
 */

/** The small committed PNG. 993 bytes: one real image through the live tool, not a load test. */
const SAMPLE = path.join(__dirname, '..', 'e2e', 'fixtures', 'assets', 'sample-96x64.png');

/**
 * The five pages that would each fail differently, and so cover different
 * machinery: the homepage, the directory, a core tool, an intent page served by
 * the `[slug]` route out of the registry, and one of the tools added in the
 * September expansion — the last of which is how "the deploy is older than you
 * think" shows up as a 404 rather than as a green run.
 */
const PAGES = ['/', '/tools', '/compress', '/compress-image-to-100kb', '/change-image-dpi'];

const originOf = (url) => new URL(url).origin;

/** `/` canonicalises to the bare origin; every other route to origin + path. */
const canonicalFor = (baseURL, route) => (route === '/' ? originOf(baseURL) : `${originOf(baseURL)}${route}`);

const noSlash = (url) => (url ?? '').replace(/\/$/, '');

function tags(html, tagRegex) {
    return html.match(tagRegex) ?? [];
}

function attrOf(tag, name) {
    return tag?.match(new RegExp(`${name}="([^"]*)"`))?.[1] ?? null;
}

const CANONICAL = /<link[^>]*rel="canonical"[^>]*>/g;
const ROBOTS_META = /<meta[^>]*name="robots"[^>]*>/g;

function jsonLdBlocks(html) {
    return [...html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/g)].map(([, json]) => json);
}

test('the deployment answers /api/health, and reports the commit it is running', async ({ request }) => {
    const res = await request.get('/api/health');
    expect(res.status(), '/api/health did not answer 200 — the deployment is not serving').toBe(200);
    expect(res.headers()['content-type'], '/api/health is not JSON').toContain('application/json');

    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(typeof body.time, '/api/health reported no time').toBe('string');

    const commit = body.commit;
    expect(typeof commit, '/api/health reported no commit').toBe('string');
    expect(commit.length, '/api/health reported an empty commit').toBeGreaterThan(0);

    // Printed and annotated both ways on purpose: the console line is what a
    // person watching the run reads, the annotation is what the HTML and
    // GitHub reporters carry into the artefact after the log has scrolled away.
    console.log(`production commit: ${commit}`);
    test.info().annotations.push({ type: 'production-commit', description: commit });

    // Opt-in. Unset, this run reports the commit rather than judging it — the
    // deployed SHA is not the checked-out SHA (see the file header).
    const expected = process.env.EXPECTED_PRODUCTION_SHA;
    if (expected) {
        expect(
            commit.startsWith(expected),
            `the deployment is running commit ${commit}, but EXPECTED_PRODUCTION_SHA asked for ${expected}`,
        ).toBe(true);
    }
});

for (const route of PAGES) {
    test(`${route} is served as an indexable page with its own canonical`, async ({ request, baseURL }) => {
        const res = await request.get(route);
        expect(res.status(), `${route} did not answer 200`).toBe(200);

        const html = await res.text();

        // Exactly one: a second canonical is not a stronger signal, it is an
        // ambiguous one, and Google resolves the ambiguity itself.
        const canonicals = tags(html, CANONICAL);
        expect(canonicals, `${route} must carry exactly one canonical`).toHaveLength(1);
        expect(noSlash(attrOf(canonicals[0], 'href')), `${route} canonical`).toBe(canonicalFor(baseURL, route));

        const robots = tags(html, ROBOTS_META);
        expect(robots, `${route} must carry exactly one robots meta`).toHaveLength(1);
        const directives = attrOf(robots[0], 'content') ?? '';
        expect(directives, `${route} asks not to be indexed`).not.toContain('noindex');
        expect(directives, `${route} does not ask to be indexed`).toMatch(/\bindex\b/);

        expect(html.match(/<h1[\s>]/g) ?? [], `${route} h1 count`).toHaveLength(1);

        const blocks = jsonLdBlocks(html);
        expect(blocks.length, `${route} renders no JSON-LD`).toBeGreaterThan(0);
        for (const json of blocks) {
            expect(() => JSON.parse(json), `${route} renders JSON-LD that does not parse`).not.toThrow();
        }
    });
}

test('the sitemap advertises production URLs only', async ({ request, baseURL }) => {
    const res = await request.get('/sitemap.xml');
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type'], '/sitemap.xml is not served as XML').toContain('xml');

    const xml = await res.text();
    const urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(([, url]) => url);

    // The self-check. An empty sitemap satisfies every assertion below it
    // vacuously, and an empty sitemap is itself the failure.
    expect(urls.length, 'the sitemap lists no URL at all').toBeGreaterThan(0);

    const origin = originOf(baseURL);
    for (const url of urls) {
        // A deploy that leaks a preview host into the sitemap invites Google to
        // index the preview and treat the real site as its duplicate.
        expect(url.startsWith(`${origin}/`), `${url} is not on the deployment's own origin`).toBe(true);
        expect(url, `${url} carries a query string`).not.toContain('?');
        expect(url, `${url} carries a fragment`).not.toContain('#');
    }

    expect(new Set(urls).size, 'a URL is listed twice').toBe(urls.length);

    // Three URLs that only exist if the registries reached the deployment: the
    // directory, the guides index, and one September tool.
    for (const route of ['/tools', '/guides', '/change-image-dpi']) {
        expect(urls, `${route} is missing from the deployed sitemap`).toContain(`${origin}${route}`);
    }
});

test('robots.txt opens the site to every crawler and closes the API', async ({ request, baseURL }) => {
    const res = await request.get('/robots.txt');
    expect(res.status()).toBe(200);

    const text = await res.text();
    expect(text.length, 'robots.txt is empty').toBeGreaterThan(20);

    // A group naming one crawler REPLACES the wildcard group for that crawler
    // rather than adding to it, so there has to be exactly one, and it has to
    // be the wildcard.
    const agents = [...text.matchAll(/^user-agent:\s*(.+)$/gim)].map(([, agent]) => agent.trim());
    expect(agents, 'robots.txt should name one group, the wildcard').toEqual(['*']);

    // Field names are case-insensitive per the spec, and Next writes
    // "User-Agent" where the spec's own examples write "User-agent".
    expect(text, 'robots.txt does not allow the site').toMatch(/^allow:\s*\/$/im);
    expect(text, 'robots.txt does not disallow /api/').toMatch(/^disallow:\s*\/api\/$/im);

    const sitemap = text.match(/^sitemap:\s*(\S+)$/im)?.[1];
    expect(sitemap, 'robots.txt names no sitemap').toBe(`${originOf(baseURL)}/sitemap.xml`);
});

test('a route nobody registered is a 404 that asks to stay out of the index', async ({ request }) => {
    // Timestamped so no cache, anywhere between here and the origin, can have
    // an answer for it already.
    const res = await request.get(`/no-such-page-${Date.now()}`);
    expect(res.status(), 'an unknown route did not 404 — something is serving a catch-all').toBe(404);

    const html = await res.text();
    const robots = tags(html, ROBOTS_META);

    expect(robots.length, 'the 404 page sends no robots meta').toBeGreaterThan(0);
    for (const tag of robots) {
        expect(attrOf(tag, 'content') ?? '', 'a 404 that does not say noindex').toContain('noindex');
    }
});

/**
 * The one flow, tagged so a runner without a browser can exclude it with
 * `--grep-invert @browser` and still get every HTTP check above.
 *
 * A 200 on /resize proves the HTML shipped. It does not prove the WASM codecs
 * were deployed beside it, that the CSP on the live response still permits
 * `wasm-unsafe-eval`, or that the worker chunk resolves — and each of those is
 * a deployment fact no build-time test can reach. So one real image goes in
 * and the bytes that come out are handed to libvips, which is not the product,
 * and asked what they are.
 */
test('a real image goes through /resize on the live site', { tag: '@browser' }, async ({ tool }) => {
    const saved = await tool.process({
        route: '/resize',
        file: SAMPLE,
        // /resize adopts the source's own dimensions on intake, so the width is
        // set after the file is in, not before.
        after: (page) => page.getByLabel('Width (px)', { exact: true }).fill('48'),
        button: /resize image/i,
    });

    const out = await inspect(saved.file);
    expect(out.format, 'the live tool returned a format nobody asked for').toBe('png');
    expect(out.width, 'the live tool returned the wrong width').toBe(48);
    expect(out.height, '48 of 96 wide should halve the height too').toBe(32);
});

/**
 * Discovery on the live site: the family is linked from the directory and
 * the header in plain HTML, and a tool page states what it changes. Read
 * over HTTP, so a crawler's view is what is checked.
 */
test('every tool and intent the sitemap advertises is linked from /tools', async ({ request }) => {
    const xml = await (await request.get('/sitemap.xml')).text();
    const family = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)]
        .map(([, url]) => new URL(url).pathname)
        .filter((path) => !['/', '/about', '/tools', '/guides'].includes(path) && !path.startsWith('/guides/'));
    const html = await (await request.get('/tools')).text();
    const main = html.slice(html.indexOf('<main'));
    const links = new Set([...main.matchAll(/<a\s[^>]*href="([^"#?]+)/g)].map(([, href]) => href));

    expect(family.length).toBeGreaterThanOrEqual(25);
    for (const path of family) expect(links.has(path), `${path} is linked from /tools`).toBe(true);
});

test('the header links every tool with a page, menu closed, without JavaScript', async ({ request }) => {
    const html = await (await request.get('/about')).text();
    const mainAt = html.indexOf('<main');
    expect(mainAt, 'the page has a main landmark, so the header can be cut out before it').toBeGreaterThan(0);
    const header = html.slice(0, mainAt);
    // All ten tools with a page of their own — the four that left the bar are
    // the ones the Tools menu exists to carry — plus the directory and the guides.
    for (const path of ['/resize', '/compress', '/convert', '/crop', '/heic', '/signature-resizer', '/change-image-dpi', '/remove-image-metadata', '/jpg-to-pdf', '/merge-pdf', '/tools', '/guides']) {
        expect(header.includes(`href="${path}"`), `${path} in the header HTML`).toBe(true);
    }
});

test('a tool page states its direct answer and what it changes', async ({ page, request }) => {
    const html = await (await request.get('/change-image-dpi')).text();
    expect(html).toContain('What this tool changes');
    expect(html).toContain('Processed on your device');
    // The behaviour is a definition list: read it as text, term then definition.
    const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    expect(text, 'the DPI tool says the pixels are copied, not re-encoded').toMatch(/Pixels Copied byte for byte/);

    // The direct answer is the paragraph under the panel — the element the E2E contracts locate.
    await page.goto('/change-image-dpi');
    const answer = page.locator('div:has(> section[aria-label$="tool"]) + p');
    await expect(answer).toBeVisible();
    expect((await answer.innerText()).length, 'a paragraph, not a slogan').toBeGreaterThan(200);
});

/**
 * The newest route, checked the way "the deploy is older than you think" shows
 * up: as a 404 rather than as a green run.
 *
 * /change-image-dpi above already plays that part for the September expansion,
 * and this one plays it for the passport release. It is deliberately the
 * cheapest possible check — the headline proves the route resolved and
 * rendered its own tool rather than a shell, and the trust strip proves the
 * four promises the architecture makes reached the live HTML rather than only
 * the local build. Depth belongs in the E2E suite, which runs against a build
 * before it is a deployment.
 *
 * THIS FAILS UNTIL /passport-photo IS DEPLOYED, and that is the intended
 * reading of a red line here: the route is in the repo and not yet on the
 * site. It is not a reason to soften the assertion.
 */
test('/passport-photo is live, with its headline and the trust strip', async ({ request }) => {
    const res = await request.get('/passport-photo');
    expect(res.status(), '/passport-photo did not answer 200 — the deploy predates the passport tool').toBe(200);

    const html = await res.text();

    const headline = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)?.[1]?.replace(/<[^>]+>/g, '').trim();
    expect(headline, 'the passport route rendered no h1').toBeTruthy();
    expect(headline, 'the h1 is not the passport tool’s').toMatch(/Passport or ID Photo/);

    // The four facts the no-upload architecture actually earns, stated once in
    // components/tools/TrustStrip.js and composed by every tool page.
    for (const promise of ['Processed on your device', 'No image upload', 'No account', 'No watermark']) {
        expect(html.includes(promise), `the trust strip is missing "${promise}"`).toBe(true);
    }
});

/**
 * The newest route again, one release on. The same cheapest-possible check as
 * /passport-photo above and for the same reason: a 404 here says the deploy
 * predates the batch compressor, which is the one thing a smoke run against
 * production can tell you that a local build never will.
 *
 * THIS FAILS UNTIL /bulk-image-compressor IS DEPLOYED. That is the intended
 * reading of a red line, not a reason to soften the assertion.
 */
test('/bulk-image-compressor is live, with its headline', async ({ request }) => {
    const res = await request.get('/bulk-image-compressor');
    expect(
        res.status(),
        '/bulk-image-compressor did not answer 200 — the deploy predates the batch compressor',
    ).toBe(200);

    const html = await res.text();

    const headline = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)?.[1]?.replace(/<[^>]+>/g, '').trim();
    expect(headline, 'the batch compressor route rendered no h1').toBeTruthy();
    expect(headline, 'the h1 is not the batch compressor’s').toMatch(/Compress Many Images to a Maximum File Size/);
});

/**
 * The second product on the batch platform, checked the same cheap way as the
 * compressor above it. The two routes are near neighbours in the tree and share
 * every piece of their runner, which is exactly why both are asked for: a
 * deploy that shipped one and not the other answers 200 here and 404 there.
 *
 * THIS FAILS UNTIL /bulk-image-converter IS DEPLOYED. That is the intended
 * reading of a red line, not a reason to soften the assertion.
 */
test('/bulk-image-converter is live, with its headline', async ({ request }) => {
    const res = await request.get('/bulk-image-converter');
    expect(
        res.status(),
        '/bulk-image-converter did not answer 200 — the deploy predates the batch converter',
    ).toBe(200);

    const html = await res.text();

    const headline = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)?.[1]?.replace(/<[^>]+>/g, '').trim();
    expect(headline, 'the batch converter route rendered no h1').toBeTruthy();
    expect(headline, 'the h1 is not the batch converter’s').toMatch(/Convert Many Images to One Format/);
});

/**
 * The requirement fitter's general case, checked the same cheap way. It shares
 * the fit operation, the crop frame and the byte search with /passport-photo,
 * so a deploy that carried one and not the other is the failure this catches:
 * that route answers 200 above while this one 404s.
 *
 * THIS FAILS UNTIL /image-size-fitter IS DEPLOYED. That is the intended
 * reading of a red line, not a reason to soften the assertion.
 */
test('/image-size-fitter is live, with its headline', async ({ request }) => {
    const res = await request.get('/image-size-fitter');
    expect(
        res.status(),
        '/image-size-fitter did not answer 200 — the deploy predates the size fitter',
    ).toBe(200);

    const html = await res.text();

    const headline = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)?.[1]?.replace(/<[^>]+>/g, '').trim();
    expect(headline, 'the size fitter route rendered no h1').toBeTruthy();
    expect(headline, 'the h1 is not the size fitter’s').toMatch(/Fit an Image to Exact Dimensions and File Size/);
});

/**
 * The print sheet, checked the same cheap way as the three routes above it. It
 * is the one tool whose output is a sheet of paper rather than a picture, and
 * it is the last of the forms family to reach the site, so a deploy that
 * carried the other three and not this one is exactly the gap this catches.
 *
 * THIS FAILS UNTIL /passport-photo-print IS DEPLOYED. That is the intended
 * reading of a red line, not a reason to soften the assertion.
 */
test('/passport-photo-print is live, with its headline', async ({ request }) => {
    const res = await request.get('/passport-photo-print');
    expect(
        res.status(),
        '/passport-photo-print did not answer 200 — the deploy predates the print sheet',
    ).toBe(200);

    const html = await res.text();

    const headline = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)?.[1]?.replace(/<[^>]+>/g, '').trim();
    expect(headline, 'the print sheet route rendered no h1').toBeTruthy();
    expect(headline, 'the h1 is not the print sheet’s').toMatch(/Create a Passport Photo Print Sheet/);
});

/**
 * The metadata viewer, checked the same cheap way. It is the one route on the
 * site that produces no file, so the only thing a smoke test can ask of it is
 * that the page resolved and is the page it claims to be.
 *
 * THIS FAILS UNTIL /image-metadata-viewer IS DEPLOYED. That is the intended
 * reading of a red line, not a reason to soften the assertion.
 */
test('/image-metadata-viewer is live, with its headline', async ({ request }) => {
    const res = await request.get('/image-metadata-viewer');
    expect(
        res.status(),
        '/image-metadata-viewer did not answer 200 — the deploy predates the metadata viewer',
    ).toBe(200);

    const html = await res.text();

    const headline = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)?.[1]?.replace(/<[^>]+>/g, '').trim();
    expect(headline, 'the metadata viewer route rendered no h1').toBeTruthy();
    expect(headline, 'the h1 is not the metadata viewer’s').toMatch(/View Image Metadata/);
});

/**
 * The favicon package, checked the same cheap way. Everything worth asserting
 * about it — seven files, an .ico a browser can decode, a manifest that parses
 * — needs a browser and a real logo, and tests/e2e/flows/favicon.spec.js does
 * all of it. What a request smoke test can add is that the route resolved and
 * is the page it claims to be.
 *
 * THIS FAILS UNTIL /favicon-generator IS DEPLOYED. That is the intended reading
 * of a red line, not a reason to soften the assertion.
 */
test('/favicon-generator is live, with its headline', async ({ request }) => {
    const res = await request.get('/favicon-generator');
    expect(
        res.status(),
        '/favicon-generator did not answer 200 — the deploy predates the favicon generator',
    ).toBe(200);

    const html = await res.text();

    const headline = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)?.[1]?.replace(/<[^>]+>/g, '').trim();
    expect(headline, 'the favicon generator route rendered no h1').toBeTruthy();
    expect(headline, 'the h1 is not the favicon generator’s').toMatch(/Generate Favicons and App Icons/);
});
