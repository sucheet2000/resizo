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
 */
const PORT = Number(process.env.E2E_PORT || 3910);
const BASE_URL = `http://127.0.0.1:${PORT}`;

const BUILD_ENV = {
    E2E_BUILD: '1',
};

module.exports = defineConfig({
    testDir: './tests/e2e',
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 1 : 0,
    workers: process.env.CI ? 2 : undefined,
    reporter: process.env.CI ? [['github'], ['line']] : 'line',
    use: {
        baseURL: BASE_URL,
        trace: 'on-first-retry',
    },
    projects: [
        { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    ],
    webServer: {
        command: `npm run build && npx next start -p ${PORT}`,
        url: BASE_URL,
        reuseExistingServer: !process.env.CI,
        timeout: 180_000,
        env: { ...process.env, ...BUILD_ENV },
    },
});
