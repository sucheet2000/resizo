/**
 * Supabase Request/Response-Scoped Client
 *
 * For route handlers and middleware that must read cookies off the incoming
 * request and write refreshed session cookies onto an outgoing response they
 * already hold (the PKCE callback, the proxy). Route handlers that can use the
 * Next cookies() API should use lib/supabase/server.js instead.
 */
import { createServerClient } from '@supabase/ssr';

/**
 * @param request  a NextRequest (needs request.cookies.getAll)
 * @param response the response the session cookies must land on
 * @param options.mirrorToRequest also write the cookies back onto the request,
 *        so downstream handlers in the same pass see the refreshed session
 * @param options.onCookiesSet called with the cookie list after each write
 */
export function createRouteClient(request, response, { mirrorToRequest = false, onCookiesSet } = {}) {
    return createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
        {
            cookies: {
                getAll() {
                    return request.cookies.getAll();
                },
                setAll(cookiesToSet) {
                    if (mirrorToRequest) {
                        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
                    }
                    cookiesToSet.forEach(({ name, value, options }) =>
                        response.cookies.set(name, value, options)
                    );
                    if (typeof onCookiesSet === 'function') {
                        onCookiesSet(cookiesToSet);
                    }
                },
            },
        }
    );
}
