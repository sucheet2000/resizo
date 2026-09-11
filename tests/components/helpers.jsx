/**
 * Shared fixtures for the component + hook suite.
 *
 * Everything here exists because a browser API the app depends on is either
 * absent from jsdom (object URLs, image decoding, upload progress) or would
 * navigate the test runner (an anchor click). Nothing here weakens an
 * assertion — each stub reproduces the real API's contract and lets the test
 * drive its timing.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { INTENTS } from '@/lib/catalog';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const APP_DIR = path.join(ROOT, 'app');

/* ------------------------------------------------------------------ *
 * Routes
 * ------------------------------------------------------------------ */

/**
 * Every route the App Router actually serves, derived from the page.js files
 * on disk with the (group) segments stripped. A link assertion that checks a
 * registry against itself proves nothing; this checks it against the routes.
 *
 * The one dynamic segment, app/(tools)/[slug], serves exactly the intents in
 * the registry (generateStaticParams lists them and dynamicParams is off), so
 * it expands to their paths — and only while that page.js exists.
 */
export const APP_ROUTES = new Set(
    fs
        .readdirSync(APP_DIR, { recursive: true })
        .map((entry) => String(entry))
        .filter((entry) => path.basename(entry) === 'page.js')
        .flatMap((entry) => {
            const segments = entry
                .split(path.sep)
                .slice(0, -1)
                .filter((segment) => !segment.startsWith('('));
            if (segments.length === 1 && segments[0] === '[slug]') return INTENTS.map((intent) => intent.path);
            return segments.length === 0 ? '/' : `/${segments.join('/')}`;
        }),
);

/** True when a href such as `/resize#bulk` or `/about` resolves to a real page.js. */
export function routeExists(href) {
    if (typeof href !== 'string' || href === '') return false;
    if (href.startsWith('mailto:') || href.startsWith('http')) return true;
    const [pathname] = href.split('#');
    return APP_ROUTES.has(pathname === '' ? '/' : pathname);
}

/* ------------------------------------------------------------------ *
 * Files
 * ------------------------------------------------------------------ */

function bytesFor(format) {
    if (format === 'jpeg') return new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    if (format === 'png') return new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0, 0, 0, 0, 0]);
    if (format === 'gif') return new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);

    if (format === 'webp') {
        const out = new Uint8Array(16);
        for (const [text, at] of [['RIFF', 0], ['WEBP', 8]]) {
            for (let i = 0; i < text.length; i += 1) out[at + i] = text.charCodeAt(i);
        }
        return out;
    }

    // A HEIC *header*, and only a header: the ftyp box with the 'heic' major
    // brand, which is exactly what sniffImageType reads. There is deliberately
    // no HEVC payload behind it — sharp cannot encode one, so a real decodable
    // HEIC cannot be committed to this repo, and a hand-written stand-in would
    // be a lie the decode tests would then be written against. Anything that
    // needs pixels out of a HEIC is verified in a browser, not here.
    if (format === 'heic') {
        const out = new Uint8Array(16);
        out[3] = 16;
        for (const [text, at] of [['ftyp', 4], ['heic', 8]]) {
            for (let i = 0; i < text.length; i += 1) out[at + i] = text.charCodeAt(i);
        }
        return out;
    }

    // A REAL AVIF, not a header: the intake reads the container (size,
    // brands, animation) before it accepts one, so sixteen bytes of ftyp would
    // be refused as damaged. The committed 96 x 64 still under
    // tests/fixtures/avif (it carries an irot property, which no test here
    // reads) is the smallest real file in the tree.
    if (format === 'avif') {
        return new Uint8Array(fs.readFileSync(path.join(ROOT, 'tests', 'fixtures', 'avif', 'irot-90.avif')));
    }

    // A PDF header: a real file, and one no image tool accepts.
    return new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2D, 0x31, 0x2E, 0x37, 0, 0, 0, 0, 0, 0, 0, 0]);
}

/**
 * A File carrying a real magic-byte signature, so the hook's sniff sees the
 * same bytes the server would. `size` overrides the reported length without
 * allocating megabytes, which is how the too-large path is exercised.
 */
export function imageFile(name = 'photo.jpg', format = 'jpeg', { size, type } = {}) {
    const file = new File([bytesFor(format)], name, {
        type: type ?? (format === 'other' ? 'application/pdf' : `image/${format}`),
    });

    if (Number.isFinite(size)) {
        Object.defineProperty(file, 'size', { value: size, configurable: true });
    }

    return file;
}

/** A file that is not an image at all, whatever its name and MIME type claim. */
export function disguisedFile(name = 'photo.jpg') {
    return imageFile(name, 'other', { type: 'image/jpeg' });
}

/** An array-like the file input's change handler reads exactly like a FileList. */
export function fileList(files) {
    const list = {
        length: files.length,
        item: (index) => files[index] ?? null,
        [Symbol.iterator]: function* iterate() {
            yield* files;
        },
    };
    files.forEach((file, index) => {
        list[index] = file;
    });
    return list;
}

/** Puts a FileList on a real <input type="file"> and fires the change. */
export function setInputFiles(input, files) {
    Object.defineProperty(input, 'files', { value: fileList(files), configurable: true });
}

/* ------------------------------------------------------------------ *
 * Browser APIs jsdom does not implement
 * ------------------------------------------------------------------ */

/**
 * Replaces `window.Image` with a probe whose load is driven by the test.
 * useImageUpload measures dimensions through `new window.Image()`, and jsdom
 * never fires load for a blob: URL, so without this every upload would hang on
 * an unresolved promise.
 */
export function stubImageProbe({ width = 1200, height = 800, fail = false } = {}) {
    const original = window.Image;
    const state = { width, height, fail };
    const probes = [];

    class ProbeImage {
        constructor() {
            this.naturalWidth = 0;
            this.naturalHeight = 0;
            this.onload = null;
            this.onerror = null;
            probes.push(this);
        }

        set src(value) {
            this._src = value;
            queueMicrotask(() => {
                if (state.fail) {
                    this.onerror?.();
                    return;
                }
                this.naturalWidth = state.width;
                this.naturalHeight = state.height;
                this.onload?.();
            });
        }

        get src() {
            return this._src;
        }
    }

    window.Image = ProbeImage;

    return {
        probes,
        configure(next) {
            Object.assign(state, next);
        },
        restore() {
            window.Image = original;
        },
    };
}

/**
 * A witness for the central promise: nothing leaves the browser.
 *
 * This used to be a scriptable XMLHttpRequest, because useToolSubmit talked to
 * XHR (fetch cannot report upload progress) and the tests scripted responses
 * through it. There is no upload path left to script. What the tests need now
 * is the opposite instrument — something that records ANY attempt to send data
 * anywhere, so "the image was processed on the device" is asserted from the
 * network side and not merely from the engine having been called.
 *
 * All three ways a page could exfiltrate a file are covered: XMLHttpRequest,
 * fetch, and sendBeacon (which survives a page unload and would be the quiet
 * way to do it). Each is replaced by a recorder that throws, so a regression
 * shows up as a failed test naming the URL rather than as a silent request.
 */
export function installNetworkSentinel() {
    const calls = [];
    const original = {
        xhr: window.XMLHttpRequest,
        fetch: globalThis.fetch,
        beacon: navigator.sendBeacon,
    };

    function record(via, url) {
        calls.push({ via, url: String(url) });
        throw new Error(`Network access is not allowed: ${via} ${url}`);
    }

    class BlockedXhr {
        open(method, url) {
            record('xhr', url);
        }
    }

    window.XMLHttpRequest = BlockedXhr;
    globalThis.fetch = (input) => record('fetch', input?.url ?? input);
    // sendBeacon is not configurable on every jsdom build; when it cannot be
    // replaced the other two still cover every path the app has.
    try {
        navigator.sendBeacon = (url) => record('sendBeacon', url);
    } catch {
        // Left as it was.
    }

    return {
        calls,
        restore() {
            window.XMLHttpRequest = original.xhr;
            globalThis.fetch = original.fetch;
            try {
                navigator.sendBeacon = original.beacon;
            } catch {
                // Never replaced.
            }
        },
    };
}

/** A response blob of a given byte length. */
export function blobOfSize(bytes, type = 'image/webp') {
    return new Blob([new Uint8Array(bytes)], { type });
}
