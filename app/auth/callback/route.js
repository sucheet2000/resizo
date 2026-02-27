import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';

export async function GET(request) {
    const requestUrl = new URL(request.url);
    const code = requestUrl.searchParams.get('code');
    const error = requestUrl.searchParams.get('error');
    const errorDescription = requestUrl.searchParams.get('error_description');

    // Redirect to homepage with error info if OAuth failed
    if (error) {
        console.error('OAuth error:', error, errorDescription);
        return NextResponse.redirect(new URL(`/?auth_error=${encodeURIComponent(errorDescription || error)}`, requestUrl.origin));
    }

    const response = NextResponse.redirect(new URL('/', requestUrl.origin));

    if (code) {
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

        const { data, error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
        if (exchangeError) {
            console.error('Exchange error:', exchangeError.message);
            return NextResponse.redirect(new URL(`/?auth_error=${encodeURIComponent(exchangeError.message)}`, requestUrl.origin));
        }
        console.log('Exchange success, user:', data?.user?.email);
    }

    return response;
}
