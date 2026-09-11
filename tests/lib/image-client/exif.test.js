/**
 * The EXIF reader, fed structures no camera would write.
 *
 * WHY EVERY FIXTURE HERE IS HAND-BUILT. sharp writes well-formed TIFF and
 * nothing else, so a suite built only from sharp output proves the reader can
 * read correct files — which is the easy half. The bytes that matter are the
 * ones a stranger's phone, a broken export or an attacker produces: an IFD
 * offset past the end of the block, an entry count of 60,000, an ASCII value
 * whose pointer lands outside the file. Each of those has to cost a line in
 * `problems` and nothing else. A throw here is a page that shows a visitor
 * nothing about a photo it could have described almost completely.
 *
 * THE WRITER IS THE TESTS' OWN — helpers/tiff.js, written from the TIFF 6.0
 * specification and deliberately more capable than the reader: it will emit
 * both byte orders, out-of-line values, a GPS IFD, an Exif IFD, an IFD1 and
 * counts that do not match what follows them.
 */
import { describe, expect, it } from 'vitest';

import { readExif } from '@/lib/image-client/exif';
import { locateMetadata } from '@/lib/image-client/metadata-strip';
import { readExifOrientation } from '@/lib/image-client/orientation';
import { spliceJpegSegments, EXIF_PREFIX } from '../../helpers/image-containers';
import { buildTiff } from './helpers/tiff';
import { jpegWithExifAndGps, splitRedBlueJpegOriented } from './helpers/fixtures';

function read(tiff, overrides = {}) {
    const bytes = new Uint8Array(tiff);
    return readExif(bytes, { tiffStart: 0, end: bytes.length, ...overrides });
}

function byTag(entries, tag) {
    return entries.find((entry) => entry.tag === tag) ?? null;
}

function named(entries, name) {
    return entries.find((entry) => entry.name === name) ?? null;
}

/* -------------------------------------------------------------- fixtures */

const CAMERA = [
    { tag: 0x010F, type: 2, values: 'Resizo' },
    { tag: 0x0110, type: 2, values: 'Fixture Camera' },
    { tag: 0x0112, type: 3, values: [6] },
    { tag: 0x011A, type: 5, values: [[300, 1]] },
    { tag: 0x011B, type: 5, values: [[300, 1]] },
    { tag: 0x0128, type: 3, values: [2] },
    { tag: 0x0131, type: 2, values: 'Resizo Fixtures 1.0' },
    { tag: 0x0132, type: 2, values: '2024:05:01 14:03:22' },
    { tag: 0x013B, type: 2, values: 'A Photographer' },
    { tag: 0x8298, type: 2, values: 'Copyright 2024' },
    { tag: 0x010E, type: 2, values: 'A red rectangle' },
];

const CAPTURE = [
    { tag: 0x829A, type: 5, values: [[1, 250]] },
    { tag: 0x829D, type: 5, values: [[18, 10]] },
    { tag: 0x8827, type: 3, values: [100] },
    { tag: 0x9000, type: 7, values: Buffer.from('0232', 'latin1') },
    { tag: 0x9003, type: 2, values: '2024:05:01 14:03:22' },
    { tag: 0x9004, type: 2, values: '2024:05:01 14:03:23' },
    { tag: 0x9011, type: 2, values: '+01:00' },
    { tag: 0x9291, type: 2, values: '123' },
    { tag: 0x9207, type: 3, values: [5] },
    { tag: 0x9209, type: 3, values: [16] },
    { tag: 0x920A, type: 5, values: [[26, 1]] },
    { tag: 0xA405, type: 3, values: [26] },
    { tag: 0xA434, type: 2, values: 'Fixture 26mm f/1.8' },
];

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

/* ------------------------------------------------------------------ tests */

describe('readExif, a well-formed block', () => {
    it('reads both byte orders to the same values', () => {
        for (const order of ['II', 'MM']) {
            const result = read(buildTiff({ order, ifd0: CAMERA, exif: CAPTURE, gps: GREENWICH }));

            expect(result.ok, order).toBe(true);
            expect(result.byteOrder, order).toBe(order);
            expect(named(result.ifd0, 'Make').value, order).toBe('Resizo');
            expect(named(result.ifd0, 'Model').value, order).toBe('Fixture Camera');
            expect(named(result.ifd0, 'Orientation').value, order).toBe(6);
            expect(named(result.ifd0, 'XResolution').value, order).toEqual({ numerator: 300, denominator: 1 });
            expect(named(result.exif, 'ExposureTime').value, order).toEqual({ numerator: 1, denominator: 250 });
            expect(named(result.exif, 'ISOSpeedRatings').value, order).toBe(100);
            expect(named(result.gps, 'GPSLatitudeRef').value, order).toBe('N');
            expect(result.problems, order).toEqual([]);
        }
    });

    it('names every curated tag it is asked about and leaves the rest null', () => {
        const result = read(buildTiff({
            ifd0: [...CAMERA, { tag: 0x9C9B, type: 1, values: Buffer.from([1, 2, 3, 4]) }],
            exif: CAPTURE,
            gps: GREENWICH,
        }));

        const names = (entries) => entries.map((entry) => entry.name);

        expect(names(result.ifd0)).toEqual(expect.arrayContaining([
            'Make', 'Model', 'Orientation', 'XResolution', 'YResolution', 'ResolutionUnit',
            'Software', 'DateTime', 'Artist', 'Copyright', 'ImageDescription',
            'ExifIFDPointer', 'GPSInfoIFDPointer',
        ]));
        expect(names(result.exif)).toEqual(expect.arrayContaining([
            'ExposureTime', 'FNumber', 'ISOSpeedRatings', 'ExifVersion', 'DateTimeOriginal',
            'DateTimeDigitized', 'OffsetTimeOriginal', 'SubSecTimeOriginal', 'MeteringMode',
            'FocalLength', 'FocalLengthIn35mmFilm', 'LensModel',
        ]));
        expect(names(result.gps)).toEqual(expect.arrayContaining([
            'GPSVersionID', 'GPSLatitudeRef', 'GPSLatitude', 'GPSLongitudeRef', 'GPSLongitude',
            'GPSAltitudeRef', 'GPSAltitude', 'GPSTimeStamp', 'GPSDateStamp',
        ]));

        expect(byTag(result.ifd0, 0x9C9B).name).toBe(null);
    });

    it('trims the NUL a TIFF string is stored with', () => {
        const result = read(buildTiff({ ifd0: [{ tag: 0x010F, type: 2, values: 'Resizo' }] }));

        expect(named(result.ifd0, 'Make').value).toBe('Resizo');
        expect(named(result.ifd0, 'Make').truncated).toBe(false);
    });

    it('reports an UNDEFINED value by size and never by content', () => {
        const secret = Buffer.from('SECRET-BINARY-PAYLOAD-NOT-FOR-DISPLAY', 'latin1');
        const result = read(buildTiff({
            ifd0: [{ tag: 0x927C, type: 7, values: secret }],
        }));

        const entry = byTag(result.ifd0, 0x927C);
        expect(entry.value).toEqual({ bytes: secret.length });
        expect(JSON.stringify(entry)).not.toContain('SECRET');
    });

    it('decodes a UserComment behind its eight-byte charset header', () => {
        const ascii = Buffer.concat([
            Buffer.from('ASCII\0\0\0', 'latin1'),
            Buffer.from('Taken on the pier', 'latin1'),
        ]);
        const unicode = Buffer.concat([
            Buffer.from('UNICODE\0', 'latin1'),
            Buffer.from('Pier\0', 'utf16le'),
        ]);
        const opaque = Buffer.concat([
            Buffer.from('\0\0\0\0\0\0\0\0', 'latin1'),
            Buffer.from([1, 2, 3, 4]),
        ]);

        expect(byTag(read(buildTiff({ exif: [{ tag: 0x9286, type: 7, values: ascii }] })).exif, 0x9286).value)
            .toBe('Taken on the pier');
        expect(byTag(read(buildTiff({ exif: [{ tag: 0x9286, type: 7, values: unicode }] })).exif, 0x9286).value)
            .toBe('Pier');
        expect(byTag(read(buildTiff({ exif: [{ tag: 0x9286, type: 7, values: opaque }] })).exif, 0x9286).value)
            .toEqual({ bytes: opaque.length });
    });

    it('keeps a single value scalar and a list an array', () => {
        const result = read(buildTiff({
            ifd0: [
                { tag: 0x0112, type: 3, values: [6] },
                { tag: 0xA432, type: 5, values: [[24, 1], [70, 1], [28, 10], [40, 10]] },
                { tag: 0x0101, type: 4, values: [3024, 4032] },
            ],
        }));

        expect(byTag(result.ifd0, 0x0112).value).toBe(6);
        expect(byTag(result.ifd0, 0x0101).value).toEqual([3024, 4032]);
        expect(byTag(result.ifd0, 0xA432).value).toEqual([
            { numerator: 24, denominator: 1 },
            { numerator: 70, denominator: 1 },
            { numerator: 28, denominator: 10 },
            { numerator: 40, denominator: 10 },
        ]);
    });

    it('counts IFD1 without following it into a second image', () => {
        const result = read(buildTiff({
            ifd0: CAMERA,
            ifd1: [
                { tag: 0x0103, type: 3, values: [6] },
                { tag: 0x0201, type: 4, values: [900] },
                { tag: 0x0202, type: 4, values: [1200] },
            ],
        }));

        expect(result.ifd1).toEqual({ present: true, entries: 3 });
        expect(result.ifd0.some((entry) => entry.tag === 0x0201)).toBe(false);
    });

    it('never follows an interoperability pointer', () => {
        const result = read(buildTiff({
            ifd0: CAMERA,
            exif: [...CAPTURE, { tag: 0xA005, type: 4, values: [8] }],
        }));

        expect(result.interop).toBe(null);
        expect(result.ok).toBe(true);
    });

    it('says so plainly when a block holds no EXIF at all', () => {
        const result = read(buildTiff({ ifd0: [] }));

        expect(result.ok).toBe(true);
        expect(result.ifd0).toEqual([]);
        expect(result.exif).toEqual([]);
        expect(result.gps).toEqual([]);
        expect(result.ifd1).toEqual({ present: false, entries: 0 });
        expect(result.problems).toEqual([]);
    });
});

describe('readExif, malformed input', () => {
    it('refuses a block that is not a TIFF rather than reading rubbish', () => {
        const notTiff = Buffer.from('not a tiff header at all', 'latin1');
        const result = read(notTiff);

        expect(result.ok).toBe(false);
        expect(result.byteOrder).toBe(null);
        expect(result.problems.length).toBeGreaterThan(0);
        expect(result.ifd0).toEqual([]);
    });

    it('survives an IFD0 offset that points past the end of the block', () => {
        const result = read(buildTiff({ ifd0: CAMERA, ifd0Offset: 900000 }));

        expect(result.ok).toBe(false);
        expect(result.ifd0).toEqual([]);
        expect(result.problems.length).toBeGreaterThan(0);
    });

    it('survives an entry count of sixty thousand', () => {
        const result = read(buildTiff({ ifd0: CAMERA, ifd0Count: 60000 }));

        expect(result.ifd0.length).toBeLessThanOrEqual(512);
        expect(result.problems.length).toBeGreaterThan(0);
        expect(named(result.ifd0, 'Make').value).toBe('Resizo');
    });

    it('survives an ASCII value whose offset runs off the end', () => {
        const result = read(buildTiff({
            ifd0: [
                { tag: 0x010F, type: 2, values: 'Resizo' },
                { tag: 0x0131, type: 2, count: 4096, offset: 800000 },
            ],
        }));

        expect(named(result.ifd0, 'Make').value).toBe('Resizo');
        expect(named(result.ifd0, 'Software')).toBe(null);
        expect(result.problems.length).toBeGreaterThan(0);
    });

    /**
     * The bound that matters is the BLOCK'S end, not the file's. A JPEG's Exif
     * sits in an APP1 segment with the picture right behind it, so a value
     * whose offset runs past the segment would otherwise read entropy-coded
     * data — or a second image's coordinates — and print it as a camera model.
     */
    it('refuses a value that runs past the block, even when the file has more bytes', () => {
        const tiff = buildTiff({
            ifd0: [
                { tag: 0x010F, type: 2, values: 'Resizo' },
                { tag: 0x0131, type: 2, count: 200, offset: 20 },
            ],
        });
        const withPicture = Buffer.concat([tiff, Buffer.from('PICTURE-BYTES'.repeat(40), 'latin1')]);
        const bytes = new Uint8Array(withPicture);
        const result = readExif(bytes, { tiffStart: 0, end: tiff.length });

        expect(named(result.ifd0, 'Make').value).toBe('Resizo');
        expect(named(result.ifd0, 'Software')).toBe(null);
        expect(JSON.stringify(result)).not.toContain('PICTURE-BYTES');
        expect(result.problems.length).toBeGreaterThan(0);
    });

    it('survives an Exif pointer that lands outside the block', () => {
        const bytes = new Uint8Array(buildTiff({ ifd0: CAMERA, exif: CAPTURE }));
        const result = readExif(bytes, { tiffStart: 0, end: 40 });

        expect(result.exif.length).toBe(0);
        expect(result.problems.length).toBeGreaterThan(0);
    });

    it('never throws, whatever the bytes are', () => {
        const cases = [
            new Uint8Array(0),
            new Uint8Array([0x49, 0x49]),
            new Uint8Array([0x49, 0x49, 0x2A, 0x00, 0xFF, 0xFF, 0xFF, 0xFF]),
            new Uint8Array(64).fill(0xFF),
            new Uint8Array(buildTiff({ ifd0: CAMERA })).subarray(0, 14),
        ];

        for (const bytes of cases) {
            expect(() => readExif(bytes, { tiffStart: 0, end: bytes.length })).not.toThrow();
        }
        expect(() => readExif(null, { tiffStart: 0, end: 0 })).not.toThrow();
    });

    it('leaves the caller\'s bytes exactly as they were', () => {
        const tiff = buildTiff({ ifd0: CAMERA, exif: CAPTURE, gps: GREENWICH });
        const bytes = new Uint8Array(tiff);
        const copy = Buffer.from(bytes);

        readExif(bytes, { tiffStart: 0, end: bytes.length });

        expect(Buffer.from(bytes).equals(copy)).toBe(true);
    });
});

describe('readExif, caps on untrusted input', () => {
    it('stops at 512 entries in one directory', () => {
        const many = Array.from({ length: 700 }, (unused, index) => ({
            tag: 0xC000 + index, type: 3, values: [index],
        }));
        const result = read(buildTiff({ ifd0: many }));

        expect(result.ifd0.length).toBe(512);
        expect(result.problems.length).toBeGreaterThan(0);
    });

    it('cuts an ASCII value at 4,096 characters and says it did', () => {
        const long = 'x'.repeat(9000);
        const entry = byTag(read(buildTiff({ ifd0: [{ tag: 0x0131, type: 2, values: long }] })).ifd0, 0x0131);

        expect(entry.value.length).toBe(4096);
        expect(entry.truncated).toBe(true);
        expect(entry.count).toBe(9001);
    });

    it('cuts a numeric list at 64 values and a rational list at 16', () => {
        const numbers = Array.from({ length: 200 }, (unused, index) => index);
        const rationals = Array.from({ length: 40 }, (unused, index) => [index, 1]);
        const result = read(buildTiff({
            ifd0: [
                { tag: 0xC100, type: 3, values: numbers },
                { tag: 0xC101, type: 5, values: rationals },
            ],
        }));

        expect(byTag(result.ifd0, 0xC100).value.length).toBe(64);
        expect(byTag(result.ifd0, 0xC100).truncated).toBe(true);
        expect(byTag(result.ifd0, 0xC100).count).toBe(200);
        expect(byTag(result.ifd0, 0xC101).value.length).toBe(16);
        expect(byTag(result.ifd0, 0xC101).truncated).toBe(true);
    });
});

describe('readExif, agreement with the orientation reader', () => {
    async function jpegWithTiff(tiff) {
        const base = await splitRedBlueJpegOriented({ orientation: 1 });
        return spliceJpegSegments(base, [
            { marker: 0xE1, payload: Buffer.concat([EXIF_PREFIX, tiff]) },
        ]);
    }

    it('returns the same Orientation as readExifOrientation, for all eight values', async () => {
        for (let orientation = 1; orientation <= 8; orientation += 1) {
            const source = await jpegWithTiff(buildTiff({
                ifd0: [{ tag: 0x0112, type: 3, values: [orientation] }],
            }));
            const bytes = new Uint8Array(source);
            const block = locateMetadata(bytes).blocks.find((entry) => entry.kind === 'exif');
            const result = readExif(bytes, { tiffStart: block.tiffStart, end: block.end });

            expect(named(result.ifd0, 'Orientation').value, `orientation ${orientation}`)
                .toBe(readExifOrientation(bytes));
        }
    });

    it('agrees with it on a file sharp wrote', async () => {
        const withGps = new Uint8Array(await jpegWithExifAndGps());
        const block = locateMetadata(withGps).blocks.find((entry) => entry.kind === 'exif');
        const result = readExif(withGps, { tiffStart: block.tiffStart, end: block.end });

        expect(named(result.ifd0, 'Orientation').value).toBe(readExifOrientation(withGps));
        expect(result.gps.length).toBeGreaterThan(0);
    });

    /**
     * The one place the two readers deliberately differ. readExifOrientation
     * answers "how far do I turn this" and has to say 1 for a file with no tag,
     * because leaving a photo alone is the safe answer. A report must say
     * NOTHING WAS RECORDED instead, or every untagged photo grows an
     * orientation row it never had.
     */
    it('reports an absent Orientation as absent, where the turner reports 1', async () => {
        const source = await jpegWithTiff(buildTiff({
            ifd0: [{ tag: 0x010F, type: 2, values: 'Resizo' }],
        }));
        const bytes = new Uint8Array(source);
        const block = locateMetadata(bytes).blocks.find((entry) => entry.kind === 'exif');
        const result = readExif(bytes, { tiffStart: block.tiffStart, end: block.end });

        expect(named(result.ifd0, 'Orientation')).toBe(null);
        expect(readExifOrientation(bytes)).toBe(1);
    });

    it('reads a byte-order marker the orientation reader also accepts', async () => {
        const source = await jpegWithTiff(buildTiff({
            order: 'MM',
            ifd0: [{ tag: 0x0112, type: 3, values: [8] }],
        }));
        const bytes = new Uint8Array(source);
        const block = locateMetadata(bytes).blocks.find((entry) => entry.kind === 'exif');

        expect(readExif(bytes, { tiffStart: block.tiffStart, end: block.end }).byteOrder).toBe('MM');
        expect(readExifOrientation(bytes)).toBe(8);
    });
});
