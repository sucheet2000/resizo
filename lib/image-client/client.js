'use client';

/**
 * The Main-Thread Side of the Worker
 *
 * One worker for the whole tab, one job at a time, and a promise per job.
 *
 * ONE WORKER, BECAUSE CODECS ARE EXPENSIVE TO START
 *
 * Each WASM codec costs a fetch, a compile and an emscripten heap that never
 * shrinks once grown — libheif alone measured 69 ms of init. A worker per job
 * would pay all of that on every file and hold several heaps at once. So the
 * worker is created on the first job, kept warm, and reused.
 *
 * ONE JOB AT A TIME, BECAUSE MEMORY IS THE BINDING CONSTRAINT
 *
 * The memory gate in capability.js costs ONE job against the tab's budget. Two
 * jobs running together spend that budget twice, and on iOS the tab is killed
 * with no exception to catch and no message to show. Jobs therefore queue on
 * the main thread and enter the worker strictly in order — which is also what
 * a bulk run wants, since twenty files in flight is twenty peaks at once.
 *
 * CANCELLATION, AND THE 250 ms THAT DECIDES HOW
 *
 * A queued job is simply dropped. A running job cannot be: nothing interrupts a
 * synchronous WASM call, so the worker is asked to stop and notices at its next
 * stage boundary. The caller's promise rejects immediately either way — a
 * person who pressed Cancel should not watch a spinner for another 1.8 s.
 *
 * What the grace period decides is only whether the WORKER survives. If the
 * cooperative stop lands within it — which it does whenever the cancel arrives
 * between stages — the worker stays warm and the queue moves on. If it does
 * not, the job is mid-encode and the only real way out is to terminate the
 * worker and build a new one, paying the codec init again. 250 ms is set just
 * above a stage boundary's own cost and far below the 507 ms-1.9 s of a
 * MozJPEG encode, so the split lands where it should: cheap cancels keep the
 * worker, expensive ones kill it.
 *
 * A FAILED WORKER IS REPLACED, NOT REUSED
 *
 * An `error` event means the worker's script died — a chunk that would not
 * load, a WASM instantiation the CSP refused. Its state is not trustworthy
 * afterwards, so it is terminated and the next job starts a fresh one. If the
 * environment has no Worker at all, jobs run on the main thread instead: the
 * page freezes during the encode, which is bad, but a frozen page beats a tool
 * that does not work.
 */

const CANCEL_GRACE_MS = 250;

const CANCELLED_MESSAGE = 'That was cancelled.';

let worker = null;
let workerUnavailable = false;
let workerFailures = 0;
let sequence = 0;

/** Jobs accepted and not yet started, in order. */
const queue = [];

/** The one job currently inside the worker (or on the main thread). */
let active = null;

/** True when this environment can run the engine off the main thread at all. */
export function workerSupported() {
    return typeof Worker === 'function' && typeof URL === 'function';
}

/**
 * The rejection every cancel produces. `name` is 'AbortError' so it reads the
 * same as an aborted fetch to anything doing duck-typed error handling, and
 * `code` is 'cancelled' to match the worker's own wire error.
 */
export class ProcessCancelledError extends Error {
    constructor(message = CANCELLED_MESSAGE) {
        super(message);
        this.name = 'AbortError';
        this.code = 'cancelled';
    }
}

/** Rebuilds a wire error into something with a stack and a code. */
function fromWireError(wire) {
    const error = new Error(wire?.message || 'Something went wrong while processing that image. Try again.');
    error.name = 'ProcessError';
    error.code = wire?.code || 'failed';
    error.suggestion = wire?.suggestion ?? null;
    return error;
}

/**
 * A raw buffer must be transferred, never cloned: structured-cloning a 45.8 MB
 * surface allocates a second one, and the memory gate budgeted for a single
 * copy. A File or Blob needs no transfer list — it is already cloned by
 * reference, bytes untouched.
 *
 * The cost of transferring is that the caller's buffer is detached and unusable
 * afterwards. That is the documented contract of passing a raw buffer here; a
 * caller that needs to keep its bytes should pass a Blob.
 */
function transferListFor(source) {
    if (typeof ArrayBuffer !== 'undefined' && source instanceof ArrayBuffer) return [source];
    if (ArrayBuffer.isView(source)) return [source.buffer];
    return [];
}

/* ------------------------------------------------------------ worker plumbing */

function handleMessage(event) {
    const message = event.data;
    if (!message || !active || message.jobId !== active.id) return;

    const job = active;

    switch (message.type) {
        case 'progress':
            if (!job.settled) job.onProgress?.(message.progress, message.phase);
            break;
        case 'done':
            resolveCaller(job, message.result);
            release(job);
            break;
        case 'error':
            rejectCaller(job, fromWireError(message.error));
            release(job);
            break;
        case 'cancelled':
            rejectCaller(job, new ProcessCancelledError());
            release(job);
            break;
        default:
            break;
    }
}

function handleWorkerFailure() {
    const job = active;
    recycleWorker();

    // Once is bad luck — a chunk that did not load, a transient failure — and
    // the next job gets a fresh worker. Twice is the environment telling us it
    // will not run one, so everything after that stays on the main thread.
    workerFailures += 1;
    if (workerFailures >= 2) workerUnavailable = true;

    if (job) {
        rejectCaller(job, fromWireError({
            code: 'worker-failed',
            message: 'The image engine could not start in this browser.',
        }));
        release(job);
    }
}

function ensureWorker() {
    if (worker) return worker;

    // The URL must be written out literally, right here: the bundler reads this
    // exact expression to discover the worker entry, and it never resolves the
    // '@/' alias. No `{ type: 'module' }` either — Turbopack emits a classic
    // worker and asking for a module one silently fails to load.
    worker = new Worker(new URL('./image.worker.js', import.meta.url));
    worker.addEventListener('message', handleMessage);
    worker.addEventListener('error', handleWorkerFailure);
    worker.addEventListener('messageerror', handleWorkerFailure);

    return worker;
}

function recycleWorker() {
    if (!worker) return;
    worker.removeEventListener('message', handleMessage);
    worker.removeEventListener('error', handleWorkerFailure);
    worker.removeEventListener('messageerror', handleWorkerFailure);
    worker.terminate();
    worker = null;
}

/* ---------------------------------------------------------------- job state */

/**
 * Drops the abort listener. Deliberately does NOT touch `cancelTimer`: that
 * timer is armed by abortJob and is what guarantees the execution slot is
 * eventually freed, so clearing it from the settle path — which abortJob calls
 * one line later — would wedge the queue forever. Only release() clears it.
 */
function detach(job) {
    if (job.signal && job.onAbort) {
        job.signal.removeEventListener('abort', job.onAbort);
        job.onAbort = null;
    }
}

function resolveCaller(job, value) {
    if (job.settled) return;
    job.settled = true;
    detach(job);
    job.resolve(value);
}

function rejectCaller(job, error) {
    if (job.settled) return;
    job.settled = true;
    detach(job);
    job.reject(error);
}

/**
 * Frees the single execution slot. Deliberately separate from settling the
 * caller's promise: a cancelled job rejects at once but keeps the slot until
 * the worker has actually stopped, so the next job never starts while the last
 * one is still holding a 45 MB surface.
 */
function release(job) {
    if (job.cancelTimer) {
        clearTimeout(job.cancelTimer);
        job.cancelTimer = null;
    }
    if (active === job) {
        active = null;
        pump();
    }
}

async function runOnMainThread(job) {
    try {
        const { runOperation } = await import('@/lib/image-client/operations');

        const result = await runOperation(job.op, job.source, job.options, {
            onProgress: (progress, phase) => {
                if (!job.settled) job.onProgress?.(progress, phase);
            },
            checkCancelled: () => {
                if (job.aborted) throw new ProcessCancelledError();
            },
        });

        resolveCaller(job, result);
    } catch (error) {
        rejectCaller(job, error?.code === 'cancelled' ? new ProcessCancelledError() : error);
    } finally {
        release(job);
    }
}

function pump() {
    if (active || queue.length === 0) return;

    const job = queue.shift();
    active = job;
    job.started = true;

    if (job.aborted) {
        release(job);
        return;
    }

    if (!workerSupported() || workerUnavailable) {
        void runOnMainThread(job);
        return;
    }

    let instance;
    try {
        instance = ensureWorker();
    } catch {
        // Construction itself failed — a CSP that forbids workers, or a
        // bundler URL that does not resolve. Never try again this session.
        workerUnavailable = true;
        void runOnMainThread(job);
        return;
    }

    try {
        instance.postMessage(
            { type: 'run', jobId: job.id, op: job.op, source: job.source, options: job.options },
            transferListFor(job.source),
        );
    } catch (error) {
        rejectCaller(job, error);
        recycleWorker();
        release(job);
    }
}

function abortJob(job) {
    if (job.aborted) return;
    job.aborted = true;

    if (!job.started) {
        const index = queue.indexOf(job);
        if (index !== -1) queue.splice(index, 1);
        rejectCaller(job, new ProcessCancelledError());
        return;
    }

    // The caller stops waiting now; the worker stops when it can.
    //
    // The `active !== job` guard is what stops this timer outliving the worker
    // it was armed for. terminateWorker() nulls `active` and settles the job,
    // but it is not release() and so does not clear this timer — and the
    // callback used to recycle whichever worker existed when it fired, killing
    // an unrelated live one and leaving that job unsettled forever.
    const timer = setTimeout(() => {
        job.cancelTimer = null;
        if (active !== job) return;
        recycleWorker();
        release(job);
    }, CANCEL_GRACE_MS);

    rejectCaller(job, new ProcessCancelledError());
    job.cancelTimer = timer;

    try {
        worker?.postMessage({ type: 'cancel', jobId: job.id });
    } catch {
        // A worker that cannot be messaged is already gone; the timer will
        // recycle it and free the slot.
    }
}

/* -------------------------------------------------------------------- public */

/**
 * Runs one image job off the main thread.
 *
 * @param {string} op       'resize' | 'crop' | 'compress' | 'convert' | 'heic' | 'pdf'
 * @param {File|Blob|ArrayBuffer|Uint8Array|Array} source
 *   A File or Blob is handed over without copying. A raw buffer is TRANSFERRED
 *   and is detached — unusable — in the caller afterwards. 'pdf' takes an ARRAY
 *   of files in page order; an array of Files is still cloned by reference, so
 *   twenty photos cost twenty references and not one copied byte.
 * @param {object} [options]  the op's fields, plus sourceWidth/sourceHeight,
 *   which should always be passed when the page has measured the image: without
 *   them the memory gate cannot run until after the decode has already
 *   allocated.
 * @param {{ onProgress?: (progress: number, phase: string) => void, signal?: AbortSignal }} [hooks]
 * @returns {Promise<object>} the result, or a rejection whose `code` is
 *   'cancelled' when the job was aborted
 */
export function processImage(op, source, options = {}, { onProgress = null, signal = null } = {}) {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) {
            reject(new ProcessCancelledError());
            return;
        }

        sequence += 1;

        const job = {
            id: `job-${sequence}`,
            op,
            source,
            options,
            onProgress,
            signal,
            resolve,
            reject,
            settled: false,
            started: false,
            aborted: false,
            cancelTimer: null,
            onAbort: null,
        };

        if (signal) {
            job.onAbort = () => abortJob(job);
            signal.addEventListener('abort', job.onAbort, { once: true });
        }

        queue.push(job);
        pump();
    });
}

/**
 * Tears the worker down and fails everything outstanding.
 *
 * Worth calling when the last tool page unmounts: an idle worker still holds
 * every codec heap it grew, which on a phone is memory the rest of the site
 * would rather have.
 */
export function terminateWorker() {
    const pending = queue.splice(0, queue.length);
    if (active) pending.unshift(active);
    active = null;

    recycleWorker();

    // Belt and braces with the guard in abortJob's timer: an armed grace timer
    // has nothing left to wait for once its worker is gone, so it is cleared
    // here rather than left to fire against a slot it no longer owns.
    for (const job of pending) {
        if (job.cancelTimer) {
            clearTimeout(job.cancelTimer);
            job.cancelTimer = null;
        }
        job.aborted = true;
        rejectCaller(job, new ProcessCancelledError());
    }
}

/** Test seam: true while a job is in flight. */
export function isBusy() {
    return active !== null;
}
