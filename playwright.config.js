const { defineConfig, devices } = require('@playwright/test');

/**
 * End-to-end suite. Runs against a real production build so what is tested is
 * what ships — the dev server papers over prerender and header behaviour the
 * SEO checks depend on.
 *
 * There is no backend to stand up. The image tools run in the browser, so the
 * build boots with no credentials of any kind. E2E_BUILD is the only variable
 * left: it makes next.config skip `output: standalone` so `next start` can
 * serve the build.
 *
 * FIVE PROJECTS, ONE SERVER. Resizo does its image work in the visitor's
 * browser, so Chromium alone proves nothing about the browsers most visitors
 * hold. The projects are:
 *
 *   chromium-full    every test: contracts, flows and the compatibility set.
 *                    The authoritative run, and the one `npm run e2e` means.
 *   firefox-smoke    tests/e2e/browser/** tagged @smoke — representative real
 *   webkit-smoke     processing paths (decode, resize, encode, target bytes,
 *                    transparency, a byte-only rewrite, a HEIC decode), each
 *                    verifying the downloaded bytes with sharp.
 *   mobile-chromium  tests/e2e/browser/** tagged @mobile — small jobs on a
 *   mobile-webkit    phone profile, plus the layout and semantics a phone
 *                    has to keep.
 *
 * The SEO, crawl and API contracts run in Chromium only: they read HTML over
 * HTTP and a second browser would read the same bytes. WebKit here is
 * Playwright's WebKit build, not Safari on a physical iPhone; real-device
 * memory pressure stays a manual check (tests/e2e/browser/README.md).
 */
const PORT = Number(process.env.E2E_PORT || 3910);
const BASE_URL = `http://127.0.0.1:${PORT}`;

const BUILD_ENV = {
    E2E_BUILD: '1',
};

/** The compatibility set: the only files the non-Chromium projects run. */
const COMPATIBILITY = '**/browser/**/*.spec.js';

/**
 * Firefox and WebKit fetch and instantiate the same WebAssembly codecs more
 * slowly than Chromium, and in `npm run e2e` all five projects share one
 * machine. Ninety seconds keeps a slow pass from reading as a failure; a
 * real failure still fails, with its trace, inside that budget.
 */
const COMPATIBILITY_TIMEOUT = 90_000;

module.exports = defineConfig({
    testDir: './tests/e2e',
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    // One retry in CI, none locally: a flake shows up as "flaky" in the report
    // rather than as a red run, and a real failure still fails twice.
    retries: process.env.CI ? 1 : 0,
    workers: process.env.CI ? 2 : undefined,
    reporter: process.env.CI
        ? [['github'], ['line'], ['html', { open: 'never', outputFolder: 'playwright-report' }]]
        : 'line',
    use: {
        baseURL: BASE_URL,
        // The trace is the diagnostic that explains a failure: every request,
        // every console line, every DOM snapshot. Kept only when a test fails,
        // so a green run writes nothing. Video adds little a trace lacks and
        // costs tens of megabytes per project, so it stays off.
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure',
        video: 'off',
    },
    projects: [
        {
            name: 'chromium-full',
            use: { ...devices['Desktop Chrome'] },
        },
        {
            name: 'firefox-smoke',
            use: { ...devices['Desktop Firefox'] },
            testMatch: COMPATIBILITY,
            grep: /@smoke/,
            timeout: COMPATIBILITY_TIMEOUT,
        },
        {
            name: 'webkit-smoke',
            use: { ...devices['Desktop Safari'] },
            testMatch: COMPATIBILITY,
            grep: /@smoke/,
            timeout: COMPATIBILITY_TIMEOUT,
        },
        {
            name: 'mobile-chromium',
            use: { ...devices['Pixel 7'] },
            testMatch: COMPATIBILITY,
            grep: /@mobile/,
            timeout: COMPATIBILITY_TIMEOUT,
        },
        {
            name: 'mobile-webkit',
            use: { ...devices['iPhone 14'] },
            testMatch: COMPATIBILITY,
            grep: /@mobile/,
            timeout: COMPATIBILITY_TIMEOUT,
        },
    ],
    webServer: {
        command: `npm run build && npx next start -p ${PORT}`,
        url: BASE_URL,
        reuseExistingServer: !process.env.CI,
        timeout: 180_000,
        env: { ...process.env, ...BUILD_ENV },
    },
});
