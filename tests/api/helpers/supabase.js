/**
 * Minimal Supabase stand-ins for the account and auth routes.
 *
 * The builders are thenable at every point the routes actually await, so one
 * shape serves both `from().select().eq().order()` and `from().delete().eq()`.
 */
import { vi } from 'vitest';

function thenable(result, extra) {
    return Object.assign(Promise.resolve(result), extra);
}

function tableBuilder(result, record) {
    const builder = {
        select(columns) {
            record.push({ op: 'select', columns });
            return builder;
        },
        delete() {
            record.push({ op: 'delete' });
            return builder;
        },
        eq(column, value) {
            record.push({ op: 'eq', column, value });
            return thenable(result, builder);
        },
        order(column, options) {
            record.push({ op: 'order', column, options });
            return thenable(result, builder);
        },
    };
    return builder;
}

/**
 * @param tables map of table name -> { data, error }
 * @param user   the authenticated user, or null for an anonymous caller
 */
export function makeSupabase({ user = { id: 'user-1', email: 'person@example.com' }, authError = null, tables = {}, signInResult } = {}) {
    const calls = { tables: {}, signOut: [] };

    const client = {
        auth: {
            getUser: vi.fn(async () => ({ data: { user }, error: authError })),
            signOut: vi.fn(async (options) => {
                calls.signOut.push(options);
                return { error: null };
            }),
            signInWithPassword: vi.fn(async () => signInResult ?? { data: { user }, error: null }),
            exchangeCodeForSession: vi.fn(async () => ({ error: null })),
            admin: {
                deleteUser: vi.fn(async () => ({ error: null })),
            },
        },
        from: vi.fn((table) => {
            calls.tables[table] = calls.tables[table] ?? [];
            return tableBuilder(tables[table] ?? { data: [], error: null }, calls.tables[table]);
        }),
        calls,
    };

    return client;
}
