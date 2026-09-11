#!/usr/bin/env node
/**
 * WASM Binary Sync
 *
 * Every emscripten and wasm-bindgen codec resolves its `.wasm` sibling from
 * `import.meta.url`. Under Next that URL points into the bundler's chunk space,
 * not into node_modules, so the fetch 404s and no codec ever starts. The fix is
 * to serve the binaries ourselves from `public/wasm/` and hand each loader an
 * absolute site path (see lib/image-client/codecs.js).
 *
 * The copies are committed, so a clean checkout builds without running this.
 * That is also the failure mode this script exists to prevent: a dependency
 * bump ships a new binary into node_modules while the committed copy stays at
 * the old version, and the mismatch only shows up as a wasm link error in a
 * user's browser. Wiring it to `postinstall` means the copies are refreshed the
 * moment the dependency moves, and `git status` shows the drift.
 *
 * libheif is deliberately absent from this list: libheif-js ships its browser
 * bundle with the wasm base64-inlined into libheif-bundle.mjs, so there is no
 * separate binary to serve.
 *
 * Usage: node scripts/copy-wasm.js   (wired as `npm run wasm:copy`)
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const MODULES = path.join(ROOT, 'node_modules');
const DEST_DIR = path.join(ROOT, 'public', 'wasm');

// Left side is the path inside node_modules; the file is served as its
// basename, because that is the name the emscripten glue asks locateFile for
// and the name the wasm-bindgen loaders are pointed at.
//
// @jsquash/avif ships four binaries and exactly one of them is here. The
// DECODER is not served because AVIF decoding is the browser's own — no module
// in lib/ imports it, and a test greps for the string. The MULTI-THREADED
// encoder is not served because it needs cross-origin isolation this site does
// not have; leaving it out means a change that ever selected it fails on a 404
// instead of shipping a second 3.5 MB file nobody asked for.
const SOURCES = [
    '@jsquash/avif/codec/enc/avif_enc.wasm',
    '@jsquash/jpeg/codec/enc/mozjpeg_enc.wasm',
    '@jsquash/jpeg/codec/dec/mozjpeg_dec.wasm',
    '@jsquash/png/codec/pkg/squoosh_png_bg.wasm',
    '@jsquash/webp/codec/enc/webp_enc.wasm',
    '@jsquash/webp/codec/enc/webp_enc_simd.wasm',
    '@jsquash/webp/codec/dec/webp_dec.wasm',
    '@jsquash/resize/lib/resize/pkg/squoosh_resize_bg.wasm',
];

function main() {
    if (!fs.existsSync(MODULES)) {
        // postinstall on a workspace that has not resolved yet. Nothing to copy
        // and nothing to complain about.
        console.log('copy-wasm: node_modules is absent, skipping.');
        return;
    }

    fs.mkdirSync(DEST_DIR, { recursive: true });

    const missing = [];
    let copied = 0;
    let unchanged = 0;

    for (const relative of SOURCES) {
        const source = path.join(MODULES, relative);
        const destination = path.join(DEST_DIR, path.basename(relative));

        if (!fs.existsSync(source)) {
            missing.push(relative);
            continue;
        }

        const bytes = fs.readFileSync(source);

        if (fs.existsSync(destination) && fs.readFileSync(destination).equals(bytes)) {
            unchanged += 1;
            continue;
        }

        fs.writeFileSync(destination, bytes);
        copied += 1;
        console.log(`copy-wasm: updated public/wasm/${path.basename(relative)} (${bytes.length} bytes)`);
    }

    if (missing.length > 0) {
        // A renamed or removed binary is exactly the drift this guards against,
        // so it fails the install rather than leaving a stale copy in place.
        console.error('copy-wasm: these binaries are missing from node_modules:');
        for (const relative of missing) console.error(`  - ${relative}`);
        process.exitCode = 1;
        return;
    }

    console.log(`copy-wasm: ${copied} updated, ${unchanged} already current.`);
}

main();
