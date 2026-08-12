/**
 * resize_history writer, exercised end to end through the resize route.
 *
 * Supabase is mocked at @/lib/supabase/server so no network or session is
 * needed; the route runs real sharp on a real fixture. The write is
 * fire-and-forget, so each test flushes the in-flight tasks before asserting.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { createServerClientMock } = vi.hoisted(() => ({ createServerClientMock: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createServerClient: createServerClientMock }));

const { POST } = await import('@/app/api/resize/route');
const { flushResizeHistory } = await import('@/lib/api/resize-history');

import { allowLimiter, clearLimiters } from './helpers/limiter';
import { jpegBytes } from './helpers/fixtures';
import { buildFormData, makeFile, postRequest, readBytes } from './helpers/request';

const URL_UNDER_TEST = 'http://localhost:3000/api/resize';
const AUTH_COOKIE = 'sb-abcdef-auth-token=header.payload.signature';

function installSupabase({ user = { id: 'user-1' }, insertError = null } = {}) {
    const insert = vi.fn(async () => ({ error: insertError }));
    const from = vi.fn(() => ({ insert }));
    const getUser = vi.fn(async () => ({ data: { user }, error: null }));

    createServerClientMock.mockResolvedValue({ auth: { getUser }, from });
    return { insert, from, getUser };
}

async function resize({ cookie, fields = { width: '40' } } = {}) {
    const body = buildFormData({ file: makeFile(await jpegBytes(), { name: 'photo.jpg', type: 'image/jpeg' }), fields });
    const headers = cookie ? { cookie } : {};
    return POST(postRequest(URL_UNDER_TEST, body, { headers }));
}

beforeEach(() => {
    clearLimiters();
    allowLimiter('resize');
    installSupabase();
});

afterEach(async () => {
    await flushResizeHistory();
    clearLimiters();
    vi.restoreAllMocks();
});

describe('resize_history writer', () => {
    it('inserts exactly one row for a signed-in resize', async () => {
        const { insert, from } = installSupabase();

        const response = await resize({ cookie: AUTH_COOKIE });
        expect(response.status).toBe(200);

        await flushResizeHistory();

        expect(from).toHaveBeenCalledWith('resize_history');
        expect(insert).toHaveBeenCalledTimes(1);

        const row = insert.mock.calls[0][0];
        expect(row).toMatchObject({ user_id: 'user-1', original_format: 'jpeg', output_format: 'jpeg' });
        expect(row).toHaveProperty('original_filename');
        expect(row.original_size_bytes).toBeGreaterThan(0);
        expect(row.resized_size_bytes).toBeGreaterThan(0);
    });

    it('writes nothing for an anonymous resize and never touches Supabase', async () => {
        const { insert } = installSupabase();

        const response = await resize();
        expect(response.status).toBe(200);

        await flushResizeHistory();

        expect(createServerClientMock).not.toHaveBeenCalled();
        expect(insert).not.toHaveBeenCalled();
    });

    it('writes nothing when a cookie is present but no session resolves', async () => {
        const { insert, getUser } = installSupabase({ user: null });

        const response = await resize({ cookie: AUTH_COOKIE });
        expect(response.status).toBe(200);

        await flushResizeHistory();

        expect(getUser).toHaveBeenCalled();
        expect(insert).not.toHaveBeenCalled();
    });

    it('still returns the image when the history insert fails', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const { insert } = installSupabase({ insertError: { message: 'new row violates row-level security' } });

        const response = await resize({ cookie: AUTH_COOKIE });

        expect(response.status).toBe(200);
        expect((await readBytes(response)).length).toBeGreaterThan(0);

        await flushResizeHistory();
        expect(insert).toHaveBeenCalledTimes(1);
    });
});
