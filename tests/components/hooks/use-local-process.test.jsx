/**
 * useLocalProcess
 *
 * The one seam every tool page submits through, and now the only one there is.
 * It used to be two hooks with useLocalFirstProcess choosing between them per
 * submit; the server is gone, so the choice is gone and the three collapsed
 * into this. That changes what has to be true here, and this file is the record
 * of the change rather than a trimmed copy of what came before.
 *
 * WHAT USED TO BE ASSERTED, AND IS NOT
 *
 * Four of the old cases said "this goes to the server instead": WebAssembly
 * off, the capability gate refusing the file, the engine throwing mid-job, and
 * the server's error surfacing when the fallback itself failed. Every one of
 * them is now the same case with the opposite ending — the visitor is told, in
 * words, and nothing is sent anywhere. They are rewritten below rather than
 * deleted, because the input that produced them is still the input a real
 * person supplies.
 *
 * WHAT IS ASSERTED NOW
 *
 *  - a capable device processes the file and NOTHING touches the network, which
 *    is checked from the network side (installNetworkSentinel) rather than by
 *    trusting that the engine was called
 *  - the measured source dimensions reach the capability gate BEFORE a decode,
 *    because that is the only point at which the memory gate can still refuse —
 *    after the decode has allocated, an iOS tab is already dead
 *  - a refusal reads as a sentence a person can act on, and carries the gate's
 *    suggestion rather than leaving it in a field nothing renders
 *  - the engine is never even asked for a job the gate refused
 *  - a cancel says nothing, exactly as before
 *
 * The engine is mocked at its module boundary (lib/image-client/client), so no
 * Worker is ever constructed here — which is also true of the app in a browser
 * that cannot build one.
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

import { useLocalProcess } from '@/lib/hooks/useLocalProcess';
import { blobOfSize, imageFile, installNetworkSentinel } from '../helpers.jsx';

let network;

beforeEach(() => {
    network = installNetworkSentinel();
    processImageMock.mockReset();
    terminateWorkerMock.mockReset();
    vi.spyOn(window.HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
});

afterEach(() => {
    network.restore();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

/** The FormData /crop builds, unchanged. */
function cropForm(file = imageFile('photo.jpg', 'jpeg', { size: 500_000 })) {
    const form = new FormData();
    form.append('file', file);
    form.append('crop_x', '0');
    form.append('crop_y', '0');
    form.append('crop_width', '100');
    form.append('crop_height', '80');
    return form;
}

function outcomeOf({ bytes = 120_000 } = {}) {
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
    return renderHook(() => useLocalProcess({ op: 'crop', ...overrides }));
}

/** Starts a submit and lets every queued microtask settle. */
async function start(result, options = { sourceWidth: 1200, sourceHeight: 800 }, form = cropForm()) {
    let promise;
    await act(async () => {
        promise = result.current.submit(form, options);
    });
    return { promise };
}

describe('useLocalProcess — the work happens here', () => {
    it('processes on the device and never touches the network', async () => {
        processImageMock.mockResolvedValue(outcomeOf());
        const { result } = renderSeam();

        const { promise } = await start(result);
        const payload = await promise;

        expect(processImageMock).toHaveBeenCalledTimes(1);
        expect(network.calls).toHaveLength(0);
        expect(payload.filename).toBe('resizo-cropped-photo.jpg');
        expect(result.current.result.resultBytes).toBe(120_000);
        expect(result.current.error).toBeNull();
        expect(result.current.isProcessing).toBe(false);
    });

    it('hands the measured source dimensions to the engine, before any decode', async () => {
        processImageMock.mockResolvedValue(outcomeOf());
        const { result } = renderSeam();

        await start(result, { sourceWidth: 1200, sourceHeight: 800, originalBytes: 500_000 });

        const [op, source, options] = processImageMock.mock.calls[0];
        expect(op).toBe('crop');
        expect(source.name).toBe('photo.jpg');
        expect(options).toMatchObject({ sourceWidth: 1200, sourceHeight: 800 });
        // The crop rectangle still arrives under the engine's own names.
        expect(options).toMatchObject({ x: '0', y: '0', width: '100', height: '80' });
    });

    it('still runs when the page had nothing to measure', async () => {
        // The HEIC tool builds no preview, so it has no dimensions to give. The
        // gate must defer rather than read 0 as "damaged file" — the engine
        // re-costs the job as soon as the decoder reports the real size.
        processImageMock.mockResolvedValue(outcomeOf());
        const { result } = renderSeam();

        await start(result, { sourceWidth: 0, sourceHeight: 0 });

        expect(processImageMock).toHaveBeenCalledTimes(1);
        expect(network.calls).toHaveLength(0);
    });

    it('calls onSuccess exactly once, with the result', async () => {
        processImageMock.mockResolvedValue(outcomeOf());
        const onSuccess = vi.fn();
        const { result } = renderSeam({ onSuccess });

        await start(result);

        expect(onSuccess).toHaveBeenCalledTimes(1);
        expect(onSuccess.mock.calls[0][0].filename).toBe('resizo-cropped-photo.jpg');
    });
});

describe('useLocalProcess — a job this device cannot do is refused, not relayed', () => {
    it('says so when WebAssembly is unavailable, and asks the engine for nothing', async () => {
        vi.stubGlobal('WebAssembly', undefined);
        const { result } = renderSeam();

        const { promise } = await start(result);
        const payload = await promise;

        expect(payload).toBeNull();
        expect(processImageMock).not.toHaveBeenCalled();
        expect(network.calls).toHaveLength(0);
        expect(result.current.isProcessing).toBe(false);

        // A sentence about the browser and a sentence about what to do, not a
        // code and not a stack.
        expect(result.current.error).toMatch(/WebAssembly/);
        expect(result.current.error).toMatch(/browser/i);
        expect(result.current.error).toMatch(/[.!?]$/);

        vi.unstubAllGlobals();
    });

    it('refuses an image past the source ceiling in the gate’s own words', async () => {
        const { result } = renderSeam();

        // 108 megapixels — past HARD_MAX_SOURCE_PIXELS, and only knowable
        // because the dimensions are passed in.
        const { promise } = await start(result, { sourceWidth: 12_000, sourceHeight: 9_000 });
        const payload = await promise;

        expect(payload).toBeNull();
        expect(processImageMock).not.toHaveBeenCalled();
        expect(network.calls).toHaveLength(0);
        expect(result.current.error).toMatch(/108 megapixels/);
        expect(result.current.error).toMatch(/browser tab/);
    });

    it('joins the reason and the suggestion, so the advice is not stranded', async () => {
        const { result } = renderSeam();

        const { promise } = await start(result, { sourceWidth: 12_000, sourceHeight: 9_000 });
        await promise;

        // Both halves in the one string the panel renders, and the suggestion
        // still separately available for anything that wants it on its own.
        expect(result.current.suggestion).toBeTruthy();
        expect(result.current.error).toContain(result.current.suggestion);
        expect(result.current.error.length).toBeGreaterThan(result.current.suggestion.length);
    });

    it('refuses a file that is not a usable image at all', async () => {
        const { result } = renderSeam();
        const empty = imageFile('photo.jpg', 'jpeg', { size: 0 });

        const { promise } = await start(result, { sourceWidth: 1200, sourceHeight: 800 }, cropForm(empty));
        const payload = await promise;

        expect(payload).toBeNull();
        expect(processImageMock).not.toHaveBeenCalled();
        expect(network.calls).toHaveLength(0);
        expect(result.current.error).toBeTruthy();
        expect(result.current.error).toMatch(/[.!?]$/);
    });

    it('surfaces the engine’s message when a job that passed the gate then fails', async () => {
        // There is no second attempt behind this any more. What the engine says
        // is what the visitor reads.
        processImageMock.mockRejectedValue(Object.assign(
            new Error('The image engine could not start in this browser.'),
            { code: 'worker-failed', suggestion: 'Try reloading the page.' },
        ));
        const { result } = renderSeam();

        const { promise } = await start(result);
        const payload = await promise;

        expect(payload).toBeNull();
        expect(network.calls).toHaveLength(0);
        expect(result.current.error).toBe('The image engine could not start in this browser.');
        expect(result.current.suggestion).toBe('Try reloading the page.');
        expect(result.current.isProcessing).toBe(false);
        expect(result.current.progress).toBe(0);
    });

    it('falls back to a readable sentence when the engine throws with no message', async () => {
        processImageMock.mockRejectedValue(new Error(''));
        const { result } = renderSeam();

        const { promise } = await start(result);
        await promise;

        expect(result.current.error).toBe('Something went wrong while processing that image. Try again.');
    });
});

describe('useLocalProcess — lifecycle', () => {
    it('says nothing at all when the visitor cancelled', async () => {
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
        expect(network.calls).toHaveLength(0);
        expect(result.current.error).toBeNull();
        expect(result.current.isProcessing).toBe(false);
    });

    it('lets go of the codec heaps when the page unmounts', async () => {
        processImageMock.mockResolvedValue(outcomeOf());
        const { result, unmount } = renderSeam();

        await start(result);
        unmount();

        expect(terminateWorkerMock).toHaveBeenCalledTimes(1);
    });

    it('resets back to an empty panel', async () => {
        processImageMock.mockResolvedValue(outcomeOf());
        const { result } = renderSeam();

        await start(result);
        act(() => result.current.reset());

        expect(result.current.result).toBeNull();
        expect(result.current.error).toBeNull();
        expect(result.current.progress).toBe(0);
        expect(result.current.isProcessing).toBe(false);
    });

    it('clears a refusal on the next submit rather than stacking messages', async () => {
        const { result } = renderSeam();

        await (await start(result, { sourceWidth: 12_000, sourceHeight: 9_000 })).promise;
        expect(result.current.error).toBeTruthy();

        processImageMock.mockResolvedValue(outcomeOf());
        await (await start(result)).promise;

        expect(result.current.error).toBeNull();
        expect(result.current.suggestion).toBeNull();
        expect(result.current.result.resultBytes).toBe(120_000);
    });

    it('lets a tool set its own error message', () => {
        const { result } = renderSeam();

        act(() => result.current.setError('Pick a file first.'));

        expect(result.current.error).toBe('Pick a file first.');
    });

    it('re-fires the download for a result already in hand', async () => {
        processImageMock.mockResolvedValue(outcomeOf());
        const { result } = renderSeam();

        await start(result);

        let fired;
        act(() => {
            fired = result.current.download();
        });

        expect(fired).toBe(true);
    });

    it('requires an op', () => {
        const { result } = renderHook(() => useLocalProcess());
        expect(() => result.current.submit(new FormData())).toThrow('useLocalProcess requires an op.');
    });
});
