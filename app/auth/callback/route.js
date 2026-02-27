import { NextResponse } from 'next/server';
import { createServerClient } from '../../../lib/supabase-server';

export async function GET(request) {
    const requestUrl = new URL(request.url);
    const code = requestUrl.searchParams.get('code');

    if (code) {
        const supabase = createServerClient();
        await supabase.auth.exchangeCodeForSession(code);
    }

    // Redirect to the homepage '/' after the exchange or if no code exists
    return NextResponse.redirect(new URL('/', requestUrl.origin));
}
