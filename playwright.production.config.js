const { defineConfig, devices } = require('@playwright/test');

/**
 * The deployment check. Runs against a site that is already serving people.
 *
 * This is the opposite config to playwright.config.js in the one way that
 * matters: **it starts no server.** There is no `webServer` block, no build, no
 * port. Whatever is answering at `baseURL` is the subject, and the run has no
 * way to accidentally test a local build instead — if the deployment is down,
 * these tests fail, which is the entire point of them.
 *
 * The two configs cannot collide. `playwright.config.js` has `testDir:
 * './tests/e2e'`, so `tests/production/` is outside it and `npm run e2e` never
 * picks these up; this config's `testDir` is `./tests/production`, so it never
 * picks up the E2E suite. Neither directory is inside the other.
 *
 * ONE PROJECT, NOT FIVE. The E2E suite runs Firefox, WebKit and two phone
 * profiles because the product decodes and encodes images in the visitor's own
 * browser and Chromium alone would prove nothing about the browsers most
 * visitors hold. That argument is about the *code*, and the code was already
 * proved on all five before it was deployed. What is unproved after a deploy is
 * the deployment: the right commit, the pages served, the sitemap, the headers.
 * A second browser would re-read the same bytes over the same HTTP.
 *
 * NO RETRIES. A retry here would hide the flake that matters — a page that
 * answers on the second request is a production symptom, not test noise.
 * `workers: 2` keeps the load on a live site polite; this run is somebody's
 * traffic.
 */

/** The deployment under test. Override to check a preview or a self-hosted instance. */
const BASE_URL = process.env.PRODUCTION_URL || 'https://www.resizo.net';

module.exports = defineConfig({
    testDir: './tests/production',
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    retries: 0,
    workers: 2,
    timeout: 60_000,
    reporter: process.env.CI ? [['github'], ['list']] : 'list',
    use: {
        baseURL: BASE_URL,
        // A failure here is about a site nobody can reproduce locally — the
        // deployment moves on. The trace and the screenshot are the only
        // record of what production was actually serving at that moment.
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure',
        video: 'off',
    },
    projects: [
        {
            name: 'production-chromium',
            use: { ...devices['Desktop Chrome'] },
        },
    ],
});
