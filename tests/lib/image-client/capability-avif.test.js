/**
 * The two things the memory gate had no way to express before AVIF: a format
 * the browser may not be able to OPEN at all, and an encoder whose cost is not
 * a multiple of the surface it is handed.
 *
 * WHY A CAPABILITY PROBE. `nativeDownscaleSupported()` is not a format check —
 * it only says the native lane exists — so it keeps returning true on a Safari
 * 16.0 that cannot read an AVIF. Per-format support can only be discovered by
 * attempting a decode, so the probe attempts one, on a 301-byte file, once per
 * session.
 *
 * WHY A PER-FORMAT ENCODE COST. Until now the model priced a job by pixel count
 * and stage shape and never by codec, and that was right: MozJPEG, libwebp and
 * the PNG encoder all cost roughly two surfaces plus a working set. libavif
 * does not. Measured 2026-09-11 on four sources: 25.9 MB of WebAssembly heap
 * per megapixel at 1.7 MP, 27.4 at 12 MP, 27.2 at 24 MP — on TOP of the input
 * copies, and it never comes back. A 12 MP AVIF encode grows the heap to 345 MB
 * where the unmodified model would have quoted about 150 MB.
 */
import { describe, expect, it } from 'vitest';

import {
    assessJob,
    assessPixels,
    canDecodeAvif,
    estimatePeakBytes,
    outputExpansionFor,
    resetAvifDecodeProbe,
    ENCODE_BYTES_PER_PIXEL_BY_FORMAT,
    OUTPUT_EXPANSION_BY_FORMAT,
} from '@/lib/image-client/capability';

/** A device with room to spare, so a refusal is always about the estimate. */
const roomy = {
    memoryGb: 8,
    cores: 8,
    ios: false,
    wasm: true,
    nativeDownscale: true,
};

/* ------------------------------------------------------------------ *
 * 1. Can this browser open an AVIF at all
 * ------------------------------------------------------------------ */

describe('canDecodeAvif', () => {
    it('is false where the browser has no createImageBitmap at all', async () => {
        resetAvifDecodeProbe();
        expect(await canDecodeAvif()).toBe(false);
    });

    it('is false when the decoder rejects the probe, and says so without throwing', async () => {
        resetAvifDecodeProbe();
        globalThis.createImageBitmap = async () => { throw new Error('no AVIF here'); };

        try {
            expect(await canDecodeAvif()).toBe(false);
        } finally {
            delete globalThis.createImageBitmap;
        }
    });

    it('is true when the decoder returns a bitmap of the probe’s own size', async () => {
        resetAvifDecodeProbe();
        globalThis.createImageBitmap = async () => ({ width: 2, height: 2, close() {} });

        try {
            expect(await canDecodeAvif()).toBe(true);
        } finally {
            delete globalThis.createImageBitmap;
        }
    });

    /**
     * A decoder that hands back a 0x0 bitmap has not decoded anything. libheif
     * does exactly that for an AV1 payload it cannot read — it parses the
     * container, reports success and returns a blank canvas — so the size is
     * checked rather than the absence of a rejection.
     */
    it('is false for a decoder that answers with an empty bitmap', async () => {
        resetAvifDecodeProbe();
        globalThis.createImageBitmap = async () => ({ width: 0, height: 0, close() {} });

        try {
            expect(await canDecodeAvif()).toBe(false);
        } finally {
            delete globalThis.createImageBitmap;
        }
    });

    it('decodes the probe once and remembers the answer', async () => {
        resetAvifDecodeProbe();
        let calls = 0;
        globalThis.createImageBitmap = async () => {
            calls += 1;
            return { width: 2, height: 2, close() {} };
        };

        try {
            await Promise.all([canDecodeAvif(), canDecodeAvif()]);
            await canDecodeAvif();
            expect(calls).toBe(1);
        } finally {
            delete globalThis.createImageBitmap;
        }
    });

    it('hands the decoder a real AVIF, not a made-up blob', async () => {
        resetAvifDecodeProbe();
        let seen = null;
        globalThis.createImageBitmap = async (blob) => {
            seen = new Uint8Array(await blob.arrayBuffer());
            return { width: 2, height: 2, close() {} };
        };

        try {
            await canDecodeAvif();
        } finally {
            delete globalThis.createImageBitmap;
        }

        const { readAvifHeader } = await import('@/lib/image-client/avif');
        expect(readAvifHeader(seen)).toMatchObject({ brand: 'avif', width: 2, height: 2 });
    });
});

/* ------------------------------------------------------------------ *
 * 2. What an AVIF encode costs
 * ------------------------------------------------------------------ */

describe('the AVIF encode stage in the memory model', () => {
    it('carries the measured heap figure, and only for AVIF', () => {
        expect(ENCODE_BYTES_PER_PIXEL_BY_FORMAT.avif).toBe(30);
        expect(ENCODE_BYTES_PER_PIXEL_BY_FORMAT.jpeg).toBeUndefined();
        expect(ENCODE_BYTES_PER_PIXEL_BY_FORMAT.webp).toBeUndefined();
        expect(ENCODE_BYTES_PER_PIXEL_BY_FORMAT.png).toBeUndefined();
    });

    /**
     * The default is today's number for every existing caller. Nothing that
     * does not name an output format pays for one.
     */
    it('changes nothing for a caller that names no output format', () => {
        const shared = { sourceWidth: 2000, sourceHeight: 1500, operation: 'convert' };

        expect(estimatePeakBytes(shared)).toBe(estimatePeakBytes({ ...shared, outputFormat: null }));
        expect(estimatePeakBytes(shared)).toBe(estimatePeakBytes({ ...shared, outputFormat: 'jpeg' }));
        expect(estimatePeakBytes(shared)).toBe(estimatePeakBytes({ ...shared, outputFormat: 'webp' }));
    });

    it('charges an AVIF output 30 bytes a pixel more than the same job in JPEG', () => {
        const shared = { sourceWidth: 2000, sourceHeight: 1500, operation: 'convert' };

        const jpeg = estimatePeakBytes({ ...shared, outputFormat: 'jpeg' });
        const avif = estimatePeakBytes({ ...shared, outputFormat: 'avif' });

        expect(avif - jpeg).toBe(2000 * 1500 * 30);
    });

    /**
     * The encoder is handed the OUTPUT picture, so that is what it is charged
     * for. An upscale is the case that proves it: the source surface is a
     * rounding error and the encode stage is the whole peak.
     */
    it('charges the output picture, not the source', () => {
        const shared = {
            sourceWidth: 500,
            sourceHeight: 400,
            targetWidth: 2000,
            targetHeight: 1600,
            operation: 'resize',
        };

        const jpeg = estimatePeakBytes({ ...shared, outputFormat: 'jpeg' });
        const avif = estimatePeakBytes({ ...shared, outputFormat: 'avif' });

        expect(avif - jpeg).toBe(2000 * 1600 * 30);
    });

    /**
     * And the charge does not leak into a peak that is somewhere else. A 12 MP
     * photo resized down to 1000 px holds two 12 MP surfaces during the decode
     * — 96 MB — which is far more than the encode of a 0.75 MP output costs
     * even with libavif's heap on top. The model takes the largest STAGE, not
     * the sum, so this job is quoted the same number whichever format it
     * writes. That is the honest answer: the surfaces really are gone before
     * the encoder allocates.
     */
    it('does not raise a quote whose peak is the decode stage', () => {
        const shared = {
            sourceWidth: 4000,
            sourceHeight: 3000,
            targetWidth: 1000,
            targetHeight: 750,
            operation: 'resize',
        };

        expect(estimatePeakBytes({ ...shared, outputFormat: 'avif' }))
            .toBe(estimatePeakBytes({ ...shared, outputFormat: 'jpeg' }));
    });

    /** A job that encodes nothing pays nothing, whatever it claims to output. */
    it('charges nothing on an operation with no encode stage', () => {
        const shared = { sourceWidth: 3000, sourceHeight: 2000, operation: 'decode' };

        expect(estimatePeakBytes({ ...shared, outputFormat: 'avif' })).toBe(estimatePeakBytes(shared));
    });

    it('reaches the gate, so a phone is refused before the tab is killed', () => {
        const small = { memoryGb: 2, cores: 4, ios: true, wasm: true, nativeDownscale: true };
        const job = {
            sourceWidth: 4000,
            sourceHeight: 3000,
            operation: 'convert',
            device: small,
        };

        expect(assessPixels(job).ok).toBe(true);

        const avif = assessPixels({ ...job, outputFormat: 'avif' });
        expect(avif.ok).toBe(false);
        expect(avif.code).toBe('not-enough-memory');
        expect(avif.reason).toContain('memory');
    });

    /**
     * The front door, which is what the tool pages and the hooks call. A number
     * the model knows and the gate never receives is a number that changes
     * nothing, so it is pinned at the level a page actually reaches.
     */
    it('reaches assessJob, the gate a page runs before anything is allocated', () => {
        const phone = { memoryGb: 2, cores: 4, ios: true, wasm: true, nativeDownscale: true };
        const file = { name: 'photo.jpg', type: 'image/jpeg', size: 3_000_000, arrayBuffer: async () => new ArrayBuffer(0) };
        const job = {
            operation: 'convert',
            sourceWidth: 4000,
            sourceHeight: 3000,
            device: phone,
        };

        expect(assessJob(file, job).ok).toBe(true);

        const avif = assessJob(file, { ...job, outputFormat: 'avif' });
        expect(avif.ok).toBe(false);
        expect(avif.code).toBe('not-enough-memory');
    });

    it('still lets an ordinary photo through as an AVIF on a roomy device', () => {
        expect(assessPixels({
            sourceWidth: 1600,
            sourceHeight: 1067,
            operation: 'convert',
            outputFormat: 'avif',
            device: roomy,
        }).ok).toBe(true);
    });
});

/* ------------------------------------------------------------------ *
 * 3. What an AVIF costs an archive
 * ------------------------------------------------------------------ */

describe('the archive expansion factor', () => {
    /**
     * Measured rather than assumed: q80 AVIF of the 1.7 MP bench photo is
     * 56,316 bytes against the 84,376-byte JPEG it came from, so the honest
     * ratio is under 1. WebP's 1.3 is used instead, for the same reason the
     * others are rounded up — this factor is the early warning, and the running
     * ceiling in lib/upload/bulk-batch.js is the guarantee.
     */
    it('prices AVIF like WebP rather than like an unknown format', () => {
        expect(OUTPUT_EXPANSION_BY_FORMAT.avif).toBe(1.3);
        expect(outputExpansionFor('avif')).toBe(1.3);
        expect(outputExpansionFor('AVIF')).toBe(1.3);
    });
});
