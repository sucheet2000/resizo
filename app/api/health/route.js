/**
 * Health / Readiness
 *
 * GET /api/health is a dependency-free LIVENESS probe: it returns 200 with the
 * running commit and a timestamp and touches nothing external, so the Docker
 * HEALTHCHECK and an uptime monitor cannot be tripped by an Upstash blip.
 *
 * GET /api/health?deep=1 adds a shallow READINESS check of Upstash and
 * Supabase. Each probe is wrapped so it can never throw, and the endpoint still
 * answers 200 — the dependency results live in the body for a monitor to read,
 * rather than flapping the liveness signal.
 */
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PROBE_TIMEOUT_MS = 2000;

function baseStatus() {
    return {
        status: 'ok',
        commit: process.env.VERCEL_GIT_COMMIT_SHA ?? 'dev',
        time: new Date().toISOString(),
    };
}

async function probe(fn) {
    try {
        return await fn();
    } catch {
        return { ok: false, reason: 'unreachable' };
    }
}

function checkUpstash() {
    return probe(async () => {
        const url = process.env.UPSTASH_REDIS_REST_URL;
        const token = process.env.UPSTASH_REDIS_REST_TOKEN;
        if (!url || !token) return { ok: false, reason: 'unconfigured' };

        const response = await fetch(`${url}/ping`, {
            headers: { Authorization: `Bearer ${token}` },
            signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
        });
        return { ok: response.ok };
    });
}

function checkSupabase() {
    return probe(async () => {
        const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
        if (!url) return { ok: false, reason: 'unconfigured' };

        const response = await fetch(`${url}/auth/v1/health`, {
            headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '' },
            signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
        });
        return { ok: response.ok };
    });
}

export async function GET(request) {
    const body = baseStatus();

    if (new URL(request.url).searchParams.get('deep') === '1') {
        const [upstash, supabase] = await Promise.all([checkUpstash(), checkSupabase()]);
        body.checks = { upstash, supabase };
    }

    return NextResponse.json(body, {
        status: 200,
        headers: { 'Cache-Control': 'no-store' },
    });
}
