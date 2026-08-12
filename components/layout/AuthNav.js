'use client';

/**
 * AuthNav
 *
 * The only part of the header that needs the browser: it reads the Supabase
 * session and swaps Sign in for the dashboard link. Keeping it as an island
 * lets SiteHeader stay a server component, so the nav and the wordmark are in
 * the first paint rather than waiting on a client bundle.
 */
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

import AuthModal from '@/components/AuthModal';
import { createClient } from '@/lib/supabase/client';

export default function AuthNav({ className = 'flex' }) {
    const supabase = useMemo(() => createClient(), []);
    const [user, setUser] = useState(null);
    const [modalOpen, setModalOpen] = useState(false);

    useEffect(() => {
        let active = true;

        supabase.auth.getUser().then(({ data }) => {
            if (active) setUser(data?.user ?? null);
        }).catch(() => {
            // No session and no network is the anonymous case, which is the
            // default state already.
        });

        const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
            setUser(session?.user ?? null);
            if (session?.user) setModalOpen(false);
        });

        return () => {
            active = false;
            subscription?.subscription?.unsubscribe();
        };
    }, [supabase]);

    const signOut = async () => {
        await supabase.auth.signOut();
        setUser(null);
    };

    const buttonClass = 'rounded-button px-3 py-1.5 text-ui text-ink transition-colors duration-120 ease-snap hover:bg-surface-sunken';

    return (
        <div className={`items-center gap-1 ${className}`.trim()}>
            {user ? (
                <>
                    <Link href="/dashboard" className={buttonClass}>
                        Dashboard
                    </Link>
                    <button type="button" onClick={signOut} className={buttonClass}>
                        Sign out
                    </button>
                </>
            ) : (
                <button
                    type="button"
                    onClick={() => setModalOpen(true)}
                    className="rounded-button border border-line px-3 py-1.5 text-ui text-ink transition-colors duration-120 ease-snap hover:bg-surface-sunken"
                >
                    Sign in
                </button>
            )}

            {modalOpen ? (
                <AuthModal
                    onClose={() => setModalOpen(false)}
                    onSuccess={(nextUser) => {
                        setUser(nextUser);
                        setModalOpen(false);
                    }}
                />
            ) : null}
        </div>
    );
}
