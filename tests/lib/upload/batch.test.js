/**
 * The operation-agnostic batch core.
 *
 * Two tools now run a list of files past one operation and report the same
 * things about it: a row per file, a settings record, a summary, an archive,
 * and a retry that touches only what a retry could change. None of that is
 * about compression, so none of it lives in the compressor any more.
 *
 * What this file pins is the part that has no opinion about the work: the row
 * shape, the sequencing, the naming, the cancellation rule and the totals. The
 * compressor's own suites next door are the proof that moving the code here
 * changed nothing about the tool that used to own it, and the converter's suite
 * is the proof that a second operation fits the same frame.
 */
import { describe, expect, it, vi } from 'vitest';

import {
    STATUS,
    STATUS_LABELS,
    ZIP_FAILED_MESSAGE,
    buildZip,
    isCancellation,
    readBlobSize,
    retryableIds,
    runBatch,
    seedRows,
    summarize,
    zipEntries,
} from '@/lib/upload/batch';

function item(id, name, extra = {}) {
    return {
        id,
        name,
        file: { name, size: extra.bytes ?? 400_000 },
        folder: extra.folder ?? null,
        sourceWidth: extra.width ?? 1600,
        sourceHeight: extra.height ?? 1067,
        format: extra.format ?? 'jpeg',
    };
}

function succeeded(filename, extra = {}) {
    return {
        status: STATUS.success,
        kept: false,
        blob: new Blob([filename]),
        filename,
        originalBytes: extra.originalBytes ?? 400_000,
        resultBytes: extra.resultBytes ?? 40_000,
        width: 1600,
        height: 1067,
        note: null,
        ...extra,
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

describe('the shared statuses', () => {
    it('states one label per status, and nothing else', () => {
        expect(Object.keys(STATUS_LABELS).sort()).toEqual(Object.keys(STATUS).sort());
        for (const key of Object.keys(STATUS)) expect(STATUS[key]).toBe(key);
    });

    it('carries the operation-agnostic failure the compressor never needed', () => {
        expect(STATUS.failed).toBe('failed');
        expect(STATUS_LABELS.failed).toBe('Failed');
    });

    it('says the images survived when only the archive did not', () => {
        expect(ZIP_FAILED_MESSAGE).toContain('couldn’t create the ZIP');
    });
});

describe('seedRows', () => {
    it('produces a waiting row per item, carrying whatever settings the run uses', () => {
        const rows = seedRows(
            [item('1', 'a.jpg', { folder: 'Trip', bytes: 1234 }), item('2', 'b.png', { format: 'png' })],
            { outputFormat: 'webp', quality: 80 },
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
            outputFormat: 'webp',
            quality: 80,
            blob: null,
            filename: null,
            error: null,
            resized: false,
            kept: false,
            note: null,
        });
        expect(rows[1]).toMatchObject({ id: '2', format: 'png', status: 'waiting' });
    });

    it('takes no settings at all without inventing any', () => {
        const [row] = seedRows([item('1', 'a.jpg')]);

        expect(row.status).toBe('waiting');
        expect(Object.keys(row)).not.toContain('targetBytes');
    });

    it('is the shape the sequencer hands back for a file it never reached', async () => {
        const controller = new AbortController();
        controller.abort();
        const settings = { outputFormat: 'webp' };

        const { rows } = await runBatch({
            items: [item('1', 'a.jpg')],
            settings,
            processFile: vi.fn(),
            signal: controller.signal,
        });
        const [seeded] = seedRows([item('1', 'a.jpg')], settings);

        expect(Object.keys(rows[0]).sort()).toEqual(Object.keys(seeded).sort());
    });
});

describe('runBatch — sequencing', () => {
    it('refuses to run without a processor', async () => {
        await expect(runBatch({ items: [item('1', 'a.jpg')] })).rejects.toThrow('processFile');
    });

    it('runs every file once, in the order they were chosen', async () => {
        const order = [];
        const processFile = scripted({
            'a.jpg': succeeded('a.webp'),
            'b.jpg': succeeded('b.webp'),
            'c.jpg': succeeded('c.webp'),
        }, order);

        const outcome = await runBatch({
            items: [item('1', 'a.jpg'), item('2', 'b.jpg'), item('3', 'c.jpg')],
            settings: { outputFormat: 'webp' },
            processFile,
        });

        expect(order).toEqual(['a.jpg', 'b.jpg', 'c.jpg']);
        expect(outcome.aborted).toBe(false);
        expect(outcome.rows.map((row) => row.id)).toEqual(['1', '2', '3']);
        expect(outcome.rows.every((row) => row.status === 'success')).toBe(true);
    });

    it('hands each file the whole settings object, whatever is in it', async () => {
        const processFile = scripted({ 'a.jpg': succeeded('a.webp') });

        await runBatch({
            items: [item('1', 'a.jpg', { folder: 'Trip/2024', format: 'png', width: 800, height: 600 })],
            settings: { outputFormat: 'webp', quality: 55, background: '#2f6fed' },
            processFile,
        });

        expect(processFile.mock.calls[0][0]).toMatchObject({
            name: 'a.jpg',
            folder: 'Trip/2024',
            format: 'png',
            sourceWidth: 800,
            sourceHeight: 600,
            outputFormat: 'webp',
            quality: 55,
            background: '#2f6fed',
        });
    });

    it('never lets a setting overwrite the file it was handed', async () => {
        const processFile = scripted({ 'a.jpg': succeeded('a.webp') });

        await runBatch({
            items: [item('1', 'a.jpg')],
            settings: { name: 'not-the-file.png', format: 'gif' },
            processFile,
        });

        expect(processFile.mock.calls[0][0].name).toBe('a.jpg');
        expect(processFile.mock.calls[0][0].format).toBe('jpeg');
    });

    it('reports every state change as it happens', async () => {
        const seen = [];
        await runBatch({
            items: [item('1', 'a.jpg')],
            settings: {},
            processFile: scripted({ 'a.jpg': succeeded('a.webp') }),
            onProgress: (id, patch) => seen.push([id, patch.status]),
        });

        expect(seen).toEqual([['1', 'processing'], ['1', 'success']]);
    });

    it('has nothing to do with an empty list', async () => {
        expect(await runBatch({ items: [], settings: {}, processFile: vi.fn() }))
            .toEqual({ rows: [], aborted: false });
    });
});

describe('runBatch — every finished row has a name of its own', () => {
    it('numbers a repeated filename rather than offering the same download twice', async () => {
        const { rows } = await runBatch({
            items: [item('1', 'IMG_0001.jpg'), item('2', 'IMG_0001.jpg')],
            settings: {},
            processFile: vi.fn(async () => succeeded('IMG_0001.webp')),
        });

        expect(rows.map((row) => row.filename)).toEqual(['IMG_0001.webp', 'IMG_0001-2.webp']);
    });

    it('cannot collide with a name a retry is leaving on screen', async () => {
        const { rows } = await runBatch({
            items: [item('1', 'IMG_0001.jpg')],
            settings: {},
            reservedNames: ['IMG_0001.webp'],
            processFile: vi.fn(async () => succeeded('IMG_0001.webp')),
        });

        expect(rows[0].filename).toBe('IMG_0001-2.webp');
    });
});

describe('runBatch — a failure is one row, not the batch', () => {
    it('fails only the file whose processor threw, in words the tool chose', async () => {
        const { rows } = await runBatch({
            items: [item('1', 'a.jpg'), item('2', 'b.jpg'), item('3', 'c.jpg')],
            settings: { outputFormat: 'webp' },
            processFile: scripted({
                'a.jpg': succeeded('a.webp'),
                'b.jpg': () => { throw new Error('engine blew up'); },
                'c.jpg': succeeded('c.webp'),
            }),
            onFailure: (one) => ({ status: STATUS.unmet, error: `${one.name} did not get there.` }),
        });

        expect(rows.map((row) => row.status)).toEqual(['success', 'unmet', 'success']);
        expect(rows[1].error).toBe('b.jpg did not get there.');
    });

    it('says something a person can read when the tool named no sentence of its own', async () => {
        const { rows } = await runBatch({
            items: [item('1', 'a.jpg')],
            settings: {},
            processFile: vi.fn(async () => { throw new Error('engine blew up'); }),
        });

        expect(rows[0].status).toBe('failed');
        expect(rows[0].error).toBe('That image could not be processed on this device.');
    });

    it('never leaks the thrown error text into the row', async () => {
        const { rows } = await runBatch({
            items: [item('1', 'a.jpg')],
            settings: {},
            processFile: vi.fn(async () => { throw new Error('TypeError: wasm memory out of bounds at 0x1f'); }),
        });

        expect(rows[0].error).not.toContain('wasm');
    });
});

describe('runBatch — cancellation', () => {
    it('marks the file being worked on and every one behind it as cancelled', async () => {
        const controller = new AbortController();
        const processFile = vi.fn(async ({ name }) => {
            if (name === 'b.jpg') {
                controller.abort();
                const error = new Error('aborted');
                error.name = 'AbortError';
                throw error;
            }
            return succeeded(name.replace('.jpg', '.webp'));
        });

        const outcome = await runBatch({
            items: [item('1', 'a.jpg'), item('2', 'b.jpg'), item('3', 'c.jpg')],
            settings: {},
            processFile,
            signal: controller.signal,
        });

        expect(outcome.aborted).toBe(true);
        expect(outcome.rows.map((row) => row.status)).toEqual(['success', 'cancelled', 'cancelled']);
    });

    it('never starts a file once the signal is already aborted', async () => {
        const controller = new AbortController();
        controller.abort();
        const processFile = vi.fn();

        const outcome = await runBatch({
            items: [item('1', 'a.jpg')],
            settings: {},
            processFile,
            signal: controller.signal,
        });

        expect(processFile).not.toHaveBeenCalled();
        expect(outcome.aborted).toBe(true);
        expect(outcome.rows[0].status).toBe('cancelled');
    });
});

describe('isCancellation', () => {
    it('recognises the three ways a stop reaches this layer', () => {
        const controller = new AbortController();
        controller.abort();

        expect(isCancellation(new Error('x'), controller.signal)).toBe(true);
        expect(isCancellation(Object.assign(new Error('x'), { name: 'AbortError' }))).toBe(true);
        expect(isCancellation(Object.assign(new Error('x'), { code: 'cancelled' }))).toBe(true);
    });

    it('is not fooled by an ordinary failure', () => {
        expect(isCancellation(new Error('engine blew up'))).toBe(false);
        expect(isCancellation(null)).toBe(false);
    });
});

describe('summarize', () => {
    function rowOf(status, extra = {}) {
        return { id: extra.id ?? status, status, originalBytes: null, resultBytes: null, ...extra };
    }

    it('reads as nothing at all for an empty batch', () => {
        expect(summarize([])).toEqual({
            selected: 0,
            successful: 0,
            kept: 0,
            failed: 0,
            unmet: 0,
            unsupported: 0,
            unsafe: 0,
            cancelled: 0,
            waiting: 0,
            processing: 0,
            inputBytes: 0,
            outputBytes: 0,
            savedBytes: 0,
            differenceBytes: 0,
            reductionPercent: null,
        });
    });

    it('counts every status, the failed one included', () => {
        const summary = summarize([
            rowOf('success', { id: '1', originalBytes: 100, resultBytes: 40 }),
            rowOf('success', { id: '2', originalBytes: 100, resultBytes: 100, kept: true }),
            rowOf('failed', { id: '3' }),
            rowOf('unmet', { id: '4' }),
            rowOf('unsupported', { id: '5' }),
            rowOf('unsafe', { id: '6' }),
            rowOf('cancelled', { id: '7' }),
            rowOf('waiting', { id: '8' }),
            rowOf('processing', { id: '9' }),
        ]);

        expect(summary).toMatchObject({
            selected: 9,
            successful: 2,
            kept: 1,
            failed: 1,
            unmet: 1,
            unsupported: 1,
            unsafe: 1,
            cancelled: 1,
            waiting: 1,
            processing: 1,
        });
    });

    it('reports the difference in the direction the output went', () => {
        const grew = summarize([rowOf('success', { id: '1', originalBytes: 1000, resultBytes: 2400 })]);
        const shrank = summarize([rowOf('success', { id: '1', originalBytes: 4000, resultBytes: 1000 })]);

        expect(grew).toMatchObject({ savedBytes: -1400, differenceBytes: 1400 });
        expect(shrank).toMatchObject({ savedBytes: 3000, differenceBytes: -3000 });
    });

    it('adds up the successes only, so a failed row cannot invent a saving', () => {
        expect(summarize([
            rowOf('success', { id: '1', originalBytes: 1000, resultBytes: 400 }),
            rowOf('failed', { id: '2', originalBytes: 9_000_000, resultBytes: null }),
        ])).toMatchObject({ inputBytes: 1000, outputBytes: 400, reductionPercent: 60 });
    });

    it('returns the same answer for the same rows, every time', () => {
        const rows = [rowOf('success', { id: '1', originalBytes: 1000, resultBytes: 333 }), rowOf('failed', { id: '2' })];

        expect(summarize(rows)).toEqual(summarize(rows));
    });
});

describe('the archive', () => {
    function zipRow(id, filename, { folder = null, status = 'success' } = {}) {
        return { id, status, folder, filename, blob: new Blob([filename]) };
    }

    it('takes the successes, in the order they were chosen, under their folders', () => {
        const entries = zipEntries([
            zipRow('1', 'a.webp', { folder: 'Trip' }),
            zipRow('2', 'b.webp', { status: 'failed' }),
            zipRow('3', 'c.webp'),
        ]);

        expect(entries.map((entry) => entry.name)).toEqual(['Trip/a.webp', 'c.webp']);
        expect(entries.map((entry) => entry.id)).toEqual(['1', '3']);
    });

    it('numbers a collision inside the archive too', () => {
        const entries = zipEntries([zipRow('1', 'a.webp'), zipRow('2', 'a.webp')]);

        expect(entries.map((entry) => entry.name)).toEqual(['a.webp', 'a-2.webp']);
    });

    it('builds the archive under the name the tool asked for', async () => {
        const assemble = vi.fn(async () => new Blob(['zip']));

        const outcome = await buildZip([zipRow('1', 'a.webp'), zipRow('2', 'b.webp')], {
            assemble,
            filename: 'resizo-converted-images.zip',
        });

        expect(outcome.filename).toBe('resizo-converted-images.zip');
        expect(outcome.count).toBe(2);
        expect(assemble.mock.calls[0][0].map((entry) => entry.name)).toEqual(['a.webp', 'b.webp']);
    });

    it('refuses to build a nameless archive, because a download needs a name', async () => {
        await expect(buildZip([zipRow('1', 'a.webp')], { assemble: vi.fn() }))
            .rejects.toThrow('filename');
    });

    it('refuses an empty manifest', async () => {
        await expect(buildZip([zipRow('1', 'a.webp', { status: 'failed' })], {
            assemble: vi.fn(),
            filename: 'x.zip',
        })).rejects.toThrow('nothing-to-zip');
    });
});

describe('retryableIds', () => {
    function rowOf(status, id) {
        return { id, status };
    }

    it('offers a retry for what might work next time, and never for an unsupported file', () => {
        const rows = [
            rowOf('success', '1'),
            rowOf('unmet', '2'),
            rowOf('unsafe', '3'),
            rowOf('cancelled', '4'),
            rowOf('failed', '5'),
            rowOf('unsupported', '6'),
            rowOf('waiting', '7'),
        ];

        expect(retryableIds(rows)).toEqual(['2', '3', '4', '5']);
    });
});

describe('readBlobSize', () => {
    /** The 26 bytes a PNG header reader actually looks at. */
    function pngBytes(width, height, colourType) {
        const bytes = new Uint8Array(33);
        bytes.set([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A], 0);
        bytes.set([0, 0, 0, 13], 8);
        bytes.set([0x49, 0x48, 0x44, 0x52], 12);
        new DataView(bytes.buffer).setUint32(16, width);
        new DataView(bytes.buffer).setUint32(20, height);
        bytes[24] = 8;
        bytes[25] = colourType;
        return bytes;
    }

    it('reads a blob’s own header without decoding it', async () => {
        const size = await readBlobSize(new Blob([pngBytes(1600, 1067, 6)]));

        expect(size).toEqual({ width: 1600, height: 1067, hasAlpha: true });
    });

    it('reports no alpha channel for a truecolour PNG', async () => {
        expect((await readBlobSize(new Blob([pngBytes(80, 60, 2)]))).hasAlpha).toBe(false);
    });

    it('reads nothing at all from something that is not an image', async () => {
        expect(await readBlobSize(new Blob(['not an image']))).toBeNull();
        expect(await readBlobSize(null)).toBeNull();
    });
});
