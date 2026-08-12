/**
 * The two browser globals the client engine legitimately depends on, provided
 * to Node so the WASM codecs can be exercised for real instead of mocked.
 *
 *  - ImageData. Every @jsquash codec speaks ImageData, and lib/image-client
 *    constructs one for the HEIC path. Node has no such class. The polyfill is
 *    the spec's shape and nothing else: three own properties over a
 *    Uint8ClampedArray. That it is this small is the point — an ImageData
 *    carries pixels and nothing else, which is why no metadata can ride
 *    through the engine (see guarantees.test.js).
 *
 *  - fetch of '/wasm/<name>.wasm'. codecs.js points every codec at the copies
 *    served from public/wasm — a site-absolute path, which is correct in a
 *    browser and unparseable in Node. The shim resolves exactly that prefix
 *    against the real public/wasm directory and delegates everything else, so
 *    the test loads the same binaries the site ships.
 *
 * Nothing here is a stub of the engine. The codecs, the pixels and the encoded
 * bytes are all real.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const WASM_DIR = path.join(repoRoot, 'public', 'wasm');

class NodeImageData {
    constructor(dataOrWidth, widthOrHeight, maybeHeight) {
        if (typeof dataOrWidth === 'number') {
            const width = dataOrWidth;
            const height = widthOrHeight;
            this.data = new Uint8ClampedArray(width * height * 4);
            this.width = width;
            this.height = height;
        } else {
            this.data = dataOrWidth;
            this.width = widthOrHeight;
            this.height = maybeHeight ?? dataOrWidth.length / 4 / widthOrHeight;
        }
        this.colorSpace = 'srgb';
    }
}

let installed = false;

export function installBrowserEnv() {
    if (installed) return;
    installed = true;

    if (typeof globalThis.ImageData === 'undefined') {
        globalThis.ImageData = NodeImageData;
    }

    const realFetch = globalThis.fetch;

    globalThis.fetch = async function wasmAwareFetch(input, init) {
        const url = typeof input === 'string' ? input : input?.url ?? String(input);

        if (url.startsWith('/wasm/')) {
            const bytes = await readFile(path.join(WASM_DIR, path.basename(url)));
            return new Response(bytes, {
                status: 200,
                headers: { 'content-type': 'application/wasm' },
            });
        }

        return realFetch(input, init);
    };
}
