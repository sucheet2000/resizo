/**
 * The bulk compressor's batch layer.
 *
 * Every file in a batch is asked for the same thing — "get under this many
 * bytes" — and the interesting part is not the encode, which the engine already
 * owns, but what happens when the answer comes back. This module refuses to
 * believe the engine: it re-reads the finished blob's own header, measures its
 * length itself, and calls the row unmet whenever the bytes, the dimensions or
 * the format disagree with what was asked for. A photo silently handed back as
 * a JPEG when a PNG went in, or one byte over the limit the visitor typed into
 * a government form, is the failure this file exists to catch.
 *
 * The engine, the header reader and the memory gate are all injected, so the
 * bookkeeping is asserted on its own and no test here encodes a pixel.
 */
import { describe, expect, it, vi } from 'vitest';

import { TARGET_UNREACHABLE_CODE } from '@/lib/image-client/target-bytes';
import {
    buildZip,
    createCompressProcessor,
    DEFAULT_LIMIT_KB,
    KB,
    LIMIT_PRESETS,
    MAX_LIMIT_KB,
    MIN_LIMIT_KB,
    MODES,
    STATUS,
    STATUS_LABELS,
    ZIP_FAILED_MESSAGE,
    ZIP_FILENAME,
    limitLabel,
    outputName,
    parseLimitKb,
    retryableIds,
    runCompressBatch,
    seedRows,
    summarize,
    unmetMessage,
    zipEntries,
} from '@/lib/upload/compress-batch';

describe('the shared constants', () => {
    it('states one status label per status, and nothing else', () => {
        expect(Object.keys(STATUS_LABELS).sort()).toEqual(Object.keys(STATUS).sort());
        for (const key of Object.keys(STATUS)) expect(STATUS[key]).toBe(key);
    });

    it('offers the five limits forms ask for, inside the engine bounds', () => {
        expect(LIMIT_PRESETS.map((preset) => preset.kb)).toEqual([50, 100, 200, 500, 1024]);
        expect(LIMIT_PRESETS.map((preset) => preset.label)).toEqual(['50 KB', '100 KB', '200 KB', '500 KB', '1 MB']);

        for (const preset of LIMIT_PRESETS) {
            expect(preset.kb).toBeGreaterThanOrEqual(MIN_LIMIT_KB);
            expect(preset.kb).toBeLessThanOrEqual(MAX_LIMIT_KB);
        }

        expect(LIMIT_PRESETS.some((preset) => preset.kb === DEFAULT_LIMIT_KB)).toBe(true);
        expect(MODES).toEqual(['preserve', 'fit']);
        expect(KB).toBe(1024);
        expect(ZIP_FILENAME).toBe('resizo-compressed-images.zip');
        expect(ZIP_FAILED_MESSAGE).toContain('couldn’t create the ZIP');
    });

    it('derives its KB bounds from the engine rather than restating them', () => {
        expect(MIN_LIMIT_KB).toBe(10);
        expect(MAX_LIMIT_KB).toBe(20480);
    });
});

describe('parseLimitKb', () => {
    it('accepts a whole number of KB, as a number or as typed text', () => {
        expect(parseLimitKb(200)).toEqual({ ok: true, kb: 200, bytes: 200 * KB });
        expect(parseLimitKb('200')).toEqual({ ok: true, kb: 200, bytes: 204800 });
        expect(parseLimitKb('  50  ')).toEqual({ ok: true, kb: 50, bytes: 51200 });
    });

    it('accepts both ends of the range and refuses one step past either', () => {
        expect(parseLimitKb(MIN_LIMIT_KB).ok).toBe(true);
        expect(parseLimitKb(MAX_LIMIT_KB).ok).toBe(true);
        expect(parseLimitKb(MIN_LIMIT_KB - 1).ok).toBe(false);
        expect(parseLimitKb(MAX_LIMIT_KB + 1).ok).toBe(false);
    });

    it('refuses blank, non-numeric, decimal and negative entries', () => {
        for (const raw of ['', '   ', 'abc', '1e3', '20.5', 20.5, -5, '-5', NaN, null, undefined, {}]) {
            expect(parseLimitKb(raw).ok, `accepted ${JSON.stringify(raw)}`).toBe(false);
        }
    });

    it('says what to type instead, with both bounds in the sentence', () => {
        const outcome = parseLimitKb('0');

        expect(outcome.ok).toBe(false);
        expect(outcome.error).toBe('Enter a whole number of KB between 10 and 20,480.');
    });
});

describe('limitLabel', () => {
    it('names a preset the way the chip does', () => {
        expect(limitLabel(50 * KB)).toBe('50 KB');
        expect(limitLabel(200 * KB)).toBe('200 KB');
        expect(limitLabel(500 * KB)).toBe('500 KB');
    });

    it('switches to MB at 1,048,576 bytes and keeps one decimal above it', () => {
        expect(limitLabel(1024 * KB)).toBe('1 MB');
        expect(limitLabel(1536 * KB)).toBe('1.5 MB');
        expect(limitLabel(20480 * KB)).toBe('20 MB');
    });

    it('rounds an odd byte count to whole KB, because KB is the smallest unit here', () => {
        expect(limitLabel(51300)).toBe('50 KB');
        expect(limitLabel(204900)).toBe('200 KB');
        expect(limitLabel(0)).toBe('0 KB');
    });
});

describe('outputName', () => {
    it('marks the file as compressed and keeps the format it came back as', () => {
        expect(outputName('photo.jpg', 'jpeg')).toBe('photo-compressed.jpg');
        expect(outputName('screenshot.png', 'png')).toBe('screenshot-compressed.png');
        expect(outputName('logo.webp', 'webp')).toBe('logo-compressed.webp');
    });

    it('strips a path and anything a download header could not carry', () => {
        expect(outputName('Trip/2024/IMG 0001.jpg', 'jpeg')).toBe('IMG-0001-compressed.jpg');
        expect(outputName('🙂.jpg', 'jpeg')).toBe('image-compressed.jpg');
    });
});

describe('unmetMessage', () => {
    it('names the file and the limit, and blames dimensions under preserve', () => {
        expect(unmetMessage({ name: 'photo-3.jpg', targetBytes: 50 * KB, mode: 'preserve', format: 'jpeg' }))
            .toBe('Resizo couldn’t reduce photo-3.jpg below 50 KB without changing its dimensions.');
    });

    it('says why a PNG in preserve mode was never going to get there', () => {
        expect(unmetMessage({ name: 'chart.png', targetBytes: 100 * KB, mode: 'preserve', format: 'png' }))
            .toBe('Resizo couldn’t reduce chart.png below 100 KB — PNG has no quality setting, '
                + 'so only Fit under limit can shrink it.');
    });

    it('says the smaller picture was already tried under fit', () => {
        expect(unmetMessage({ name: 'photo-3.jpg', targetBytes: 1024 * KB, mode: 'fit', format: 'png' }))
            .toBe('Resizo couldn’t reduce photo-3.jpg below 1 MB even at the smallest size it allows.');
    });

    it('uses a curly apostrophe, not a straight one', () => {
        const message = unmetMessage({ name: 'a.jpg', targetBytes: 50 * KB, mode: 'preserve', format: 'jpeg' });

        expect(message).toContain('couldn’t');
        expect(message).not.toContain("couldn't");
    });
});

/* ------------------------------------------------- the per-file processor */

function fakeFile(name, bytes = 400_000, type = 'image/jpeg') {
    return new File([new Uint8Array(bytes)], name, { type });
}

/** What the engine hands back, with a blob of a chosen length. */
function engineResult({ bytes, format = 'jpeg', width = 1600, height = 1067, ...rest }) {
    return {
        blob: new Blob([new Uint8Array(bytes)]),
        format,
        width,
        height,
        resultBytes: bytes,
        targetMet: true,
        policy: 'keep',
        resized: false,
        ...rest,
    };
}

/** A header reader that reports whatever the test says the finished file is. */
function readerOf(size) {
    return vi.fn(async () => size);
}

const PASSES = () => ({ ok: true });

function jobOf(overrides = {}) {
    return {
        file: fakeFile('photo-3.jpg'),
        name: 'photo-3.jpg',
        targetBytes: 50 * KB,
        mode: 'preserve',
        sourceWidth: 1600,
        sourceHeight: 1067,
        format: 'jpeg',
        ...overrides,
    };
}

describe('createCompressProcessor — the happy path', () => {
    it('returns the blob, its measured size and a compressed name', async () => {
        const process = vi.fn(async () => engineResult({ bytes: 48_000 }));
        const processOne = createCompressProcessor({
            process,
            readSize: readerOf({ width: 1600, height: 1067 }),
            assess: PASSES,
        });

        const result = await processOne(jobOf());

        expect(result).toMatchObject({
            status: 'success',
            filename: 'photo-3-compressed.jpg',
            originalBytes: 400_000,
            resultBytes: 48_000,
            width: 1600,
            height: 1067,
            sourceWidth: 1600,
            sourceHeight: 1067,
            format: 'jpeg',
            resized: false,
        });
        expect(result.blob.size).toBe(48_000);
        expect(result.error ?? null).toBeNull();
    });

    it('asks the engine for this file\'s own target, in the mode that was chosen', async () => {
        const process = vi.fn(async () => engineResult({ bytes: 10_000 }));
        const processOne = createCompressProcessor({
            process,
            readSize: readerOf({ width: 1600, height: 1067 }),
            assess: PASSES,
        });
        const signal = new AbortController().signal;

        await processOne(jobOf({ mode: 'fit', targetBytes: 100 * KB, signal }));

        const [operation, file, options, hooks] = process.mock.calls[0];
        expect(operation).toBe('compress');
        expect(file.name).toBe('photo-3.jpg');
        expect(options).toMatchObject({
            targetBytes: 100 * KB,
            policy: 'fit',
            sourceWidth: 1600,
            sourceHeight: 1067,
        });
        expect(hooks.signal).toBe(signal);
    });

    it('reports the smaller picture when fit traded pixels for bytes', async () => {
        const processOne = createCompressProcessor({
            process: async () => engineResult({ bytes: 40_000, width: 1280, height: 853 }),
            readSize: readerOf({ width: 1280, height: 853 }),
            assess: PASSES,
        });

        const result = await processOne(jobOf({ mode: 'fit' }));

        expect(result.status).toBe('success');
        expect(result).toMatchObject({ width: 1280, height: 853, resized: true });
    });
});

/**
 * THE ENGINE'S OWN VERDICT IS NOT EVIDENCE.
 *
 * targetMet is computed by the same code that produced the file, so a row that
 * trusted it would report "50 KB ✓" on a 50 KB + 1 byte file — and a form that
 * rejects at 51,201 bytes would bounce it days later, with nothing on screen
 * ever having said so. The length is measured here instead, from the blob.
 */
describe('createCompressProcessor — the bytes are measured, never taken on trust', () => {
    it('calls one byte over the limit unmet, whatever the engine claims', async () => {
        const processOne = createCompressProcessor({
            process: async () => engineResult({ bytes: 50 * KB + 1, targetMet: true }),
            readSize: readerOf({ width: 1600, height: 1067 }),
            assess: PASSES,
        });

        const result = await processOne(jobOf({ targetBytes: 50 * KB }));

        expect(result.status).toBe('unmet');
        expect(result.error).toBe(
            'Resizo couldn’t reduce photo-3.jpg below 50 KB without changing its dimensions.',
        );
        expect(result.blob ?? null).toBeNull();
    });

    it('accepts a file exactly on the limit', async () => {
        const processOne = createCompressProcessor({
            process: async () => engineResult({ bytes: 50 * KB }),
            readSize: readerOf({ width: 1600, height: 1067 }),
            assess: PASSES,
        });

        const result = await processOne(jobOf({ targetBytes: 50 * KB }));

        expect(result.status).toBe('success');
    });

    it('ignores targetMet in both directions — a fitting blob flagged false still passes', async () => {
        const processOne = createCompressProcessor({
            process: async () => engineResult({ bytes: 30 * KB, format: 'png', targetMet: false }),
            readSize: readerOf({ width: 1600, height: 1067 }),
            assess: PASSES,
        });

        const result = await processOne(jobOf({ format: 'png', name: 'chart.png' }));

        expect(result.status).toBe('success');
    });

    it('calls a PNG the engine could not shrink unmet, and says why', async () => {
        const processOne = createCompressProcessor({
            process: async () => engineResult({ bytes: 900 * KB, format: 'png', targetMet: false }),
            readSize: readerOf({ width: 1600, height: 1067 }),
            assess: PASSES,
        });

        const result = await processOne(jobOf({ format: 'png', name: 'chart.png', targetBytes: 100 * KB }));

        expect(result.status).toBe('unmet');
        expect(result.error).toContain('PNG has no quality setting');
    });
});

/**
 * PRESERVE MEANS PRESERVE, AND FIT MEANS THE SAME SHAPE.
 *
 * The header of the finished file is read by a parser that never saw the
 * request, so a resampler that quietly dropped a row, or a policy that resized
 * under a mode that forbids it, is caught here rather than discovered by
 * whoever opens the download.
 */
describe('createCompressProcessor — the dimensions are read back', () => {
    it('calls preserve unmet when the picture came back a different size', async () => {
        const processOne = createCompressProcessor({
            process: async () => engineResult({ bytes: 40_000, width: 1280, height: 853 }),
            readSize: readerOf({ width: 1280, height: 853 }),
            assess: PASSES,
        });

        const result = await processOne(jobOf({ mode: 'preserve' }));

        expect(result.status).toBe('unmet');
        expect(result.error).toBe(
            'Resizo couldn’t reduce photo-3.jpg below 50 KB without changing its dimensions.',
        );
    });

    it('allows a pixel of rounding in the aspect under fit', async () => {
        const processOne = createCompressProcessor({
            process: async () => engineResult({ bytes: 40_000, width: 800, height: 533 }),
            readSize: readerOf({ width: 800, height: 533 }),
            assess: PASSES,
        });

        const result = await processOne(jobOf({ mode: 'fit' }));

        expect(result.status).toBe('success');
    });

    it('calls fit unmet when the shape changed, not just the size', async () => {
        const processOne = createCompressProcessor({
            process: async () => engineResult({ bytes: 40_000, width: 800, height: 600 }),
            readSize: readerOf({ width: 800, height: 600 }),
            assess: PASSES,
        });

        const result = await processOne(jobOf({ mode: 'fit' }));

        expect(result.status).toBe('unmet');
        expect(result.error).toContain('even at the smallest size it allows');
    });

    it('calls a blob whose header reader throws unmet, rather than throwing itself', async () => {
        const processOne = createCompressProcessor({
            process: async () => engineResult({ bytes: 40_000 }),
            readSize: vi.fn(async () => { throw new TypeError('bad buffer'); }),
            assess: PASSES,
        });

        const result = await processOne(jobOf());

        expect(result.status).toBe('unmet');
        expect(result.error).toBe('Resizo couldn’t reduce photo-3.jpg below 50 KB without changing its dimensions.');
    });

    it('calls a blob whose header cannot be read unmet', async () => {
        const processOne = createCompressProcessor({
            process: async () => engineResult({ bytes: 40_000 }),
            readSize: readerOf(null),
            assess: PASSES,
        });

        expect((await processOne(jobOf())).status).toBe('unmet');
    });

    it('skips the dimension check when nothing measured the source', async () => {
        const processOne = createCompressProcessor({
            process: async () => engineResult({ bytes: 40_000 }),
            readSize: readerOf({ width: 1600, height: 1067 }),
            assess: PASSES,
        });

        const result = await processOne(jobOf({ sourceWidth: null, sourceHeight: null }));

        expect(result.status).toBe('success');
        expect(result.resized).toBe(false);
    });
});

/**
 * NO SILENT CONVERSION, EVER. A PNG that comes back as a JPEG has lost its
 * transparency, and a batch that made that trade without saying so would hand
 * back logos on black rectangles.
 */
describe('createCompressProcessor — the format that went in is the format that comes out', () => {
    it('calls a converted file unmet rather than shipping it', async () => {
        const processOne = createCompressProcessor({
            process: async () => engineResult({ bytes: 30_000, format: 'jpeg' }),
            readSize: readerOf({ width: 1600, height: 1067 }),
            assess: PASSES,
        });

        const result = await processOne(jobOf({ format: 'png', name: 'logo.png', targetBytes: 100 * KB }));

        expect(result.status).toBe('unmet');
        expect(result.error).toContain('PNG has no quality setting');
    });

    it('keeps a WebP a WebP', async () => {
        const processOne = createCompressProcessor({
            process: async () => engineResult({ bytes: 30_000, format: 'webp' }),
            readSize: readerOf({ width: 1600, height: 1067 }),
            assess: PASSES,
        });

        const result = await processOne(jobOf({ format: 'webp', name: 'shot.webp' }));

        expect(result).toMatchObject({ status: 'success', format: 'webp', filename: 'shot-compressed.webp' });
    });
});

describe('createCompressProcessor — refusals and failures', () => {
    it('reports the memory gate\'s own words, and never starts the job', async () => {
        const process = vi.fn();
        const processOne = createCompressProcessor({
            process,
            readSize: readerOf({ width: 1600, height: 1067 }),
            assess: () => ({ ok: false, reason: 'That photo is larger than this device can hold.', suggestion: 'Try one at a time.' }),
        });

        const result = await processOne(jobOf());

        expect(result).toEqual({
            status: 'unsafe',
            error: 'That photo is larger than this device can hold. Try one at a time.',
        });
        expect(process).not.toHaveBeenCalled();
    });

    it('turns an unreachable target into the row\'s own sentence', async () => {
        const error = new Error('Cannot reach 50 KB for this image. Smallest achievable is 88 KB. Raise the target.');
        error.code = TARGET_UNREACHABLE_CODE;
        const processOne = createCompressProcessor({
            process: async () => { throw error; },
            readSize: readerOf(null),
            assess: PASSES,
        });

        const result = await processOne(jobOf());

        expect(result.status).toBe('unmet');
        expect(result.error).toBe(
            'Resizo couldn’t reduce photo-3.jpg below 50 KB without changing its dimensions.',
        );
        expect(result.error).not.toContain('Smallest achievable');
    });

    it('drops an engine failure\'s wording, whatever it was', async () => {
        const processOne = createCompressProcessor({
            process: async () => { throw new Error('RuntimeError: memory access out of bounds'); },
            readSize: readerOf(null),
            assess: PASSES,
        });

        const result = await processOne(jobOf());

        expect(result.status).toBe('unmet');
        expect(result.error).not.toContain('RuntimeError');
    });
});

/**
 * A CANCEL IS THE PERSON'S DECISION, NOT THE FILE'S FAILURE. It is re-thrown so
 * the sequencer stops the whole run, rather than recording nineteen unmet rows
 * for files that were never tried.
 */
describe('createCompressProcessor — a cancellation is re-thrown', () => {
    it.each([
        ['an AbortError', () => Object.assign(new Error('aborted'), { name: 'AbortError' })],
        ['the engine\'s cancelled code', () => Object.assign(new Error('cancelled'), { code: 'cancelled' })],
    ])('re-throws %s', async (_label, make) => {
        const processOne = createCompressProcessor({
            process: async () => { throw make(); },
            readSize: readerOf(null),
            assess: PASSES,
        });

        await expect(processOne(jobOf())).rejects.toThrow();
    });

    it('re-throws any failure once the signal is already aborted', async () => {
        const controller = new AbortController();
        controller.abort();
        const processOne = createCompressProcessor({
            process: async () => { throw new Error('whatever'); },
            readSize: readerOf(null),
            assess: PASSES,
        });

        await expect(processOne(jobOf({ signal: controller.signal }))).rejects.toThrow('whatever');
    });
});

/* -------------------------------------------------------- the sequencer */

function batchItem(id, name, { folder = null, bytes = 400_000, format = 'jpeg', width = 1600, height = 1067 } = {}) {
    return {
        id,
        name,
        file: fakeFile(name, bytes),
        folder,
        sourceWidth: width,
        sourceHeight: height,
        format,
    };
}

function succeeded(name, { bytes = 40_000, format = 'jpeg', width = 1600, height = 1067, resized = false } = {}) {
    return {
        status: 'success',
        blob: new Blob([new Uint8Array(bytes)]),
        filename: outputName(name, format),
        originalBytes: 400_000,
        resultBytes: bytes,
        width,
        height,
        sourceWidth: 1600,
        sourceHeight: 1067,
        format,
        resized,
    };
}

/** A processFile answering from a name→result map, recording the order it saw. */
function scripted(byName, order) {
    return vi.fn(async ({ name }) => {
        order?.push(name);
        const answer = byName[name];
        if (typeof answer === 'function') return answer();
        return answer;
    });
}

describe('runCompressBatch — sequencing', () => {
    it('runs every file once, in the order they were chosen', async () => {
        const order = [];
        const processFile = scripted({
            'a.jpg': succeeded('a.jpg'),
            'b.jpg': succeeded('b.jpg'),
            'c.jpg': succeeded('c.jpg'),
        }, order);

        const outcome = await runCompressBatch({
            items: [batchItem('1', 'a.jpg'), batchItem('2', 'b.jpg'), batchItem('3', 'c.jpg')],
            targetBytes: 200 * KB,
            mode: 'preserve',
            processFile,
        });

        expect(order).toEqual(['a.jpg', 'b.jpg', 'c.jpg']);
        expect(outcome.aborted).toBe(false);
        expect(outcome.rows.map((row) => row.id)).toEqual(['1', '2', '3']);
        expect(outcome.rows.every((row) => row.status === 'success')).toBe(true);
    });

    it('hands each file the batch settings and its own measurements', async () => {
        const processFile = scripted({ 'a.jpg': succeeded('a.jpg') });

        await runCompressBatch({
            items: [batchItem('1', 'a.jpg', { format: 'png', width: 800, height: 600 })],
            targetBytes: 50 * KB,
            mode: 'fit',
            processFile,
        });

        expect(processFile.mock.calls[0][0]).toMatchObject({
            name: 'a.jpg',
            targetBytes: 50 * KB,
            mode: 'fit',
            sourceWidth: 800,
            sourceHeight: 600,
            format: 'png',
        });
    });

    it('reports each file moving from processing to its settled status', async () => {
        const onProgress = vi.fn();
        const processFile = scripted({ 'a.jpg': succeeded('a.jpg', { bytes: 12_345 }) });

        await runCompressBatch({
            items: [batchItem('1', 'a.jpg')],
            targetBytes: 200 * KB,
            mode: 'preserve',
            processFile,
            onProgress,
        });

        expect(onProgress).toHaveBeenNthCalledWith(1, '1', { status: 'processing' });
        expect(onProgress.mock.calls[1][0]).toBe('1');
        expect(onProgress.mock.calls[1][1]).toMatchObject({ status: 'success', resultBytes: 12_345 });
    });

    it('builds a full row for every item, whatever happened to it', async () => {
        const processFile = scripted({
            'a.jpg': succeeded('a.jpg'),
            'b.png': { status: 'unmet', error: 'nope' },
        });

        const { rows } = await runCompressBatch({
            items: [batchItem('1', 'a.jpg', { folder: 'Trip/2024' }), batchItem('2', 'b.png', { format: 'png' })],
            targetBytes: 200 * KB,
            mode: 'preserve',
            processFile,
        });

        expect(rows[0]).toMatchObject({
            id: '1',
            name: 'a.jpg',
            folder: 'Trip/2024',
            status: 'success',
            originalBytes: 400_000,
            resultBytes: 40_000,
            filename: 'a-compressed.jpg',
            targetBytes: 200 * KB,
            mode: 'preserve',
            format: 'jpeg',
        });
        expect(rows[1]).toMatchObject({
            id: '2',
            name: 'b.png',
            folder: null,
            status: 'unmet',
            error: 'nope',
            resultBytes: null,
            width: null,
            height: null,
            blob: null,
            filename: null,
            resized: false,
        });
    });
});

/**
 * ONE BAD FILE COSTS ONE ROW. Nineteen finished images must not be lost because
 * the twentieth could not reach its target, and — the subtler half — a later
 * failure must not reach back and change what an earlier success said.
 */
describe('createCompressProcessor — the kept path never falls through to the encoder', () => {
    it('hands back the original bytes, untouched, when the stripper cannot read the file', async () => {
        const file = fakeFile('shot.png', 120_000, 'image/png');
        const ops = [];
        const processOne = createCompressProcessor({
            process: async (op) => {
                ops.push(op);
                if (op === 'strip') throw new Error('unreadable container');
                return engineResult({ bytes: 74_230, format: 'png', width: 1440, height: 900 });
            },
            readSize: readerOf({ width: 1440, height: 900 }),
            assess: PASSES,
        });

        const result = await processOne(jobOf({ file, name: 'shot.png', targetBytes: 200 * KB, format: 'png', sourceWidth: 1440, sourceHeight: 900 }));

        expect(ops).toEqual(['strip']);
        expect(result.status).toBe('success');
        expect(result.kept).toBe(true);
        expect(result.blob).toBe(file);
        expect(result.resultBytes).toBe(120_000);
        expect(result.note).toBe('Already under 200 KB — kept exactly as it arrived.');
    });

    it('explains a kept file it could not read back in its own words, not as a missed target', async () => {
        const file = fakeFile('shot.png', 120_000, 'image/png');
        const processOne = createCompressProcessor({
            process: async () => engineResult({ bytes: 119_000, format: 'png', width: 1440, height: 900 }),
            readSize: readerOf(null),
            assess: PASSES,
        });

        const result = await processOne(jobOf({ file, name: 'shot.png', targetBytes: 200 * KB, format: 'png', sourceWidth: 1440, sourceHeight: 900 }));

        expect(result.status).toBe('unsupported');
        expect(result.error).toBe('Resizo couldn’t check shot.png after removing its metadata, so it was left out.');
    });
});

describe('runCompressBatch — every finished row has a name of its own', () => {
    it('suffixes the second of two files that share a name, in selection order', async () => {
        const processFile = scripted({
            'photo.jpg': () => succeeded('photo.jpg'),
        });

        const { rows } = await runCompressBatch({
            items: [batchItem('1', 'photo.jpg'), batchItem('2', 'photo.jpg'), batchItem('3', 'photo.jpg')],
            targetBytes: 50 * KB,
            mode: 'preserve',
            processFile,
        });

        expect(rows.map((row) => row.filename)).toEqual([
            'photo-compressed.jpg',
            'photo-compressed-2.jpg',
            'photo-compressed-3.jpg',
        ]);
        expect(zipEntries(rows).map((entry) => entry.name)).toEqual(rows.map((row) => row.filename));
    });

    it('keeps clear of names already taken by rows a retry leaves in place', async () => {
        const processFile = scripted({ 'photo.jpg': () => succeeded('photo.jpg') });

        const { rows } = await runCompressBatch({
            items: [batchItem('9', 'photo.jpg')],
            targetBytes: 50 * KB,
            mode: 'preserve',
            processFile,
            reservedNames: ['photo-compressed.jpg', 'photo-compressed-2.jpg'],
        });

        expect(rows[0].filename).toBe('photo-compressed-3.jpg');
    });
});

describe('runCompressBatch — a failure is one row, not the batch', () => {
    it('keeps the successes when one in the middle fails', async () => {
        const processFile = scripted({
            'a.jpg': succeeded('a.jpg'),
            'b.jpg': { status: 'unmet', error: 'Resizo couldn’t reduce b.jpg below 50 KB without changing its dimensions.' },
            'c.jpg': succeeded('c.jpg'),
        });

        const { rows } = await runCompressBatch({
            items: [batchItem('1', 'a.jpg'), batchItem('2', 'b.jpg'), batchItem('3', 'c.jpg')],
            targetBytes: 50 * KB,
            mode: 'preserve',
            processFile,
        });

        expect(rows.map((row) => row.status)).toEqual(['success', 'unmet', 'success']);
        expect(rows[0].blob).toBeInstanceOf(Blob);
        expect(rows[2].blob).toBeInstanceOf(Blob);
    });

    it('leaves an earlier success untouched when a later file fails', async () => {
        const first = succeeded('a.jpg', { bytes: 11_111 });
        const processFile = scripted({
            'a.jpg': first,
            'b.jpg': { status: 'unsafe', error: 'Too big for this device.' },
        });

        const { rows } = await runCompressBatch({
            items: [batchItem('1', 'a.jpg'), batchItem('2', 'b.jpg')],
            targetBytes: 50 * KB,
            mode: 'preserve',
            processFile,
        });

        expect(rows[0]).toMatchObject({ status: 'success', resultBytes: 11_111, error: null });
        expect(rows[0].blob).toBe(first.blob);
    });

    it('turns an unexpected throw from one file into that row\'s failure and carries on', async () => {
        const processFile = scripted({
            'a.jpg': succeeded('a.jpg'),
            'b.jpg': () => { throw new TypeError('blob.arrayBuffer is not a function'); },
            'c.jpg': succeeded('c.jpg'),
        });
        const seen = [];

        const { rows, aborted } = await runCompressBatch({
            items: [batchItem('1', 'a.jpg'), batchItem('2', 'b.jpg'), batchItem('3', 'c.jpg')],
            targetBytes: 50 * KB,
            mode: 'preserve',
            processFile,
            onProgress: (id, patch) => seen.push([id, patch.status]),
        });

        expect(aborted).toBe(false);
        expect(rows.map((row) => row.status)).toEqual(['success', 'unmet', 'success']);
        expect(rows[1].error).toBe('Resizo couldn’t reduce b.jpg below 50 KB without changing its dimensions.');
        expect(seen.filter(([, status]) => status === 'cancelled')).toEqual([]);
    });
});

/**
 * A CANCEL STOPS THE RUN AND KEEPS WHAT FINISHED. The file in flight and every
 * one behind it are marked cancelled — never failed, because they were never
 * tried — and the images that already finished stay downloadable.
 */
describe('runCompressBatch — cancellation', () => {
    it('marks the file in flight and everything after it cancelled', async () => {
        const controller = new AbortController();
        const onProgress = vi.fn();
        const processFile = vi.fn(async ({ name }) => {
            if (name === 'a.jpg') return succeeded('a.jpg');
            controller.abort();
            throw Object.assign(new Error('cancelled'), { name: 'AbortError' });
        });

        const outcome = await runCompressBatch({
            items: [batchItem('1', 'a.jpg'), batchItem('2', 'b.jpg'), batchItem('3', 'c.jpg')],
            targetBytes: 200 * KB,
            mode: 'preserve',
            processFile,
            onProgress,
            signal: controller.signal,
        });

        expect(outcome.aborted).toBe(true);
        expect(outcome.rows.map((row) => row.status)).toEqual(['success', 'cancelled', 'cancelled']);
        expect(outcome.rows[0].blob).toBeInstanceOf(Blob);
        expect(processFile).toHaveBeenCalledTimes(2);
        expect(onProgress).toHaveBeenCalledWith('2', { status: 'cancelled' });
        expect(onProgress).toHaveBeenCalledWith('3', { status: 'cancelled' });
    });

    it('stops before the next file when the signal went down between two of them', async () => {
        const controller = new AbortController();
        const processFile = vi.fn(async ({ name }) => {
            if (name === 'a.jpg') {
                controller.abort();
                return succeeded('a.jpg');
            }
            return succeeded(name);
        });

        const outcome = await runCompressBatch({
            items: [batchItem('1', 'a.jpg'), batchItem('2', 'b.jpg')],
            targetBytes: 200 * KB,
            mode: 'preserve',
            processFile,
            signal: controller.signal,
        });

        expect(processFile).toHaveBeenCalledTimes(1);
        expect(outcome.aborted).toBe(true);
        expect(outcome.rows.map((row) => row.status)).toEqual(['success', 'cancelled']);
    });

    it('runs nothing at all when the signal was already down', async () => {
        const controller = new AbortController();
        controller.abort();
        const processFile = vi.fn();

        const outcome = await runCompressBatch({
            items: [batchItem('1', 'a.jpg'), batchItem('2', 'b.jpg')],
            targetBytes: 200 * KB,
            mode: 'preserve',
            processFile,
            signal: controller.signal,
        });

        expect(processFile).not.toHaveBeenCalled();
        expect(outcome.aborted).toBe(true);
        expect(outcome.rows.every((row) => row.status === 'cancelled')).toBe(true);
    });

    it('has nothing to do with an empty batch', async () => {
        const outcome = await runCompressBatch({ items: [], targetBytes: 200 * KB, mode: 'preserve', processFile: vi.fn() });

        expect(outcome).toEqual({ rows: [], aborted: false });
    });
});

/* ----------------------------------------------------------- the summary */

function rowOf(status, extra = {}) {
    return { id: extra.id ?? status, status, originalBytes: null, resultBytes: null, ...extra };
}

describe('summarize', () => {
    it('reads as nothing at all for an empty batch', () => {
        expect(summarize([])).toEqual({
            selected: 0,
            successful: 0,
            unmet: 0,
            unsupported: 0,
            unsafe: 0,
            cancelled: 0,
            waiting: 0,
            processing: 0,
            inputBytes: 0,
            outputBytes: 0,
            savedBytes: 0,
            reductionPercent: null,
        });
    });

    it('counts every status, including the ones that never settled', () => {
        const summary = summarize([
            rowOf('success', { id: '1', originalBytes: 100, resultBytes: 40 }),
            rowOf('unmet', { id: '2' }),
            rowOf('unsupported', { id: '3' }),
            rowOf('unsafe', { id: '4' }),
            rowOf('cancelled', { id: '5' }),
            rowOf('waiting', { id: '6' }),
            rowOf('processing', { id: '7' }),
        ]);

        expect(summary).toMatchObject({
            selected: 7,
            successful: 1,
            unmet: 1,
            unsupported: 1,
            unsafe: 1,
            cancelled: 1,
            waiting: 1,
            processing: 1,
        });
    });

    it('adds up the successes only, so a failed row cannot inflate the saving', () => {
        const summary = summarize([
            rowOf('success', { id: '1', originalBytes: 1000, resultBytes: 400 }),
            rowOf('success', { id: '2', originalBytes: 3000, resultBytes: 600 }),
            rowOf('unmet', { id: '3', originalBytes: 9_000_000, resultBytes: null }),
        ]);

        expect(summary).toMatchObject({
            inputBytes: 4000,
            outputBytes: 1000,
            savedBytes: 3000,
            reductionPercent: 75,
        });
    });

    it('has no percentage to report when nothing succeeded', () => {
        expect(summarize([rowOf('unmet'), rowOf('cancelled')]).reductionPercent).toBeNull();
    });

    it('returns the same answer for the same rows, every time', () => {
        const rows = [
            rowOf('success', { id: '1', originalBytes: 1000, resultBytes: 333 }),
            rowOf('unsafe', { id: '2' }),
        ];

        expect(summarize(rows)).toEqual(summarize(rows));
    });
});

/* ------------------------------------------------------- the ZIP manifest */

function zipRow(id, filename, { folder = null, status = 'success' } = {}) {
    return { id, status, folder, filename, blob: new Blob([filename]) };
}

describe('zipEntries', () => {
    it('takes the successes, in the order they were chosen', () => {
        const rows = [
            zipRow('1', 'a-compressed.jpg'),
            zipRow('2', 'b-compressed.jpg', { status: 'unmet' }),
            zipRow('3', 'c-compressed.jpg'),
        ];

        expect(zipEntries(rows).map((entry) => entry.name)).toEqual(['a-compressed.jpg', 'c-compressed.jpg']);
        expect(zipEntries(rows).map((entry) => entry.id)).toEqual(['1', '3']);
    });

    it('unzips back into the folders the files were picked from', () => {
        const entries = zipEntries([
            zipRow('1', 'IMG_0001-compressed.jpg', { folder: 'Trip/January' }),
            zipRow('2', 'IMG_0001-compressed.jpg', { folder: 'Trip/February' }),
        ]);

        expect(entries.map((entry) => entry.name)).toEqual([
            'Trip/January/IMG_0001-compressed.jpg',
            'Trip/February/IMG_0001-compressed.jpg',
        ]);
    });

    it('never drops a file to a name collision', () => {
        const entries = zipEntries([
            zipRow('1', 'photo-compressed.jpg'),
            zipRow('2', 'photo-compressed.jpg'),
            zipRow('3', 'photo-compressed.jpg'),
        ]);

        expect(entries.map((entry) => entry.name)).toEqual([
            'photo-compressed.jpg',
            'photo-compressed-2.jpg',
            'photo-compressed-3.jpg',
        ]);
        expect(new Set(entries.map((entry) => entry.name)).size).toBe(3);
    });
});

describe('buildZip', () => {
    it('hands the assembler the manifest and names the archive', async () => {
        const built = new Blob(['ZIP'], { type: 'application/zip' });
        const assemble = vi.fn(async () => built);

        const outcome = await buildZip([zipRow('1', 'a-compressed.jpg'), zipRow('2', 'b-compressed.jpg')], { assemble });

        expect(assemble.mock.calls[0][0].map((entry) => entry.name)).toEqual(['a-compressed.jpg', 'b-compressed.jpg']);
        expect(outcome).toEqual({ blob: built, filename: ZIP_FILENAME, count: 2 });
    });

    it('refuses to build an empty archive', async () => {
        const assemble = vi.fn();

        await expect(buildZip([zipRow('1', 'a.jpg', { status: 'unmet' })], { assemble })).rejects.toThrow('nothing-to-zip');
        expect(assemble).not.toHaveBeenCalled();
    });

    it('lets an assembler failure reach the caller, which has words for it', async () => {
        const assemble = vi.fn(async () => { throw new Error('Loading chunk 1234 failed.'); });

        await expect(buildZip([zipRow('1', 'a-compressed.jpg')], { assemble })).rejects.toThrow('Loading chunk');
    });
});

describe('retryableIds', () => {
    it('offers a retry for what might work next time, and never for an unsupported file', () => {
        const rows = [
            rowOf('success', { id: '1' }),
            rowOf('unmet', { id: '2' }),
            rowOf('unsafe', { id: '3' }),
            rowOf('cancelled', { id: '4' }),
            rowOf('unsupported', { id: '5' }),
            rowOf('waiting', { id: '6' }),
            rowOf('processing', { id: '7' }),
        ];

        expect(retryableIds(rows)).toEqual(['2', '3', '4']);
    });

    it('has nothing to offer on a clean run', () => {
        expect(retryableIds([rowOf('success', { id: '1' })])).toEqual([]);
    });
});

/**
 * The hook seeds the list the moment Compress is pressed, and the sequencer
 * seeds it again as it starts. One shape, one home — a second copy of it in
 * lib/hooks/ is how a panel ends up rendering a row whose fields the batch
 * layer stopped producing three commits ago.
 */
describe('seedRows', () => {
    it('produces a waiting row per item, carrying the run\'s settings', () => {
        const rows = seedRows(
            [batchItem('1', 'a.jpg', { folder: 'Trip', bytes: 1234 }), batchItem('2', 'b.png', { format: 'png' })],
            { targetBytes: 50 * KB, mode: 'fit' },
        );

        expect(rows).toHaveLength(2);
        expect(rows[0]).toEqual({
            id: '1',
            name: 'a.jpg',
            folder: 'Trip',
            status: 'waiting',
            originalBytes: 1234,
            resultBytes: null,
            width: null,
            height: null,
            sourceWidth: 1600,
            sourceHeight: 1067,
            format: 'jpeg',
            targetBytes: 50 * KB,
            mode: 'fit',
            blob: null,
            filename: null,
            error: null,
            resized: false,
            kept: false,
            note: null,
        });
        expect(rows[1]).toMatchObject({ id: '2', format: 'png', status: 'waiting' });
    });

    it('is the shape the sequencer hands back for a file it never reached', async () => {
        const controller = new AbortController();
        controller.abort();
        const { rows } = await runCompressBatch({
            items: [batchItem('1', 'a.jpg')],
            targetBytes: 50 * KB,
            mode: 'fit',
            processFile: vi.fn(),
            signal: controller.signal,
        });
        const [seeded] = seedRows([batchItem('1', 'a.jpg')], { targetBytes: 50 * KB, mode: 'fit' });

        expect(Object.keys(rows[0]).sort()).toEqual(Object.keys(seeded).sort());
    });
});

/**
 * A COMPRESSOR MUST NEVER HAND BACK A BIGGER FILE THAN IT WAS GIVEN.
 *
 * Measured on the benchmark: three PNGs that already satisfied the limit were
 * re-encoded anyway and came back two to three times larger — 24.0 KB became
 * 72.5 KB, 51.7 KB became 99.5 KB, 25.0 KB became 61.9 KB — and every one of
 * them was reported as a Success. This build has no PNG quantiser, so a
 * re-encode of an already-optimised PNG can only lose.
 *
 * So a file that already meets the limit is not re-encoded at all. It still
 * goes through the byte-level metadata stripper, because the behaviour registry
 * promises EXIF, GPS and XMP are gone from every output, and that promise has
 * to hold for the files that were left alone too. The pixels are untouched.
 */
describe('createCompressProcessor — a file already under the limit is kept, not re-encoded', () => {
    function keptJob(overrides = {}) {
        return jobOf({ file: fakeFile('photo-3.jpg', 120_000), targetBytes: 200 * KB, ...overrides });
    }

    /** Records which operations the engine was asked for, in order. */
    function engineSpy(answers) {
        const seen = [];
        const process = vi.fn(async (operation) => {
            seen.push(operation);
            const answer = answers[operation];
            if (typeof answer === 'function') return answer();
            return answer;
        });
        return { process, seen };
    }

    it('never hands it to the encoder, and says it was kept at its size', async () => {
        const { process, seen } = engineSpy({
            strip: engineResult({ bytes: 118_400, format: 'jpeg' }),
        });
        const assess = vi.fn(PASSES);
        const processOne = createCompressProcessor({
            process,
            readSize: readerOf({ width: 1600, height: 1067 }),
            assess,
        });

        const result = await processOne(keptJob());

        expect(seen).toEqual(['strip']);
        expect(result).toMatchObject({
            status: 'success',
            kept: true,
            resized: false,
            filename: 'photo-3-compressed.jpg',
            originalBytes: 120_000,
            resultBytes: 118_400,
            width: 1600,
            height: 1067,
            format: 'jpeg',
            note: 'Already under 200 KB — kept at its size, metadata removed.',
        });
        expect(assess).not.toHaveBeenCalled();
    });

    it('keeps a file that sits exactly on the limit', async () => {
        const { process, seen } = engineSpy({ strip: engineResult({ bytes: 200 * KB, format: 'jpeg' }) });
        const processOne = createCompressProcessor({
            process,
            readSize: readerOf({ width: 1600, height: 1067 }),
            assess: PASSES,
        });

        const result = await processOne(keptJob({ file: fakeFile('photo-3.jpg', 200 * KB) }));

        expect(seen).toEqual(['strip']);
        expect(result.kept).toBe(true);
    });

    it('keeps a PNG rather than growing it, which is what the re-encode did', async () => {
        const { process, seen } = engineSpy({ strip: engineResult({ bytes: 23_000, format: 'png' }) });
        const processOne = createCompressProcessor({
            process,
            readSize: readerOf({ width: 800, height: 600 }),
            assess: PASSES,
        });

        const result = await processOne(keptJob({
            file: fakeFile('chart.png', 24_576),
            name: 'chart.png',
            format: 'png',
            sourceWidth: 800,
            sourceHeight: 600,
            targetBytes: 50 * KB,
        }));

        expect(seen).toEqual(['strip']);
        expect(result).toMatchObject({ status: 'success', kept: true, resultBytes: 23_000, format: 'png' });
        expect(result.resultBytes).toBeLessThan(24_576);
    });

    it('sends a file over the limit down the encode path, as before', async () => {
        const { process, seen } = engineSpy({ compress: engineResult({ bytes: 48_000 }) });
        const processOne = createCompressProcessor({
            process,
            readSize: readerOf({ width: 1600, height: 1067 }),
            assess: PASSES,
        });

        const result = await processOne(jobOf());

        expect(seen).toEqual(['compress']);
        expect(result).toMatchObject({ status: 'success', kept: false, note: null });
    });

    it('checks the stripped file as hard as an encoded one — bytes', async () => {
        const { process } = engineSpy({ strip: engineResult({ bytes: 200 * KB + 1, format: 'jpeg' }) });
        const processOne = createCompressProcessor({
            process,
            readSize: readerOf({ width: 1600, height: 1067 }),
            assess: PASSES,
        });

        const result = await processOne(keptJob());

        expect(result.status).toBe('unsupported');
        expect(result.error).toMatch(/couldn’t check .* after removing its metadata/);
    });

    it.each(['preserve', 'fit'])('checks the stripped file as hard as an encoded one — dimensions under %s', async (mode) => {
        const { process } = engineSpy({ strip: engineResult({ bytes: 100_000, format: 'jpeg' }) });
        const processOne = createCompressProcessor({
            process,
            readSize: readerOf({ width: 1280, height: 853 }),
            assess: PASSES,
        });

        const result = await processOne(keptJob({ mode }));

        expect(result.status).toBe('unsupported');
        expect(result.error).toMatch(/couldn’t check .* after removing its metadata/);
    });

    it('checks the stripped file as hard as an encoded one — format', async () => {
        const { process } = engineSpy({ strip: engineResult({ bytes: 100_000, format: 'jpeg' }) });
        const processOne = createCompressProcessor({
            process,
            readSize: readerOf({ width: 1600, height: 1067 }),
            assess: PASSES,
        });

        const result = await processOne(keptJob({ format: 'png', name: 'chart.png' }));

        expect(result.status).toBe('unsupported');
        expect(result.error).toMatch(/couldn’t check .* after removing its metadata/);
    });

    /**
     * A stripper that cannot read a container must not cost the visitor the
     * file — and must not send it to the encoder either, which is how a file
     * already under the limit once came back three times larger. The original
     * bytes are handed back, and the note says nothing was removed.
     */
    it('keeps the original bytes, untouched, when the stripper cannot read the file', async () => {
        const { process, seen } = engineSpy({
            strip: () => { throw new Error('unrecognised container'); },
            compress: engineResult({ bytes: 90_000 }),
        });
        const processOne = createCompressProcessor({
            process,
            readSize: readerOf({ width: 1600, height: 1067 }),
            assess: PASSES,
        });

        const job = keptJob();
        const result = await processOne(job);

        expect(seen).toEqual(['strip']);
        expect(result).toMatchObject({ status: 'success', kept: true, resized: false });
        expect(result.blob).toBe(job.file);
        expect(result.note).toBe('Already under 200 KB — kept exactly as it arrived.');
    });

    it('re-throws a cancellation from the stripper instead of falling back', async () => {
        const { process, seen } = engineSpy({
            strip: () => { throw Object.assign(new Error('stopped'), { name: 'AbortError' }); },
            compress: engineResult({ bytes: 90_000 }),
        });
        const processOne = createCompressProcessor({
            process,
            readSize: readerOf({ width: 1600, height: 1067 }),
            assess: PASSES,
        });

        await expect(processOne(keptJob())).rejects.toThrow('stopped');
        expect(seen).toEqual(['strip']);
    });

    /**
     * The engine's own strip result carries a `kept` field of its own — the
     * list of metadata blocks it deliberately did NOT remove, an ICC profile
     * among them. It is a different thing from this row's `kept`, and letting
     * the engine's array through would put a list where the panel expects a
     * yes or no.
     */
    it('does not let the stripper\'s own kept-blocks list become the row\'s flag', async () => {
        const { process } = engineSpy({
            strip: engineResult({ bytes: 100_000, format: 'jpeg', kept: ['icc'], removed: ['exif', 'gps'] }),
        });
        const processOne = createCompressProcessor({
            process,
            readSize: readerOf({ width: 1600, height: 1067 }),
            assess: PASSES,
        });

        const result = await processOne(keptJob());

        expect(result.kept).toBe(true);
    });
});

describe('the kept flag on every other row', () => {
    it('is false and noteless on a seeded row', () => {
        const [row] = seedRows([batchItem('1', 'a.jpg')], { targetBytes: 50 * KB, mode: 'preserve' });

        expect(row.kept).toBe(false);
        expect(row.note).toBeNull();
    });

    it('survives a run for a file that was never reached', async () => {
        const controller = new AbortController();
        controller.abort();
        const { rows } = await runCompressBatch({
            items: [batchItem('1', 'a.jpg')],
            targetBytes: 50 * KB,
            mode: 'preserve',
            processFile: vi.fn(),
            signal: controller.signal,
        });

        expect(rows[0]).toMatchObject({ status: 'cancelled', kept: false, note: null });
    });
});

describe('summarize — a kept file saved whatever the stripper removed', () => {
    it('counts a kept row as a success that saved nothing when nothing was removed', () => {
        const summary = summarize([
            rowOf('success', { id: '1', originalBytes: 120_000, resultBytes: 120_000, kept: true }),
        ]);

        expect(summary).toMatchObject({
            successful: 1,
            inputBytes: 120_000,
            outputBytes: 120_000,
            savedBytes: 0,
            reductionPercent: 0,
        });
    });

    it('divides by every successful input, kept files included', () => {
        const summary = summarize([
            rowOf('success', { id: '1', originalBytes: 100_000, resultBytes: 100_000, kept: true }),
            rowOf('success', { id: '2', originalBytes: 900_000, resultBytes: 200_000, kept: false }),
        ]);

        expect(summary.inputBytes).toBe(1_000_000);
        expect(summary.savedBytes).toBe(700_000);
        expect(summary.reductionPercent).toBe(70);
    });
});
