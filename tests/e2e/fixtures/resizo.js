/**
 * The Resizo test: Playwright's `test`, extended with what every browser-driven
 * check of this product has to prove whether or not its author remembered to.
 *
 * Three things are automatic. They run for every test that touches a page,
 * and a test that never opens a page pays nothing for them.
 *
 * 1. BROWSER ERRORS. An uncaught `pageerror` or a `console.error` fails the
 *    test. A tool that throws during hydration still renders its static HTML,
 *    so a headline assertion alone passes over a dead page; this does not.
 *    Noise the application emits on purpose goes in EXPECTED_CONSOLE_ERRORS
 *    with the reason beside it. The list is empty, and stays short.
 *
 * 2. THE NO-UPLOAD GUARD. CLAUDE.md's central promise is that no image is
 *    uploaded, and the only mechanical proof of that is the request log. Every
 *    request the page makes is recorded from before the document itself, and
 *    at teardown every one has to be a same-origin GET (or HEAD). A POST, a
 *    PUT, a PATCH, a DELETE, or any request to another origin fails the test.
 *    `blob:` and `data:` URLs never reach a network — they are the visitor's own
 *    bytes handed back to their own browser — and are local by definition.
 *
 *    The guard cannot pass vacuously: a test that processed an image through
 *    `tool` asserts that the log is non-empty, so a listener that was never
 *    attached to the page under test is caught rather than trusted.
 *
 * 3. A CAPABILITY REPORT ON FAILURE. When a test fails, the browser's own
 *    answer to "what can you do" — user agent, viewport, createImageBitmap,
 *    OffscreenCanvas, WebAssembly, Worker, deviceMemory, canvas encoders — is
 *    attached to the result, so a compatibility failure in Firefox or WebKit
 *    reads as "this browser lacks X" rather than as a bare timeout.
 *
 * Product flows go through `tool`: the real page, the real file input, the
 * real button, the real download. Nothing here reaches into the engine.
 */
const fs = require('node:fs');

const base = require('@playwright/test');

const { expect } = base;

/**
 * Console errors the application emits deliberately: `{ pattern, reason }`,
 * a RegExp and the sentence that justifies it. A match is not counted
 * against the test. Nothing qualifies today, and contracts/guards.spec.js
 * caps the list so it cannot quietly become a blanket ignore.
 */
const EXPECTED_CONSOLE_ERRORS = [];

/**
 * Methods that can carry nothing away from the device. HEAD is admitted
 * beside GET because it has no body by definition; the deleted expansion
 * spec allowed GET alone, and the widening is deliberate.
 */
const READ_ONLY_METHODS = new Set(['GET', 'HEAD']);

/** The one message prefix each guard fails with, so a failure names its guard. */
const NO_UPLOAD_GUARD = '[no-upload guard]';
const BROWSER_ERROR_GUARD = '[browser-error guard]';

function originOf(url) {
    try {
        return new URL(url).origin;
    } catch {
        return null;
    }
}

/** Local to the visitor's own browser, or served by the site under test. */
function isLocal(url, baseURL) {
    if (url.startsWith('blob:') || url.startsWith('data:') || url === 'about:blank') return true;
    return originOf(url) === originOf(baseURL);
}

function offendersIn(requests, baseURL) {
    return requests
        .filter(({ method, url }) => !READ_ONLY_METHODS.has(method) || !isLocal(url, baseURL))
        .map(({ method, url }) => `${method} ${url}`);
}

/**
 * The no-upload guard's verdict on a request log, as a value: the teardown
 * below throws on it, and contracts/guards.spec.js asserts it directly on
 * a log a real violation produced, so the proof is about this function and
 * not about any failure at all.
 */
function judgeNetwork(log, baseURL) {
    const offenders = offendersIn(log.requests, baseURL);
    const vacuous = log.processed && log.requests.length === 0;
    return { offenders, vacuous };
}

/** The browser-error guard's verdict, likewise. */
function judgeErrors(errors) {
    return errors.filter((entry) => !EXPECTED_CONSOLE_ERRORS.some(({ pattern }) => pattern.test(entry)));
}

/** What the browser says it can do, read from inside the page. */
async function readCapabilities(page) {
    return page.evaluate(() => {
        const has = (name) => typeof globalThis[name] !== 'undefined';
        const canvasEncodes = (type) => {
            try {
                const canvas = document.createElement('canvas');
                canvas.width = 2;
                canvas.height = 2;
                return canvas.toDataURL(type).startsWith(`data:${type}`);
            } catch {
                return false;
            }
        };
        return {
            userAgent: navigator.userAgent,
            viewport: { width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio },
            createImageBitmap: has('createImageBitmap'),
            OffscreenCanvas: has('OffscreenCanvas'),
            WebAssembly: has('WebAssembly'),
            Worker: has('Worker'),
            SharedArrayBuffer: has('SharedArrayBuffer'),
            crossOriginIsolated: globalThis.crossOriginIsolated === true,
            deviceMemory: navigator.deviceMemory ?? null,
            hardwareConcurrency: navigator.hardwareConcurrency ?? null,
            canvasEncodes: { jpeg: canvasEncodes('image/jpeg'), webp: canvasEncodes('image/webp'), png: canvasEncodes('image/png') },
        };
    });
}

/** Attaches the capability report once per test, whichever guard asks first. */
async function attachDiagnostics(page, testInfo, extra = {}) {
    if (testInfo.attachments.some((attachment) => attachment.name === 'browser-capabilities')) return;
    let capabilities = { unavailable: 'the page was already closed' };
    if (!page.isClosed()) {
        try {
            capabilities = await readCapabilities(page);
        } catch (error) {
            capabilities = { unavailable: error.message };
        }
    }
    await testInfo.attach('browser-capabilities', {
        contentType: 'application/json',
        body: JSON.stringify({ project: testInfo.project.name, url: page.isClosed() ? null : page.url(), ...capabilities, ...extra }, null, 2),
    });
}

/** The affordance that replaces the submit button once a result exists. */
function downloadAffordance(page, name) {
    return page.getByRole('button', { name }).or(page.getByRole('link', { name }));
}

/**
 * The product, driven as a person drives it. Every method is the real UI.
 */
class Tool {
    constructor(page, network) {
        this.page = page;
        this.network = network;
    }

    /** Opens a route and, when given, checks the headline is the one expected. */
    async open(route, { h1 } = {}) {
        await this.page.goto(route);
        if (h1) await expect(this.page.getByRole('heading', { level: 1 })).toHaveText(h1);
    }

    /** Hands a file to the first file input on the page — the drop zone's own. */
    async pick(file) {
        this.network.processed = true;
        await this.page.locator('input[type="file"]').first().setInputFiles(file);
    }

    /**
     * Presses the action button and waits for the download affordance the
     * result panel shows. Sixty seconds, because a first run in a browser
     * fetches a codec before it encodes, and Firefox and WebKit do both more
     * slowly than Chromium on a loaded machine; a flow that fails still fails
     * inside the test's own timeout.
     */
    async run(button, { download = /^Download/, timeout = 60_000 } = {}) {
        this.network.processed = true;
        await this.page.getByRole('button', { name: button }).click();
        await expect(downloadAffordance(this.page, download)).toBeVisible({ timeout });
    }

    /** Presses the download affordance and hands back the file the browser saved. */
    async download(name = /^Download/) {
        const [download] = await Promise.all([
            this.page.waitForEvent('download'),
            downloadAffordance(this.page, name).click(),
        ]);
        const file = await download.path();
        expect(file, `${name} produced no file`).toBeTruthy();
        return { file, filename: download.suggestedFilename(), bytes: fs.statSync(file).size };
    }

    /**
     * The whole flow in one call: open, configure, pick, run, download.
     * `before` runs after the page opens and before the file is picked;
     * `after` runs once the file is in, for pages that adopt the source's own
     * numbers on intake and have to be configured afterwards.
     */
    async process({ route, h1, file, before, after, button, download = /^Download/, timeout = 60_000 }) {
        await this.open(route, { h1 });
        if (before) await before(this.page);
        await this.pick(file);
        if (after) await after(this.page);
        await this.run(button, { download, timeout });
        return this.download(download);
    }
}

const test = base.test.extend({
    /** Every uncaught error and every console.error the page logged. */
    browserErrors: [async ({ page }, provide, testInfo) => {
        const errors = [];
        page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
        page.on('console', (message) => {
            if (message.type() === 'error') errors.push(`console.error: ${message.text()}`);
        });

        await provide(errors);

        const unexpected = judgeErrors(errors);
        if (unexpected.length > 0) await attachDiagnostics(page, testInfo, { browserErrors: unexpected });
        expect(unexpected, `${BROWSER_ERROR_GUARD} the browser logged an error during this test`).toEqual([]);
    }, { auto: true }],

    /** Every request the page made, judged at teardown. */
    network: [async ({ page, baseURL }, provide, testInfo) => {
        const log = { requests: [], processed: false };
        page.on('request', (request) => {
            log.requests.push({ method: request.method(), url: request.url(), type: request.resourceType() });
        });

        await provide(log);

        // A test that never opened a page has nothing to guard.
        if (log.requests.length === 0 && !log.processed) return;

        const { offenders, vacuous } = judgeNetwork(log, baseURL);
        if (offenders.length > 0 || vacuous) await attachDiagnostics(page, testInfo, { offenders, requests: log.requests.length });

        expect(vacuous, `${NO_UPLOAD_GUARD} an image was processed but no request was observed — the guard was not watching this page`).toBe(false);
        expect(offenders, `${NO_UPLOAD_GUARD} requests that were not a same-origin GET — nothing may leave the device`).toEqual([]);
    }, { auto: true }],

    /** The capability report, attached when the test body itself failed. */
    diagnostics: [async ({ page }, provide, testInfo) => {
        await provide();
        if (testInfo.status !== testInfo.expectedStatus) await attachDiagnostics(page, testInfo);
    }, { auto: true }],

    /** The product, driven through its real UI. */
    tool: async ({ page, network }, provide) => {
        await provide(new Tool(page, network));
    },
});

module.exports = {
    test,
    expect,
    judgeNetwork,
    judgeErrors,
    EXPECTED_CONSOLE_ERRORS,
    NO_UPLOAD_GUARD,
    BROWSER_ERROR_GUARD,
};
