/**
 * THE SECURITY HEADERS, AND ESPECIALLY THE ONE THAT CARRIES THE PROMISE.
 *
 * next.config.js is the only place any security header is defined — there is no
 * middleware.js and vercel.json sets none — and until now nothing under tests/
 * referenced the Content-Security-Policy at all. That matters more here than on
 * a typical site, because the CSP is not merely hardening: `connect-src 'self'`
 * is the MECHANICAL PROOF of the product's central claim. A page that tried to
 * post a photo to another host would be blocked by the browser rather than
 * trusted not to.
 *
 * A promise enforced by one line of config, and asserted nowhere, is a promise
 * one careless edit away from being untrue while every test stays green.
 *
 * `script-src` is pinned for the opposite reason: 'wasm-unsafe-eval' is what
 * permits WebAssembly.compile at all, and without it every codec in
 * lib/image-client is dead before instantiation and all seven tools stop
 * working. (The E2E suite would catch that one, loudly; this catches it in a
 * second rather than in a browser run, and says why in the failure.)
 */
import { describe, expect, it } from 'vitest';

import nextConfig from '@/next.config';

async function cspDirectives() {
    const [rule] = await nextConfig.headers();
    const header = rule.headers.find((entry) => entry.key === 'Content-Security-Policy');
    return header.value.split(';').map((part) => part.trim()).filter(Boolean);
}

function directive(directives, name) {
    return directives.find((entry) => entry === name || entry.startsWith(`${name} `)) ?? null;
}

describe('the Content-Security-Policy', () => {
    it('applies to every route', async () => {
        const rules = await nextConfig.headers();
        expect(rules).toHaveLength(1);
        expect(rules[0].source).toBe('/(.*)');
    });

    it('keeps connect-src at self — the no-upload promise, mechanically', async () => {
        expect(directive(await cspDirectives(), 'connect-src')).toBe("connect-src 'self'");
    });

    /**
     * form-action does NOT fall back to default-src. CSP3 gives it no fallback
     * at all, unlike object-src, media-src and worker-src — so while it was
     * absent, `connect-src 'self'` could be perfectly enforced and a photo
     * could still leave the device.
     *
     * Any script running in the page — a future feature, or a supply-chain
     * compromise of one of the four runtime dependencies that already execute
     * here — could build a form posting the visitor's File to another host and
     * call submit(). fetch, XHR, WebSocket and sendBeacon were all blocked. A
     * form submission was not.
     *
     * 'none' rather than 'self' because the site renders no form element
     * anywhere; there is nothing to permit.
     */
    it('blocks a form submission, which connect-src cannot reach', async () => {
        expect(directive(await cspDirectives(), 'form-action')).toBe("form-action 'none'");
    });

    /** Also no fallback. An injected <base> re-points every relative URL. */
    it('pins base-uri, which has no fallback either', async () => {
        expect(directive(await cspDirectives(), 'base-uri')).toBe("base-uri 'self'");
    });

    it('ships no plugin content, and says so', async () => {
        expect(directive(await cspDirectives(), 'object-src')).toBe("object-src 'none'");
    });

    it('states un-frameable in the modern spelling as well as the legacy one', async () => {
        const [rule] = await nextConfig.headers();
        const xfo = rule.headers.find((entry) => entry.key === 'X-Frame-Options');

        expect(xfo.value).toBe('DENY');
        expect(directive(await cspDirectives(), 'frame-ancestors')).toBe("frame-ancestors 'none'");
    });

    it('keeps wasm-unsafe-eval, without which every codec is dead on arrival', async () => {
        const script = directive(await cspDirectives(), 'script-src');

        expect(script, 'removing this kills all seven tools').toContain("'wasm-unsafe-eval'");
        // The whole point of wasm-unsafe-eval is that it is the NARROW
        // replacement for opening up eval. Granting both would give the licence
        // back and make the narrow one pointless.
        expect(script).not.toMatch(/'unsafe-eval'/);
    });

    it('names no third-party script host', async () => {
        const script = directive(await cspDirectives(), 'script-src');
        expect(script).not.toMatch(/https?:\/\//);
    });
});

describe('the other headers', () => {
    it.each([
        ['Strict-Transport-Security', /max-age=\d+/],
        ['X-Content-Type-Options', /^nosniff$/],
        ['Referrer-Policy', /strict-origin/],
        ['Permissions-Policy', /camera=\(\)/],
    ])('sends %s', async (key, shape) => {
        const [rule] = await nextConfig.headers();
        const header = rule.headers.find((entry) => entry.key === key);

        expect(header, `${key} is not sent`).toBeTruthy();
        expect(header.value).toMatch(shape);
    });
});
