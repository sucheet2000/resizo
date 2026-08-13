/**
 * The wire protocol in lib/image-client/image.worker.js.
 *
 * Like client.js, this file had no test of any kind before this one: every
 * suite that reached the engine either called runOperation directly or mocked
 * the client, so the message pump between them — which decides what a visitor
 * is told when a codec dies, and whether a cancel that arrives one message
 * later is honoured — was never run.
 *
 * The worker registers its listener at module scope against `self`, so `self`
 * is installed before the import and the listener is captured from it. Nothing
 * else is faked at that layer; the protocol is driven exactly as a real
 * `postMessage` would drive it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const FALLBACK_MESSAGE = 'Something went wrong while processing that image. Try again.';

let posted = [];
let deliver = null;
let runOperation = null;

/**
 * Loads a fresh copy of the worker with a fresh `self`.
 *
 * `runOperation` is replaced because this suite is about the pump, not about
 * the jobs: what it needs to control is exactly WHAT is thrown, which no real
 * fixture can do on demand.
 */
async function loadWorker(implementation) {
    vi.resetModules();
    posted = [];
    deliver = null;
    runOperation = vi.fn(implementation);

    // The real JobError, because toWireError branches on `instanceof` — and it
    // must be the one from THIS module graph, which vi.resetModules() has just
    // rebuilt. A class captured before the reset is a different class, and the
    // instanceof check would quietly fail for the right reason and the wrong
    // one at the same time.
    const { JobError } = await import('@/lib/image-client/operations');
    JobErrorHolder.value = JobError;

    vi.doMock('@/lib/image-client/operations', () => ({ JobError, runOperation }));

    globalThis.self = {
        postMessage: (message) => posted.push(message),
        addEventListener: (type, fn) => {
            if (type === 'message') deliver = (data) => fn({ data });
        },
    };

    await import('@/lib/image-client/image.worker');

    return { JobError };
}

/** Sends one message in and lets the worker's async handler settle. */
async function send(message) {
    deliver(message);
    await new Promise((resolve) => { setTimeout(resolve, 0); });
}

function messagesOfType(type) {
    return posted.filter((message) => message.type === type);
}

beforeEach(() => {
    vi.doUnmock('@/lib/image-client/operations');
});

/* ------------------------------------------------------------------ *
 * The happy path
 * ------------------------------------------------------------------ */

describe('running a job', () => {
    it('answers a run with a done carrying the result and the same jobId', async () => {
        await loadWorker(async () => ({ blob: 'x', bytes: 12 }));

        await send({ type: 'run', jobId: 'j1', op: 'convert', source: 'file', options: { format: 'png' } });

        expect(posted).toEqual([{ type: 'done', jobId: 'j1', result: { blob: 'x', bytes: 12 } }]);
        expect(runOperation).toHaveBeenCalledWith(
            'convert',
            'file',
            { format: 'png' },
            expect.objectContaining({ onProgress: expect.any(Function), checkCancelled: expect.any(Function) }),
        );
    });

    it('passes an empty options object when the caller sent none', async () => {
        await loadWorker(async () => ({}));

        await send({ type: 'run', jobId: 'j1', op: 'heic', source: 'file' });

        expect(runOperation.mock.calls[0][2]).toEqual({});
    });

    it('relays every progress report under the job it belongs to', async () => {
        await loadWorker(async (op, source, options, { onProgress }) => {
            onProgress(10, 'decoding');
            onProgress(95, 'encoded');
            return {};
        });

        await send({ type: 'run', jobId: 'j1', op: 'resize', source: 'file', options: {} });

        expect(messagesOfType('progress')).toEqual([
            { type: 'progress', jobId: 'j1', progress: 10, phase: 'decoding' },
            { type: 'progress', jobId: 'j1', progress: 95, phase: 'encoded' },
        ]);
    });

    it('ignores anything that is not a run or a cancel', async () => {
        await loadWorker(async () => ({}));

        await send(null);
        await send('a string');
        await send({ type: 'nonsense', jobId: 'j1' });
        await send({ type: 'run', jobId: 42 });

        expect(posted).toEqual([]);
        expect(runOperation).not.toHaveBeenCalled();
    });
});

/* ------------------------------------------------------------------ *
 * Cancellation
 * ------------------------------------------------------------------ */

describe('cancelling', () => {
    /**
     * The cancel is registered synchronously, before the first await, so a
     * cancel arriving in the very next message still finds the job.
     */
    it('stops a job whose cancel lands while it is running', async () => {
        let release;
        const held = new Promise((resolve) => { release = resolve; });

        await loadWorker(async (op, source, options, { checkCancelled }) => {
            await held;
            checkCancelled();
            return {};
        });

        deliver({ type: 'run', jobId: 'j1', op: 'resize', source: 'file', options: {} });
        deliver({ type: 'cancel', jobId: 'j1' });
        release();
        await new Promise((resolve) => { setTimeout(resolve, 0); });

        expect(posted).toEqual([{ type: 'cancelled', jobId: 'j1' }]);
    });

    it('says nothing more once a job has been cancelled', async () => {
        let release;
        const held = new Promise((resolve) => { release = resolve; });

        await loadWorker(async (op, source, options, { onProgress, checkCancelled }) => {
            await held;
            onProgress(50, 'resizing');
            checkCancelled();
            return {};
        });

        deliver({ type: 'run', jobId: 'j1', op: 'resize', source: 'file', options: {} });
        deliver({ type: 'cancel', jobId: 'j1' });
        release();
        await new Promise((resolve) => { setTimeout(resolve, 0); });

        expect(messagesOfType('progress')).toEqual([]);
    });

    /**
     * Without the `running` check a cancel for a finished job would sit in the
     * set forever and, if ids were ever reused, kill an innocent later job.
     */
    it('does not let a cancel for a finished job poison the next one with that id', async () => {
        await loadWorker(async () => ({ done: true }));

        await send({ type: 'run', jobId: 'j1', op: 'resize', source: 'file', options: {} });
        await send({ type: 'cancel', jobId: 'j1' });
        await send({ type: 'run', jobId: 'j1', op: 'resize', source: 'file', options: {} });

        expect(messagesOfType('done')).toHaveLength(2);
        expect(messagesOfType('cancelled')).toHaveLength(0);
    });

    it('reports a job that threw its own cancellation as cancelled, not failed', async () => {
        await loadWorker(async () => {
            throw new JobErrorHolder.value('Cancelled.', { code: 'cancelled' });
        });

        await send({ type: 'run', jobId: 'j1', op: 'resize', source: 'file', options: {} });

        expect(posted).toEqual([{ type: 'cancelled', jobId: 'j1' }]);
    });
});

/**
 * `loadWorker` needs the real JobError inside the implementation it is handed,
 * and the implementation is written before the import resolves. A one-field
 * holder is the smallest way to close that loop without a second loader.
 */
const JobErrorHolder = { value: null };

/* ------------------------------------------------------------------ *
 * Turning a throw into something a person can read
 * ------------------------------------------------------------------ */

describe('what a failure is turned into on the wire', () => {
    it('passes a JobError through with its code, sentence and suggestion intact', async () => {
        await loadWorker(async () => {
            throw new JobErrorHolder.value('This image is 900 megapixels.', {
                code: 'source-too-large',
                suggestion: 'Scale it down first.',
            });
        });

        await send({ type: 'run', jobId: 'j1', op: 'convert', source: 'file', options: {} });

        expect(posted).toEqual([{
            type: 'error',
            jobId: 'j1',
            error: {
                code: 'source-too-large',
                message: 'This image is 900 megapixels.',
                suggestion: 'Scale it down first.',
            },
        }]);
    });

    it('replaces a message long enough to be a stack trace', async () => {
        await loadWorker(async () => { throw new Error('x'.repeat(201)); });

        await send({ type: 'run', jobId: 'j1', op: 'convert', source: 'file', options: {} });

        expect(posted[0].error).toEqual({ code: 'failed', message: FALLBACK_MESSAGE, suggestion: null });
    });

    it('keeps a message of exactly the 200-character limit', async () => {
        const message = 'y'.repeat(200);
        await loadWorker(async () => { throw new Error(message); });

        await send({ type: 'run', jobId: 'j1', op: 'convert', source: 'file', options: {} });

        expect(posted[0].error.message).toBe(message);
    });

    it('replaces a multi-line message, which is what an emscripten abort looks like', async () => {
        await loadWorker(async () => {
            throw new Error('abort(OOM)\n  at wasm://wasm/0001\n  at Module._malloc');
        });

        await send({ type: 'run', jobId: 'j1', op: 'convert', source: 'file', options: {} });

        expect(posted[0].error.message).toBe(FALLBACK_MESSAGE);
    });

    it.each([
        ['an empty message', ''],
        ['whitespace only', '   \t  '],
    ])('replaces %s', async (_label, message) => {
        await loadWorker(async () => { throw new Error(message); });

        await send({ type: 'run', jobId: 'j1', op: 'convert', source: 'file', options: {} });

        expect(posted[0].error.message).toBe(FALLBACK_MESSAGE);
    });

    it('replaces a throw that is not an Error at all', async () => {
        await loadWorker(async () => { throw 'a bare string'; });

        await send({ type: 'run', jobId: 'j1', op: 'convert', source: 'file', options: {} });

        expect(posted[0].error).toEqual({ code: 'failed', message: FALLBACK_MESSAGE, suggestion: null });
    });

    /**
     * KNOWN HOLE, PINNED DELIBERATELY.
     *
     * toWireError's own docblock says an emscripten abort string in a red box
     * helps nobody, and its rule for spotting one is "long, or multi-line".
     * A WebAssembly trap is neither: `RuntimeError: unreachable` is eleven
     * characters on one line, so it passes the filter and is shown to the
     * visitor verbatim. It is reachable — a PNG whose IHDR declares 30000x30000
     * over a few hundred bytes of image data traps exactly this way inside
     * @jsquash/png (see hostile-inputs.test.js).
     *
     * This test records the CURRENT behaviour so the hole is visible and so a
     * fix registers as a deliberate change rather than a surprise. It is not an
     * endorsement: the fix is an allowlist of codes or a known-trap list, and
     * that is a product decision about wording, not a cleanup to slip in here.
     */
    it('KNOWN HOLE — shows a bare WebAssembly trap word to the visitor verbatim', async () => {
        await loadWorker(async () => {
            const trap = new Error('unreachable');
            trap.name = 'RuntimeError';
            throw trap;
        });

        await send({ type: 'run', jobId: 'j1', op: 'convert', source: 'file', options: {} });

        expect(posted[0].error).toEqual({ code: 'failed', message: 'unreachable', suggestion: null });
    });
});
