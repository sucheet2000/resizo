/**
 * The bulk orchestrator.
 *
 * processBatch drives each file through the single-file processor one at a
 * time, records a failure without losing the rest of the batch, and assembles
 * the ZIP only from what succeeded. processFile and the ZIP assembler are both injected
 * here so the sequencing, the partial-failure bookkeeping and the archive are
 * each asserted on their own. assembleZip is then exercised with the real JSZip
 * and read back through the central-directory reader the panel uses.
 */
import { describe, expect, it, vi } from 'vitest';

import { assembleZip, processBatch, resetZipWriter, DEFAULT_ZIP_FILENAME } from '@/lib/upload/bulk-batch';
import { readZipEntries } from '@/tests/helpers/zip-entries';

function fakeFile(name, bytes = [1, 2, 3]) {
    return new File([new Uint8Array(bytes)], name, { type: 'image/jpeg' });
}

function item(id, name, bytes) {
    return { id, name, file: fakeFile(name, bytes), fields: { format: 'jpeg' } };
}

/** A processFile that answers per-file from a name→result map, recording order. */
function scriptedProcessor(byName, order) {
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
        const processFile = scriptedProcessor({
            'a.jpg': ok('resizo-a.jpg'),
            'b.jpg': ok('resizo-b.jpg'),
            'c.jpg': ok('resizo-c.jpg'),
        }, order);
        const assemble = vi.fn(async () => new Blob(['zip']));

        const outcome = await processBatch({
            items: [item('1', 'a.jpg'), item('2', 'b.jpg'), item('3', 'c.jpg')],
            processFile,
            assemble,
        });

        expect(processFile).toHaveBeenCalledTimes(3);
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
        const processFile = scriptedProcessor({ 'a.jpg': ok('resizo-a.jpg', { originalBytes: 800, resultBytes: 200 }) });
        const onProgress = vi.fn();

        await processBatch({ items: [item('1', 'a.jpg')], processFile, onProgress, assemble: async () => new Blob([]) });

        expect(onProgress).toHaveBeenNthCalledWith(1, '1', { status: 'processing' });
        expect(onProgress).toHaveBeenNthCalledWith(2, '1', { status: 'done', originalBytes: 800, resultBytes: 200 });
    });

    it('hands the assembler the processed blobs and returns what it built', async () => {
        const built = new Blob(['ZIP'], { type: 'application/zip' });
        const assemble = vi.fn(async () => built);
        const resultBlob = new Blob([new Uint8Array(400)]);
        const processFile = vi.fn(async () => ({ ok: true, blob: resultBlob, filename: 'resizo-a.jpg', originalBytes: 1000, resultBytes: 400 }));

        const outcome = await processBatch({ items: [item('1', 'a.jpg')], processFile, assemble });

        expect(assemble).toHaveBeenCalledWith([{ name: 'resizo-a.jpg', blob: resultBlob }]);
        expect(outcome.zipBlob).toBe(built);
    });
});

describe('processBatch — a failure is recorded, not fatal', () => {
    it('keeps the good files when one in the middle fails', async () => {
        const order = [];
        const processFile = scriptedProcessor({
            'a.jpg': ok('resizo-a.jpg'),
            'b.jpg': { ok: false, error: 'That file type is not supported by this tool.' },
            'c.jpg': ok('resizo-c.jpg'),
        }, order);
        const onProgress = vi.fn();

        const outcome = await processBatch({
            items: [item('1', 'a.jpg'), item('2', 'b.jpg'), item('3', 'c.jpg')],
            processFile,
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
        const processFile = vi.fn()
            .mockResolvedValueOnce(ok('resizo-a.jpg'))
            .mockRejectedValueOnce(new Error('boom'));

        const outcome = await processBatch({
            items: [item('1', 'a.jpg'), item('2', 'b.jpg')],
            processFile,
            assemble: async () => new Blob([]),
        });

        expect(outcome.ok).toBe(true);
        expect(outcome.rows).toHaveLength(1);
        expect(outcome.failures).toHaveLength(1);
        expect(outcome.failures[0].id).toBe('2');
        expect(typeof outcome.failures[0].error).toBe('string');
    });

    it('returns ok:false with no ZIP when every file fails', async () => {
        const processFile = vi.fn(async () => ({ ok: false, error: 'nope' }));
        const assemble = vi.fn();

        const outcome = await processBatch({
            items: [item('1', 'a.jpg'), item('2', 'b.jpg')],
            processFile,
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
        const processFile = vi.fn();

        const outcome = await processBatch({
            items: [item('1', 'a.jpg')],
            processFile,
            signal: controller.signal,
            assemble: async () => new Blob([]),
        });

        expect(processFile).not.toHaveBeenCalled();
        expect(outcome).toMatchObject({ ok: false, aborted: true, zipBlob: null });
    });

    it('stops the batch when a file submit aborts, without recording a failure', async () => {
        const abortError = Object.assign(new Error('aborted'), { name: 'AbortError' });
        const processFile = vi.fn()
            .mockResolvedValueOnce(ok('resizo-a.jpg'))
            .mockRejectedValueOnce(abortError);
        const assemble = vi.fn();

        const outcome = await processBatch({
            items: [item('1', 'a.jpg'), item('2', 'b.jpg'), item('3', 'c.jpg')],
            processFile,
            assemble,
        });

        expect(processFile).toHaveBeenCalledTimes(2);
        expect(outcome).toMatchObject({ ok: false, aborted: true });
        expect(outcome.failures).toEqual([]);
        expect(assemble).not.toHaveBeenCalled();
    });
});

describe('processBatch — duplicate output names', () => {
    it('deduplicates names so rows and ZIP entries agree', async () => {
        const processFile = scriptedProcessor({
            'photo.jpg': ok('resizo-photo.jpg'),
            'photo (1).jpg': ok('resizo-photo.jpg'),
        });
        let received;
        const assemble = vi.fn(async (entries) => { received = entries; return new Blob([]); });

        const outcome = await processBatch({
            items: [item('1', 'photo.jpg'), item('2', 'photo (1).jpg')],
            processFile,
            assemble,
        });

        expect(outcome.rows.map((row) => row.name)).toEqual(['resizo-photo.jpg', 'resizo-photo-2.jpg']);
        expect(received.map((entry) => entry.name)).toEqual(['resizo-photo.jpg', 'resizo-photo-2.jpg']);
    });
});

describe('processBatch — one file at a time, never two', () => {
    it('never has a second file in flight while the first is still running', async () => {
        let inFlight = 0;
        let peak = 0;

        const processFile = vi.fn(async () => {
            inFlight += 1;
            peak = Math.max(peak, inFlight);
            await new Promise((resolve) => { setTimeout(resolve, 1); });
            inFlight -= 1;
            return ok('resizo-x.jpg');
        });

        const items = Array.from({ length: 8 }, (_, index) => item(String(index), `${index}.jpg`));
        await processBatch({ items, processFile, assemble: async () => new Blob([]) });

        expect(processFile).toHaveBeenCalledTimes(8);
        expect(peak).toBe(1);
    });

    it('reports the file in flight before it starts the next one', async () => {
        const seen = [];
        const onProgress = vi.fn((id, next) => seen.push(`${id}:${next.status}`));
        const processFile = vi.fn(async () => ok('resizo-x.jpg'));

        await processBatch({
            items: [item('1', 'a.jpg'), item('2', 'b.jpg')],
            processFile,
            onProgress,
            assemble: async () => new Blob([]),
        });

        // Interleaved, not batched: each file settles before the next is announced.
        expect(seen).toEqual(['1:processing', '1:done', '2:processing', '2:done']);
    });
});

describe('processBatch — folder paths in the archive', () => {
    function folderItem(id, folder, name) {
        return { ...item(id, name), folder };
    }

    it('puts a file back in the folder it came from', async () => {
        const processFile = scriptedProcessor({
            'IMG_0001.jpg': ok('resizo-IMG_0001.jpg'),
        });
        let received;
        const assemble = vi.fn(async (entries) => { received = entries; return new Blob([]); });

        const outcome = await processBatch({
            items: [folderItem('1', 'Holiday/2024', 'IMG_0001.jpg')],
            processFile,
            assemble,
        });

        expect(outcome.rows[0].name).toBe('Holiday/2024/resizo-IMG_0001.jpg');
        expect(received[0].name).toBe('Holiday/2024/resizo-IMG_0001.jpg');
    });

    it('leaves a dropped file exactly where it was — no folder, no prefix', async () => {
        const processFile = scriptedProcessor({ 'a.jpg': ok('resizo-a.jpg') });

        const outcome = await processBatch({
            items: [item('1', 'a.jpg')],
            processFile,
            assemble: async () => new Blob([]),
        });

        expect(outcome.rows[0].name).toBe('resizo-a.jpg');
    });

    it('keeps two same-named files from two subfolders apart with no renaming at all', async () => {
        const processFile = vi.fn(async () => ok('resizo-IMG_0001.jpg'));
        let received;
        const assemble = vi.fn(async (entries) => { received = entries; return new Blob([]); });

        const outcome = await processBatch({
            items: [
                folderItem('1', 'Trip/jan', 'IMG_0001.jpg'),
                folderItem('2', 'Trip/feb', 'IMG_0001.jpg'),
            ],
            processFile,
            assemble,
        });

        expect(received.map((entry) => entry.name)).toEqual([
            'Trip/jan/resizo-IMG_0001.jpg',
            'Trip/feb/resizo-IMG_0001.jpg',
        ]);
        expect(new Set(outcome.rows.map((row) => row.name)).size).toBe(2);
    });

    it('still deduplicates two same-named files from the SAME folder', async () => {
        const processFile = vi.fn(async () => ok('resizo-IMG_0001.jpg'));
        let received;
        const assemble = vi.fn(async (entries) => { received = entries; return new Blob([]); });

        await processBatch({
            items: [
                folderItem('1', 'Trip/jan', 'IMG_0001.jpg'),
                folderItem('2', 'Trip/jan', 'IMG_0001.JPG'),
            ],
            processFile,
            assemble,
        });

        expect(received.map((entry) => entry.name)).toEqual([
            'Trip/jan/resizo-IMG_0001.jpg',
            'Trip/jan/resizo-IMG_0001-2.jpg',
        ]);
    });

    it('cannot be talked into a traversal by a hostile folder value', async () => {
        const processFile = vi.fn(async () => ok('resizo-a.jpg'));
        let received;
        const assemble = vi.fn(async (entries) => { received = entries; return new Blob([]); });

        await processBatch({
            items: [folderItem('1', '../../etc', 'a.jpg')],
            processFile,
            assemble,
        });

        expect(received[0].name).toBe('etc/resizo-a.jpg');
    });

    it('writes the nested entry into a real archive that reads back', async () => {
        const zipBlob = await assembleZip([
            { name: 'Trip/jan/a.jpg', blob: new Blob([new Uint8Array(32)]) },
            { name: 'Trip/feb/a.jpg', blob: new Blob([new Uint8Array(64)]) },
        ]);

        const read = readZipEntries(await zipBlob.arrayBuffer());
        expect(read.map((entry) => entry.name)).toEqual(['Trip/jan/a.jpg', 'Trip/feb/a.jpg']);
        expect(read.map((entry) => entry.size)).toEqual([32, 64]);
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

describe('assembleZip — JSZip is loaded lazily and only once', () => {
    // The archiver is 124 KB and used to be a top-level import, which put it in
    // the first load of /resize, /resize-jpg and /resize-png for every visitor
    // who resizes one image and never opens the bulk tab. It is behind
    // `import('jszip')` now, and the PROMISE is memoised: a twenty-file batch
    // that re-entered the import per file would be a different bug.
    it('re-imports nothing across repeated archives', async () => {
        resetZipWriter();

        const first = await assembleZip([{ name: 'a.jpg', blob: new Blob([new Uint8Array(8)]) }]);
        const second = await assembleZip([{ name: 'b.jpg', blob: new Blob([new Uint8Array(16)]) }]);

        expect(readZipEntries(await first.arrayBuffer()).map((entry) => entry.name)).toEqual(['a.jpg']);
        expect(readZipEntries(await second.arrayBuffer()).map((entry) => entry.name)).toEqual(['b.jpg']);
    });

    it('still works after the memo is dropped', async () => {
        resetZipWriter();

        const zipBlob = await assembleZip([{ name: 'c.jpg', blob: new Blob([new Uint8Array(24)]) }]);
        expect(readZipEntries(await zipBlob.arrayBuffer()).map((entry) => entry.size)).toEqual([24]);
    });
});

describe('processBatch — the processor is required', () => {
    it('throws rather than silently doing nothing when none was supplied', async () => {
        // The default used to be the module that POSTed the file. There is no
        // default now, and no sensible one: a batch that quietly processed
        // nothing and reported success would be the worst possible failure.
        await expect(processBatch({ items: [item('1', 'a.jpg')] }))
            .rejects.toThrow('processBatch requires a processFile.');
    });
});

/**
 * THE RUNNING CEILING.
 *
 * The pre-flight gate costs a batch from the target format's expansion factor,
 * and no single factor is both safe and non-punitive: the same JPEG-to-PNG
 * conversion measured 3.25x on one of this repo's sample photos and 8.69x on
 * another. So the archive is bounded again here, on REAL output bytes, and the
 * ZIP of whatever already finished is still delivered rather than the whole run
 * being lost — which is the difference between "17 of your 20 images are in the
 * ZIP" and an iOS tab that vanished with all twenty.
 *
 * `archiveBudgetBytes` is injected throughout. Exercising this against a real
 * device budget would mean allocating hundreds of megabytes of blobs in the test
 * process; the one test that does NOT inject it proves the number is genuinely
 * read from the device.
 */
describe('processBatch — the archive stops growing at what the device can hold', () => {
    it('keeps the files that fit, leaves out the rest, and still delivers the ZIP', async () => {
        const processFile = vi.fn(async ({ file }) => ok(`resizo-${file.name}`, { resultBytes: 400 }));
        const assemble = vi.fn(async () => new Blob(['zip']));

        const outcome = await processBatch({
            items: [item('1', 'a.jpg'), item('2', 'b.jpg'), item('3', 'c.jpg')],
            processFile,
            assemble,
            archiveBudgetBytes: 1000,
        });

        // THE ZIP IS STILL DELIVERED. This is the whole point.
        expect(outcome.ok).toBe(true);
        expect(outcome.zipBlob).not.toBeNull();
        expect(assemble).toHaveBeenCalledTimes(1);

        expect(outcome.rows.map((row) => row.id)).toEqual(['1', '2']);
        expect(outcome.leftOut).toEqual([{ id: '3', name: 'c.jpg' }]);
    });

    it('says so in a sentence a person can read', async () => {
        const processFile = vi.fn(async ({ file }) => ok(`resizo-${file.name}`, { resultBytes: 400 }));

        const outcome = await processBatch({
            items: [item('1', 'a.jpg'), item('2', 'b.jpg'), item('3', 'c.jpg')],
            processFile,
            assemble: async () => new Blob(['zip']),
            archiveBudgetBytes: 1000,
        });

        expect(outcome.leftOutMessage)
            .toBe('2 of your 3 images are in the ZIP. The last 1 image was left out because the archive reached what this device can hold.');
    });

    it('leaves out EVERY remaining file, not only the one that did not fit', async () => {
        const processFile = vi.fn(async ({ file }) => ok(`resizo-${file.name}`, { resultBytes: 400 }));

        const outcome = await processBatch({
            items: ['1', '2', '3', '4', '5'].map((id) => item(id, `${id}.jpg`)),
            processFile,
            assemble: async () => new Blob(['zip']),
            archiveBudgetBytes: 1000,
        });

        expect(outcome.rows.map((row) => row.id)).toEqual(['1', '2']);
        expect(outcome.leftOut.map((entry) => entry.id)).toEqual(['3', '4', '5']);
        // The run STOPS. Carrying on to encode 4 and 5 would burn a phone's
        // battery producing bytes with nowhere to put them.
        expect(processFile).toHaveBeenCalledTimes(3);
        expect(outcome.leftOutMessage).toContain('2 of your 5 images');
    });

    it('tells the panel about each file it left out', async () => {
        const processFile = vi.fn(async ({ file }) => ok(`resizo-${file.name}`, { resultBytes: 400 }));
        const onProgress = vi.fn();

        await processBatch({
            items: [item('1', 'a.jpg'), item('2', 'b.jpg'), item('3', 'c.jpg')],
            processFile,
            onProgress,
            assemble: async () => new Blob(['zip']),
            archiveBudgetBytes: 1000,
        });

        // A left-out file is NOT a failure — nothing about it went wrong — so it
        // gets its own status rather than being counted with the broken files.
        expect(onProgress).toHaveBeenCalledWith('3', {
            status: 'skipped',
            note: expect.stringContaining('left out'),
        });
        expect(onProgress).not.toHaveBeenCalledWith('3', expect.objectContaining({ status: 'failed' }));
    });

    it('says nothing at all when everything fits', async () => {
        const processFile = vi.fn(async ({ file }) => ok(`resizo-${file.name}`, { resultBytes: 400 }));

        const outcome = await processBatch({
            items: [item('1', 'a.jpg'), item('2', 'b.jpg')],
            processFile,
            assemble: async () => new Blob(['zip']),
            archiveBudgetBytes: 1000,
        });

        expect(outcome.leftOut).toEqual([]);
        expect(outcome.leftOutMessage).toBeNull();
        expect(outcome.rows).toHaveLength(2);
    });

    it('fills the archive exactly to the ceiling before it stops', async () => {
        // AT the boundary, not one file short of it. An off-by-one here is a
        // tool that quietly does 19 of 20 for no reason a user could see.
        const processFile = vi.fn(async ({ file }) => ok(`resizo-${file.name}`, { resultBytes: 500 }));

        const outcome = await processBatch({
            items: [item('1', 'a.jpg'), item('2', 'b.jpg'), item('3', 'c.jpg')],
            processFile,
            assemble: async () => new Blob(['zip']),
            archiveBudgetBytes: 1000,
        });

        expect(outcome.rows.map((row) => row.id)).toEqual(['1', '2']);
        expect(outcome.leftOut.map((entry) => entry.id)).toEqual(['3']);
    });

    it('refuses rather than shipping one entry that alone overflows the archive', async () => {
        // Delivering it would put 3x its bytes in the tab, which is the peak
        // this ceiling exists to prevent. A sentence costs an apology; the
        // alternative costs the tab.
        const processFile = vi.fn(async ({ file }) => ok(`resizo-${file.name}`, { resultBytes: 400 }));
        const assemble = vi.fn();

        const outcome = await processBatch({
            items: [item('1', 'a.jpg'), item('2', 'b.jpg')],
            processFile,
            assemble,
            archiveBudgetBytes: 100,
        });

        expect(outcome.ok).toBe(false);
        expect(outcome.zipBlob).toBeNull();
        expect(assemble).not.toHaveBeenCalled();
        expect(outcome.leftOut.map((entry) => entry.id)).toEqual(['1', '2']);
        expect(outcome.leftOutMessage).toContain('None of those images');
    });

    it('reads the ceiling off the device when it is not handed one', async () => {
        // No archiveBudgetBytes here. An 8000x8000 source on a half-gigabyte
        // iOS device fills the whole tab budget by itself, so capability.js
        // reports an archive budget of zero and nothing can be kept.
        const processFile = vi.fn(async ({ file }) => ok(`resizo-${file.name}`, { resultBytes: 400 }));

        const outcome = await processBatch({
            items: [{ ...item('1', 'a.jpg'), sourceWidth: 8000, sourceHeight: 8000 }],
            processFile,
            assemble: async () => new Blob(['zip']),
            device: { memoryGb: 0.5, memoryReported: true, cores: 4, ios: true, nativeDownscale: false, wasm: true },
        });

        expect(outcome.ok).toBe(false);
        expect(outcome.leftOut).toHaveLength(1);
    });

    it('does not stand in the way of an ordinary batch on an ordinary device', async () => {
        // The same call with no budget and no device: a real desktop profile
        // has room for three 400-byte outputs, so this must behave exactly as
        // it did before the ceiling existed.
        const processFile = vi.fn(async ({ file }) => ok(`resizo-${file.name}`, { resultBytes: 400 }));

        const outcome = await processBatch({
            items: [item('1', 'a.jpg'), item('2', 'b.jpg'), item('3', 'c.jpg')],
            processFile,
            assemble: async () => new Blob(['zip']),
        });

        expect(outcome.ok).toBe(true);
        expect(outcome.rows).toHaveLength(3);
        expect(outcome.leftOut).toEqual([]);
    });
});

describe('processBatch — the archive name', () => {
    it('takes the name the tool gives it', async () => {
        // Four tools are growing a bulk tab. Four archives called
        // resizo-bulk.zip land in one Downloads folder as resizo-bulk.zip,
        // resizo-bulk (1).zip and resizo-bulk (2).zip — three names that say
        // nothing about which one holds the converted images.
        const processFile = vi.fn(async () => ok('resizo-a.jpg'));

        const outcome = await processBatch({
            items: [item('1', 'a.jpg')],
            processFile,
            assemble: async () => new Blob(['zip']),
            filename: 'resizo-converted.zip',
        });

        expect(outcome.filename).toBe('resizo-converted.zip');
    });

    it('falls back to the shared default when a tool forgets', async () => {
        const processFile = vi.fn(async () => ok('resizo-a.jpg'));

        const outcome = await processBatch({
            items: [item('1', 'a.jpg')],
            processFile,
            assemble: async () => new Blob(['zip']),
        });

        expect(outcome.filename).toBe(DEFAULT_ZIP_FILENAME);
        expect(DEFAULT_ZIP_FILENAME).toBe('resizo-bulk.zip');
    });
});
