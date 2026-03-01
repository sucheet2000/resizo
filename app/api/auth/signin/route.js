import { NextResponse } from 'next/server';
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

// 5 sign-in attempts per IP per minute — blocks credential stuffing
const ratelimit = new Ratelimit({
    redis: Redis.fromEnv(),
    limiter: Ratelimit.slidingWindow(5, '1 m'),
    analytics: true,
});

export async function POST(request) {
    try {
        // Rate limit by IP — use x-real-ip (Vercel-set, cannot be spoofed by client)
        const ip = request.headers.get('x-real-ip')
            ?? request.headers.get('x-forwarded-for')?.split(',').pop()?.trim()
            ?? '127.0.0.1';

        const { success, limit, remaining } = await ratelimit.limit(`auth_signin_${ip}`);

        if (!success) {
            return NextResponse.json(
                { error: 'Too many sign-in attempts. Please wait before trying again.' },
                {
                    status: 429,
                    headers: {
                        'X-RateLimit-Limit': limit.toString(),
                        'X-RateLimit-Remaining': remaining.toString(),
                    },
                }
            );
        }

        const body = await request.json();
        const { email, password } = body;

        if (!email || !password) {
            return NextResponse.json({ error: 'Email and password are required.' }, { status: 400 });
        }

        const cookieStore = await cookies();

        const supabase = createServerClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL,
            process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
            {
                cookies: {
                    getAll() {
                        return cookieStore.getAll();
                    },
                    setAll(cookiesToSet) {
                        cookiesToSet.forEach(({ name, value, options }) => {
                            cookieStore.set(name, value, options);
                        });
                    },
                },
            }
        );

        const { data, error } = await supabase.auth.signInWithPassword({ email, password });

        if (error) {
            // Return Supabase's error message (e.g. "Invalid login credentials") — safe for client display
            return NextResponse.json({ error: error.message }, { status: 401 });
        }

        return NextResponse.json({ user: data.user, session: data.session }, { status: 200 });

    } catch (error) {
        console.error('Auth signin error:', error);
        return NextResponse.json({ error: 'An internal server error occurred.' }, { status: 500 });
    }
}
