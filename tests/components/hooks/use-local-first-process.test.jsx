/**
 * useLocalFirstProcess
 *
 * The one seam that decides where a tool's work happens. Everything below is
 * about that decision and nothing about the engine itself, so the engine is
 * mocked at its module boundary (lib/image-client/client) — no Worker is ever
 * constructed here, which is also true of the app on a browser that cannot
 * build one.
 *
 * Four things have to hold, and each one is a bug that would otherwise reach a
 * visitor:
 *
 *  - a capable device runs locally and issues NO request at all
 *  - the measured source dimensions reach the capability gate BEFORE a decode,
 *    because that is the only point at which the memory gate can still refuse
 *  - a device or a file the engine refuses goes to the server silently
 *  - a local run that throws mid-job falls back rather than surfacing an error;
 *    the visitor sees one job, not a failure followed by a retry
 *
 * A cancel is the one null result that must NOT fall back: the person pressed
 * Cancel, and quietly re-running the same work on the server is the opposite of
 * what they asked for.
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

vi.mock('@vercel/blob/client', () => ({ upload: vi.fn() }));

import { useLocalFirstProcess } from '@/lib/hooks/useLocalFirstProcess';
import { blobOfSize, imageFile, installFakeXhr } from '../helpers.jsx';

let xhr;

beforeEach(() => {
    xhr = installFakeXhr();
    processImageMock.mockReset();
    terminateWorkerMock.mockReset();
    vi.spyOn(window.HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
});

afterEach(() => {
    xhr.restore();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

const OK_HEADERS = {
    'Content-Type': 'image/jpeg',
    'Content-Disposition': 'attachment; filename="resizo-cropped-photo.jpg"',
    'X-Original-Size': '500000',
    'X-Output-Size': '120000',
};

/** The FormData /crop posts today, unchanged. */
function cropForm(file = imageFile('photo.jpg', 'jpeg', { size: 500_000 })) {
    const form = new FormData();
    form.append('file', file);
    form.append('crop_x', '0');
    form.append('crop_y', '0');
    form.append('crop_width', '100');
    form.append('crop_height', '80');
    return form;
}

function localOutcome({ bytes = 120_000 } = {}) {
    return {
        blob: blobOfSize(bytes, 'image/jpeg'),
        filename: 'resizo-cropped-photo.jpg',
        format: 'jpeg',
        width: 100,
        height: 80,
        originalBytes: 500_000,
        resultBytes: bytes,
        savedPercent: 76,
    };
}

function renderSeam(overrides = {}) {
    return renderHook(() => useLocalFirstProcess({
        op: 'crop',
        endpoint: '/api/crop',
        ...overrides,
    }));
}

/**
 * Starts a submit and lets every queued microtask settle. The pending promise
 * comes back wrapped, so awaiting this helper never accidentally awaits the
 * submit itself — a server-lane submit does not settle until the response lands.
 */
async function start(result, options = { sourceWidth: 1200, sourceHeight: 800 }, form = cropForm()) {
    let promise;
    await act(async () => {
        promise = result.current.submit(form, options);
    });
    return { promise };
}

async function respond(promise, response) {
    let payload;
    await act(async () => {
        await xhr.last().respond(response);
        payload = await promise;
    });
    return payload;
}

describe('useLocalFirstProcess — the local path', () => {
    it('processes on the device and never touches the network', async () => {
        processImageMock.mockResolvedValue(localOutcome());
        const { result } = renderSeam();

        const { promise } = await start(result);
        const payload = await promise;

        expect(processImageMock).toHaveBeenCalledTimes(1);
        expect(xhr.requests).toHaveLength(0);
        expect(payload.filename).toBe('resizo-cropped-photo.jpg');
        expect(result.current.result.resultBytes).toBe(120_000);
        expect(result.current.error).toBeNull();
        expect(result.current.isProcessing).toBe(false);
        expect(result.current.lane).toBe('local');
    });

    it('hands the measured source dimensions to the engine, before any decode', async () => {
        processImageMock.mockResolvedValue(localOutcome());
        const { result } = renderSeam();

        await start(result, { sourceWidth: 1200, sourceHeight: 800, originalBytes: 500_000 });

        const [op, source, options] = processImageMock.mock.calls[0];
        expect(op).toBe('crop');
        expect(source.name).toBe('photo.jpg');
        expect(options).toMatchObject({ sourceWidth: 1200, sourceHeight: 800 });
        // The crop rectangle still arrives under the engine's own names.
        expect(options).toMatchObject({ x: '0', y: '0', width: '100', height: '80' });
    });

    it('still runs locally when the page had nothing to measure', async () => {
        // The HEIC tool builds no preview, so it has no dimensions to give. The
        // gate must defer rather than read 0 as "damaged file" — the engine
        // re-costs the job as soon as the decoder reports the real size.
        processImageMock.mockResolvedValue(localOutcome());
        const { result } = renderSeam();

        await start(result, { sourceWidth: 0, sourceHeight: 0 });

        expect(processImageMock).toHaveBeenCalledTimes(1);
        expect(xhr.requests).toHaveLength(0);
    });

    it('calls onSuccess exactly once, with the local result', async () => {
        processImageMock.mockResolvedValue(localOutcome());
        const onSuccess = vi.fn();
        const { result } = renderSeam({ onSuccess });

        await start(result);

        expect(onSuccess).toHaveBeenCalledTimes(1);
        expect(onSuccess.mock.calls[0][0].filename).toBe('resizo-cropped-photo.jpg');
    });
});

describe('useLocalFirstProcess — the server fallback', () => {
    it('goes straight to the server when WebAssembly is unavailable', async () => {
        vi.stubGlobal('WebAssembly', undefined);
        const { result } = renderSeam();

        const { promise } = await start(result);

        expect(processImageMock).not.toHaveBeenCalled();
        expect(xhr.requests).toHaveLength(1);
        expect(xhr.last().url).toBe('/api/crop');

        const payload = await respond(promise, { status: 200, headers: OK_HEADERS, body: blobOfSize(120_000) });
        expect(payload.filename).toBe('resizo-cropped-photo.jpg');
        expect(result.current.lane).toBe('server');

        vi.unstubAllGlobals();
    });

    it('goes to the server when the capability gate refuses the file', async () => {
        const { result } = renderSeam();

        // 108 megapixels — past HARD_MAX_SOURCE_PIXELS, and only knowable
        // because the dimensions are passed in.
        const { promise } = await start(result, { sourceWidth: 12_000, sourceHeight: 9_000 });

        expect(processImageMock).not.toHaveBeenCalled();
        expect(xhr.requests).toHaveLength(1);

        await respond(promise, { status: 200, headers: OK_HEADERS, body: blobOfSize(120_000) });
        expect(result.current.error).toBeNull();
    });

    it('falls back rather than surfacing an error when the engine throws', async () => {
        processImageMock.mockRejectedValue(Object.assign(new Error('The image engine could not start in this browser.'), {
            code: 'worker-failed',
        }));
        const { result } = renderSeam();

        const { promise } = await start(result);

        expect(processImageMock).toHaveBeenCalledTimes(1);
        expect(xhr.requests).toHaveLength(1);
        // Nothing about the failed local attempt is visible while the server runs.
        expect(result.current.error).toBeNull();
        expect(result.current.isProcessing).toBe(true);

        const payload = await respond(promise, { status: 200, headers: OK_HEADERS, body: blobOfSize(120_000) });

        expect(payload.filename).toBe('resizo-cropped-photo.jpg');
        expect(result.current.error).toBeNull();
        expect(result.current.result.resultBytes).toBe(120_000);
        expect(result.current.lane).toBe('server');
    });

    it('surfaces the server error when the fallback itself fails', async () => {
        processImageMock.mockRejectedValue(new Error('engine died'));
        const { result } = renderSeam();

        const { promise } = await start(result);
        const payload = await respond(promise, {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
            body: new Blob([JSON.stringify({ error: 'Crop parameters are out of bounds of the original image dimensions.' })], { type: 'application/json' }),
        });

        expect(payload).toBeNull();
        expect(result.current.error).toBe('Crop parameters are out of bounds of the original image dimensions.');
    });
});

describe('useLocalFirstProcess — lifecycle', () => {
    it('does not fall back to the server when the visitor cancelled', async () => {
        let rejectJob;
        processImageMock.mockImplementation(() => new Promise((resolve, reject) => {
            rejectJob = () => reject(Object.assign(new Error('That was cancelled.'), { code: 'cancelled' }));
        }));
        const { result } = renderSeam();

        let promise;
        act(() => {
            promise = result.current.submit(cropForm(), { sourceWidth: 1200, sourceHeight: 800 });
        });

        let payload;
        await act(async () => {
            result.current.cancel();
            rejectJob();
            payload = await promise;
        });

        expect(payload).toBeNull();
        expect(xhr.requests).toHaveLength(0);
        expect(result.current.error).toBeNull();
        expect(result.current.isProcessing).toBe(false);
    });

    it('lets go of the codec heaps when the page unmounts', async () => {
        processImageMock.mockResolvedValue(localOutcome());
        const { result, unmount } = renderSeam();

        await start(result);
        unmount();

        expect(terminateWorkerMock).toHaveBeenCalledTimes(1);
    });

    it('resets both lanes back to an empty panel', async () => {
        processImageMock.mockResolvedValue(localOutcome());
        const { result } = renderSeam();

        await start(result);
        act(() => result.current.reset());

        expect(result.current.result).toBeNull();
        expect(result.current.error).toBeNull();
        expect(result.current.progress).toBe(0);
        expect(result.current.isProcessing).toBe(false);
    });

    it('lets a tool set its own error message', () => {
        const { result } = renderSeam();

        act(() => result.current.setError('Pick a file first.'));

        expect(result.current.error).toBe('Pick a file first.');
    });

    it('re-fires the download for the lane that produced the result', async () => {
        processImageMock.mockResolvedValue(localOutcome());
        const { result } = renderSeam();

        await start(result);

        let fired;
        act(() => {
            fired = result.current.download();
        });

        expect(fired).toBe(true);
    });
});
