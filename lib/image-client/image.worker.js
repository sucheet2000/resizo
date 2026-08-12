/**
 * The Image Worker
 *
 * A message pump and nothing else. Every decision about what a job means lives
 * in lib/image-client/operations.js; this file owns three things the operations
 * cannot own for themselves — the wire protocol, which jobs are cancelled, and
 * turning a thrown Error into something structured-clone can carry.
 *
 * WHY IT LIVES HERE AND NOT IN A TOP-LEVEL workers/ FOLDER
 *
 * Two reasons, and the second is the load-bearing one.
 *
 *  1. It is the engine's off-main-thread entry point, and the engine is
 *     lib/image-client/. A top-level workers/ directory would be a new
 *     top-level concept in a repo whose layering rules put every non-route
 *     module under lib/.
 *
 *  2. A bundler only recognises a worker from a LITERAL `new URL(...,
 *     import.meta.url)` — the specifier is resolved at build time and never
 *     goes through the jsconfig `@/` alias. Sitting next to its only caller
 *     makes that specifier `./image.worker.js`: a same-directory relative path
 *     with nothing to get wrong. Turbopack picks it up and forces a CLASSIC
 *     worker, which is why client.js must never pass `{ type: 'module' }`.
 *
 * WHY A WORKER AT ALL
 *
 * MozJPEG spends 1.74-1.88 s inside a single synchronous WASM call on a 12 MP
 * frame, and libheif another 729 ms. On the main thread that is two seconds of
 * frozen page — no scroll, no cancel button, no spinner animation. The whole
 * point is that the tab stays alive while the codec does not yield.
 *
 * THE PROTOCOL
 *
 *   in   { type: 'run',    jobId, op, source, options }
 *        { type: 'cancel', jobId }
 *   out  { type: 'progress',  jobId, progress, phase }
 *        { type: 'done',      jobId, result }
 *        { type: 'error',     jobId, error: { code, message, suggestion } }
 *        { type: 'cancelled', jobId }
 *
 * `source` is a File, a Blob or a raw buffer — or, for a multi-file op such as
 * `pdf`, an ARRAY of them in page order. A File or Blob is cloned BY
 * REFERENCE — the bytes are not copied, so handing over the picker's File is
 * already free, and an array of twenty of them is twenty references and no
 * bytes. A raw ArrayBuffer is not: it must be TRANSFERRED, which is what
 * client.js does, because structured-cloning a 45.8 MB surface would double the
 * peak on a device that was already costed to the megabyte.
 *
 * The result Blob travels back the same way: by reference, no copy.
 *
 * CANCELLATION IS COOPERATIVE, AND HAS TO BE
 *
 * Nothing can interrupt a running WASM call. A cancel therefore marks the job
 * and the operation notices at its next stage boundary — between decode and
 * resize, between resize and encode, between two probes of the exact-size
 * search. Inside a stage, the only real way to stop is for the main thread to
 * terminate the worker, which is what client.js does when the cooperative check
 * does not answer in time.
 */
import { JobError, runOperation } from '@/lib/image-client/operations';

const FALLBACK_MESSAGE = 'Something went wrong while processing that image. Try again.';

/** A raw message is never shown to a visitor if it reads like a stack trace. */
const MAX_MESSAGE_LENGTH = 200;

/** Jobs that have been started and not yet settled. */
const running = new Set();

/** Of those, the ones the main thread has asked to stop. */
const cancelled = new Set();

function post(message) {
    self.postMessage(message);
}

/**
 * Turns anything throwable into { code, message, suggestion }.
 *
 * A JobError already carries a sentence written for a person. Anything else is
 * a codec or a browser talking, so its message is only passed through when it
 * looks like something a visitor could read; otherwise it is replaced. An
 * emscripten abort string in a red box helps nobody.
 */
function toWireError(error) {
    if (error instanceof JobError) {
        return { code: error.code, message: error.message, suggestion: error.suggestion };
    }

    const message = typeof error?.message === 'string' ? error.message.trim() : '';
    const usable = message !== '' && message.length <= MAX_MESSAGE_LENGTH && !message.includes('\n');

    return { code: 'failed', message: usable ? message : FALLBACK_MESSAGE, suggestion: null };
}

async function handleRun({ jobId, op, source, options }) {
    const checkCancelled = () => {
        if (cancelled.has(jobId)) {
            throw new JobError('Cancelled.', { code: 'cancelled' });
        }
    };

    try {
        checkCancelled();

        const result = await runOperation(op, source, options ?? {}, {
            onProgress: (progress, phase) => {
                if (!cancelled.has(jobId)) post({ type: 'progress', jobId, progress, phase });
            },
            checkCancelled,
        });

        checkCancelled();
        post({ type: 'done', jobId, result });
    } catch (error) {
        if (cancelled.has(jobId) || error?.code === 'cancelled') {
            post({ type: 'cancelled', jobId });
        } else {
            post({ type: 'error', jobId, error: toWireError(error) });
        }
    } finally {
        running.delete(jobId);
        cancelled.delete(jobId);
    }
}

self.addEventListener('message', (event) => {
    const message = event.data;
    if (!message || typeof message !== 'object') return;

    if (message.type === 'cancel') {
        // Only a job that is actually running can be cancelled. Without this
        // check a cancel for a job that already finished would sit in the set
        // forever and, if ids were ever reused, kill an innocent later job.
        if (running.has(message.jobId)) cancelled.add(message.jobId);
        return;
    }

    if (message.type !== 'run' || typeof message.jobId !== 'string') return;

    // Registered synchronously, before the first await, so a cancel that
    // arrives in the very next message still finds the job.
    running.add(message.jobId);
    void handleRun(message);
});
