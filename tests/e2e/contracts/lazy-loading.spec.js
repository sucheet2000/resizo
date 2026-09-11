const path = require('node:path');

const { test, expect } = require('../fixtures/resizo');
const { opaqueAvif } = require('../fixtures/files');

/**
 * THE USER-VISIBLE HALF OF ARCHITECTURE RULE 4.
 *
 * tests/architecture/boundaries.test.js proves that jszip, @cantoo/pdf-lib,
 * @jsquash/* and libheif-js appear only behind import(). That is a claim about
 * source. This is the claim about the wire: a person who opens /resize to
 * resize one JPEG is not made to download the HEIC decoder, the PDF library or
 * the archiver, and no codec at all is fetched before there is a file to run
 * it on. Then a JPEG resize fetches the one encoder it needs, and a HEIC
 * conversion fetches the decoder it needs, at that moment and not before.
 *
 * Chunk hashes change on every build, so nothing here names a chunk. A
 * package is recognised by a string that exists only inside its own bundle —
 * every script response the page loads is read and searched — and a codec is
 * recognised by the stable filename scripts/copy-wasm.js gives it under
 * public/wasm/. The libheif bundle inlines its wasm as base64, so it is found
 * by its script marker rather than by a .wasm request.
 */
const SAMPLE = path.join(__dirname, '..', '..', '..', 'public', 'samples', 'landscape-1600x1067.jpg');
const HEIC = path.join(__dirname, '..', 'fixtures', 'assets', 'sample-96x64.heic');

/** The AVIF encoder's filename under public/wasm, from scripts/copy-wasm.js. */
const AVIF_ENCODER = /avif_enc/;

/**
 * ANY AVIF DECODER AT ALL. There is no such file in this build and there must
 * never be one: the measured WASM decoder grew a 12 megapixel decode to 449 MB
 * of heap, which is why AVIF is read by the browser's own decoder instead. A
 * request matching this pattern means somebody shipped one.
 */
const AVIF_DECODER = /avif_dec/;

/** A string each lazy package carries in its bundle and nothing else on the site does. */
const LAZY_PACKAGES = {
    'libheif-js': /libheif/,
    jszip: /JSZip/,
    '@cantoo/pdf-lib': /pdf-lib/,
};

/** Every JavaScript file the page or its worker loaded, with its body, plus every .wasm asked for. */
function watchResources(page) {
    const scripts = [];
    const wasm = [];
    page.on('request', (request) => {
        if (request.url().endsWith('.wasm')) wasm.push(new URL(request.url()).pathname);
    });
    page.on('response', (response) => {
        // The worker loads its chunks through the loader Turbopack gives it,
        // which the browser reports as "other" rather than "script"; the URL
        // is the reliable signal of what is JavaScript.
        if (!/\.js(\?|$)/.test(response.url())) return;
        scripts.push(
            response.text()
                .then((body) => ({ url: response.url(), body }))
                .catch(() => ({ url: response.url(), body: null })),
        );
    });
    return {
        wasm,
        async scripts() {
            return Promise.all(scripts);
        },
    };
}

async function loadedPackages(resources) {
    const scripts = await resources.scripts();
    const readable = scripts.filter((script) => typeof script.body === 'string');
    // The check is only as good as the bodies it read: a page whose scripts
    // could not be read would pass every "not loaded" assertion for nothing.
    expect(readable.length, 'script bodies read').toBeGreaterThan(3);
    return Object.entries(LAZY_PACKAGES)
        .filter(([, marker]) => readable.some((script) => marker.test(script.body)))
        .map(([name]) => name);
}

test('/resize fetches no HEIC decoder, PDF library, archiver or codec until a JPEG is resized', async ({ page, tool }) => {
    test.setTimeout(120_000);
    const resources = watchResources(page);

    await page.goto('/resize');
    await page.waitForLoadState('networkidle');

    expect(await loadedPackages(resources), 'lazy packages fetched on page load').toEqual([]);
    expect(resources.wasm, 'codecs fetched before any file was chosen').toEqual([]);

    await tool.pick(SAMPLE);
    await page.getByLabel('Width (px)', { exact: true }).fill('800');
    await tool.run(/resize image/i);

    // The JPEG encoder is the one codec this job needs, and it arrives now.
    expect(resources.wasm.some((file) => file.endsWith('/mozjpeg_enc.wasm')), `wasm fetched: ${resources.wasm.join(', ')}`).toBe(true);
    // WebP's encoder is not needed for a JPEG job and is not fetched for it.
    expect(resources.wasm.filter((file) => /webp_enc/.test(file))).toEqual([]);
    expect(await loadedPackages(resources), 'lazy packages fetched by a JPEG resize').toEqual([]);
});

test('/heic fetches the HEIC decoder only once a HEIC is converted', async ({ page, tool }) => {
    test.setTimeout(120_000);
    const resources = watchResources(page);

    await page.goto('/heic');
    await page.waitForLoadState('networkidle');

    expect(await loadedPackages(resources), 'lazy packages fetched on page load').toEqual([]);

    await tool.pick(HEIC);
    await tool.run('Convert to JPG', { download: 'Download JPG', timeout: 60_000 });

    const loaded = await loadedPackages(resources);
    expect(loaded, 'the HEIC decoder arrives with the job').toContain('libheif-js');
    expect(loaded.filter((name) => name !== 'libheif-js'), 'packages the job did not need').toEqual([]);
});


/* ------------------------------------------------------------------ *
 * AVIF — the one format whose two directions cost different downloads
 * ------------------------------------------------------------------ */

/**
 * WHY AVIF GETS FOUR TESTS OF ITS OWN WHEN NO OTHER FORMAT GETS ONE.
 *
 * `avif_enc.wasm` is 842 KB brotli — three times the largest codec already on
 * this site and more than the whole first load of any page here. It is also
 * the only codec whose two directions are served by different things: reading
 * an AVIF costs nothing to download because the browser already has a decoder,
 * and writing one costs the whole encoder. So the wrong version of this feature
 * is not slow, it is invisible: every visitor to /convert pays 842 KB, most of
 * them to convert a PNG to a JPG.
 *
 * The contract is therefore sharper than "lazy": the encoder arrives when, and
 * only when, the output is an AVIF. And no AVIF DECODER is ever fetched,
 * because none is shipped.
 */

test('/convert fetches no codec before a file is chosen, and no AVIF encoder for a JPEG to PNG job', async ({ page, tool }) => {
    test.setTimeout(120_000);
    const resources = watchResources(page);

    await page.goto('/convert');
    await page.waitForLoadState('networkidle');

    expect(await loadedPackages(resources), 'lazy packages fetched on page load').toEqual([]);
    expect(resources.wasm, 'codecs fetched before any file was chosen').toEqual([]);

    await page.selectOption('#convert-to', 'png');
    await tool.pick(SAMPLE);
    await tool.run('Convert to PNG', { download: 'Download PNG', timeout: 60_000 });

    // The PNG encoder is what this job needs, and it is what arrived.
    expect(resources.wasm.some((file) => /squoosh_png/.test(file)), `wasm fetched: ${resources.wasm.join(', ')}`).toBe(true);
    expect(resources.wasm.filter((file) => AVIF_ENCODER.test(file)), 'the AVIF encoder was fetched for a PNG job').toEqual([]);
    expect(resources.wasm.filter((file) => AVIF_DECODER.test(file))).toEqual([]);
});

test('/convert opens an AVIF without fetching any AVIF codec at all', async ({ page, tool }) => {
    test.setTimeout(120_000);
    const resources = watchResources(page);

    await page.goto('/convert');
    await page.waitForLoadState('networkidle');
    expect(resources.wasm, 'codecs fetched before any file was chosen').toEqual([]);

    await page.selectOption('#convert-to', 'jpeg');
    await tool.pick(await opaqueAvif());
    await tool.run(/convert to jpe?g/i, { download: /^Download/, timeout: 60_000 });

    // THE DECODER/ENCODER SPLIT, AS A NETWORK FACT. The AVIF went in, a JPEG
    // came out, and the only binary that crossed the wire was the JPEG
    // encoder — the decode was the browser's own.
    expect(resources.wasm.some((file) => /mozjpeg_enc/.test(file)), `wasm fetched: ${resources.wasm.join(', ')}`).toBe(true);
    expect(
        resources.wasm.filter((file) => AVIF_ENCODER.test(file) || AVIF_DECODER.test(file)),
        `an AVIF codec was fetched to READ an AVIF: ${resources.wasm.join(', ')}`,
    ).toEqual([]);
});

test('/convert fetches the AVIF encoder only once the output is an AVIF', async ({ page, tool }) => {
    test.setTimeout(120_000);
    const resources = watchResources(page);

    await page.goto('/convert');
    await page.waitForLoadState('networkidle');

    // Choosing AVIF is not running an AVIF job: the 842 KB arrives with the
    // work, not with the intention.
    await page.selectOption('#convert-to', 'avif');
    await page.waitForLoadState('networkidle');
    expect(resources.wasm.filter((file) => AVIF_ENCODER.test(file)), 'the encoder was fetched by the select alone').toEqual([]);

    await tool.pick(SAMPLE);
    await tool.run('Convert to AVIF', { download: 'Download AVIF', timeout: 90_000 });

    expect(
        resources.wasm.some((file) => AVIF_ENCODER.test(file)),
        `the AVIF encoder never arrived; wasm fetched: ${resources.wasm.join(', ')}`,
    ).toBe(true);
    expect(resources.wasm.filter((file) => AVIF_DECODER.test(file)), 'an AVIF decoder was shipped').toEqual([]);
    expect(await loadedPackages(resources), 'lazy packages fetched by an AVIF encode').toEqual([]);
});

test.describe('pages with no tool on them', () => {
    for (const route of ['/', '/tools']) {
        test(`${route} fetches no codec and no lazy package`, async ({ page }) => {
            const resources = watchResources(page);

            await page.goto(route);
            await page.waitForLoadState('networkidle');

            expect(resources.wasm, `codecs fetched by ${route}`).toEqual([]);
            expect(await loadedPackages(resources), `lazy packages fetched by ${route}`).toEqual([]);
        });
    }
});
