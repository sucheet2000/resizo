/**
 * Health / Liveness
 *
 * GET /api/health returns 200 with the running commit and a timestamp. It
 * touches nothing external, so the Docker HEALTHCHECK and an uptime monitor
 * report on the process itself and nothing else.
 *
 * There used to be a `?deep=1` readiness mode that pinged Upstash. Every image
 * tool now runs in the visitor's browser, so the server holds no request
 * throttle, no blob store and no image pipeline — there is no dependency left
 * to be ready for. A readiness check that can only ever answer "nothing to check" is worse
 * than no readiness check, because it invites a monitor to believe it means
 * something, so it is gone rather than stubbed.
 */
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
    return NextResponse.json(
        {
            status: 'ok',
            commit: process.env.VERCEL_GIT_COMMIT_SHA ?? 'dev',
            time: new Date().toISOString(),
        },
        {
            status: 200,
            headers: { 'Cache-Control': 'no-store' },
        },
    );
}
