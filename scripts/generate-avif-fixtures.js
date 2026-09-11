#!/usr/bin/env node
/**
 * The committed AVIF fixtures.
 *
 * FIVE FILES NO ENCODER WILL WRITE FOR YOU. Everything else the AVIF suite
 * needs is drawn at test time — `tests/e2e/fixtures/files.js` writes its own
 * AVIFs into os.tmpdir() on every run, because a picture is a picture and a
 * regenerated one is as good as a committed one. These five are different:
 * each is a file that is WRONG in a specific, named way, and the wrongness is
 * the fixture. A still that declares itself an animation, a download that
 * stopped halfway, a picture with a quarter turn stored beside it — no
 * encoder produces any of them, so they are made here by taking a file
 * libheif wrote a moment ago and moving the bytes the format's own document
 * says carry that meaning.
 *
 * WHY THEY ARE COMMITTED RATHER THAN BUILT AT TEST TIME. The Playwright flows
 * need them: a browser test drops a file through a real file input, and a
 * fixture built by sharp inside a spec would make every browser project pay
 * for an AVIF encode before it could start. They are small (under 1 KB each)
 * and they are re-read on every vitest run —
 * `tests/lib/image-client/avif.properties.test.js` opens all five and asserts
 * the properties this file gave them, so a stale or swapped fixture fails
 * there rather than silently weakening a flow.
 *
 * DETERMINISTIC, AND NOT BYTE-PINNED. The picture is flat rectangles from a
 * fixed table — no PRNG, no clock, no text and therefore no font, which is
 * the thing that would make two machines draw different pixels. The bytes are
 * nevertheless a function of whichever libheif and aom sharp was built
 * against, so the tests assert what each file SAYS, never its length or its
 * hash. Regenerating with a newer libheif is expected to change the bytes and
 * must not change a single assertion.
 *
 * Usage:
 *   node scripts/generate-avif-fixtures.js
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const sharp = require('sharp');

const {
    boxes, garbageAfterFtyp, imirProperty, insertItemProperty, irotProperty, setMajorBrand, truncate,
} = require('../tests/helpers/isobmff-edit');
const { parseAvif } = require('../tests/helpers/avif');

const OUT_DIR = path.join(__dirname, '..', 'tests', 'fixtures', 'avif');

const WIDTH = 96;
const HEIGHT = 64;

/**
 * Four quadrants and a white block high on the left.
 *
 * THE ASYMMETRY IS THE ASSERTION. A rotated or mirrored copy of a picture is
 * only distinguishable from the original if no two corners look alike, so the
 * four quadrants are four colours no lossy codec can confuse, and the white
 * block breaks the remaining symmetry: a 180° turn swaps the quadrants back
 * into a plausible-looking picture, and only the block says which way up it
 * is.
 */
function drawBase() {
    const pixels = Buffer.alloc(WIDTH * HEIGHT * 3);
    const quadrants = [
        [216, 40, 60], // top-left     red
        [40, 170, 90], // top-right    green
        [50, 90, 210], // bottom-left  blue
        [230, 190, 60], // bottom-right yellow
    ];

    for (let y = 0; y < HEIGHT; y += 1) {
        for (let x = 0; x < WIDTH; x += 1) {
            const quadrant = (y < HEIGHT / 2 ? 0 : 2) + (x < WIDTH / 2 ? 0 : 1);
            const inBlock = x >= 8 && x < 24 && y >= 8 && y < 24;
            const [r, g, b] = inBlock ? [250, 250, 250] : quadrants[quadrant];
            const at = (y * WIDTH + x) * 3;
            pixels[at] = r;
            pixels[at + 1] = g;
            pixels[at + 2] = b;
        }
    }

    return sharp(pixels, { raw: { width: WIDTH, height: HEIGHT, channels: 3 } })
        .avif({ quality: 60 })
        .toBuffer();
}

/**
 * A download that stopped inside the picture data.
 *
 * The cut lands past the end of `meta`, so the header is complete and every
 * item is described — and then the bytes those descriptions point at are not
 * all there. That is the shape of a real interrupted download, and it is the
 * hardest damaged file to refuse: a reader that checks only the header sees
 * nothing wrong with it.
 */
function truncateInsideMdat(base) {
    const mdat = boxes(base, 0, base.length).find((box) => box.type === 'mdat');
    if (!mdat) throw new Error('the base AVIF has no mdat to cut into');
    return truncate(base, mdat.at + 8 + Math.floor((mdat.size - 8) / 2));
}

function write(name, bytes, describe) {
    const file = path.join(OUT_DIR, name);
    fs.writeFileSync(file, bytes);
    const hash = crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 16);
    process.stdout.write(`${name.padEnd(26)} ${String(bytes.length).padStart(6)} B  ${hash}  ${describe}\n`);
}

/** What the file says about itself, or why it cannot say anything. */
function readBack(bytes) {
    try {
        const avif = parseAvif(bytes);
        return `${avif.brand} ${avif.width}×${avif.height}`
            + `${avif.animated ? ' ANIMATED' : ''}`
            + `${avif.rotation ? ` irot ${avif.rotation}°` : ''}`
            + `${avif.mirrorAxis === null ? '' : ` imir axis ${avif.mirrorAxis}`}`;
    } catch (error) {
        return `unreadable: ${error.message}`;
    }
}

async function main() {
    fs.mkdirSync(OUT_DIR, { recursive: true });

    const base = await drawBase();
    const parsed = parseAvif(base);

    if (parsed.width !== WIDTH || parsed.height !== HEIGHT || parsed.animated) {
        throw new Error(`the base AVIF came out wrong: ${readBack(base)}`);
    }

    process.stdout.write(`base (not committed)       ${String(base.length).padStart(6)} B  ${readBack(base)}\n\n`);

    const files = [
        ['avis-brand.avif', setMajorBrand(base, 'avis')],
        ['irot-90.avif', insertItemProperty(base, irotProperty(90))],
        ['imir.avif', insertItemProperty(base, imirProperty(1))],
        ['truncated.avif', truncateInsideMdat(base)],
        ['garbage-after-ftyp.avif', garbageAfterFtyp(base)],
    ];

    for (const [name, bytes] of files) write(name, bytes, readBack(bytes));

    process.stdout.write(`\n${files.length} files in ${path.relative(process.cwd(), OUT_DIR)}\n`);
}

main().catch((error) => {
    process.stderr.write(`${error.stack}\n`);
    process.exit(1);
});
