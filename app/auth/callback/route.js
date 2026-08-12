import { NextResponse } from 'next/server';
import { createRouteClient } from '@/lib/supabase/route';

export const runtime = 'nodejs';
export const maxDuration = 15;

// A single leading slash, and the negative lookahead rejects the
// protocol-relative '//evil.com' form. new URL(next, origin) only applies the
// base to relative inputs, so an absolute value would have overridden the
// origin entirely and redirected a freshly-authenticated user off-site.
const RELATIVE_PATH = /^\/(?!\/)[A-Za-z0-9._~!$&'()*+,;=:@%/-]*$/;

function safeNextPath(raw) {
    return typeof raw === 'string' && RELATIVE_PATH.test(raw) ? raw : '/';
}

function readableMessage(raw) {
    if (typeof raw !== 'string') return null;
    const cleaned = raw.replace(/[^\x20-\x7E]/g, ' ').trim();
    return cleaned ? cleaned.slice(0, 200) : null;
}

function errorRedirect(origin, code, description) {
    const url = new URL('/', origin);
    url.searchParams.set('error', code);
    if (description) url.searchParams.set('error_description', description);
    return NextResponse.redirect(url);
}

export async function GET(request) {
    const requestUrl = new URL(request.url);
    const { origin } = requestUrl;
    const code = requestUrl.searchParams.get('code');

    // Supabase reports a denied consent screen here; the route used to ignore
    // it and bounce the user home with no explanation.
    const providerError = requestUrl.searchParams.get('error');
    if (providerError) {
        const description = readableMessage(requestUrl.searchParams.get('error_description'));
        console.error('[auth:callback] provider error:', providerError, description ?? '');
        return errorRedirect(origin, 'auth_error', description ?? 'Sign-in was not completed.');
    }

    if (!code) {
        return NextResponse.redirect(new URL('/', origin));
    }

    const response = NextResponse.redirect(new URL(safeNextPath(requestUrl.searchParams.get('next')), origin));
    const supabase = createRouteClient(request, response);

    // Exchanged server-side so the access token never lands in browser history.
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (error) {
        console.error('[auth:callback] PKCE exchange failed:', error.message);
        return errorRedirect(origin, 'auth_error', 'We could not complete your sign-in. Please try again.');
    }

    return response;
}
