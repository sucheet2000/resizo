/**
 * Bulk resize, run on the device.
 *
 * This is the biggest single win of the migration: twenty phone photos used to
 * mean up to 80 MB uploaded and a ZIP downloaded back. The whole batch is
 * processed in the tab and nothing is uploaded at all.
 *
 * The engine is mocked at its module boundary (lib/image-client/client) — no
 * Worker is constructed, exactly as in the single-file seam test. "Nothing was
 * uploaded" is asserted from the network side, by a sentinel that throws on any
 * XHR, fetch or sendBeacon, rather than by mocking an upload module out and
 * checking it was not called. Everything between is the real thing: the real
 * createFileProcessor, the real processBatch, the real JSZip assembler, and the
 * real ZIP read back through the same central-directory reader the result panel
 * uses.
 *
 * WHAT CHANGED WHEN THE SERVER WENT
 *
 * Three of the cases below used to end with "…so that one file goes to the
 * server". A device that cannot take a file is now the end of the story for
 * that file, so those cases assert the OTHER half of the same promise, which
 * was always the more important one: the batch survives. One refused frame is
 * recorded as one refused frame, in the gate's own words, and the other
 * nineteen still finish and still zip.
 *
 * What has not changed:
 *
 *  - STRICTLY ONE AT A TIME. Peak memory, not throughput, is what kills a phone
 *    tab, so two files must never be in flight together. The test counts.
 *  - A FILE'S FAILURE IS ITS OWN. Nineteen good frames must not be lost to one
 *    bad one: the correct outcome is a partial ZIP plus a list of what was left
 *    out.
 *  - A CANCEL STOPS THE RUN. It is not a per-file failure and it does not mark
 *    nineteen files failed on the way out.
 */
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { processImageMock, terminateWorkerMock } = vi.hoisted(() => ({
    processImageMock: vi.fn(),
    terminateWorkerMock: vi.fn(),
}));

vi.mock('@/lib/image-client/client', () => ({
    processImage: processImageMock,
    terminateWorker: terminateWorkerMock,
}));

import { useBulkResize } from '@/lib/hooks/useBulkResize';
import { readZipEntries } from '@/tests/helpers/zip-entries';
import { installNetworkSentinel } from '../helpers.jsx';

let network;

beforeEach(() => {
    network = installNetworkSentinel();
    processImageMock.mockReset();
    terminateWorkerMock.mockReset();
    vi.spyOn(window.HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
});

afterEach(() => {
    network.restore();
    vi.restoreAllMocks();
});

/** The pre-flight gate reads a file's declared type and size, not its bytes. */
function imageFile(name) {
    return new File([new Uint8Array(16)], name, { type: 'image/jpeg' });
}

function batch(names, { sourceWidth = 1600, sourceHeight = 1200 } = {}) {
    return names.map((name, index) => ({
        id: String(index + 1),
        name,
        file: imageFile(name),
        fields: { format: 'jpeg', width: '800' },
        sourceWidth,
        sourceHeight,
    }));
}

function engineOutcome(file, { bytes = 400 } = {}) {
    return {
        blob: new Blob([new Uint8Array(bytes)], { type: 'image/jpeg' }),
        filename: `resizo-processed-${file.name}`,
        format: 'jpeg',
        width: 800,
        height: 600,
        originalBytes: file.size,
        resultBytes: bytes,
        savedPercent: 60,
    };
}

/**
 * An engine that records the order it was called in and how many jobs were live
 * at once. The await is what gives an overlapping second call somewhere to
 * appear — without it the whole mock would be synchronous and could not observe
 * concurrency at all.
 */
function recordingEngine(script = {}) {
    const state = { order: [], live: 0, peak: 0 };

    processImageMock.mockImplementation(async (op, file) => {
        state.live += 1;
        state.peak = Math.max(state.peak, state.live);
        state.order.push(file.name);

        try {
            await new Promise((resolve) => { setTimeout(resolve, 0); });
            const scripted = script[file.name];
            if (typeof scripted === 'function') return scripted(file);
            return engineOutcome(file);
        } finally {
            state.live -= 1;
        }
    });

    return state;
}

async function run(items, options = {}) {
    const hook = renderHook(() => useBulkResize({ op: 'resize', ...options }));
    let outcome;
    await act(async () => {
        outcome = await hook.result.current.run(items);
    });
    return { ...hook, outcome };
}

describe('bulk resize — the whole batch runs on the device', () => {
    it('uploads nothing and returns one ZIP holding every image', async () => {
        recordingEngine();
        const items = batch(['a.jpg', 'b.jpg', 'c.jpg']);

        const { outcome, result } = await run(items);

        expect(processImageMock).toHaveBeenCalledTimes(3);
        expect(network.calls).toHaveLength(0);

        expect(outcome.ok).toBe(true);
        expect(outcome.filename).toBe('resizo-bulk.zip');
        expect(outcome.zipBlob.type).toBe('application/zip');

        const entries = readZipEntries(await outcome.zipBlob.arrayBuffer());
        expect(entries.map((entry) => entry.name)).toEqual([
            'resizo-processed-a.jpg',
            'resizo-processed-b.jpg',
            'resizo-processed-c.jpg',
        ]);
        expect(result.current.result.rows).toHaveLength(3);
        expect(result.current.progress).toBe(100);
        expect(result.current.error).toBeNull();
    });

    it('asks the engine for the resize op with this file’s own fields', async () => {
        recordingEngine();

        await run(batch(['a.jpg']));

        const [op, file, options] = processImageMock.mock.calls[0];
        expect(op).toBe('resize');
        expect(file.name).toBe('a.jpg');
        expect(options).toMatchObject({ format: 'jpeg', width: '800' });
    });

    it('hands each file’s measured dimensions over before anything decodes', async () => {
        recordingEngine();

        await run(batch(['a.jpg', 'b.jpg']));

        for (const [, , options] of processImageMock.mock.calls) {
            expect(options).toMatchObject({ sourceWidth: 1600, sourceHeight: 1200 });
        }
    });
});

describe('bulk resize — strictly one image at a time', () => {
    it('never has two jobs in flight, and keeps the order it was given', async () => {
        const state = recordingEngine();

        await run(batch(['a.jpg', 'b.jpg', 'c.jpg', 'd.jpg']));

        expect(state.peak).toBe(1);
        expect(state.order).toEqual(['a.jpg', 'b.jpg', 'c.jpg', 'd.jpg']);
    });

    it('does not start the next file until the one before it has settled', async () => {
        // Interleaving is the assertion: a batch that fanned out would read
        // start,start,start,end,end,end even though its peak counter looked
        // fine on a single tick.
        const events = [];
        processImageMock.mockImplementation(async (op, file) => {
            events.push(`start:${file.name}`);
            await new Promise((resolve) => { setTimeout(resolve, 0); });
            events.push(`end:${file.name}`);
            return engineOutcome(file);
        });

        await run(batch(['a.jpg', 'b.jpg', 'c.jpg']));

        expect(events).toEqual([
            'start:a.jpg', 'end:a.jpg',
            'start:b.jpg', 'end:b.jpg',
            'start:c.jpg', 'end:c.jpg',
        ]);
    });
});

describe('bulk resize — one bad frame does not lose the batch', () => {
    it('returns a ZIP of the successes plus a list of what was left out', async () => {
        const refusal = 'File failed validation. Please upload a valid image.';

        recordingEngine({
            'b.jpg': () => { throw Object.assign(new Error(refusal), { code: 'invalid-type' }); },
        });

        const { outcome, result } = await run(batch(['a.jpg', 'b.jpg', 'c.jpg']));

        expect(outcome.ok).toBe(true);
        expect(outcome.rows.map((row) => row.id)).toEqual(['1', '3']);
        expect(outcome.failures).toEqual([{ id: '2', name: 'b.jpg', error: refusal }]);

        const entries = readZipEntries(await outcome.zipBlob.arrayBuffer());
        expect(entries.map((entry) => entry.name)).toEqual([
            'resizo-processed-a.jpg',
            'resizo-processed-c.jpg',
        ]);

        // The panel reads its "left out" list off these rows.
        expect(result.current.progressRows.map((row) => row.status)).toEqual(['done', 'failed', 'done']);
        expect(result.current.error).toBeNull();
        expect(network.calls).toHaveLength(0);
    });

    it('carries on through the rest of the batch after a failure', async () => {
        const state = recordingEngine({
            'b.jpg': () => { throw new Error('decode failed'); },
        });

        await run(batch(['a.jpg', 'b.jpg', 'c.jpg', 'd.jpg']));

        expect(state.order).toEqual(['a.jpg', 'b.jpg', 'c.jpg', 'd.jpg']);
    });

    it('raises the all-failed message and builds no ZIP when nothing survived', async () => {
        recordingEngine({
            'a.jpg': () => { throw new Error('decode failed'); },
            'b.jpg': () => { throw new Error('decode failed'); },
        });

        const { outcome, result } = await run(batch(['a.jpg', 'b.jpg']));

        expect(outcome).toBeNull();
        expect(result.current.result).toBeNull();
        expect(result.current.error).toBeTruthy();
    });
});

describe('bulk resize — a file this device cannot take is refused, not relayed', () => {
    it('records the engine’s own failure against that one file and finishes the rest', async () => {
        recordingEngine({
            'b.jpg': () => { throw Object.assign(new Error('The image engine could not start.'), { code: 'worker-failed' }); },
        });

        const { outcome, result } = await run(batch(['a.jpg', 'b.jpg', 'c.jpg']));

        expect(network.calls).toHaveLength(0);
        expect(outcome.ok).toBe(true);
        expect(outcome.rows).toHaveLength(2);
        expect(outcome.failures).toEqual([
            { id: '2', name: 'b.jpg', error: 'The image engine could not start.' },
        ]);
        // The batch still succeeded, so the panel shows a ZIP, not an error.
        expect(result.current.error).toBeNull();
    });

    it('refuses a file the memory gate turns down without asking the engine at all', async () => {
        recordingEngine();

        // 108 megapixels — past the browser's hard source ceiling, and only
        // knowable because the measured dimensions travel with the item.
        const { outcome } = await run(batch(['huge.jpg'], { sourceWidth: 12_000, sourceHeight: 9_000 }));

        expect(processImageMock).not.toHaveBeenCalled();
        expect(network.calls).toHaveLength(0);
        expect(outcome).toBeNull();
        expect(outcome).toBeNull();
    });

    it('gives that refusal in words a person can act on, not a code', async () => {
        recordingEngine();

        const { result } = await run(batch(['huge.jpg'], { sourceWidth: 12_000, sourceHeight: 9_000 }));

        const [row] = result.current.progressRows;
        expect(row.status).toBe('failed');
        expect(row.error).toMatch(/108 megapixels/);
        // The gate's suggestion is carried through, not dropped on the floor.
        expect(row.error).toMatch(/desktop app/);
        expect(row.error).toMatch(/[.!?]$/);
    });

    it('keeps the good files when only one of them is over the ceiling', async () => {
        recordingEngine();

        const items = [
            ...batch(['ok.jpg']),
            ...batch(['huge.jpg'], { sourceWidth: 12_000, sourceHeight: 9_000 })
                .map((item) => ({ ...item, id: '2' })),
        ];

        const { outcome } = await run(items);

        expect(processImageMock).toHaveBeenCalledTimes(1);
        expect(outcome.ok).toBe(true);
        expect(outcome.rows.map((row) => row.name)).toEqual(['resizo-processed-ok.jpg']);
        expect(outcome.failures.map((failure) => failure.name)).toEqual(['huge.jpg']);
    });
});

describe('bulk resize — a cancel stops the run', () => {
    it('stops the run and reports neither a result nor an error', async () => {
        recordingEngine({
            'b.jpg': () => { throw Object.assign(new Error('That was cancelled.'), { name: 'AbortError', code: 'cancelled' }); },
        });

        const { outcome, result } = await run(batch(['a.jpg', 'b.jpg', 'c.jpg']));

        expect(network.calls).toHaveLength(0);
        // The third file was never started.
        expect(processImageMock).toHaveBeenCalledTimes(2);
        expect(outcome).toBeNull();
        expect(result.current.result).toBeNull();
        expect(result.current.error).toBeNull();
        expect(result.current.isProcessing).toBe(false);
    });
});

/**
 * A FOLDER BATCH, end to end.
 *
 * The engine is mocked at the same module boundary; everything else is real —
 * the real processBatch, the real JSZip assembler, the real ZIP read back. What
 * is being proved is that a folder pick survives all of it: the archive keeps
 * the shape that was picked, two identically named photos from two months stay
 * two files, and the one-at-a-time rule is not relaxed for a bigger batch.
 */
describe('bulk resize — a folder batch keeps its shape', () => {
    function folderBatch(paths) {
        return paths.map((path, index) => {
            const name = path.split('/').pop();
            const folder = path.split('/').slice(0, -1).join('/');
            return {
                id: String(index + 1),
                name: path,
                file: imageFile(name),
                fields: { format: 'jpeg', width: '800' },
                folder,
                sourceWidth: 1600,
                sourceHeight: 1200,
            };
        });
    }

    it('writes each image back into the folder it came from', async () => {
        recordingEngine();

        const { outcome } = await run(folderBatch([
            'Trip/jan/IMG_0001.jpg',
            'Trip/feb/IMG_0001.jpg',
            'Trip/loose.jpg',
        ]));

        const entries = readZipEntries(await outcome.zipBlob.arrayBuffer());
        expect(entries.map((entry) => entry.name)).toEqual([
            'Trip/jan/resizo-processed-IMG_0001.jpg',
            'Trip/feb/resizo-processed-IMG_0001.jpg',
            'Trip/resizo-processed-loose.jpg',
        ]);
        // Same file name, two folders, and not a single rename between them.
        expect(new Set(entries.map((entry) => entry.name)).size).toBe(3);
    });

    it('still cannot collide inside one folder', async () => {
        recordingEngine();
        const items = folderBatch(['Trip/jan/IMG_0001.jpg', 'Trip/jan/IMG_0001.JPG'])
            .map((item) => ({ ...item, file: imageFile('IMG_0001.jpg') }));

        const { outcome } = await run(items);

        const entries = readZipEntries(await outcome.zipBlob.arrayBuffer());
        expect(entries.map((entry) => entry.name)).toEqual([
            'Trip/jan/resizo-processed-IMG_0001.jpg',
            'Trip/jan/resizo-processed-IMG_0001-2.jpg',
        ]);
    });

    it('runs a full twenty one at a time, and says which one is in flight', async () => {
        const state = recordingEngine();
        const items = folderBatch(
            Array.from({ length: 20 }, (_, index) => `Trip/${String(index).padStart(3, '0')}.jpg`),
        );

        const { outcome, result } = await run(items);

        expect(state.peak).toBe(1);
        expect(processImageMock).toHaveBeenCalledTimes(20);
        expect(network.calls).toHaveLength(0);
        expect(outcome.rows).toHaveLength(20);
        expect(result.current.counts).toMatchObject({ total: 20, done: 20, failed: 0, settled: 20, current: null });
    });
});

describe('bulk resize — a batch never writes AVIF', () => {
    // The batch lanes read AVIF (the decode is the browser's own) but write
    // JPEG, PNG or WebP only: twenty AVIF encodes in a row against a WASM heap
    // that never shrinks are not proven safe on a phone, which is the same
    // reason /bulk-image-converter's list stops short of it. "Same as the
    // original" on an AVIF source resolves to 'avif' before the batch starts,
    // so the refusal has to happen here, per row, in words — not in the menu
    // alone.
    it('refuses a row whose output would be AVIF, in a sentence naming the batch formats, without asking the engine', async () => {
        recordingEngine();

        const items = batch(['photo.avif']).map((item) => ({ ...item, fields: { ...item.fields, format: 'avif' } }));
        const { result, outcome } = await run(items);

        expect(processImageMock).not.toHaveBeenCalled();
        expect(network.calls).toHaveLength(0);
        expect(outcome).toBeNull();

        const [row] = result.current.progressRows;
        expect(row.status).toBe('failed');
        expect(row.error).toMatch(/JPEG, PNG or WebP/);
        expect(row.error).toMatch(/AVIF/);
        expect(row.error).toMatch(/[.!?]$/);
    });
});
