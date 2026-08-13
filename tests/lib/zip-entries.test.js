import JSZip from 'jszip';
import { beforeAll, describe, expect, it } from 'vitest';

import { readZipEntries } from '@/tests/helpers/zip-entries';

/**
 * The bulk result panel maps these entries back onto the uploaded files by
 * position, so order and count matter as much as the sizes do.
 */
function bytes(length, seed = 7) {
    const out = new Uint8Array(length);
    for (let i = 0; i < length; i += 1) out[i] = (i * seed) % 251;
    return out;
}

describe('readZipEntries', () => {
    let archive;

    beforeAll(async () => {
        const zip = new JSZip();
        zip.file('resizo-one-800x600.jpg', bytes(4096, 3));
        zip.file('resizo-two-400x400.png', bytes(1500, 11));
        zip.file('resizo-thrée-100x100.webp', bytes(64, 17));
        archive = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    });

    it('reads every entry in the order it was added', () => {
        const entries = readZipEntries(archive);

        expect(entries.map((entry) => entry.name)).toEqual([
            'resizo-one-800x600.jpg',
            'resizo-two-400x400.png',
            'resizo-thrée-100x100.webp',
        ]);
    });

    it('reports the uncompressed size of each entry', () => {
        const entries = readZipEntries(archive);

        expect(entries.map((entry) => entry.size)).toEqual([4096, 1500, 64]);
    });

    it('reports the compressed size separately', () => {
        const entries = readZipEntries(archive);

        for (const entry of entries) {
            expect(entry.compressedSize).toBeGreaterThan(0);
            expect(Number.isFinite(entry.compressedSize)).toBe(true);
        }
    });

    it('accepts an ArrayBuffer as well as a view', () => {
        const view = new Uint8Array(archive);
        const copy = view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength);

        expect(readZipEntries(copy)).toEqual(readZipEntries(archive));
    });

    it('honours the byteOffset of a view into a larger buffer', () => {
        const padded = new Uint8Array(archive.length + 32);
        padded.set(new Uint8Array(archive), 16);
        const framed = new Uint8Array(padded.buffer, 16, archive.length);

        expect(readZipEntries(framed).map((entry) => entry.size)).toEqual([4096, 1500, 64]);
    });

    it('omits directory entries', async () => {
        const zip = new JSZip();
        zip.folder('nested').file('inner.jpg', bytes(128));
        const withFolder = await zip.generateAsync({ type: 'nodebuffer' });

        expect(readZipEntries(withFolder)).toEqual([
            { name: 'nested/inner.jpg', size: 128, compressedSize: expect.any(Number) },
        ]);
    });

    it('reads an archive that carries a trailing comment', async () => {
        const zip = new JSZip();
        zip.file('only.jpg', bytes(256));
        const commented = await zip.generateAsync({ type: 'nodebuffer', comment: 'resizo'.repeat(40) });

        expect(readZipEntries(commented).map((entry) => entry.name)).toEqual(['only.jpg']);
    });

    it('returns an empty list for an empty archive', async () => {
        const empty = await new JSZip().generateAsync({ type: 'nodebuffer' });

        expect(readZipEntries(empty)).toEqual([]);
    });

    it.each([
        ['null', null],
        ['undefined', undefined],
        ['a string', 'not a zip'],
        ['a number', 42],
        ['an empty buffer', new Uint8Array(0)],
        ['a short buffer', new Uint8Array(8)],
        ['random bytes', bytes(512, 5)],
    ])('returns an empty list rather than throwing for %s', (_label, input) => {
        expect(readZipEntries(input)).toEqual([]);
    });

    it('stops cleanly when the central directory is truncated', () => {
        const truncated = new Uint8Array(archive).slice(0, archive.length - 40);
        // The end-of-central-directory record is gone, so there is nothing to read.
        expect(readZipEntries(truncated)).toEqual([]);
    });

    it('stops cleanly when the directory offset points past the end', () => {
        const corrupted = new Uint8Array(archive);
        const view = new DataView(corrupted.buffer);
        const eocd = corrupted.length - EOCD_SIZE_FOR_TEST(corrupted);
        view.setUint32(eocd + 16, corrupted.length + 1000, true);

        expect(readZipEntries(corrupted)).toEqual([]);
    });
});

/** Locates the end-of-central-directory record the same way the reader does. */
function EOCD_SIZE_FOR_TEST(buffer) {
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    for (let offset = buffer.length - 22; offset >= 0; offset -= 1) {
        if (view.getUint32(offset, true) === 0x06054b50) return buffer.length - offset;
    }
    throw new Error('no end-of-central-directory record in the fixture');
}
