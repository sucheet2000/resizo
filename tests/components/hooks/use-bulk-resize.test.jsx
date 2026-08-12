/**
 * useBulkResize
 *
 * The state layer over processBatch: a live per-file row, an overall progress
 * reading, the assembled ZIP once every file settles, and a cancel that stops
 * the run without leaving the button spinning. processBatch is mocked so this
 * asserts the wiring, not the orchestration (which has its own node suite).
 */
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { processBatchMock } = vi.hoisted(() => ({ processBatchMock: vi.fn() }));
vi.mock('@/lib/upload/bulk-batch', () => ({ processBatch: processBatchMock }));

import { useBulkResize } from '@/lib/hooks/useBulkResize';

let clicks;

beforeEach(() => {
    processBatchMock.mockReset();
    clicks = [];
    vi.spyOn(window.HTMLAnchorElement.prototype, 'click').mockImplementation(function record() {
        clicks.push({ href: this.href, download: this.download });
    });
});

afterEach(() => {
    vi.restoreAllMocks();
});

const ITEMS = [{ id: '1', name: 'a.jpg' }, { id: '2', name: 'b.jpg' }];

function succeed(rows, failures = []) {
    processBatchMock.mockImplementation(async ({ onProgress }) => {
        for (const row of rows) {
            onProgress(row.id, { status: 'processing' });
            onProgress(row.id, { status: 'done', originalBytes: row.originalBytes, resultBytes: row.resultBytes });
        }
        for (const fail of failures) onProgress(fail.id, { status: 'failed', error: fail.error });
        return { ok: true, zipBlob: new Blob(['zip'], { type: 'application/zip' }), filename: 'resizo-bulk.zip', rows, failures };
    });
}

describe('useBulkResize — a successful batch', () => {
    it('fills the result, drives progress to 100, and reflects the live rows', async () => {
        succeed([
            { id: '1', name: 'resizo-a.jpg', originalBytes: 1000, resultBytes: 400 },
            { id: '2', name: 'resizo-b.jpg', originalBytes: 2000, resultBytes: 900 },
        ]);
        const { result } = renderHook(() => useBulkResize({ endpoint: '/api/resize' }));

        await act(async () => { await result.current.run(ITEMS); });

        expect(result.current.isProcessing).toBe(false);
        expect(result.current.progress).toBe(100);
        expect(result.current.result.rows).toHaveLength(2);
        expect(result.current.progressRows.map((row) => row.status)).toEqual(['done', 'done']);
        expect(result.current.error).toBeNull();
    });

    it('downloads the assembled ZIP under its own name', async () => {
        succeed([{ id: '1', name: 'resizo-a.jpg', originalBytes: 1000, resultBytes: 400 }]);
        const { result } = renderHook(() => useBulkResize());

        await act(async () => { await result.current.run([{ id: '1', name: 'a.jpg' }]); });
        act(() => { result.current.download(); });

        expect(clicks).toHaveLength(1);
        expect(clicks[0].download).toBe('resizo-bulk.zip');
    });

    it('passes the processing endpoint down to each item', async () => {
        succeed([{ id: '1', name: 'resizo-a.jpg', originalBytes: 1, resultBytes: 1 }]);
        const { result } = renderHook(() => useBulkResize({ endpoint: '/api/resize' }));

        await act(async () => { await result.current.run([{ id: '1', name: 'a.jpg', file: {}, fields: {} }]); });

        expect(processBatchMock.mock.calls[0][0].items[0].endpoint).toBe('/api/resize');
    });
});

describe('useBulkResize — nothing succeeded', () => {
    it('raises an error and leaves no result', async () => {
        processBatchMock.mockResolvedValue({ ok: false, zipBlob: null, rows: [], failures: [{ id: '1', name: 'a.jpg', error: 'nope' }] });
        const { result } = renderHook(() => useBulkResize());

        await act(async () => { await result.current.run(ITEMS); });

        expect(result.current.error).toBeTruthy();
        expect(result.current.result).toBeNull();
        expect(result.current.isProcessing).toBe(false);
    });
});

describe('useBulkResize — cancellation', () => {
    it('aborts the in-flight signal and stops processing without a result', async () => {
        let captured;
        let release;
        processBatchMock.mockImplementation(({ signal }) => {
            captured = signal;
            return new Promise((resolve) => {
                release = () => resolve({ ok: false, aborted: true, zipBlob: null, rows: [], failures: [] });
            });
        });
        const { result } = renderHook(() => useBulkResize());

        let runPromise;
        act(() => { runPromise = result.current.run(ITEMS); });
        expect(result.current.isProcessing).toBe(true);

        act(() => { result.current.cancel(); });
        expect(captured.aborted).toBe(true);

        await act(async () => { release(); await runPromise; });

        expect(result.current.isProcessing).toBe(false);
        expect(result.current.result).toBeNull();
        expect(result.current.error).toBeNull();
    });
});

describe('useBulkResize — reset', () => {
    it('clears the rows, result and error', async () => {
        succeed([{ id: '1', name: 'resizo-a.jpg', originalBytes: 1000, resultBytes: 400 }]);
        const { result } = renderHook(() => useBulkResize());

        await act(async () => { await result.current.run([{ id: '1', name: 'a.jpg' }]); });
        act(() => { result.current.reset(); });

        expect(result.current.progressRows).toEqual([]);
        expect(result.current.result).toBeNull();
        expect(result.current.error).toBeNull();
        expect(result.current.progress).toBe(0);
    });

    it('ignores an empty item list', async () => {
        const { result } = renderHook(() => useBulkResize());

        let value;
        await act(async () => { value = await result.current.run([]); });

        expect(value).toBeNull();
        expect(processBatchMock).not.toHaveBeenCalled();
    });
});
