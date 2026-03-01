import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';

export async function GET(request) {
    const requestUrl = new URL(request.url);
    const code = requestUrl.searchParams.get('code');
    const next = requestUrl.searchParams.get('next') ?? '/';

    if (code) {
        // Build the redirect response first so we can set session cookies on it
        const redirectTo = new URL(next, requestUrl.origin);
        const response = NextResponse.redirect(redirectTo);

        // Create a server client that reads cookies from the request and writes
        // them directly onto the redirect response — this keeps the session alive
        const supabase = createServerClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL,
            process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
            {
                cookies: {
                    getAll() {
                        return request.cookies.getAll();
                    },
                    setAll(cookiesToSet) {
                        cookiesToSet.forEach(({ name, value, options }) => {
                            response.cookies.set(name, value, options);
                        });
                    },
                },
            }
        );

        // Exchange the PKCE authorization code for a session server-side.
        // This prevents access tokens from ever appearing in browser history.
        const { error } = await supabase.auth.exchangeCodeForSession(code);

        if (error) {
            console.error('PKCE exchange error:', error.message);
            return NextResponse.redirect(new URL('/?error=auth_error', requestUrl.origin));
        }

        return response;
    }

    // No code present — redirect home
    return NextResponse.redirect(new URL('/', requestUrl.origin));
}
