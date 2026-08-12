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

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const APP_DIR = path.join(ROOT, 'app');

/* ------------------------------------------------------------------ *
 * Routes
 * ------------------------------------------------------------------ */

/**
 * Every route the App Router actually serves, derived from the page.js files
 * on disk with the (group) segments stripped. A link assertion that checks a
 * registry against itself proves nothing; this checks it against the routes.
 */
export const APP_ROUTES = new Set(
    fs
        .readdirSync(APP_DIR, { recursive: true })
        .map((entry) => String(entry))
        .filter((entry) => path.basename(entry) === 'page.js')
        .map((entry) => {
            const segments = entry
                .split(path.sep)
                .slice(0, -1)
                .filter((segment) => !segment.startsWith('('));
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
 * A scriptable XMLHttpRequest. useToolSubmit uses XHR rather than fetch
 * because fetch cannot report upload progress, so this is what the hook
 * actually talks to.
 */
export function installFakeXhr() {
    const original = window.XMLHttpRequest;
    const requests = [];

    class FakeXhr {
        constructor() {
            this.upload = {};
            this.status = 0;
            this.response = null;
            this.responseType = '';
            // Real XHR exposes `timeout` as a numeric property (ms), which the
            // hook assigns to arm its request timer. It is NOT the trigger —
            // use fireTimeout() to raise the ontimeout event.
            this.timeout = 0;
            this.sentBody = null;
            this.aborted = false;
            this._rawHeaders = '';
            requests.push(this);
        }

        open(method, url) {
            this.method = method;
            this.url = url;
        }

        send(body) {
            this.sentBody = body;
        }

        abort() {
            this.aborted = true;
            this.onabort?.();
        }

        getAllResponseHeaders() {
            return this._rawHeaders;
        }

        /** Drives upload progress the way a real XHR would. */
        uploadProgress(loaded, total) {
            this.upload.onprogress?.({ lengthComputable: true, loaded, total });
        }

        uploadDone() {
            this.upload.onload?.();
        }

        /** Completes the request. Returns the hook's onload promise. */
        respond({ status = 200, headers = {}, body = null } = {}) {
            this.status = status;
            this._rawHeaders = Object.entries(headers)
                .map(([name, value]) => `${name}: ${value}`)
                .join('\r\n');
            this.response = body;
            return this.onload?.();
        }

        networkError() {
            this.onerror?.();
        }

        /** Raises the request-timeout event the way a real XHR would. */
        fireTimeout() {
            this.ontimeout?.();
        }
    }

    window.XMLHttpRequest = FakeXhr;

    return {
        requests,
        last: () => requests[requests.length - 1],
        restore() {
            window.XMLHttpRequest = original;
        },
    };
}

/** A response blob of a given byte length. */
export function blobOfSize(bytes, type = 'image/webp') {
    return new Blob([new Uint8Array(bytes)], { type });
}
