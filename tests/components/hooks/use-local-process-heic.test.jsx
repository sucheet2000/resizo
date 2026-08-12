/**
 * useLocalProcess on /heic — the one tool that cannot measure its input
 *
 * HEIC is the flagship case for processing on the device: the people converting
 * a camera roll are the least likely to want a stranger's server to hold it.
 * There is no stranger's server any more, which makes the gate's behaviour on
 * an UNMEASURED file the whole ballgame — a refusal here is now the end of the
 * road for the photo rather than a quiet hand-off.
 *
 * No browser outside Safari decodes a HEIC, so `previews: false` is set at
 * intake, no <img> ever loads, and `entry.width` / `entry.height` stay null.
 * That makes two things load-bearing:
 *
 *  - null dimensions must read as "not known yet", not as "0, therefore
 *    damaged". The first defers and converts the photo; the second refuses
 *    every single iPhone photo outright, which is now a dead end rather than a
 *    detour.
 *  - the memory question is therefore only ANSWERABLE after libheif reports the
 *    real size, so the engine re-gates mid-job — and the refusal that arrives
 *    then is what the visitor reads, so it has to be a sentence.
 *
 * WHAT THIS FILE DOES NOT COVER, AND WHY
 *
 * Not one real HEIC pixel. sharp cannot encode HEVC, so no decodable HEIC can be
 * committed to this repo, and a hand-rolled stand-in would only prove that the
 * stand-in parses. The engine is mocked at its module boundary and what is
 * asserted is the DECISION. The real libheif decode — 729 ms plus 69 ms of init
 * on a 12 MP iPhone photo in the Phase 0 spike — is covered by manual and
 * browser verification only, and that gap is deliberate rather than overlooked.
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
import { assessFile, assessPixels } from '@/lib/image-client/capability';
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

/** A 2.4 MB .heic, the shape of an ordinary iPhone still. */
function heicFile({ size = 2_400_000 } = {}) {
    return imageFile('IMG_4021.heic', 'heic', { size });
}

/** The FormData /heic builds: the file and nothing else. */
function heicForm(file = heicFile()) {
    const form = new FormData();
    form.append('file', file);
    return form;
}

/**
 * What the page actually passes. Both are null because there was nothing to
 * measure — this is the input under test, not a shortcut.
 */
const UNMEASURED = { originalBytes: 2_400_000, sourceWidth: null, sourceHeight: null };

function outcomeOf({ bytes = 4_800_000 } = {}) {
    return {
        blob: blobOfSize(bytes, 'image/jpeg'),
        filename: 'resizo-converted-IMG_4021.jpg',
        format: 'jpeg',
        width: 4032,
        height: 3024,
        originalBytes: 2_400_000,
        resultBytes: bytes,
        savedPercent: -100,
    };
}

function renderSeam(overrides = {}) {
    return renderHook(() => useLocalProcess({ op: 'heic', ...overrides }));
}

async function start(result, options = UNMEASURED, form = heicForm()) {
    let promise;
    await act(async () => {
        promise = result.current.submit(form, options);
    });
    return { promise };
}

describe('/heic — the conversion happens on the device', () => {
    it('converts here and never uploads the photo', async () => {
        processImageMock.mockResolvedValue(outcomeOf());
        const { result } = renderSeam();

        const { promise } = await start(result);
        const payload = await promise;

        expect(processImageMock).toHaveBeenCalledTimes(1);
        expect(processImageMock.mock.calls[0][0]).toBe('heic');
        expect(network.calls).toHaveLength(0);
        expect(payload.filename).toBe('resizo-converted-IMG_4021.jpg');
        expect(result.current.error).toBeNull();
        expect(result.current.isProcessing).toBe(false);
    });

    it('runs even though nothing about the photo could be measured', async () => {
        processImageMock.mockResolvedValue(outcomeOf());
        const { result } = renderSeam();

        await start(result);

        const [, source, options] = processImageMock.mock.calls[0];
        expect(source.name).toBe('IMG_4021.heic');
        // Passed on as absent, not as zero. The engine treats a 0 as "could not
        // be read" and refuses; absent is what makes it defer instead.
        expect(options.sourceWidth).toBeNull();
        expect(options.sourceHeight).toBeNull();
    });

    it('is what the gate itself says about an unmeasured HEIC', () => {
        // The premise of the two tests above, asserted against the gate rather
        // than assumed: a valid HEIC with no dimensions is allowed through with
        // the question still open.
        const verdict = assessFile(heicFile(), { operation: 'heic' });

        expect(verdict).toMatchObject({
            ok: true,
            code: 'dimensions-unknown',
            dimensionsKnown: false,
            estimatedPeakBytes: null,
        });
    });

    it('hands the result to the page exactly once', async () => {
        processImageMock.mockResolvedValue(outcomeOf());
        const onSuccess = vi.fn();
        const { result } = renderSeam({ onSuccess });

        await start(result);

        expect(onSuccess).toHaveBeenCalledTimes(1);
        expect(onSuccess.mock.calls[0][0].filename).toBe('resizo-converted-IMG_4021.jpg');
    });
});

describe('/heic — a refusal is the end of the road, so it has to read well', () => {
    it('says WebAssembly is off rather than silently doing nothing', async () => {
        // libheif is WASM. Without it there is no HEIC support on this site at
        // all, and that is the honest thing to say.
        vi.stubGlobal('WebAssembly', undefined);
        const { result } = renderSeam();

        const { promise } = await start(result);
        const payload = await promise;

        expect(payload).toBeNull();
        expect(processImageMock).not.toHaveBeenCalled();
        expect(network.calls).toHaveLength(0);
        expect(result.current.error).toMatch(/WebAssembly/);
        expect(result.current.error).toMatch(/[.!?]$/);

        vi.unstubAllGlobals();
    });

    it('refuses an empty .heic in words, where it used to defer', async () => {
        // A truncated AirDrop, a 0-byte placeholder. The route used to answer
        // this with a sentence of its own; that sentence has to come from here
        // now, because there is nowhere else for it to come from.
        const { result } = renderSeam();

        const { promise } = await start(result, UNMEASURED, heicForm(heicFile({ size: 0 })));
        const payload = await promise;

        expect(payload).toBeNull();
        expect(processImageMock).not.toHaveBeenCalled();
        expect(network.calls).toHaveLength(0);
        expect(result.current.error).toBeTruthy();
        expect(result.current.error).toMatch(/[.!?]$/);
    });
});

describe('/heic — the re-gate, once libheif reports the real size', () => {
    it('is a refusal that can only happen after the decode', () => {
        // Nothing declares this size up front: the container is not read here,
        // so the only authority on it is libheif, and by then the pre-flight has
        // already passed. This is the verdict the engine throws mid-job, and the
        // next test is what the hook does with it.
        const verdict = assessPixels({ sourceWidth: 12_000, sourceHeight: 9_000, operation: 'heic' });

        expect(verdict.ok).toBe(false);
        expect(verdict.code).toBe('source-too-large');
    });

    it('shows the mid-job refusal instead of quietly retrying somewhere else', async () => {
        processImageMock.mockRejectedValue(Object.assign(
            new Error('This 108 megapixel image is past the 80 megapixel limit for processing in a browser tab.'),
            {
                code: 'source-too-large',
                suggestion: 'Scale it down in a desktop app first, then bring it back here.',
            },
        ));
        const { result } = renderSeam();

        const { promise } = await start(result);
        const payload = await promise;

        expect(payload).toBeNull();
        expect(processImageMock).toHaveBeenCalledTimes(1);
        expect(network.calls).toHaveLength(0);
        expect(result.current.error).toMatch(/108 megapixel/);
        expect(result.current.suggestion).toMatch(/desktop app/);
        expect(result.current.isProcessing).toBe(false);
    });

    it('reports a decoder that will not start, rather than hanging on it', async () => {
        processImageMock.mockRejectedValue(Object.assign(
            new Error('The HEIC decoder failed to start.'),
            { code: 'failed' },
        ));
        const { result } = renderSeam();

        const { promise } = await start(result);
        await promise;

        expect(network.calls).toHaveLength(0);
        expect(result.current.error).toBe('The HEIC decoder failed to start.');
        expect(result.current.result).toBeNull();
    });
});

describe('/heic — lifecycle', () => {
    it('sends nothing anywhere after the visitor cancelled', async () => {
        // The longest job on the site — libheif then MozJPEG at full resolution —
        // so this is the tool where someone is most likely to press Cancel.
        let rejectJob;
        processImageMock.mockImplementation(() => new Promise((resolve, reject) => {
            rejectJob = () => reject(Object.assign(new Error('That was cancelled.'), { code: 'cancelled' }));
        }));
        const { result } = renderSeam();

        let promise;
        act(() => {
            promise = result.current.submit(heicForm(), UNMEASURED);
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

    it('lets go of the 1.4 MB HEIC decoder when the page unmounts', async () => {
        processImageMock.mockResolvedValue(outcomeOf());
        const { result, unmount } = renderSeam();

        await start(result);
        unmount();

        expect(terminateWorkerMock).toHaveBeenCalledTimes(1);
    });
});
