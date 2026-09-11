/**
 * The report /image-metadata-viewer prints.
 *
 * WHAT A WRONG ANSWER COSTS HERE. This is the one tool on the site that tells a
 * person something they did not already know about their own file, and the
 * thing they most often want to know is whether it says where they live. A
 * longitude whose sign is dropped moves a photograph from London to a point off
 * the coast of Africa; a width read from EXIF instead of from the frame header
 * lets a file lie about its own picture; an extension trusted over the magic
 * bytes calls a PNG a JPEG because somebody renamed it. Each of those has a
 * test below that fails when the guard is removed.
 *
 * AND EVERY VALUE IN THE REPORT IS TEXT. Nothing that leaves this module is
 * markup, a Date, or a buffer: a `<script>` inside an XMP description comes
 * back as a string that happens to contain angle brackets, so the page renders
 * it as characters and there is nothing to escape.
 *
 * THE READERS ARE CROSS-CHECKED, NOT TRUSTED. Format comes from sniffImageType,
 * dimensions from readImageSize, resolution from readResolution and orientation
 * agrees with readExifOrientation — each asserted against the shared module
 * rather than restated, because a second opinion that agrees by construction is
 * not a second opinion.
 */
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import { inspectImageMetadata } from '@/lib/image-client/metadata-report';
import { readImageSize } from '@/lib/image-client/requirements';
import { readResolution } from '@/lib/image-client/dpi';
import { readExifOrientation } from '@/lib/image-client/orientation';
import { sniffImageType } from '@/lib/image/magic-bytes';
import { stripMetadata } from '@/lib/image-client/metadata-strip';
import {
    EXIF_PREFIX,
    JFIF_PAYLOAD,
    buildWebp,
    pngChunk,
    spliceJpegSegments,
    withPngChunks,
} from '../../helpers/image-containers';
import { buildTiff } from './helpers/tiff';
import { formatChain, importClosure } from '../../helpers/import-graph';

/* ------------------------------------------------------------- fixtures */

const cache = new Map();

async function memo(key, build) {
    if (!cache.has(key)) cache.set(key, await build());
    return cache.get(key);
}

const canvas = ({ width = 60, height = 40 } = {}) => sharp({
    create: {
        width, height, channels: 3, background: { r: 200, g: 40, b: 80 },
    },
});

const alphaCanvas = () => sharp({
    create: {
        width: 40, height: 30, channels: 4, background: { r: 10, g: 120, b: 200, alpha: 0.5 },
    },
});

const CAMERA = [
    { tag: 0x010F, type: 2, values: 'Resizo' },
    { tag: 0x0110, type: 2, values: 'Fixture Camera' },
    { tag: 0x0112, type: 3, values: [6] },
    { tag: 0x0131, type: 2, values: 'Resizo Fixtures 1.0' },
    { tag: 0x0132, type: 2, values: '2024:05:02 09:15:00' },
    { tag: 0x013B, type: 2, values: 'A Photographer' },
    { tag: 0x8298, type: 2, values: 'Copyright 2024 Resizo' },
];

const CAPTURE = [
    { tag: 0x829A, type: 5, values: [[1, 250]] },
    { tag: 0x829D, type: 5, values: [[18, 10]] },
    { tag: 0x8827, type: 3, values: [100] },
    { tag: 0x9003, type: 2, values: '2024:05:01 14:03:22' },
    { tag: 0x9004, type: 2, values: '2024:05:01 14:03:23' },
    { tag: 0x9011, type: 2, values: '+01:00' },
    { tag: 0x9291, type: 2, values: '123' },
    { tag: 0x9207, type: 3, values: [5] },
    { tag: 0x9209, type: 3, values: [1] },
    { tag: 0x920A, type: 5, values: [[26, 1]] },
    { tag: 0x9204, type: 10, values: [[-3, 10]] },
    { tag: 0xA403, type: 3, values: [0] },
    { tag: 0xA405, type: 3, values: [26] },
    { tag: 0xA434, type: 2, values: 'Fixture 26mm f/1.8' },
    { tag: 0xA431, type: 2, values: 'BODY-000123' },
    { tag: 0xA420, type: 2, values: 'UNIQUE-0001' },
];

/** The Royal Observatory, Greenwich: 51 deg 28' 40.20" N, 0 deg 00' 05.40" W. */
const GREENWICH = [
    { tag: 0x0000, type: 1, values: Buffer.from([2, 3, 0, 0]) },
    { tag: 0x0001, type: 2, values: 'N' },
    { tag: 0x0002, type: 5, values: [[51, 1], [28, 1], [402, 10]] },
    { tag: 0x0003, type: 2, values: 'W' },
    { tag: 0x0004, type: 5, values: [[0, 1], [0, 1], [54, 10]] },
    { tag: 0x0005, type: 1, values: Buffer.from([0]) },
    { tag: 0x0006, type: 5, values: [[46, 1]] },
    { tag: 0x0007, type: 5, values: [[13, 1], [3, 1], [22, 1]] },
    { tag: 0x001D, type: 2, values: '2024:05:01' },
];

/** The Sydney Opera House: 33 deg 51' 24.50" S, 151 deg 12' 55.10" E. */
const SYDNEY = [
    { tag: 0x0001, type: 2, values: 'S' },
    { tag: 0x0002, type: 5, values: [[33, 1], [51, 1], [245, 10]] },
    { tag: 0x0003, type: 2, values: 'E' },
    { tag: 0x0004, type: 5, values: [[151, 1], [12, 1], [551, 10]] },
    { tag: 0x0005, type: 1, values: Buffer.from([1]) },
    { tag: 0x0006, type: 5, values: [[12, 1]] },
];

async function jpegWith(tiff, extra = []) {
    const base = await canvas().jpeg().toBuffer();
    return spliceJpegSegments(base, [
        { marker: 0xE1, payload: Buffer.concat([EXIF_PREFIX, Buffer.from(tiff)]) },
        ...extra,
    ]);
}

const exifJpeg = () => memo('jpeg:exif', () => jpegWith(buildTiff({ ifd0: CAMERA, exif: CAPTURE })));

const gpsJpeg = () => memo('jpeg:gps', () => jpegWith(
    buildTiff({ ifd0: CAMERA, exif: CAPTURE, gps: GREENWICH }),
));

const sydneyJpeg = () => memo('jpeg:sydney', () => jpegWith(buildTiff({ ifd0: CAMERA, gps: SYDNEY })));

const plainJpeg = () => memo('jpeg:plain', () => canvas().jpeg().toBuffer());

const XMP_PACKET = [
    '<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>',
    '<x:xmpmeta xmlns:x="adobe:ns:meta/">',
    '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">',
    '<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/"',
    ' xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmlns:xmpMM="http://ns.adobe.com/xap/1.0/mm/"',
    ' xmp:CreatorTool="Resizo Fixtures 1.0">',
    '<dc:creator><rdf:Seq><rdf:li>A Photographer</rdf:li></rdf:Seq></dc:creator>',
    '<dc:title><rdf:Alt><rdf:li xml:lang="x-default">A red rectangle</rdf:li></rdf:Alt></dc:title>',
    '<!-- a comment a parser would drop -->',
    '<dc:description><rdf:Alt><rdf:li xml:lang="x-default">'
        + 'Caption with <script>alert(1)</script> in it</rdf:li></rdf:Alt></dc:description>',
    '<dc:rights><rdf:Alt><rdf:li xml:lang="x-default">Resizo &amp; friends</rdf:li></rdf:Alt></dc:rights>',
    '<dc:subject><rdf:Bag><rdf:li>london</rdf:li><rdf:li>test</rdf:li></rdf:Bag></dc:subject>',
    '<xmp:CreateDate>2024-05-01T14:03:22+01:00</xmp:CreateDate>',
    '<xmpMM:DocumentID>xmp.did:0123456789abcdef</xmpMM:DocumentID>',
    '</rdf:Description></rdf:RDF></x:xmpmeta><?xpacket end="w"?>',
].join('');

const XMP_NAMESPACE = Buffer.from('http://ns.adobe.com/xap/1.0/\0', 'latin1');

const xmpJpeg = () => memo('jpeg:xmp', async () => spliceJpegSegments(
    await canvas().jpeg().toBuffer(),
    [{ marker: 0xE1, payload: Buffer.concat([XMP_NAMESPACE, Buffer.from(XMP_PACKET, 'utf8')]) }],
));

const iccJpeg = () => memo('jpeg:icc', () => canvas().withIccProfile('srgb').jpeg().toBuffer());

const dpiJpeg = () => memo('jpeg:dpi', async () => spliceJpegSegments(
    await canvas().jpeg().toBuffer(),
    [{
        marker: 0xE0,
        payload: Buffer.concat([
            JFIF_PAYLOAD.subarray(0, 8),
            Buffer.from([0x01, 0x2C, 0x01, 0x2C, 0x00, 0x00]), // 300 x 300 DPI
        ]),
    }],
));

const bigJpeg = () => memo('jpeg:big', () => canvas({ width: 4032, height: 3024 })
    .withMetadata({ density: 300 })
    .jpeg({ quality: 40 })
    .toBuffer());

const commentJpeg = () => memo('jpeg:comment', async () => spliceJpegSegments(
    await canvas().jpeg().toBuffer(),
    [{ marker: 0xFE, payload: Buffer.from('Taken on the pier', 'latin1') }],
));

const hugeCommentJpeg = () => memo('jpeg:huge-comment', async () => spliceJpegSegments(
    await canvas().jpeg().toBuffer(),
    [{ marker: 0xFE, payload: Buffer.alloc(60000, 0x61) }],
));

/** A zTXt whose keyword is not XMP: compressed text this engine cannot open. */
const zTextPng = () => memo('png:ztxt', async () => withPngChunks(
    await canvas().png().toBuffer(),
    {
        afterIhdr: [pngChunk('zTXt', Buffer.concat([
            Buffer.from('Comment\0', 'latin1'),
            Buffer.from([0x00]), // compression method: deflate
            Buffer.from([0x78, 0x9C, 0x01, 0x00, 0x00, 0xFF, 0xFF]),
        ]))],
    },
));

/** A Photoshop image resource block holding one IPTC caption. */
function photoshopResource(datasets) {
    const records = Buffer.concat(datasets.map(([dataset, text]) => {
        const value = Buffer.from(text, 'latin1');
        const header = Buffer.alloc(5);
        header[0] = 0x1C;
        header[1] = 0x02;
        header[2] = dataset;
        header.writeUInt16BE(value.length, 3);
        return Buffer.concat([header, value]);
    }));

    const size = Buffer.alloc(4);
    size.writeUInt32BE(records.length);

    return Buffer.concat([
        Buffer.from('Photoshop 3.0\0', 'latin1'),
        Buffer.from('8BIM', 'latin1'),
        Buffer.from([0x04, 0x04, 0x00, 0x00]), // IPTC-NAA resource, empty name
        size,
        records,
        records.length % 2 === 1 ? Buffer.alloc(1) : Buffer.alloc(0),
    ]);
}

const iptcJpeg = () => memo('jpeg:iptc', async () => spliceJpegSegments(
    await canvas().jpeg().toBuffer(),
    [{ marker: 0xED, payload: photoshopResource([[120, 'A caption a desktop editor left behind']]) }],
));

/** The same segment with the resource signature broken: nothing is read out. */
const brokenIptcJpeg = () => memo('jpeg:iptc-broken', async () => {
    const payload = Buffer.from(photoshopResource([[120, 'A caption nobody should see']]));
    payload.write('XBIM', 14, 'latin1');
    return spliceJpegSegments(await canvas().jpeg().toBuffer(), [{ marker: 0xED, payload }]);
});

const userCommentJpeg = () => memo('jpeg:user-comment', () => jpegWith(buildTiff({
    ifd0: CAMERA,
    exif: [{
        tag: 0x9286,
        type: 7,
        values: Buffer.concat([
            Buffer.from('ASCII\0\0\0', 'latin1'),
            Buffer.from('A note from the camera', 'latin1'),
        ]),
    }],
})));

const malformedJpeg = () => memo('jpeg:malformed', () => jpegWith(buildTiff({
    ifd0: CAMERA,
    ifd0Offset: 900000,
})));

const alphaTextPng = () => memo('png:alpha-text', async () => withPngChunks(
    await alphaCanvas().png().toBuffer(),
    {
        afterIhdr: [
            pngChunk('tEXt', Buffer.from('Comment\0A plain text chunk', 'latin1')),
            pngChunk('iTXt', Buffer.from('Title\0\0\0en\0Titre\0An international chunk', 'latin1')),
            pngChunk('tIME', Buffer.from([0x07, 0xE8, 0x03, 0x0E, 0x0C, 0x00, 0x00])),
        ],
    },
));

const physPng = () => memo('png:phys', async () => withPngChunks(
    await canvas().png().toBuffer(),
    { afterIhdr: [pngChunk('pHYs', Buffer.from([0, 0, 0x2E, 0x23, 0, 0, 0x2E, 0x23, 1]))] },
));

const iccPng = () => memo('png:icc', () => canvas().withIccProfile('srgb').png().toBuffer());

const apng = () => memo('png:apng', async () => {
    const actl = Buffer.alloc(8);
    actl.writeUInt32BE(2, 0);
    return withPngChunks(await canvas().png().toBuffer(), { afterIhdr: [pngChunk('acTL', actl)] });
});

const webpExifXmp = () => memo('webp:exif-xmp', async () => {
    const source = await canvas().webp().toBuffer();
    const image = Buffer.from(source).subarray(12);

    const vp8x = Buffer.alloc(10);
    vp8x[0] = 0x08 | 0x04 | 0x20; // EXIF, XMP and ICC advertised
    vp8x.writeUIntLE(59, 4, 3);
    vp8x.writeUIntLE(39, 7, 3);

    return buildWebp([
        { type: 'VP8X', payload: vp8x },
        { type: 'ICCP', payload: Buffer.from(await profileOf(await iccJpeg())) },
        { type: 'ANIM', payload: Buffer.alloc(6) },
        { type: 'VP8 ', payload: image.subarray(8) },
        { type: 'EXIF', payload: Buffer.from(buildTiff({ ifd0: CAMERA, gps: GREENWICH })) },
        { type: 'XMP ', payload: Buffer.from(XMP_PACKET, 'utf8') },
    ]);
});

const hugeXmpWebp = () => memo('webp:huge-xmp', async () => {
    const source = await canvas().webp().toBuffer();
    const packet = `<dc:title>${'z'.repeat(70000)}</dc:title>`;

    return buildWebp([
        { type: 'VP8 ', payload: Buffer.from(source).subarray(20) },
        { type: 'XMP ', payload: Buffer.from(packet, 'utf8') },
    ]);
});

async function profileOf(jpeg) {
    const bytes = Buffer.from(jpeg);
    const at = bytes.indexOf(Buffer.from('ICC_PROFILE\0', 'latin1')) + 14;
    return bytes.subarray(at, at + bytes.readUInt32BE(at));
}

/* -------------------------------------------------------------- helpers */

function inspect(bytes, name) {
    return inspectImageMetadata(new Uint8Array(bytes), name === undefined ? {} : { name });
}

function field(report, id) {
    return report.exif.fields.find((entry) => entry.id === id) ?? null;
}

function category(report, id) {
    return report.privacy.categories.find((entry) => entry.id === id) ?? null;
}

function xmpField(report, id) {
    return report.xmp.fields.find((entry) => entry.id === id) ?? null;
}

/* ------------------------------------------------------------ file facts */

describe('inspectImageMetadata, the file itself', () => {
    it('takes the format from the magic bytes and never from the name', async () => {
        const cases = [
            [await plainJpeg(), 'photo.jpg'],
            [await alphaTextPng(), 'photo.jpg'],
            [await webpExifXmp(), 'photo.png'],
        ];

        for (const [bytes, name] of cases) {
            const report = inspect(bytes, name);
            expect(report.file.format).toBe(sniffImageType(new Uint8Array(bytes)));
        }
    });

    it('takes the pixels from the frame header, not from EXIF', async () => {
        // The EXIF says 9999 x 9999; the picture is 60 x 40. A report that
        // believed the metadata would let a file lie about its own image.
        const bytes = await jpegWith(buildTiff({
            ifd0: CAMERA,
            exif: [
                { tag: 0xA002, type: 4, values: [9999] },
                { tag: 0xA003, type: 4, values: [9999] },
            ],
        }));
        const report = inspect(bytes, 'photo.jpg');
        const size = readImageSize(new Uint8Array(bytes));

        expect(report.file.width).toBe(size.width);
        expect(report.file.height).toBe(size.height);
        expect(report.file.width).toBe(60);
        expect(report.file.megapixels).toBe(0);
    });

    it('reports megapixels to one decimal', async () => {
        const report = inspect(await bigJpeg(), 'big.jpg');

        expect(report.file.width).toBe(4032);
        expect(report.file.megapixels).toBe(12.2);
    });

    it('notices a name whose extension disagrees with the bytes', async () => {
        const mismatched = inspect(await alphaTextPng(), 'photo.jpg');

        expect(mismatched.file.extension).toBe('jpg');
        expect(mismatched.file.format).toBe('png');
        expect(mismatched.file.extensionMismatch).toBe(true);
        expect(mismatched.file.expectedExtensions).toEqual(['png']);
    });

    it('accepts every extension a format is written with, and no extension at all', async () => {
        for (const name of ['photo.jpg', 'photo.JPEG', 'photo.jpe', 'photo.jfif']) {
            expect(inspect(await plainJpeg(), name).file.extensionMismatch, name).toBe(false);
        }

        const bare = inspect(await plainJpeg(), 'photo');
        expect(bare.file.extension).toBe(null);
        expect(bare.file.extensionMismatch).toBe(false);

        const unnamed = inspect(await plainJpeg());
        expect(unnamed.file.name).toBe(null);
        expect(unnamed.file.extensionMismatch).toBe(false);
    });

    it('reads the alpha channel and the animation flag from the container', async () => {
        const png = inspect(await alphaTextPng(), 'a.png');
        const jpeg = inspect(await plainJpeg(), 'a.jpg');

        expect(png.file.alphaChannel).toBe(true);
        expect(png.file.animated).toBe(false);
        expect(jpeg.file.alphaChannel).toBe(false);
        expect(jpeg.file.animated).toBe(false);

        expect(inspect(await apng(), 'a.png').file.animated).toBe(true);
        expect(inspect(await webpExifXmp(), 'a.webp').file.animated).toBe(true);
    });

    it('states the MIME type of the bytes and their size', async () => {
        const bytes = await plainJpeg();
        const report = inspect(bytes, 'photo.jpg');

        expect(report.file.mimeType).toBe('image/jpeg');
        expect(report.file.bytes).toBe(bytes.length);
    });
});

/* ------------------------------------------------------------ resolution */

describe('inspectImageMetadata, resolution', () => {
    it('agrees with readResolution and works out the print size', async () => {
        const bytes = await bigJpeg();
        const report = inspect(bytes, 'big.jpg');
        const reading = readResolution(new Uint8Array(bytes));

        expect(report.resolution.present).toBe(true);
        expect(report.resolution.x).toBe(reading.dpi.x);
        expect(report.resolution.y).toBe(reading.dpi.y);
        expect(report.resolution.source).toBe(reading.source);
        expect(report.resolution.unit).toBe('inch');
        expect(report.resolution.printSize).toEqual({ widthIn: 13.44, heightIn: 10.08 });
    });

    it('reads a JFIF density header', async () => {
        const report = inspect(await dpiJpeg(), 'dpi.jpg');

        expect(report.resolution).toMatchObject({ present: true, x: 300, y: 300, source: 'jfif' });
        expect(report.resolution.raw.jfif).toEqual({ units: 1, xDensity: 300, yDensity: 300 });
    });

    it('reads a PNG pHYs chunk', async () => {
        const bytes = await physPng();
        const report = inspect(bytes, 'phys.png');

        expect(report.resolution.source).toBe('phys');
        expect(report.resolution.x).toBe(readResolution(new Uint8Array(bytes)).dpi.x);
        expect(report.resolution.x).toBe(300);
    });

    it('says nothing rather than guessing when a container cannot state one', async () => {
        const report = inspect(await webpExifXmp(), 'a.webp');

        expect(report.resolution.present).toBe(false);
        expect(report.resolution.x).toBe(null);
        expect(report.resolution.printSize).toBe(null);
        expect(report.resolution.source).toBe(null);
    });
});

/* ------------------------------------------------------------------ EXIF */

describe('inspectImageMetadata, EXIF', () => {
    it('reads both byte orders to the same curated fields', async () => {
        for (const order of ['II', 'MM']) {
            const bytes = await jpegWith(buildTiff({ order, ifd0: CAMERA, exif: CAPTURE }));
            const report = inspect(bytes, 'photo.jpg');

            expect(report.exif.present, order).toBe(true);
            expect(report.exif.byteOrder, order).toBe(order);
            expect(field(report, 'make').value, order).toBe('Resizo');
            expect(field(report, 'model').value, order).toBe('Fixture Camera');
            expect(field(report, 'lens').value, order).toBe('Fixture 26mm f/1.8');
        }
    });

    it('formats the numbers a photographer reads as a photographer reads them', async () => {
        const report = inspect(await exifJpeg(), 'photo.jpg');

        expect(field(report, 'exposureTime').value).toBe('1/250 s');
        expect(field(report, 'fNumber').value).toBe('f/1.8');
        expect(field(report, 'iso').value).toBe('100');
        expect(field(report, 'focalLength').value).toBe('26 mm');
        expect(field(report, 'focalLength35').value).toBe('26 mm equivalent');
        expect(field(report, 'exposureBias').value).toBe('-0.3 EV');
        expect(field(report, 'flash').value).toBe('Flash fired');
        expect(field(report, 'meteringMode').value).toBe('Pattern');
        expect(field(report, 'whiteBalance').value).toBe('Automatic');
        expect(field(report, 'serials').value).toBe('BODY-000123');
        expect(field(report, 'imageUniqueId').value).toBe('UNIQUE-0001');
    });

    it('leaves out a row whose tag is absent', async () => {
        const bytes = await jpegWith(buildTiff({ ifd0: [{ tag: 0x010F, type: 2, values: 'Resizo' }] }));
        const report = inspect(bytes, 'photo.jpg');

        expect(report.exif.fields.map((entry) => entry.id)).toEqual(['make']);
        expect(field(report, 'model')).toBe(null);
    });

    it('lists its fields in a fixed display order', async () => {
        const ids = inspect(await exifJpeg(), 'photo.jpg').exif.fields.map((entry) => entry.id);

        expect(ids).toEqual([
            'make', 'model', 'lens', 'software', 'dateTimeOriginal', 'dateTimeDigitized',
            'dateTime', 'exposureTime', 'fNumber', 'iso', 'focalLength', 'focalLength35',
            'exposureBias', 'flash', 'meteringMode', 'whiteBalance', 'artist', 'copyright',
            'imageUniqueId', 'serials',
        ]);
        for (const entry of inspect(await exifJpeg(), 'photo.jpg').exif.fields) {
            expect(typeof entry.value).toBe('string');
            expect(typeof entry.label).toBe('string');
        }
    });

    it('describes all eight orientations and reports an absent one as absent', async () => {
        const expected = {
            1: 'Normal',
            2: 'Mirrored horizontally',
            3: 'Rotate 180°',
            4: 'Mirrored vertically',
            5: 'Mirror horizontally, then rotate 90° counter-clockwise',
            6: 'Rotate 90° clockwise',
            7: 'Mirror horizontally, then rotate 90° clockwise',
            8: 'Rotate 90° counter-clockwise',
        };

        for (let value = 1; value <= 8; value += 1) {
            const bytes = await jpegWith(buildTiff({ ifd0: [{ tag: 0x0112, type: 3, values: [value] }] }));
            const report = inspect(bytes, 'photo.jpg');

            expect(report.exif.orientation.value, `orientation ${value}`).toBe(value);
            expect(report.exif.orientation.description, `orientation ${value}`).toBe(expected[value]);
            expect(typeof report.exif.orientation.transform).toBe('string');
            // The turner answers "leave it alone" where the report says "absent".
            expect(report.exif.orientation.value).toBe(readExifOrientation(new Uint8Array(bytes)));
        }

        const none = inspect(await plainJpeg(), 'photo.jpg');
        expect(none.exif.orientation).toEqual({ value: null, description: null, transform: null });
    });

    it('keeps a date as it was stored and reformats only the separators', async () => {
        const report = inspect(await exifJpeg(), 'photo.jpg');
        const taken = report.exif.dates.find((entry) => entry.id === 'dateTimeOriginal');

        expect(taken.stored).toBe('2024:05:01 14:03:22');
        expect(taken.display).toBe('2024-05-01 14:03:22');
        expect(taken.offset).toBe('+01:00');
        expect(taken.subseconds).toBe('123');
        expect(taken.note).not.toMatch(/no time zone recorded/);

        const changed = report.exif.dates.find((entry) => entry.id === 'dateTime');
        expect(changed.stored).toBe('2024:05:02 09:15:00');
        expect(changed.offset).toBe(null);
        expect(changed.note).toBe('Local time as stored, no time zone recorded');

        expect(JSON.parse(JSON.stringify(report)).exif.dates).toEqual(report.exif.dates);
        for (const entry of report.exif.dates) {
            expect(entry.stored instanceof Date).toBe(false);
            expect(typeof entry.stored).toBe('string');
        }
    });

    it('counts what it read and reports a file with no EXIF as having none', async () => {
        expect(inspect(await exifJpeg(), 'photo.jpg').exif.entryCount).toBeGreaterThan(10);

        const empty = inspect(await plainJpeg(), 'photo.jpg');
        expect(empty.exif.present).toBe(false);
        expect(empty.exif.fields).toEqual([]);
        expect(empty.exif.dates).toEqual([]);
        expect(empty.exif.entryCount).toBe(0);
        expect(empty.exif.problems).toEqual([]);
    });
});

/* ------------------------------------------------------------------- GPS */

describe('inspectImageMetadata, location', () => {
    it('converts degrees, minutes and seconds to a decimal', async () => {
        const report = inspect(await gpsJpeg(), 'photo.jpg');

        expect(report.gps.present).toBe(true);
        expect(report.gps.latitude).toBeCloseTo(51.477833333, 8);
        expect(report.gps.longitude).toBeCloseTo(-0.0015, 8);
        expect(report.gps.altitude).toEqual({ metres: 46, belowSeaLevel: false });
        expect(report.gps.problems).toEqual([]);
    });

    /**
     * THE SIGN IS THE WHOLE ANSWER. Greenwich sits five arc-seconds WEST of the
     * meridian, so a reader that ignores the reference letter reports +0.0015
     * instead of -0.0015 — and a southern-hemisphere photograph lands in the
     * wrong hemisphere entirely. This test fails the moment the Ref is dropped.
     */
    it('takes the sign from the reference letter, in both hemispheres', async () => {
        const north = inspect(await gpsJpeg(), 'photo.jpg');
        const south = inspect(await sydneyJpeg(), 'photo.jpg');

        expect(north.gps.latitude).toBeGreaterThan(0);
        expect(north.gps.longitude).toBeLessThan(0);
        expect(north.gps.raw.longitudeRef).toBe('W');

        expect(south.gps.latitude).toBeCloseTo(-33.856805555, 8);
        expect(south.gps.longitude).toBeCloseTo(151.215305555, 8);
        expect(south.gps.altitude).toEqual({ metres: 12, belowSeaLevel: true });
    });

    it('keeps the stored rationals beside the decimal it worked out', async () => {
        const report = inspect(await gpsJpeg(), 'photo.jpg');

        expect(report.gps.raw.latitudeRef).toBe('N');
        expect(report.gps.raw.latitude).toEqual([
            { numerator: 51, denominator: 1 },
            { numerator: 28, denominator: 1 },
            { numerator: 402, denominator: 10 },
        ]);
    });

    it('refuses a coordinate with no reference letter', async () => {
        const bytes = await jpegWith(buildTiff({
            ifd0: CAMERA,
            gps: [
                { tag: 0x0002, type: 5, values: [[51, 1], [28, 1], [402, 10]] },
                { tag: 0x0004, type: 5, values: [[0, 1], [0, 1], [54, 10]] },
            ],
        }));
        const report = inspect(bytes, 'photo.jpg');

        expect(report.gps.present).toBe(true);
        expect(report.gps.latitude).toBe(null);
        expect(report.gps.longitude).toBe(null);
        expect(report.gps.problems.length).toBeGreaterThan(0);
        expect(report.gps.problems.join(' ')).toMatch(/north|south|east|west|reference/i);
    });

    it('refuses a rational whose denominator is zero', async () => {
        const bytes = await jpegWith(buildTiff({
            ifd0: CAMERA,
            gps: [
                { tag: 0x0001, type: 2, values: 'N' },
                { tag: 0x0002, type: 5, values: [[51, 0], [28, 1], [402, 10]] },
            ],
        }));
        const report = inspect(bytes, 'photo.jpg');

        expect(report.gps.latitude).toBe(null);
        expect(report.gps.problems.length).toBeGreaterThan(0);
    });

    it('refuses a coordinate outside the world', async () => {
        const bytes = await jpegWith(buildTiff({
            ifd0: CAMERA,
            gps: [
                { tag: 0x0001, type: 2, values: 'N' },
                { tag: 0x0002, type: 5, values: [[130, 1], [0, 1], [0, 1]] },
                { tag: 0x0003, type: 2, values: 'E' },
                { tag: 0x0004, type: 5, values: [[400, 1], [0, 1], [0, 1]] },
            ],
        }));
        const report = inspect(bytes, 'photo.jpg');

        expect(report.gps.latitude).toBe(null);
        expect(report.gps.longitude).toBe(null);
        expect(report.gps.problems.length).toBeGreaterThan(0);
    });

    it('marks the GPS timestamp as UTC, because the specification does', async () => {
        const report = inspect(await gpsJpeg(), 'photo.jpg');

        expect(report.gps.timestamp).toEqual({ date: '2024-05-01', time: '13:03:22', utc: true });
    });

    it('reports a file with no GPS as having none', async () => {
        const report = inspect(await exifJpeg(), 'photo.jpg');

        expect(report.gps.present).toBe(false);
        expect(report.gps.latitude).toBe(null);
        expect(report.gps.timestamp).toBe(null);
        expect(report.gps.problems).toEqual([]);
        expect(report.privacy.location).toBe(false);
    });
});

/* ------------------------------------------------------------------- XMP */

describe('inspectImageMetadata, XMP', () => {
    it('reads the curated fields out of a packet without an XML parser', async () => {
        const report = inspect(await xmpJpeg(), 'photo.jpg');

        expect(report.xmp.present).toBe(true);
        expect(report.xmp.extended).toBe(false);
        expect(report.xmp.bytes).toBeGreaterThan(100);
        expect(xmpField(report, 'dc:creator').value).toBe('A Photographer');
        expect(xmpField(report, 'dc:title').value).toBe('A red rectangle');
        expect(xmpField(report, 'dc:subject').value).toBe('london, test');
        expect(xmpField(report, 'xmp:CreatorTool').value).toBe('Resizo Fixtures 1.0');
        expect(xmpField(report, 'xmp:CreateDate').value).toBe('2024-05-01T14:03:22+01:00');
        expect(xmpField(report, 'xmpMM:DocumentID').value).toBe('xmp.did:0123456789abcdef');
    });

    it('decodes the five XML entities and leaves everything else literal', async () => {
        const report = inspect(await xmpJpeg(), 'photo.jpg');

        expect(xmpField(report, 'dc:rights').value).toBe('Resizo & friends');
    });

    /**
     * A packet is somebody else's text. The reader's job is to hand back a
     * STRING, not to sanitise markup it does not understand — the page renders
     * it as a React text node, so a script tag is characters on a screen.
     */
    it('hands back a script tag as characters, not as markup', async () => {
        const value = xmpField(inspect(await xmpJpeg(), 'photo.jpg'), 'dc:description').value;

        expect(typeof value).toBe('string');
        expect(value).toContain('<script>alert(1)</script>');
        expect(value).toBe('Caption with <script>alert(1)</script> in it');
    });

    it('caps the packet it keeps and says that it did', async () => {
        const small = inspect(await xmpJpeg(), 'photo.jpg');
        expect(small.xmp.truncated).toBe(false);
        expect(small.xmp.packet).toContain('<dc:creator>');

        const huge = inspect(await hugeXmpWebp(), 'huge.webp');
        expect(huge.xmp.present).toBe(true);
        expect(huge.xmp.packet.length).toBe(65536);
        expect(huge.xmp.truncated).toBe(true);
        expect(huge.problems.length).toBeGreaterThan(0);
    });

    it('reads a WebP XMP chunk the same way', async () => {
        const report = inspect(await webpExifXmp(), 'a.webp');

        expect(report.xmp.present).toBe(true);
        expect(xmpField(report, 'dc:creator').value).toBe('A Photographer');
    });

    it('reports a file with no XMP as having none', async () => {
        const report = inspect(await plainJpeg(), 'photo.jpg');

        expect(report.xmp).toEqual({
            present: false, bytes: 0, extended: false, fields: [], packet: null, truncated: false,
        });
    });
});

/* ------------------------------------------------------------------- ICC */

describe('inspectImageMetadata, colour profile', () => {
    it('names the profile a JPEG carries in APP2', async () => {
        const report = inspect(await iccJpeg(), 'photo.jpg');

        expect(report.icc.present).toBe(true);
        expect(report.icc.source).toBe('app2');
        expect(report.icc.description).toMatch(/^sRGB/);
        expect(report.icc.colourSpace).toBe('RGB');
        expect(report.icc.version).toBe('4.2');
        expect(report.icc.compressed).toBe(false);
        expect(report.icc.bytes).toBeGreaterThan(100);
    });

    it('names the profile a WebP carries in ICCP', async () => {
        const report = inspect(await webpExifXmp(), 'a.webp');

        expect(report.icc).toMatchObject({ present: true, source: 'ICCP', colourSpace: 'RGB' });
    });

    it('reports a PNG iCCP by name only, because it is compressed', async () => {
        const report = inspect(await iccPng(), 'photo.png');

        expect(report.icc.present).toBe(true);
        expect(report.icc.source).toBe('iCCP');
        expect(report.icc.compressed).toBe(true);
        expect(report.icc.description).toBe(null);
        expect(report.icc.colourSpace).toBe(null);
        expect(report.raw.some((row) => row.group === 'ICC' && row.name === 'icc')).toBe(true);
    });

    it('reports a file with no profile as having none', async () => {
        const report = inspect(await plainJpeg(), 'photo.jpg');

        expect(report.icc.present).toBe(false);
        expect(report.icc.bytes).toBe(0);
        expect(report.icc.source).toBe(null);
    });
});

/* --------------------------------------------------------- text and other */

describe('inspectImageMetadata, comments and text', () => {
    it('reads a JPEG comment', async () => {
        const report = inspect(await commentJpeg(), 'photo.jpg');

        expect(report.text).toEqual([{
            source: 'comment',
            keyword: null,
            value: 'Taken on the pier',
            truncated: false,
            bytes: 17,
            compressed: false,
        }]);
    });

    it('reads both readable PNG text shapes and marks a compressed one', async () => {
        const report = inspect(await alphaTextPng(), 'photo.png');
        const sources = report.text.map((entry) => entry.keyword);

        expect(sources).toEqual(['Comment', 'Title']);
        expect(report.text[0]).toMatchObject({ source: 'png-text', value: 'A plain text chunk', compressed: false });
        expect(report.text[1]).toMatchObject({ value: 'An international chunk', compressed: false });

        const zipped = inspect(await zTextPng(), 'z.png').text.find((entry) => entry.compressed);
        expect(zipped).toMatchObject({
            source: 'png-text', keyword: 'Comment', value: '', truncated: false, compressed: true,
        });
        expect(zipped.bytes).toBeGreaterThan(0);
    });

    /**
     * sharp writes a PNG's XMP as a COMPRESSED zTXt, and there is no inflater in
     * this engine. Saying "no XMP" would be wrong — the packet is there — and
     * inventing its contents would be worse, so the packet is reported as
     * present and unreadable, with a sentence saying why.
     */
    it('reports a compressed XMP packet as present and unreadable', async () => {
        const report = inspect(await canvas().withXmp('<x:xmpmeta>packed</x:xmpmeta>').png().toBuffer(), 'x.png');

        expect(report.xmp.present).toBe(true);
        expect(report.xmp.packet).toBe(null);
        expect(report.xmp.fields).toEqual([]);
        expect(report.xmp.bytes).toBeGreaterThan(0);
        expect(report.problems).toContain('The XMP packet is compressed, so its fields could not be read.');
    });

    it('reads an IPTC caption out of a Photoshop resource block', async () => {
        const report = inspect(await iptcJpeg(), 'photo.jpg');
        const caption = report.text.find((entry) => entry.source === 'iptc');

        expect(caption).toMatchObject({ keyword: 'Caption', value: 'A caption a desktop editor left behind' });
        expect(report.other.iptc).toBe(true);
        expect(category(report, 'text').present).toBe(true);
    });

    it('stops at a Photoshop resource block that is not one', async () => {
        const report = inspect(await brokenIptcJpeg(), 'photo.jpg');

        expect(report.ok).toBe(true);
        expect(report.other.iptc).toBe(true);
        expect(report.text.filter((entry) => entry.source === 'iptc')).toEqual([]);
    });

    it('reads a UserComment out of the EXIF block', async () => {
        const report = inspect(await userCommentJpeg(), 'photo.jpg');
        const comment = report.text.find((entry) => entry.source === 'user-comment');

        expect(comment.value).toBe('A note from the camera');
        expect(comment.keyword).toBe('UserComment');
    });

    it('cuts a sixty-thousand-byte comment to two thousand characters', async () => {
        const report = inspect(await hugeCommentJpeg(), 'photo.jpg');

        expect(report.text[0].bytes).toBe(60000);
        expect(report.text[0].value.length).toBe(2000);
        expect(report.text[0].truncated).toBe(true);
        // The cut is the page's to explain beside the value; nothing failed to read.
        expect(report.problems).toEqual([]);
    });

    it('reports the container facts a page has a row for', async () => {
        const jfif = inspect(await dpiJpeg(), 'dpi.jpg');
        expect(jfif.other.jfif).toEqual({
            version: '1.2', units: 1, xDensity: 300, yDensity: 300, thumbnail: false,
        });

        const png = inspect(await alphaTextPng(), 'a.png');
        expect(png.other.pngTime).toBe('2024-03-14 12:00:00 UTC');

        const plain = inspect(await plainJpeg(), 'a.jpg');
        expect(plain.other).toMatchObject({
            thumbnail: false, iptc: false, mpf: false, trailer: false, trailerBytes: 0, adobe: false,
        });
        expect(plain.other.jfif).toBe(null);
        expect(plain.other.pngTime).toBe(null);
    });

    it('notices a thumbnail hiding in IFD1', async () => {
        const bytes = await jpegWith(buildTiff({
            ifd0: CAMERA,
            ifd1: [{ tag: 0x0103, type: 3, values: [6] }],
        }));

        expect(inspect(bytes, 'photo.jpg').other.thumbnail).toBe(true);
        expect(category(inspect(bytes, 'photo.jpg'), 'thumbnail').present).toBe(true);
    });
});

/* --------------------------------------------------------------- privacy */

describe('inspectImageMetadata, the privacy summary', () => {
    it('names every category a photo with a full EXIF block triggers', async () => {
        const report = inspect(await gpsJpeg(), 'photo.jpg');
        const present = report.privacy.categories
            .filter((entry) => entry.present)
            .map((entry) => entry.id);

        expect(report.privacy.location).toBe(true);
        expect(present).toEqual(expect.arrayContaining([
            'location', 'capture-time', 'device', 'creator', 'software',
        ]));
        expect(report.privacy.removable).toBe(true);
        for (const entry of report.privacy.categories) {
            expect(typeof entry.summary).toBe('string');
            expect(entry.summary.length).toBeGreaterThan(0);
        }
    });

    it('lists its categories in a fixed order, present or not', async () => {
        const ids = inspect(await plainJpeg(), 'photo.jpg').privacy.categories.map((entry) => entry.id);

        expect(ids).toEqual([
            'location', 'capture-time', 'device', 'creator', 'software', 'text',
            'thumbnail', 'extra-images',
        ]);
    });

    /**
     * `removable` is the remover's own verdict, not a second opinion: the page
     * offers a link to /remove-image-metadata behind it, and offering that link
     * for a file with nothing to take out is the one wrong answer.
     */
    it('agrees with the remover about whether there is anything to remove', async () => {
        for (const [name, bytes] of [['plain', await plainJpeg()], ['exif', await gpsJpeg()], ['icc', await iccJpeg()]]) {
            const report = inspect(bytes, 'photo.jpg');
            const stripped = stripMetadata(new Uint8Array(bytes));

            expect(report.privacy.removable, name).toBe(stripped.removed.length > 0);
        }
    });

    it('says a file carries nothing when it carries nothing', async () => {
        const report = inspect(await plainJpeg(), 'photo.jpg');

        expect(report.exif.present).toBe(false);
        expect(report.gps.present).toBe(false);
        expect(report.xmp.present).toBe(false);
        expect(report.icc.present).toBe(false);
        expect(report.text).toEqual([]);
        expect(report.privacy.categories.every((entry) => !entry.present)).toBe(true);
        expect(report.privacy.removable).toBe(false);
        expect(report.problems).toEqual([]);
    });
});

/* ------------------------------------------------------------------- raw */

describe('inspectImageMetadata, the full field list', () => {
    it('gives one row per EXIF entry, with a hex tag and a text value', async () => {
        const report = inspect(await gpsJpeg(), 'photo.jpg');
        const ifd0 = report.raw.filter((row) => row.group === 'IFD0');

        expect(ifd0.length).toBeGreaterThanOrEqual(CAMERA.length);
        expect(ifd0.some((row) => row.tag === '0x010F' && row.name === 'Make' && row.value === 'Resizo')).toBe(true);
        expect(report.raw.some((row) => row.group === 'GPS' && row.name === 'GPSLatitudeRef')).toBe(true);
        expect(report.raw.some((row) => row.group === 'Exif' && row.name === 'ExposureTime' && row.value === '1/250')).toBe(true);
        expect(report.raw.some((row) => row.group === 'JPEG' && row.tag === 'APP1')).toBe(true);
    });

    it('keeps every raw value under twenty thousand characters', async () => {
        for (const bytes of [await gpsJpeg(), await xmpJpeg(), await hugeCommentJpeg(), await webpExifXmp()]) {
            for (const row of inspect(bytes, 'photo.jpg').raw) {
                expect(typeof row.value).toBe('string');
                expect(row.value.length).toBeLessThanOrEqual(20_000);
                expect(typeof row.truncated).toBe('boolean');
            }
        }
    });

    it('describes a binary block by size and never dumps it', async () => {
        const report = inspect(await iccJpeg(), 'photo.jpg');
        const icc = report.raw.filter((row) => row.group === 'ICC');
        const profile = Buffer.from(await profileOf(await iccJpeg()));

        expect(icc.length).toBeGreaterThan(0);
        expect(icc.find((row) => row.tag === 'size').value).toMatch(/^\d+ bytes$/);
        for (const row of icc) expect(row.value).not.toMatch(/[\u0000-\u001F]/);

        // Thirty-two bytes from the middle of the profile. A report that dumped
        // the block instead of describing it would carry them.
        expect(JSON.stringify(report)).not.toContain(profile.subarray(200, 232).toString('latin1'));
    });

    it('never lets a control character out of a text value', async () => {
        for (const bytes of [await gpsJpeg(), await xmpJpeg(), await alphaTextPng()]) {
            for (const row of inspect(bytes, 'photo.jpg').raw) {
                expect(row.value).not.toMatch(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/);
            }
        }
    });
});

/* ------------------------------------------------------- refusals and rot */

describe('inspectImageMetadata, refusals', () => {
    it('refuses a HEIC by name rather than trying to open it', () => {
        const heic = new Uint8Array(16);
        heic[3] = 16;
        for (const [label, at] of [['ftyp', 4], ['heic', 8]]) {
            for (let i = 0; i < label.length; i += 1) heic[at + i] = label.charCodeAt(i);
        }

        const report = inspectImageMetadata(heic, { name: 'photo.heic' });
        expect(report).toMatchObject({ ok: false, code: 'unsupported', format: 'heic' });
        expect(typeof report.message).toBe('string');
    });

    it('refuses a truncated container', async () => {
        const truncated = new Uint8Array(Buffer.from(await webpExifXmp()).subarray(0, 20));
        const report = inspectImageMetadata(truncated, { name: 'photo.webp' });

        expect(report).toMatchObject({ ok: false, code: 'invalid' });
    });

    it('refuses bytes that are not an image at all', () => {
        const report = inspectImageMetadata(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]), { name: 'x.jpg' });

        expect(report).toMatchObject({ ok: false, code: 'unsupported', format: null });
        expect(report.message).not.toMatch(/undefined|Uint8Array|at \w+ \(/);
    });

    /**
     * A broken EXIF block must cost the EXIF section and nothing else. Every
     * fact about the FILE — its format, its pixels, its size — was read from the
     * container and is still true.
     */
    it('keeps every file fact when the EXIF block is malformed', async () => {
        const bytes = await malformedJpeg();
        const report = inspect(bytes, 'photo.jpg');

        expect(report.ok).toBe(true);
        expect(report.file.format).toBe('jpeg');
        expect(report.file.width).toBe(60);
        expect(report.file.height).toBe(40);
        expect(report.exif.present).toBe(true);
        expect(report.exif.problems.length).toBeGreaterThan(0);
        expect(report.problems.length).toBeGreaterThan(0);
        expect(report.problems.every((sentence) => sentence.endsWith('.'))).toBe(true);
    });

    it('keeps every file fact when an entry count is absurd', async () => {
        const bytes = await jpegWith(buildTiff({ ifd0: CAMERA, ifd0Count: 60000 }));
        const report = inspect(bytes, 'photo.jpg');

        expect(report.ok).toBe(true);
        expect(report.file.width).toBe(60);
        expect(field(report, 'make').value).toBe('Resizo');
        expect(report.exif.problems.length).toBeGreaterThan(0);
    });

    it('keeps every file fact when a value offset runs off the end', async () => {
        const bytes = await jpegWith(buildTiff({
            ifd0: [
                { tag: 0x010F, type: 2, values: 'Resizo' },
                { tag: 0x0131, type: 2, count: 4096, offset: 800000 },
            ],
        }));
        const report = inspect(bytes, 'photo.jpg');

        expect(report.ok).toBe(true);
        expect(report.file.width).toBe(60);
        expect(field(report, 'make').value).toBe('Resizo');
        expect(field(report, 'software')).toBe(null);
        expect(report.exif.problems.length).toBeGreaterThan(0);
    });
});

/* ------------------------------------------------------------ properties */

describe('inspectImageMetadata, the properties every report holds', () => {
    async function everyFixture() {
        return [
            ['plain jpeg', await plainJpeg(), 'plain.jpg'],
            ['exif jpeg', await exifJpeg(), 'exif.jpg'],
            ['gps jpeg', await gpsJpeg(), 'gps.jpg'],
            ['sydney jpeg', await sydneyJpeg(), 'sydney.jpg'],
            ['xmp jpeg', await xmpJpeg(), 'xmp.jpg'],
            ['icc jpeg', await iccJpeg(), 'icc.jpg'],
            ['dpi jpeg', await dpiJpeg(), 'dpi.jpg'],
            ['comment jpeg', await commentJpeg(), 'comment.jpg'],
            ['huge comment jpeg', await hugeCommentJpeg(), 'huge.jpg'],
            ['malformed jpeg', await malformedJpeg(), 'malformed.jpg'],
            ['png alpha and text', await alphaTextPng(), 'alpha.png'],
            ['png phys', await physPng(), 'phys.png'],
            ['png icc', await iccPng(), 'icc.png'],
            ['apng', await apng(), 'animated.png'],
            ['png named jpg', await alphaTextPng(), 'renamed.jpg'],
            ['webp exif and xmp', await webpExifXmp(), 'webp.webp'],
            ['webp huge xmp', await hugeXmpWebp(), 'huge.webp'],
        ];
    }

    it('never changes the bytes it was given', async () => {
        for (const [name, bytes] of await everyFixture()) {
            const input = new Uint8Array(bytes);
            const copy = Buffer.from(input);

            inspectImageMetadata(input, { name: 'photo.jpg' });

            expect(Buffer.from(input).equals(copy), name).toBe(true);
        }
    });

    it('gives the same answer twice for the same bytes and name', async () => {
        for (const [name, bytes, filename] of await everyFixture()) {
            expect(inspect(bytes, filename), name).toEqual(inspect(bytes, filename));
        }
    });

    it('agrees with the shared readers about format and pixels', async () => {
        for (const [name, bytes, filename] of await everyFixture()) {
            const input = new Uint8Array(bytes);
            const report = inspect(bytes, filename);
            const size = readImageSize(input);

            expect(report.file.format, name).toBe(sniffImageType(input));
            expect(report.file.width, name).toBe(size ? size.width : null);
            expect(report.file.height, name).toBe(size ? size.height : null);
            expect(report.file.alphaChannel, name).toBe(size ? size.hasAlpha : null);
        }
    });

    it('keeps every coordinate inside the world and every orientation legal', async () => {
        for (const [name, bytes, filename] of await everyFixture()) {
            const report = inspect(bytes, filename);

            if (report.gps.latitude !== null) {
                expect(Math.abs(report.gps.latitude), name).toBeLessThanOrEqual(90);
            }
            if (report.gps.longitude !== null) {
                expect(Math.abs(report.gps.longitude), name).toBeLessThanOrEqual(180);
            }
            if (report.exif.orientation.value !== null) {
                expect(report.exif.orientation.value, name).toBeGreaterThanOrEqual(1);
                expect(report.exif.orientation.value, name).toBeLessThanOrEqual(8);
            }
        }
    });

    it('survives one flipped byte in every metadata block, with the file facts intact', async () => {
        const bytes = new Uint8Array(await gpsJpeg());
        const clean = inspectImageMetadata(bytes, { name: 'photo.jpg' });

        for (let at = 2; at < 200; at += 7) {
            const damaged = new Uint8Array(bytes);
            damaged[at] ^= 0xFF;

            const report = inspectImageMetadata(damaged, { name: 'photo.jpg' });
            expect(() => JSON.stringify(report), `byte ${at}`).not.toThrow();

            if (report.ok) {
                expect(report.file.format, `byte ${at}`).toBe(clean.file.format);
                expect(report.file.bytes, `byte ${at}`).toBe(clean.file.bytes);
            } else {
                expect(['invalid', 'unsupported'], `byte ${at}`).toContain(report.code);
            }
        }
    });

    it('serialises to JSON with no Date, no buffer and no undefined', async () => {
        for (const [name, bytes, filename] of await everyFixture()) {
            const report = inspect(bytes, filename);

            expect(JSON.parse(JSON.stringify(report)), name).toEqual(report);
        }
    });
});

/* ------------------------------------------------- what the page downloads */

describe('inspectImageMetadata, the weight it puts on a page', () => {
    /**
     * THE VIEWER DECODES NOTHING, so it must not download a decoder.
     *
     * This report is built on the main thread the moment a file is dropped, and
     * it only ever reads bytes — no codec, no canvas, no worker. Every module
     * below is part of the engine that turns pixels into other pixels, and one
     * static import of any of them puts all of it in the first load of a page
     * that will never call it. The reach is measured rather than reasoned
     * about, because the edge that costs the bytes is usually two modules away:
     * readImageSize looks free until you notice which file it lives in.
     */
    it('reaches none of the pixel engine through its static imports', () => {
        const engine = [
            'lib/image-client/encode.js',
            'lib/image-client/resize.js',
            'lib/image-client/flatten.js',
            'lib/image-client/capability.js',
            'lib/image-client/codecs.js',
            'lib/image-client/target-bytes.js',
            'lib/image-client/decode.js',
            'lib/image-client/client.js',
            'lib/image-client/image.worker.js',
        ];

        const closure = importClosure('lib/image-client/metadata-report.js', { edges: 'static' });

        for (const file of engine) {
            const chain = closure.get(file);
            expect(chain ? formatChain(chain) : null, `${file} must not be reachable`).toBe(null);
        }
    });

    it('reaches nothing outside lib/, and no page copy', () => {
        const closure = [...importClosure('lib/image-client/metadata-report.js', { edges: 'static' }).keys()];

        for (const file of closure) {
            expect(file.startsWith('lib/'), file).toBe(true);
            expect(file.startsWith('lib/catalog/'), file).toBe(false);
        }
    });
});

describe('what the review refuted', () => {
    const base = () => sharp({ create: { width: 40, height: 30, channels: 3, background: { r: 200, g: 40, b: 80 } } }).jpeg().toBuffer();
    const withExif = async (tiff) => spliceJpegSegments(await base(), [
        { marker: 0xE1, payload: Buffer.concat([EXIF_PREFIX, Buffer.from(tiff)]) },
    ]);

    it('takes the hemisphere from the letter even when the rationals are stored negative', async () => {
        const tiff = buildTiff({
            byteOrder: 'II',
            ifd0: [{ tag: 0x010F, type: 2, values: 'Resizo' }],
            gps: [
                { tag: 0x0001, type: 2, values: 'N' },
                { tag: 0x0002, type: 10, values: [[-51, 1], [-28, 1], [-402, 10]] },
                { tag: 0x0003, type: 2, values: 'W' },
                { tag: 0x0004, type: 10, values: [[0, 1], [0, 1], [-54, 10]] },
            ],
        });
        const report = inspectImageMetadata(await withExif(tiff), { name: 'negative.jpg' });

        expect(report.gps.present).toBe(true);
        expect(report.gps.latitude).toBeCloseTo(51.477833, 5);
        expect(report.gps.longitude).toBeCloseTo(-0.0015, 5);
    });

    it('keeps a raw value past 500 characters, so the page can offer the rest of it', async () => {
        const tiff = buildTiff({
            byteOrder: 'II',
            ifd0: [{ tag: 0x0131, type: 2, values: 'x'.repeat(1_500) }],
        });
        const report = inspectImageMetadata(await withExif(tiff), { name: 'software.jpg' });

        const row = report.raw.find((entry) => entry.tag === '0x0131');
        expect(row, 'no raw row for Software').toBeTruthy();
        expect(row.value.length).toBe(1_500);
        expect(row.truncated).toBe(false);
    });

    it('says when the EXIF reader itself cut a value, in the raw row too', async () => {
        const tiff = buildTiff({
            byteOrder: 'II',
            ifd0: [{ tag: 0x0131, type: 2, values: 'y'.repeat(5_000) }],
        });
        const report = inspectImageMetadata(await withExif(tiff), { name: 'software.jpg' });

        const row = report.raw.find((entry) => entry.tag === '0x0131');
        expect(row.value.length).toBeLessThanOrEqual(4_096);
        expect(row.truncated).toBe(true);
    });
});

describe('a display cut is not a read failure', () => {
    it('marks a comment the page will shorten as truncated, without calling it unreadable', async () => {
        const report = inspect(await hugeCommentJpeg(), 'photo.jpg');
        const comment = report.text.find((entry) => entry.source === 'comment');

        expect(comment.truncated).toBe(true);
        expect(comment.bytes).toBe(60_000);
        expect(report.problems).toEqual([]);
    });
});
