import { NextResponse } from 'next/server';
import { createServerClient } from '../../../../lib/supabase-server';
import { createClient } from '@supabase/supabase-js';

export const maxDuration = 30;

export async function DELETE() {
    try {
        // Step 1: Identify the authenticated user with the anon client (respects RLS / session cookies)
        const supabase = await createServerClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();

        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
        }

        // Step 2: Use the service role admin client to permanently delete the user.
        // The service role key is NEVER exposed to the client — it is only read here on the server.
        // Foreign-key cascades in Supabase will remove all resize_history rows for this user.
        const adminClient = createClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL,
            process.env.SUPABASE_SERVICE_ROLE_KEY,
            {
                auth: {
                    autoRefreshToken: false,
                    persistSession: false,
                },
            }
        );

        const { error: deleteError } = await adminClient.auth.admin.deleteUser(user.id);

        if (deleteError) {
            console.error('Account delete error:', deleteError);
            return NextResponse.json({ error: 'Failed to delete account. Please try again.' }, { status: 500 });
        }

        return NextResponse.json({ message: 'Account deleted successfully.' }, { status: 200 });

    } catch (error) {
        console.error('Account delete error:', error);
        return NextResponse.json({ error: 'An internal server error occurred.' }, { status: 500 });
    }
}
