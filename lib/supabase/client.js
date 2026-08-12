/**
 * Supabase Browser Client
 *
 * Cookie-backed client for use in browser environments, so the browser session
 * stays in sync with the server session.
 */
import { createBrowserClient } from '@supabase/ssr';

export function createClient() {
    return createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    );
}
