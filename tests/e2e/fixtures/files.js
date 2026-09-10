const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/**
 * Fixtures for the expansion flows, built at test time.
 *
 * None of these can be a checked-in binary. All but one are defined by bytes a
 * human cannot read in a diff — an EXIF GPS IFD, a density record, an alpha
 * channel — so a committed file would be a claim about its own contents that
 * nothing verifies, and the day sharp changes how it writes one the tests
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

/** Written once per run, however many tests ask for the same spec. */
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

/**
 * A PNG with real transparency, for the JPEG routes that have to fill it in.
 *
 * The shape is inset so THE CORNER IS FULLY CLEAR — that pixel is the whole
 * assertion, and it is clear over nothing rather than clear over white. A
 * clear-white corner would come back white even if the flattening never ran,
 * because MozJPEG reads RGBA as RGBX and would keep the hidden 255s; a corner
 * with no colour hiding under it can only be the fill colour.
 */
function transparentPng(file) {
    const shape = `<svg width="480" height="320" xmlns="http://www.w3.org/2000/svg">
        <rect x="120" y="80" width="240" height="160" rx="24" fill="#c8283c"/>
    </svg>`;

    return lib()(Buffer.from(shape)).png({ compressionLevel: 9 }).toFile(file);
}

/**
 * A head-and-shoulders portrait with nobody in it: 1200×1600, the 3:4 a phone
 * camera writes, and not one facial feature.
 *
 * The passport flows need a source that BEHAVES like the photograph somebody
 * brings to a passport form — portrait orientation, a subject high in the
 * frame, a plain light backdrop — without being one. Nobody was photographed,
 * so there is no likeness and no licence: the head is an oval, the hair is a
 * second oval behind it, and there are no eyes, nose or mouth for any of it to
 * read as a person.
 *
 * THE FOUR BANDS ARE FAR APART IN COLOUR ON PURPOSE. The crop test judges two
 * downloads against each other, and the only thing that makes "the frame moved"
 * measurable is that a different part of this picture is a different colour. A
 * portrait drawn as one soft gradient would produce two files no metric could
 * tell apart, and the test would pass whether the drag worked or not.
 *
 * Read against the 1:1 frame the passport presets use: a centred cover crop of
 * this source is 1200×1200 from y=200, whose middle pixel lands on the dark
 * clothing, while the head fills the middle of a zoomed-in crop. The two are
 * ~180 levels apart in red.
 */
function portraitJpeg(file) {
    const scene = `<svg width="1200" height="1600" xmlns="http://www.w3.org/2000/svg">
        <rect width="1200" height="1600" fill="#eef1f5"/>
        <ellipse cx="600" cy="380" rx="245" ry="240" fill="#3b2f2a"/>
        <ellipse cx="600" cy="470" rx="205" ry="250" fill="#e9c4a0"/>
        <rect x="525" y="640" width="150" height="120" fill="#d3a480"/>
        <ellipse cx="600" cy="1250" rx="520" ry="520" fill="#33445e"/>
    </svg>`;

    return lib()(Buffer.from(scene)).jpeg({ quality: 92 }).toFile(file);
}

const exifGpsJpeg = () => once('exif-gps-72dpi.jpg', exifJpeg);
const signature = () => once('signature-600x200.png', signaturePng);
const transparent = () => once('transparent-320x240.webp', transparentWebp);
const transparentPngFile = () => once('transparent-480x320.png', transparentPng);
const portrait = () => once('portrait-1200x1600.jpg', portraitJpeg);

module.exports = {
    FIXTURE_DIR: DIR,
    exifGpsJpeg,
    portrait,
    signature,
    transparent,
    transparentPng: transparentPngFile,
};
