const path = require('node:path');

const {
    test: base,
    expect,
    judgeNetwork,
    judgeErrors,
    EXPECTED_CONSOLE_ERRORS,
} = require('../fixtures/resizo');
const { inspect } = require('../helpers/output');

/**
 * PROOF THAT THE GUARDS CAN FAIL — AND FAIL FOR THE RIGHT REASON.
 *
 * A guard that has never been seen red is a claim, not a check. But a proof
 * that only says "this test failed" is a claim too: Playwright's test.fail()
 * accepts any failure, so a dead server, a typo or a different guard would
 * satisfy it just as well. Every proof here therefore does three things.
 *
 * 1. It proves the page was live and the violation happened, with positive
 *    assertions that would fail on a dead server before anything else.
 * 2. It asks the guard's own verdict function about the real log the
 *    violation produced, and asserts the exact offender it names.
 * 3. Only then does it declare test.fail(), so the fixture teardown that
 *    follows has to fail this test through the guard under proof — with the
 *    other guard overridden to a no-op in that block, so nothing else can be
 *    the reason. Neuter the guard and Playwright reports "expected to fail,
 *    but passed".
 *
 * Nothing in the application is changed to make these fail: each violation
 * is staged from the test side, against the real build.
 */
const SAMPLE = path.join(__dirname, '..', '..', '..', 'public', 'samples', 'landscape-1600x1067.jpg');

/** Proves the server answered before a violation is staged. */
async function openAlive(page, route) {
    const response = await page.goto(route);
    expect(response, `${route} did not respond`).not.toBeNull();
    expect(response.ok(), `${route} answered ${response?.status()}`).toBe(true);
}

base.describe('the no-upload guard', () => {
    // The browser-error guard is a no-op here: a POST draws a 405 into the
    // console and a cross-origin image a CORS line, and either would fail the
    // test on its own. Only the no-upload guard may be the reason.
    const test = base.extend({
        browserErrors: [async ({}, provide) => { await provide([]); }, { auto: true }],
    });

    test('fails when the page sends a POST, even to its own origin', async ({ page, network, baseURL }) => {
        await openAlive(page, '/about');
        await page.evaluate(() => fetch('/api/health', { method: 'POST', body: 'x' }).catch(() => null));

        const verdict = judgeNetwork(network, baseURL);
        expect(verdict.offenders).toEqual([`POST ${baseURL}/api/health`]);

        test.fail(true, 'the teardown must now refuse the POST the verdict names');
    });

    test('fails when the page requests another origin', async ({ page, network, baseURL }) => {
        // A controlled violating page: the same server reached by a different
        // host name is another origin to the guard exactly as a third party
        // would be, served from a data: URL so the site's own CSP, which would
        // block the request before it left, does not apply.
        const other = baseURL.replace('127.0.0.1', 'localhost');
        await openAlive(page, '/about');
        await page.goto(`data:text/html,<img src="${other}/icon.png">`);
        await page.waitForLoadState('networkidle');

        const verdict = judgeNetwork(network, baseURL);
        expect(verdict.offenders).toEqual([`GET ${other}/icon.png`]);

        test.fail(true, 'the teardown must now refuse the request to the other origin');
    });

    test('never passes vacuously: a processed flow with no request observed is a failure', async ({ network, baseURL }) => {
        network.processed = true;

        expect(judgeNetwork(network, baseURL).vacuous).toBe(true);

        test.fail(true, 'an empty log must not vouch for a page it never saw');
    });
});

base.describe('the browser-error guard', () => {
    // The no-upload guard is a no-op here, so only the error guard can fail.
    const test = base.extend({
        network: [async ({}, provide) => { await provide({ requests: [], processed: false }); }, { auto: true }],
    });

    test('fails on an uncaught page error', async ({ page, browserErrors }) => {
        await openAlive(page, '/about');
        await page.evaluate(() => setTimeout(() => { throw new Error('deliberate page error'); }, 0));
        await expect.poll(() => browserErrors.length).toBeGreaterThan(0);

        expect(judgeErrors(browserErrors)).toEqual(['pageerror: deliberate page error']);

        test.fail(true, 'the teardown must now refuse the page error the verdict names');
    });

    test('fails on a console.error', async ({ page, browserErrors }) => {
        await openAlive(page, '/about');
        await page.evaluate(() => console.error('deliberate console error'));
        await expect.poll(() => browserErrors.length).toBeGreaterThan(0);

        expect(judgeErrors(browserErrors)).toEqual(['console.error: deliberate console error']);

        test.fail(true, 'the teardown must now refuse the console error the verdict names');
    });

    test('keeps its allow-list short, and every entry justified', () => {
        // The list exists for noise the product emits on purpose. Three is
        // room for that; more is an ignore list.
        expect(EXPECTED_CONSOLE_ERRORS.length).toBeLessThanOrEqual(3);
        for (const entry of EXPECTED_CONSOLE_ERRORS) {
            expect(entry.pattern).toBeInstanceOf(RegExp);
            expect(typeof entry.reason).toBe('string');
            expect(entry.reason.length).toBeGreaterThan(20);
        }
    });
});

base('the output verification reads the file, so a wrong expected dimension fails on its own', async ({ tool, page }) => {
    const saved = await tool.process({
        route: '/resize',
        file: SAMPLE,
        after: () => page.getByLabel('Width (px)', { exact: true }).fill('800'),
        button: /resize image/i,
    });
    const out = await inspect(saved.file);

    // The real width, from the bytes — and the proof that the assertion a
    // flow makes about it is load-bearing: the wrong number is refused.
    expect(out.width).toBe(800);
    expect(() => expect(out.width).toBe(801)).toThrow(/801/);
});
