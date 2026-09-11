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

/**
 * The same nobody, photographed badly: 300×300, which is smaller than the
 * printed photo it is asked to become.
 *
 * THE POINT OF THIS FILE IS THAT IT IS TOO SMALL, and the number is chosen
 * against the print sheet's own arithmetic rather than picked for looking low.
 * A 2 × 2 in photo at 300 DPI is 600 pixels on a side, so a 300 px source has
 * to be doubled to fill one cell — which is the sentence /passport-photo-print
 * shows before it runs ("enlarged from 300 × 300 to 600 × 600 pixels"). Any
 * source at or above 600 px would make that warning correctly disappear and
 * the flow that reads it vacuous.
 *
 * SQUARE ON PURPOSE. The tools crop to fill, so a 300×400 source would keep a
 * centred 300×300 region and land on the same two numbers by a different
 * route; making the file square means the sentence's "from 300 × 300" is the
 * whole file rather than a crop of it, and a flow that read it can say which.
 *
 * Same construction as the 1200×1600 portrait above and the same non-person in
 * it: an oval for a head, an oval for hair, no eyes, nose or mouth.
 */
function lowResPortraitJpeg(file) {
    const scene = `<svg width="300" height="300" xmlns="http://www.w3.org/2000/svg">
        <rect width="300" height="300" fill="#eef1f5"/>
        <ellipse cx="150" cy="105" rx="70" ry="68" fill="#3b2f2a"/>
        <ellipse cx="150" cy="130" rx="58" ry="71" fill="#e9c4a0"/>
        <rect x="129" y="178" width="42" height="34" fill="#d3a480"/>
        <ellipse cx="150" cy="330" rx="148" ry="148" fill="#33445e"/>
    </svg>`;

    return lib()(Buffer.from(scene)).jpeg({ quality: 92 }).toFile(file);
}

/**
 * THE LOGO MARK — the drawing /favicon-generator is exercised with.
 *
 * A brand mark rather than a photograph, because that is what somebody brings
 * to a favicon generator: flat shapes, hard edges, and a field of nothing
 * around them. Three shapes in three colours a lossy encoder cannot confuse,
 * on a FULLY TRANSPARENT ground.
 *
 * THE GEOMETRY IS THE ASSERTION, and it is arranged so three separate flows
 * can read something out of it rather than for how it looks:
 *
 *   the ground is clear          every icon's corner pixel is transparent in
 *                                the source BY CONSTRUCTION, so a corner that
 *                                comes back opaque can only be a background
 *                                the tool put there — the same argument the
 *                                480×320 transparent PNG above is built on
 *   the mark is inset            the plate spans 0.6 of the SHORT edge, so a
 *                                centred square crop of a 640×400 keeps the
 *                                whole mark and still has clear corners: a
 *                                "cover" output and a "contain" output differ
 *                                in their padding, never in the drawing
 *   the shapes are asymmetric    the disc sits high-left and the wedge
 *                                low-right, so an output that was flipped,
 *                                rotated or read as BGRA is visible as a
 *                                picture rather than as a number being off
 *
 * SCALED FROM THE SHORT EDGE, so the 128×128 low-resolution version below is
 * the same mark rather than a different one that happens to be smaller — the
 * enlargement flow needs a source that is too small, not one that is other.
 *
 * `public/samples/logo-mark-640x400.png` is the same drawing, written by
 * scripts/generate-samples.js. The two are separate copies on purpose and each
 * says so: that one is a COMMITTED asset the page's "Try the sample logo"
 * button fetches, whose bytes have to be byte-identical across reruns; this is
 * a throwaway under os.tmpdir() like everything else here.
 */
function logoMarkSvg(width, height) {
    const short = Math.min(width, height);
    const cx = width / 2;
    const cy = height / 2;

    // The plate: 60% of the short edge, so a square crop of any sane frame
    // keeps all of it and the corners stay clear.
    const plate = short * 0.6;
    const radius = plate * 0.18;

    const disc = short * 0.13;
    const wedge = short * 0.17;

    const n = (value) => Number(value.toFixed(2));

    return `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
        <rect x="${n(cx - plate / 2)}" y="${n(cy - plate / 2)}" width="${n(plate)}" height="${n(plate)}"
              rx="${n(radius)}" fill="#1f3a93"/>
        <circle cx="${n(cx - plate * 0.16)}" cy="${n(cy - plate * 0.16)}" r="${n(disc)}" fill="#f0b429"/>
        <path d="M ${n(cx + plate * 0.30)} ${n(cy + plate * 0.30)}
                 L ${n(cx + plate * 0.30 - wedge)} ${n(cy + plate * 0.30)}
                 L ${n(cx + plate * 0.30)} ${n(cy + plate * 0.30 - wedge)} Z" fill="#c8283c"/>
    </svg>`;
}

/** The mark at 640×400: wider than it is tall, and nowhere near square. */
function logoMarkPng(file) {
    return lib()(Buffer.from(logoMarkSvg(640, 400)))
        .png({ compressionLevel: 9 })
        .toFile(file);
}

/**
 * The same mark at 128×128, WHICH IS TOO SMALL AND IS THE POINT.
 *
 * The icon package's largest raster is 512 × 512, so a 128 px source has to be
 * enlarged four times over to fill it — which is the sentence the page shows
 * before it runs ("Your source is 128 × 128 and will be enlarged for the
 * 512 × 512 icon"). Any source at or above 512 makes that warning correctly
 * disappear and the flow that reads it vacuous.
 *
 * SQUARE ON PURPOSE, for the same reason the 300×300 portrait above is: the
 * sentence quotes the source's own size, so a 128×200 file would be reported
 * as its 128×128 crop and a flow could not say which of the two it read.
 */
function lowResLogoPng(file) {
    return lib()(Buffer.from(logoMarkSvg(128, 128)))
        .png({ compressionLevel: 9 })
        .toFile(file);
}

/**
 * A 1600×300 JPEG: sixteen parts wide and three tall, which no square crop can
 * keep.
 *
 * THE BANDS ARE FAR APART IN COLOUR ON PURPOSE, and it is the same argument the
 * 1200×1600 portrait above makes: a flow that moves the crop frame and then
 * compares two downloads can only measure "the frame moved" if a different part
 * of this picture is a different colour. A panorama drawn as one gradient would
 * produce two files no metric could tell apart, and the test would pass whether
 * the drag worked or not.
 *
 * Read against a 1:1 frame: a centred cover crop is the middle 300×300, which
 * is the fourth and fifth bands; ten percent of a frame width is 30 px, so a
 * few shifted presses of an arrow key land on a band that was not in the first
 * crop at all. Fit-inside instead keeps all 1600 and pads the rest, so the two
 * geometries cannot be confused for one another either.
 *
 * OPAQUE, because it is a JPEG and a JPEG has no alpha — which makes it the one
 * icon fixture whose transparent output can only have come from the padding.
 */
function panoramaJpeg(file) {
    const bands = ['#1b3a6b', '#c8283c', '#f0b429', '#2f8f5b', '#6b3fa0', '#e06a2b', '#1f9fb0', '#4a4a4a'];
    const width = 1600;
    const height = 300;
    const step = width / bands.length;

    const parts = bands.map((fill, index) => `<rect x="${index * step}" y="0" width="${step}" height="${height}" fill="${fill}"/>`);

    // Two landmarks, one in the left half and one in the right, so a crop can
    // be told apart from its neighbour by a shape and not only by a mean.
    parts.push('<circle cx="300" cy="150" r="70" fill="#ffffff"/>');
    parts.push('<rect x="1160" y="80" width="140" height="140" fill="#111111"/>');

    return lib()(Buffer.from(
        `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">${parts.join('')}</svg>`,
    )).jpeg({ quality: 92 }).toFile(file);
}

/**
 * Mulberry32 — the same generator benchmarks/lib/samples.js uses, for the same
 * reason: the same seed draws the same picture on every machine and every Node
 * version, which Math.random does not.
 */
function rng(seed) {
    let state = seed >>> 0;
    return function next() {
        state = (state + 0x6D2B79F5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const n = (value) => value.toFixed(1);
const rgb = (r, g, b) => `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`;

/** One palette per photo, so the three are different pictures and not one picture three times. */
const PHOTO_PALETTES = [
    {
        sky: ['#173254', '#5d8cb8', '#e7b077'],
        ground: ['#6b6055', '#3b342d'],
        ridge: [[86, 104, 118], [58, 74, 86], [37, 50, 60]],
        spark: '#f0e2c6',
    },
    {
        sky: ['#20303a', '#4f7d6a', '#cfd8a4'],
        ground: ['#4d5b3a', '#232c1b'],
        ridge: [[74, 110, 88], [50, 80, 62], [30, 52, 40]],
        spark: '#e9f0cf',
    },
    {
        sky: ['#3a1f2c', '#a2544a', '#f0b072'],
        ground: ['#7a5540', '#402a1f'],
        ridge: [[120, 82, 66], [88, 58, 46], [58, 36, 28]],
        spark: '#ffe3c0',
    },
];

/**
 * A photograph-shaped scene, drawn rather than photographed: a gradient sky,
 * cloud banks, three ridges, a lit water band and a foreground of several
 * thousand pebbles, with fine grain over the whole frame.
 *
 * WHY NOT JUST GAUSSIAN NOISE, WHICH IS ONE LINE OF SHARP. Because per-pixel
 * noise is not what a photograph looks like to an encoder. Measured on this
 * machine, a 1600×1067 frame of tuned gaussian noise lands at 378 KB at
 * quality 92 and collapses to 26 KB at quality 50 — MozJPEG throws grain away
 * first — so a bulk test asking for "a target these photos cannot meet at full
 * size" would be met at full size after all, and the flow that exists to prove
 * pixels get spent would prove nothing. This scene is structure at every scale,
 * so it holds 80 KB at quality 50, which is the property the fit flows lean on.
 *
 * NOBODY IS PHOTOGRAPHED HERE and no stock image is involved: seeded PRNG,
 * shapes rasterised by sharp, no text and therefore no machine-dependent font.
 * The benchmark suite draws a scene of the same family for its committed
 * samples; the two are deliberately separate copies, because that one is a
 * checked-in reference whose bytes are asserted and this one is a throwaway
 * fixture in a temp directory (benchmarks/lib/samples.js says so from its end).
 */
function photoScene(width, height, seed) {
    const random = rng(seed);
    const palette = PHOTO_PALETTES[(seed - 1) % PHOTO_PALETTES.length];
    const horizon = Math.round(height * (0.4 + random() * 0.1));
    const shore = Math.round(height * 0.72);

    const parts = [
        '<defs>',
        `<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${palette.sky[0]}"/>`,
        `<stop offset="0.55" stop-color="${palette.sky[1]}"/><stop offset="1" stop-color="${palette.sky[2]}"/></linearGradient>`,
        `<linearGradient id="ground" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${palette.ground[0]}"/>`,
        `<stop offset="1" stop-color="${palette.ground[1]}"/></linearGradient>`,
        '</defs>',
        `<rect width="${width}" height="${horizon}" fill="url(#sky)"/>`,
    ];

    for (let i = 0; i < 70; i += 1) {
        const tint = 190 + random() * 55;
        parts.push(
            `<ellipse cx="${n(random() * width)}" cy="${n(random() * horizon * 0.7)}" `
            + `rx="${n(50 + random() * 220)}" ry="${n(6 + random() * 24)}" `
            + `fill="${rgb(tint, tint - 10, tint - 26)}" fill-opacity="${(0.04 + random() * 0.2).toFixed(3)}"/>`,
        );
    }

    palette.ridge.forEach((shade, index) => {
        const steps = 14 + index * 4;
        const points = [`0,${horizon}`];
        for (let i = 0; i <= steps; i += 1) {
            const drop = height * (0.16 - index * 0.05) * (0.3 + random() * 0.7);
            points.push(`${n((width / steps) * i)},${n(horizon - drop)}`);
        }
        points.push(`${width},${horizon}`);
        parts.push(`<polygon points="${points.join(' ')}" fill="${rgb(...shade)}"/>`);
    });

    parts.push(`<rect x="0" y="${horizon}" width="${width}" height="${shore - horizon}" fill="${rgb(...palette.ridge[2])}"/>`);

    for (let i = 0; i < 600; i += 1) {
        const y = horizon + random() * (shore - horizon);
        const spread = (y - horizon) / (shore - horizon);
        parts.push(
            `<rect x="${n(random() * width)}" y="${n(y)}" width="${n(10 + random() * (60 + spread * 200))}" `
            + `height="${n(1 + spread * 2)}" fill="${palette.spark}" fill-opacity="${(0.05 + random() * 0.25).toFixed(3)}"/>`,
        );
    }

    parts.push(`<rect x="0" y="${shore}" width="${width}" height="${height - shore}" fill="url(#ground)"/>`);

    for (let i = 0; i < 4200; i += 1) {
        const depth = random();
        const grey = 70 + random() * 120;
        parts.push(
            `<ellipse cx="${n(random() * width)}" cy="${n(shore + depth * (height - shore))}" `
            + `rx="${n(2 + depth * depth * 15 * (0.4 + random()))}" ry="${n(2 + depth * depth * 9 * (0.4 + random()))}" `
            + `fill="${rgb(grey, grey - 8, grey - 20)}"/>`,
        );
    }

    for (let i = 0; i < 12000; i += 1) {
        parts.push(
            `<rect x="${n(random() * width)}" y="${n(random() * height)}" width="1.6" height="1.6" `
            + `fill="${random() > 0.5 ? '#ffffff' : '#000000'}" fill-opacity="${(0.05 + random() * 0.16).toFixed(3)}"/>`,
        );
    }

    return Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" `
        + `viewBox="0 0 ${width} ${height}">${parts.join('')}</svg>`,
    );
}

/**
 * A PNG that cannot be made small without being made smaller.
 *
 * 1200×800 of opaque gaussian noise, which a lossless encoder cannot compress:
 * it lands around 2.7 MB and stays there. PNG has no quality dial in this
 * engine (lib/image-client/compress-target.js says so at length), so a batch
 * asking this file for 50 KB while preserving its dimensions has no lever left
 * to pull — which is exactly the row the bulk flows need: a real failure, in a
 * batch that otherwise succeeds, that must not end up in the ZIP.
 */
function noisePng(file) {
    return lib()({
        create: {
            width: 1200,
            height: 800,
            channels: 3,
            background: '#808080',
            noise: { type: 'gaussian', mean: 128, sigma: 62 },
        },
    })
        .png({ compressionLevel: 9, palette: false })
        .toFile(file);
}

/** Not an image at all: the file a person drops by accident when picking a folder. */
function notes(file) {
    return fs.promises.writeFile(
        file,
        'Not an image. This file exists so a bulk selection can contain something\n'
        + 'the tool has to refuse by name rather than by silently skipping it.\n',
        'utf8',
    );
}

/**
 * The metadata viewer's fixtures, which are the one set here that is NOT built
 * at test time.
 *
 * Everything else in this file is generated because a checked-in binary is a
 * claim about its own contents that nothing verifies. These are the exception,
 * and only because the claim IS verified — `tests/lib/image-client/metadata-viewer-contract.test.js`
 * re-opens every one of them on every run and reads the exact rationals, the
 * exact packet and the exact chunk order back out with independent walkers.
 *
 * They have to be committed rather than generated because they ARE the
 * assertion. A viewer reports what is stored, so the flows here assert that a
 * specific latitude reaches the screen and never reaches a request; a fixture
 * regenerated by whichever sharp is installed would move under both halves of
 * that at once. See `tests/fixtures/metadata/README.md`.
 */
const METADATA_DIR = path.join(__dirname, '..', '..', 'fixtures', 'metadata');

function metadataFixture(name) {
    const file = path.join(METADATA_DIR, name);
    if (!fs.existsSync(file)) {
        throw new Error(`${name} is missing — run \`npm run generate:metadata-fixtures\``);
    }
    return file;
}

const exifGpsJpeg = () => once('exif-gps-72dpi.jpg', exifJpeg);
const signature = () => once('signature-600x200.png', signaturePng);
const transparent = () => once('transparent-320x240.webp', transparentWebp);
const transparentPngFile = () => once('transparent-480x320.png', transparentPng);
const portrait = () => once('portrait-1200x1600.jpg', portraitJpeg);
const lowResPortrait = () => once('portrait-300x300.jpg', lowResPortraitJpeg);
const logoMark = () => once('logo-mark-640x400.png', logoMarkPng);
const lowResLogo = () => once('logo-mark-128x128.png', lowResLogoPng);
const panorama = () => once('panorama-1600x300.jpg', panoramaJpeg);

/**
 * One of the three batch photos, 1600×1067 at quality 92.
 *
 * The names matter to the tests as much as the pixels do: a bulk result is
 * named after the file that produced it, so `bulk-photo-1.jpg` is what makes
 * `bulk-photo-1-compressed.jpg` an assertion about the product's naming rather
 * than about a string this file happened to type twice.
 *
 * Measured on the machine these were tuned on: 347 KB, 344 KB and 331 KB at
 * quality 92, and 84 KB, 83 KB and 80 KB re-encoded at quality 50 — which is
 * the floor the fit policy stops at before it starts spending pixels.
 */
const bulkPhoto = (index) => once(`bulk-photo-${index}.jpg`, (file) => lib()(photoScene(1600, 1067, index), { density: 72 })
    .jpeg({ quality: 92, chromaSubsampling: '4:2:0' })
    .toFile(file));

/** All three, in the order a batch is expected to keep. */
const bulkPhotos = () => Promise.all([bulkPhoto(1), bulkPhoto(2), bulkPhoto(3)]);

const bulkNoisePng = () => once('bulk-noise.png', noisePng);
const notesText = () => once('notes.txt', notes);

module.exports = {
    FIXTURE_DIR: DIR,
    METADATA_DIR,
    metadataFixture,
    bulkNoisePng,
    bulkPhoto,
    bulkPhotos,
    exifGpsJpeg,
    logoMark,
    lowResLogo,
    lowResPortrait,
    notesText,
    panorama,
    portrait,
    signature,
    transparent,
    transparentPng: transparentPngFile,
};
