'use client';

/**
 * AuthModal
 *
 * Accounts are optional here — they only add history — so this dialog stays
 * small and never blocks a tool. Focus trapping, Escape and focus restoration
 * come from <Modal/>; the two fields are wrapped in <Field/> so the labels are
 * actually associated, which none of the app's form controls used to be.
 */
import { useCallback, useMemo, useRef, useState } from 'react';

import Alert from '@/components/ui/Alert';
import Field from '@/components/ui/Field';
import Modal from '@/components/ui/Modal';
import Spinner from '@/components/ui/Spinner';
import { createClient } from '@/lib/supabase/client';

const TABS = [
    { id: 'signin', label: 'Sign in' },
    { id: 'signup', label: 'Create account' },
];

export default function AuthModal({ onClose, onSuccess }) {
    const [activeTab, setActiveTab] = useState('signin');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [errorMsg, setErrorMsg] = useState(null);
    const [notice, setNotice] = useState(null);

    const emailRef = useRef(null);
    const supabase = useMemo(() => createClient(), []);

    const isSignUp = activeTab === 'signup';

    const switchTab = useCallback((tab) => {
        setActiveTab(tab);
        setErrorMsg(null);
        setNotice(null);
    }, []);

    const handleAuth = async (event) => {
        event.preventDefault();
        setErrorMsg(null);
        setNotice(null);

        if (!email || !password) {
            setErrorMsg('Enter both an email address and a password.');
            return;
        }

        if (password.length < 8) {
            setErrorMsg('Passwords need at least 8 characters.');
            return;
        }

        setLoading(true);

        try {
            if (isSignUp) {
                const { error, data } = await supabase.auth.signUp({ email, password });
                if (error) throw error;

                if (data?.user && data.user.identities && data.user.identities.length === 0) {
                    setErrorMsg('That email is already registered. Sign in instead.');
                    setLoading(false);
                    return;
                }

                if (data?.session) {
                    onSuccess?.(data.session.user);
                } else {
                    // Supabase is configured to require confirmation, so there is
                    // no session yet. This is a success, not an error.
                    setNotice('Account created. Check your inbox for the confirmation link.');
                    setEmail('');
                    setPassword('');
                }
            } else {
                // Sign-in goes through the rate-limited server endpoint rather
                // than straight to Supabase from the browser.
                const response = await fetch('/api/auth/signin', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email, password }),
                });

                const data = await response.json().catch(() => ({}));

                if (!response.ok) {
                    throw new Error(data.error || 'That sign-in did not go through. Try again.');
                }

                if (data?.user) onSuccess?.(data.user);
            }
        } catch (err) {
            setErrorMsg(err.message || 'That sign-in did not go through. Try again.');
        } finally {
            setLoading(false);
        }
    };

    const handleGoogleAuth = async () => {
        setErrorMsg(null);
        setNotice(null);
        setLoading(true);

        try {
            const { error } = await supabase.auth.signInWithOAuth({
                provider: 'google',
                options: {
                    redirectTo: `${window.location.origin}/auth/callback`,
                    queryParams: { access_type: 'offline', prompt: 'consent' },
                },
            });
            if (error) throw error;
        } catch (err) {
            setErrorMsg(err.message || 'Could not reach Google. Try again.');
            setLoading(false);
        }
    };

    const inputClass = 'w-full rounded-input border border-line bg-surface px-3 py-2.5 text-base text-ink placeholder:text-ink-muted disabled:opacity-60';

    return (
        <Modal
            open
            onClose={onClose}
            title={isSignUp ? 'Create an account' : 'Sign in'}
            description="An account only saves your history. Every tool works without one."
            initialFocusRef={emailRef}
        >
            <div
                role="tablist"
                aria-label="Account access"
                className="mb-5 flex gap-1 rounded-button border border-line p-1"
            >
                {TABS.map((tab) => (
                    <button
                        key={tab.id}
                        type="button"
                        role="tab"
                        id={`auth-tab-${tab.id}`}
                        aria-selected={activeTab === tab.id}
                        aria-controls="auth-panel"
                        onClick={() => switchTab(tab.id)}
                        className={[
                            'flex-1 rounded-input px-3 py-2 text-ui transition-colors duration-120 ease-snap',
                            activeTab === tab.id
                                ? 'bg-surface-sunken font-semibold text-ink'
                                : 'text-ink-muted hover:text-ink',
                        ].join(' ')}
                    >
                        {tab.label}
                    </button>
                ))}
            </div>

            <div id="auth-panel" role="tabpanel" aria-labelledby={`auth-tab-${activeTab}`}>
                {errorMsg ? <Alert className="mb-4">{errorMsg}</Alert> : null}
                {notice ? <Alert tone="info" className="mb-4">{notice}</Alert> : null}

                <button
                    type="button"
                    onClick={handleGoogleAuth}
                    disabled={loading}
                    className="mb-5 flex w-full items-center justify-center gap-2.5 rounded-button border border-line px-4 py-2.5 text-base text-ink transition-colors duration-120 ease-snap hover:bg-surface-sunken disabled:opacity-60"
                >
                    {/* Google requires its own mark on this button; it is the one
                        place a colour outside the token set is permitted, and the
                        design-contract suite allowlists exactly this file for it. */}
                    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24">
                        <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
                        <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                        <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
                        <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
                    </svg>
                    Continue with Google
                </button>

                <div className="mb-5 flex items-center gap-3" aria-hidden="true">
                    <span className="h-px flex-1 bg-line" />
                    <span className="font-data text-micro text-ink-muted">or</span>
                    <span className="h-px flex-1 bg-line" />
                </div>

                {/* noValidate on purpose. The browser's own validation bubble
                    is a floating tooltip outside the panel that vanishes on the
                    next keystroke — the design contract puts errors inline, in
                    the panel, with an sr-only "Error: " prefix. The `required`
                    and `minLength` attributes stay for assistive technology;
                    the messages below are what a visitor actually reads. */}
                <form onSubmit={handleAuth} noValidate className="flex flex-col gap-4">
                    <Field id="auth-email" label="Email address">
                        <input
                            ref={emailRef}
                            id="auth-email"
                            name="email"
                            type="email"
                            autoComplete="email"
                            required
                            disabled={loading}
                            value={email}
                            onChange={(event) => setEmail(event.target.value)}
                            placeholder="you@example.com"
                            className={inputClass}
                        />
                    </Field>

                    <Field
                        id="auth-password"
                        label="Password"
                        hint={isSignUp ? 'At least 8 characters.' : undefined}
                    >
                        <input
                            id="auth-password"
                            name="password"
                            type="password"
                            autoComplete={isSignUp ? 'new-password' : 'current-password'}
                            aria-describedby={isSignUp ? 'auth-password-hint' : undefined}
                            required
                            minLength={8}
                            disabled={loading}
                            value={password}
                            onChange={(event) => setPassword(event.target.value)}
                            className={inputClass}
                        />
                    </Field>

                    <button
                        type="submit"
                        disabled={loading}
                        className="mt-1 flex items-center justify-center gap-2 rounded-button bg-accent px-4 py-2.5 text-base font-semibold text-accent-ink transition-opacity duration-180 ease-snap hover:opacity-90 disabled:opacity-60"
                    >
                        {loading ? <Spinner size={16} /> : null}
                        {loading ? 'Working…' : (isSignUp ? 'Create account' : 'Sign in')}
                    </button>
                </form>
            </div>
        </Modal>
    );
}
