const { defineConfig, devices } = require('@playwright/test');

/**
 * End-to-end suite. Runs against a real production build so what is tested is
 * what ships — the dev server papers over prerender and header behaviour the
 * SEO checks depend on.
 *
 * The dummy Upstash values let every route boot: the rate limiter fails open
 * when Upstash is unconfigured (lib/http/rate-limit.js), so nothing here is
 * gated on a live backend. E2E_BUILD makes next.config skip `output: standalone`
 * so `next start` can serve the build.
 */
const PORT = Number(process.env.E2E_PORT || 3910);
const BASE_URL = `http://127.0.0.1:${PORT}`;

const DUMMY_ENV = {
    E2E_BUILD: '1',
    UPSTASH_REDIS_REST_URL: 'https://dummy.upstash.io',
    UPSTASH_REDIS_REST_TOKEN: 'dummy-token',
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
        env: { ...process.env, ...DUMMY_ENV },
    },
});
