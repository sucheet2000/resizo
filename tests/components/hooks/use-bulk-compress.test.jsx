/**
 * useBulkCompress
 *
 * The state layer over runCompressBatch: a live row per file, a settings record
 * so the panel can say which limit produced the results on screen, a retry that
 * touches only the rows a retry could change, and two downloads — one file, or
 * the archive. The sequencer and the archive builder are mocked, so this
 * asserts the wiring rather than the orchestration, which has its own node
 * suite next to the module.
 */
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { runCompressBatchMock, buildZipMock } = vi.hoisted(() => ({
    runCompressBatchMock: vi.fn(),
    buildZipMock: vi.fn(),
}));

vi.mock('@/lib/upload/compress-batch', async (importOriginal) => ({
    ...(await importOriginal()),
    runCompressBatch: runCompressBatchMock,
    buildZip: buildZipMock,
}));

import { ZIP_FAILED_MESSAGE, ZIP_FILENAME } from '@/lib/upload/compress-batch';
import { useBulkCompress } from '@/lib/hooks/useBulkCompress';

const SETTINGS = { targetBytes: 200 * 1024, mode: 'preserve' };

let clicks;

beforeEach(() => {
    runCompressBatchMock.mockReset();
    buildZipMock.mockReset();
    clicks = [];
    vi.spyOn(window.HTMLAnchorElement.prototype, 'click').mockImplementation(function record() {
        clicks.push({ href: this.href, download: this.download });
    });
});

afterEach(() => {
    vi.restoreAllMocks();
});

function item(id, name, extra = {}) {
    return {
        id,
        name,
        file: { name, size: 400_000 },
        folder: null,
        sourceWidth: 1600,
        sourceHeight: 1067,
        format: 'jpeg',
        ...extra,
    };
}

const ITEMS = [item('1', 'a.jpg'), item('2', 'b.jpg')];

function settledRow(id, name, status, extra = {}) {
    return {
        id,
        name,
        folder: null,
        status,
        originalBytes: 400_000,
        resultBytes: status === 'success' ? 40_000 : null,
        width: status === 'success' ? 1600 : null,
        height: status === 'success' ? 1067 : null,
        sourceWidth: 1600,
        sourceHeight: 1067,
        format: 'jpeg',
        targetBytes: SETTINGS.targetBytes,
        mode: SETTINGS.mode,
        blob: status === 'success' ? new Blob(['x']) : null,
        filename: status === 'success' ? `${name.replace(/\.\w+$/, '')}-compressed.jpg` : null,
        error: status === 'success' ? null : 'Resizo couldn’t reduce it.',
        resized: false,
        ...extra,
    };
}

/** A sequencer that walks each row through processing and then its outcome. */
function settleAs(statuses) {
    runCompressBatchMock.mockImplementation(async ({ items, onProgress }) => {
        const rows = items.map((one) => settledRow(one.id, one.name, statuses[one.id] ?? 'success'));
        for (const row of rows) {
            onProgress(row.id, { status: 'processing' });
            onProgress(row.id, { ...row });
        }
        return { rows, aborted: false };
    });
}

describe('useBulkCompress — a run', () => {
    it('shows every file as waiting before any work has happened', () => {
        runCompressBatchMock.mockImplementation(() => new Promise(() => {}));
        const { result } = renderHook(() => useBulkCompress({ processFile: vi.fn() }));

        act(() => { result.current.run(ITEMS, SETTINGS); });

        expect(result.current.rows.map((row) => row.status)).toEqual(['waiting', 'waiting']);
        expect(result.current.rows.map((row) => row.name)).toEqual(['a.jpg', 'b.jpg']);
        expect(result.current.rows[0]).toMatchObject({ targetBytes: SETTINGS.targetBytes, mode: 'preserve' });
        expect(result.current.isProcessing).toBe(true);
    });

    it('fills the rows, the summary and the progress once it finishes', async () => {
        settleAs({ 1: 'success', 2: 'unmet' });
        const { result } = renderHook(() => useBulkCompress({ processFile: vi.fn() }));

        await act(async () => { await result.current.run(ITEMS, SETTINGS); });

        expect(result.current.isProcessing).toBe(false);
        expect(result.current.progress).toBe(100);
        expect(result.current.rows.map((row) => row.status)).toEqual(['success', 'unmet']);
        expect(result.current.summary).toMatchObject({ selected: 2, successful: 1, unmet: 1, reductionPercent: 90 });
    });

    it('records the settings the results were made with', async () => {
        settleAs({});
        const { result } = renderHook(() => useBulkCompress({ processFile: vi.fn() }));

        expect(result.current.settings).toBeNull();
        await act(async () => { await result.current.run(ITEMS, { targetBytes: 51_200, mode: 'fit' }); });

        expect(result.current.settings).toEqual({ targetBytes: 51_200, mode: 'fit' });
    });

    it('passes the batch its settings and the injected processor', async () => {
        settleAs({});
        const processFile = vi.fn();
        const { result } = renderHook(() => useBulkCompress({ processFile }));

        await act(async () => { await result.current.run(ITEMS, SETTINGS); });

        const passed = runCompressBatchMock.mock.calls[0][0];
        expect(passed.items).toEqual(ITEMS);
        expect(passed.targetBytes).toBe(SETTINGS.targetBytes);
        expect(passed.mode).toBe('preserve');
        expect(passed.processFile).toBe(processFile);
        expect(passed.signal).toBeInstanceOf(AbortSignal);
    });

    it('clears the last run, so no stale row or ZIP survives into the next one', async () => {
        settleAs({ 1: 'success', 2: 'success' });
        const { result } = renderHook(() => useBulkCompress({ processFile: vi.fn() }));

        await act(async () => { await result.current.run(ITEMS, SETTINGS); });
        expect(result.current.rows).toHaveLength(2);

        settleAs({ 9: 'success' });
        await act(async () => { await result.current.run([item('9', 'z.jpg')], SETTINGS); });

        expect(result.current.rows.map((row) => row.id)).toEqual(['9']);
        expect(result.current.summary.selected).toBe(1);
    });

    it('does nothing at all with no files', async () => {
        const { result } = renderHook(() => useBulkCompress({ processFile: vi.fn() }));

        let value;
        await act(async () => { value = await result.current.run([], SETTINGS); });

        expect(value).toBeNull();
        expect(runCompressBatchMock).not.toHaveBeenCalled();
    });
});

describe('useBulkCompress — the progress reading', () => {
    it('counts what has settled and names the file in flight', async () => {
        runCompressBatchMock.mockImplementation(async ({ items, onProgress }) => {
            onProgress(items[0].id, { status: 'processing' });
            onProgress(items[0].id, { ...settledRow(items[0].id, items[0].name, 'success') });
            onProgress(items[1].id, { status: 'processing' });
            return { rows: [], aborted: true };
        });
        const { result } = renderHook(() => useBulkCompress({ processFile: vi.fn() }));

        await act(async () => { await result.current.run(ITEMS, SETTINGS); });

        expect(result.current.counts).toEqual({ total: 2, settled: 1, current: 'b.jpg' });
        expect(result.current.progress).toBe(50);
    });

    it('reads as nothing before a run', () => {
        const { result } = renderHook(() => useBulkCompress({ processFile: vi.fn() }));

        expect(result.current.counts).toEqual({ total: 0, settled: 0, current: null });
        expect(result.current.progress).toBe(0);
        expect(result.current.rows).toEqual([]);
    });
});

/**
 * A RETRY IS FOR THE ROWS A RETRY COULD CHANGE. Re-running the successes would
 * throw away twenty finished images to redo work that already worked, and
 * re-running an unsupported file would fail it in exactly the same way. The
 * order on screen must not move either — a list that reshuffles under a retry
 * is a list nobody can follow.
 */
describe('useBulkCompress — retry', () => {
    const THREE = [item('1', 'a.jpg'), item('2', 'b.jpg'), item('3', 'c.txt')];

    async function firstPass(result) {
        settleAs({ 1: 'success', 2: 'unmet', 3: 'unsupported' });
        await act(async () => { await result.current.run(THREE, SETTINGS); });
    }

    it('re-runs only the retryable files', async () => {
        const { result } = renderHook(() => useBulkCompress({ processFile: vi.fn() }));
        await firstPass(result);

        settleAs({ 2: 'success' });
        await act(async () => { await result.current.retry(THREE, SETTINGS); });

        expect(runCompressBatchMock.mock.calls[1][0].items.map((one) => one.id)).toEqual(['2']);
    });

    it('keeps the rows it did not re-run, in their original places', async () => {
        const { result } = renderHook(() => useBulkCompress({ processFile: vi.fn() }));
        await firstPass(result);
        const keptBlob = result.current.rows[0].blob;

        settleAs({ 2: 'success' });
        await act(async () => { await result.current.retry(THREE, SETTINGS); });

        expect(result.current.rows.map((row) => row.id)).toEqual(['1', '2', '3']);
        expect(result.current.rows.map((row) => row.status)).toEqual(['success', 'success', 'unsupported']);
        expect(result.current.rows[0].blob).toBe(keptBlob);
    });

    it('records the settings the retry was run with', async () => {
        const { result } = renderHook(() => useBulkCompress({ processFile: vi.fn() }));
        await firstPass(result);

        settleAs({ 2: 'success' });
        await act(async () => { await result.current.retry(THREE, { targetBytes: 512_000, mode: 'fit' }); });

        expect(result.current.settings).toEqual({ targetBytes: 512_000, mode: 'fit' });
    });

    it('does nothing when there is nothing worth retrying', async () => {
        settleAs({ 1: 'success', 2: 'success' });
        const { result } = renderHook(() => useBulkCompress({ processFile: vi.fn() }));
        await act(async () => { await result.current.run(ITEMS, SETTINGS); });

        let value;
        await act(async () => { value = await result.current.retry(ITEMS, SETTINGS); });

        expect(value).toBeNull();
        expect(runCompressBatchMock).toHaveBeenCalledTimes(1);
    });
});

describe('useBulkCompress — cancel and reset', () => {
    it('aborts the run in flight and stops the panel spinning', async () => {
        let captured;
        let release;
        runCompressBatchMock.mockImplementation(({ signal }) => {
            captured = signal;
            return new Promise((resolve) => {
                release = () => resolve({
                    rows: [settledRow('1', 'a.jpg', 'success'), settledRow('2', 'b.jpg', 'cancelled')],
                    aborted: true,
                });
            });
        });
        const { result } = renderHook(() => useBulkCompress({ processFile: vi.fn() }));

        let running;
        act(() => { running = result.current.run(ITEMS, SETTINGS); });
        act(() => { result.current.cancel(); });

        expect(captured.aborted).toBe(true);

        await act(async () => { release(); await running; });

        expect(result.current.isProcessing).toBe(false);
        expect(result.current.rows.map((row) => row.status)).toEqual(['success', 'cancelled']);
        expect(result.current.rows[0].blob).toBeInstanceOf(Blob);
    });

    it('clears everything on reset', async () => {
        settleAs({});
        const { result } = renderHook(() => useBulkCompress({ processFile: vi.fn() }));
        await act(async () => { await result.current.run(ITEMS, SETTINGS); });

        act(() => { result.current.reset(); });

        expect(result.current.rows).toEqual([]);
        expect(result.current.settings).toBeNull();
        expect(result.current.zipError).toBeNull();
        expect(result.current.progress).toBe(0);
        expect(result.current.isProcessing).toBe(false);
    });

    it('aborts the run when the panel unmounts', async () => {
        let captured;
        runCompressBatchMock.mockImplementation(({ signal }) => {
            captured = signal;
            return new Promise(() => {});
        });
        const { result, unmount } = renderHook(() => useBulkCompress({ processFile: vi.fn() }));

        act(() => { result.current.run(ITEMS, SETTINGS); });
        unmount();

        expect(captured.aborted).toBe(true);
    });
});

describe('useBulkCompress — downloads', () => {
    it('downloads one finished image under its own name', async () => {
        settleAs({ 1: 'success', 2: 'unmet' });
        const { result } = renderHook(() => useBulkCompress({ processFile: vi.fn() }));
        await act(async () => { await result.current.run(ITEMS, SETTINGS); });

        let saved;
        act(() => { saved = result.current.downloadOne('1'); });

        expect(saved).toBe(true);
        expect(clicks).toEqual([expect.objectContaining({ download: 'a-compressed.jpg' })]);
    });

    it('refuses to download a row that has no file', async () => {
        settleAs({ 1: 'success', 2: 'unmet' });
        const { result } = renderHook(() => useBulkCompress({ processFile: vi.fn() }));
        await act(async () => { await result.current.run(ITEMS, SETTINGS); });

        let saved;
        act(() => { saved = result.current.downloadOne('2'); });

        expect(saved).toBe(false);
        expect(clicks).toEqual([]);
    });

    it('builds the archive on demand and downloads it under the batch name', async () => {
        settleAs({ 1: 'success', 2: 'success' });
        buildZipMock.mockResolvedValue({ blob: new Blob(['zip']), filename: ZIP_FILENAME, count: 2 });
        const { result } = renderHook(() => useBulkCompress({ processFile: vi.fn() }));
        await act(async () => { await result.current.run(ITEMS, SETTINGS); });

        let saved;
        await act(async () => { saved = await result.current.downloadZip(); });

        expect(saved).toBe(true);
        expect(buildZipMock.mock.calls[0][0].map((row) => row.id)).toEqual(['1', '2']);
        expect(clicks).toEqual([expect.objectContaining({ download: ZIP_FILENAME })]);
        expect(result.current.zipError).toBeNull();
        expect(result.current.isZipping).toBe(false);
    });

    it('says the archive is being built while it is', async () => {
        settleAs({ 1: 'success', 2: 'success' });
        let finish;
        buildZipMock.mockImplementation(() => new Promise((resolve) => {
            finish = () => resolve({ blob: new Blob(['zip']), filename: ZIP_FILENAME, count: 2 });
        }));
        const { result } = renderHook(() => useBulkCompress({ processFile: vi.fn() }));
        await act(async () => { await result.current.run(ITEMS, SETTINGS); });

        let zipping;
        act(() => { zipping = result.current.downloadZip(); });
        expect(result.current.isZipping).toBe(true);

        await act(async () => { finish(); await zipping; });
        expect(result.current.isZipping).toBe(false);
    });

    /**
     * The images were fine; the archive was not. A chunk that 404s after a
     * redeploy or a failed 80 MB allocation on a phone both land here, and the
     * finished images are still on screen and still downloadable one at a time
     * — which is exactly what the sentence has to say.
     */
    it('reports a failed archive in words and leaves the images downloadable', async () => {
        settleAs({ 1: 'success', 2: 'success' });
        buildZipMock.mockRejectedValue(new Error('Loading chunk 1234 failed.'));
        const { result } = renderHook(() => useBulkCompress({ processFile: vi.fn() }));
        await act(async () => { await result.current.run(ITEMS, SETTINGS); });

        let saved;
        await act(async () => { saved = await result.current.downloadZip(); });

        expect(saved).toBe(false);
        expect(result.current.zipError).toBe(ZIP_FAILED_MESSAGE);
        expect(result.current.isZipping).toBe(false);
        expect(result.current.rows.filter((row) => row.blob)).toHaveLength(2);
        expect(clicks).toEqual([]);
    });

    it('clears an earlier archive failure when a new run starts', async () => {
        settleAs({ 1: 'success', 2: 'success' });
        buildZipMock.mockRejectedValue(new Error('nope'));
        const { result } = renderHook(() => useBulkCompress({ processFile: vi.fn() }));
        await act(async () => { await result.current.run(ITEMS, SETTINGS); });
        await act(async () => { await result.current.downloadZip(); });
        expect(result.current.zipError).toBe(ZIP_FAILED_MESSAGE);

        settleAs({ 1: 'success', 2: 'success' });
        await act(async () => { await result.current.run(ITEMS, SETTINGS); });

        expect(result.current.zipError).toBeNull();
    });
});
