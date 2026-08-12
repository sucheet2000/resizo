/**
 * Bulk resize, run on the device.
 *
 * This is the biggest single win of the migration: twenty phone photos used to
 * mean up to 80 MB uploaded and a ZIP downloaded back. Here the whole batch is
 * processed in the tab and nothing is uploaded at all.
 *
 * The engine is mocked at its module boundary (lib/image-client/client) — no
 * Worker is constructed, exactly as in the /crop seam test — and so is the
 * server lane (lib/upload/submit-file), which is how "nothing was uploaded" can
 * be asserted rather than assumed. Everything between them is the real thing:
 * the real processBatch, the real JSZip assembler, and the real ZIP read back
 * through the same central-directory reader the result panel uses.
 *
 * Four things have to hold:
 *
 *  - STRICTLY ONE AT A TIME. Peak memory, not throughput, is what kills a phone
 *    tab, so two files must never be in flight together. The test counts.
 *  - A FILE'S FAILURE IS ITS OWN. Nineteen good frames must not be lost to one
 *    bad one: the correct outcome is a partial ZIP plus a list of what was left
 *    out, which is what the server did too.
 *  - A DEVICE FAILURE IS NOT A FILE FAILURE. If the engine cannot take one
 *    file, that file — and only that file — goes to the server, silently.
 *  - A CANCEL IS NOT A FALLBACK. Re-running cancelled work on the server is the
 *    opposite of what was asked for.
 */
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { processImageMock, terminateWorkerMock, serverSubmitMock } = vi.hoisted(() => ({
    processImageMock: vi.fn(),
    terminateWorkerMock: vi.fn(),
    serverSubmitMock: vi.fn(),
}));

vi.mock('@/lib/image-client/client', () => ({
    processImage: processImageMock,
    terminateWorker: terminateWorkerMock,
}));

vi.mock('@/lib/upload/submit-file', () => ({
    submitFile: serverSubmitMock,
    default: serverSubmitMock,
}));

import { useBulkResize } from '@/lib/hooks/useBulkResize';
import { readZipEntries } from '@/lib/zip-entries';

beforeEach(() => {
    processImageMock.mockReset();
    terminateWorkerMock.mockReset();
    serverSubmitMock.mockReset();
    vi.spyOn(window.HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
});

afterEach(() => {
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

function serverOutcome(file, { bytes = 700 } = {}) {
    return {
        ok: true,
        blob: new Blob([new Uint8Array(bytes)]),
        filename: `resizo-processed-${file.name}`,
        originalBytes: file.size,
        resultBytes: bytes,
        savedPercent: 30,
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
    const hook = renderHook(() => useBulkResize({ op: 'resize', endpoint: '/api/resize', ...options }));
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
        expect(serverSubmitMock).not.toHaveBeenCalled();

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
        // The engine refused it, so it falls back — and the server refuses it
        // too, which is what makes this file genuinely fail rather than move
        // lanes.
        serverSubmitMock.mockResolvedValue({ ok: false, error: refusal });

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
    });

    it('carries on through the rest of the batch after a failure', async () => {
        const state = recordingEngine({
            'b.jpg': () => { throw new Error('decode failed'); },
        });
        serverSubmitMock.mockResolvedValue({ ok: false, error: 'nope' });

        await run(batch(['a.jpg', 'b.jpg', 'c.jpg', 'd.jpg']));

        expect(state.order).toEqual(['a.jpg', 'b.jpg', 'c.jpg', 'd.jpg']);
    });

    it('raises the all-failed message and builds no ZIP when nothing survived', async () => {
        recordingEngine({
            'a.jpg': () => { throw new Error('decode failed'); },
            'b.jpg': () => { throw new Error('decode failed'); },
        });
        serverSubmitMock.mockResolvedValue({ ok: false, error: 'nope' });

        const { outcome, result } = await run(batch(['a.jpg', 'b.jpg']));

        expect(outcome).toBeNull();
        expect(result.current.result).toBeNull();
        expect(result.current.error).toBeTruthy();
    });
});

describe('bulk resize — falling back is per file, and never for a cancel', () => {
    it('sends only the file the engine could not take to the server', async () => {
        recordingEngine({
            'b.jpg': () => { throw Object.assign(new Error('engine died'), { code: 'worker-failed' }); },
        });
        serverSubmitMock.mockImplementation(async ({ file }) => serverOutcome(file));

        const { outcome, result } = await run(batch(['a.jpg', 'b.jpg', 'c.jpg']));

        expect(serverSubmitMock).toHaveBeenCalledTimes(1);
        expect(serverSubmitMock.mock.calls[0][0].file.name).toBe('b.jpg');
        expect(serverSubmitMock.mock.calls[0][0].endpoint).toBe('/api/resize');

        expect(outcome.ok).toBe(true);
        expect(outcome.failures).toEqual([]);
        expect(outcome.rows).toHaveLength(3);
        // Nothing about the failed local attempt reaches the panel.
        expect(result.current.error).toBeNull();
    });

    it('sends a file the memory gate refuses without asking the engine at all', async () => {
        recordingEngine();
        serverSubmitMock.mockImplementation(async ({ file }) => serverOutcome(file));

        // 108 megapixels — past the browser's hard source ceiling, and only
        // knowable because the measured dimensions travel with the item.
        const { outcome } = await run(batch(['huge.jpg'], { sourceWidth: 12_000, sourceHeight: 9_000 }));

        expect(processImageMock).not.toHaveBeenCalled();
        expect(serverSubmitMock).toHaveBeenCalledTimes(1);
        expect(outcome.ok).toBe(true);
    });

    it('stops the run on a cancel instead of re-running it on the server', async () => {
        recordingEngine({
            'b.jpg': () => { throw Object.assign(new Error('That was cancelled.'), { name: 'AbortError', code: 'cancelled' }); },
        });
        serverSubmitMock.mockImplementation(async ({ file }) => serverOutcome(file));

        const { outcome, result } = await run(batch(['a.jpg', 'b.jpg', 'c.jpg']));

        expect(serverSubmitMock).not.toHaveBeenCalled();
        // The third file was never started.
        expect(processImageMock).toHaveBeenCalledTimes(2);
        expect(outcome).toBeNull();
        expect(result.current.result).toBeNull();
        expect(result.current.error).toBeNull();
        expect(result.current.isProcessing).toBe(false);
    });
});
