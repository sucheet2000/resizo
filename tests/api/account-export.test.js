import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { allowLimiter, clearLimiters, denyLimiter } from './helpers/limiter';
import { makeSupabase } from './helpers/supabase';
import { TEST_IP, getRequest } from './helpers/request';

const { createServerClientMock } = vi.hoisted(() => ({ createServerClientMock: vi.fn() }));

vi.mock('@/lib/supabase/server', () => ({ createServerClient: createServerClientMock }));

const { GET } = await import('@/app/api/account/export/route');

const URL_UNDER_TEST = 'http://localhost:3000/api/account/export';

const HISTORY_ROW = {
    created_at: '2024-01-02T03:04:05.000Z',
    original_filename: 'holiday.jpg',
    original_width: 4000,
    original_height: 3000,
    resized_width: 800,
    resized_height: 600,
    output_format: 'jpeg',
    original_size_bytes: 2048,
    resized_size_bytes: 512,
};

const REVIEW_ROW = {
    created_at: '2024-02-03T04:05:06.000Z',
    name: 'Sam',
    role: 'Designer',
    rating: 5,
    review: 'Fast and simple.',
};

function installSupabase(options) {
    const client = makeSupabase(options);
    createServerClientMock.mockResolvedValue(client);
    return client;
}

async function exportCsv() {
    return GET(getRequest(URL_UNDER_TEST));
}

beforeEach(() => {
    clearLimiters();
    allowLimiter('account', { limit: 5, remaining: 4 });
    installSupabase({
        tables: {
            resize_history: { data: [HISTORY_ROW], error: null },
            reviews: { data: [REVIEW_ROW], error: null },
        },
    });
});

afterEach(() => {
    clearLimiters();
    vi.restoreAllMocks();
});

describe('GET /api/account/export — access control', () => {
    it('rejects an anonymous caller', async () => {
        installSupabase({ user: null });

        const response = await exportCsv();

        expect(response.status).toBe(401);
        expect(await response.json()).toEqual({ error: 'Unauthorized.' });
    });

    it('rejects a caller whose session lookup errored', async () => {
        installSupabase({ user: null, authError: { message: 'jwt expired' } });

        expect((await exportCsv()).status).toBe(401);
    });

    it('returns 429 from the account bucket, which had no limiting at all before', async () => {
        clearLimiters();
        const limit = denyLimiter('account', { limit: 5, remaining: 0 });

        const response = await exportCsv();

        expect(response.status).toBe(429);
        expect(limit).toHaveBeenCalledWith(`account:${TEST_IP}`);
        expect(response.headers.get('X-RateLimit-Limit')).toBe('5');
        expect(Number(response.headers.get('Retry-After'))).toBeGreaterThan(0);
        expect(await response.json()).toEqual({
            error: 'Too many requests. Please wait a moment before trying again.',
        });
    });

    it('scopes both queries to the signed-in user', async () => {
        const client = installSupabase({
            user: { id: 'user-7', email: 'a@b.co' },
            tables: { resize_history: { data: [], error: null }, reviews: { data: [], error: null } },
        });

        await exportCsv();

        expect(client.calls.tables.resize_history).toContainEqual({ op: 'eq', column: 'user_id', value: 'user-7' });
        expect(client.calls.tables.reviews).toContainEqual({ op: 'eq', column: 'user_id', value: 'user-7' });
    });
});

describe('GET /api/account/export — response shape', () => {
    it('serves a downloadable CSV that is never cached', async () => {
        const response = await exportCsv();

        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toBe('text/csv; charset=utf-8');
        expect(response.headers.get('cache-control')).toBe('no-store, private');
        expect(response.headers.get('content-disposition')).toContain('filename="resizo-my-data.csv"');
    });

    it('joins rows with CRLF, as RFC 4180 requires', async () => {
        const body = await (await exportCsv()).text();

        expect(body).toContain('\r\n');
        expect(body.split('\r\n')[0]).toBe('Resize History');
        expect(body).not.toMatch(/[^\r]\n/);
    });

    it('emits both sections with the documented headers', async () => {
        const lines = (await (await exportCsv()).text()).split('\r\n');

        expect(lines[0]).toBe('Resize History');
        expect(lines[1]).toBe('Date,Filename,Original Width,Original Height,Resized Width,Resized Height,Format,Original Size (bytes),Resized Size (bytes)');
        expect(lines[2]).toBe('2024-01-02T03:04:05.000Z,holiday.jpg,4000,3000,800,600,jpeg,2048,512');
        expect(lines[3]).toBe('');
        expect(lines[4]).toBe('Reviews');
        expect(lines[5]).toBe('Date,Name,Role,Rating,Review');
        expect(lines[6]).toBe('2024-02-03T04:05:06.000Z,Sam,Designer,5,Fast and simple.');
    });

    it('exports a header-only history when the user has none', async () => {
        installSupabase({ tables: { resize_history: { data: [], error: null }, reviews: { data: [], error: null } } });

        const lines = (await (await exportCsv()).text()).split('\r\n');

        expect(lines[0]).toBe('Resize History');
        expect(lines[2]).toBe('');
        expect(lines[3]).toBe('Reviews');
    });

    it('survives a query that reports neither rows nor an error', async () => {
        installSupabase({
            tables: {
                resize_history: { data: null, error: null },
                reviews: { data: null, error: null },
            },
        });

        const response = await exportCsv();
        const lines = (await response.text()).split('\r\n');

        expect(response.status).toBe(200);
        expect(lines[0]).toBe('Resize History');
        expect(lines[3]).toBe('Reviews');
    });

    it('leaves a missing timestamp blank instead of writing "Invalid Date"', async () => {
        installSupabase({
            tables: {
                resize_history: { data: [{ ...HISTORY_ROW, created_at: null }], error: null },
                reviews: { data: [], error: null },
            },
        });

        const lines = (await (await exportCsv()).text()).split('\r\n');

        expect(lines[2]).toBe(',holiday.jpg,4000,3000,800,600,jpeg,2048,512');
        expect(lines[2]).not.toContain('Invalid Date');
    });

    it('drops the reviews section rather than the whole export when that query fails', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        installSupabase({
            tables: {
                resize_history: { data: [HISTORY_ROW], error: null },
                reviews: { data: null, error: { message: 'column reviews.user_id does not exist' } },
            },
        });

        const response = await exportCsv();
        const body = await response.text();

        expect(response.status).toBe(200);
        expect(body).toContain('holiday.jpg');
        expect(body).not.toContain('Reviews');
    });

    it('fails the export when the history query fails', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        installSupabase({
            tables: { resize_history: { data: null, error: { message: 'relation missing' } } },
        });

        const response = await exportCsv();

        expect(response.status).toBe(500);
        expect(await response.json()).toEqual({ error: 'Failed to fetch your data.' });
    });

    it('masks an unexpected failure as a generic 500', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        createServerClientMock.mockRejectedValue(new Error('boom'));

        const response = await exportCsv();

        expect(response.status).toBe(500);
        expect(await response.json()).toEqual({ error: 'An internal server error occurred.' });
    });
});

describe('GET /api/account/export — untrusted cell content', () => {
    it('neutralises a filename that is a spreadsheet formula', async () => {
        installSupabase({
            tables: {
                resize_history: {
                    data: [{ ...HISTORY_ROW, original_filename: '=HYPERLINK("http://evil.example","click")' }],
                    error: null,
                },
                reviews: { data: [], error: null },
            },
        });

        const body = await (await exportCsv()).text();

        expect(body).toContain('"\'=HYPERLINK(""http://evil.example"",""click"")"');
        expect(body).not.toContain(',=HYPERLINK');
    });

    it.each([
        ['a leading equals', '=1+1', "'=1+1"],
        ['a leading plus', '+1', "'+1"],
        ['a leading minus', '-1', "'-1"],
        ['a leading at sign', '@SUM(A1)', "'@SUM(A1)"],
    ])('neutralises %s', async (_label, filename, expected) => {
        installSupabase({
            tables: {
                resize_history: { data: [{ ...HISTORY_ROW, original_filename: filename }], error: null },
                reviews: { data: [], error: null },
            },
        });

        const lines = (await (await exportCsv()).text()).split('\r\n');

        expect(lines[2].split(',')[1]).toBe(expected);
    });

    it('quotes a filename containing a comma or a quote', async () => {
        installSupabase({
            tables: {
                resize_history: { data: [{ ...HISTORY_ROW, original_filename: 'a,b "c".jpg' }], error: null },
                reviews: { data: [], error: null },
            },
        });

        const body = await (await exportCsv()).text();

        expect(body).toContain('"a,b ""c"".jpg"');
    });

    it('quotes a lone carriage return so it cannot split a row', async () => {
        installSupabase({
            tables: {
                resize_history: { data: [{ ...HISTORY_ROW, original_filename: 'a\rb.jpg' }], error: null },
                reviews: { data: [], error: null },
            },
        });

        const body = await (await exportCsv()).text();

        expect(body).toContain('"a\rb.jpg"');
    });

    it('quotes a multi-line review body', async () => {
        installSupabase({
            tables: {
                resize_history: { data: [], error: null },
                reviews: { data: [{ ...REVIEW_ROW, review: 'line one\nline two' }], error: null },
            },
        });

        const body = await (await exportCsv()).text();

        expect(body).toContain('"line one\nline two"');
    });

    it('pins the Node runtime', async () => {
        const route = await import('@/app/api/account/export/route');
        expect(route.runtime).toBe('nodejs');
        expect(route.maxDuration).toBe(30);
    });
});
