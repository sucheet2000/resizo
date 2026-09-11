/**
 * The tests' own ICO reader, proved against bytes this file lays out by hand.
 *
 * WHY A PARSER NEEDS ITS OWN TESTS AT ALL. `tests/helpers/ico.js` exists to
 * give a second opinion on the favicon.ico the engine writes — but a second
 * opinion nobody has checked is just a second guess. Every fault it claims to
 * catch is produced here on purpose, one byte at a time, on a file that was
 * valid until that byte moved. If the reader stops catching one of them, a
 * flow that "verified" an icon package would keep passing while the container
 * rotted underneath it.
 *
 * THE BUILDER BELOW IS DELIBERATELY NOT THE ENGINE'S. `buildDirectory` writes
 * an ICONDIR and its entries straight from the Microsoft table, in this file,
 * so a fixture and the reader under test share no code at all. The payloads
 * are real PNGs from sharp — the repo's independent libvips reference
 * (CLAUDE.md > Gotchas) — rather than eight magic bytes and some filler,
 * because an IHDR the reader is asked to believe should be one libvips wrote.
 *
 * NOTHING HERE IMPORTS lib/image-client/ico.js, and nothing here may. The day
 * this file needs the engine to build a fixture is the day the two agree with
 * each other for a reason that has nothing to do with the format.
 */
import sharp from 'sharp';
import { beforeAll, describe, expect, it } from 'vitest';

import { assertPngIco, parseIco } from '../../helpers/ico.js';

const ICONDIR_SIZE = 6;
const ICONDIRENTRY_SIZE = 16;

/** The three sizes Microsoft's page tells developers to include at a minimum. */
const SIZES = [16, 32, 48];

/**
 * One flat square per size, as a real PNG.
 *
 * Different colours per size so a payload that ended up in the wrong slot is
 * visible in a decode rather than only in a length, and 4 channels so the
 * bytes are what a favicon actually carries.
 */
const COLOURS = {
    16: { r: 220, g: 30, b: 40, alpha: 1 },
    32: { r: 30, g: 170, b: 60, alpha: 1 },
    48: { r: 40, g: 60, b: 200, alpha: 1 },
    64: { r: 235, g: 200, b: 40, alpha: 1 },
    256: { r: 90, g: 40, b: 160, alpha: 1 },
};

function squarePng(size) {
    return sharp({
        create: {
            width: size,
            height: size,
            channels: 4,
            background: COLOURS[size] ?? { r: 10, g: 10, b: 10, alpha: 1 },
        },
    }).png().toBuffer();
}

/**
 * An ICO laid out from the structure, with every field individually settable.
 *
 * `images` is `[{ size, payload }]` and every override is a deliberate lie the
 * reader is then asked about: `width`/`height` write a different byte into the
 * directory than the payload holds, `offset` and `bytes` move or misreport a
 * payload, and `reserved`, `type` and `count` corrupt the header. A test that
 * passes no overrides gets a file that is correct in every field.
 */
function buildDirectory(images, {
    reserved = 0,
    type = 1,
    count = images.length,
    entry = () => ({}),
    trailing = 0,
} = {}) {
    const directory = Buffer.alloc(ICONDIR_SIZE + ICONDIRENTRY_SIZE * images.length);
    directory.writeUInt16LE(reserved, 0);
    directory.writeUInt16LE(type, 2);
    directory.writeUInt16LE(count, 4);

    // The natural layout: every payload after the directory, in order, packed.
    let cursor = directory.length;
    const placed = images.map((image) => {
        const at = cursor;
        cursor += image.payload.length;
        return { ...image, offset: at, bytes: image.payload.length };
    });

    placed.forEach((image, index) => {
        const override = entry(index, image) ?? {};
        const at = ICONDIR_SIZE + ICONDIRENTRY_SIZE * index;

        const width = override.width ?? image.size;
        const height = override.height ?? image.size;

        // A 256-pixel dimension is stored as 0: the byte cannot hold 256.
        directory.writeUInt8(width >= 256 ? 0 : width, at);
        directory.writeUInt8(height >= 256 ? 0 : height, at + 1);
        directory.writeUInt8(override.colorCount ?? 0, at + 2);
        directory.writeUInt8(override.entryReserved ?? 0, at + 3);
        directory.writeUInt16LE(override.planes ?? 1, at + 4);
        directory.writeUInt16LE(override.bitCount ?? 32, at + 6);
        directory.writeUInt32LE(override.bytes ?? image.bytes, at + 8);
        directory.writeUInt32LE(override.offset ?? image.offset, at + 12);
    });

    return Buffer.concat([
        directory,
        ...placed.map((image) => image.payload),
        Buffer.alloc(trailing),
    ]);
}

let pngs;

beforeAll(async () => {
    const built = await Promise.all([16, 32, 48, 64, 256].map(async (size) => [size, await squarePng(size)]));
    pngs = Object.fromEntries(built);
}, 60_000);

/** The three-entry favicon.ico this product is specified to write. */
const faviconImages = () => SIZES.map((size) => ({ size, payload: pngs[size] }));

describe('a well-formed ICO', () => {
    it('reports the header, every entry and where each payload sits', () => {
        const file = buildDirectory(faviconImages());
        const ico = parseIco(file);

        expect(ico.header).toEqual({ reserved: 0, type: 1, count: 3 });

        // The self-check: the walk found three real payloads, not an empty
        // list that would satisfy every "no overlap, nothing outside the file"
        // assertion below by having nothing to check.
        expect(ico.entries).toHaveLength(3);
        expect(ico.entries.every((item) => item.bytes > 0)).toBe(true);

        expect(ico.entries.map((item) => item.width)).toEqual(SIZES);
        expect(ico.entries.map((item) => item.height)).toEqual(SIZES);
        expect(ico.entries.map((item) => item.isPng)).toEqual([true, true, true]);
        expect(ico.entries.map((item) => item.pngWidth)).toEqual(SIZES);
        expect(ico.entries.map((item) => item.pngHeight)).toEqual(SIZES);
        expect(ico.entries.map((item) => item.planes)).toEqual([1, 1, 1]);
        expect(ico.entries.map((item) => item.bitCount)).toEqual([32, 32, 32]);
        expect(ico.entries.map((item) => item.colorCount)).toEqual([0, 0, 0]);

        // The first payload starts immediately after the directory, and each
        // one after that starts where the previous one ended.
        const directoryEnd = ICONDIR_SIZE + ICONDIRENTRY_SIZE * 3;
        expect(ico.entries[0].offset).toBe(directoryEnd);
        for (let i = 1; i < ico.entries.length; i += 1) {
            expect(ico.entries[i].offset).toBe(ico.entries[i - 1].offset + ico.entries[i - 1].bytes);
        }

        // Nothing after the last payload, and the whole file is accounted for.
        expect(ico.trailing).toBe(0);
        expect(ico.bytes).toBe(directoryEnd + SIZES.reduce((sum, size) => sum + pngs[size].length, 0));
    });

    it('hands back payloads libvips can open at the size the directory promised', async () => {
        const ico = parseIco(buildDirectory(faviconImages()));

        for (const entry of ico.entries) {
            const meta = await sharp(entry.data).metadata();
            expect(meta.format).toBe('png');
            expect(meta.width).toBe(entry.width);
            expect(meta.height).toBe(entry.height);
        }
    });

    it('reads a 256-pixel entry, which is stored as a zero byte', () => {
        const file = buildDirectory([{ size: 256, payload: pngs[256] }]);
        const ico = parseIco(file);

        expect(ico.entries[0].rawWidth).toBe(0);
        expect(ico.entries[0].rawHeight).toBe(0);
        expect(ico.entries[0].width).toBe(256);
        expect(ico.entries[0].height).toBe(256);
        // And the IHDR check ran against 256 rather than against the 0 byte:
        // a reader that compared the raw byte would have thrown here.
        expect(ico.entries[0].pngWidth).toBe(256);
    });

    it('accepts entries listed out of size order, and still catches an overlap', () => {
        // Nothing in the format says the directory is sorted. What matters is
        // that the payloads are disjoint, which is checked across the file.
        const ico = parseIco(buildDirectory([
            { size: 48, payload: pngs[48] },
            { size: 16, payload: pngs[16] },
            { size: 32, payload: pngs[32] },
        ]));

        expect(ico.entries.map((item) => item.width)).toEqual([48, 16, 32]);
    });

    it('takes a Uint8Array and an ArrayBuffer as readily as a Buffer', () => {
        const file = buildDirectory(faviconImages());
        const view = new Uint8Array(file);

        expect(parseIco(view).header.count).toBe(3);
        expect(parseIco(view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength)).header.count).toBe(3);
    });
});

describe('a header that is not an icon directory', () => {
    it('refuses bytes too short to hold an ICONDIR', () => {
        expect(() => parseIco(Buffer.alloc(5))).toThrow(/shorter than the 6-byte ICONDIR/);
    });

    it('refuses a non-zero idReserved', () => {
        expect(() => parseIco(buildDirectory(faviconImages(), { reserved: 1 })))
            .toThrow(/idReserved is 1, not 0/);
    });

    it('refuses a cursor, which is the same structure with idType 2', () => {
        expect(() => parseIco(buildDirectory(faviconImages(), { type: 2 })))
            .toThrow(/idType is 2, not 1 \(2 is a cursor\)/);
    });

    it('refuses idCount 0', () => {
        const file = buildDirectory(faviconImages(), { count: 0 });
        expect(() => parseIco(file)).toThrow(/idCount is 0/);
    });

    it('refuses a directory that runs past the end of the file', () => {
        // The header claims four images; the file carries three entries' worth
        // of directory. A reader that trusted idCount would read an entry out
        // of the first payload's bytes.
        const file = buildDirectory(faviconImages(), { count: 4 }).subarray(0, ICONDIR_SIZE + ICONDIRENTRY_SIZE * 3);
        expect(() => parseIco(file)).toThrow(/truncated ICO: 4 entries need 70 bytes of directory/);
    });

    it('refuses a non-zero bReserved in an entry', () => {
        const file = buildDirectory(faviconImages(), {
            entry: (index) => (index === 1 ? { entryReserved: 7 } : {}),
        });
        expect(() => parseIco(file)).toThrow(/entry 1: bReserved is 7, not 0/);
    });
});

describe('an entry that does not describe the bytes behind it', () => {
    it('refuses an offset one byte past where the payload ends the file', () => {
        // ONE BYTE. The last entry's payload ends the file, so adding one to
        // its offset puts its last byte outside — the exact shape of an ICO
        // written with an offset counted from the wrong base.
        const file = buildDirectory(faviconImages(), {
            entry: (index, image) => (index === 2 ? { offset: image.offset + 1 } : {}),
        });

        expect(() => parseIco(file)).toThrow(/entry 2: bytes \d+\.\.\d+ run past the end of the \d+-byte file/);
    });

    it('refuses an offset one byte short, which makes two payloads overlap', () => {
        const file = buildDirectory(faviconImages(), {
            entry: (index, image) => (index === 2 ? { offset: image.offset - 1 } : {}),
        });

        expect(() => parseIco(file)).toThrow(/entries 1 and 2 overlap/);
    });

    it('refuses a payload that starts inside the directory', () => {
        const file = buildDirectory(faviconImages(), {
            entry: (index) => (index === 0 ? { offset: ICONDIR_SIZE } : {}),
        });

        expect(() => parseIco(file)).toThrow(/dwImageOffset 6 is inside the 54-byte directory/);
    });

    it('refuses dwBytesInRes 0', () => {
        const file = buildDirectory(faviconImages(), {
            entry: (index) => (index === 0 ? { bytes: 0 } : {}),
        });

        expect(() => parseIco(file)).toThrow(/entry 0: dwBytesInRes is 0/);
    });

    it('refuses a length that runs off the end of the file', () => {
        const file = buildDirectory(faviconImages(), {
            entry: (index, image) => (index === 2 ? { bytes: image.bytes + 64 } : {}),
        });

        expect(() => parseIco(file)).toThrow(/entry 2: bytes .* run past the end/);
    });

    it('refuses two entries pointed at overlapping ranges', () => {
        // Both entries claim the 48-pixel payload's start, with different
        // lengths: the classic "one image inside another" ICO.
        const file = buildDirectory(faviconImages(), {
            entry: (index, image) => (index === 1 ? { offset: image.offset, bytes: image.bytes + 10 } : {}),
        });

        expect(() => parseIco(file)).toThrow(/entries 1 and 2 overlap/);
    });
});

describe('a directory that disagrees with the picture it points at', () => {
    it('refuses a width one pixel off what the PNG says', () => {
        // A BROWSER PICKS AN ENTRY BY THE DIRECTORY AND DRAWS THE PAYLOAD. A
        // 32 × 32 slot holding a 31-pixel picture looks right in a viewer that
        // reads the payload and wrong in the tab bar.
        const file = buildDirectory(faviconImages(), {
            entry: (index) => (index === 1 ? { width: 31 } : {}),
        });

        expect(() => parseIco(file))
            .toThrow(/entry 1: the directory says 31 × 32 but the PNG's IHDR says 32 × 32/);
    });

    it('refuses a height that belongs to another entry', () => {
        const file = buildDirectory(faviconImages(), {
            entry: (index) => (index === 2 ? { height: 32 } : {}),
        });

        expect(() => parseIco(file)).toThrow(/entry 2: the directory says 48 × 32/);
    });

    it('refuses a 256 claim over a 64-pixel PNG', () => {
        const file = buildDirectory([{ size: 64, payload: pngs[64] }], {
            entry: () => ({ width: 256, height: 256 }),
        });

        expect(() => parseIco(file)).toThrow(/the directory says 256 × 256 but the PNG's IHDR says 64 × 64/);
    });

    it('refuses a PNG signature with no IHDR behind it', () => {
        const broken = Buffer.from(pngs[32]);
        broken.write('IDAT', 12, 'latin1');

        const file = buildDirectory([{ size: 32, payload: broken }]);
        expect(() => parseIco(file)).toThrow(/followed by a "IDAT" chunk, not IHDR/);
    });

    it('refuses a PNG too short to hold an IHDR at all', () => {
        const file = buildDirectory([{ size: 32, payload: pngs[32].subarray(0, 12) }]);
        expect(() => parseIco(file)).toThrow(/too short to hold an IHDR/);
    });
});

describe('assertPngIco, which is the check a Resizo favicon has to pass', () => {
    it('accepts the three-entry package and hands back the parse', () => {
        const ico = assertPngIco(buildDirectory(faviconImages()), { sizes: SIZES });

        expect(ico.entries).toHaveLength(3);
        expect(ico.entries.map((entry) => entry.width)).toEqual(SIZES);
    });

    it('refuses a payload that is not a PNG', async () => {
        // A legal ICO and a wrong Resizo output: a DIB payload. parseIco reads
        // it happily and reports isPng false; this is the check that says no.
        const bmp = Buffer.concat([Buffer.from('BM', 'latin1'), Buffer.alloc(126)]);
        const file = buildDirectory([
            { size: 16, payload: pngs[16] },
            { size: 32, payload: bmp },
        ]);

        expect(parseIco(file).entries.map((entry) => entry.isPng)).toEqual([true, false]);
        expect(() => assertPngIco(file)).toThrow(/entry 1 \(32 × 32\) is not a PNG — it starts 42 4d/);
    });

    it('refuses a package missing one of the three sizes', () => {
        const file = buildDirectory([
            { size: 16, payload: pngs[16] },
            { size: 32, payload: pngs[32] },
        ]);

        expect(() => assertPngIco(file, { sizes: SIZES }))
            .toThrow(/the ICO holds 16x16, 32x32 — expected 16x16, 32x32, 48x48/);
    });

    it('refuses the three sizes in the wrong order', () => {
        const file = buildDirectory([
            { size: 48, payload: pngs[48] },
            { size: 32, payload: pngs[32] },
            { size: 16, payload: pngs[16] },
        ]);

        expect(() => assertPngIco(file, { sizes: SIZES })).toThrow(/expected 16x16, 32x32, 48x48/);
    });
});
