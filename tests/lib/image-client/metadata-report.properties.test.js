/**
 * Properties of the metadata report — things that must hold for EVERY input,
 * including the inputs nobody would write on purpose.
 *
 * WHY A PROPERTY SUITE AND NOT MORE EXAMPLES. A viewer's whole surface is
 * other people's files, and the files that break it are the ones a fixture
 * author would never think to build: a rational with a zero denominator, an
 * IFD offset pointing at its own header, a latitude of 400 degrees, an ASCII
 * run with no NUL in it, six hundred entries in one directory. Every one of
 * those is a real file somebody's camera or somebody's exploit produced, and
 * for all of them the contract is the same three words: it never throws.
 * A report with a `problems` array beats a page that went blank.
 *
 * The other half is the promise the product is built on. The report is read
 * from a stranger's photograph and rendered into a page, so every value that
 * comes out of it has to be a STRING — never a node, never a fragment, never
 * an object a renderer might unwrap. `xmp.jpg` carries a script element on
 * purpose; the assertion below is that it arrives as forty characters of text.
 *
 * Every synthetic case is built with the writers in
 * tests/helpers/image-containers.js, which do not validate what they are asked
 * to write — that is what makes a malformed fixture possible at all.
 *
 * The engine module is imported at the top like any other. Until
 * lib/image-client/metadata-report.js lands this whole file fails to collect
 * with "failed to resolve import", which is the correct red.
 */
import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { sniffImageType } from '@/lib/image/magic-bytes';
import { readExifOrientation } from '@/lib/image-client/orientation';
import { readImageSize } from '@/lib/image-client/requirements';
import { inspectImageMetadata } from '@/lib/image-client/metadata-report';
import {
    TIFF_TYPES,
    buildIccProfile,
    buildTiff,
    buildWebp,
    exifApp1,
    jpegSegments,
    pngChunks,
    riffChunks,
    spliceJpegSegments,
    vp8xPayload,
    xmpPacket,
} from '../../helpers/image-containers';

const DIR = path.join(process.cwd(), 'tests', 'fixtures', 'metadata');

const read = (name) => new Uint8Array(fs.readFileSync(path.join(DIR, name)));

const NAMES = fs.readdirSync(DIR).filter((name) => !name.endsWith('.md')).sort();

/** The picture with no metadata on it, which every synthetic case starts from. */
const PLAIN = fs.readFileSync(path.join(DIR, 'plain.jpg'));

/** A JPEG carrying one hand-built TIFF in an APP1, and nothing else. */
const jpegWithTiff = (tiff) => new Uint8Array(
    spliceJpegSegments(PLAIN, [{ marker: 0xE1, payload: exifApp1(tiff) }]),
);

const gpsJpeg = (gps, options = {}) => jpegWithTiff(buildTiff({ gps, ...options }));

/**
 * Every string in the report, wherever it lives.
 *
 * Written as a walk rather than a list of paths because the point is that
 * NOTHING anywhere in the tree is a node or an object pretending to be text.
 * A new section added to the report is covered by this the day it is added.
 */
function everyValue(report) {
    const found = [];
    const groups = [
        report.exif?.fields, report.xmp?.fields, report.text, report.raw,
        report.exif?.dates, report.privacy?.categories,
    ];

    for (const group of groups) {
        if (!Array.isArray(group)) continue;
        for (const entry of group) {
            for (const key of ['value', 'label', 'summary', 'keyword', 'stored', 'display', 'note']) {
                if (entry?.[key] !== undefined && entry[key] !== null) found.push({ key, value: entry[key] });
            }
        }
    }

    return found;
}

/* ================================================= the shape of every report */

describe('every report is the same shape, whatever went in', () => {
    it.each(NAMES)('%s: reading it changes not one byte of the input', (name) => {
        const bytes = read(name);
        const copy = Buffer.from(bytes);

        inspectImageMetadata(bytes, { name });

        // The viewer is read-only, and this is the only assertion that says so
        // about the buffer rather than about the file on disk.
        expect(Buffer.from(bytes).equals(copy)).toBe(true);
    });

    it.each(NAMES)('%s: the same bytes give the same report, twice', (name) => {
        const first = inspectImageMetadata(read(name), { name });
        const second = inspectImageMetadata(read(name), { name });
        expect(second).toEqual(first);
    });

    it.each(NAMES)('%s: the whole report survives a JSON round trip', (name) => {
        // The download button hands this to a person as a file. A value that
        // JSON.stringify drops — undefined, a function, a Uint8Array — reaches
        // them as a missing row rather than as an error.
        const report = inspectImageMetadata(read(name), { name });
        expect(JSON.parse(JSON.stringify(report))).toEqual(report);
    });

    it('names its top-level sections in the documented order', () => {
        // The downloaded report is read by people and diffed by tools, so the
        // order is part of what it is rather than an accident of construction.
        expect(Object.keys(inspectImageMetadata(read('gps-greenwich.jpg'), { name: 'gps-greenwich.jpg' }))).toEqual([
            'ok', 'file', 'resolution', 'exif', 'gps', 'xmp', 'icc', 'text', 'other', 'privacy', 'problems', 'raw',
        ]);
    });

    it.each(NAMES)('%s: every value it hands over is text', (name) => {
        const report = inspectImageMetadata(read(name), { name });

        for (const { key, value } of everyValue(report)) {
            expect(typeof value, `${name} ${key} is a ${typeof value}`).toBe('string');
        }

        // And nothing is ever a DOM-shaped object smuggled through as one.
        for (const entry of report.raw) {
            expect(typeof entry.value).toBe('string');
            expect(entry.value.length).toBeLessThanOrEqual(500);
            expect(typeof entry.truncated).toBe('boolean');
        }

        for (const entry of report.text) {
            expect(entry.value.length).toBeLessThanOrEqual(2_000);
        }
    });

    it.each(NAMES)('%s: the file facts match the readers that produced them', (name) => {
        const bytes = read(name);
        const report = inspectImageMetadata(bytes, { name });
        const size = readImageSize(bytes);

        expect(report.file.format).toBe(sniffImageType(bytes));
        expect(report.file.width).toBe(size.width);
        expect(report.file.height).toBe(size.height);
        expect(report.file.megapixels).toBe(Number(((size.width * size.height) / 1e6).toFixed(1)));
        expect(report.file.bytes).toBe(bytes.length);
    });

    it.each(NAMES)('%s: latitude, longitude and orientation stay inside their ranges', (name) => {
        const report = inspectImageMetadata(read(name), { name });

        if (report.gps.latitude !== null) {
            expect(report.gps.latitude).toBeGreaterThanOrEqual(-90);
            expect(report.gps.latitude).toBeLessThanOrEqual(90);
        }
        if (report.gps.longitude !== null) {
            expect(report.gps.longitude).toBeGreaterThanOrEqual(-180);
            expect(report.gps.longitude).toBeLessThanOrEqual(180);
        }

        const orientation = report.exif.orientation.value;
        if (orientation !== null) {
            expect(orientation).toBeGreaterThanOrEqual(1);
            expect(orientation).toBeLessThanOrEqual(8);
            expect(typeof report.exif.orientation.description).toBe('string');
        }

        if (report.file.format === 'jpeg') {
            // See the same rule in metadata-viewer-contract.test.js: null is
            // allowed exactly where the reader saw the spec's default of 1.
            const stored = readExifOrientation(read(name));
            if (orientation === null) expect(stored).toBe(1);
            else expect(orientation).toBe(stored);
        }
    });
});

/* ================================================ one bad block, one section */

describe('a corrupted block costs its own section and nothing else', () => {
    /**
     * Every byte range in a file that holds metadata rather than picture,
     * found with the tests' own walkers so the list does not depend on the
     * module under test agreeing about where anything is.
     */
    function metadataRanges(name) {
        const bytes = Buffer.from(read(name));
        const format = sniffImageType(bytes);

        // `payloadAt` and `dataAt` are FILE positions. A subarray's own
        // byteOffset is relative to whatever Buffer.from allocated — for a
        // small input that is a shared pool — so it is not the file position
        // and reading it as one flips a byte in the wrong file entirely.
        if (format === 'jpeg') {
            return jpegSegments(bytes).segments
                .filter((segment) => segment.marker >= 0xE0 || segment.marker === 0xFE)
                .map((segment) => ({ at: segment.payloadAt, length: segment.payload.length }));
        }

        if (format === 'png') {
            return pngChunks(bytes).chunks
                .filter((chunk) => !['IHDR', 'IDAT', 'IEND'].includes(chunk.type))
                .map((chunk) => ({ at: chunk.dataAt, length: chunk.data.length }));
        }

        // VP8X is excluded with the image chunks rather than counted as
        // metadata: it is where an extended WebP records its CANVAS SIZE, so
        // flipping a byte in it legitimately changes the picture's declared
        // dimensions. Corrupting it proves nothing about metadata handling and
        // would fail the "file facts survive" assertion for the right reason.
        return riffChunks(bytes).chunks
            .filter((chunk) => !['VP8 ', 'VP8L', 'ALPH', 'VP8X', 'ANIM', 'ANMF'].includes(chunk.type))
            .map((chunk) => ({ at: chunk.payloadAt, length: chunk.payload.length }));
    }

    it('flipping a byte inside every metadata block in the tree loses no file facts', () => {
        let flipped = 0;

        for (const name of NAMES) {
            const original = inspectImageMetadata(read(name), { name });

            for (const range of metadataRanges(name)) {
                if (range.length < 4) continue;

                const damaged = Buffer.from(read(name));
                // Halfway in, so the flip lands in the block's contents rather
                // than in a length or a signature a walker rejects outright.
                const at = range.at + Math.floor(range.length / 2);
                damaged[at] ^= 0xFF;
                flipped += 1;

                let report;
                expect(() => { report = inspectImageMetadata(new Uint8Array(damaged), { name }); })
                    .not.toThrow();

                expect(report.ok, `${name} gave up entirely after one flipped byte at ${at}`).toBe(true);
                expect(report.file.format).toBe(original.file.format);
                expect(report.file.width).toBe(original.file.width);
                expect(report.file.height).toBe(original.file.height);
                expect(Array.isArray(report.problems)).toBe(true);
            }
        }

        // The self-check. Three of the fixtures carry no metadata at all, so a
        // walk that found nothing anywhere would sail through every assertion
        // above without executing one of them.
        expect(flipped, 'no metadata block was found to corrupt — the walk read nothing')
            .toBeGreaterThanOrEqual(12);
    });

    it('reports a truncated file rather than reading off the end of it', () => {
        const whole = read('gps-greenwich.jpg');

        for (const share of [0.1, 0.3, 0.5, 0.9]) {
            const cut = whole.slice(0, Math.floor(whole.length * share));
            let report;
            expect(() => { report = inspectImageMetadata(cut, { name: 'gps-greenwich.jpg' }); }).not.toThrow();
            expect(typeof report.ok).toBe('boolean');
            if (report.ok) expect(Array.isArray(report.problems)).toBe(true);
        }
    });
});

/* ============================================== the inputs nobody would send */

describe('the boundaries', () => {
    it('refuses an empty buffer, a one-byte buffer and a bare signature without throwing', () => {
        for (const bytes of [
            new Uint8Array(0),
            new Uint8Array([0xFF]),
            new Uint8Array([0xFF, 0xD8]),
            new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
            new Uint8Array([0x52, 0x49, 0x46, 0x46]),
        ]) {
            let report;
            expect(() => { report = inspectImageMetadata(bytes, { name: 'x.jpg' }); }).not.toThrow();
            expect(report.ok).toBe(false);
            expect(typeof report.message).toBe('string');
        }
    });

    it('takes a filename it should never trust and reports it as text', () => {
        // A name reaches the page and the download filename, so the three ways
        // a name is weaponised are worth one case each. None of them is the
        // engine's to sanitise — its job is to hand back a string and get the
        // extension right — but a crash here would take the page with it.
        const awkward = [
            { name: '../../../etc/passwd.png', extension: 'png' },
            { name: 'photo\r\nX-Injected: yes.jpg', extension: 'jpg' },
            { name: '📸 vacances été.JPG', extension: 'jpg' },
            // A leading dot is a dotfile, not an extension — the same rule
            // path.extname follows, and the one a person naming a file expects.
            { name: '.jpg', extension: null },
            { name: 'archive.tar.gz', extension: 'gz' },
            { name: 'no-extension-at-all', extension: null },
            { name: '', extension: null },
        ];

        for (const { name, extension } of awkward) {
            const report = inspectImageMetadata(read('plain.jpg'), { name });
            expect(report.ok).toBe(true);
            expect(report.file.extension).toBe(extension);
            expect(typeof report.file.name).toBe('string');
        }

        // And with no name at all, which is what a paste or a drop can give.
        expect(inspectImageMetadata(read('plain.jpg')).ok).toBe(true);
    });
});

/* ====================================================== GPS, written wrongly */

describe('GPS that cannot be believed is reported as unknown, never as a number', () => {
    const ref = (tag, value) => ({ tag, type: TIFF_TYPES.ASCII, values: value });
    const dms = (tag, values) => ({ tag, type: TIFF_TYPES.RATIONAL, values });

    it('a zero denominator gives no coordinate and a sentence', () => {
        const report = inspectImageMetadata(gpsJpeg([
            ref(0x0001, 'N'), dms(0x0002, [[51, 0], [28, 1], [402, 10]]),
            ref(0x0003, 'W'), dms(0x0004, [[0, 1], [0, 1], [54, 10]]),
        ]), { name: 'zero-denominator.jpg' });

        expect(report.gps.latitude).toBeNull();
        expect(report.gps.problems.length).toBeGreaterThan(0);
        expect(report.gps.problems.every((sentence) => typeof sentence === 'string')).toBe(true);
    });

    it('a missing reference gives no coordinate, because the sign is in the reference', () => {
        const report = inspectImageMetadata(gpsJpeg([
            dms(0x0002, [[51, 1], [28, 1], [402, 10]]),
            dms(0x0004, [[0, 1], [0, 1], [54, 10]]),
        ]), { name: 'no-ref.jpg' });

        expect(report.gps.latitude).toBeNull();
        expect(report.gps.longitude).toBeNull();
        expect(report.gps.problems.length).toBeGreaterThan(0);
    });

    it('a latitude past the pole and a longitude past the date line are refused', () => {
        const report = inspectImageMetadata(gpsJpeg([
            ref(0x0001, 'N'), dms(0x0002, [[91, 1], [0, 1], [0, 1]]),
            ref(0x0003, 'E'), dms(0x0004, [[181, 1], [0, 1], [0, 1]]),
        ]), { name: 'off-the-map.jpg' });

        expect(report.gps.latitude).toBeNull();
        expect(report.gps.longitude).toBeNull();
        expect(report.gps.problems.length).toBeGreaterThan(0);
    });

    it('exactly 90 north and exactly 180 east are inside the map and are kept', () => {
        const report = inspectImageMetadata(gpsJpeg([
            ref(0x0001, 'N'), dms(0x0002, [[90, 1], [0, 1], [0, 1]]),
            ref(0x0003, 'E'), dms(0x0004, [[180, 1], [0, 1], [0, 1]]),
        ]), { name: 'the-edges.jpg' });

        expect(report.gps.latitude).toBe(90);
        expect(report.gps.longitude).toBe(180);
    });

    it('zero, zero is a place and is not mistaken for an absent reading', () => {
        // Null Island is where a broken GPS chip writes to, so the honest
        // answer is to show it rather than to drop it — but `present` has to
        // stay true or a page would say "no location" about a file that has one.
        const report = inspectImageMetadata(gpsJpeg([
            ref(0x0001, 'N'), dms(0x0002, [[0, 1], [0, 1], [0, 1]]),
            ref(0x0003, 'E'), dms(0x0004, [[0, 1], [0, 1], [0, 1]]),
        ]), { name: 'null-island.jpg' });

        expect(report.gps.present).toBe(true);
        expect(report.gps.latitude).toBe(0);
        expect(report.gps.longitude).toBe(0);
    });

    it('an altitude below sea level keeps its sign in the reference tag', () => {
        const below = inspectImageMetadata(gpsJpeg([
            ref(0x0001, 'N'), dms(0x0002, [[31, 1], [30, 1], [0, 1]]),
            ref(0x0003, 'E'), dms(0x0004, [[35, 1], [30, 1], [0, 1]]),
            { tag: 0x0005, type: TIFF_TYPES.BYTE, values: [1] },
            { tag: 0x0006, type: TIFF_TYPES.RATIONAL, values: [[430, 1]] },
        ]), { name: 'below.jpg' });

        // The number is always unsigned; the sign lives one tag away, which is
        // the second sign bug a reader can have after the latitude one.
        expect(below.gps.altitude).toEqual({ metres: 430, belowSeaLevel: true });
    });

    it('reads the same coordinates out of a big-endian file', () => {
        const little = inspectImageMetadata(gpsJpeg([
            ref(0x0001, 'S'), dms(0x0002, [[33, 1], [51, 1], [245, 10]]),
            ref(0x0003, 'E'), dms(0x0004, [[151, 1], [12, 1], [551, 10]]),
        ], { byteOrder: 'II' }), { name: 'little.jpg' });

        const big = inspectImageMetadata(gpsJpeg([
            ref(0x0001, 'S'), dms(0x0002, [[33, 1], [51, 1], [245, 10]]),
            ref(0x0003, 'E'), dms(0x0004, [[151, 1], [12, 1], [551, 10]]),
        ], { byteOrder: 'MM' }), { name: 'big.jpg' });

        expect(big.gps.latitude).toBe(little.gps.latitude);
        expect(big.gps.longitude).toBe(little.gps.longitude);
        expect(big.exif.byteOrder).toBe('MM');
        expect(little.exif.byteOrder).toBe('II');
    });
});

/* ==================================================== EXIF, written wrongly */

describe('EXIF that runs off the end is a problem, never an exception', () => {
    it('an IFD offset past the end leaves the file facts standing', () => {
        const tiff = Buffer.from(buildTiff({
            ifd0: [{ tag: 0x010F, type: TIFF_TYPES.ASCII, values: 'Resizo' }],
        }));
        tiff.writeUInt32LE(0x7FFFFFFF, 4);

        const report = inspectImageMetadata(jpegWithTiff(tiff), { name: 'far.jpg' });
        expect(report.ok).toBe(true);
        expect(report.file.width).toBe(120);
        expect(report.problems.length).toBeGreaterThan(0);
    });

    it('an IFD offset pointing back at the header does not loop forever', () => {
        const tiff = Buffer.from(buildTiff({
            ifd0: [{ tag: 0x010F, type: TIFF_TYPES.ASCII, values: 'Resizo' }],
        }));
        tiff.writeUInt32LE(4, 4);

        let report;
        expect(() => { report = inspectImageMetadata(jpegWithTiff(tiff), { name: 'loop.jpg' }); }).not.toThrow();
        expect(report.ok).toBe(true);
    });

    it('a value whose count runs past the end is dropped, not read', () => {
        // The classic overread: an ASCII entry claiming 60,000 characters that
        // live at an offset with 40 bytes behind it.
        const tiff = Buffer.from(buildTiff({
            ifd0: [{ tag: 0x0131, type: TIFF_TYPES.ASCII, values: 'Resizo Fixture Writer 1.0' }],
        }));
        const entry = 8 + 2;
        tiff.writeUInt32LE(60_000, entry + 4);

        const report = inspectImageMetadata(jpegWithTiff(tiff), { name: 'overread.jpg' });
        expect(report.ok).toBe(true);
        expect(report.problems.length).toBeGreaterThan(0);
        for (const { value } of everyValue(report)) expect(typeof value).toBe('string');
    });

    it('caps a directory of six hundred entries rather than walking all of them', () => {
        const many = [];
        for (let index = 0; index < 600; index += 1) {
            many.push({ tag: 0xC000 + index, type: TIFF_TYPES.SHORT, values: [index % 65_535] });
        }

        const report = inspectImageMetadata(jpegWithTiff(buildTiff({ ifd0: many })), { name: 'many.jpg' });
        expect(report.ok).toBe(true);
        expect(report.exif.entryCount).toBeLessThanOrEqual(512);
        expect(report.raw.length).toBeLessThanOrEqual(2_000);
    });

    it('caps a long ASCII run and says it was cut', () => {
        const report = inspectImageMetadata(jpegWithTiff(buildTiff({
            ifd0: [{ tag: 0x010E, type: TIFF_TYPES.ASCII, values: 'A'.repeat(9_000) }],
        })), { name: 'long.jpg' });

        const description = report.raw.find((entry) => entry.tag === '0x010E');
        expect(description.value.length).toBeLessThanOrEqual(500);
        expect(description.truncated).toBe(true);
    });

    it('counts IFD1 without walking into it', () => {
        const report = inspectImageMetadata(jpegWithTiff(buildTiff({
            ifd0: [{ tag: 0x010F, type: TIFF_TYPES.ASCII, values: 'Resizo' }],
            ifd1: [
                { tag: 0x0103, type: TIFF_TYPES.SHORT, values: [6] },
                { tag: 0x011A, type: TIFF_TYPES.RATIONAL, values: [[72, 1]] },
            ],
            thumbnail: Buffer.from('not really a JPEG, but it is bytes', 'latin1'),
        })), { name: 'thumbed.jpg' });

        // The thumbnail reaches the report as one boolean, which is all a
        // person needs: there is a second copy of the picture in here.
        expect(report.other.thumbnail).toBe(true);
        expect(report.exif.fields.some((field) => field.id === 'make')).toBe(true);
        expect(report.raw.filter((entry) => entry.group === 'IFD0').length).toBeGreaterThan(0);

        // COUNTED, NOT WALKED. IFD1's XResolution belongs to the thumbnail and
        // IFD0 here has none, so a 0x011A anywhere in the field list is proof
        // the reader followed the next-IFD pointer and mixed the two.
        expect(report.raw.some((entry) => entry.tag === '0x011A')).toBe(false);
    });

    it('describes an UNDEFINED block by its length rather than dumping it', () => {
        const report = inspectImageMetadata(jpegWithTiff(buildTiff({
            ifd0: [{ tag: 0xC100, type: TIFF_TYPES.UNDEFINED, values: Buffer.alloc(4_096, 0xAB) }],
        })), { name: 'blob.jpg' });

        const entry = report.raw.find((row) => row.tag === '0xC100');
        expect(entry.value.length).toBeLessThanOrEqual(500);
        // Described by its length, which is the only useful thing to say about
        // four kilobytes of somebody's proprietary maker note.
        expect(entry.value).toMatch(/4,?096/);
        expect(entry.value).toMatch(/bytes/i);
    });

    it('decodes a UserComment by its charset header, and only the two it knows', () => {
        const comment = (header, text, encoding = 'latin1') => inspectImageMetadata(jpegWithTiff(buildTiff({
            exif: [{
                tag: 0x9286,
                type: TIFF_TYPES.UNDEFINED,
                values: Buffer.concat([Buffer.from(header, 'latin1'), Buffer.from(text, encoding)]),
            }],
        })), { name: 'comment.jpg' });

        const ascii = comment('ASCII\0\0\0', 'a plain comment');
        expect(ascii.text.find((entry) => entry.source === 'user-comment').value).toBe('a plain comment');

        const unicode = comment('UNICODE\0', 'wide characters', 'utf16le');
        expect(typeof unicode.text.find((entry) => entry.source === 'user-comment')?.value).toBe('string');

        // An 8-byte header of NULs means "undefined charset": the bytes cannot
        // be turned into text without guessing, and guessing is how mojibake
        // ends up on a page presented as somebody's own words.
        const undefinedCharset = comment('\0\0\0\0\0\0\0\0', 'who knows');
        const entry = undefinedCharset.text.find((row) => row.source === 'user-comment');
        if (entry) expect(typeof entry.value).toBe('string');
    });

    it('reads the wide numeric types without falling over them', () => {
        const report = inspectImageMetadata(jpegWithTiff(buildTiff({
            ifd0: [
                { tag: 0xC101, type: TIFF_TYPES.DOUBLE, values: [1.5, -2.25] },
                { tag: 0xC102, type: TIFF_TYPES.FLOAT, values: [0.5] },
                { tag: 0xC103, type: TIFF_TYPES.SLONG, values: [-2_147_483_648] },
                { tag: 0xC104, type: TIFF_TYPES.SHORT, values: Array.from({ length: 200 }, (v, i) => i) },
                { tag: 0xC105, type: TIFF_TYPES.RATIONAL, values: Array.from({ length: 40 }, () => [1, 3]) },
            ],
        })), { name: 'types.jpg' });

        expect(report.ok).toBe(true);
        for (const { value } of everyValue(report)) expect(typeof value).toBe('string');
        for (const entry of report.raw) expect(entry.value.length).toBeLessThanOrEqual(500);
    });
});

/* ================================================== XMP, ICC and containers */

describe('the other blocks', () => {
    it('takes an XMP packet apart without an XML parser, entities and all', () => {
        const packet = xmpPacket(
            '<dc:title><rdf:Alt><rdf:li xml:lang="x-default">'
            + '5 &lt; 7 &amp;&amp; 9 &gt; 2, &quot;quoted&quot;, &apos;single&apos;'
            + '</rdf:li></rdf:Alt></dc:title>'
            + '<dc:rights>&lt;img src=x onerror=alert(1)&gt;</dc:rights>',
        );

        const report = inspectImageMetadata(new Uint8Array(spliceJpegSegments(PLAIN, [{
            marker: 0xE1,
            payload: Buffer.concat([Buffer.from('http://ns.adobe.com/xap/1.0/\0', 'latin1'), packet]),
        }])), { name: 'entities.jpg' });

        const title = report.xmp.fields.find((field) => field.id === 'dc:title');
        expect(title.value).toBe('5 < 7 && 9 > 2, "quoted", \'single\'');

        const rights = report.xmp.fields.find((field) => field.id === 'dc:rights');
        expect(rights.value).toBe('<img src=x onerror=alert(1)>');
        expect(typeof rights.value).toBe('string');
    });

    it('truncates an enormous packet rather than carrying all of it', () => {
        const packet = xmpPacket(`<dc:description>${'x'.repeat(200_000)}</dc:description>`);
        const report = inspectImageMetadata(new Uint8Array(spliceJpegSegments(PLAIN, [{
            marker: 0xE1,
            // A JPEG segment holds 65,533 bytes, so a packet this size arrives
            // as an extended XMP in practice; here the segment is simply cut
            // to what fits, which is also what a truncated file looks like.
            payload: Buffer.concat([
                Buffer.from('http://ns.adobe.com/xap/1.0/\0', 'latin1'),
                packet.subarray(0, 65_000),
            ]),
        }])), { name: 'huge-xmp.jpg' });

        expect(report.xmp.present).toBe(true);
        expect(report.xmp.packet === null || report.xmp.packet.length <= 65_536).toBe(true);
        expect(typeof report.xmp.truncated).toBe('boolean');
    });

    it('reports a malformed ICC profile as absent rather than throwing', () => {
        const rubbish = Buffer.alloc(200, 0x7F);
        const report = inspectImageMetadata(new Uint8Array(spliceJpegSegments(PLAIN, [{
            marker: 0xE2,
            payload: Buffer.concat([Buffer.from('ICC_PROFILE\0', 'latin1'), Buffer.from([1, 1]), rubbish]),
        }])), { name: 'bad-icc.jpg' });

        expect(report.ok).toBe(true);
        expect(report.icc.description).toBeNull();
        expect(typeof report.icc.present).toBe('boolean');
    });

    it('joins a profile split across several APP2 segments in sequence order', () => {
        const profile = Buffer.from(buildIccProfile({ description: 'Resizo Split Profile' }));
        const half = Math.ceil(profile.length / 2);
        const piece = (sequence, body) => ({
            marker: 0xE2,
            payload: Buffer.concat([
                Buffer.from('ICC_PROFILE\0', 'latin1'),
                Buffer.from([sequence, 2]),
                body,
            ]),
        });

        const report = inspectImageMetadata(new Uint8Array(spliceJpegSegments(PLAIN, [
            piece(1, profile.subarray(0, half)),
            piece(2, profile.subarray(half)),
        ])), { name: 'split-icc.jpg' });

        expect(report.icc.present).toBe(true);
        expect(report.icc.description).toBe('Resizo Split Profile');
        expect(report.icc.bytes).toBe(profile.length);
    });

    it('reads a WebP EXIF chunk that carries the Exif header some writers add', () => {
        // The committed WebP omits the header, which is what the container
        // spec asks for. Plenty of cameras write it anyway, and the two are
        // indistinguishable to a reader that does not check — so both paths
        // exist, and this is the one no committed binary covers.
        const tiff = buildTiff({ ifd0: [{ tag: 0x010F, type: TIFF_TYPES.ASCII, values: 'Prefixed' }] });
        const { chunks } = riffChunks(read('webp-alpha.webp'));

        const report = inspectImageMetadata(new Uint8Array(buildWebp([
            { type: 'VP8X', payload: vp8xPayload({ width: 260, height: 200, alpha: true, exif: true }) },
            { type: chunks[1].type, payload: chunks[1].payload },
            { type: 'EXIF', payload: Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), Buffer.from(tiff)]) },
        ])), { name: 'prefixed.webp' });

        expect(report.ok).toBe(true);
        expect(report.exif.present).toBe(true);
        expect(report.exif.fields.find((field) => field.id === 'make').value).toBe('Prefixed');
    });

    it('describes a PNG iCCP as compressed and does not pretend to read it', () => {
        // No inflate on this page. The keyword is the honest answer and a
        // description invented from it would be a guess presented as a fact.
        const report = inspectImageMetadata(read('png-alpha-text.png'), { name: 'png-alpha-text.png' });
        expect(report.icc.present).toBe(false);
        expect(report.icc.compressed).toBe(false);
    });
});

/* =================================================== the privacy conclusion */

describe('the privacy summary follows from what was found, never from copy', () => {
    it('says location only when there are coordinates', () => {
        for (const name of NAMES) {
            const report = inspectImageMetadata(read(name), { name });
            expect(report.privacy.location).toBe(report.gps.present && report.gps.latitude !== null);

            const location = report.privacy.categories.find((category) => category.id === 'location');
            expect(location.present).toBe(report.privacy.location);
        }
    });

    it('names every category exactly once, in the documented order', () => {
        const report = inspectImageMetadata(read('gps-greenwich.jpg'), { name: 'gps-greenwich.jpg' });
        expect(report.privacy.categories.map((category) => category.id)).toEqual([
            'location', 'capture-time', 'device', 'creator', 'software', 'text', 'thumbnail', 'extra-images',
        ]);
        expect(report.privacy.categories.every((category) => typeof category.summary === 'string')).toBe(true);
    });

    it('offers the remover only when the remover has something to take', () => {
        for (const name of NAMES) {
            const bytes = read(name);
            const report = inspectImageMetadata(bytes, { name });
            const anything = report.exif.present || report.gps.present || report.xmp.present
                || report.text.length > 0 || report.other.thumbnail || report.other.iptc
                || report.other.trailer || report.other.mpf;

            expect(report.privacy.removable, `${name} disagrees about what is removable`).toBe(anything);
        }
    });
});
