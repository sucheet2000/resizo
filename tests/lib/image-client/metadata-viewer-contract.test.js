/**
 * The metadata viewer, held to two contracts at once.
 *
 * ONE — THE FIXTURES SAY WHAT THEY CLAIM TO SAY. tests/fixtures/metadata/ is
 * the only place in this repository where a binary is committed rather than
 * generated at run time, and the deal that buys it that exception is this
 * file: every one of those files is re-opened here on every run and read back
 * with the independent walkers in tests/helpers/image-containers.js — the
 * exact rationals, the exact packet, the exact profile, the exact chunk order
 * — and with sharp, which is a second, unrelated libvips opinion about the
 * same bytes. A fixture that drifted fails here, before anything downstream
 * can quietly trust it.
 *
 * TWO — THE VIEWER AND THE REMOVER TELL THE SAME STORY. These are the two
 * halves of one promise a visitor makes decisions on: "this photo has your
 * coordinates in it" and "they are gone now". Nothing else in the suite reads
 * them together, so nothing else would catch the failure that matters most —
 * a viewer that says a block was removed because a page told it so rather than
 * because the bytes changed. Every case here strips the file and INSPECTS THE
 * RESULT, and then searches the stripped bytes for the coordinates directly,
 * so a report that lied is caught by something that is not a report.
 *
 * The engine module is imported at the top like any other. Until
 * lib/image-client/metadata-report.js lands this whole file fails to collect
 * with "failed to resolve import", which is the correct red: there is no
 * partial credit for a viewer that does not exist.
 */
import fs from 'node:fs';
import path from 'node:path';

import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import { sniffImageType } from '@/lib/image/magic-bytes';
import { readResolution } from '@/lib/image-client/dpi';
import { inspectMetadata, stripMetadata } from '@/lib/image-client/metadata-strip';
import { readExifOrientation } from '@/lib/image-client/orientation';
import { readImageSize } from '@/lib/image-client/requirements';
import { inspectImageMetadata } from '@/lib/image-client/metadata-report';
import {
    dmsDecimal,
    dmsRationals,
    jpegSegments,
    pngChunks,
    readIccTags,
    readTiff,
    riffChunks,
    textKeyword,
} from '../../helpers/image-containers';

const DIR = path.join(process.cwd(), 'tests', 'fixtures', 'metadata');
const SAMPLE = path.join(process.cwd(), 'public', 'samples', 'metadata-sample.jpg');

const read = (name) => new Uint8Array(fs.readFileSync(path.join(DIR, name)));

/** Every file the generator writes, and the identity each one is meant to have. */
const FIXTURES = [
    { name: 'plain.jpg', format: 'jpeg', width: 120, height: 80, alpha: false },
    { name: 'exif-camera.jpg', format: 'jpeg', width: 800, height: 600, alpha: false },
    { name: 'gps-greenwich.jpg', format: 'jpeg', width: 480, height: 360, alpha: false },
    { name: 'gps-sydney.jpg', format: 'jpeg', width: 200, height: 150, alpha: false },
    { name: 'dpi-300.jpg', format: 'jpeg', width: 300, height: 200, alpha: false },
    { name: 'icc-srgb.jpg', format: 'jpeg', width: 140, height: 100, alpha: false },
    { name: 'xmp.jpg', format: 'jpeg', width: 180, height: 120, alpha: false },
    { name: 'malformed-exif.jpg', format: 'jpeg', width: 120, height: 90, alpha: false },
    { name: 'huge-comment.jpg', format: 'jpeg', width: 130, height: 90, alpha: false },
    { name: 'png-phys.png', format: 'png', width: 220, height: 160, alpha: false },
    { name: 'png-alpha-text.png', format: 'png', width: 240, height: 180, alpha: true },
    // The one whose name disagrees with its bytes, which is the whole point.
    { name: 'png-as-jpg.jpg', format: 'png', width: 100, height: 100, alpha: false },
    { name: 'webp-alpha.webp', format: 'webp', width: 260, height: 200, alpha: true },
    { name: 'webp-exif-xmp.webp', format: 'webp', width: 280, height: 210, alpha: false },
];

/** The two landmarks, and the decimals their stored rationals work out to. */
const GREENWICH = {
    latitude: dmsRationals({ degrees: 51, minutes: 28, seconds: 40.2 }),
    latitudeRef: 'N',
    longitude: dmsRationals({ degrees: 0, minutes: 0, seconds: 5.4 }),
    longitudeRef: 'W',
};

const SYDNEY = {
    latitude: dmsRationals({ degrees: 33, minutes: 51, seconds: 24.5 }),
    latitudeRef: 'S',
    longitude: dmsRationals({ degrees: 151, minutes: 12, seconds: 55.1 }),
    longitudeRef: 'E',
};

/** The Exif APP1 of a JPEG, as a TIFF with the 'Exif\0\0' header taken off. */
function exifTiffOf(bytes) {
    const app1 = jpegSegments(bytes).segments.find(
        (segment) => segment.marker === 0xE1 && segment.payload.subarray(0, 6).toString('latin1') === 'Exif\0\0',
    );
    return app1 ? readTiff(app1.payload.subarray(6)) : null;
}

const six = (value) => Number(value.toFixed(6));

/* ============================================== one: the fixtures themselves */

describe('the committed fixtures are what the generator says they are', () => {
    it.each(FIXTURES)('$name is a $format of $width x $height', async (fixture) => {
        const bytes = read(fixture.name);

        // The magic bytes, not the extension. png-as-jpg.jpg is in this list
        // precisely so that distinction has a case where it matters.
        expect(sniffImageType(bytes)).toBe(fixture.format);
        expect(readImageSize(bytes)).toEqual({
            width: fixture.width,
            height: fixture.height,
            hasAlpha: fixture.alpha,
        });

        // sharp is the second opinion: a different library reading the same
        // container and reaching the same two numbers.
        const meta = await sharp(Buffer.from(bytes)).metadata();
        expect(meta.width).toBe(fixture.width);
        expect(meta.height).toBe(fixture.height);
    });

    it('plain.jpg carries no metadata segment at all', () => {
        const { segments } = jpegSegments(read('plain.jpg'));
        const carriers = segments.filter((segment) => segment.marker >= 0xE0 || segment.marker === 0xFE);
        expect(carriers).toEqual([]);
        expect(inspectMetadata(read('plain.jpg')).found).toEqual([]);
    });

    it('exif-camera.jpg holds the camera block, and lies about its own size', async () => {
        const tiff = exifTiffOf(read('exif-camera.jpg'));

        expect(tiff.byteOrder).toBe('II');
        expect(tiff.ifd0[0x010F].values).toBe('Resizo');
        expect(tiff.ifd0[0x0110].values).toBe('Fixture Camera');
        expect(tiff.ifd0[0x0112].values).toEqual([6]);
        expect(tiff.ifd0[0x011A].values).toEqual([[300, 1]]);
        expect(tiff.ifd0[0x0128].values).toEqual([2]);
        expect(tiff.ifd0[0x0131].values).toBe('Resizo Fixture Writer 1.0');
        expect(tiff.ifd0[0x013B].values).toBe('Resizo Test Suite');
        expect(tiff.ifd0[0x8298].values).toBe('Public domain, generated for tests');

        expect(tiff.exif[0x829A].values).toEqual([[1, 250]]);
        expect(tiff.exif[0x829D].values).toEqual([[18, 10]]);
        expect(tiff.exif[0x8827].values).toEqual([100]);
        expect(tiff.exif[0x9003].values).toBe('2024:05:01 14:03:22');
        expect(tiff.exif[0x9011].values).toBe('+01:00');
        expect(tiff.exif[0x920A].values).toEqual([[26, 1]]);
        expect(tiff.exif[0xA434].values).toBe('Fixture 26mm f/1.8');

        // Negative, and stored as an SRATIONAL. A reader that took every
        // rational as unsigned reports 4,294,967,295 over 3 for this one.
        expect(tiff.exif[0x9204].values).toEqual([[-1, 3]]);

        // The trap: 4032 x 3024 written on a file that is 800 x 600.
        expect(tiff.exif[0xA002].values).toEqual([4032]);
        expect(tiff.exif[0xA003].values).toEqual([3024]);

        // The UserComment's 8-byte charset header, then the text.
        expect(tiff.exif[0x9286].values.subarray(0, 8).toString('latin1')).toBe('ASCII\0\0\0');
        expect(tiff.exif[0x9286].values.subarray(8).toString('latin1')).toBe('Fixture user comment');

        expect((await sharp(Buffer.from(read('exif-camera.jpg'))).metadata()).orientation).toBe(6);
    });

    it('gps-greenwich.jpg holds the coordinates of the observatory and a real thumbnail', async () => {
        const tiff = exifTiffOf(read('gps-greenwich.jpg'));

        expect(tiff.gps[0x0000].values).toEqual([2, 3, 0, 0]);
        expect(tiff.gps[0x0001].values).toBe('N');
        expect(tiff.gps[0x0002].values).toEqual([[51, 1], [28, 1], [402, 10]]);
        expect(tiff.gps[0x0003].values).toBe('W');
        expect(tiff.gps[0x0004].values).toEqual([[0, 1], [0, 1], [54, 10]]);
        expect(tiff.gps[0x0005].values).toEqual([0]);
        expect(tiff.gps[0x0006].values).toEqual([[46, 1]]);
        expect(tiff.gps[0x0007].values).toEqual([[13, 1], [3, 1], [22, 1]]);
        expect(tiff.gps[0x001D].values).toBe('2024:05:01');

        // The seconds denominator is what carries the precision: 402/10 and
        // not 40/1. Read back through the tests' own arithmetic, those
        // rationals are the two decimals the page will show.
        expect(six(dmsDecimal(tiff.gps[0x0002].values, 'N'))).toBe(51.477833);
        expect(dmsDecimal(tiff.gps[0x0004].values, 'W')).toBe(-0.0015);

        // The embedded preview is a second visible copy of the picture, so it
        // has to be a real JPEG rather than an IFD1 that claims one.
        expect(tiff.thumbnail).not.toBeNull();
        const preview = await sharp(tiff.thumbnail).metadata();
        expect(preview.format).toBe('jpeg');
        expect([preview.width, preview.height]).toEqual([48, 36]);
    });

    it('gps-sydney.jpg is big-endian and puts both signs the other way round', () => {
        const tiff = exifTiffOf(read('gps-sydney.jpg'));

        expect(tiff.byteOrder).toBe('MM');
        expect(tiff.gps[0x0001].values).toBe('S');
        expect(tiff.gps[0x0002].values).toEqual([[33, 1], [51, 1], [245, 10]]);
        expect(tiff.gps[0x0003].values).toBe('E');
        expect(tiff.gps[0x0004].values).toEqual([[151, 1], [12, 1], [551, 10]]);

        expect(six(dmsDecimal(tiff.gps[0x0002].values, 'S'))).toBe(-33.856806);
        expect(six(dmsDecimal(tiff.gps[0x0004].values, 'E'))).toBe(151.215306);
    });

    it('dpi-300.jpg states 300 DPI in a JFIF header and nowhere else', () => {
        const resolution = readResolution(read('dpi-300.jpg'));
        expect(resolution.source).toBe('jfif');
        expect(resolution.jfif).toEqual({ units: 1, xDensity: 300, yDensity: 300 });
        expect(resolution.exif).toBeNull();
        expect(resolution.dpi).toEqual({ x: 300, y: 300 });
    });

    it('icc-srgb.jpg carries a parseable profile with the description it was built with', async () => {
        const app2 = jpegSegments(read('icc-srgb.jpg')).segments.find((segment) => segment.marker === 0xE2);
        expect(app2.payload.subarray(0, 12).toString('latin1')).toBe('ICC_PROFILE\0');

        // The two bytes after the header are the piece number and the total.
        expect([app2.payload[12], app2.payload[13]]).toEqual([1, 1]);

        const profile = readIccTags(app2.payload.subarray(14));
        expect(profile.description).toBe('Resizo Fixture sRGB');
        expect(profile.colourSpace).toBe('RGB ');
        expect(profile.pcs).toBe('XYZ ');
        expect(profile.deviceClass).toBe('mntr');
        expect(profile.version).toBe('2.1');
        expect(profile.size).toBe(app2.payload.length - 14);
        expect(Object.keys(profile.tags).sort()).toEqual(
            ['bTRC', 'bXYZ', 'cprt', 'desc', 'gTRC', 'gXYZ', 'rTRC', 'rXYZ', 'wtpt'],
        );

        // sharp is the second opinion again: libvips finds a profile here too.
        expect(Boolean((await sharp(Buffer.from(read('icc-srgb.jpg'))).metadata()).icc)).toBe(true);
    });

    it('xmp.jpg carries a packet holding markup that must never become markup', () => {
        const app1 = jpegSegments(read('xmp.jpg')).segments.find((segment) => segment.marker === 0xE1);
        expect(app1.payload.subarray(0, 29).toString('latin1')).toBe('http://ns.adobe.com/xap/1.0/\0');

        const packet = app1.payload.subarray(29).toString('utf8');
        expect(packet).toContain('<?xpacket begin=');
        expect(packet).toContain('xmp:CreatorTool="Resizo Fixture Writer 1.0"');
        expect(packet).toContain('<dc:creator>');

        // Escaped in the bytes, so a reader that decodes entities ends up
        // holding a script element as a STRING.
        expect(packet).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');

        // And unescaped elsewhere, aimed at the scanner rather than the page.
        expect(packet).toContain('<!-- an HTML comment sitting between two properties');
    });

    it('malformed-exif.jpg has one unreadable block beside one good one', () => {
        const { segments } = jpegSegments(read('malformed-exif.jpg'));
        const carriers = segments.filter((segment) => segment.marker >= 0xE0 || segment.marker === 0xFE);
        expect(carriers.map((segment) => segment.marker)).toEqual([0xE0, 0xE1]);

        // The Exif header is intact; the IFD0 offset behind it is not.
        expect(carriers[1].payload.subarray(0, 6).toString('latin1')).toBe('Exif\0\0');
        expect(carriers[1].payload.readUInt32LE(10)).toBe(0x00FFFFFF);
        expect(() => readTiff(carriers[1].payload.subarray(6))).toThrow();

        // The JFIF beside it still reads, which is the whole point of the file.
        expect(readResolution(read('malformed-exif.jpg')).dpi).toEqual({ x: 72, y: 72 });
    });

    it('huge-comment.jpg holds exactly 60,000 bytes of comment', () => {
        const comment = jpegSegments(read('huge-comment.jpg')).segments
            .find((segment) => segment.marker === 0xFE);
        expect(comment.payload.length).toBe(60_000);
        expect(comment.payload.subarray(0, 23).toString('latin1')).toBe('Resizo fixture comment.');
    });

    it('png-phys.png states 300 DPI in a pHYs chunk with a valid CRC', () => {
        const { chunks } = pngChunks(read('png-phys.png'));
        expect(chunks.every((chunk) => chunk.crcOk)).toBe(true);

        const phys = chunks.find((chunk) => chunk.type === 'pHYs');
        expect([phys.data.readUInt32BE(0), phys.data.readUInt32BE(4), phys.data[8]]).toEqual([11811, 11811, 1]);
        expect(readResolution(read('png-phys.png')).dpi).toEqual({ x: 300, y: 300 });
    });

    it('png-alpha-text.png is colour type 6 and carries both kinds of text chunk', () => {
        const { chunks } = pngChunks(read('png-alpha-text.png'));
        expect(chunks.every((chunk) => chunk.crcOk)).toBe(true);
        expect(chunks[0].data[9]).toBe(6);

        const text = chunks.find((chunk) => chunk.type === 'tEXt');
        expect(textKeyword(text)).toBe('Comment');
        expect(text.data.subarray(8).toString('latin1')).toBe('Resizo fixture: a PNG carrying text chunks');

        const international = chunks.find((chunk) => chunk.type === 'iTXt');
        expect(textKeyword(international)).toBe('Description');
        // An iTXt is defined as UTF-8, and this one is deliberately not ASCII:
        // a reader that took it as latin1 mangles the line visibly.
        expect(international.data.subarray(18).toString('utf8'))
            .toBe('Shapes drawn by sharp — ünïcøde intact ✓');

        // No resolution, so the report has nothing to say about DPI here.
        expect(chunks.some((chunk) => chunk.type === 'pHYs')).toBe(false);
    });

    it('png-as-jpg.jpg is a PNG and nothing about it but the name is wrong', () => {
        const bytes = read('png-as-jpg.jpg');
        expect(Buffer.from(bytes).subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');

        const { chunks } = pngChunks(bytes);
        expect(chunks.map((chunk) => chunk.type)).toEqual(['IHDR', 'IDAT', 'IEND']);
        expect(inspectMetadata(bytes).found).toEqual([]);
    });

    it('webp-alpha.webp announces its alpha channel in a VP8X chunk', () => {
        const { form, chunks } = riffChunks(read('webp-alpha.webp'));
        expect(form).toBe('WEBP');
        expect(chunks.map((chunk) => chunk.type)).toEqual(['VP8X', 'VP8L']);

        const flags = chunks[0].payload[0];
        expect(flags & 0x10).not.toBe(0);
        expect(flags & 0x08).toBe(0);
        expect(chunks[0].payload.readUIntLE(4, 3)).toBe(259);
        expect(chunks[0].payload.readUIntLE(7, 3)).toBe(199);
    });

    it('webp-exif-xmp.webp holds ICCP, EXIF and XMP with the VP8X flags to match', () => {
        const { chunks } = riffChunks(read('webp-exif-xmp.webp'));
        expect(chunks.map((chunk) => chunk.type)).toEqual(['VP8X', 'ICCP', 'VP8L', 'EXIF', 'XMP ']);

        const flags = chunks[0].payload[0];
        expect(flags & 0x20).not.toBe(0);
        expect(flags & 0x08).not.toBe(0);
        expect(flags & 0x04).not.toBe(0);

        expect(readIccTags(chunks[1].payload).description).toBe('Resizo Fixture WebP RGB');

        // No 'Exif\0\0' in front of it: the WebP container spec asks for the
        // bare TIFF, and libwebp and exiftool both write it that way.
        expect(chunks[3].payload.subarray(0, 2).toString('latin1')).toBe('II');
        expect(readTiff(chunks[3].payload).ifd0[0x0110].values).toBe('Fixture Camera');

        expect(chunks[4].payload.toString('utf8')).toContain('<dc:creator>');
    });

    it('the page sample is gps-greenwich.jpg, byte for byte', () => {
        expect(fs.readFileSync(SAMPLE).equals(fs.readFileSync(path.join(DIR, 'gps-greenwich.jpg')))).toBe(true);
    });
});

/* ========================== two: the report agrees with the readers under it */

describe('the report never contradicts the readers it is built on', () => {
    it.each(FIXTURES)('$name reports the format, size and orientation the engine already knows', (fixture) => {
        const bytes = read(fixture.name);
        const report = inspectImageMetadata(bytes, { name: fixture.name });

        expect(report.ok).toBe(true);
        expect(report.file.format).toBe(sniffImageType(bytes));
        expect(report.file.width).toBe(readImageSize(bytes).width);
        expect(report.file.height).toBe(readImageSize(bytes).height);
        expect(report.file.alphaChannel).toBe(readImageSize(bytes).hasAlpha);
        expect(report.file.bytes).toBe(bytes.length);

        if (fixture.format === 'jpeg') {
            // readExifOrientation answers 1 for a file with no Orientation tag,
            // because 1 is the TIFF spec's default rather than something the
            // file said. The report says null there instead, and it is right
            // to: a row reading "Normal" on a file that records nothing claims
            // a tag exists. So null is allowed exactly where the reader saw
            // that default, and wherever a file really does state an
            // orientation the two have to agree.
            const stored = readExifOrientation(bytes);
            if (report.exif.orientation.value === null) expect(stored).toBe(1);
            else expect(report.exif.orientation.value).toBe(stored);
        }
    });

    it('takes the picture size from the image header, never from EXIF', () => {
        // exif-camera.jpg says 4032 x 3024 in PixelXDimension/PixelYDimension
        // and is 800 x 600. A viewer that read the tags shows the wrong size
        // and looks entirely plausible doing it.
        const report = inspectImageMetadata(read('exif-camera.jpg'), { name: 'exif-camera.jpg' });
        expect([report.file.width, report.file.height]).toEqual([800, 600]);
        expect(report.file.megapixels).toBe(Number(((800 * 600) / 1e6).toFixed(1)));

        // And the orientation this file does state, so the null-tolerant rule
        // above cannot pass by reporting null for everything.
        expect(report.exif.orientation.value).toBe(6);
        expect(report.exif.orientation.description).toBe('Rotate 90° clockwise');
    });

    it('reads the format from the magic bytes and calls the extension a mismatch', () => {
        // The RED proof for "the extension is trusted over the bytes": this
        // fails the moment the report calls a PNG a JPEG because the name did.
        const report = inspectImageMetadata(read('png-as-jpg.jpg'), { name: 'holiday.jpg' });

        expect(report.file.format).toBe('png');
        expect(report.file.extension).toBe('jpg');
        expect(report.file.extensionMismatch).toBe(true);
        expect(report.file.expectedExtensions).toContain('png');
        expect([report.file.width, report.file.height]).toEqual([100, 100]);
    });

    it('says nothing is wrong with a name that matches, and nothing at all with no name', () => {
        expect(inspectImageMetadata(read('plain.jpg'), { name: 'plain.jpg' }).file.extensionMismatch).toBe(false);
        expect(inspectImageMetadata(read('plain.jpg'), { name: 'photo.jpeg' }).file.extensionMismatch).toBe(false);

        const bare = inspectImageMetadata(read('plain.jpg'), { name: 'photo' });
        expect(bare.file.extension).toBeNull();
        expect(bare.file.extensionMismatch).toBe(false);
    });

    it('quotes readResolution rather than doing its own arithmetic', () => {
        for (const name of ['dpi-300.jpg', 'exif-camera.jpg', 'png-phys.png', 'malformed-exif.jpg']) {
            const report = inspectImageMetadata(read(name), { name });
            const raw = readResolution(read(name));

            expect(report.resolution.raw).toEqual(raw);
            expect(report.resolution.present).toBe(true);
            expect(report.resolution.x).toBe(raw.dpi.x);
            expect(report.resolution.y).toBe(raw.dpi.y);
            expect(report.resolution.source).toBe(raw.source);
        }
    });

    it('survives readResolution refusing a WebP outright', () => {
        // readResolution THROWS for a WebP — "Only JPG and PNG files store a
        // resolution that can be changed" — rather than returning an empty
        // reading. A report that let that escape kills the whole page for the
        // two formats that can carry EXIF, XMP and an ICC profile at once.
        expect(() => readResolution(read('webp-exif-xmp.webp'))).toThrow();

        for (const name of ['webp-alpha.webp', 'webp-exif-xmp.webp']) {
            const report = inspectImageMetadata(read(name), { name });
            expect(report.ok).toBe(true);
            expect(report.resolution.present).toBe(false);
            expect(report.resolution.x).toBeNull();
            expect(report.resolution.source).toBeNull();
        }
    });

    it('reads the coordinates of both landmarks, with the signs their references give', () => {
        const greenwich = inspectImageMetadata(read('gps-greenwich.jpg'), { name: 'gps-greenwich.jpg' });
        expect(greenwich.gps.present).toBe(true);
        expect(six(greenwich.gps.latitude)).toBe(six(dmsDecimal(GREENWICH.latitude, GREENWICH.latitudeRef)));
        expect(greenwich.gps.longitude).toBe(dmsDecimal(GREENWICH.longitude, GREENWICH.longitudeRef));
        expect(greenwich.gps.altitude).toEqual({ metres: 46, belowSeaLevel: false });
        expect(greenwich.gps.timestamp).toEqual({ date: '2024-05-01', time: '13:03:22', utc: true });

        // The RED proof for a reversed sign. Greenwich is a few metres WEST of
        // the meridian, so the longitude is -0.0015; a reader that ignored the
        // 'W' reference reports +0.0015 and nothing else about the file
        // changes. Sydney is the other corner of the world, so a viewer that
        // hard-coded one hemisphere passes one of these and fails the other.
        expect(greenwich.gps.longitude).toBeLessThan(0);

        const sydney = inspectImageMetadata(read('gps-sydney.jpg'), { name: 'gps-sydney.jpg' });
        expect(six(sydney.gps.latitude)).toBe(six(dmsDecimal(SYDNEY.latitude, SYDNEY.latitudeRef)));
        expect(six(sydney.gps.longitude)).toBe(six(dmsDecimal(SYDNEY.longitude, SYDNEY.longitudeRef)));
        expect(sydney.gps.latitude).toBeLessThan(0);
        expect(sydney.gps.longitude).toBeGreaterThan(0);
        expect(sydney.gps.altitude).toBeNull();
    });

    it('reports a malformed block as a problem and keeps every other fact', () => {
        const report = inspectImageMetadata(read('malformed-exif.jpg'), { name: 'malformed-exif.jpg' });

        expect(report.ok).toBe(true);
        expect(report.problems.length).toBeGreaterThan(0);
        expect(report.problems.every((sentence) => typeof sentence === 'string')).toBe(true);

        // The file facts and the JFIF beside the broken block are untouched.
        expect([report.file.width, report.file.height]).toEqual([120, 90]);
        expect(report.resolution.present).toBe(true);
        expect(report.resolution.x).toBe(72);
    });

    it('holds every text value to a string and a length, however long the source', () => {
        const report = inspectImageMetadata(read('huge-comment.jpg'), { name: 'huge-comment.jpg' });
        const comment = report.text.find((entry) => entry.source === 'comment');

        expect(comment.bytes).toBe(60_000);
        expect(typeof comment.value).toBe('string');
        expect(comment.value.length).toBeLessThanOrEqual(2_000);
        expect(comment.truncated).toBe(true);
    });

    it('hands the XMP packet back as text, markup and all', () => {
        const report = inspectImageMetadata(read('xmp.jpg'), { name: 'xmp.jpg' });
        expect(report.xmp.present).toBe(true);

        const values = report.xmp.fields.map((field) => field.value);
        expect(values.every((value) => typeof value === 'string')).toBe(true);

        // The entities are decoded, so the value IS a script element — as a
        // string. Everything downstream has to render it as text, which is
        // what the page test proves; here the contract is only that the engine
        // hands over a string and not a node, an object or a fragment.
        const description = report.xmp.fields.find((field) => field.id === 'dc:description');
        expect(description.value).toContain('<script>alert(1)</script>');
        expect(typeof description.value).toBe('string');

        const creatorTool = report.xmp.fields.find((field) => field.id === 'xmp:CreatorTool');
        expect(creatorTool.value).toBe('Resizo Fixture Writer 1.0');
    });

    it('describes the ICC profile without dumping it', () => {
        const report = inspectImageMetadata(read('icc-srgb.jpg'), { name: 'icc-srgb.jpg' });

        expect(report.icc.present).toBe(true);
        expect(report.icc.source).toBe('app2');
        expect(report.icc.description).toBe('Resizo Fixture sRGB');
        expect(report.icc.colourSpace).toBe('RGB');
        expect(report.icc.version).toBe('2.1');
        expect(report.icc.bytes).toBeGreaterThan(128);
        expect(report.icc.compressed).toBe(false);
    });

    it('finds nothing in the file that has nothing in it', () => {
        const report = inspectImageMetadata(read('plain.jpg'), { name: 'plain.jpg' });

        expect(report.exif.present).toBe(false);
        expect(report.gps.present).toBe(false);
        expect(report.xmp.present).toBe(false);
        expect(report.icc.present).toBe(false);
        expect(report.resolution.present).toBe(false);
        expect(report.text).toEqual([]);
        expect(report.privacy.location).toBe(false);
        expect(report.privacy.removable).toBe(false);
        expect(report.privacy.categories.every((category) => category.present === false)).toBe(true);
    });

    it('refuses a HEIC by name and anything that is not an image at all', () => {
        // HEIC is refused rather than parsed: libheif never loads on this page
        // and an ISOBMFF walker is a different job (CLAUDE.md > Layering).
        const heic = new Uint8Array(fs.readFileSync(
            path.join(process.cwd(), 'tests', 'e2e', 'fixtures', 'assets', 'sample-96x64.heic'),
        ));
        const refusal = inspectImageMetadata(heic, { name: 'photo.heic' });
        expect(refusal.ok).toBe(false);
        expect(refusal.format).toBe('heic');
        expect(typeof refusal.message).toBe('string');

        const notAnImage = inspectImageMetadata(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]), { name: 'notes.txt' });
        expect(notAnImage.ok).toBe(false);
        expect(notAnImage.format).toBeNull();

        // `format` is the discriminator the page needs, and it is the one the
        // engine gives: a HEIC gets a link to /heic and a text file gets told
        // it is not an image. Both currently share a `code` and a message, so
        // a page keyed off either of those could not tell them apart.
        expect(['unsupported', 'invalid']).toContain(refusal.code);
        expect(['unsupported', 'invalid']).toContain(notAnImage.code);
    });
});

/* ================================ three: the viewer and the remover together */

describe('what the viewer showed is what the remover takes out', () => {
    /** Every fixture that has something the remover would touch. */
    const REMOVABLE = [
        'exif-camera.jpg',
        'gps-greenwich.jpg',
        'gps-sydney.jpg',
        'xmp.jpg',
        'huge-comment.jpg',
        'malformed-exif.jpg',
        'png-alpha-text.png',
        'webp-exif-xmp.webp',
    ];

    it.each(REMOVABLE)('%s: everything the viewer listed as removable is gone afterwards', (name) => {
        const before = inspectImageMetadata(read(name), { name });
        expect(before.privacy.removable).toBe(true);

        const stripped = stripMetadata(read(name)).bytes;
        const after = inspectImageMetadata(stripped, { name });

        expect(after.ok).toBe(true);
        expect(after.exif.present).toBe(false);
        expect(after.gps.present).toBe(false);
        expect(after.xmp.present).toBe(false);
        expect(after.text).toEqual([]);
        expect(after.other.thumbnail).toBe(false);
        expect(after.privacy.location).toBe(false);
        expect(after.privacy.removable).toBe(false);

        // The picture is untouched: same format, same pixels, fewer bytes.
        expect(after.file.format).toBe(before.file.format);
        expect(after.file.width).toBe(before.file.width);
        expect(after.file.height).toBe(before.file.height);
        expect(after.file.bytes).toBeLessThan(before.file.bytes);
    });

    it('keeps the colour profile the remover keeps', () => {
        const before = inspectImageMetadata(read('icc-srgb.jpg'), { name: 'icc-srgb.jpg' });
        expect(before.icc.present).toBe(true);

        const after = inspectImageMetadata(stripMetadata(read('icc-srgb.jpg')).bytes, { name: 'icc-srgb.jpg' });
        expect(after.icc.present).toBe(true);
        expect(after.icc.description).toBe(before.icc.description);
        expect(after.icc.bytes).toBe(before.icc.bytes);
    });

    it('says there is nothing to remove when there is nothing to remove', () => {
        for (const name of ['plain.jpg', 'png-as-jpg.jpg', 'webp-alpha.webp']) {
            expect(inspectImageMetadata(read(name), { name }).privacy.removable).toBe(false);
        }
    });

    it('the coordinates are gone from the BYTES, not merely from the report', () => {
        // The RED proof for "the remover left the GPS in and the viewer said
        // otherwise". Everything above asks the report whether the location
        // went, and a report that re-used the before-state, cached a verdict
        // or trusted a caller's flag would pass all of it. This asks the file.
        const source = read('gps-greenwich.jpg');
        const stripped = Buffer.from(stripMetadata(source).bytes);

        // The Exif marker itself, and then the three latitude rationals as
        // they were actually written — 51/1, 28/1, 402/10, little-endian.
        expect(stripped.includes(Buffer.from('Exif\0\0', 'latin1'))).toBe(false);

        const latitude = Buffer.alloc(24);
        [[51, 1], [28, 1], [402, 10]].forEach(([numerator, denominator], index) => {
            latitude.writeUInt32LE(numerator, index * 8);
            latitude.writeUInt32LE(denominator, index * 8 + 4);
        });
        expect(Buffer.from(source).includes(latitude)).toBe(true);
        expect(stripped.includes(latitude)).toBe(false);

        // And the thumbnail, which is a second visible copy of the picture.
        const preview = exifTiffOf(source).thumbnail;
        expect(stripped.includes(preview)).toBe(false);
    });
});
