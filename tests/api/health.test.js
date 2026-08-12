/**
 * The health endpoint: a dependency-free liveness body, and a ?deep=1 readiness
 * check whose probes can never throw or flip the 200.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from '@/app/api/health/route';
import { getRequest } from './helpers/request';

const URL_UNDER_TEST = 'http://localhost:3000/api/health';

beforeEach(() => {
    vi.unstubAllEnvs();
});

afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
});

describe('GET /api/health', () => {
    it('returns a dependency-free 200 with status, commit and time', async () => {
        const response = await GET(getRequest(URL_UNDER_TEST));

        expect(response.status).toBe(200);
        expect(response.headers.get('Cache-Control')).toBe('no-store');

        const body = await response.json();
        expect(body.status).toBe('ok');
        expect(body.commit).toBe('dev');
        expect(typeof body.time).toBe('string');
        expect(body.checks).toBeUndefined();
    });

    it('reports the deploy commit when Vercel sets it', async () => {
        vi.stubEnv('VERCEL_GIT_COMMIT_SHA', 'abc1234');

        const body = await (await GET(getRequest(URL_UNDER_TEST))).json();

        expect(body.commit).toBe('abc1234');
    });

    it('pins the Node runtime', async () => {
        const route = await import('@/app/api/health/route');
        expect(route.runtime).toBe('nodejs');
    });

    it('adds dependency checks behind ?deep=1 without ever throwing', async () => {
        vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://fake.upstash.io');
        vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'token');
        vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://fake.supabase.co');
        vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon');
        vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network down'));

        const response = await GET(getRequest(`${URL_UNDER_TEST}?deep=1`));

        expect(response.status).toBe(200);
        const body = await response.json();
        expect(body.checks.upstash.ok).toBe(false);
        expect(body.checks.supabase.ok).toBe(false);
    });

    it('marks a dependency unconfigured rather than probing it', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true });

        const body = await (await GET(getRequest(`${URL_UNDER_TEST}?deep=1`))).json();

        expect(body.checks.upstash).toEqual({ ok: false, reason: 'unconfigured' });
        expect(body.checks.supabase).toEqual({ ok: false, reason: 'unconfigured' });
    });
});
