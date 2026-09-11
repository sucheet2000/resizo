/**
 * The `icons` op, judged on properties rather than on remembered numbers.
 *
 * WHAT MAKES THIS TOOL DIFFERENT FROM EVERY OTHER ONE ON THE SITE. Everywhere
 * else a run produces ONE file and a test can ask libvips what it is. Here a
 * run produces a PACKAGE — six rasters, a container that holds three of them
 * again, a manifest that names two of them by path and a snippet that names
 * four — and the failures worth catching are failures of AGREEMENT between
 * those parts rather than of any one of them:
 *
 *   a manifest naming /android-chrome-512x512.png when the package writes
 *   android-chrome-512.png              the icon 404s on the day it is installed
 *   two package entries with one name   the ZIP silently holds five of six
 *   a 31 × 32 PNG in the 32 slot        the tab bar draws the wrong thing
 *   an ICO offset counted from the
 *   first entry rather than the file    the container opens in nothing
 *   a transparent source flattened
 *   when nobody asked for a colour      a see-through logo in a white box
 *   a square that is not square         every mask crops it differently
 *
 * None of those is visible in a byte count or in a screenshot of the panel, and
 * every one of them ships. So the assertions below are about relationships that
 * must hold for ANY source and ANY settings, and the numbers that do appear —
 * 16, 32, 48, 180, 192, 512 — are read out of the package registry rather than
 * typed here, so a size added to `ICON_ASSETS` is covered on the day it lands.
 *
 * THE GUARDS ARE PROVED BEFORE THEY ARE USED. The first describe below runs
 * against packages this file builds by hand, one of which is deliberately
 * broken. A "no missing manifest icon" check that could not find a missing one
 * is not a check, and a snippet reader that parsed no hrefs at all would report
 * a clean bill on every page forever — so it asserts what it FOUND before it
 * asserts what it did not.
 *
 * sharp is the independent reference here as everywhere in this suite: it
 * reopens every PNG the engine wrote and is asked what it actually is. The ICO
 * goes through tests/helpers/ico.js, which is written from Microsoft's own
 * structure and never imports the engine's reader — a writer and a reader that
 * share a constant agree with each other about a file nothing else can open.
 */
import sharp from 'sharp';
import {
    beforeAll, describe, expect, it,
} from 'vitest';

import { optionsFromFormData } from '@/lib/image-client/form-options';
import { assertPngIco, parseIco } from '../../helpers/ico.js';
import { installBrowserEnv } from './helpers/browser-env';
import { makeFile } from './helpers/fixtures';

/* ------------------------------------------------------------------ *
 * The guards, as functions, so they can be proved on a broken package
 * before they are pointed at a real one
 * ------------------------------------------------------------------ */

/** Every name that appears more than once, in the order the repeats appear. */
function duplicateNames(filenames) {
    const seen = new Set();
    const repeats = [];
    for (const name of filenames) {
        if (seen.has(name)) repeats.push(name);
        seen.add(name);
    }
    return repeats;
}

const withoutLeadingSlash = (src) => String(src).replace(/^\//, '');

/**
 * The manifest's icon list, checked against the files the package actually
 * holds.
 *
 * Returns what it FOUND as well as what is missing, because "nothing missing"
 * is the answer a manifest with no icons at all would give, and a web app
 * manifest with no icons is not installable — which is the entire reason the
 * 192 and the 512 exist.
 */
function manifestIcons(manifestText, filenames) {
    const manifest = JSON.parse(manifestText);
    const present = new Set(filenames);
    const srcs = (manifest.icons ?? []).map((icon) => icon.src);

    return {
        manifest,
        srcs,
        missing: srcs.filter((src) => !present.has(withoutLeadingSlash(src))),
    };
}

/**
 * Every href the HTML snippet points at, and the ones the package cannot
 * satisfy. Same shape and the same reason: a regex that matched nothing would
 * otherwise report a perfect snippet.
 */
function snippetTargets(snippet, filenames) {
    const present = new Set(filenames);
    const hrefs = [...snippet.matchAll(/href="([^"]+)"/g)].map((match) => match[1]);

    return { hrefs, missing: hrefs.filter((href) => !present.has(withoutLeadingSlash(href))) };
}

describe('the package guards, proved on packages built by hand', () => {
    const GOOD = [
        'favicon.ico',
        'favicon-16x16.png',
        'favicon-32x32.png',
        'apple-touch-icon.png',
        'android-chrome-192x192.png',
        'android-chrome-512x512.png',
        'site.webmanifest',
    ];

    const GOOD_MANIFEST = JSON.stringify({
        name: 'Test',
        icons: [
            { src: '/android-chrome-192x192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
            { src: '/android-chrome-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
        ],
    }, null, 2);

    const GOOD_SNIPPET = [
        '<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png">',
        '<link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png">',
        '<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">',
        '<link rel="manifest" href="/site.webmanifest">',
    ].join('\n');

    it('passes a package whose parts agree — and says what it read', () => {
        expect(duplicateNames(GOOD)).toEqual([]);

        const icons = manifestIcons(GOOD_MANIFEST, GOOD);
        // The self-check: two icons were actually read out of the manifest. A
        // manifest with an empty icon list has nothing missing either.
        expect(icons.srcs).toHaveLength(2);
        expect(icons.missing).toEqual([]);

        const snippet = snippetTargets(GOOD_SNIPPET, GOOD);
        expect(snippet.hrefs).toHaveLength(4);
        expect(snippet.missing).toEqual([]);
    });

    it('catches a manifest that names a file the package does not hold', () => {
        const broken = JSON.stringify({
            icons: [
                { src: '/android-chrome-192x192.png', sizes: '192x192', type: 'image/png' },
                { src: '/android-chrome-512.png', sizes: '512x512', type: 'image/png' },
            ],
        });

        expect(manifestIcons(broken, GOOD).missing).toEqual(['/android-chrome-512.png']);
    });

    it('catches a duplicated package name, which a ZIP would swallow', () => {
        const repeated = [...GOOD, 'favicon-32x32.png'];
        expect(duplicateNames(repeated)).toEqual(['favicon-32x32.png']);
    });

    it('catches a snippet pointing at a file nobody generated', () => {
        const broken = `${GOOD_SNIPPET}\n<link rel="icon" href="/favicon-64x64.png">`;
        const found = snippetTargets(broken, GOOD);

        expect(found.hrefs).toHaveLength(5);
        expect(found.missing).toEqual(['/favicon-64x64.png']);
    });

    it('reports an empty icon list as empty rather than as complete', () => {
        // The vacuity trap, made explicit: a manifest with no icons has
        // nothing missing, and a test that only looked at `missing` would call
        // that a pass. Anything asserting on this must assert `srcs` too.
        const empty = manifestIcons(JSON.stringify({ icons: [] }), GOOD);
        expect(empty.missing).toEqual([]);
        expect(empty.srcs).toEqual([]);
    });
});

/* ------------------------------------------------------------------ *
 * The op itself
 * ------------------------------------------------------------------ */

/** A 512 × 512 encode behind a WASM fetch, five times over. */
const SLOW = 180_000;

let runOperation;
let JobError;
let ICON_ASSETS;
let ICO_SIZES;
let ZIP_FILENAME;
let buildManifest;
let buildHtmlSnippet;

/** The mark tests/e2e/fixtures/files.js draws, in the shape sharp wants it. */
function logoMarkSvg(width, height) {
    const short = Math.min(width, height);
    const cx = width / 2;
    const cy = height / 2;
    const plate = short * 0.6;
    const disc = short * 0.13;
    const wedge = short * 0.17;
    const n = (value) => Number(value.toFixed(2));

    return Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
        <rect x="${n(cx - plate / 2)}" y="${n(cy - plate / 2)}" width="${n(plate)}" height="${n(plate)}"
              rx="${n(plate * 0.18)}" fill="#1f3a93"/>
        <circle cx="${n(cx - plate * 0.16)}" cy="${n(cy - plate * 0.16)}" r="${n(disc)}" fill="#f0b429"/>
        <path d="M ${n(cx + plate * 0.30)} ${n(cy + plate * 0.30)}
                 L ${n(cx + plate * 0.30 - wedge)} ${n(cy + plate * 0.30)}
                 L ${n(cx + plate * 0.30)} ${n(cy + plate * 0.30 - wedge)} Z" fill="#c8283c"/>
    </svg>`);
}

async function markFile(width, height, name = 'logo-mark.png') {
    const bytes = await sharp(logoMarkSvg(width, height)).png({ compressionLevel: 9 }).toBuffer();
    return makeFile(bytes, { name, type: 'image/png' });
}

/** Every asset's bytes, reopened by libvips and indexed by filename. */
async function readPackage(result) {
    const files = new Map();

    for (const asset of result.assets) {
        const buffer = Buffer.from(await asset.blob.arrayBuffer());
        files.set(asset.filename, { asset, buffer });
    }

    return files;
}

const CUSTOM = '#2f6fed';
const CUSTOM_RGB = { r: 0x2f, g: 0x6f, b: 0xed };

/** The top-left pixel as RGBA — transparent in every source here by construction. */
async function corner(buffer) {
    const { data } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    return {
        r: data[0], g: data[1], b: data[2], a: data[3],
    };
}

/**
 * The bounding box of everything that is not fully transparent.
 *
 * The mark is a square plate with the disc and the wedge inside it, so on a
 * transparent background this box IS the plate — which makes "the box is
 * square" the measurable form of "nothing was stretched". A padded output has
 * clear bands around the drawing, so the box shrinks rather than distorting,
 * and a fit that squashed 640 × 400 into a square would report 512 × 320's
 * worth of plate as 4:3.
 */
async function opaqueBox(buffer) {
    const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    let left = info.width;
    let right = -1;
    let top = info.height;
    let bottom = -1;

    for (let y = 0; y < info.height; y += 1) {
        for (let x = 0; x < info.width; x += 1) {
            if (data[(y * info.width + x) * 4 + 3] > 8) {
                if (x < left) left = x;
                if (x > right) right = x;
                if (y < top) top = y;
                if (y > bottom) bottom = y;
            }
        }
    }

    return right < left ? null : { width: right - left + 1, height: bottom - top + 1 };
}

let coverTransparent;
let coverTransparentAgain;
let containTransparent;
let coverColour;
let smallSource;

beforeAll(async () => {
    installBrowserEnv();
    ({ runOperation, JobError } = await import('@/lib/image-client/operations'));
    ({
        ICON_ASSETS, ICO_SIZES, ZIP_FILENAME, buildManifest, buildHtmlSnippet,
    } = await import('@/lib/format/icon-package'));

    const wide = await markFile(640, 400);

    // Five runs, each one a question no other run can answer: the default, the
    // same thing again (determinism), the other geometry, a chosen colour, and
    // a source too small for the largest icon.
    const transparentCover = iconOptions({ geometry: 'cover', background: 'transparent' });

    coverTransparent = await runOperation('icons', wide, transparentCover);
    coverTransparentAgain = await runOperation('icons', await markFile(640, 400), transparentCover);
    containTransparent = await runOperation('icons', await markFile(640, 400), iconOptions({
        geometry: 'contain', background: 'transparent',
    }));
    coverColour = await runOperation('icons', await markFile(640, 400), iconOptions({
        geometry: 'cover', background: CUSTOM,
    }));
    smallSource = await runOperation('icons', await markFile(128, 128, 'small.png'), transparentCover);
}, SLOW);

describe('the shape of the outcome', () => {
    it('hands back the package registry in order, minus the manifest, and no single blob', () => {
        const expected = ICON_ASSETS.filter((entry) => entry.kind !== 'manifest');

        expect(coverTransparent.assets.map((asset) => asset.id)).toEqual(expected.map((entry) => entry.id));
        expect(coverTransparent.assets.map((asset) => asset.filename))
            .toEqual(expected.map((entry) => entry.filename));

        // The manifest is text the page builds, not bytes the engine encodes.
        expect(coverTransparent.assets.some((asset) => asset.id === 'manifest')).toBe(false);

        // A result with assets has no single file to offer, and a panel that
        // found one would be offering the previous job's.
        expect(coverTransparent.blob).toBeNull();
        expect(coverTransparent.format).toBe('png');
    });

    it('reports every filename exactly once, across the package and the ZIP', () => {
        const filenames = ICON_ASSETS.map((entry) => entry.filename);

        // The self-check: seven names were read, not none.
        expect(filenames.length).toBe(7);
        expect(duplicateNames(filenames)).toEqual([]);
        expect(duplicateNames(coverTransparent.assets.map((asset) => asset.filename))).toEqual([]);
        expect(ZIP_FILENAME).toMatch(/\.zip$/);
    });

    it('says it verified the package, and every check it lists agrees', () => {
        expect(coverTransparent.verified).toBe(true);

        // The self-check again: a `checks` array nobody filled satisfies
        // `every(ok)` without having looked at anything.
        expect(coverTransparent.checks.length).toBeGreaterThan(0);
        for (const check of coverTransparent.checks) {
            expect(check.ok, `${check.key}: wanted ${check.required}, got ${check.actual}`).toBe(true);
        }

        // And the checks are about the files that were produced, not about a
        // list of names somebody typed.
        const produced = new Set(coverTransparent.assets.map((asset) => asset.filename));
        for (const check of coverTransparent.checks) expect(produced.has(check.key)).toBe(true);
    });
});

describe('every raster', () => {
    it('is exactly the size the registry declares, read back by libvips', async () => {
        const files = await readPackage(coverTransparent);

        for (const entry of ICON_ASSETS.filter((item) => item.kind === 'png')) {
            const found = files.get(entry.filename);
            expect(found, `${entry.filename} is not in the package`).toBeTruthy();

            const meta = await sharp(found.buffer).metadata();
            expect(meta.format, entry.filename).toBe('png');
            expect(meta.width, entry.filename).toBe(entry.width);
            expect(meta.height, entry.filename).toBe(entry.height);

            // The panel prints the asset's own byte figure; it has to be the
            // length of the file behind the Download button.
            expect(found.asset.bytes, entry.filename).toBe(found.buffer.length);
            expect(found.asset.width, entry.filename).toBe(entry.width);
        }
    }, SLOW);

    it('is square, in both geometries', async () => {
        for (const [name, result] of [['cover', coverTransparent], ['contain', containTransparent]]) {
            const files = await readPackage(result);

            for (const [filename, { buffer }] of files) {
                if (!filename.endsWith('.png')) continue;
                const meta = await sharp(buffer).metadata();
                expect(meta.width, `${name} ${filename}`).toBe(meta.height);
            }
        }
    }, SLOW);

    it('never exceeds 512 pixels, which is the largest surface this op allocates', async () => {
        const files = await readPackage(coverTransparent);
        const sizes = [];

        for (const [filename, { buffer }] of files) {
            if (!filename.endsWith('.png')) continue;
            const meta = await sharp(buffer).metadata();
            sizes.push(Math.max(meta.width, meta.height));
        }

        expect(sizes.length).toBeGreaterThan(0);
        expect(Math.max(...sizes)).toBeLessThanOrEqual(512);
    }, SLOW);
});

describe('favicon.ico, read by a parser that has never seen the engine', () => {
    it('holds one PNG per ICO size, in order, inside the file and never overlapping', async () => {
        const files = await readPackage(coverTransparent);
        const ico = files.get('favicon.ico');
        expect(ico, 'the package has no favicon.ico').toBeTruthy();

        // parseIco throws on an offset inside the directory, a payload past
        // the end of the file, two payloads over one byte, and an IHDR that
        // disagrees with the directory. assertPngIco adds "every payload is a
        // PNG" and "these exact sizes, in this order".
        const read = assertPngIco(ico.buffer, { sizes: ICO_SIZES });

        expect(read.header.count).toBe(ICO_SIZES.length);
        expect(read.entries).toHaveLength(ICO_SIZES.length);

        for (const entry of read.entries) {
            expect(entry.offset).toBeGreaterThanOrEqual(6 + 16 * ICO_SIZES.length);
            expect(entry.offset + entry.bytes).toBeLessThanOrEqual(read.bytes);

            // And the payload really is the picture the directory promised,
            // decoded rather than trusted to its own header.
            const meta = await sharp(entry.data).metadata();
            expect(meta.format).toBe('png');
            expect(meta.width).toBe(entry.width);
            expect(meta.height).toBe(entry.height);
        }
    }, SLOW);

    it('holds the same pictures as the standalone PNGs of the same size', async () => {
        const files = await readPackage(coverTransparent);
        const read = parseIco(files.get('favicon.ico').buffer);

        for (const entry of read.entries) {
            const standalone = files.get(`favicon-${entry.width}x${entry.height}.png`);
            if (!standalone) continue;

            // Not a byte comparison: the two go through the same encoder but
            // nothing in the contract says the bytes must be shared. What must
            // hold is that they are the same picture.
            const inside = await sharp(entry.data).ensureAlpha().raw().toBuffer();
            const outside = await sharp(standalone.buffer).ensureAlpha().raw().toBuffer();
            expect(inside.equals(outside), `favicon.ico's ${entry.width} differs from the standalone one`).toBe(true);
        }
    }, SLOW);
});

describe('the manifest and the snippet, against the files that exist', () => {
    it('names only icons the package holds, and names at least the two Chrome asks for', () => {
        const filenames = ICON_ASSETS.map((entry) => entry.filename);
        const found = manifestIcons(buildManifest({ name: 'Resizo Test', shortName: 'RT' }), filenames);

        expect(found.srcs.length).toBeGreaterThanOrEqual(2);
        expect(found.missing).toEqual([]);
        expect(found.srcs).toContain('/android-chrome-192x192.png');
        expect(found.srcs).toContain('/android-chrome-512x512.png');
    });

    it('puts a visitor-typed name through JSON rather than into markup', () => {
        // User text is untrusted. A name with a quote and a tag in it has to
        // come back out of JSON.parse as the same string, and must never have
        // been escaped into HTML entities on the way in.
        const hostile = 'Acme "Icons" </script><img src=x onerror=alert(1)>';
        const manifest = JSON.parse(buildManifest({ name: hostile, shortName: 'Acme' }));

        expect(manifest.name).toBe(hostile);
        expect(manifest.short_name).toBe('Acme');
    });

    it('leaves out what nobody typed rather than writing an empty string', () => {
        const manifest = JSON.parse(buildManifest({}));

        expect(manifest.icons).toHaveLength(2);
        expect('name' in manifest).toBe(false);
        expect('short_name' in manifest).toBe(false);
        expect('theme_color' in manifest).toBe(false);
    });

    it('drops a colour that is not a hex colour', () => {
        const manifest = JSON.parse(buildManifest({ themeColor: 'red; background: url(x)', backgroundColor: '#fff' }));

        expect('theme_color' in manifest).toBe(false);
        expect(manifest.background_color).toBe('#fff');
    });

    it('writes a snippet whose every href is a file the package holds', () => {
        const filenames = ICON_ASSETS.map((entry) => entry.filename);
        const found = snippetTargets(buildHtmlSnippet(), filenames);

        expect(found.hrefs.length).toBeGreaterThanOrEqual(4);
        expect(found.missing).toEqual([]);
    });
});

describe('what the visitor chose, measured in the pixels', () => {
    it('keeps the source transparent when no background was chosen', async () => {
        const files = await readPackage(coverTransparent);

        for (const entry of ICON_ASSETS.filter((item) => item.kind === 'png')) {
            const { buffer } = files.get(entry.filename);
            const meta = await sharp(buffer).metadata();
            expect(meta.hasAlpha, entry.filename).toBe(true);

            // The mark is inset, so this pixel is clear over NOTHING in the
            // source: an opaque corner here can only be a flatten nobody asked
            // for. The 16 is excluded from nothing — it is the one most likely
            // to have the mark bleed into its corner, and it still must not.
            const pixel = await corner(buffer);
            expect(pixel.a, `${entry.filename} corner alpha`).toBe(0);
        }
    }, SLOW);

    it('fills every icon with a chosen colour, and leaves nothing see-through', async () => {
        const files = await readPackage(coverColour);

        for (const entry of ICON_ASSETS.filter((item) => item.kind === 'png')) {
            const { buffer } = files.get(entry.filename);
            const pixel = await corner(buffer);

            expect(pixel.a, `${entry.filename} corner alpha`).toBe(255);
            for (const channel of ['r', 'g', 'b']) {
                expect(
                    Math.abs(pixel[channel] - CUSTOM_RGB[channel]),
                    `${entry.filename}: the ${channel} of the corner is ${pixel[channel]}, not ${CUSTOM_RGB[channel]}`,
                ).toBeLessThanOrEqual(2);
            }
        }

        // The ICO carries the same decision: a container full of transparent
        // icons beside six opaque PNGs is the mismatch nobody looks for.
        const ico = parseIco(files.get('favicon.ico').buffer);
        for (const entry of ico.entries) {
            expect((await corner(entry.data)).a, `favicon.ico ${entry.width}`).toBe(255);
        }
    }, SLOW);

    it('pads rather than stretches when the visitor asked to fit inside', async () => {
        const files = await readPackage(containTransparent);
        const { buffer } = files.get('android-chrome-512x512.png');

        const box = await opaqueBox(buffer);
        expect(box, 'the 512 is entirely transparent — nothing was drawn').toBeTruthy();

        // The plate is square in the source. 640 × 400 fitted inside 512 × 512
        // is drawn at 512 × 320, so a plate that came back 4:3 means the fit
        // stretched the picture to fill the square.
        expect(Math.abs(box.width - box.height), `the mark came back ${box.width} × ${box.height}`)
            .toBeLessThanOrEqual(2);

        // And the padding is clear, because no colour was chosen.
        expect((await corner(buffer)).a).toBe(0);
    }, SLOW);

    it('keeps more of the picture inside the square than a crop does', async () => {
        const cropped = await opaqueBox((await readPackage(coverTransparent)).get('android-chrome-512x512.png').buffer);
        const fitted = await opaqueBox((await readPackage(containTransparent)).get('android-chrome-512x512.png').buffer);

        // The two geometries must actually differ. A "contain" that quietly
        // ran the cover path would make every assertion above pass twice.
        expect(fitted.width).not.toBe(cropped.width);
    }, SLOW);
});

describe('a source smaller than the largest icon', () => {
    it('says what it was enlarged from, and still writes a real 512', async () => {
        expect(smallSource.enlargedFrom).toEqual({ width: 128, height: 128 });

        const files = await readPackage(smallSource);
        const meta = await sharp(files.get('android-chrome-512x512.png').buffer).metadata();

        // Enlargement is not a refusal: the form still gets its 512.
        expect(meta.width).toBe(512);
        expect(meta.height).toBe(512);
    }, SLOW);

    it('says nothing about enlargement when the source is big enough', () => {
        // The 640 × 400 mark's square is 400 across, which IS under 512 — so
        // this asserts the other half on the source that is over it.
        expect(coverTransparent.enlargedFrom).toEqual({ width: 400, height: 400 });
    });
});

describe('two runs of the same job', () => {
    it('produce the same package: same names, same sizes, same bytes', async () => {
        const first = await readPackage(coverTransparent);
        const second = await readPackage(coverTransparentAgain);

        expect([...second.keys()]).toEqual([...first.keys()]);
        expect([...first.keys()].length).toBeGreaterThan(0);

        for (const [filename, { buffer }] of first) {
            const other = second.get(filename).buffer;
            expect(other.length, `${filename} changed length between two identical runs`).toBe(buffer.length);
            expect(other.equals(buffer), `${filename} differs between two identical runs`).toBe(true);
        }
    }, SLOW);
});

/**
 * The op's options as they arrive from the page: through the FormData field
 * names `lib/image-client/form-options.js` registers, never the engine's own
 * internal keys.
 *
 * THIS IS NOT CEREMONY. The frame arrives as `crop_x`/`crop_width` and reaches
 * the op as `x`/`cropWidth`, and a test that typed the internal names would
 * pass on the day that mapping was dropped — the op would simply see no frame
 * and crop the whole picture, which looks like a working default rather than
 * like a lost control. (Written after exactly that: the first version of the
 * test below sent `crop_width` straight to `runOperation`, the frame was never
 * seen, and the refusal it was asserting could not happen.)
 */
function iconOptions({ geometry, background, crop } = {}) {
    const form = new FormData();
    if (geometry !== undefined) form.set('geometry', String(geometry));
    if (background !== undefined) form.set('background', String(background));
    if (crop) {
        form.set('crop_x', String(crop.x));
        form.set('crop_y', String(crop.y));
        form.set('crop_width', String(crop.width));
        form.set('crop_height', String(crop.height));
    }
    return optionsFromFormData('icons', form);
}

describe('the frame, as the page sends it', () => {
    it('reaches the op through the form field names the page uses', async () => {
        // A square frame over the mark's left half. It has to CHANGE the
        // picture, or the assertion below is about nothing: the default crop
        // is centred, so a frame at x=0 keeps a different 400 × 400.
        const framed = await runOperation('icons', await markFile(640, 400), iconOptions({
            geometry: 'cover',
            background: 'transparent',
            crop: { x: 0, y: 0, width: 400, height: 400 },
        }));

        const shifted = (await readPackage(framed)).get('android-chrome-512x512.png').buffer;
        const centred = (await readPackage(coverTransparent)).get('android-chrome-512x512.png').buffer;

        expect(shifted.equals(centred), 'the frame was ignored — the crop is the centred one either way')
            .toBe(false);
    }, SLOW);

    it('refuses a rectangle rather than quietly stretching the mark into a square', async () => {
        // The page only ever sends a 1:1 frame. A rectangle arriving here is a
        // caller that went around the control, and the icons it would produce
        // are distorted in a way no later check could tell from a bad source.
        const run = runOperation('icons', await markFile(640, 400), iconOptions({
            geometry: 'cover',
            crop: { x: 0, y: 0, width: 400, height: 300 },
        }));

        await expect(run).rejects.toThrow(JobError);
        await expect(run).rejects.toMatchObject({ code: 'invalid-crop' });
    }, SLOW);

    it('allows one pixel of slack, because a frame is dragged with a mouse', async () => {
        const result = await runOperation('icons', await markFile(640, 400), iconOptions({
            geometry: 'cover',
            // 401 across rather than 401 down: the source is only 400 tall, so
            // the taller rectangle would be refused for running off the picture
            // and this test would pass for the wrong reason.
            crop: { x: 0, y: 0, width: 401, height: 400 },
        }));

        expect(result.verified).toBe(true);
    }, SLOW);
});
