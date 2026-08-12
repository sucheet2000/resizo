/**
 * The health endpoint: the only route left on this site, and a dependency-free
 * liveness body is all it is. The `?deep=1` readiness mode went with the image
 * routes — there is no Upstash, no blob store and no pipeline to be ready for —
 * so the assertion that matters now is that an unknown query string cannot make
 * this endpoint reach for anything.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from '@/app/api/health/route';

const URL_UNDER_TEST = 'http://localhost:3000/api/health';

function getRequest(url) {
    return new Request(url, { method: 'GET' });
}

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

    it('never makes an outbound request, whatever the query string says', async () => {
        const fetchSpy = vi.spyOn(globalThis, 'fetch');

        const response = await GET(getRequest(`${URL_UNDER_TEST}?deep=1`));
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(fetchSpy).not.toHaveBeenCalled();
        expect(body.checks).toBeUndefined();
    });
});
