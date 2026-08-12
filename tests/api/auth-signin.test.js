import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { allowLimiter, clearLimiters, denyLimiter } from './helpers/limiter';
import { TEST_IP, jsonRequest } from './helpers/request';

const { createServerClientMock } = vi.hoisted(() => ({ createServerClientMock: vi.fn() }));

vi.mock('@/lib/supabase/server', () => ({ createServerClient: createServerClientMock }));

const { POST } = await import('@/app/api/auth/signin/route');

const URL_UNDER_TEST = 'http://localhost:3000/api/auth/signin';

const USER = { id: 'user-42', email: 'person@example.com' };

// What Supabase really hands back: a user AND a session carrying long-lived tokens.
const SESSION = {
    access_token: 'eyJhbGciOi.ACCESS-TOKEN-SHOULD-NEVER-BE-RETURNED',
    refresh_token: 'REFRESH-TOKEN-SHOULD-NEVER-BE-RETURNED',
    expires_in: 3600,
};

function installSupabase({ user = USER, error = null, session = SESSION } = {}) {
    const signInWithPassword = vi.fn(async () => ({
        data: user ? { user: { ...user, role: 'authenticated' }, session } : { user: null, session: null },
        error,
    }));
    createServerClientMock.mockResolvedValue({ auth: { signInWithPassword } });
    return signInWithPassword;
}

function signin(payload, options) {
    return POST(jsonRequest(URL_UNDER_TEST, payload, options));
}

beforeEach(() => {
    clearLimiters();
    allowLimiter('signin', { limit: 5, remaining: 3 });
    installSupabase();
});

afterEach(() => {
    clearLimiters();
    vi.restoreAllMocks();
});

describe('POST /api/auth/signin', () => {
    it('returns only the user id and email', async () => {
        const response = await signin({ email: USER.email, password: 'hunter2' });

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ user: { id: 'user-42', email: 'person@example.com' } });
    });

    it('never puts a session or a token anywhere in the response body', async () => {
        const body = await (await signin({ email: USER.email, password: 'hunter2' })).text();

        expect(body).not.toContain('access_token');
        expect(body).not.toContain('refresh_token');
        expect(body).not.toContain('ACCESS-TOKEN-SHOULD-NEVER-BE-RETURNED');
        expect(body).not.toContain('REFRESH-TOKEN-SHOULD-NEVER-BE-RETURNED');
        expect(body).not.toContain('session');
    });

    it('passes the credentials through to Supabase unchanged', async () => {
        const signInWithPassword = installSupabase();

        await signin({ email: 'a@b.co', password: 'p@ss word' });

        expect(signInWithPassword).toHaveBeenCalledWith({ email: 'a@b.co', password: 'p@ss word' });
    });

    it.each([
        ['no email', { password: 'hunter2' }],
        ['no password', { email: 'a@b.co' }],
        ['an empty email', { email: '', password: 'hunter2' }],
        ['an empty password', { email: 'a@b.co', password: '' }],
        ['an empty object', {}],
        ['a JSON null body', null],
    ])('rejects a request with %s', async (_label, payload) => {
        const response = await signin(payload);

        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({ error: 'Email and password are required.' });
    });

    it('rejects a malformed JSON body with a 400, not a crash', async () => {
        const response = await signin(undefined, { raw: '{"email":' });

        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({ error: 'Invalid request body.' });
    });

    it('collapses every credential failure into one message', async () => {
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        installSupabase({ user: null, error: { message: 'Email not confirmed' } });

        const response = await signin({ email: USER.email, password: 'hunter2' });

        expect(response.status).toBe(401);
        expect(await response.json()).toEqual({ error: 'Invalid email or password.' });
        expect(errorSpy).toHaveBeenCalledWith('[api:signin] credential failure:', 'Email not confirmed');
    });

    it('does not disclose whether an address is registered', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});

        installSupabase({ user: null, error: { message: 'Invalid login credentials' } });
        const unknown = await (await signin({ email: 'nobody@example.com', password: 'x' })).json();

        installSupabase({ user: null, error: { message: 'Email not confirmed' } });
        const known = await (await signin({ email: USER.email, password: 'x' })).json();

        expect(unknown).toEqual(known);
    });

    it('treats a missing user with no error as a credential failure', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        installSupabase({ user: null, error: null });

        const response = await signin({ email: USER.email, password: 'hunter2' });

        expect(response.status).toBe(401);
        expect(await response.json()).toEqual({ error: 'Invalid email or password.' });
    });

    it('returns 429 from the signin bucket with Retry-After', async () => {
        clearLimiters();
        const limit = denyLimiter('signin', { limit: 5, remaining: 0 });

        const response = await signin({ email: USER.email, password: 'hunter2' });

        expect(response.status).toBe(429);
        expect(limit).toHaveBeenCalledWith(`signin:${TEST_IP}`);
        expect(response.headers.get('X-RateLimit-Limit')).toBe('5');
        expect(Number(response.headers.get('Retry-After'))).toBeGreaterThan(0);
        expect(await response.json()).toEqual({
            error: 'Too many sign-in attempts. Please wait before trying again.',
        });
    });

    it('does not reach Supabase when the limiter denies the request', async () => {
        clearLimiters();
        denyLimiter('signin');

        await signin({ email: USER.email, password: 'hunter2' });

        expect(createServerClientMock).not.toHaveBeenCalled();
    });

    it('masks an unexpected failure as a generic 500', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        createServerClientMock.mockRejectedValue(new Error('SUPABASE_URL=https://secret.supabase.co is unreachable'));

        const response = await signin({ email: USER.email, password: 'hunter2' });

        expect(response.status).toBe(500);
        expect(await response.json()).toEqual({ error: 'An internal server error occurred.' });
    });

    it('answers with a 500 rather than crashing when Upstash is not configured', async () => {
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        clearLimiters();

        const response = await signin({ email: USER.email, password: 'hunter2' });

        expect(response.status).toBe(500);
        expect(errorSpy.mock.calls[0][1].name).toBe('RateLimitConfigError');
        expect(createServerClientMock).not.toHaveBeenCalled();
    });

    it('pins the Node runtime', async () => {
        const route = await import('@/app/api/auth/signin/route');
        expect(route.runtime).toBe('nodejs');
        expect(route.maxDuration).toBe(15);
    });
});
