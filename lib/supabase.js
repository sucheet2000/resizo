/**
 * Supabase Client Component Utility
 *
 * Provides a client-side Supabase instance for use in browser environments.
 * Uses cookie-based storage to stay in sync with the server session.
 */
import { createBrowserClient } from '@supabase/ssr';

export function createClient() {
    return createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    );
}
