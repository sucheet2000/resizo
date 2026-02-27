/**
 * Supabase Client Component Utility
 * 
 * Provides a client-side Supabase instance for use in browser environments (Client Components).
 * Automatically initializes using public environment variables.
 */
import { createBrowserClient } from '@supabase/ssr';

export function createClient() {
    return createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    );
}
