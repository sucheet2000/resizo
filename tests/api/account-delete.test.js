import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { allowLimiter, clearLimiters, denyLimiter } from './helpers/limiter';
import { makeSupabase } from './helpers/supabase';
import { TEST_IP, deleteRequest } from './helpers/request';

const { createServerClientMock, createClientMock } = vi.hoisted(() => ({
    createServerClientMock: vi.fn(),
    createClientMock: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({ createServerClient: createServerClientMock }));
vi.mock('@supabase/supabase-js', () => ({ createClient: createClientMock }));

const { DELETE } = await import('@/app/api/account/delete/route');

const URL_UNDER_TEST = 'http://localhost:3000/api/account/delete';

const SERVICE_ROLE_KEY = 'service-role-key-must-never-be-echoed';

function installClients({ user = { id: 'user-9', email: 'a@b.co' }, authError = null, reviewsError = null } = {}) {
    const sessionClient = makeSupabase({ user, authError });
    const adminClient = makeSupabase({
        user,
        tables: { reviews: { data: null, error: reviewsError } },
    });

    createServerClientMock.mockResolvedValue(sessionClient);
    createClientMock.mockReturnValue(adminClient);

    return { sessionClient, adminClient };
}

function removeAccount() {
    return DELETE(deleteRequest(URL_UNDER_TEST));
}

beforeEach(() => {
    clearLimiters();
    allowLimiter('account', { limit: 5, remaining: 4 });
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://project.supabase.co');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', SERVICE_ROLE_KEY);
    installClients();
});

afterEach(() => {
    clearLimiters();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
});

describe('DELETE /api/account/delete', () => {
    it('deletes the account and confirms it', async () => {
        const { adminClient } = installClients();

        const response = await removeAccount();

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ message: 'Account deleted successfully.' });
        expect(adminClient.auth.admin.deleteUser).toHaveBeenCalledWith('user-9');
    });

    it('removes the user\'s reviews before removing the account', async () => {
        const { adminClient } = installClients();

        await removeAccount();

        expect(adminClient.calls.tables.reviews).toEqual([
            { op: 'delete' },
            { op: 'eq', column: 'user_id', value: 'user-9' },
        ]);
    });

    it('signs the browser out locally so it stops holding a token for a dead account', async () => {
        const { sessionClient } = installClients();

        await removeAccount();

        expect(sessionClient.auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
        expect(sessionClient.calls.signOut).toEqual([{ scope: 'local' }]);
    });

    it('builds the admin client with the service-role key and no session persistence', async () => {
        await removeAccount();

        expect(createClientMock).toHaveBeenCalledWith(
            'https://project.supabase.co',
            SERVICE_ROLE_KEY,
            { auth: { autoRefreshToken: false, persistSession: false } }
        );
    });

    it('still deletes the account when the review cleanup fails', async () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const { adminClient } = installClients({ reviewsError: { message: 'column reviews.user_id does not exist' } });

        const response = await removeAccount();

        expect(response.status).toBe(200);
        expect(adminClient.auth.admin.deleteUser).toHaveBeenCalled();
        expect(warnSpy).toHaveBeenCalled();
    });

    it('rejects an anonymous caller', async () => {
        installClients({ user: null });

        const response = await removeAccount();

        expect(response.status).toBe(401);
        expect(await response.json()).toEqual({ error: 'Unauthorized.' });
        expect(createClientMock).not.toHaveBeenCalled();
    });

    it('rejects a caller whose session lookup errored', async () => {
        installClients({ user: null, authError: { message: 'jwt expired' } });

        expect((await removeAccount()).status).toBe(401);
    });

    it('returns 503, not 500, when the service-role key is not configured', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '');

        const response = await removeAccount();

        expect(response.status).toBe(503);
        expect(await response.json()).toEqual({ error: 'Account deletion is temporarily unavailable.' });
        expect(createClientMock).not.toHaveBeenCalled();
    });

    it('reads the service-role key per request, so importing the route never needs it', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '');
        expect((await removeAccount()).status).toBe(503);

        vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', SERVICE_ROLE_KEY);
        expect((await removeAccount()).status).toBe(200);
    });

    it('returns a generic 500 when the delete itself fails', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const { adminClient } = installClients();
        adminClient.auth.admin.deleteUser.mockResolvedValue({ error: { message: 'user not found' } });

        const response = await removeAccount();

        expect(response.status).toBe(500);
        expect(await response.json()).toEqual({ error: 'Failed to delete account. Please try again.' });
    });

    it('never echoes the service-role key in any response body', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const { adminClient } = installClients();
        adminClient.auth.admin.deleteUser.mockResolvedValue({ error: { message: `bad key ${SERVICE_ROLE_KEY}` } });

        const body = await (await removeAccount()).text();

        expect(body).not.toContain(SERVICE_ROLE_KEY);
    });

    it('does not fail the request when the post-delete sign-out throws', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const { sessionClient } = installClients();
        sessionClient.auth.signOut.mockRejectedValue(new Error('no cookie store'));

        expect((await removeAccount()).status).toBe(200);
    });

    it('returns 429 from the account bucket', async () => {
        clearLimiters();
        const limit = denyLimiter('account', { limit: 5, remaining: 0 });

        const response = await removeAccount();

        expect(response.status).toBe(429);
        expect(limit).toHaveBeenCalledWith(`account:${TEST_IP}`);
        expect(Number(response.headers.get('Retry-After'))).toBeGreaterThan(0);
        expect(createServerClientMock).not.toHaveBeenCalled();
    });

    it('masks an unexpected failure as a generic 500', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        createServerClientMock.mockRejectedValue(new Error('boom'));

        const response = await removeAccount();

        expect(response.status).toBe(500);
        expect(await response.json()).toEqual({ error: 'An internal server error occurred.' });
    });

    it('pins the Node runtime', async () => {
        const route = await import('@/app/api/account/delete/route');
        expect(route.runtime).toBe('nodejs');
        expect(route.maxDuration).toBe(30);
    });
});
