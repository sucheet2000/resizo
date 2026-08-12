import { NextResponse } from 'next/server';
import { createRouteClient } from '@/lib/supabase/route';

export async function proxy(request) {
    let response = NextResponse.next({ request });

    const supabase = createRouteClient(request, response, {
        mirrorToRequest: true,
        onCookiesSet: (cookiesToSet) => {
            response = NextResponse.next({ request });
            cookiesToSet.forEach(({ name, value, options }) =>
                response.cookies.set(name, value, options)
            );
        },
    });

    await supabase.auth.getUser();
    return response;
}

// getUser() is a network round-trip to the Supabase Auth server, so it must
// only run for requests that actually read a session. The image tools work
// without an account and were each paying that latency, as was every static
// asset and both SEO endpoints.
export const config = {
    matcher: [
        '/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|api/(?:resize|resize-bulk|compress|convert|crop|heic)(?:/|$)|.*\\.(?:png|jpg|jpeg|gif|svg|ico|webp|avif|txt|xml|webmanifest|woff|woff2)$).*)',
    ],
};
