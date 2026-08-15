/**
 * The main-thread side of the engine: lib/image-client/client.js.
 *
 * Until this file existed, client.js had NO test of any kind. Every suite that
 * touched it — the tool components, the hooks, the bulk run — replaced it with
 * `vi.mock('@/lib/image-client/client')` and asserted against the mock. So the
 * 390 lines that actually decide whether two jobs can run at once, whether a
 * cancel frees the execution slot, and whether a dead worker takes the tab's
 * tools down with it were being asserted about and never exercised.
 *
 * Everything here drives the REAL module. The only thing replaced is `Worker`
 * itself, because Node has none — and that is the seam the module was written
 * against anyway (`workerSupported()` is a `typeof Worker` check).
 *
 * The module holds process-wide state (the worker handle, the queue, the
 * "never try a worker again" latch), so every block re-imports it through
 * `vi.resetModules()` rather than sharing one instance and hoping the order
 * of the file never changes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** The 250 ms in client.js, which the cancel path arms a timer against. */
const CANCEL_GRACE_MS = 250;

/* ------------------------------------------------------------------ *
 * A Worker that does exactly what the protocol says and nothing else
 * ------------------------------------------------------------------ */

let workers = [];

/**
 * Records every message the client posts and lets a test answer them by hand.
 *
 * Nothing is answered automatically. The whole point of the queue tests is to
 * hold one job open and watch what the client does with the next, which is
 * impossible against a worker that replies on its own.
 */
class FakeWorker {
    constructor(url) {
        this.url = url;
        this.posted = [];
        this.transfers = [];
        this.terminated = false;
        this.listeners = new Map();
        workers.push(this);
    }

    addEventListener(type, fn) {
        if (!this.listeners.has(type)) this.listeners.set(type, new Set());
        this.listeners.get(type).add(fn);
    }

    removeEventListener(type, fn) {
        this.listeners.get(type)?.delete(fn);
    }

    postMessage(message, transfer) {
        if (this.terminated) throw new Error('posted to a terminated worker');
        this.posted.push(message);
        this.transfers.push(transfer);
    }

    terminate() {
        this.terminated = true;
    }

    /** Delivers one message from the worker back to the client. */
    emit(type, payload) {
        for (const fn of this.listeners.get(type) ?? []) fn(payload);
    }

    reply(message) {
        this.emit('message', { data: message });
    }

    /** The jobId of the nth `run` the client sent. */
    jobIdAt(index = 0) {
        return this.posted.filter((message) => message.type === 'run')[index]?.jobId ?? null;
    }
}

let constructionThrows = false;

function installWorker() {
    workers = [];
    constructionThrows = false;
    globalThis.Worker = function Worker(url) {
        if (constructionThrows) throw new Error('workers are blocked here');
        return new FakeWorker(url);
    };
}

/** The current (last-built) worker, which is the one the client is holding. */
function currentWorker() {
    return workers[workers.length - 1];
}

/** A promise's settled shape, without a test ever having to try/catch inline. */
async function settle(promise) {
    try {
        return { ok: true, value: await promise };
    } catch (error) {
        return { ok: false, error };
    }
}

/** Lets the microtask queue drain so a pump() scheduled by a settle can run. */
const tick = () => new Promise((resolve) => { setTimeout(resolve, 0); });

async function loadClient() {
    vi.resetModules();
    installWorker();
    return import('@/lib/image-client/client');
}

afterEach(() => {
    delete globalThis.Worker;
    vi.useRealTimers();
});

/* ------------------------------------------------------------------ *
 * Environment probe
 * ------------------------------------------------------------------ */

describe('whether this environment can run the engine off the main thread', () => {
    it('says yes when Worker and URL both exist', async () => {
        const { workerSupported } = await loadClient();
        expect(workerSupported()).toBe(true);
    });

    it('says no when there is no Worker constructor at all', async () => {
        const { workerSupported } = await loadClient();
        delete globalThis.Worker;
        expect(workerSupported()).toBe(false);
    });
});

/* ------------------------------------------------------------------ *
 * The happy path and the wire
 * ------------------------------------------------------------------ */

describe('one job through the worker', () => {
    let client;

    beforeEach(async () => {
        client = await loadClient();
    });

    it('posts a run message carrying the op, the source and the options', async () => {
        const file = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' });
        const promise = client.processImage('convert', file, { format: 'png' });

        const worker = currentWorker();
        expect(worker.posted).toHaveLength(1);
        expect(worker.posted[0]).toMatchObject({
            type: 'run',
            op: 'convert',
            source: file,
            options: { format: 'png' },
        });
        expect(typeof worker.posted[0].jobId).toBe('string');

        worker.reply({ type: 'done', jobId: worker.jobIdAt(0), result: { ok: 1 } });
        await expect(promise).resolves.toEqual({ ok: 1 });
    });

    it('is busy while the job is in flight and idle once it settles', async () => {
        const promise = client.processImage('convert', new Blob(['x']), {});
        expect(client.isBusy()).toBe(true);

        const worker = currentWorker();
        worker.reply({ type: 'done', jobId: worker.jobIdAt(0), result: {} });
        await promise;
        await tick();

        expect(client.isBusy()).toBe(false);
    });

    it('forwards progress to the caller, and stops once the job has settled', async () => {
        const onProgress = vi.fn();
        const promise = client.processImage('resize', new Blob(['x']), {}, { onProgress });

        const worker = currentWorker();
        const jobId = worker.jobIdAt(0);

        worker.reply({ type: 'progress', jobId, progress: 45, phase: 'decoded' });
        expect(onProgress).toHaveBeenCalledWith(45, 'decoded');

        worker.reply({ type: 'done', jobId, result: {} });
        await promise;

        worker.reply({ type: 'progress', jobId, progress: 90, phase: 'encoding' });
        expect(onProgress).toHaveBeenCalledTimes(1);
    });

    it('ignores a message addressed to a job that is not the running one', async () => {
        const promise = client.processImage('resize', new Blob(['x']), {});
        const worker = currentWorker();

        worker.reply({ type: 'done', jobId: 'job-not-mine', result: { wrong: true } });
        worker.reply({ type: 'done', jobId: worker.jobIdAt(0), result: { right: true } });

        await expect(promise).resolves.toEqual({ right: true });
    });

    it('rebuilds a wire error into something with a code and a suggestion', async () => {
        const promise = client.processImage('convert', new Blob(['x']), {});
        const worker = currentWorker();

        worker.reply({
            type: 'error',
            jobId: worker.jobIdAt(0),
            error: { code: 'invalid-type', message: 'That is not an image.', suggestion: 'Try a JPEG.' },
        });

        const outcome = await settle(promise);
        expect(outcome.ok).toBe(false);
        expect(outcome.error).toBeInstanceOf(Error);
        expect(outcome.error.name).toBe('ProcessError');
        expect(outcome.error.code).toBe('invalid-type');
        expect(outcome.error.message).toBe('That is not an image.');
        expect(outcome.error.suggestion).toBe('Try a JPEG.');
    });

    it('falls back to a readable sentence when the wire error carries none', async () => {
        const promise = client.processImage('convert', new Blob(['x']), {});
        const worker = currentWorker();

        worker.reply({ type: 'error', jobId: worker.jobIdAt(0), error: {} });

        const outcome = await settle(promise);
        expect(outcome.error.code).toBe('failed');
        expect(outcome.error.message).toBe(
            'Something went wrong while processing that image. Try again.',
        );
    });
});

/* ------------------------------------------------------------------ *
 * Transfers — the memory contract of handing a buffer over
 * ------------------------------------------------------------------ */

describe('what gets copied on the way into the worker', () => {
    let client;

    beforeEach(async () => {
        client = await loadClient();
    });

    /**
     * A raw surface is 45.8 MB at 12 MP and the memory gate costed ONE copy of
     * it. Structured-cloning it instead of transferring would allocate a second
     * one behind the gate's back, on the device least able to afford it.
     */
    it('TRANSFERS a raw ArrayBuffer rather than letting it be cloned', async () => {
        const buffer = new ArrayBuffer(64);
        client.processImage('resize', buffer, {});

        expect(currentWorker().transfers[0]).toEqual([buffer]);
    });

    it('transfers the underlying buffer of a typed-array view', async () => {
        const view = new Uint8Array(64);
        client.processImage('resize', view, {});

        expect(currentWorker().transfers[0]).toEqual([view.buffer]);
    });

    /** A Blob is already cloned by reference; a transfer list would be a lie. */
    it('transfers nothing for a Blob, whose bytes are never copied anyway', async () => {
        client.processImage('resize', new Blob(['x']), {});
        expect(currentWorker().transfers[0]).toEqual([]);
    });

    it('transfers nothing for an array of files, which is what /jpg-to-pdf sends', async () => {
        client.processImage('pdf', [new Blob(['a']), new Blob(['b'])], {});
        expect(currentWorker().transfers[0]).toEqual([]);
    });
});

/* ------------------------------------------------------------------ *
 * The queue — one job at a time, in order
 * ------------------------------------------------------------------ */

describe('two jobs back to back', () => {
    let client;

    beforeEach(async () => {
        client = await loadClient();
    });

    /**
     * The memory gate costs ONE job against the tab's budget. Two jobs inside
     * the worker together spend it twice, and on iOS that is a silent kill.
     */
    it('never has two jobs in the worker at once', async () => {
        const first = client.processImage('resize', new Blob(['a']), { n: 1 });
        const second = client.processImage('resize', new Blob(['b']), { n: 2 });

        const worker = currentWorker();
        expect(worker.posted.filter((message) => message.type === 'run')).toHaveLength(1);
        expect(worker.posted[0].options).toEqual({ n: 1 });

        worker.reply({ type: 'done', jobId: worker.jobIdAt(0), result: { which: 1 } });
        await first;
        await tick();

        const runs = worker.posted.filter((message) => message.type === 'run');
        expect(runs).toHaveLength(2);
        expect(runs[1].options).toEqual({ n: 2 });

        worker.reply({ type: 'done', jobId: worker.jobIdAt(1), result: { which: 2 } });
        await expect(second).resolves.toEqual({ which: 2 });
    });

    it('starts them in the order they were accepted', async () => {
        const jobs = [1, 2, 3].map((n) => client.processImage('resize', new Blob(['x']), { n }));
        const worker = currentWorker();

        for (let index = 0; index < jobs.length; index += 1) {
            const runs = worker.posted.filter((message) => message.type === 'run');
            expect(runs[index].options).toEqual({ n: index + 1 });
            worker.reply({ type: 'done', jobId: worker.jobIdAt(index), result: { n: index + 1 } });
            await jobs[index];
            await tick();
        }
    });

    it('reuses the one warm worker rather than building a second', async () => {
        const first = client.processImage('resize', new Blob(['a']), {});
        const worker = currentWorker();
        worker.reply({ type: 'done', jobId: worker.jobIdAt(0), result: {} });
        await first;
        await tick();

        const second = client.processImage('resize', new Blob(['b']), {});
        worker.reply({ type: 'done', jobId: worker.jobIdAt(1), result: {} });
        await second;

        expect(workers).toHaveLength(1);
    });
});

/* ------------------------------------------------------------------ *
 * Cancellation
 * ------------------------------------------------------------------ */

describe('cancelling', () => {
    let client;

    beforeEach(async () => {
        client = await loadClient();
    });

    it('refuses a job whose signal was already aborted, without touching the worker', async () => {
        const controller = new AbortController();
        controller.abort();

        const outcome = await settle(
            client.processImage('resize', new Blob(['x']), {}, { signal: controller.signal }),
        );

        expect(outcome.ok).toBe(false);
        expect(outcome.error).toBeInstanceOf(client.ProcessCancelledError);
        expect(outcome.error.name).toBe('AbortError');
        expect(outcome.error.code).toBe('cancelled');
        expect(workers).toHaveLength(0);
    });

    /**
     * A person who pressed Cancel should not watch a spinner for another 1.8 s
     * while MozJPEG finishes. The promise rejects now; the worker stops when it
     * can.
     */
    it('rejects the caller immediately and asks the worker to stop', async () => {
        const controller = new AbortController();
        const promise = client.processImage('resize', new Blob(['x']), {}, { signal: controller.signal });

        const worker = currentWorker();
        const jobId = worker.jobIdAt(0);

        controller.abort();

        const outcome = await settle(promise);
        expect(outcome.ok).toBe(false);
        expect(outcome.error.code).toBe('cancelled');
        expect(worker.posted).toContainEqual({ type: 'cancel', jobId });
    });

    /** A queued job never entered the worker, so it is simply dropped. */
    it('drops a queued job without ever posting it', async () => {
        const controller = new AbortController();

        const first = client.processImage('resize', new Blob(['a']), { n: 1 });
        const second = client.processImage(
            'resize', new Blob(['b']), { n: 2 }, { signal: controller.signal },
        );

        controller.abort();

        const outcome = await settle(second);
        expect(outcome.error.code).toBe('cancelled');

        const worker = currentWorker();
        worker.reply({ type: 'done', jobId: worker.jobIdAt(0), result: {} });
        await first;
        await tick();

        const runs = worker.posted.filter((message) => message.type === 'run');
        expect(runs).toHaveLength(1);
        expect(runs[0].options).toEqual({ n: 1 });
    });

    /**
     * A cheap cancel — one that lands between two stages — keeps the worker
     * warm, because rebuilding it costs every codec's init again.
     */
    it('keeps the worker when the cooperative stop lands inside the grace period', async () => {
        vi.useFakeTimers();

        const controller = new AbortController();
        const promise = client.processImage('resize', new Blob(['x']), {}, { signal: controller.signal });
        const worker = currentWorker();
        const jobId = worker.jobIdAt(0);

        controller.abort();
        await settle(promise);

        worker.reply({ type: 'cancelled', jobId });
        vi.advanceTimersByTime(CANCEL_GRACE_MS * 4);

        expect(worker.terminated).toBe(false);
        expect(client.isBusy()).toBe(false);
    });

    /**
     * An expensive one — mid-encode, where nothing can interrupt a synchronous
     * WASM call — has no way out but terminating the worker. The slot must be
     * freed either way, or the queue wedges forever.
     */
    it('terminates the worker and frees the slot when the stop never arrives', async () => {
        vi.useFakeTimers();

        const controller = new AbortController();
        const promise = client.processImage('resize', new Blob(['x']), {}, { signal: controller.signal });
        const worker = currentWorker();

        controller.abort();
        await settle(promise);

        expect(client.isBusy()).toBe(true);

        vi.advanceTimersByTime(CANCEL_GRACE_MS + 1);

        expect(worker.terminated).toBe(true);
        expect(client.isBusy()).toBe(false);
    });

    it('aborting twice is not an error and does not post a second cancel', async () => {
        const controller = new AbortController();
        const promise = client.processImage('resize', new Blob(['x']), {}, { signal: controller.signal });
        const worker = currentWorker();

        controller.abort();
        await settle(promise);
        controller.abort();

        expect(worker.posted.filter((message) => message.type === 'cancel')).toHaveLength(1);
    });
});

/* ------------------------------------------------------------------ *
 * terminateWorker — what a tool page's unmount actually does
 * ------------------------------------------------------------------ */

describe('tearing the worker down', () => {
    let client;

    beforeEach(async () => {
        client = await loadClient();
    });

    it('fails the running job and every queued one, as cancellations', async () => {
        const first = settle(client.processImage('resize', new Blob(['a']), {}));
        const second = settle(client.processImage('resize', new Blob(['b']), {}));
        const worker = currentWorker();

        client.terminateWorker();

        expect((await first).error.code).toBe('cancelled');
        expect((await second).error.code).toBe('cancelled');
        expect(worker.terminated).toBe(true);
        expect(client.isBusy()).toBe(false);
    });

    it('is safe to call with nothing running', async () => {
        expect(() => client.terminateWorker()).not.toThrow();
        expect(client.isBusy()).toBe(false);
    });

    it('builds a fresh worker for the next job', async () => {
        const first = settle(client.processImage('resize', new Blob(['a']), {}));
        client.terminateWorker();
        await first;

        client.processImage('resize', new Blob(['b']), {});
        expect(workers).toHaveLength(2);
        expect(workers[0].terminated).toBe(true);
        expect(workers[1].terminated).toBe(false);
    });

    /**
     * The unmount cleanup in lib/hooks/useLocalProcess.js runs these two lines
     * back to back:
     *
     *     controllerRef.current?.abort();
     *     terminateWorker();
     *
     * The abort arms a 250 ms grace timer whose callback used to call
     * recycleWorker() unconditionally. terminateWorker() then nulled `active`
     * and settled the job — but nothing cleared that timer, because release()
     * is the only function that does and it no longer owned the job. The timer
     * outlived the worker it was armed for, and killed whichever worker existed
     * when it fired.
     *
     * The victim's listeners are removed on termination, so its 'done' can
     * never arrive: the promise never settles, `active` is never freed, and
     * every later job queues behind a job that cannot finish. That is the
     * silent no-op the engine contract forbids — a spinner and no words.
     */
    /**
     * "Twice is the environment telling us it will not run one" — but the
     * counter only ever went up. Nothing reset it, and the module state lives
     * for the whole tab session, so it measured "two failures EVER" rather than
     * "this environment cannot run a worker".
     *
     * One dropped chunk fetch early on, a successful hour of work, then a
     * second dropped fetch, and the tab is downgraded to main-thread
     * processing for good — every encode blocking for the 1.74-1.88 s
     * image.worker.js documents, with no way back short of a reload.
     *
     * The fallback itself is deliberate and documented ("a frozen page beats a
     * tool that does not work"). What was wrong is the trigger: it should be
     * two CONSECUTIVE failures, which is what the comment claims.
     */
    it('forgets an isolated failure once a job succeeds', async () => {
        const first = settle(client.processImage('resize', new Blob(['a']), {}));
        currentWorker().emit('error', { type: 'error' });
        await first;

        // A worker job succeeds — the environment can clearly run one.
        const second = settle(client.processImage('resize', new Blob(['b']), {}));
        const good = currentWorker();
        good.reply({ type: 'done', jobId: good.jobIdAt(0), blob: new Blob(['ok']) });
        expect((await second).error).toBeUndefined();

        // A second, unrelated transient failure much later.
        const third = settle(client.processImage('resize', new Blob(['c']), {}));
        currentWorker().emit('error', { type: 'error' });
        await third;

        const built = workers.length;
        const fourth = settle(client.processImage('resize', new Blob(['d']), {}));

        expect(
            workers.length,
            'two failures an hour apart latched the tab onto the main thread for good',
        ).toBe(built + 1);

        const retry = currentWorker();
        retry.reply({ type: 'done', jobId: retry.jobIdAt(0), blob: new Blob(['ok']) });
        expect((await fourth).error).toBeUndefined();
    });

    it('does not let a cancel timer from a torn-down worker kill the next one', async () => {
        vi.useFakeTimers();

        const controller = new AbortController();
        const first = settle(
            client.processImage('resize', new Blob(['a']), {}, { signal: controller.signal }),
        );

        // Verbatim unmount cleanup: abort arms the timer, terminate orphans it.
        controller.abort();
        client.terminateWorker();
        await first;

        // A new page mounts and the visitor submits inside the remaining grace.
        vi.advanceTimersByTime(CANCEL_GRACE_MS - 50);
        const second = settle(client.processImage('resize', new Blob(['b']), {}));
        const survivor = currentWorker();

        vi.advanceTimersByTime(CANCEL_GRACE_MS * 4);

        expect(survivor.terminated, 'the orphaned timer killed an unrelated worker').toBe(false);

        survivor.reply({ type: 'done', jobId: survivor.jobIdAt(0), blob: new Blob(['ok']) });
        await vi.advanceTimersByTimeAsync(0);

        expect((await second).error, 'the second job never settled').toBeUndefined();
        expect(client.isBusy(), 'the slot was never freed').toBe(false);
    });
});

/* ------------------------------------------------------------------ *
 * A worker that will not run — the fallback that keeps the tools working
 * ------------------------------------------------------------------ */

describe('when the worker cannot be used', () => {
    /**
     * A CSP that forbids workers, or a bundler URL that does not resolve. The
     * page freezes during the encode, which is bad — but a frozen page beats a
     * tool that does not work at all.
     */
    it('runs the job on the main thread when the constructor throws', async () => {
        const client = await loadClient();
        constructionThrows = true;

        vi.doMock('@/lib/image-client/operations', () => ({
            runOperation: vi.fn(async () => ({ mainThread: true })),
        }));

        await expect(client.processImage('resize', new Blob(['x']), {})).resolves.toEqual({
            mainThread: true,
        });
        expect(workers).toHaveLength(0);

        vi.doUnmock('@/lib/image-client/operations');
    });

    it('runs on the main thread when the environment has no Worker at all', async () => {
        const client = await loadClient();
        delete globalThis.Worker;

        vi.doMock('@/lib/image-client/operations', () => ({
            runOperation: vi.fn(async () => ({ mainThread: true })),
        }));

        await expect(client.processImage('convert', new Blob(['x']), {})).resolves.toEqual({
            mainThread: true,
        });

        vi.doUnmock('@/lib/image-client/operations');
    });

    /**
     * Once is bad luck. Twice is the environment saying it will not run one, so
     * every job after that stays on the main thread rather than paying for a
     * worker that dies each time.
     */
    it('gives up on workers after the second failure and stays on the main thread', async () => {
        const client = await loadClient();

        vi.doMock('@/lib/image-client/operations', () => ({
            runOperation: vi.fn(async () => ({ mainThread: true })),
        }));

        for (let attempt = 0; attempt < 2; attempt += 1) {
            const outcome = settle(client.processImage('resize', new Blob(['x']), {}));
            currentWorker().emit('error', { type: 'error' });
            const settled = await outcome;
            expect(settled.ok).toBe(false);
            expect(settled.error.code).toBe('worker-failed');
            expect(settled.error.message).toBe('The image engine could not start in this browser.');
            await tick();
        }

        const built = workers.length;
        await expect(client.processImage('resize', new Blob(['x']), {})).resolves.toEqual({
            mainThread: true,
        });
        expect(workers).toHaveLength(built);

        vi.doUnmock('@/lib/image-client/operations');
    });

    it('reports a cancel from the main-thread path as a cancellation', async () => {
        const client = await loadClient();
        delete globalThis.Worker;

        vi.doMock('@/lib/image-client/operations', () => ({
            runOperation: vi.fn(async (op, source, options, { checkCancelled }) => {
                checkCancelled();
                return {};
            }),
        }));

        const controller = new AbortController();
        const promise = client.processImage('resize', new Blob(['x']), {}, { signal: controller.signal });
        controller.abort();

        const outcome = await settle(promise);
        expect(outcome.ok).toBe(false);
        expect(outcome.error.code).toBe('cancelled');

        vi.doUnmock('@/lib/image-client/operations');
    });
});
