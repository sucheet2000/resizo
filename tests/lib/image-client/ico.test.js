/**
 * favicon.ico — the container, byte for byte.
 *
 * WHY THE DIRECTORY IS ASSERTED FIELD BY FIELD
 *
 * An ICO is a 6-byte header, one 16-byte record per image and then the images,
 * and every number in it is little-endian. Nothing about a wrong one is
 * visible: a browser handed a directory whose offsets are a byte out shows the
 * page's default icon and reports nothing at all, in any console. So the fields
 * are checked against the structure Microsoft documents rather than against
 * what this repo's writer happens to produce —
 *
 *   ICONDIR      { WORD idReserved = 0; WORD idType = 1; WORD idCount }
 *   ICONDIRENTRY { BYTE bWidth; BYTE bHeight; BYTE bColorCount; BYTE bReserved;
 *                  WORD wPlanes; WORD wBitCount; DWORD dwBytesInRes;
 *                  DWORD dwImageOffset }
 *
 * — with a 256-pixel dimension stored as 0, because the field is one byte.
 *
 * WHY readIco EXISTS AND IS TESTED WITH DELIBERATELY BROKEN BYTES
 *
 * The engine verifies its own favicon.ico by parsing it back before it is
 * offered for download. A verifier that only ever sees good input proves
 * nothing, so every fault it claims to catch is constructed here and asserted
 * to throw — including the one-byte-wrong offset, which is the failure that
 * would otherwise ship silently.
 */
import sharp from 'sharp';
import { beforeAll, describe, expect, it } from 'vitest';

import { buildIco, readIco } from '@/lib/image-client/ico';

const PNG_SIGNATURE = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];

const HEADER_BYTES = 6;
const ENTRY_BYTES = 16;

/** A real PNG of a given square size — a genuine IHDR for readIco to read. */
async function pngOf(size, { r = 200, g = 40, b = 80 } = {}) {
    const buffer = await sharp({
        create: { width: size, height: size, channels: 4, background: { r, g, b, alpha: 1 } },
    }).png().toBuffer();

    return new Uint8Array(buffer);
}

function view(bytes) {
    return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

/** One directory record, read as the structure defines it. */
function entryAt(bytes, index) {
    const at = HEADER_BYTES + index * ENTRY_BYTES;
    const data = view(bytes);

    return {
        width: bytes[at],
        height: bytes[at + 1],
        colourCount: bytes[at + 2],
        reserved: bytes[at + 3],
        planes: data.getUint16(at + 4, true),
        bitCount: data.getUint16(at + 6, true),
        bytesInResource: data.getUint32(at + 8, true),
        offset: data.getUint32(at + 12, true),
    };
}

let png16;
let png32;
let png48;

beforeAll(async () => {
    [png16, png32, png48] = await Promise.all([pngOf(16), pngOf(32), pngOf(48)]);
}, 30_000);

function threeSizes() {
    return buildIco([
        { size: 16, png: png16 },
        { size: 32, png: png32 },
        { size: 48, png: png48 },
    ]);
}

describe('buildIco writes the structure Microsoft documents', () => {
    it('opens with reserved 0, type 1 and the entry count, little-endian', () => {
        const bytes = threeSizes();
        const data = view(bytes);

        expect(data.getUint16(0, true)).toBe(0);
        expect(data.getUint16(2, true)).toBe(1);
        expect(data.getUint16(4, true)).toBe(3);
    });

    it('answers a Uint8Array exactly as long as the header, the directory and the payloads', () => {
        const bytes = threeSizes();

        expect(bytes).toBeInstanceOf(Uint8Array);
        expect(bytes.length).toBe(
            HEADER_BYTES + 3 * ENTRY_BYTES + png16.length + png32.length + png48.length,
        );
    });

    it.each([
        [0, 16],
        [1, 32],
        [2, 48],
    ])('states entry %i as %i pixels square', (index, size) => {
        const entry = entryAt(threeSizes(), index);

        expect(entry.width).toBe(size);
        expect(entry.height).toBe(size);
    });

    it.each([0, 1, 2])('leaves the colour count and the reserved byte at 0 for entry %i', (index) => {
        const entry = entryAt(threeSizes(), index);

        // 0 means "256 colours or more", which is what a 32-bit image is; the
        // reserved byte is 0 by definition of the structure.
        expect(entry.colourCount).toBe(0);
        expect(entry.reserved).toBe(0);
    });

    it.each([0, 1, 2])('declares one plane and 32 bits per pixel for entry %i', (index) => {
        const entry = entryAt(threeSizes(), index);

        expect(entry.planes).toBe(1);
        expect(entry.bitCount).toBe(32);
    });

    it('states each payload length and each offset, cumulative from the end of the directory', () => {
        const bytes = threeSizes();
        const first = HEADER_BYTES + 3 * ENTRY_BYTES;

        expect(entryAt(bytes, 0).bytesInResource).toBe(png16.length);
        expect(entryAt(bytes, 1).bytesInResource).toBe(png32.length);
        expect(entryAt(bytes, 2).bytesInResource).toBe(png48.length);

        expect(entryAt(bytes, 0).offset).toBe(first);
        expect(entryAt(bytes, 1).offset).toBe(first + png16.length);
        expect(entryAt(bytes, 2).offset).toBe(first + png16.length + png32.length);
    });

    it('copies the payloads in order, byte for byte', () => {
        const bytes = threeSizes();

        for (const [index, png] of [png16, png32, png48].entries()) {
            const { offset, bytesInResource } = entryAt(bytes, index);
            expect(Array.from(bytes.subarray(offset, offset + bytesInResource))).toEqual(Array.from(png));
        }
    });

    it('stores a 256-pixel dimension as 0, because the field is one byte', async () => {
        const png256 = await pngOf(256);
        const bytes = buildIco([{ size: 256, png: png256 }]);
        const entry = entryAt(bytes, 0);

        expect(entry.width).toBe(0);
        expect(entry.height).toBe(0);
        expect(entry.bytesInResource).toBe(png256.length);
        expect(readIco(bytes).entries[0]).toMatchObject({ width: 256, height: 256 });
    }, 30_000);

    it.each([
        ['no entries', []],
        ['not an array', null],
        ['a size of zero', [{ size: 0, png: new Uint8Array([1]) }]],
        ['a size past a byte and a half', [{ size: 257, png: new Uint8Array([1]) }]],
        ['a fractional size', [{ size: 16.5, png: new Uint8Array([1]) }]],
        ['no payload', [{ size: 16 }]],
        ['an empty payload', [{ size: 16, png: new Uint8Array(0) }]],
    ])('refuses to write %s', (_label, entries) => {
        expect(() => buildIco(entries)).toThrow();
    });
});

describe('readIco round-trips what buildIco wrote', () => {
    it('reports the count, the sizes, the offsets and the payloads', () => {
        const bytes = threeSizes();
        const report = readIco(bytes);

        expect(report.count).toBe(3);
        expect(report.entries.map((entry) => entry.width)).toEqual([16, 32, 48]);
        expect(report.entries.map((entry) => entry.height)).toEqual([16, 32, 48]);
        expect(report.entries.map((entry) => entry.offset)).toEqual([
            HEADER_BYTES + 48,
            HEADER_BYTES + 48 + png16.length,
            HEADER_BYTES + 48 + png16.length + png32.length,
        ]);

        for (const [index, png] of [png16, png32, png48].entries()) {
            expect(report.entries[index].isPng).toBe(true);
            expect(Array.from(report.entries[index].bytes.subarray(0, 8))).toEqual(PNG_SIGNATURE);
            expect(Array.from(report.entries[index].bytes)).toEqual(Array.from(png));
        }
    });

    it('reads each payload PNG size out of its own IHDR', () => {
        const report = readIco(threeSizes());

        expect(report.entries.map((entry) => [entry.pngWidth, entry.pngHeight]))
            .toEqual([[16, 16], [32, 32], [48, 48]]);
    });
});

describe('readIco refuses bytes that are not a consistent icon', () => {
    /** buildIco's output with one byte or word overwritten. */
    function corrupted(mutate) {
        const bytes = threeSizes().slice();
        mutate(bytes, view(bytes));
        return bytes;
    }

    it('refuses a file that is too short to hold a header', () => {
        expect(() => readIco(new Uint8Array([0, 0, 1]))).toThrow(/too short|not an icon/i);
    });

    it.each([
        ['a string', 'favicon.ico'],
        ['null', null],
        ['an empty buffer', new Uint8Array(0)],
    ])('refuses %s', (_label, input) => {
        expect(() => readIco(input)).toThrow();
    });

    it('refuses a non-zero reserved word', () => {
        expect(() => readIco(corrupted((_bytes, data) => data.setUint16(0, 1, true))))
            .toThrow(/reserved/i);
    });

    it('refuses a cursor, which is type 2', () => {
        expect(() => readIco(corrupted((_bytes, data) => data.setUint16(2, 2, true))))
            .toThrow(/type/i);
    });

    it('refuses a directory with no entries', () => {
        const empty = new Uint8Array(HEADER_BYTES);
        new DataView(empty.buffer).setUint16(2, 1, true);

        expect(() => readIco(empty)).toThrow(/no entries|empty/i);
    });

    it('refuses a directory the file is too short to contain', () => {
        const truncated = threeSizes().slice(0, HEADER_BYTES + ENTRY_BYTES);

        expect(() => readIco(truncated)).toThrow();
    });

    it('refuses an entry that reaches past the end of the file', () => {
        expect(() => readIco(corrupted((_bytes, data) => data.setUint32(HEADER_BYTES + 8, 1_000_000, true))))
            .toThrow(/outside|past the end|beyond/i);
    });

    it('refuses an offset that starts past the end of the file', () => {
        expect(() => readIco(corrupted((_bytes, data) => data.setUint32(HEADER_BYTES + 12, 5_000_000, true))))
            .toThrow(/outside|past the end|beyond/i);
    });

    it('refuses two payloads that overlap', () => {
        const bytes = corrupted((_bytes, data) => {
            // The second entry is pointed one byte into the first payload.
            data.setUint32(HEADER_BYTES + ENTRY_BYTES + 12, HEADER_BYTES + 48 + 1, true);
        });

        expect(() => readIco(bytes)).toThrow(/overlap/i);
    });

    it('refuses a payload that starts inside the directory', () => {
        expect(() => readIco(corrupted((_bytes, data) => data.setUint32(HEADER_BYTES + 12, 8, true))))
            .toThrow(/overlap|directory/i);
    });

    it('refuses a payload that is not a PNG', () => {
        const bytes = corrupted((raw) => {
            const offset = HEADER_BYTES + 48;
            // A BMP-style header where the signature should be. The old ICO
            // format carried these; this build writes PNG only, so a payload
            // that is not one is a file we did not write.
            raw.set([0x28, 0x00, 0x00, 0x00, 0x10, 0x00, 0x00, 0x00], offset);
        });

        expect(() => readIco(bytes)).toThrow(/png/i);
    });

    it('refuses an offset that is one byte wrong', () => {
        const bytes = corrupted((_bytes, data) => {
            data.setUint32(HEADER_BYTES + 12, HEADER_BYTES + 48 + 1, true);
        });

        expect(() => readIco(bytes)).toThrow();
    });

    it('refuses a payload whose IHDR disagrees with the directory', () => {
        // The directory claims 32; the payload is the 16-pixel PNG.
        const bytes = buildIco([{ size: 32, png: png16 }]);

        expect(() => readIco(bytes)).toThrow(/16|dimension|size/i);
    });

    it('refuses a directory dimension that disagrees with a 256-pixel payload', async () => {
        const png256 = await pngOf(256);

        expect(() => readIco(buildIco([{ size: 48, png: png256 }]))).toThrow(/256|dimension|size/i);
    }, 30_000);

    it('names the entry it is complaining about', () => {
        const bytes = buildIco([{ size: 16, png: png16 }, { size: 32, png: png16 }]);

        expect(() => readIco(bytes)).toThrow(/32/);
    });

    it('throws a plain Error, never something with a stack trace in its message', () => {
        const thrown = (() => {
            try {
                readIco(new Uint8Array(2));
                return null;
            } catch (error) {
                return error;
            }
        })();

        expect(thrown).toBeInstanceOf(Error);
        expect(thrown.message).not.toContain('\n');
        expect(thrown.message.length).toBeLessThan(200);
    });
});
