/**
 * The bulk converter's per-file processor.
 *
 * A conversion is a claim about a file the visitor cannot open: "this is a
 * WebP now, it is still 2400 by 1600, and the transparency you had is still
 * there". Every one of those three is checkable from the finished bytes, and
 * none of them is taken from the engine that produced them — the row is only a
 * success when a header parser that never saw the request agrees.
 *
 * The failure this exists to catch is the quiet one: a blob called photo.webp
 * holding JPEG bytes, or a logo whose alpha channel was dropped on the way to
 * PNG. Both would download, both would open, and both would be wrong.
 *
 * The engine and the memory gate are injected. THE VERIFIER IS NOT: these tests
 * hand the processor real blobs holding real container headers and let the
 * shipped validator read them, because a mocked verifier proves only that the
 * processor can call a function.
 */
import { describe, expect, it, vi } from 'vitest';

import { BULK_CONVERT_OUTPUT_FORMATS, CONVERT_OUTPUT_FORMATS, DEFAULT_QUALITY as LIMITS_DEFAULT_QUALITY } from '@/lib/limits';
import { QUALITY_FORMATS as ENGINE_QUALITY_FORMATS } from '@/lib/image-client/encode';
import { readImageSize } from '@/lib/image-client/requirements';
import { STATUS, runBatch } from '@/lib/upload/batch';
import {
    DEFAULT_OUTPUT_FORMAT,
    DEFAULT_QUALITY,
    OUTPUT_FORMATS,
    QUALITY_FORMATS,
    ZIP_FILENAME,
    createConvertProcessor,
    failedMessage,
    flattenNote,
    keptNote,
    outputName,
    summarizeConversion,
    unverifiedMessage,
} from '@/lib/upload/convert-batch';

/* ------------------------------------------------------------------ *
 * Real container headers, built byte by byte.
 *
 * Nothing here encodes a picture: the processor only ever reads a header, so a
 * header is all these need to be. Every one of them is a file the shipped
 * sniffer and the shipped size reader accept.
 * ------------------------------------------------------------------ */

/** FF D8 FF, then an SOF0 frame carrying the two dimensions. */
function jpegBytes(width, height) {
    const bytes = new Uint8Array(20);
    bytes.set([0xFF, 0xD8, 0xFF, 0xC0, 0x00, 0x11, 0x08], 0);
    const view = new DataView(bytes.buffer);
    view.setUint16(7, height);
    view.setUint16(9, width);
    return bytes;
}

/** The 8-byte signature plus an IHDR. Colour type 6 is RGBA, 2 is truecolour. */
function pngBytes(width, height, { alpha = false } = {}) {
    const bytes = new Uint8Array(33);
    bytes.set([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A], 0);
    bytes.set([0, 0, 0, 13], 8);
    bytes.set([0x49, 0x48, 0x44, 0x52], 12);
    const view = new DataView(bytes.buffer);
    view.setUint32(16, width);
    view.setUint32(20, height);
    bytes[24] = 8;
    bytes[25] = alpha ? 6 : 2;
    return bytes;
}

/**
 * RIFF/WEBP. A picture with transparency is a VP8X whose flags byte has the
 * ALPHA bit set; an opaque one is a plain lossy VP8, which has no alpha flag at
 * all — which is exactly why the two are told apart here rather than assumed.
 */
function webpBytes(width, height, { alpha = false } = {}) {
    const bytes = new Uint8Array(30);
    const view = new DataView(bytes.buffer);
    bytes.set([0x52, 0x49, 0x46, 0x46], 0);
    view.setUint32(4, bytes.length - 8, true);
    bytes.set([0x57, 0x45, 0x42, 0x50], 8);

    if (alpha) {
        bytes.set([0x56, 0x50, 0x38, 0x58], 12);
        view.setUint32(16, 10, true);
        bytes[20] = 0x10;
        const canvas = (at, value) => {
            bytes[at] = (value - 1) & 0xFF;
            bytes[at + 1] = ((value - 1) >> 8) & 0xFF;
            bytes[at + 2] = ((value - 1) >> 16) & 0xFF;
        };
        canvas(24, width);
        canvas(27, height);
        return bytes;
    }

    bytes.set([0x56, 0x50, 0x38, 0x20], 12);
    view.setUint32(16, 10, true);
    bytes.set([0x9D, 0x01, 0x2A], 23);
    view.setUint16(26, width, true);
    view.setUint16(28, height, true);
    return bytes;
}

const WIDTH = 2400;
const HEIGHT = 1600;

function blobOf(bytes, type) {
    return new Blob([bytes], { type });
}

function jpegBlob(width = WIDTH, height = HEIGHT) {
    return blobOf(jpegBytes(width, height), 'image/jpeg');
}

function pngBlob({ width = WIDTH, height = HEIGHT, alpha = false } = {}) {
    return blobOf(pngBytes(width, height, { alpha }), 'image/png');
}

function webpBlob({ width = WIDTH, height = HEIGHT, alpha = false } = {}) {
    return blobOf(webpBytes(width, height, { alpha }), 'image/webp');
}

/** A transparent PNG, which is what makes the alpha rules reachable. */
function transparentSource(name = 'photo.png') {
    return new File([pngBytes(WIDTH, HEIGHT, { alpha: true })], name, { type: 'image/png' });
}

function opaqueSource(name = 'photo.jpg') {
    return new File([jpegBytes(WIDTH, HEIGHT)], name, { type: 'image/jpeg' });
}

/** A transparent source that is NOT a PNG, so png-out is a real conversion. */
function transparentWebpSource(name = 'logo.webp') {
    return new File([webpBytes(WIDTH, HEIGHT, { alpha: true })], name, { type: 'image/webp' });
}

function opaquePngSource(name = 'chart.png') {
    return new File([pngBytes(WIDTH, HEIGHT, { alpha: false })], name, { type: 'image/png' });
}

const ALLOWED = { ok: true };

/** The processor under test: engine scripted, memory gate open, verifier real. */
/**
 * The engine reports whether it decoded a see-through pixel. The scripted
 * engine answers from the source's own header here, which is what a real
 * decode would find for these fixtures: alpha in the container means alpha
 * in the pixels for every transparent fixture this file builds.
 */
async function transparentIn(file) {
    return readImageSize(new Uint8Array(await file.arrayBuffer()))?.hasAlpha === true;
}

function processorReturning(blob, seams = {}) {
    return createConvertProcessor({
        process: vi.fn(async (op, file) => ({ blob, format: 'whatever-the-engine-claims', transparent: await transparentIn(file) })),
        assess: vi.fn(() => ALLOWED),
        ...seams,
    });
}

function job(extra = {}) {
    return {
        file: transparentSource(),
        name: 'photo.png',
        outputFormat: 'webp',
        quality: DEFAULT_QUALITY,
        background: 'white',
        sourceWidth: WIDTH,
        sourceHeight: HEIGHT,
        format: 'png',
        ...extra,
    };
}

/* ------------------------------------------------------------------ *
 * The constants and the sentences
 * ------------------------------------------------------------------ */

describe('the converter’s constants', () => {
    /**
     * The bulk list is NARROWER than /convert's, and AVIF is the whole gap.
     * One AVIF encode is fine; twenty in a row on a phone are not proven safe,
     * because libavif's WebAssembly heap never shrinks between files — measured
     * at 27.4 MB per megapixel and still resident when the next file starts.
     * AVIF output is offered on /convert, where one file is one encode and the
     * worker is thrown away after it.
     */
    it('offers the three formats a batch of twenty can safely write', () => {
        expect(OUTPUT_FORMATS).toEqual(BULK_CONVERT_OUTPUT_FORMATS);
        expect(OUTPUT_FORMATS).toEqual(['jpeg', 'png', 'webp']);
        expect(OUTPUT_FORMATS).toContain(DEFAULT_OUTPUT_FORMAT);
        expect(DEFAULT_OUTPUT_FORMAT).toBe('webp');
    });

    it('keeps AVIF off the bulk chips while /convert offers it', () => {
        expect(OUTPUT_FORMATS).not.toContain('avif');
        expect(CONVERT_OUTPUT_FORMATS).toContain('avif');
    });

    /**
     * Derived from the engine's own list rather than hand-typed a second time.
     * The two copies used to be identical strings in two files, which is a trap
     * that only springs when they diverge — and AVIF joining the engine's
     * quality formats is exactly that moment.
     */
    it('takes its quality formats from the engine rather than restating them', () => {
        expect(DEFAULT_QUALITY).toBe(LIMITS_DEFAULT_QUALITY);
        expect(QUALITY_FORMATS).toEqual(['jpeg', 'webp']);
        expect(QUALITY_FORMATS).not.toContain('png');
        expect(QUALITY_FORMATS).not.toContain('avif');
        for (const format of QUALITY_FORMATS) {
            expect(ENGINE_QUALITY_FORMATS).toContain(format);
            expect(OUTPUT_FORMATS).toContain(format);
        }
    });

    it('downloads under a name that says what the archive holds', () => {
        expect(ZIP_FILENAME).toBe('resizo-converted-images.zip');
    });
});

describe('outputName', () => {
    it('keeps the picked name and changes only the extension', () => {
        expect(outputName('photo.png', 'webp')).toBe('photo.webp');
        expect(outputName('photo.png', 'jpeg')).toBe('photo.jpg');
        expect(outputName('holiday snap.JPEG', 'png')).toBe('holiday-snap.png');
    });

    it('adds no prefix and no suffix, because nothing about the picture changed', () => {
        expect(outputName('IMG_0001.jpg', 'webp')).toBe('IMG_0001.webp');
    });
});

describe('the sentences a row can carry', () => {
    it('says why a file was left alone, and that nothing was taken out of it', () => {
        expect(keptNote('webp')).toBe('Already WebP — kept unchanged, metadata included.');
        expect(keptNote('jpeg')).toBe('Already JPEG — kept unchanged, metadata included.');
    });

    it('names the colour the transparency actually landed on', () => {
        expect(flattenNote('white')).toBe('Transparent areas were placed on white.');
        expect(flattenNote('black')).toBe('Transparent areas were placed on black.');
        expect(flattenNote('#2f6fed')).toBe('Transparent areas were placed on the colour #2f6fed.');
    });

    it('never names a colour the pixels did not get', () => {
        // parseBackground falls back to white for anything it cannot read, so
        // the sentence falls back with it rather than quoting the input.
        expect(flattenNote('rebeccapurple')).toBe('Transparent areas were placed on white.');
        expect(flattenNote(undefined)).toBe('Transparent areas were placed on white.');
        expect(flattenNote('#fff')).toBe('Transparent areas were placed on white.');
    });

    it('names the file and the format it could not reach', () => {
        expect(failedMessage('photo.png', 'webp'))
            .toBe('Resizo couldn’t convert photo.png to WebP on this device.');
        expect(unverifiedMessage('photo.png', 'jpeg'))
            .toBe('Resizo couldn’t verify photo.png as a JPEG after converting it, so it was left out.');
    });
});

/* ------------------------------------------------------------------ *
 * The kept path
 * ------------------------------------------------------------------ */

describe('a file already in the output format', () => {
    it('is handed back untouched, without ever reaching the engine', async () => {
        const process = vi.fn();
        const assess = vi.fn();
        const file = new File([webpBytes(WIDTH, HEIGHT, { alpha: true })], 'logo.webp', { type: 'image/webp' });
        const processOne = createConvertProcessor({ process, assess });

        const row = await processOne(job({ file, name: 'logo.webp', format: 'webp', outputFormat: 'webp' }));

        expect(process).not.toHaveBeenCalled();
        expect(assess).not.toHaveBeenCalled();
        expect(row).toMatchObject({
            status: STATUS.success,
            kept: true,
            blob: file,
            filename: 'logo.webp',
            originalBytes: file.size,
            resultBytes: file.size,
            width: WIDTH,
            height: HEIGHT,
            sourceWidth: WIDTH,
            sourceHeight: HEIGHT,
            format: 'webp',
            outputFormat: 'webp',
            resized: false,
            flattened: false,
            flattenedOn: null,
            note: 'Already WebP — kept unchanged, metadata included.',
        });
    });

    it('treats jpg and jpeg as the one format they are', async () => {
        const process = vi.fn();
        const processOne = createConvertProcessor({ process, assess: vi.fn(() => ALLOWED) });

        const row = await processOne(job({ file: opaqueSource(), name: 'photo.jpg', format: 'jpg', outputFormat: 'jpeg' }));

        expect(process).not.toHaveBeenCalled();
        expect(row.kept).toBe(true);
    });
});

/* ------------------------------------------------------------------ *
 * The memory gate
 * ------------------------------------------------------------------ */

describe('a job this device cannot hold', () => {
    it('is refused in the gate’s own words, before a buffer is allocated', async () => {
        const process = vi.fn();
        const processOne = createConvertProcessor({
            process,
            assess: vi.fn(() => ({
                ok: false,
                reason: 'This photo is larger than this browser tab can hold.',
                suggestion: 'Try fewer at a time.',
            })),
        });

        const row = await processOne(job());

        expect(process).not.toHaveBeenCalled();
        expect(row.status).toBe(STATUS.unsafe);
        expect(row.error).toBe('This photo is larger than this browser tab can hold. Try fewer at a time.');
    });

    it('costs the job as a conversion of the source it was measured at', async () => {
        const assess = vi.fn(() => ALLOWED);
        const processOne = processorReturning(webpBlob({ alpha: true }), { assess });

        await processOne(job());

        expect(assess.mock.calls[0][1]).toEqual({ operation: 'convert', sourceWidth: WIDTH, sourceHeight: HEIGHT });
    });
});

/* ------------------------------------------------------------------ *
 * The engine call, and what happens when it throws
 * ------------------------------------------------------------------ */

describe('the engine call', () => {
    it('asks for the format, the quality and the background the batch chose', async () => {
        const process = vi.fn(async () => ({ blob: jpegBlob() }));
        const processOne = createConvertProcessor({ process, assess: vi.fn(() => ALLOWED) });

        await processOne(job({ outputFormat: 'jpeg', quality: 55, background: '#2f6fed' }));

        expect(process.mock.calls[0][0]).toBe('convert');
        expect(process.mock.calls[0][2]).toEqual({
            format: 'jpeg',
            quality: 55,
            background: '#2f6fed',
            sourceWidth: WIDTH,
            sourceHeight: HEIGHT,
        });
    });

    it('fails only that file, in words that name it, when the engine throws', async () => {
        const processOne = createConvertProcessor({
            process: vi.fn(async () => { throw new Error('RuntimeError: memory access out of bounds'); }),
            assess: vi.fn(() => ALLOWED),
        });

        const row = await processOne(job());

        expect(row.status).toBe(STATUS.failed);
        expect(row.error).toBe('Resizo couldn’t convert photo.png to WebP on this device.');
        expect(row.error).not.toContain('RuntimeError');
    });

    it('re-throws a cancellation, because that is the person and not the file', async () => {
        const controller = new AbortController();
        const processOne = createConvertProcessor({
            process: vi.fn(async () => {
                controller.abort();
                throw Object.assign(new Error('aborted'), { name: 'AbortError' });
            }),
            assess: vi.fn(() => ALLOWED),
        });

        await expect(processOne(job({ signal: controller.signal }))).rejects.toThrow('aborted');
    });
});

/* ------------------------------------------------------------------ *
 * The independent verification
 * ------------------------------------------------------------------ */

describe('the finished bytes are read back, never taken on trust', () => {
    it('accepts a conversion whose bytes are what they claim to be', async () => {
        const blob = webpBlob({ alpha: true });
        const file = transparentSource();
        const processOne = processorReturning(blob);

        const row = await processOne(job({ file }));

        expect(row).toMatchObject({
            status: STATUS.success,
            kept: false,
            blob,
            filename: 'photo.webp',
            originalBytes: file.size,
            resultBytes: blob.size,
            width: WIDTH,
            height: HEIGHT,
            sourceWidth: WIDTH,
            sourceHeight: HEIGHT,
            format: 'png',
            outputFormat: 'webp',
            flattened: false,
            flattenedOn: null,
            note: null,
            resized: false,
        });
    });

    it('refuses a .webp blob that is really JPEG bytes', async () => {
        const processOne = processorReturning(blobOf(jpegBytes(WIDTH, HEIGHT), 'image/webp'));

        const row = await processOne(job());

        expect(row.status).toBe(STATUS.failed);
        expect(row.error).toBe(
            'Resizo couldn’t verify photo.png as a WebP after converting it, so it was left out.',
        );
    });

    it('refuses a .webp blob holding JPEG bytes when no transparency is at stake', async () => {
        // An opaque source, so the alpha rule below cannot be what catches it:
        // the format row is on its own here, which is what makes this the proof
        // that the container is actually sniffed.
        const processOne = processorReturning(blobOf(jpegBytes(WIDTH, HEIGHT), 'image/webp'));

        const row = await processOne(job({ file: opaqueSource(), name: 'photo.jpg', format: 'jpeg' }));

        expect(row.status).toBe(STATUS.failed);
        expect(row.error).toBe(
            'Resizo couldn’t verify photo.jpg as a WebP after converting it, so it was left out.',
        );
    });

    it('refuses a conversion that came back a different size', async () => {
        const processOne = processorReturning(webpBlob({ alpha: true, width: 1200, height: 800 }));

        const row = await processOne(job());

        expect(row.status).toBe(STATUS.failed);
        expect(row.error).toContain('couldn’t verify');
    });

    it('refuses a JPEG that still declares an alpha channel', async () => {
        // A PNG's bytes under a JPEG requirement: the transparency row is what
        // catches it, and the format row agrees.
        const processOne = processorReturning(pngBlob({ alpha: true }));

        const row = await processOne(job({ outputFormat: 'jpeg' }));

        expect(row.status).toBe(STATUS.failed);
        expect(row.error).toContain('couldn’t verify photo.png as a JPEG');
    });

    it('asks the verifier for the transparency answer its output format allows', async () => {
        const validate = vi.fn(() => ({ verified: true, checks: [] }));
        const seams = { validate, assess: vi.fn(() => ALLOWED) };

        const toJpeg = createConvertProcessor({ process: vi.fn(async () => ({ blob: jpegBlob() })), ...seams });
        await toJpeg(job({ outputFormat: 'jpeg' }));
        expect(validate.mock.calls[0][1].transparency).toBe('removed');

        const fromTransparent = createConvertProcessor({
            process: vi.fn(async () => ({ blob: pngBlob({ alpha: true }), transparent: true })),
            ...seams,
        });
        await fromTransparent(job({ file: transparentWebpSource(), format: 'webp', outputFormat: 'png' }));
        expect(validate.mock.calls[1][1].transparency).toBe('kept');

        const fromOpaque = createConvertProcessor({
            process: vi.fn(async () => ({ blob: webpBlob({ alpha: false }) })),
            ...seams,
        });
        await fromOpaque(job({ file: opaqueSource(), format: 'jpeg' }));
        expect(validate.mock.calls[2][1].transparency).toBeNull();
    });

    it('refuses JPEG bytes that still carry alpha even when nothing else is wrong', async () => {
        // A JPEG container cannot declare an alpha channel, so the only way to
        // exercise this row alone is to let the verifier report it: the row
        // fails, and the sentence is the unverified one rather than a failure.
        const processOne = createConvertProcessor({
            process: vi.fn(async () => ({ blob: jpegBlob() })),
            assess: vi.fn(() => ALLOWED),
            validate: (bytes, requirement) => ({
                verified: false,
                checks: [{ key: 'transparency', ok: requirement.transparency !== 'removed' }],
            }),
        });

        const row = await processOne(job({ outputFormat: 'jpeg' }));

        expect(row.status).toBe(STATUS.failed);
        expect(row.error).toContain('couldn’t verify photo.png as a JPEG');
    });

    it('refuses a PNG output that lost the transparency its source had', async () => {
        const processOne = processorReturning(pngBlob({ alpha: false }));

        const row = await processOne(job({
            file: transparentWebpSource(),
            name: 'logo.webp',
            format: 'webp',
            outputFormat: 'png',
        }));

        expect(row.status).toBe(STATUS.failed);
        expect(row.error).toContain('couldn’t verify logo.webp as a PNG');
    });

    it('refuses a WebP output that lost the transparency its source had', async () => {
        const processOne = processorReturning(webpBlob({ alpha: false }));

        const row = await processOne(job());

        expect(row.status).toBe(STATUS.failed);
        expect(row.error).toContain('couldn’t verify photo.png as a WebP');
    });

    it('is content with an opaque WebP when the source had no transparency either', async () => {
        const processOne = processorReturning(webpBlob({ alpha: false }));

        const row = await processOne(job({ file: opaqueSource(), name: 'photo.jpg', format: 'jpeg' }));

        expect(row.status).toBe(STATUS.success);
        expect(row.filename).toBe('photo.webp');
    });

    it('refuses a conversion that produced no blob at all', async () => {
        const processOne = createConvertProcessor({
            process: vi.fn(async () => ({ blob: null })),
            assess: vi.fn(() => ALLOWED),
        });

        const row = await processOne(job());

        expect(row.status).toBe(STATUS.failed);
        expect(row.error).toContain('couldn’t verify');
    });

    it('still verifies the format when the page could not measure the source', async () => {
        const good = processorReturning(webpBlob({ alpha: true }));
        const bad = processorReturning(blobOf(jpegBytes(WIDTH, HEIGHT), 'image/webp'));
        const unmeasured = { sourceWidth: null, sourceHeight: null };

        const row = await good(job(unmeasured));

        expect(row.status).toBe(STATUS.success);
        expect(row.width).toBe(WIDTH);
        expect((await bad(job(unmeasured))).status).toBe(STATUS.failed);
    });
});

/* ------------------------------------------------------------------ *
 * Flattening
 * ------------------------------------------------------------------ */

describe('a transparent source going out as JPEG', () => {
    it('says where the see-through areas went, and on which colour', async () => {
        const processOne = processorReturning(jpegBlob());

        const row = await processOne(job({ outputFormat: 'jpeg', background: 'black' }));

        expect(row).toMatchObject({
            status: STATUS.success,
            outputFormat: 'jpeg',
            filename: 'photo.jpg',
            flattened: true,
            flattenedOn: 'black',
            note: 'Transparent areas were placed on black.',
        });
    });

    it('says nothing about a background when the source had no transparency', async () => {
        const processOne = processorReturning(jpegBlob());

        const row = await processOne(job({
            file: opaquePngSource(),
            name: 'chart.png',
            format: 'png',
            outputFormat: 'jpeg',
            background: 'black',
        }));

        expect(row).toMatchObject({ status: STATUS.success, flattened: false, flattenedOn: null, note: null });
    });

    it('says nothing about a background when the output keeps the alpha channel', async () => {
        const processOne = processorReturning(pngBlob({ alpha: true }));

        const row = await processOne(job({
            file: transparentWebpSource(),
            name: 'logo.webp',
            format: 'webp',
            outputFormat: 'png',
            background: 'black',
        }));

        expect(row).toMatchObject({ status: STATUS.success, flattened: false, flattenedOn: null, note: null });
    });
});

/* ------------------------------------------------------------------ *
 * Two files with one name
 * ------------------------------------------------------------------ */

describe('a batch holding two files with the same name', () => {
    it('gives each finished file a download of its own', async () => {
        const processOne = processorReturning(webpBlob({ alpha: true }));
        const items = ['1', '2'].map((id) => ({
            id,
            name: 'photo.png',
            file: transparentSource(),
            folder: null,
            sourceWidth: WIDTH,
            sourceHeight: HEIGHT,
            format: 'png',
        }));

        const { rows } = await runBatch({
            items,
            settings: { outputFormat: 'webp', quality: DEFAULT_QUALITY, background: 'white' },
            processFile: processOne,
        });

        expect(rows.map((row) => row.status)).toEqual(['success', 'success']);
        expect(rows.map((row) => row.filename)).toEqual(['photo.webp', 'photo-2.webp']);
    });
});

/* ------------------------------------------------------------------ *
 * The summary
 * ------------------------------------------------------------------ */

describe('summarizeConversion', () => {
    function rowOf(status, extra = {}) {
        return { id: extra.id ?? status, status, originalBytes: null, resultBytes: null, ...extra };
    }

    it('counts a kept file as a success, but never as a conversion', () => {
        const summary = summarizeConversion([
            rowOf('success', { id: '1', originalBytes: 1000, resultBytes: 700 }),
            rowOf('success', { id: '2', originalBytes: 500, resultBytes: 500, kept: true }),
            rowOf('failed', { id: '3' }),
        ]);

        expect(summary).toMatchObject({
            selected: 3,
            successful: 2,
            converted: 1,
            kept: 1,
            failed: 1,
            inputBytes: 1500,
            outputBytes: 1200,
            differenceBytes: -300,
        });
    });

    it('reports a batch that grew, because a converted file often does', () => {
        expect(summarizeConversion([rowOf('success', { id: '1', originalBytes: 1000, resultBytes: 3400 })]))
            .toMatchObject({ converted: 1, differenceBytes: 2400 });
    });

    it('reads as nothing at all for an empty batch', () => {
        expect(summarizeConversion([])).toMatchObject({ selected: 0, converted: 0, kept: 0, differenceBytes: 0 });
    });
});

describe('createConvertProcessor — the row keeps the settings it was made with', () => {
    it('reports the flatten colour on its own field and leaves the background setting untouched', async () => {
        const processOne = processorReturning(pngBlob({ alpha: false }));

        const row = await processOne({
            file: opaqueSource('photo.jpg'),
            name: 'photo.jpg',
            outputFormat: 'png',
            quality: 80,
            background: 'white',
            sourceWidth: WIDTH,
            sourceHeight: HEIGHT,
            format: 'jpeg',
        });

        expect(row.status, row.error).toBe('success');
        expect(row.background).toBeUndefined();
        expect(row.flattenedOn).toBeNull();
    });
});

