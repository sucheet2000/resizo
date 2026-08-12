/**
 * useLocalFirstProcess on /heic — the one tool that cannot measure its input
 *
 * HEIC is the flagship case for processing on the device: the people converting
 * a camera roll are the least likely to want a stranger's server to hold it.
 * It is also the one tool that reaches the gate with NOTHING measured. No
 * browser outside Safari decodes a HEIC, so `previews: false` is set at intake,
 * no <img> ever loads, and `entry.width` / `entry.height` stay null.
 *
 * That makes the decision here different from every other tool's, and this file
 * is about that difference:
 *
 *  - null dimensions must read as "not known yet", not as "0, therefore
 *    damaged". The first defers and runs locally; the second refuses and pushes
 *    every single iPhone photo to the server, which is the whole point lost.
 *  - the memory question is therefore only ANSWERABLE after libheif reports the
 *    real size, so the engine re-gates mid-job — and a refusal that arrives then
 *    still has to end with the visitor's photo converted, on the server, with no
 *    error and no second button press.
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

vi.mock('@vercel/blob/client', () => ({ upload: vi.fn() }));

import { useLocalFirstProcess } from '@/lib/hooks/useLocalFirstProcess';
import { assessFile, assessPixels } from '@/lib/image-client/capability';
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
    'Content-Disposition': 'attachment; filename="resizo-converted-IMG_4021.jpg"',
    'X-Original-Size': '2400000',
    'X-Output-Size': '4800000',
};

/** A 2.4 MB .heic, the shape of an ordinary iPhone still. */
function heicFile({ size = 2_400_000 } = {}) {
    return imageFile('IMG_4021.heic', 'heic', { size });
}

/** The FormData /heic posts today: the file and nothing else. */
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

function localOutcome({ bytes = 4_800_000 } = {}) {
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
    return renderHook(() => useLocalFirstProcess({
        op: 'heic',
        endpoint: '/api/heic',
        ...overrides,
    }));
}

async function start(result, options = UNMEASURED, form = heicForm()) {
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

describe('/heic — the local path', () => {
    it('converts on the device and never uploads the photo', async () => {
        processImageMock.mockResolvedValue(localOutcome());
        const { result } = renderSeam();

        const { promise } = await start(result);
        const payload = await promise;

        expect(processImageMock).toHaveBeenCalledTimes(1);
        expect(processImageMock.mock.calls[0][0]).toBe('heic');
        expect(xhr.requests).toHaveLength(0);
        expect(payload.filename).toBe('resizo-converted-IMG_4021.jpg');
        expect(result.current.lane).toBe('local');
        expect(result.current.error).toBeNull();
        expect(result.current.isProcessing).toBe(false);
    });

    it('runs locally even though nothing about the photo could be measured', async () => {
        processImageMock.mockResolvedValue(localOutcome());
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
        processImageMock.mockResolvedValue(localOutcome());
        const onSuccess = vi.fn();
        const { result } = renderSeam({ onSuccess });

        await start(result);

        expect(onSuccess).toHaveBeenCalledTimes(1);
        expect(onSuccess.mock.calls[0][0].filename).toBe('resizo-converted-IMG_4021.jpg');
    });
});

describe('/heic — the server fallback', () => {
    it('uploads when WebAssembly is unavailable, because libheif cannot run', async () => {
        vi.stubGlobal('WebAssembly', undefined);
        const { result } = renderSeam();

        const { promise } = await start(result);

        expect(processImageMock).not.toHaveBeenCalled();
        expect(xhr.requests).toHaveLength(1);
        expect(xhr.last().url).toBe('/api/heic');

        const payload = await respond(promise, { status: 200, headers: OK_HEADERS, body: blobOfSize(4_800_000) });
        expect(payload.filename).toBe('resizo-converted-IMG_4021.jpg');
        expect(result.current.lane).toBe('server');

        vi.unstubAllGlobals();
    });

    it('defers a file the gate refuses, so one rejection keeps one wording', async () => {
        // An empty .heic — a truncated AirDrop, a 0-byte placeholder. The gate
        // will not run it, and the route already answers this with a sentence
        // of its own, so nothing is gained by writing a second one here.
        const { result } = renderSeam();

        const { promise } = await start(result, UNMEASURED, heicForm(heicFile({ size: 0 })));

        expect(processImageMock).not.toHaveBeenCalled();
        expect(xhr.requests).toHaveLength(1);
        expect(xhr.last().url).toBe('/api/heic');

        const payload = await respond(promise, {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
            body: new Blob([JSON.stringify({ error: 'The uploaded file is empty.' })], { type: 'application/json' }),
        });

        expect(payload).toBeNull();
        expect(result.current.error).toBe('The uploaded file is empty.');
    });
});

describe('/heic — the re-gate, once libheif reports the real size', () => {
    it('is a refusal that can only happen after the decode', () => {
        // Nothing declares this size up front: the container is not read here,
        // so the only authority on it is libheif, and by then the pre-flight has
        // already passed. This is the verdict the engine throws mid-job, and the
        // next test is what the seam does with it.
        const verdict = assessPixels({ sourceWidth: 12_000, sourceHeight: 9_000, operation: 'heic' });

        expect(verdict.ok).toBe(false);
        expect(verdict.code).toBe('source-too-large');
    });

    it('finishes the conversion on the server when the re-gate refuses mid-job', async () => {
        processImageMock.mockRejectedValue(Object.assign(
            new Error('This 108 megapixel image is past the 80 megapixel limit for processing in a browser tab.'),
            { code: 'source-too-large' },
        ));
        const { result } = renderSeam();

        const { promise } = await start(result);

        expect(processImageMock).toHaveBeenCalledTimes(1);
        expect(xhr.requests).toHaveLength(1);
        // The abandoned local attempt says nothing. One photo was asked for and
        // one photo comes back; the visitor is not shown a failure and a retry.
        expect(result.current.error).toBeNull();
        expect(result.current.isProcessing).toBe(true);

        const payload = await respond(promise, { status: 200, headers: OK_HEADERS, body: blobOfSize(4_800_000) });

        expect(payload.filename).toBe('resizo-converted-IMG_4021.jpg');
        expect(result.current.error).toBeNull();
        expect(result.current.lane).toBe('server');
    });

    it('falls back the same way when the HEIC decoder itself will not start', async () => {
        processImageMock.mockRejectedValue(Object.assign(
            new Error('The HEIC decoder failed to start.'),
            { code: 'failed' },
        ));
        const { result } = renderSeam();

        const { promise } = await start(result);

        expect(xhr.requests).toHaveLength(1);
        expect(result.current.error).toBeNull();

        await respond(promise, { status: 200, headers: OK_HEADERS, body: blobOfSize(4_800_000) });
        expect(result.current.result.resultBytes).toBe(4_800_000);
    });

    it('shows the server’s own message when the fallback fails too', async () => {
        processImageMock.mockRejectedValue(new Error('engine died'));
        const { result } = renderSeam();

        const { promise } = await start(result);
        const payload = await respond(promise, {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
            body: new Blob([JSON.stringify({ error: 'This HEIC is too large; resize it first.' })], { type: 'application/json' }),
        });

        expect(payload).toBeNull();
        expect(result.current.error).toBe('This HEIC is too large; resize it first.');
    });
});

describe('/heic — lifecycle', () => {
    it('does not upload the photo after the visitor cancelled', async () => {
        // The longest job on the site — libheif then MozJPEG at full resolution —
        // so this is the tool where someone is most likely to press Cancel. Their
        // photo must not then be sent anywhere.
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
        expect(xhr.requests).toHaveLength(0);
        expect(result.current.error).toBeNull();
        expect(result.current.isProcessing).toBe(false);
    });

    it('lets go of the 1.4 MB HEIC decoder when the page unmounts', async () => {
        processImageMock.mockResolvedValue(localOutcome());
        const { result, unmount } = renderSeam();

        await start(result);
        unmount();

        expect(terminateWorkerMock).toHaveBeenCalledTimes(1);
    });
});
