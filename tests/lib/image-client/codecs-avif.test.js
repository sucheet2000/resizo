/**
 * The AVIF encoder is the only codec on this site with a DECODER in the same
 * package that must never ship.
 *
 * @jsquash/avif carries both halves: avif_enc.wasm at 3,485,872 bytes raw and
 * avif_dec.wasm at 1,170,930. The decode is the browser's own — every engine in
 * the test matrix reads AVIF natively, and the package's WASM decoder measured
 * 3.4-4.9x slower than libvips and 13.9 MB of heap per megapixel — so importing
 * `@jsquash/avif/decode` anywhere would add 267 KB brotli to do a job the
 * platform already does for nothing. There is no code path that wants it, so
 * the rule is mechanical: the string must not appear in lib/ at all.
 *
 * The second rule is about the OTHER file nobody must fetch. The package picks
 * between a single-threaded build and a multi-threaded one at init time, by
 * asking wasm-feature-detect whether WebAssembly threads work. That check needs
 * a SharedArrayBuffer, which needs cross-origin isolation, which needs COOP and
 * COEP headers this site does not send (next.config.js). So the single-threaded
 * build is what runs — and only avif_enc.wasm is copied into public/wasm, so a
 * regression that flipped the branch would 404 rather than silently ship a
 * second 3.5 MB binary.
 *
 * Everything here is about what is LOADED, not about what the encoder produces.
 * The pixels are avif-encode.test.js and convert-avif.test.js.
 */
import { readFile } from 'node:fs/promises';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { isCodecLoading, loadAvifEncoder, resetCodecs, wasmUrl } from '@/lib/image-client/codecs';

import { installBrowserEnv } from './helpers/browser-env';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

/** Every .js file under lib/, read once. */
async function libSources() {
    const { execFileSync } = await import('node:child_process');
    const listed = execFileSync('find', ['lib', '-name', '*.js', '-type', 'f'], {
        cwd: repoRoot,
        encoding: 'utf8',
    });

    const files = listed.split('\n').filter(Boolean);
    const sources = await Promise.all(
        files.map(async (file) => [file, await readFile(path.join(repoRoot, file), 'utf8')]),
    );

    return sources;
}

/* ------------------------------------------------------------------ *
 * 1. The decoder module is never imported
 * ------------------------------------------------------------------ */

describe('the AVIF decoder that is not shipped', () => {
    let sources;

    beforeAll(async () => {
        sources = await libSources();
    });

    it('reads the files it is asserting about', () => {
        expect(sources.length).toBeGreaterThan(40);
        expect(sources.map(([file]) => file)).toContain('lib/image-client/codecs.js');
    });

    it('is named nowhere in lib/, in any import form', () => {
        const offenders = sources
            .filter(([, source]) => /@jsquash\/avif\/decode/.test(source))
            .map(([file]) => file);

        expect(
            offenders,
            'AVIF decoding is the browser\'s own; importing the WASM decoder ships 267 KB ' +
                'brotli to do it 4x slower:\n  ' + offenders.join('\n  '),
        ).toEqual([]);
    });

    it('has no binary served for it either', async () => {
        const copyWasm = await readFile(path.join(repoRoot, 'scripts/copy-wasm.js'), 'utf8');

        expect(copyWasm).not.toContain('avif_dec');
        expect(copyWasm).toContain('@jsquash/avif/codec/enc/avif_enc.wasm');
    });

    /**
     * The multi-threaded encoder needs cross-origin isolation the site does not
     * have, so it is never reached — and is never copied, so a regression that
     * did reach it would fail loudly on a 404 instead of doubling the download.
     */
    /**
     * The package's own encode.js decides at runtime between the threaded and
     * the single-threaded build, and the threaded glue spawns a nested worker
     * from import.meta.url. A bundler that follows that graph hangs — the
     * first production build carrying this package never finished — so the
     * loader imports the single-threaded emscripten glue directly and the
     * wrapper never enters the bundle.
     */
    it('imports the single-threaded glue itself, never the package wrapper that reaches the threaded build', () => {
        // Code only: the comments above the loader are allowed to explain the
        // threaded build by name, the imports are not allowed to reach it.
        const source = fs.readFileSync(path.join(repoRoot, 'lib', 'image-client', 'codecs.js'), 'utf8')
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/^\s*\/\/.*$/gm, '');
        expect(source).toContain("'@jsquash/avif/codec/enc/avif_enc.js'");
        expect(source).not.toContain("'@jsquash/avif/encode'");
        expect(source).not.toContain('avif_enc_mt');
        expect(source).not.toContain('wasm-feature-detect');
    });

    it('ships no multi-threaded encoder build either', async () => {
        const copyWasm = await readFile(path.join(repoRoot, 'scripts/copy-wasm.js'), 'utf8');

        expect(copyWasm).not.toContain('avif_enc_mt');
    });
});

/* ------------------------------------------------------------------ *
 * 2. The binary that IS served
 * ------------------------------------------------------------------ */

describe('public/wasm/avif_enc.wasm', () => {
    it('is committed and byte-identical to the one in node_modules', async () => {
        const served = await readFile(path.join(repoRoot, 'public/wasm/avif_enc.wasm'));
        const packaged = await readFile(
            path.join(repoRoot, 'node_modules/@jsquash/avif/codec/enc/avif_enc.wasm'),
        );

        expect(served.equals(packaged)).toBe(true);
        expect(served.length).toBe(3_485_872);
    });

    it('is addressed by a site-absolute path, like every other codec', () => {
        expect(wasmUrl('avif_enc.wasm')).toBe('/wasm/avif_enc.wasm');
    });
});

/* ------------------------------------------------------------------ *
 * 3. The third-party notices the binary obliges
 * ------------------------------------------------------------------ */

describe('the notices that travel with the encoder', () => {
    /**
     * Shipping avif_enc.wasm distributes libaom in binary form, and the
     * Alliance for Open Media Patent License 1.0 section 1.2.1 requires the
     * licence text to accompany the Implementation. The npm tarball carries
     * only jSquash's own Apache-2.0 text, so the other three are reproduced
     * here or the obligation is unmet.
     */
    it('reproduces all four licences in full, with the version they cover', async () => {
        const notices = await readFile(path.join(repoRoot, 'public/licenses/avif-encoder-notices.txt'), 'utf8');

        expect(notices).toContain('@jsquash/avif 2.1.1');
        expect(notices).toContain('avif_enc.wasm');

        // Apache-2.0 (jSquash / Squoosh), libavif BSD-2, libaom BSD-2, and the
        // patent grant that is the reason this file exists at all.
        expect(notices).toContain('Apache License');
        expect(notices).toContain('Redistribution and use in source and binary forms');
        expect(notices).toContain('Alliance for Open Media Patent License 1.0');
        expect(notices).toContain('1.2.1');
        expect(notices.length).toBeGreaterThan(30_000);
    });
});

/* ------------------------------------------------------------------ *
 * 4. Loading it
 * ------------------------------------------------------------------ */

describe('loading the AVIF encoder', () => {
    beforeEach(() => {
        installBrowserEnv();
        resetCodecs();
    });

    it('is not loading before anything has asked for it', () => {
        expect(isCodecLoading('avif:encode')).toBe(false);
    });

    it('hands two callers in the same tick the same promise', () => {
        const first = loadAvifEncoder();
        const second = loadAvifEncoder();

        expect(first).toBe(second);
        expect(isCodecLoading('avif:encode')).toBe(true);
    });

    /**
     * The module object is handed back beside the encode function because the
     * WASM heap is what decides whether the worker is recycled afterwards, and
     * `HEAPU8.byteLength` is the only honest reading of it. Measured: 16 MB
     * after init, 60 MB after one 1.7 MP encode, 345 MB after a 12 MP one, and
     * it never shrinks.
     */
    it('hands back the encode function and the module whose heap can be read', async () => {
        const { encode, module } = await loadAvifEncoder();

        expect(typeof encode).toBe('function');
        expect(module.HEAPU8.byteLength).toBeGreaterThan(0);
    }, 60_000);

    /**
     * The lazy contract, proved where it is cheapest to prove. 842 KB brotli
     * must not be fetched by a visitor who converts a JPEG to a PNG, or who
     * opens an AVIF and writes a JPEG — the decode side is the browser's own
     * and touches no codec here at all. tests/e2e/contracts/lazy-loading.spec.js
     * holds the same line over real network requests.
     */
    it('is untouched by a job that does not write an AVIF', async () => {
        const { runOperation } = await import('@/lib/image-client/operations');
        const png = await (await import('sharp')).default({
            create: { width: 32, height: 24, channels: 3, background: { r: 10, g: 20, b: 30 } },
        }).png().toBuffer();

        await runOperation('convert', new File([png], 'photo.png', { type: 'image/png' }), {
            format: 'jpeg',
            sourceWidth: 32,
            sourceHeight: 24,
        });

        expect(isCodecLoading('avif:encode')).toBe(false);
        expect(isCodecLoading('jpeg:encode')).toBe(true);
    }, 60_000);

    it('asks for the single-threaded binary and never the threaded one', async () => {
        const requested = [];
        const realFetch = globalThis.fetch;

        globalThis.fetch = async (input, init) => {
            const url = typeof input === 'string' ? input : input?.url ?? String(input);
            if (url.startsWith('/wasm/')) requested.push(path.basename(url));
            return realFetch(input, init);
        };

        try {
            await loadAvifEncoder();
        } finally {
            globalThis.fetch = realFetch;
        }

        expect(requested).toContain('avif_enc.wasm');
        expect(requested).not.toContain('avif_enc_mt.wasm');
    }, 60_000);
});
