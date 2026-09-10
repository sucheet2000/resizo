const path = require('node:path');

const { test, expect } = require('../fixtures/resizo');
const { inspect } = require('../helpers/output');

/**
 * PROOF THAT THE GUARDS CAN FAIL.
 *
 * A guard that has never been seen red is a claim, not a check. Every test
 * here is marked with test.fail(): it does the one thing the guard exists to
 * catch, and Playwright reports the run as broken if the guard lets it pass.
 * Nothing in the application is changed to make these fail — each violation
 * is staged from the test side, against the real build.
 */
const SAMPLE = path.join(__dirname, '..', '..', '..', 'public', 'samples', 'landscape-1600x1067.jpg');

test.describe('the no-upload guard', () => {
    test('fails when the page sends a POST, even to its own origin', async ({ page, network }) => {
        test.fail(true, 'a POST is the shape of an upload; the guard must refuse it');
        await page.goto('/about');
        await page.evaluate(() => fetch('/api/health', { method: 'POST', body: 'x' }).catch(() => null));
        network.processed = true;
    });

    test('fails when the page requests another origin', async ({ page, baseURL }) => {
        test.fail(true, 'a request to another host is the guard\'s other reason to exist');
        // A controlled violating page: the same server, reached by a different
        // host name, is another origin to the guard exactly as any third party
        // would be. It is served from a data: URL so the site's own CSP, which
        // would otherwise block the request before it left, does not apply.
        const other = baseURL.replace('127.0.0.1', 'localhost');
        await page.goto(`data:text/html,<img src="${other}/icon.png">`);
        await page.waitForLoadState('networkidle');
    });

    test('fails vacuously never: a processed flow with no request observed is a failure', async ({ network }) => {
        test.fail(true, 'an empty log must not vouch for a page it never saw');
        network.processed = true;
    });
});

test.describe('the browser-error guard', () => {
    test('fails on an uncaught page error', async ({ page }) => {
        test.fail(true, 'a runtime failure must not hide behind a rendered headline');
        await page.goto('/about');
        await page.evaluate(() => setTimeout(() => { throw new Error('deliberate page error'); }, 0));
        await page.waitForTimeout(100);
    });

    test('fails on a console.error', async ({ page }) => {
        test.fail(true, 'console.error is the engine\'s way of saying something went wrong');
        await page.goto('/about');
        await page.evaluate(() => console.error('deliberate console error'));
        await page.waitForTimeout(50);
    });
});

test.describe('the output verification', () => {
    test('fails on a wrong expected dimension against the real downloaded file', async ({ tool, page }) => {
        test.fail(true, 'the file, not the panel, is the proof; a wrong number must fail');
        const saved = await tool.process({
            route: '/resize',
            file: SAMPLE,
            after: () => page.getByLabel('Width (px)', { exact: true }).fill('800'),
            button: /resize image/i,
        });
        const out = await inspect(saved.file);
        expect(out.width).toBe(801);
    });
});
