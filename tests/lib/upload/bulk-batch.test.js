/**
 * The client-side bulk orchestrator.
 *
 * processBatch drives each file through the single-file submit one at a time,
 * records a failure without losing the rest of the batch, and assembles the ZIP
 * only from what succeeded. submitFile and the ZIP assembler are both injected
 * here so the sequencing, the partial-failure bookkeeping and the archive are
 * each asserted on their own. assembleZip is then exercised with the real JSZip
 * and read back through the central-directory reader the panel uses.
 */
import { describe, expect, it, vi } from 'vitest';

import { assembleZip, processBatch } from '@/lib/upload/bulk-batch';
import { readZipEntries } from '@/lib/zip-entries';

function fakeFile(name, bytes = [1, 2, 3]) {
    return new File([new Uint8Array(bytes)], name, { type: 'image/jpeg' });
}

function item(id, name, bytes) {
    return { id, name, file: fakeFile(name, bytes), fields: { format: 'jpeg' }, endpoint: '/api/resize' };
}

/** A submitFile that answers per-file from a name→result map, recording order. */
function scriptedSubmit(byName, order) {
    return vi.fn(async ({ file }) => {
        order?.push(file.name);
        const outcome = byName[file.name];
        if (typeof outcome === 'function') return outcome();
        return outcome;
    });
}

function ok(filename, { originalBytes = 1000, resultBytes = 400 } = {}) {
    return { ok: true, blob: new Blob([new Uint8Array(resultBytes)]), filename, originalBytes, resultBytes };
}

describe('processBatch — sequencing', () => {
    it('processes every file once, in order', async () => {
        const order = [];
        const submitFile = scriptedSubmit({
            'a.jpg': ok('resizo-a.jpg'),
            'b.jpg': ok('resizo-b.jpg'),
            'c.jpg': ok('resizo-c.jpg'),
        }, order);
        const assemble = vi.fn(async () => new Blob(['zip']));

        const outcome = await processBatch({
            items: [item('1', 'a.jpg'), item('2', 'b.jpg'), item('3', 'c.jpg')],
            submitFile,
            assemble,
        });

        expect(submitFile).toHaveBeenCalledTimes(3);
        expect(order).toEqual(['a.jpg', 'b.jpg', 'c.jpg']);
        expect(outcome.ok).toBe(true);
        expect(outcome.filename).toBe('resizo-bulk.zip');
        expect(outcome.rows).toEqual([
            { id: '1', name: 'resizo-a.jpg', originalBytes: 1000, resultBytes: 400 },
            { id: '2', name: 'resizo-b.jpg', originalBytes: 1000, resultBytes: 400 },
            { id: '3', name: 'resizo-c.jpg', originalBytes: 1000, resultBytes: 400 },
        ]);
    });

    it('reports each file moving from processing to done', async () => {
        const submitFile = scriptedSubmit({ 'a.jpg': ok('resizo-a.jpg', { originalBytes: 800, resultBytes: 200 }) });
        const onProgress = vi.fn();

        await processBatch({ items: [item('1', 'a.jpg')], submitFile, onProgress, assemble: async () => new Blob([]) });

        expect(onProgress).toHaveBeenNthCalledWith(1, '1', { status: 'processing' });
        expect(onProgress).toHaveBeenNthCalledWith(2, '1', { status: 'done', originalBytes: 800, resultBytes: 200 });
    });

    it('hands the assembler the processed blobs and returns what it built', async () => {
        const built = new Blob(['ZIP'], { type: 'application/zip' });
        const assemble = vi.fn(async () => built);
        const resultBlob = new Blob([new Uint8Array(400)]);
        const submitFile = vi.fn(async () => ({ ok: true, blob: resultBlob, filename: 'resizo-a.jpg', originalBytes: 1000, resultBytes: 400 }));

        const outcome = await processBatch({ items: [item('1', 'a.jpg')], submitFile, assemble });

        expect(assemble).toHaveBeenCalledWith([{ name: 'resizo-a.jpg', blob: resultBlob }]);
        expect(outcome.zipBlob).toBe(built);
    });
});

describe('processBatch — a failure is recorded, not fatal', () => {
    it('keeps the good files when one in the middle fails', async () => {
        const order = [];
        const submitFile = scriptedSubmit({
            'a.jpg': ok('resizo-a.jpg'),
            'b.jpg': { ok: false, error: 'That file type is not supported by this tool.' },
            'c.jpg': ok('resizo-c.jpg'),
        }, order);
        const onProgress = vi.fn();

        const outcome = await processBatch({
            items: [item('1', 'a.jpg'), item('2', 'b.jpg'), item('3', 'c.jpg')],
            submitFile,
            onProgress,
            assemble: async () => new Blob([]),
        });

        expect(order).toEqual(['a.jpg', 'b.jpg', 'c.jpg']);
        expect(outcome.ok).toBe(true);
        expect(outcome.rows.map((row) => row.id)).toEqual(['1', '3']);
        expect(outcome.failures).toEqual([
            { id: '2', name: 'b.jpg', error: 'That file type is not supported by this tool.' },
        ]);
        expect(onProgress).toHaveBeenCalledWith('2', { status: 'failed', error: 'That file type is not supported by this tool.' });
    });

    it('treats a thrown (non-abort) error as that file failing', async () => {
        const submitFile = vi.fn()
            .mockResolvedValueOnce(ok('resizo-a.jpg'))
            .mockRejectedValueOnce(new Error('boom'));

        const outcome = await processBatch({
            items: [item('1', 'a.jpg'), item('2', 'b.jpg')],
            submitFile,
            assemble: async () => new Blob([]),
        });

        expect(outcome.ok).toBe(true);
        expect(outcome.rows).toHaveLength(1);
        expect(outcome.failures).toHaveLength(1);
        expect(outcome.failures[0].id).toBe('2');
        expect(typeof outcome.failures[0].error).toBe('string');
    });

    it('returns ok:false with no ZIP when every file fails', async () => {
        const submitFile = vi.fn(async () => ({ ok: false, error: 'nope' }));
        const assemble = vi.fn();

        const outcome = await processBatch({
            items: [item('1', 'a.jpg'), item('2', 'b.jpg')],
            submitFile,
            assemble,
        });

        expect(outcome.ok).toBe(false);
        expect(outcome.zipBlob).toBeNull();
        expect(outcome.rows).toEqual([]);
        expect(outcome.failures).toHaveLength(2);
        expect(assemble).not.toHaveBeenCalled();
    });
});

describe('processBatch — cancellation', () => {
    it('stops before the first file when the signal is already aborted', async () => {
        const controller = new AbortController();
        controller.abort();
        const submitFile = vi.fn();

        const outcome = await processBatch({
            items: [item('1', 'a.jpg')],
            submitFile,
            signal: controller.signal,
            assemble: async () => new Blob([]),
        });

        expect(submitFile).not.toHaveBeenCalled();
        expect(outcome).toMatchObject({ ok: false, aborted: true, zipBlob: null });
    });

    it('stops the batch when a file submit aborts, without recording a failure', async () => {
        const abortError = Object.assign(new Error('aborted'), { name: 'AbortError' });
        const submitFile = vi.fn()
            .mockResolvedValueOnce(ok('resizo-a.jpg'))
            .mockRejectedValueOnce(abortError);
        const assemble = vi.fn();

        const outcome = await processBatch({
            items: [item('1', 'a.jpg'), item('2', 'b.jpg'), item('3', 'c.jpg')],
            submitFile,
            assemble,
        });

        expect(submitFile).toHaveBeenCalledTimes(2);
        expect(outcome).toMatchObject({ ok: false, aborted: true });
        expect(outcome.failures).toEqual([]);
        expect(assemble).not.toHaveBeenCalled();
    });
});

describe('processBatch — duplicate output names', () => {
    it('deduplicates names so rows and ZIP entries agree', async () => {
        const submitFile = scriptedSubmit({
            'photo.jpg': ok('resizo-photo.jpg'),
            'photo (1).jpg': ok('resizo-photo.jpg'),
        });
        let received;
        const assemble = vi.fn(async (entries) => { received = entries; return new Blob([]); });

        const outcome = await processBatch({
            items: [item('1', 'photo.jpg'), item('2', 'photo (1).jpg')],
            submitFile,
            assemble,
        });

        expect(outcome.rows.map((row) => row.name)).toEqual(['resizo-photo.jpg', 'resizo-photo-2.jpg']);
        expect(received.map((entry) => entry.name)).toEqual(['resizo-photo.jpg', 'resizo-photo-2.jpg']);
    });
});

describe('assembleZip — a real archive the panel can read back', () => {
    it('writes one entry per blob with the uncompressed sizes intact', async () => {
        const entries = [
            { name: 'resizo-a.jpg', blob: new Blob([new Uint8Array(64)]) },
            { name: 'resizo-b.jpg', blob: new Blob([new Uint8Array(128)]) },
        ];

        const zipBlob = await assembleZip(entries);
        expect(zipBlob.type).toBe('application/zip');

        const read = readZipEntries(await zipBlob.arrayBuffer());
        expect(read.map((entry) => entry.name)).toEqual(['resizo-a.jpg', 'resizo-b.jpg']);
        expect(read.map((entry) => entry.size)).toEqual([64, 128]);
    });

    it('never overwrites a colliding entry name', async () => {
        const entries = [
            { name: 'same.jpg', blob: new Blob([new Uint8Array(10)]) },
            { name: 'same.jpg', blob: new Blob([new Uint8Array(20)]) },
        ];

        const read = readZipEntries(await (await assembleZip(entries)).arrayBuffer());
        expect(read.map((entry) => entry.name)).toEqual(['same.jpg', 'same-2.jpg']);
        expect(new Set(read.map((entry) => entry.name)).size).toBe(2);
    });
});
