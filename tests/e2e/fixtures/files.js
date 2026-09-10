const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/**
 * Fixtures for the expansion flows, built at test time.
 *
 * None of these can be a checked-in binary. Three of the four are defined by
 * bytes a human cannot read in a diff — an EXIF GPS IFD, a density record, an
 * alpha channel — so a committed file would be a claim about its own contents
 * that nothing verifies, and the day sharp changes how it writes one the tests
 * would keep passing against a stale artefact. They are written under
 * os.tmpdir() instead, from sharp, which is a devDependency and the repo's
 * independent libvips reference (CLAUDE.md > Gotchas).
 *
 * sharp records a JPEG's density in the EXIF block rather than a JFIF APP0
 * segment, which is why the DPI readout on /change-image-dpi is expected to
 * say "from the EXIF block" for the file made here.
 */
const DIR = path.join(os.tmpdir(), 'resizo-e2e-fixtures');

let sharp = null;

function lib() {
    if (!sharp) sharp = require('sharp');
    return sharp;
}

function out(name) {
    fs.mkdirSync(DIR, { recursive: true });
    return path.join(DIR, name);
}

/** Written once per run: four specs shared by seven tests, built four times. */
async function once(name, build) {
    const file = out(name);
    if (!fs.existsSync(file)) await build(file);
    return file;
}

/**
 * A photograph-ish JPEG that claims 72 DPI and carries an EXIF block with a
 * GPS IFD in it. One file answers both /change-image-dpi (a resolution to
 * read and rewrite) and /remove-image-metadata (a camera block and
 * coordinates to strip).
 */
function exifJpeg(file) {
    return lib()({
        create: {
            width: 800,
            height: 600,
            channels: 3,
            noise: { type: 'gaussian', mean: 140, sigma: 30 },
        },
    })
        .withMetadata({ density: 72 })
        .withExif({
            IFD0: {
                Make: 'Resizo',
                Model: 'E2E Fixture Camera',
                Software: 'sharp',
            },
            IFD3: {
                GPSLatitudeRef: 'N',
                GPSLatitude: '51/1 30/1 26/1',
                GPSLongitudeRef: 'W',
                GPSLongitude: '0/1 7/1 39/1',
            },
        })
        .jpeg({ quality: 90 })
        .toFile(file);
}

/**
 * A scan-shaped signature: white paper, a few black strokes, 600×200. Wider
 * and taller than the 300×80 box the form test asks for, so the resize is a
 * real reduction rather than a copy.
 */
function signaturePng(file) {
    const strokes = `<svg width="600" height="200" xmlns="http://www.w3.org/2000/svg">
        <rect width="600" height="200" fill="#ffffff"/>
        <path d="M40 140 C 120 40, 180 180, 250 90 S 360 30, 430 120 S 520 170, 560 70"
              stroke="#111111" stroke-width="7" fill="none" stroke-linecap="round"/>
        <path d="M120 160 L 470 160" stroke="#111111" stroke-width="3" fill="none"/>
    </svg>`;

    return lib()(Buffer.from(strokes)).png().toFile(file);
}

/** A WebP with real transparency: an opaque disc on a fully transparent field. */
function transparentWebp(file) {
    const disc = `<svg width="320" height="240" xmlns="http://www.w3.org/2000/svg">
        <circle cx="160" cy="120" r="90" fill="#2f6fed"/>
    </svg>`;

    return lib()(Buffer.from(disc))
        .webp({ lossless: true, alphaQuality: 100 })
        .toFile(file);
}

const exifGpsJpeg = () => once('exif-gps-72dpi.jpg', exifJpeg);
const signature = () => once('signature-600x200.png', signaturePng);
const transparent = () => once('transparent-320x240.webp', transparentWebp);

module.exports = {
    FIXTURE_DIR: DIR,
    exifGpsJpeg,
    signature,
    transparent,
};
