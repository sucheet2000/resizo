import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { enforceRateLimit } from '@/lib/http/rate-limit';
import { jsonError } from '@/lib/http/responses';
import { createServerClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const maxDuration = 30;

export async function DELETE(request) {
    try {
        const limited = await enforceRateLimit(request, 'account');
        if (limited) return limited;

        const supabase = await createServerClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();

        if (authError || !user) {
            return jsonError('Unauthorized.', 401);
        }

        // Checked per request, not at module scope: an unset key must not take
        // the route down at import time with an opaque error.
        if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
            console.error('[api:account/delete] MissingServiceRoleKey: SUPABASE_SERVICE_ROLE_KEY is not set.');
            return jsonError('Account deletion is temporarily unavailable.', 503);
        }

        const adminClient = createClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL,
            process.env.SUPABASE_SERVICE_ROLE_KEY,
            { auth: { autoRefreshToken: false, persistSession: false } }
        );

        // Reviews carry user-entered personal data. The user_id column ships in
        // supabase/migrations/0001_add_user_id_to_reviews.sql and may not exist
        // in every environment yet, so a failure here is logged, not fatal —
        // the account deletion itself must still go through.
        const { error: reviewsError } = await adminClient
            .from('reviews')
            .delete()
            .eq('user_id', user.id);

        if (reviewsError) {
            console.warn('[api:account/delete] review cleanup skipped:', reviewsError.message);
        }

        const { error: deleteError } = await adminClient.auth.admin.deleteUser(user.id);

        if (deleteError) {
            console.error('[api:account/delete]', deleteError);
            return jsonError('Failed to delete account. Please try again.', 500);
        }

        // Without this the browser keeps a valid access token for an account
        // that no longer exists and goes on rendering as signed in.
        try {
            await supabase.auth.signOut({ scope: 'local' });
        } catch (signOutError) {
            console.warn('[api:account/delete] sign-out after delete failed:', signOutError);
        }

        return NextResponse.json({ message: 'Account deleted successfully.' }, { status: 200 });
    } catch (error) {
        console.error('[api:account/delete]', error);
        return jsonError('An internal server error occurred.', 500);
    }
}
