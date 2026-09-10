const { test, expect } = require('../fixtures/resizo');

/**
 * PRODUCT DISCOVERY, AS A CRAWLER AND A PERSON FIND IT.
 *
 * The family has to be reachable three ways at once: as plain <a> links in
 * the server-rendered HTML (a crawler executes nothing), through a menu a
 * keyboard can open and close, and on a phone. These read the built HTML
 * over HTTP for the first, drive the real page for the other two, and
 * assert semantic contracts — roles, names, hrefs — never exact prose.
 */
const SITE = 'https://www.resizo.net';

/** The tool and intent paths the sitemap advertises: the family, from the build itself. */
async function familyPaths(request) {
    const xml = await (await request.get('/sitemap.xml')).text();
    return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)]
        .map(([, url]) => new URL(url).pathname)
        .filter((path) => !['/', '/about', '/tools', '/guides'].includes(path) && !path.startsWith('/guides/'));
}

/** The direct answer under the panel — the same element seo.spec.js measures on a phone. */
const ANSWER_SELECTOR = 'div:has(> section[aria-label$="tool"]) + p';

const linksIn = (html) => new Set([...html.matchAll(/<a\s[^>]*href="([^"#?]+)/g)].map(([, href]) => href));

test('the header carries three primary tools and a Tools menu whose links exist without JavaScript', async ({ request }) => {
    const html = await (await request.get('/about')).text();
    const header = html.slice(0, html.indexOf('<main'));
    const links = linksIn(header);

    for (const primary of ['/resize', '/compress', '/convert']) expect(links.has(primary), `${primary} in the bar`).toBe(true);
    expect(header).toMatch(/<button[^>]*aria-expanded="false"[^>]*>[^<]*Tools|aria-haspopup="true"/);
    // Every tool with a page of its own is a real link in the header's HTML,
    // menu closed, before any script runs.
    for (const path of ['/crop', '/heic', '/signature-resizer', '/change-image-dpi', '/remove-image-metadata', '/jpg-to-pdf', '/merge-pdf', '/tools', '/guides']) {
        expect(links.has(path), `${path} is linked from the header HTML`).toBe(true);
    }
});

test('the Tools menu opens from the keyboard, takes focus, and closes on Escape', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/about');

    const button = page.getByRole('button', { name: 'Tools' });
    await button.focus();
    await page.keyboard.press('Enter');
    await expect(button).toHaveAttribute('aria-expanded', 'true');

    const focused = await page.evaluate(() => ({ tag: document.activeElement?.tagName, href: document.activeElement?.getAttribute('href') }));
    expect(focused.tag, 'focus moved into the menu').toBe('A');
    expect(focused.href).toMatch(/^\//);

    await page.keyboard.press('Escape');
    await expect(button).toHaveAttribute('aria-expanded', 'false');
    await expect(button).toBeFocused();
});

test('on a phone the menu groups the family by category, every tool once', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/about');

    await page.getByRole('button', { name: /menu/i }).click();
    const panel = page.locator('#mobile-nav-panel');
    await expect(panel).toBeVisible();
    for (const path of ['/resize', '/compress', '/convert', '/crop', '/heic', '/signature-resizer', '/change-image-dpi', '/remove-image-metadata', '/jpg-to-pdf', '/merge-pdf', '/tools']) {
        await expect(panel.locator(`a[href="${path}"]`), `${path} once in the phone menu`).toHaveCount(1);
    }
    const groups = panel.locator('ul[aria-labelledby]');
    expect(await groups.count(), 'category groups').toBeGreaterThanOrEqual(4);
    for (const id of await groups.evaluateAll((lists) => lists.map((list) => list.getAttribute('aria-labelledby')))) {
        await expect(panel.locator(`#${id}`), `${id} names its group`).toHaveText(/\S/);
    }
});

test('/tools lists every tool and intent as a crawlable link before any script runs', async ({ request }) => {
    const html = await (await request.get('/tools')).text();
    const main = html.slice(html.indexOf('<main'));
    const links = linksIn(main);
    const family = await familyPaths(request);

    expect(family.length).toBeGreaterThanOrEqual(25);
    for (const path of family) expect(links.has(path), `${path} is linked from /tools`).toBe(true);
    expect(main).toMatch(/aria-label="Filter tools"|<label[^>]*>[^<]*Filter tools/);
});

test('the /tools filter narrows the rows and says how many are shown', async ({ page }) => {
    await page.goto('/tools');
    const input = page.getByLabel('Filter tools');
    await input.fill('50 kb');

    await expect(page.getByRole('main').locator('a[href="/compress-image-to-50kb"]')).toBeVisible();
    await expect(page.getByRole('main').locator('a[href="/merge-pdf"]')).toBeHidden();
    await expect(page.getByRole('status')).toContainText(/\d+ of \d+/);

    await input.press('Escape');
    await expect(page.getByRole('main').locator('a[href="/merge-pdf"]')).toBeVisible();
});

test('the homepage presents the family, not one tool', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/');

    const h1 = await page.getByRole('heading', { level: 1 }).textContent();
    expect(h1).not.toMatch(/^Resize,/);
    expect(h1).toMatch(/image tools/i);

    const main = page.getByRole('main');
    await expect(main.locator('a[href="/compress-image-to-50kb"]')).toHaveCount(1);
    await expect(main.locator('a[href="/remove-image-metadata"]').first()).toBeVisible();
    await expect(main.locator('a[href^="/tools#"]').first()).toBeVisible();
    await expect(page.getByRole('list', { name: 'What Resizo promises' }).first()).toBeVisible();
});

test('a tool page states what it changes, and the trust strip replaces the repeated sentence', async ({ page, request }) => {
    for (const path of ['/remove-image-metadata', '/change-image-dpi', '/png-to-jpg']) {
        const html = await (await request.get(path)).text();
        expect(html, `${path} carries the behaviour statement`).toContain('What this tool changes');
        expect(html, `${path} carries the trust strip`).toContain('Processed on your device');

        await page.goto(path);
        const answer = page.locator(ANSWER_SELECTOR);
        await expect(answer, `${path} still states the direct answer under the panel`).toBeVisible();
        expect((await answer.innerText()).length, `${path} answers in a paragraph, not a slogan`).toBeGreaterThan(200);
    }
    // The behaviour is a definition list, so read it as text: the term, then its definition.
    const asText = (html) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    const metadata = asText(await (await request.get('/remove-image-metadata')).text());
    expect(metadata, 'the metadata remover says it keeps the ICC profile').toMatch(/ICC profile Kept/);
    const dpi = asText(await (await request.get('/change-image-dpi')).text());
    expect(dpi, 'the DPI tool says the pixels are copied, not re-encoded').toMatch(/Pixels Copied byte for byte/);
});
