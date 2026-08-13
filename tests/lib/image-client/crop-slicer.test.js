/**
 * The pixel slicer's own bounds guard.
 *
 * cropImageData checks the rectangle against the ImageData it was handed, and
 * that check is the LAST one — resolveCropRect has already refused anything the
 * page or the decoder could see was wrong. It looks redundant, and mutation
 * testing showed how thoroughly it is not tested: deleting the guard outright
 * left all 2484 tests green, including the end-to-end crop refusals in
 * hostile-inputs.test.js. Those go through runCrop, which re-runs
 * resolveCropRect against the decoded size and refuses there, so nothing had
 * ever reached the slicer with a rectangle it could not honour.
 *
 * WHY THE GUARD STILL EARNS ITS LINE. `Uint8ClampedArray.subarray` CLAMPS
 * rather than throwing. A row read past the end of the buffer comes back short,
 * `output.set` writes fewer bytes than the row is wide, and the result is a
 * perfectly well-formed ImageData of the requested size with transparent black
 * where the picture ran out. No exception, no error message — a downloaded file
 * with a black band across it. That is the failure this guard exists to turn
 * into a refusal, and it is the failure a future caller inherits the moment one
 * reaches the slicer without going through runCrop. The engine already has a
 * second caller: the cover-crop stage in lib/image-client/operations.js, whose
 * rectangle is safe only because centreCropRect clamps it.
 *
 * So this file tests the slicer directly, which is the only way to reach the
 * branch at all. The job-level refusals belong to hostile-inputs.test.js and are
 * not repeated here.
 */
import sharp from 'sharp';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { installBrowserEnv } from './helpers/browser-env';
import { splitRedBlueJpegPlain } from './helpers/fixtures';

const SOURCE = { width: 120, height: 80 };

let JobError;
let cropImageData;
let runOperation;
let decodeModule;

beforeAll(async () => {
    installBrowserEnv();
    ({ cropImageData } = await import('@/lib/image-client/crop'));
    ({ runOperation, JobError } = await import('@/lib/image-client/operations'));
    decodeModule = await import('@/lib/image-client/decode');
});

/** A fully painted surface, so a clamped read shows up as unpainted bytes. */
function paintedImageData(width, height) {
    const data = new Uint8ClampedArray(width * height * 4);
    for (let index = 0; index < width * height; index += 1) {
        data[index * 4] = 200;
        data[index * 4 + 1] = 40;
        data[index * 4 + 2] = 80;
        data[index * 4 + 3] = 255;
    }
    return new ImageData(data, width, height);
}

describe('the slicer refuses a rectangle it cannot honour', () => {
    const pixels = () => paintedImageData(40, 30);

    it.each([
        ['one pixel too wide', { x: 0, y: 0, width: 41, height: 30 }],
        ['one pixel too tall', { x: 0, y: 0, width: 40, height: 31 }],
        ['pushed off the right edge by its origin', { x: 1, y: 0, width: 40, height: 30 }],
        ['pushed off the bottom edge by its origin', { x: 0, y: 1, width: 40, height: 30 }],
        ['far outside the image entirely', { x: 500, y: 500, width: 10, height: 10 }],
        ['a negative origin', { x: -1, y: 0, width: 10, height: 10 }],
        ['a zero width', { x: 0, y: 0, width: 0, height: 10 }],
        ['a zero height', { x: 0, y: 0, width: 10, height: 0 }],
    ])('throws rather than returning short rows for %s', (_label, rect) => {
        expect(() => cropImageData(pixels(), rect)).toThrow(/out of bounds|no pixels/i);
    });

    it('refuses before it can hand back a surface padded with black', () => {
        // The exact shape of the silent failure: 41 columns asked of a 40-column
        // image. Every row would lose its last pixel and the tail of the buffer
        // would stay at the zeroes it was allocated with.
        expect(() => cropImageData(pixels(), { x: 0, y: 0, width: 41, height: 30 }))
            .toThrow(/out of bounds/i);
    });

    it('returns every pixel of a rectangle that does fit', () => {
        const cropped = cropImageData(pixels(), { x: 5, y: 4, width: 20, height: 15 });

        expect({ width: cropped.width, height: cropped.height }).toEqual({ width: 20, height: 15 });
        expect(cropped.data.length).toBe(20 * 15 * 4);
        // The last pixel is painted, so nothing was left at the allocation's
        // zeroes — which is what a clamped read would have shown.
        expect(Array.from(cropped.data.slice(-4))).toEqual([200, 40, 80, 255]);
    });

    it('hands back the very same object when the rectangle is the whole image', () => {
        const source = pixels();
        expect(cropImageData(source, { x: 0, y: 0, width: 40, height: 30 })).toBe(source);
    });
});

describe('the early gate spares the decode', () => {
    /**
     * The first of the two checks exists for one reason: to refuse before a
     * surface is allocated. On a 12 MP photo that surface is 45 MB, and on a
     * phone it is the difference between an error message and a dead tab. The
     * refusal itself is pinned in hostile-inputs.test.js; what is pinned here is
     * that it happens BEFORE the decoder is asked for anything.
     */
    it('refuses an impossible rectangle without decoding the file', async () => {
        const decode = vi.spyOn(decodeModule, 'decodeToImageData');
        const downscale = vi.spyOn(decodeModule, 'decodeAndDownscale');

        try {
            const bytes = await splitRedBlueJpegPlain(SOURCE);
            const failure = await runOperation(
                'crop',
                new File([bytes], 'photo.jpg', { type: 'image/jpeg' }),
                {
                    x: '0',
                    y: '0',
                    width: String(SOURCE.width + 40),
                    height: String(SOURCE.height),
                    sourceWidth: SOURCE.width,
                    sourceHeight: SOURCE.height,
                },
            ).catch((error) => error);

            expect(failure).toBeInstanceOf(JobError);
            expect(failure.code).toBe('invalid-crop');
            expect(decode).not.toHaveBeenCalled();
            expect(downscale).not.toHaveBeenCalled();
        } finally {
            decode.mockRestore();
            downscale.mockRestore();
        }
    }, 30_000);

    it('still crops the rectangle that does fit, at exactly those dimensions', async () => {
        const bytes = await splitRedBlueJpegPlain(SOURCE);
        const result = await runOperation(
            'crop',
            new File([bytes], 'photo.jpg', { type: 'image/jpeg' }),
            { x: '10', y: '5', width: '60', height: '40', sourceWidth: SOURCE.width, sourceHeight: SOURCE.height },
        );

        expect(result.crop).toEqual({ x: 10, y: 5, width: 60, height: 40 });

        // Read back through an independent decoder, so the reported numbers are
        // not the only thing that agrees with itself.
        const back = await sharp(Buffer.from(await result.blob.arrayBuffer())).metadata();
        expect({ width: back.width, height: back.height }).toEqual({ width: 60, height: 40 });
    }, 30_000);
});
