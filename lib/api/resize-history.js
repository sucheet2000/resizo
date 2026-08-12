/**
 * resize_history Writer
 *
 * The table is read by the dashboard and the GDPR export but was never written,
 * so both were permanently empty. This records one row per successfully
 * processed image, but only when a signed-in session is present — anonymous
 * requests, which are the overwhelming majority, write nothing.
 *
 * It must never slow or fail the image response: the write is fire-and-forget,
 * every failure is swallowed to a logged warning, and the work is handed to
 * after() so a Fluid instance does not cut it off when the response completes.
 *
 * Columns match what the dashboard and the GDPR export read
 * (supabase/migrations/0002_resize_history.sql): user_id, original_filename,
 * original_format, output_format, original_size_bytes, resized_size_bytes,
 * created_at (defaulted). The dimension columns are left null for now.
 */
import { after } from 'next/server';
import { logWarn, requestIdFrom } from '@/lib/log';
import { createServerClient } from '@/lib/supabase/server';

const HISTORY_TABLE = 'resize_history';

// In-flight writes, so tests can await them. Self-clearing: each task removes
// itself on settle, so this never grows in production.
const pending = new Set();

/**
 * Supabase stores its session in cookies prefixed `sb-…-auth-token`. Checking
 * the raw cookie header lets an anonymous request skip the Supabase Auth round
 * trip entirely — only a request that could be signed in pays for getUser().
 */
function hasAuthCookie(request) {
    const cookie = request?.headers?.get?.('cookie');
    return typeof cookie === 'string' && /(?:^|;\s*)sb-[^;=]*-auth-token/.test(cookie);
}

async function writeHistory(request, { originalFilename, originalFormat, outputFormat, originalBytes, resizedBytes }) {
    try {
        const supabase = await createServerClient();

        const { data, error: authError } = await supabase.auth.getUser();
        const user = data?.user;
        if (authError || !user) return;

        const { error } = await supabase.from(HISTORY_TABLE).insert({
            user_id: user.id,
            original_filename: originalFilename ?? null,
            original_format: originalFormat,
            output_format: outputFormat,
            original_size_bytes: originalBytes,
            resized_size_bytes: resizedBytes,
        });

        if (error) {
            logWarn({
                code: 'HISTORY_WRITE_FAILED',
                route: 'resize-history',
                requestId: requestIdFrom(request),
                msg: 'resize_history insert failed',
                err: error,
            });
        }
    } catch (err) {
        logWarn({
            code: 'HISTORY_WRITE_FAILED',
            route: 'resize-history',
            requestId: requestIdFrom(request),
            msg: 'resize_history write threw',
            err,
        });
    }
}

/**
 * Fire-and-forget: records history when a session cookie is present and never
 * throws. Returns the in-flight promise for tests; callers ignore it.
 */
export function recordResizeHistory(request, meta) {
    if (!hasAuthCookie(request)) return null;

    const task = writeHistory(request, meta).finally(() => pending.delete(task));
    pending.add(task);

    // Keep the invocation alive until the write settles. after() throws outside
    // a request scope (e.g. unit tests); the task is already running, so that
    // is harmless.
    try {
        after(task);
    } catch {
        /* not in a request scope — the promise still runs and flushes below */
    }

    return task;
}

/** Test-only: awaits every in-flight history write. */
export async function flushResizeHistory() {
    await Promise.allSettled([...pending]);
}
