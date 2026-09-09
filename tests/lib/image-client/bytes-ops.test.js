/**
 * The two byte-only ops on the wire — 'dpi' and 'strip'.
 *
 * lib/image-client/dpi.js and lib/image-client/metadata-strip.js are proved in
 * their own suites. This file is about the seam that makes them reachable: the
 * registry in operations.js. A byte-only op takes the same intake as an image
 * op — is it a file, is it under the size cap, do its magic bytes match the
 * op's accept list — but it never asks the pixel gate anything, because no
 * pixel is ever allocated: the whole job is a header edit. And its result has
 * to carry the fields the panels read (dpi / inserted / changed for one,
 * detected / removed / kept for the other) through the generic result shape,
 * which strips every field it does not know about.
 */
import sharp from 'sharp';
import { beforeAll, describe, expect, it } from 'vitest';

import { DPI_INPUT_FORMATS, MAX_FILE_SIZE, METADATA_INPUT_FORMATS } from '@/lib/limits';
import { installBrowserEnv } from './helpers/browser-env';

let runOperation;
let CLIENT_OPS;

beforeAll(async () => {
    installBrowserEnv();
    ({ runOperation, CLIENT_OPS } = await import('@/lib/image-client/operations'));
});

async function jpegAt(density) {
    return sharp({ create: { width: 60, height: 40, channels: 3, background: '#8a4d2b' } })
        .jpeg({ quality: 80 })
        .withMetadata({ density })
        .toBuffer();
}

async function pngAt(density) {
    return sharp({ create: { width: 60, height: 40, channels: 4, background: { r: 20, g: 60, b: 120, alpha: 0.5 } } })
        .png()
        .withMetadata({ density })
        .toBuffer();
}

async function jpegWithExif() {
    return sharp({ create: { width: 60, height: 40, channels: 3, background: '#4d8a2b' } })
        .jpeg({ quality: 80 })
        .withExif({ IFD0: { Copyright: 'fixture', Software: 'vitest' } })
        .toBuffer();
}

function fileOf(bytes, name, type) {
    return new File([bytes], name, { type });
}

describe('the registry', () => {
    it('lists both byte-only ops beside the image ops', () => {
        expect(CLIENT_OPS).toEqual(expect.arrayContaining(['dpi', 'strip']));
    });

    it('reads its accept lists from lib/limits.js, not a copy', () => {
        expect(DPI_INPUT_FORMATS).toEqual(['jpeg', 'png']);
        expect(METADATA_INPUT_FORMATS).toEqual(['jpeg', 'png', 'webp']);
    });
});

describe("'dpi' on the wire", () => {
    it('rewrites a JPEG and passes the before/after reading through the result', async () => {
        const result = await runOperation('dpi', fileOf(await jpegAt(144), 'scan.jpg', 'image/jpeg'), {
            dpi: 300,
            sourceWidth: 60,
            sourceHeight: 40,
        });

        expect(result.operation).toBe('dpi');
        expect(result.format).toBe('jpeg');
        expect(result.filename).toMatch(/^resizo-dpi.*\.jpe?g$/);
        expect(result.width).toBe(60);
        expect(result.height).toBe(40);
        expect(result.dpi.before.dpi).toEqual({ x: 144, y: 144 });
        expect(result.dpi.after.dpi).toEqual({ x: 300, y: 300 });
        expect(Array.isArray(result.changed)).toBe(true);
        expect(typeof result.inserted).toBe('boolean');
        expect(result.resultBytes).toBe(result.blob.size);

        const written = Buffer.from(await result.blob.arrayBuffer());
        expect((await sharp(written).metadata()).density).toBe(300);
    });

    it('rewrites a PNG the same way', async () => {
        const result = await runOperation('dpi', fileOf(await pngAt(72), 'chart.png', 'image/png'), { dpi: 300 });

        expect(result.format).toBe('png');
        expect(result.dpi.after.dpi).toEqual({ x: 300, y: 300 });
        const written = Buffer.from(await result.blob.arrayBuffer());
        expect((await sharp(written).metadata()).density).toBe(300);
    });

    it('refuses a WebP by the accept list, in the panel’s own words', async () => {
        const webp = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#000' } }).webp().toBuffer();

        await expect(runOperation('dpi', fileOf(webp, 'x.webp', 'image/webp'), { dpi: 300 }))
            .rejects.toMatchObject({ code: 'invalid-type', message: expect.stringMatching(/JPEG or PNG/) });
    });

    it('refuses an empty file and a file over the size cap before reading a header', async () => {
        await expect(runOperation('dpi', fileOf(new Uint8Array(0), 'empty.jpg', 'image/jpeg'), { dpi: 300 }))
            .rejects.toMatchObject({ code: 'invalid-file' });

        const huge = { size: MAX_FILE_SIZE + 1, name: 'huge.jpg', type: 'image/jpeg', slice: () => new Blob([]) };
        await expect(runOperation('dpi', huge, { dpi: 300 })).rejects.toMatchObject({ code: 'invalid-file' });
    });

    it('surfaces the module’s own refusal of a bad DPI', async () => {
        await expect(runOperation('dpi', fileOf(await jpegAt(72), 'scan.jpg', 'image/jpeg'), { dpi: 0 }))
            .rejects.toMatchObject({ code: expect.stringMatching(/invalid/) });
    });
});

describe("'strip' on the wire", () => {
    it('removes the blocks and passes the three lists through the result', async () => {
        const source = await jpegWithExif();
        const result = await runOperation('strip', fileOf(source, 'photo.jpg', 'image/jpeg'), {
            sourceWidth: 60,
            sourceHeight: 40,
        });

        expect(result.operation).toBe('strip');
        expect(result.filename).toMatch(/^resizo-clean.*\.jpe?g$/);
        expect(result.detected.map((entry) => entry.id)).toContain('exif');
        expect(result.removed.map((entry) => entry.id)).toContain('exif');
        expect(Array.isArray(result.kept)).toBe(true);
        expect(result.resultBytes).toBeLessThan(source.length);

        const written = Buffer.from(await result.blob.arrayBuffer());
        expect((await sharp(written).metadata()).exif).toBeUndefined();
    });

    it('accepts a WebP, which the DPI op does not', async () => {
        const webp = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#000' } }).webp().toBuffer();
        const result = await runOperation('strip', fileOf(webp, 'x.webp', 'image/webp'), {});

        expect(result.format).toBe('webp');
        expect(result.removed).toEqual([]);
    });

    it('refuses a GIF by the accept list', async () => {
        const gif = Buffer.from('GIF89a' + '\0'.repeat(20), 'binary');

        await expect(runOperation('strip', fileOf(gif, 'x.gif', 'image/gif'), {}))
            .rejects.toMatchObject({ code: 'invalid-type', message: expect.stringMatching(/JPEG, PNG, or WebP/) });
    });
});
