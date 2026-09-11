/**
 * Writing an AVIF: the encoder entry in lib/image-client/encode.js.
 *
 * The pixels here are real and so is the codec — @jsquash/avif 2.1.1, the same
 * single-threaded build the site serves — and sharp reads every output back as
 * the independent witness, exactly as the other encoder tests do.
 *
 * WHAT THE NUMBERS IN THIS FILE COME FROM. A Node matrix run on 2026-09-11 (M1
 * Pro, sharp 0.35.3 / libvips 8.18.3 as the reference decoder) measured the
 * encoder across four sources, four speeds and twenty-one quality steps. The
 * three findings the code depends on:
 *
 *   SPEED 9. Speed 10 is byte-identical to 9 on every source tested, so there
 *   is nothing above it to win. Speed 8 is DOMINATED on the 1.7 MP photo — 240
 *   ms for 33,739 bytes against 135 ms for 22,924 — and speed 7 is 8-15x
 *   slower (2.0 s at 1.7 MP) for a file 12-24% smaller. On a phone that is the
 *   difference between a tool and a hang.
 *
 *   QUALITY IS MONOTONIC. Zero inversions over 20 steps on both bench sources,
 *   at speed 9 and at speed 7. That is what makes the slider honest, and it is
 *   recorded here rather than in /compress because /compress does not offer
 *   AVIF: a byte target means up to eight encodes against a 20 s deadline, and
 *   libavif has no rate controller to do it in one.
 *
 *   ALPHA IS KEPT AND IS LOSSY. Transparency survives as a second monochrome
 *   item at the same quality; at the package default qualityAlpha the largest
 *   error measured on a ramp was 15/255, and pixels that were fully clear
 *   stayed fully clear. The default is kept, so a logo's hole is still a hole.
 */
import sharp from 'sharp';
import { beforeAll, describe, expect, it } from 'vitest';

import { DEFAULT_QUALITY } from '@/lib/limits';
import { readAvifHeader } from '@/lib/image-client/avif';
import { installBrowserEnv } from './helpers/browser-env';

let encodeImageData;
let AVIF_ENCODE_SPEED;

beforeAll(async () => {
    installBrowserEnv();
    ({ encodeImageData, AVIF_ENCODE_SPEED } = await import('@/lib/image-client/encode'));
});

/** A noisy gradient, so quality has something to throw away. */
function noisyImageData(width, height, { alpha = false } = {}) {
    const data = new Uint8ClampedArray(width * height * 4);

    for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
            const at = (y * width + x) * 4;
            data[at] = (x * 7 + y * 3) % 256;
            data[at + 1] = (x * 3 + y * 11) % 256;
            data[at + 2] = (x * 13 + y * 5) % 256;
            data[at + 3] = alpha ? (x < width / 3 ? 0 : Math.min(255, x * 4)) : 255;
        }
    }

    return new ImageData(data, width, height);
}

/* ------------------------------------------------------------------ *
 * 1. It writes a real AVIF
 * ------------------------------------------------------------------ */

describe('an AVIF encode', () => {
    it('produces bytes libvips reads back at the right size, under the right type', async () => {
        const result = await encodeImageData(noisyImageData(120, 90), { format: 'avif', quality: 80 });
        const meta = await sharp(Buffer.from(await result.blob.arrayBuffer())).metadata();

        expect(result.format).toBe('avif');
        expect(result.type).toBe('image/avif');
        expect(result.bytes).toBeGreaterThan(0);
        expect(meta.width).toBe(120);
        expect(meta.height).toBe(90);
    }, 60_000);

    /**
     * The container is checked as well as the picture, because "sharp read it"
     * would also be true of a HEIC: both are ISOBMFF and libheif opens either.
     * The brand is what says which one this is.
     */
    it('writes the avif brand, not a HEIC that happens to decode', async () => {
        const result = await encodeImageData(noisyImageData(64, 48), { format: 'avif', quality: 60 });
        const header = readAvifHeader(new Uint8Array(await result.blob.arrayBuffer()));

        expect(header.brand).toBe('avif');
        expect(header.animated).toBe(false);
        expect(header).toMatchObject({ width: 64, height: 48 });
    }, 60_000);

    it('reports the quality it used and says the dial was live', async () => {
        const result = await encodeImageData(noisyImageData(64, 48), { format: 'avif', quality: 55 });

        expect(result.quality).toBe(55);
        expect(result.qualityApplied).toBe(true);
    }, 60_000);

    it('falls back to the shared default quality when none is asked for', async () => {
        expect((await encodeImageData(noisyImageData(48, 48), { format: 'avif' })).quality)
            .toBe(DEFAULT_QUALITY);
    }, 60_000);
});

/* ------------------------------------------------------------------ *
 * 2. The settings the bench chose
 * ------------------------------------------------------------------ */

describe('the encoder settings', () => {
    it('is pinned to the measured speed', () => {
        expect(AVIF_ENCODE_SPEED).toBe(9);
    });

    /**
     * The one property a slider needs in order not to lie to a person. Four
     * steps rather than the bench's twenty-one, because this is a regression
     * guard on the option plumbing, not a re-run of the measurement.
     */
    it('writes fewer bytes at a lower quality, on the same pixels', async () => {
        const pixels = noisyImageData(96, 72);
        const sizes = [];

        for (const quality of [20, 45, 70, 95]) {
            sizes.push((await encodeImageData(pixels, { format: 'avif', quality })).bytes);
        }

        for (let index = 1; index < sizes.length; index += 1) {
            expect(sizes[index], `q${index} is not larger than the step below it`)
                .toBeGreaterThan(sizes[index - 1]);
        }
    }, 120_000);

    /**
     * The package default subsample is 1, which libavif writes as 4:2:0. It is
     * left alone — 4:4:4 cost 4% more bytes on the bench photo for a difference
     * a viewer cannot see — and the header reader reports it so page copy can
     * name it truthfully instead of guessing.
     */
    it('writes 4:2:0 chroma at 8 bits, which is what the pages say', async () => {
        const result = await encodeImageData(noisyImageData(64, 64), { format: 'avif', quality: 70 });
        const header = readAvifHeader(new Uint8Array(await result.blob.arrayBuffer()));

        expect(header.chroma).toBe('4:2:0');
        expect(header.bitDepth).toBe(8);
    }, 60_000);
});

/* ------------------------------------------------------------------ *
 * 3. Transparency
 * ------------------------------------------------------------------ */

describe('transparency through the AVIF encoder', () => {
    it('keeps an alpha channel libvips can see', async () => {
        const result = await encodeImageData(noisyImageData(90, 60, { alpha: true }), {
            format: 'avif',
            quality: 75,
        });
        const buffer = Buffer.from(await result.blob.arrayBuffer());
        const meta = await sharp(buffer).metadata();

        expect(meta.hasAlpha).toBe(true);
        expect(readAvifHeader(buffer).alpha).toBe(true);
    }, 60_000);

    it('leaves a fully clear pixel fully clear', async () => {
        const result = await encodeImageData(noisyImageData(90, 60, { alpha: true }), {
            format: 'avif',
            quality: 75,
        });
        const raw = await sharp(Buffer.from(await result.blob.arrayBuffer()))
            .ensureAlpha()
            .raw()
            .toBuffer();

        expect(raw[3]).toBe(0);
    }, 60_000);

    /**
     * An opaque picture gets no alpha item at all, which is what the output
     * validator in operations.js asserts in the other direction: an alpha item
     * where the source had none would mean the encoder invented a plane.
     */
    it('writes no alpha item for an opaque picture', async () => {
        const result = await encodeImageData(noisyImageData(64, 48), { format: 'avif', quality: 70 });
        const buffer = Buffer.from(await result.blob.arrayBuffer());

        expect(readAvifHeader(buffer).alpha).toBe(false);
        expect((await sharp(buffer).metadata()).hasAlpha).toBe(false);
    }, 60_000);
});

/* ------------------------------------------------------------------ *
 * 4. Metadata, and the heap reading the worker recycle depends on
 * ------------------------------------------------------------------ */

describe('what the encoder does not carry over', () => {
    it('writes no Exif item, no XMP item and no ICC profile', async () => {
        const result = await encodeImageData(noisyImageData(64, 48), { format: 'avif', quality: 70 });
        const header = readAvifHeader(new Uint8Array(await result.blob.arrayBuffer()));

        expect(header.hasExif).toBe(false);
        expect(header.hasXmp).toBe(false);
        expect(header.hasIcc).toBe(false);
    }, 60_000);

    /**
     * libavif's heap never shrinks. It is reported so client.js can recycle the
     * worker after a large encode rather than carrying 345 MB of dead heap into
     * the next job; every other format reports null, because nothing about them
     * grows a WASM heap that outlives the call.
     */
    it('reports the encoder heap for AVIF and nothing for the others', async () => {
        const avif = await encodeImageData(noisyImageData(64, 48), { format: 'avif', quality: 70 });
        const jpeg = await encodeImageData(noisyImageData(64, 48), { format: 'jpeg', quality: 70 });

        expect(avif.avifHeapBytes).toBeGreaterThan(0);
        expect(jpeg.avifHeapBytes).toBeNull();
    }, 60_000);
});
