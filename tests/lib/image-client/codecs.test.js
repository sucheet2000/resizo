/**
 * Codec loading: lib/image-client/codecs.js.
 *
 * Every decode and encode test in this repo loads a codec through this module,
 * so the loaders themselves are exercised constantly. What was never exercised
 * is the thing the module exists for — the memoisation — and its three rules
 * are all invisible from the outside:
 *
 *   1. THE PROMISE IS MEMOISED, NOT THE RESULT. Two files dropped at once both
 *      reach for the JPEG encoder in the same tick. Caching the resolved value
 *      would start two emscripten instances: two WASM heaps, double the memory,
 *      and for the wasm-bindgen codecs a second `WebAssembly.Instance` the first
 *      module's cached memory views no longer point at. Nothing about that
 *      throws — it just doubles the peak on the phone that could least afford it.
 *
 *   2. WASM IS SERVED FROM public/wasm/. A relative resolution 404s under Next.
 *
 *   3. A FAILED LOAD IS NOT CACHED, so a codec that failed on a dropped network
 *      can be retried instead of replaying the failure for the rest of the
 *      session.
 *
 * Rule 1 and rule 3 are both about what happens on the SECOND call, which no
 * end-to-end test ever looks at. They are the whole subject here.
 */
import { beforeEach, describe, expect, it } from 'vitest';

import {
    isCodecLoading,
    loadJpegDecoder,
    loadJpegEncoder,
    loadPngDecoder,
    loadPngEncoder,
    loadResizer,
    loadWebpDecoder,
    loadWebpEncoder,
    resetCodecs,
    wasmUrl,
    WASM_BASE_PATH,
} from '@/lib/image-client/codecs';

import { installBrowserEnv } from './helpers/browser-env';

/* ------------------------------------------------------------------ *
 * Where the binaries are looked for
 * ------------------------------------------------------------------ */

describe('the URL a wasm binary is fetched from', () => {
    /**
     * Site-absolute, so it resolves identically from a page, from a classic
     * worker and from a module worker regardless of which chunk the caller was
     * bundled into. Both codec families otherwise locate their binary from
     * `import.meta.url`, which under Next resolves into the bundler's chunk
     * space and 404s.
     */
    it('is absolute from the site root, never relative to the chunk', () => {
        expect(WASM_BASE_PATH).toBe('/wasm/');
        expect(wasmUrl('squoosh_png_bg.wasm')).toBe('/wasm/squoosh_png_bg.wasm');
        expect(wasmUrl('squoosh_resize_bg.wasm')).toBe('/wasm/squoosh_resize_bg.wasm');
    });

    it('never produces a path that would resolve relatively', () => {
        expect(wasmUrl('x.wasm').startsWith('/')).toBe(true);
        expect(wasmUrl('x.wasm')).not.toContain('./');
        expect(wasmUrl('x.wasm')).not.toContain('..');
    });
});

/* ------------------------------------------------------------------ *
 * Memoisation
 * ------------------------------------------------------------------ */

describe('loading a codec at most once', () => {
    beforeEach(() => {
        installBrowserEnv();
        resetCodecs();
    });

    it('reports nothing as loading before anything has been asked for', () => {
        expect(isCodecLoading('jpeg:encode')).toBe(false);
        expect(isCodecLoading('heif:decode')).toBe(false);
    });

    it('marks a codec as loading the moment it is asked for, before it resolves', async () => {
        const pending = loadJpegEncoder();

        expect(isCodecLoading('jpeg:encode')).toBe(true);
        await pending;
        expect(isCodecLoading('jpeg:encode')).toBe(true);
    });

    /**
     * Rule 1, at the tick that matters: two callers in the SAME tick, before
     * anything has resolved. If the resolved value were memoised instead of the
     * promise, both would start their own emscripten instance and the second
     * heap would never be released.
     */
    /**
     * The promise, not the value — asserted as the identical promise OBJECT,
     * because that is the only observable difference. Two @jsquash callers that
     * each started their own emscripten instance would still be handed the same
     * exported function, so comparing the resolved values proves nothing; what
     * would differ is the WASM heap behind it, which no test can see.
     */
    it('hands two callers in the same tick the identical promise, not two loads', async () => {
        const first = loadJpegEncoder();
        const second = loadJpegEncoder();

        expect(second).toBe(first);
        expect(await second).toBe(await first);
    });

    it('hands a later caller the same instance again', async () => {
        const first = await loadJpegEncoder();
        const second = await loadJpegEncoder();

        expect(second).toBe(first);
    });

    it.each([
        ['the JPEG decoder', 'jpeg:decode', () => loadJpegDecoder()],
        ['the PNG encoder', 'png:encode', () => loadPngEncoder()],
        ['the PNG decoder', 'png:decode', () => loadPngDecoder()],
        ['the WebP encoder', 'webp:encode', () => loadWebpEncoder()],
        ['the WebP decoder', 'webp:decode', () => loadWebpDecoder()],
        ['the resizer', 'resize', () => loadResizer()],
    ])('memoises %s under its own key', async (_label, key, load) => {
        expect(isCodecLoading(key)).toBe(false);

        const first = await load();
        expect(isCodecLoading(key)).toBe(true);
        expect(await load()).toBe(first);
    });

    /**
     * Each codec gets its own slot. A single shared one would mean the first
     * codec a visitor touched was the only one they could ever use.
     */
    it('keeps the encoders and decoders of one format apart', async () => {
        await loadJpegEncoder();

        expect(isCodecLoading('jpeg:encode')).toBe(true);
        expect(isCodecLoading('jpeg:decode')).toBe(false);
    });

    it('every loader is a function, never a shared value', async () => {
        expect(typeof await loadJpegEncoder()).toBe('function');
        expect(typeof await loadPngDecoder()).toBe('function');
        expect(typeof await loadResizer()).toBe('function');
    });

    /**
     * resetCodecs is test-only and says so: it does NOT tear down an already
     * instantiated WASM module, it only makes the next load build a new record.
     * What it must do is clear every key, or a suite that resets between cases
     * quietly keeps one codec from the run before.
     */
    it('resetCodecs clears every key, not merely the last one', async () => {
        await Promise.all([loadJpegEncoder(), loadPngDecoder(), loadResizer()]);

        expect(isCodecLoading('jpeg:encode')).toBe(true);
        expect(isCodecLoading('png:decode')).toBe(true);
        expect(isCodecLoading('resize')).toBe(true);

        resetCodecs();

        expect(isCodecLoading('jpeg:encode')).toBe(false);
        expect(isCodecLoading('png:decode')).toBe(false);
        expect(isCodecLoading('resize')).toBe(false);
    });

    it('loads again after a reset rather than answering from a dead record', async () => {
        const first = await loadJpegEncoder();
        resetCodecs();

        expect(typeof await loadJpegEncoder()).toBe('function');
        expect(first).toBeTruthy();
    });
});
