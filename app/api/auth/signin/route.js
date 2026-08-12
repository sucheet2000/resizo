import { NextResponse } from 'next/server';
import { enforceRateLimit } from '@/lib/http/rate-limit';
import { jsonError } from '@/lib/http/responses';
import { createServerClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const maxDuration = 15;

// Supabase distinguishes "Invalid login credentials" from "Email not
// confirmed", which tells an attacker whether an address is registered. One
// message for every credential failure; the specific reason is logged.
const CREDENTIAL_ERROR = 'Invalid email or password.';

export async function POST(request) {
    try {
        const limited = await enforceRateLimit(request, 'signin');
        if (limited) return limited;

        let body;
        try {
            body = await request.json();
        } catch {
            return jsonError('Invalid request body.', 400);
        }

        const { email, password } = body ?? {};

        if (!email || !password) {
            return jsonError('Email and password are required.', 400);
        }

        const supabase = await createServerClient();
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });

        if (error || !data?.user) {
            console.error('[api:signin] credential failure:', error?.message ?? 'no user returned');
            return jsonError(CREDENTIAL_ERROR, 401);
        }

        // The session is already in httpOnly cookies. Returning it in the body
        // would hand the long-lived refresh token to any script on the page.
        return NextResponse.json(
            { user: { id: data.user.id, email: data.user.email } },
            { status: 200 }
        );
    } catch (error) {
        console.error('[api:signin]', error);
        return jsonError('An internal server error occurred.', 500);
    }
}
