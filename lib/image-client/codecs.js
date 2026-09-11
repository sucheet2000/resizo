/**
 * Codec Loading
 *
 * Every WASM codec the browser engine can use, behind a lazy, promise-memoised
 * loader. Nothing here is imported at module scope: a visitor who lands on
 * /resize and leaves without picking a file must not pay for 1.4 MB of HEIC
 * decoder, so each codec is pulled in by `import()` on first use and never
 * again.
 *
 * Three rules this file exists to enforce:
 *
 *  1. THE PROMISE IS MEMOISED, NOT THE RESULT. Two files dropped at once both
 *     reach for the JPEG encoder in the same tick. Caching the resolved value
 *     would start two emscripten instances (two WASM heaps, double the memory,
 *     and for the wasm-bindgen codecs a second `WebAssembly.Instance` that the
 *     first module's cached memory views no longer point at). Caching the
 *     in-flight promise gives both callers the same instance.
 *
 *  2. WASM IS SERVED FROM public/wasm/, NEVER RESOLVED RELATIVELY. Both codec
 *     families locate their binary from `import.meta.url`, which under Next
 *     resolves into the bundler's chunk space and 404s. The emscripten codecs
 *     get a `locateFile` override; the wasm-bindgen codecs (png, resize) take
 *     the URL as their init argument. scripts/copy-wasm.js keeps the served
 *     copies in step with node_modules.
 *
 *  3. A FAILED LOAD IS NOT CACHED. A codec that failed because the network
 *     dropped must be retryable, so the rejected promise is evicted.
 *
 * libheif is the exception to rule 2: libheif-js inlines its WASM as base64
 * inside libheif-bundle.mjs, so there is no binary to serve and no path to fix.
 *
 * This module is browser-only by content (it needs `fetch`, `WebAssembly` and,
 * downstream, `ImageData`). It carries no 'use client' directive on purpose —
 * it is imported by a worker as well as by client components, and a worker
 * entry graph is not a React client graph.
 */

/**
 * Where the copied binaries are served from. An absolute site path, so it
 * resolves identically from a page, from a classic worker and from a module
 * worker regardless of the chunk the caller was bundled into.
 */
export const WASM_BASE_PATH = '/wasm/';

/**
 * Emscripten hands `locateFile` the bare filename it wants ('webp_enc.wasm',
 * or 'webp_enc_simd.wasm' when SIMD is detected). It is passed through rather
 * than hard-coded so the SIMD split resolves on its own, and any directory
 * prefix a future build adds is stripped rather than doubled.
 */
function locateFile(requested) {
    const name = String(requested).split('/').pop();
    return `${WASM_BASE_PATH}${name}`;
}

/** The absolute URL of one served binary, for the wasm-bindgen loaders. */
export function wasmUrl(fileName) {
    return `${WASM_BASE_PATH}${fileName}`;
}

const loaders = new Map();

/**
 * Runs `factory` at most once per key and hands every caller the same promise.
 * A rejection is evicted so the next call retries instead of replaying the
 * failure forever.
 */
function once(key, factory) {
    const cached = loaders.get(key);
    if (cached) return cached;

    const pending = (async () => factory())().catch((error) => {
        loaders.delete(key);
        throw error;
    });

    loaders.set(key, pending);
    return pending;
}

/**
 * Drops every memoised loader. Test-only: it does NOT tear down an already
 * instantiated WASM module, it only makes the next load build a new one.
 */
export function resetCodecs() {
    loaders.clear();
}

/** True once a codec has been asked for, whether or not it has finished. */
export function isCodecLoading(key) {
    return loaders.has(key);
}

/* ------------------------------------------------------------------ JPEG */

/** @returns {Promise<(imageData: ImageData, options?: object) => Promise<ArrayBuffer>>} */
export function loadJpegEncoder() {
    return once('jpeg:encode', async () => {
        const codec = await import('@jsquash/jpeg/encode');
        await codec.init({ locateFile });
        return codec.default;
    });
}

/** @returns {Promise<(buffer: ArrayBuffer) => Promise<ImageData>>} */
export function loadJpegDecoder() {
    return once('jpeg:decode', async () => {
        const codec = await import('@jsquash/jpeg/decode');
        await codec.init({ locateFile });
        return codec.default;
    });
}

/* ------------------------------------------------------------------- PNG */

/**
 * @jsquash/png is wasm-bindgen, not emscripten: `init` takes the binary's URL
 * directly. Encode and decode share one WASM instance — the generated glue
 * short-circuits on `wasm !== undefined` — but they are separate module files
 * with separate init guards, so both are pointed at the same URL.
 *
 * @returns {Promise<(imageData: ImageData, options?: object) => Promise<ArrayBuffer>>}
 */
export function loadPngEncoder() {
    return once('png:encode', async () => {
        const codec = await import('@jsquash/png/encode');
        await codec.init(wasmUrl('squoosh_png_bg.wasm'));
        return codec.default;
    });
}

/** @returns {Promise<(buffer: ArrayBuffer) => Promise<ImageData>>} */
export function loadPngDecoder() {
    return once('png:decode', async () => {
        const codec = await import('@jsquash/png/decode');
        await codec.init(wasmUrl('squoosh_png_bg.wasm'));
        return codec.default;
    });
}

/* ------------------------------------------------------------------ WebP */

/**
 * The WebP encoder picks between a SIMD and a scalar build at init time via
 * wasm-feature-detect, so `locateFile` sees one of two names. That is exactly
 * why locateFile passes the requested name through.
 *
 * @returns {Promise<(imageData: ImageData, options?: object) => Promise<ArrayBuffer>>}
 */
export function loadWebpEncoder() {
    return once('webp:encode', async () => {
        const codec = await import('@jsquash/webp/encode');
        await codec.init({ locateFile });
        return codec.default;
    });
}

/** @returns {Promise<(buffer: ArrayBuffer) => Promise<ImageData>>} */
export function loadWebpDecoder() {
    return once('webp:decode', async () => {
        const codec = await import('@jsquash/webp/decode');
        await codec.init({ locateFile });
        return codec.default;
    });
}

/* ------------------------------------------------------------------ AVIF */

/**
 * The AVIF ENCODER, and only the encoder.
 *
 * @jsquash/avif ships a decoder too and it must never be imported: every engine
 * this site is tested on decodes AVIF natively through `createImageBitmap`, and
 * the WASM decoder measured 3.4-4.9x slower than libvips with 13.9 MB of heap
 * per megapixel — 267 KB brotli to do worse than nothing. A test greps lib/ for
 * the string.
 *
 * TWO THINGS ARE DIFFERENT FROM THE OTHER LOADERS HERE.
 *
 *  1. THE MODULE COMES BACK BESIDE THE FUNCTION. libavif's heap never shrinks:
 *     one 12 MP encode grows it to 345 MB and it stays there for the life of
 *     the worker. `module.HEAPU8.byteLength` is the only honest reading of that,
 *     and lib/image-client/client.js recycles the worker on it. Every other
 *     codec here returns a bare function because nothing needs to ask.
 *
 *  2. THE PACKAGE CHOOSES A BUILD. `init()` asks wasm-feature-detect whether
 *     WebAssembly threads are available, and takes the multi-threaded build if
 *     they are. That check needs a SharedArrayBuffer, which needs cross-origin
 *     isolation, which needs the COOP and COEP headers next.config.js does not
 *     send — so the single-threaded build is what loads. scripts/copy-wasm.js
 *     copies only avif_enc.wasm, so a change that ever flipped that branch
 *     would 404 loudly rather than quietly shipping a second 3.5 MB binary.
 *
 * @returns {Promise<{ encode: (imageData: ImageData, options?: object) => Promise<ArrayBuffer>,
 *                     module: { HEAPU8: Uint8Array } }>}
 */
export function loadAvifEncoder() {
    return once('avif:encode', async () => {
        const codec = await import('@jsquash/avif/encode');
        // Not named `module`: Next forbids assigning that identifier, because
        // it is the CommonJS one and a bundler cannot tell the two apart.
        const instance = await codec.init({ locateFile });
        return { encode: codec.default, module: instance };
    });
}

/* ---------------------------------------------------------------- Resize */

/**
 * `resize()` calls `initResize()` with no argument on its own, which would send
 * the loader looking for the binary next to the chunk. Calling `initResize`
 * with the served URL first wins the memoisation race inside the package, so
 * the later bare call is a no-op.
 *
 * @returns {Promise<(imageData: ImageData, options: object) => Promise<ImageData>>}
 */
export function loadResizer() {
    return once('resize', async () => {
        const codec = await import('@jsquash/resize');
        await codec.initResize(wasmUrl('squoosh_resize_bg.wasm'));
        return codec.default;
    });
}

/* ------------------------------------------------------------------ HEIF */

/**
 * libheif's browser bundle default-exports a factory that is synchronous
 * (the WASM is inlined and instantiated eagerly), but it is awaited anyway:
 * awaiting a non-promise costs one microtask and keeps this working if a
 * future build goes async.
 *
 * @returns {Promise<{ HeifDecoder: Function }>} the libheif module namespace
 */
export function loadHeifDecoder() {
    return once('heif:decode', async () => {
        const codec = await import('libheif-js/libheif-wasm/libheif-bundle.mjs');
        const libheif = await codec.default();
        if (!libheif || typeof libheif.HeifDecoder !== 'function') {
            throw new Error('The HEIC decoder failed to start.');
        }
        return libheif;
    });
}
