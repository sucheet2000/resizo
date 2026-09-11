#!/usr/bin/env node
/**
 * The metadata viewer's fixtures.
 *
 * WHY THESE ARE COMMITTED WHEN tests/e2e/fixtures/files.js COMMITS NOTHING.
 * That file argues, correctly, that a checked-in binary is a claim about its
 * own contents that nothing verifies. These are the exception, and only
 * because the claim IS verified: tests/lib/image-client/metadata-viewer-contract.test.js
 * re-opens every file below on every run and reads it back with the
 * independent walkers in tests/helpers/image-containers.js and with sharp,
 * asserting the exact rationals, the exact packet and the exact profile. A
 * fixture that drifted fails there before it can mislead anything else.
 *
 * The other half of the reason is that these files ARE the assertion. A
 * viewer's whole job is to report what is stored, so "51 degrees 28 minutes
 * 40.2 seconds north" has to be the same bytes today and in a year — and a
 * fixture regenerated at run time by whichever sharp is installed would move
 * under the tests that quote it. sharp draws the PICTURE here; every metadata
 * block is written by hand from the format specs.
 *
 * NOTHING HERE IS A PHOTOGRAPH AND NOBODY'S LOCATION IS IN IT. The pictures
 * are flat rectangles composited by sharp. The two sets of coordinates are
 * public landmarks — the Royal Observatory Greenwich and the Sydney Opera
 * House — chosen because a reader can check them against a map, and because
 * the prime meridian gives a longitude just west of zero, which is the sign
 * a viewer is most likely to get wrong. See tests/fixtures/metadata/README.md.
 *
 * DETERMINISM IS A REQUIREMENT, NOT A NICETY. Two runs of this script must
 * produce byte-identical files or the fixtures are not fixtures: fixed sharp
 * settings, no clock, no PRNG, and the only timestamps in the output are the
 * ones written into EXIF, XMP and ICC on purpose.
 *
 * Usage: node scripts/generate-metadata-fixtures.js
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'tests', 'fixtures', 'metadata');
const SAMPLE_FILE = path.join(ROOT, 'public', 'samples', 'metadata-sample.jpg');

const sharp = require('sharp');

/** Fixed for every JPEG here: quality and subsampling both change the bytes. */
const JPEG = { quality: 82, chromaSubsampling: '4:2:0', mozjpeg: false };
const PNG = { compressionLevel: 9, palette: false };
const WEBP = { lossless: true, effort: 4 };

/** 300 DPI as PNG stores it: pixels per metre, which is what pHYs holds. */
const PHYS_300_DPI = Math.round(300 / 0.0254);

/* ------------------------------------------------------------ the picture */

/**
 * A few flat blocks on a ground, composited rather than drawn from SVG.
 *
 * SVG would go through librsvg, whose rasterisation can move between versions;
 * `create` inputs are pure libvips arithmetic and land on the same bytes
 * everywhere. Nothing here needs to look like a photograph — every one of
 * these files is read for its metadata and never for its pixels.
 */
function shapes(width, height, { ground, blocks, alpha = false }) {
    const band = (fraction) => Math.max(1, Math.round(height * fraction));

    return sharp({
        create: {
            width,
            height,
            channels: alpha ? 4 : 3,
            background: alpha ? { ...ground, alpha: 0 } : ground,
        },
    }).composite(blocks.map((block, index) => ({
        input: {
            create: {
                width: Math.max(1, Math.round(width * block.width)),
                height: band(block.height),
                channels: 4,
                background: { ...block.colour, alpha: block.alpha ?? 1 },
            },
        },
        left: Math.round(width * block.left),
        top: Math.round(height * (0.1 + index * 0.22)),
    })));
}

const OPAQUE = {
    ground: { r: 232, g: 236, b: 240 },
    blocks: [
        { left: 0.06, width: 0.5, height: 0.18, colour: { r: 40, g: 84, b: 132 } },
        { left: 0.3, width: 0.6, height: 0.16, colour: { r: 196, g: 72, b: 58 } },
        { left: 0.12, width: 0.42, height: 0.2, colour: { r: 62, g: 128, b: 96 } },
    ],
};

/** The same composition over nothing, so the corners are genuinely clear. */
const TRANSPARENT = { ...OPAQUE, alpha: true };

// removeAlpha, because compositing an RGBA block onto an RGB ground leaves an
// RGBA result: without it every PNG here comes out colour type 6 and
// "does this file declare an alpha channel" has the same answer on all of
// them, which is the one thing png-alpha-text.png exists to contrast with.
const opaqueJpeg = (width, height) => shapes(width, height, OPAQUE).jpeg(JPEG).toBuffer();
const opaquePng = (width, height) => shapes(width, height, OPAQUE).removeAlpha().png(PNG).toBuffer();
const alphaPng = (width, height) => shapes(width, height, TRANSPARENT).png(PNG).toBuffer();
const opaqueWebp = (width, height) => shapes(width, height, OPAQUE).removeAlpha().webp(WEBP).toBuffer();
const alphaWebp = (width, height) => shapes(width, height, TRANSPARENT).webp(WEBP).toBuffer();

/* ------------------------------------------------------- the metadata sets */

const CAMERA_MAKE = 'Resizo';
const CAMERA_MODEL = 'Fixture Camera';
const LENS_MODEL = 'Fixture 26mm f/1.8';
const SOFTWARE = 'Resizo Fixture Writer 1.0';
const ARTIST = 'Resizo Test Suite';
const COPYRIGHT = 'Public domain, generated for tests';
const DATE_TIME_ORIGINAL = '2024:05:01 14:03:22';
const DATE_TIME = '2024:05:01 14:05:00';
const OFFSET_TIME = '+01:00';
const IMAGE_UNIQUE_ID = 'RESIZOFIXTURE00000000000000001';
const USER_COMMENT = 'Fixture user comment';
// Long and unbroken on purpose: a path an editor writes and a share URL, the
// two real-world values that widen a phone screen when a page lets them.
const LONG_SOFTWARE = `Adobe_Photoshop_2024_Windows_${'C:\\Users\\example\\Pictures\\'.repeat(6)}export.jpg`;
const LONG_URL = `https://photos.example.test/albums/${'a1b2c3d4e5f6'.repeat(30)}`;
const LONG_DESCRIPTION = 'x'.repeat(800);

/**
 * The camera block, as a phone writes one.
 *
 * TWO TAGS HERE ARE DELIBERATELY WRONG, and that is the point of them.
 * PixelXDimension and PixelYDimension say 4032 x 3024 on a file that is
 * 800 x 600, which is exactly what a resizer that forgot to rewrite them
 * leaves behind — and it is the trap a viewer falls into when it reports
 * "dimensions" out of EXIF instead of out of the image header. The report has
 * to take its width and height from the SOF, and this pair is what proves it.
 */
function cameraIfd0(TIFF_TYPES) {
    return [
        { tag: 0x010E, type: TIFF_TYPES.ASCII, values: 'Synthetic shapes, not a photograph' },
        { tag: 0x010F, type: TIFF_TYPES.ASCII, values: CAMERA_MAKE },
        { tag: 0x0110, type: TIFF_TYPES.ASCII, values: CAMERA_MODEL },
        { tag: 0x0112, type: TIFF_TYPES.SHORT, values: [6] },
        { tag: 0x011A, type: TIFF_TYPES.RATIONAL, values: [[300, 1]] },
        { tag: 0x011B, type: TIFF_TYPES.RATIONAL, values: [[300, 1]] },
        { tag: 0x0128, type: TIFF_TYPES.SHORT, values: [2] },
        { tag: 0x0131, type: TIFF_TYPES.ASCII, values: SOFTWARE },
        { tag: 0x0132, type: TIFF_TYPES.ASCII, values: DATE_TIME },
        { tag: 0x013B, type: TIFF_TYPES.ASCII, values: ARTIST },
        { tag: 0x0213, type: TIFF_TYPES.SHORT, values: [1] },
        { tag: 0x8298, type: TIFF_TYPES.ASCII, values: COPYRIGHT },
    ];
}

function cameraExif(TIFF_TYPES) {
    return [
        { tag: 0x829A, type: TIFF_TYPES.RATIONAL, values: [[1, 250]] },
        { tag: 0x829D, type: TIFF_TYPES.RATIONAL, values: [[18, 10]] },
        { tag: 0x8822, type: TIFF_TYPES.SHORT, values: [2] },
        { tag: 0x8827, type: TIFF_TYPES.SHORT, values: [100] },
        { tag: 0x9000, type: TIFF_TYPES.UNDEFINED, values: '0232' },
        { tag: 0x9003, type: TIFF_TYPES.ASCII, values: DATE_TIME_ORIGINAL },
        { tag: 0x9004, type: TIFF_TYPES.ASCII, values: DATE_TIME_ORIGINAL },
        { tag: 0x9010, type: TIFF_TYPES.ASCII, values: OFFSET_TIME },
        { tag: 0x9011, type: TIFF_TYPES.ASCII, values: OFFSET_TIME },
        // log2(250) and 2*log2(1.8), to three decimals, as a camera writes them.
        { tag: 0x9201, type: TIFF_TYPES.SRATIONAL, values: [[7965, 1000]] },
        { tag: 0x9202, type: TIFF_TYPES.RATIONAL, values: [[1695, 1000]] },
        // A NEGATIVE srational: -1/3 EV. The one value in this set that a
        // parser reading rationals as unsigned turns into 4.29 billion.
        { tag: 0x9204, type: TIFF_TYPES.SRATIONAL, values: [[-1, 3]] },
        { tag: 0x9207, type: TIFF_TYPES.SHORT, values: [5] },
        { tag: 0x9209, type: TIFF_TYPES.SHORT, values: [16] },
        { tag: 0x920A, type: TIFF_TYPES.RATIONAL, values: [[26, 1]] },
        // 'ASCII\0\0\0' — the 8-byte charset header a UserComment begins with.
        { tag: 0x9286, type: TIFF_TYPES.UNDEFINED, values: `ASCII\0\0\0${USER_COMMENT}` },
        { tag: 0x9291, type: TIFF_TYPES.ASCII, values: '123' },
        { tag: 0xA001, type: TIFF_TYPES.SHORT, values: [1] },
        { tag: 0xA002, type: TIFF_TYPES.LONG, values: [4032] },
        { tag: 0xA003, type: TIFF_TYPES.LONG, values: [3024] },
        { tag: 0xA402, type: TIFF_TYPES.SHORT, values: [0] },
        { tag: 0xA403, type: TIFF_TYPES.SHORT, values: [0] },
        { tag: 0xA405, type: TIFF_TYPES.SHORT, values: [26] },
        { tag: 0xA406, type: TIFF_TYPES.SHORT, values: [0] },
        { tag: 0xA420, type: TIFF_TYPES.ASCII, values: IMAGE_UNIQUE_ID },
        { tag: 0xA431, type: TIFF_TYPES.ASCII, values: 'BODY-0001' },
        { tag: 0xA432, type: TIFF_TYPES.RATIONAL, values: [[26, 1], [26, 1], [18, 10], [18, 10]] },
        { tag: 0xA433, type: TIFF_TYPES.ASCII, values: CAMERA_MAKE },
        { tag: 0xA434, type: TIFF_TYPES.ASCII, values: LENS_MODEL },
        { tag: 0xA435, type: TIFF_TYPES.ASCII, values: 'LENS-0001' },
    ];
}

/**
 * A GPS IFD for one place.
 *
 * `altitudeRef` 0 is above sea level and 1 is below it, and the altitude
 * itself is always an unsigned rational — so the sign of an altitude lives in
 * a different tag from the number, which is the second sign bug a viewer can
 * have after the latitude one.
 */
function gpsIfd(TIFF_TYPES, helpers, place) {
    const { dmsRationals } = helpers;
    const entries = [
        { tag: 0x0000, type: TIFF_TYPES.BYTE, values: [2, 3, 0, 0] },
        { tag: 0x0001, type: TIFF_TYPES.ASCII, values: place.latitudeRef },
        { tag: 0x0002, type: TIFF_TYPES.RATIONAL, values: dmsRationals(place.latitude) },
        { tag: 0x0003, type: TIFF_TYPES.ASCII, values: place.longitudeRef },
        { tag: 0x0004, type: TIFF_TYPES.RATIONAL, values: dmsRationals(place.longitude) },
    ];

    if (place.altitude) {
        entries.push({ tag: 0x0005, type: TIFF_TYPES.BYTE, values: [place.altitude.ref] });
        entries.push({ tag: 0x0006, type: TIFF_TYPES.RATIONAL, values: [place.altitude.metres] });
    }

    if (place.time) {
        entries.push({ tag: 0x0007, type: TIFF_TYPES.RATIONAL, values: place.time });
        entries.push({ tag: 0x001D, type: TIFF_TYPES.ASCII, values: place.date });
    }

    if (place.mapDatum) entries.push({ tag: 0x0012, type: TIFF_TYPES.ASCII, values: place.mapDatum });

    return entries;
}

/**
 * The Royal Observatory Greenwich: 51 degrees 28' 40.2" N, 0 degrees 00' 5.4" W.
 *
 * Two things make this the right first fixture. The longitude is a few metres
 * WEST of the prime meridian, so the decimal is -0.0015 — small, negative, and
 * exactly the value a viewer that ignored the 'W' reference reports as
 * +0.0015. And both are public landmarks with published coordinates, so no
 * person's whereabouts is in this repository.
 */
const GREENWICH = {
    latitude: { degrees: 51, minutes: 28, seconds: 40.2 },
    latitudeRef: 'N',
    longitude: { degrees: 0, minutes: 0, seconds: 5.4 },
    longitudeRef: 'W',
    altitude: { ref: 0, metres: [46, 1] },
    time: [[13, 1], [3, 1], [22, 1]],
    date: '2024:05:01',
    mapDatum: 'WGS-84',
};

/**
 * The Sydney Opera House: 33 degrees 51' 24.5" S, 151 degrees 12' 55.1" E.
 *
 * The southern, eastern half of the world, so both signs are the other way
 * round from Greenwich — a viewer that hard-coded one hemisphere passes the
 * fixture above and fails this one. Written big-endian for the same reason:
 * half the cameras in the world are 'MM' and a little-endian-only reader gets
 * a latitude of about 855 million degrees.
 */
const SYDNEY = {
    latitude: { degrees: 33, minutes: 51, seconds: 24.5 },
    latitudeRef: 'S',
    longitude: { degrees: 151, minutes: 12, seconds: 55.1 },
    longitudeRef: 'E',
};

/* ------------------------------------------------------------------- XMP */

/**
 * The XMP packet, and the one fixture in this file that is adversarial.
 *
 * dc:description holds an ESCAPED script element, so a viewer that decodes
 * entities correctly ends up holding the string "<script>alert(1)</script>" —
 * which then has to reach the page as TEXT. That is the whole risk in showing
 * a stranger's metadata, and it cannot be tested with polite copy.
 *
 * The packet also carries an UNESCAPED HTML comment between two properties.
 * That one is aimed at the scanner rather than the renderer: a field reader
 * built out of a regex, or one that reached for DOMParser, behaves differently
 * when markup it does not own is sitting in the middle of the packet.
 */
function xmpProperties() {
    return [
        '<dc:creator><rdf:Seq><rdf:li>Resizo Test Suite</rdf:li></rdf:Seq></dc:creator>',
        '<dc:title><rdf:Alt><rdf:li xml:lang="x-default">Fixture with an XMP packet</rdf:li>'
        + '</rdf:Alt></dc:title>',
        '<!-- an HTML comment sitting between two properties, <script>alert(2)</script> -->',
        '<dc:description><rdf:Alt><rdf:li xml:lang="x-default">'
        + '&lt;script&gt;alert(1)&lt;/script&gt; &amp; a quote &quot;here&quot;'
        + '</rdf:li></rdf:Alt></dc:description>',
        '<dc:rights><rdf:Alt><rdf:li xml:lang="x-default">Public domain</rdf:li></rdf:Alt></dc:rights>',
        '<dc:subject><rdf:Bag><rdf:li>fixture</rdf:li><rdf:li>metadata</rdf:li>'
        + '<rdf:li>no photograph</rdf:li></rdf:Bag></dc:subject>',
        '<xmp:CreateDate>2024-05-01T14:03:22+01:00</xmp:CreateDate>',
        '<xmp:ModifyDate>2024-05-01T14:05:00+01:00</xmp:ModifyDate>',
        '<xmp:MetadataDate>2024-05-01T14:05:00+01:00</xmp:MetadataDate>',
        '<photoshop:DateCreated>2024-05-01</photoshop:DateCreated>',
        '<xmpMM:DocumentID>xmp.did:RESIZO-FIXTURE-0001</xmpMM:DocumentID>',
    ].join('');
}

/** xmp:CreatorTool in attribute form, because real packets mix the two. */
const XMP_ATTRIBUTES = 'xmp:CreatorTool="Resizo Fixture Writer 1.0"';

/* ------------------------------------------------------------ the writing */

const written = [];

function write(name, bytes) {
    const file = path.join(OUT_DIR, name);
    fs.writeFileSync(file, bytes);
    written.push({ name, bytes: bytes.length });
    return file;
}

async function main() {
    // The container builders are ESM and shared with the test suite, which is
    // the point: the fixtures and the tests that read them back are built out
    // of one set of walkers written from the format specs.
    const containers = await import('../tests/helpers/image-containers.js');
    const {
        TIFF_TYPES,
        buildIccProfile,
        buildTiff,
        buildWebp,
        dmsRationals,
        exifApp1,
        iccApp2,
        jfifPayload,
        pngChunk,
        riffChunks,
        spliceJpegSegments,
        vp8xPayload,
        withPngChunks,
        xmpApp1,
        xmpPacket,
    } = containers;

    fs.mkdirSync(OUT_DIR, { recursive: true });
    fs.mkdirSync(path.dirname(SAMPLE_FILE), { recursive: true });

    const helpers = { dmsRationals };

    /* -------------------------------------------------------------- JPEG */

    // Nothing at all. sharp writes no JFIF APP0 and no Exif of its own, so
    // this really is a JPEG with zero metadata segments — the control every
    // "nothing was found" assertion needs.
    write('plain.jpg', await opaqueJpeg(120, 80));

    const cameraTiff = buildTiff({
        byteOrder: 'II',
        ifd0: cameraIfd0(TIFF_TYPES),
        exif: cameraExif(TIFF_TYPES),
    });
    write('exif-camera.jpg', spliceJpegSegments(await opaqueJpeg(800, 600), [
        { marker: 0xE1, payload: exifApp1(cameraTiff) },
    ]));

    // The embedded preview: a real 48 x 36 JPEG of the same shapes, which is
    // what makes "this file contains an embedded preview image" a fact about
    // bytes rather than about a tag that says so.
    const preview = await opaqueJpeg(48, 36);
    const greenwichTiff = buildTiff({
        byteOrder: 'II',
        ifd0: cameraIfd0(TIFF_TYPES),
        exif: cameraExif(TIFF_TYPES),
        gps: gpsIfd(TIFF_TYPES, helpers, GREENWICH),
        ifd1: [{ tag: 0x0103, type: TIFF_TYPES.SHORT, values: [6] }],
        thumbnail: preview,
    });
    const greenwich = write('gps-greenwich.jpg', spliceJpegSegments(await opaqueJpeg(480, 360), [
        { marker: 0xE1, payload: exifApp1(greenwichTiff) },
    ]));

    write('gps-sydney.jpg', spliceJpegSegments(await opaqueJpeg(200, 150), [
        {
            marker: 0xE1,
            payload: exifApp1(buildTiff({
                byteOrder: 'MM',
                ifd0: [{ tag: 0x010F, type: TIFF_TYPES.ASCII, values: CAMERA_MAKE }],
                gps: gpsIfd(TIFF_TYPES, helpers, SYDNEY),
            })),
        },
    ]));

    write('dpi-300.jpg', spliceJpegSegments(await opaqueJpeg(300, 200), [
        { marker: 0xE0, payload: jfifPayload({ units: 1, xDensity: 300, yDensity: 300 }) },
    ]));

    write('icc-srgb.jpg', spliceJpegSegments(await opaqueJpeg(140, 100), [
        { marker: 0xE2, payload: iccApp2(buildIccProfile()) },
    ]));

    write('xmp.jpg', spliceJpegSegments(await opaqueJpeg(180, 120), [
        { marker: 0xE1, payload: xmpApp1(xmpPacket(xmpProperties(), { attributes: XMP_ATTRIBUTES })) },
    ]));

    // A valid TIFF header whose IFD0 offset points a long way past the end of
    // the block. The JFIF beside it is intact, so this file's job is to prove
    // that one unreadable block costs its own section and nothing else.
    const brokenTiff = Buffer.from(buildTiff({
        byteOrder: 'II',
        ifd0: cameraIfd0(TIFF_TYPES),
    }));
    brokenTiff.writeUInt32LE(0x00FFFFFF, 4);
    write('malformed-exif.jpg', spliceJpegSegments(await opaqueJpeg(120, 90), [
        { marker: 0xE0, payload: jfifPayload({ units: 1, xDensity: 72, yDensity: 72 }) },
        { marker: 0xE1, payload: exifApp1(brokenTiff) },
    ]));

    // 60,000 bytes of comment: thirty times what the report will show, so the
    // truncation path is real rather than theoretical, and well inside the
    // 65,533 a JPEG segment can hold.
    const line = 'Resizo fixture comment. Byte-only padding, no personal data. ';
    const comment = Buffer.from(line.repeat(Math.ceil(60_000 / line.length)).slice(0, 60_000), 'latin1');
    write('huge-comment.jpg', spliceJpegSegments(await opaqueJpeg(130, 90), [
        { marker: 0xFE, payload: comment },
    ]));

    /* --------------------------------------------------------------- PNG */

    // sharp writes a pHYs of 1000 pixels per metre into every PNG, which reads
    // back as 25 DPI. It is replaced here rather than left, so this file
    // states 300 DPI and the one below states nothing.
    const longTiff = buildTiff({
        byteOrder: 'II',
        ifd0: [
            { tag: 0x010E, type: TIFF_TYPES.ASCII, values: LONG_DESCRIPTION },
            { tag: 0x010F, type: TIFF_TYPES.ASCII, values: CAMERA_MAKE },
            { tag: 0x0131, type: TIFF_TYPES.ASCII, values: LONG_SOFTWARE },
        ],
        exif: [{ tag: 0x9286, type: TIFF_TYPES.UNDEFINED, values: `ASCII\0\0\0${LONG_URL}` }],
    });
    write('long-values.jpg', spliceJpegSegments(await opaqueJpeg(160, 100), [
        { marker: 0xE1, payload: exifApp1(longTiff) },
    ]));

    write('png-phys.png', withPngChunks(await opaquePng(220, 160), {
        drop: ['pHYs'],
        afterIhdr: [pngChunk('pHYs', (() => {
            const data = Buffer.alloc(9);
            data.writeUInt32BE(PHYS_300_DPI, 0);
            data.writeUInt32BE(PHYS_300_DPI, 4);
            data[8] = 1;
            return data;
        })())],
    }));

    const iTXt = Buffer.concat([
        Buffer.from('Description\0', 'latin1'),
        Buffer.from([0, 0]),
        Buffer.from('en\0\0', 'latin1'),
        // UTF-8, and deliberately not ASCII: an iTXt is the one text chunk
        // that is defined as Unicode, and a reader that treated it as latin1
        // mangles this line visibly.
        Buffer.from('Shapes drawn by sharp — ünïcøde intact ✓', 'utf8'),
    ]);
    write('png-alpha-text.png', withPngChunks(await alphaPng(240, 180), {
        drop: ['pHYs'],
        afterIhdr: [pngChunk('tEXt', Buffer.from('Comment\0Resizo fixture: a PNG carrying text chunks', 'latin1'))],
        beforeIend: [pngChunk('iTXt', iTXt)],
    }));

    // A PNG under a .jpg name, and nothing else wrong with it: no text, no
    // resolution, no camera block. The extension is the only thing that lies,
    // so a report that calls this a JPEG has nothing else to blame.
    write('png-as-jpg.jpg', withPngChunks(await opaquePng(100, 100), { drop: ['pHYs'] }));

    /* -------------------------------------------------------------- WebP */

    const imageChunk = (webp) => {
        const { chunks } = riffChunks(webp);
        const image = chunks.find((chunk) => chunk.type === 'VP8L' || chunk.type === 'VP8 ');
        if (!image) throw new Error('sharp produced a WebP with no image chunk');
        return { type: image.type, payload: image.payload };
    };

    write('webp-alpha.webp', buildWebp([
        { type: 'VP8X', payload: vp8xPayload({ width: 260, height: 200, alpha: true }) },
        imageChunk(await alphaWebp(260, 200)),
    ]));

    // EXIF without the 'Exif\0\0' header, which is what the WebP container
    // spec asks for and what libwebp and exiftool write. The prefixed variant
    // real cameras also emit is covered by a synthetic in the property suite,
    // so both paths are proved without a second committed binary.
    write('webp-exif-xmp.webp', buildWebp([
        {
            type: 'VP8X',
            payload: vp8xPayload({
                width: 280, height: 210, icc: true, exif: true, xmp: true,
            }),
        },
        { type: 'ICCP', payload: buildIccProfile({ description: 'Resizo Fixture WebP RGB' }) },
        imageChunk(await opaqueWebp(280, 210)),
        {
            type: 'EXIF',
            payload: buildTiff({
                byteOrder: 'II',
                ifd0: [
                    { tag: 0x010F, type: TIFF_TYPES.ASCII, values: CAMERA_MAKE },
                    { tag: 0x0110, type: TIFF_TYPES.ASCII, values: CAMERA_MODEL },
                    { tag: 0x0131, type: TIFF_TYPES.ASCII, values: SOFTWARE },
                ],
                exif: [{ tag: 0x9003, type: TIFF_TYPES.ASCII, values: DATE_TIME_ORIGINAL }],
            }),
        },
        { type: 'XMP ', payload: xmpPacket(xmpProperties(), { attributes: XMP_ATTRIBUTES }) },
    ]));

    /* --------------------------------------------- the page's own sample */

    // The viewer's "Try the sample photo" button. It is a copy rather than a
    // second generation so the page and the tests are looking at one file:
    // the coordinates the E2E flows assert never leave the device are the same
    // bytes the flows put in.
    fs.copyFileSync(greenwich, SAMPLE_FILE);
    written.push({
        name: path.relative(ROOT, SAMPLE_FILE),
        bytes: fs.statSync(SAMPLE_FILE).size,
    });

    await verify(containers);

    for (const entry of written) {
        process.stdout.write(`${entry.name.padEnd(34)} ${String(entry.bytes).padStart(7)} bytes\n`);
    }
}

/* ------------------------------------------------------- the self-check */

function check(label, actual, expected) {
    const same = JSON.stringify(actual) === JSON.stringify(expected);
    if (!same) throw new Error(`${label}: wrote ${JSON.stringify(actual)}, meant ${JSON.stringify(expected)}`);
}

/**
 * Every file, re-opened and read back.
 *
 * This is not the test suite — tests/lib/image-client/metadata-viewer-contract.test.js
 * is, and it asserts far more. This is the generator refusing to leave a wrong
 * file on disk: the day sharp changes how it writes a PNG, or a builder here
 * gains an off-by-one, the run fails instead of quietly committing a fixture
 * that every other suite then trusts.
 */
async function verify(containers) {
    const { jpegSegments, pngChunks, riffChunks, dmsDecimal, dmsRationals } = containers;
    const read = (name) => fs.readFileSync(path.join(OUT_DIR, name));

    const plain = jpegSegments(read('plain.jpg'));
    check('plain.jpg segment markers', plain.segments.map((s) => s.marker).filter((m) => m >= 0xE0), []);

    const camera = await sharp(read('exif-camera.jpg')).metadata();
    check('exif-camera.jpg size', [camera.width, camera.height], [800, 600]);
    check('exif-camera.jpg orientation', camera.orientation, 6);
    check('exif-camera.jpg has exif', Boolean(camera.exif), true);

    const gps = await sharp(read('gps-greenwich.jpg')).metadata();
    check('gps-greenwich.jpg size', [gps.width, gps.height], [480, 360]);
    check(
        'gps-greenwich.jpg latitude',
        Number(dmsDecimal(dmsRationals(GREENWICH.latitude), 'N').toFixed(6)),
        51.477833,
    );
    check(
        'gps-greenwich.jpg longitude',
        dmsDecimal(dmsRationals(GREENWICH.longitude), 'W'),
        -0.0015,
    );

    const dpi = await sharp(read('dpi-300.jpg')).metadata();
    check('dpi-300.jpg density', dpi.density, 300);

    const icc = await sharp(read('icc-srgb.jpg')).metadata();
    check('icc-srgb.jpg has icc', Boolean(icc.icc), true);

    const phys = pngChunks(read('png-phys.png'));
    const physChunk = phys.chunks.find((chunk) => chunk.type === 'pHYs');
    check('png-phys.png pHYs', [physChunk.data.readUInt32BE(0), physChunk.data[8]], [PHYS_300_DPI, 1]);

    const opaquePngFile = pngChunks(read('png-as-jpg.jpg'));
    check('png-as-jpg.jpg colour type', opaquePngFile.chunks[0].data[9], 2);
    check('png-as-jpg.jpg has no pHYs', opaquePngFile.chunks.some((chunk) => chunk.type === 'pHYs'), false);

    const text = pngChunks(read('png-alpha-text.png'));
    check('png-alpha-text.png colour type', text.chunks[0].data[9], 6);
    check(
        'png-alpha-text.png text chunks',
        text.chunks.map((chunk) => chunk.type).filter((type) => type === 'tEXt' || type === 'iTXt'),
        ['tEXt', 'iTXt'],
    );
    check('png-alpha-text.png has no pHYs', text.chunks.some((chunk) => chunk.type === 'pHYs'), false);
    check('png-alpha-text.png every CRC', text.chunks.every((chunk) => chunk.crcOk), true);

    const alpha = await sharp(read('webp-alpha.webp')).metadata();
    check('webp-alpha.webp alpha', alpha.hasAlpha, true);
    const alphaRiff = riffChunks(read('webp-alpha.webp'));
    check('webp-alpha.webp VP8X alpha flag', (alphaRiff.chunks[0].payload[0] & 0x10) !== 0, true);

    const webpMeta = riffChunks(read('webp-exif-xmp.webp'));
    check(
        'webp-exif-xmp.webp chunks',
        webpMeta.chunks.map((chunk) => chunk.type),
        ['VP8X', 'ICCP', 'VP8L', 'EXIF', 'XMP '],
    );

    const asJpg = read('png-as-jpg.jpg');
    check('png-as-jpg.jpg is really a PNG', asJpg.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');

    const broken = jpegSegments(read('malformed-exif.jpg'));
    check('malformed-exif.jpg keeps its JFIF', broken.segments[0].marker, 0xE0);
    check(
        'malformed-exif.jpg IFD0 offset',
        broken.segments[1].payload.readUInt32LE(6 + 4),
        0x00FFFFFF,
    );

    const huge = jpegSegments(read('huge-comment.jpg'));
    const com = huge.segments.find((segment) => segment.marker === 0xFE);
    check('huge-comment.jpg comment length', com.payload.length, 60_000);

    const long = jpegSegments(read('long-values.jpg'));
    check(
        'long-values.jpg carries the unbroken path',
        long.segments.some((segment) => segment.marker === 0xE1 && segment.payload.includes(Buffer.from(LONG_SOFTWARE, 'latin1'))),
        true,
    );

    const sample = fs.readFileSync(SAMPLE_FILE);
    check('metadata-sample.jpg is gps-greenwich.jpg', sample.equals(read('gps-greenwich.jpg')), true);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
