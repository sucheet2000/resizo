/**
 * Supabase Server-Side Utility
 * 
 * Provides a server-side Supabase instance for use in API routes, Server Actions,
 * and Server Components. It automatically intercepts and synchronizes auth state
 * via the Next.js cookies API.
 */
import { createServerClient as createServer } from '@supabase/ssr';
import { cookies } from 'next/headers';

export async function createServerClient() {
    const cookieStore = await cookies();

    return createServer(
        process.env.NEXT_PUBLIC_SUPABASE_URL,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
        {
            cookies: {
                getAll() {
                    return cookieStore.getAll();
                },
                setAll(cookiesToSet) {
                    try {
                        cookiesToSet.forEach(({ name, value, options }) =>
                            cookieStore.set(name, value, options)
                        );
                    } catch (error) {
                        // The `setAll` method was called from a Server Component.
                        // This can be ignored if you have middleware refreshing
                        // user sessions.
                    }
                },
            },
        }
    );
}
