/**
 * useBulkBatch
 *
 * The state layer over the batch runner, with the operation left out of it: a
 * live row per file, a record of the settings the results on screen were made
 * with, a retry that touches only the rows a retry could change, and two
 * downloads — one file, or the archive.
 *
 * `settings` is opaque here. The compressor's are a limit and a mode, the
 * converter's are a format, a quality and a background, and this hook reads
 * neither — it hands them to the runner and remembers them so the panel can say
 * which ones produced what is on screen.
 *
 * The runner, the summariser and the archive builder are injected, so this
 * asserts the wiring rather than the orchestration, which has its own node
 * suite next to the module. One test at the end runs with none of them injected,
 * because the wiring that matters most is the wiring nobody passed in.
 */
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useBulkBatch } from '@/lib/hooks/useBulkBatch';

const ZIP_FILENAME = 'resizo-converted-images.zip';
const SETTINGS = { outputFormat: 'webp', quality: 80, background: 'white' };

let clicks;

beforeEach(() => {
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
        format: 'png',
        ...extra,
    };
}

const ITEMS = [item('1', 'a.png'), item('2', 'b.png')];

function settledRow(id, name, status, extra = {}) {
    return {
        id,
        name,
        folder: null,
        status,
        originalBytes: 400_000,
        resultBytes: status === 'success' ? 240_000 : null,
        width: status === 'success' ? 1600 : null,
        height: status === 'success' ? 1067 : null,
        sourceWidth: 1600,
        sourceHeight: 1067,
        format: 'png',
        ...SETTINGS,
        blob: status === 'success' ? new Blob(['x']) : null,
        filename: status === 'success' ? `${name.replace(/\.\w+$/, '')}.webp` : null,
        error: status === 'success' ? null : 'Resizo couldn’t convert it.',
        resized: false,
        kept: false,
        note: null,
        ...extra,
    };
}

/** A runner that walks each row through processing and then its outcome. */
function runnerSettling(statuses, extras = {}) {
    return vi.fn(async ({ items, onProgress }) => {
        const rows = items.map((one) => settledRow(one.id, one.name, statuses[one.id] ?? 'success', extras[one.id]));
        for (const row of rows) {
            onProgress(row.id, { status: 'processing' });
            onProgress(row.id, { ...row });
        }
        return { rows, aborted: false };
    });
}

function harness({ runBatch, buildArchive, summarise, processFile = vi.fn() } = {}) {
    return renderHook(() => useBulkBatch({
        processFile,
        zipFilename: ZIP_FILENAME,
        ...(runBatch ? { runBatch } : {}),
        ...(buildArchive ? { buildArchive } : {}),
        ...(summarise ? { summarise } : {}),
    }));
}

describe('useBulkBatch — a run', () => {
    it('shows every file as waiting, carrying the settings the run will use', () => {
        const runBatch = vi.fn(() => new Promise(() => {}));
        const { result } = harness({ runBatch });

        act(() => { result.current.run(ITEMS, SETTINGS); });

        expect(result.current.rows.map((row) => row.status)).toEqual(['waiting', 'waiting']);
        expect(result.current.rows[0]).toMatchObject(SETTINGS);
        expect(result.current.isProcessing).toBe(true);
        expect(result.current.settings).toEqual(SETTINGS);
    });

    it('hands the runner the items, the settings and the injected processor', async () => {
        const runBatch = runnerSettling({});
        const processFile = vi.fn();
        const { result } = harness({ runBatch, processFile });

        await act(async () => { await result.current.run(ITEMS, SETTINGS); });

        const passed = runBatch.mock.calls[0][0];
        expect(passed.items).toEqual(ITEMS);
        expect(passed.settings).toEqual(SETTINGS);
        expect(passed.processFile).toBe(processFile);
        expect(passed.signal).toBeInstanceOf(AbortSignal);
    });

    it('fills the rows, the summary and the progress once it finishes', async () => {
        const { result } = harness({ runBatch: runnerSettling({ 1: 'success', 2: 'failed' }) });

        await act(async () => { await result.current.run(ITEMS, SETTINGS); });

        expect(result.current.isProcessing).toBe(false);
        expect(result.current.progress).toBe(100);
        expect(result.current.rows.map((row) => row.status)).toEqual(['success', 'failed']);
        expect(result.current.summary).toMatchObject({ selected: 2, successful: 1, failed: 1 });
    });

    it('counts a failed row as settled, so the progress can reach the end', async () => {
        const { result } = harness({ runBatch: runnerSettling({ 1: 'failed', 2: 'failed' }) });

        await act(async () => { await result.current.run(ITEMS, SETTINGS); });

        expect(result.current.counts).toEqual({ total: 2, settled: 2, current: null });
        expect(result.current.progress).toBe(100);
    });

    it('summarises through whichever summariser the tool supplied', async () => {
        const summarise = vi.fn(() => ({ selected: 2, converted: 1, anythingAtAll: true }));
        const { result } = harness({ runBatch: runnerSettling({}), summarise });

        await act(async () => { await result.current.run(ITEMS, SETTINGS); });

        expect(result.current.summary).toEqual({ selected: 2, converted: 1, anythingAtAll: true });
    });

    it('passes a kept row and its note through untouched', async () => {
        const runBatch = runnerSettling({}, {
            1: { kept: true, note: 'Already WebP — kept unchanged, metadata included.' },
        });
        const { result } = harness({ runBatch });

        await act(async () => { await result.current.run(ITEMS, SETTINGS); });

        expect(result.current.rows[0]).toMatchObject({
            kept: true,
            note: 'Already WebP — kept unchanged, metadata included.',
        });
        expect(result.current.rows[1]).toMatchObject({ kept: false, note: null });
    });

    it('does nothing at all with an empty selection', async () => {
        const runBatch = vi.fn();
        const { result } = harness({ runBatch });

        await act(async () => { await result.current.run([], SETTINGS); });

        expect(runBatch).not.toHaveBeenCalled();
        expect(result.current.rows).toEqual([]);
    });
});

describe('useBulkBatch — a retry', () => {
    it('re-runs only the rows a retry could change, reserving the names it is keeping', async () => {
        const runBatch = runnerSettling({ 1: 'success', 2: 'failed' });
        const { result } = harness({ runBatch });

        await act(async () => { await result.current.run(ITEMS, SETTINGS); });
        await act(async () => { await result.current.retry(ITEMS, SETTINGS); });

        expect(runBatch.mock.calls[1][0].items.map((one) => one.id)).toEqual(['2']);
        expect(runBatch.mock.calls[1][0].reservedNames).toEqual(['a.webp']);
        expect(result.current.rows.map((row) => row.id)).toEqual(['1', '2']);
    });

    it('has nothing to re-run when everything succeeded', async () => {
        const runBatch = runnerSettling({});
        const { result } = harness({ runBatch });

        await act(async () => { await result.current.run(ITEMS, SETTINGS); });
        await act(async () => { await result.current.retry(ITEMS, SETTINGS); });

        expect(runBatch).toHaveBeenCalledTimes(1);
    });
});

describe('useBulkBatch — the downloads', () => {
    it('offers one finished file under the name its row carries', async () => {
        const { result } = harness({ runBatch: runnerSettling({}) });

        await act(async () => { await result.current.run(ITEMS, SETTINGS); });
        act(() => { result.current.downloadOne('2'); });

        expect(clicks).toHaveLength(1);
        expect(clicks[0].download).toBe('b.webp');
    });

    it('builds the archive under the name this tool was configured with', async () => {
        const buildArchive = vi.fn(async () => ({ blob: new Blob(['zip']), filename: ZIP_FILENAME, count: 2 }));
        const { result } = harness({ runBatch: runnerSettling({}), buildArchive });

        await act(async () => { await result.current.run(ITEMS, SETTINGS); });
        await act(async () => { await result.current.downloadZip(); });

        expect(buildArchive.mock.calls[0][0].map((row) => row.id)).toEqual(['1', '2']);
        expect(buildArchive.mock.calls[0][1]).toEqual({ filename: ZIP_FILENAME });
        expect(clicks[0].download).toBe(ZIP_FILENAME);
        expect(result.current.zipError).toBeNull();
    });

    it('says the images survived when only the archive did not', async () => {
        const buildArchive = vi.fn(async () => { throw new Error('Loading chunk 1234 failed.'); });
        const { result } = harness({ runBatch: runnerSettling({}), buildArchive });

        await act(async () => { await result.current.run(ITEMS, SETTINGS); });
        await act(async () => { await result.current.downloadZip(); });

        expect(result.current.zipError).toContain('couldn’t create the ZIP');
        expect(result.current.zipError).not.toContain('Loading chunk');
        expect(result.current.isZipping).toBe(false);
        expect(clicks).toHaveLength(0);
    });
});

describe('useBulkBatch — stopping and starting over', () => {
    it('aborts the run in flight when the visitor presses stop', async () => {
        let seen = null;
        const runBatch = vi.fn(({ signal }) => {
            seen = signal;
            return new Promise(() => {});
        });
        const { result } = harness({ runBatch });

        act(() => { result.current.run(ITEMS, SETTINGS); });
        act(() => { result.current.cancel(); });

        expect(seen.aborted).toBe(true);
    });

    it('clears every trace of the last run', async () => {
        const { result } = harness({ runBatch: runnerSettling({}) });

        await act(async () => { await result.current.run(ITEMS, SETTINGS); });
        act(() => { result.current.reset(); });

        expect(result.current.rows).toEqual([]);
        expect(result.current.settings).toBeNull();
        expect(result.current.isProcessing).toBe(false);
        expect(result.current.zipError).toBeNull();
    });
});

/**
 * NOTHING INJECTED. The converter uses the defaults, so the defaults are the
 * wiring that ships — a hook whose every seam is mocked in every test proves
 * only that it can call whatever it was handed.
 */
describe('useBulkBatch — with the real runner behind it', () => {
    it('runs a batch end to end and names each finished file', async () => {
        const processFile = vi.fn(async ({ name }) => ({
            status: 'success',
            kept: false,
            blob: new Blob(['x']),
            filename: 'photo.webp',
            originalBytes: 400_000,
            resultBytes: 240_000,
            width: 1600,
            height: 1067,
            note: null,
        }));
        const { result } = renderHook(() => useBulkBatch({ processFile, zipFilename: ZIP_FILENAME }));

        await act(async () => { await result.current.run(ITEMS, SETTINGS); });

        expect(processFile).toHaveBeenCalledTimes(2);
        expect(result.current.rows.map((row) => row.status)).toEqual(['success', 'success']);
        expect(result.current.rows.map((row) => row.filename)).toEqual(['photo.webp', 'photo-2.webp']);
        expect(result.current.summary).toMatchObject({ selected: 2, successful: 2, kept: 0 });
    });
});
