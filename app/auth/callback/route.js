import { NextResponse } from 'next/server';
import { createServerClient } from '../../../lib/supabase-server';

export async function GET(request) {
    const requestUrl = new URL(request.url);
    const code = requestUrl.searchParams.get('code');

    if (code) {
        // createServerClient is async - must be awaited
        const supabase = await createServerClient();
        await supabase.auth.exchangeCodeForSession(code);
    }

    return NextResponse.redirect(new URL('/', requestUrl.origin));
}
