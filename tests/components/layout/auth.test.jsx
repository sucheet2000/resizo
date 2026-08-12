/**
 * AuthNav + AuthModal
 *
 * Accounts are optional here, so the dialog must never block a tool: it opens
 * from a real button, its two fields are actually labelled — none of the app's
 * form controls used to be — and it traps focus like every other modal.
 */
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import AuthModal from '@/components/AuthModal';
import AuthNav from '@/components/layout/AuthNav';

const supabase = {
    user: null,
    signUpResult: { data: { session: null, user: { id: 'u1', identities: [{ id: 'i1' }] } }, error: null },
    oauthResult: { error: null },
    signOut: vi.fn(() => Promise.resolve({ error: null })),
    signUp: vi.fn(),
    signInWithOAuth: vi.fn(),
    unsubscribe: vi.fn(),
};

vi.mock('@/lib/supabase/client', () => ({
    createClient: () => ({
        auth: {
            getUser: () => Promise.resolve({ data: { user: supabase.user } }),
            onAuthStateChange: () => ({ data: { subscription: { unsubscribe: supabase.unsubscribe } } }),
            signOut: supabase.signOut,
            signUp: (...args) => supabase.signUp(...args),
            signInWithOAuth: (...args) => supabase.signInWithOAuth(...args),
        },
    }),
}));

beforeEach(() => {
    supabase.user = null;
    supabase.signUp = vi.fn(() => Promise.resolve(supabase.signUpResult));
    supabase.signInWithOAuth = vi.fn(() => Promise.resolve(supabase.oauthResult));
    supabase.signOut = vi.fn(() => Promise.resolve({ error: null }));
});

describe('AuthNav', () => {
    it('offers sign-in to an anonymous visitor', async () => {
        render(<AuthNav />);
        expect(await screen.findByRole('button', { name: 'Sign in' })).toBeInTheDocument();
    });

    it('swaps to the dashboard link once a session exists', async () => {
        supabase.user = { id: 'u1', email: 'a@example.com' };
        render(<AuthNav />);

        expect(await screen.findByRole('link', { name: 'Dashboard' })).toHaveAttribute('href', '/dashboard');
        expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
    });

    it('signs out and returns to the anonymous state', async () => {
        const user = userEvent.setup();
        supabase.user = { id: 'u1' };
        render(<AuthNav />);

        await user.click(await screen.findByRole('button', { name: 'Sign out' }));

        expect(supabase.signOut).toHaveBeenCalledTimes(1);
        expect(await screen.findByRole('button', { name: 'Sign in' })).toBeInTheDocument();
    });

    it('opens the dialog from the trigger and closes it back to the trigger', async () => {
        const user = userEvent.setup();
        render(<AuthNav />);

        const trigger = await screen.findByRole('button', { name: 'Sign in' });
        await user.click(trigger);

        expect(screen.getByRole('dialog', { name: 'Sign in' })).toBeInTheDocument();

        await user.keyboard('{Escape}');

        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
        expect(trigger).toHaveFocus();
    });

    it('unsubscribes from auth changes on unmount', async () => {
        const { unmount } = render(<AuthNav />);
        await screen.findByRole('button', { name: 'Sign in' });

        unmount();

        expect(supabase.unsubscribe).toHaveBeenCalled();
    });
});

describe('AuthModal fields', () => {
    it('labels both credentials', () => {
        render(<AuthModal onClose={vi.fn()} onSuccess={vi.fn()} />);

        expect(screen.getByLabelText('Email address')).toHaveAttribute('type', 'email');
        expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'password');
    });

    it('opens with focus in the email field', () => {
        render(<AuthModal onClose={vi.fn()} onSuccess={vi.fn()} />);
        expect(screen.getByLabelText('Email address')).toHaveFocus();
    });

    it('traps Tab inside the dialog', async () => {
        const user = userEvent.setup();
        render(
            <div>
                <button type="button">Behind the dialog</button>
                <AuthModal onClose={vi.fn()} onSuccess={vi.fn()} />
            </div>,
        );

        const dialog = screen.getByRole('dialog');

        for (let step = 0; step < 12; step += 1) {
            await user.tab();
            expect(dialog).toContainElement(document.activeElement);
        }
    });

    it('closes on Escape', async () => {
        const user = userEvent.setup();
        const onClose = vi.fn();
        render(<AuthModal onClose={onClose} onSuccess={vi.fn()} />);

        await user.keyboard('{Escape}');

        expect(onClose).toHaveBeenCalledTimes(1);
    });
});

describe('AuthModal validation', () => {
    it('names both missing credentials rather than blaming the visitor', async () => {
        const user = userEvent.setup();
        render(<AuthModal onClose={vi.fn()} onSuccess={vi.fn()} />);

        await user.click(screen.getByRole('button', { name: 'Sign in' }));

        expect(await screen.findByRole('alert')).toHaveTextContent('Enter both an email address and a password.');
    });

    it('states the password rule before sending anything', async () => {
        const user = userEvent.setup();
        render(<AuthModal onClose={vi.fn()} onSuccess={vi.fn()} />);

        await user.type(screen.getByLabelText('Email address'), 'a@example.com');
        await user.type(screen.getByLabelText('Password'), 'short');
        await user.click(screen.getByRole('button', { name: 'Sign in' }));

        expect(await screen.findByRole('alert')).toHaveTextContent('Passwords need at least 8 characters.');
    });

    it('carries the sr-only "Error: " prefix on the failure', async () => {
        const user = userEvent.setup();
        render(<AuthModal onClose={vi.fn()} onSuccess={vi.fn()} />);

        await user.click(screen.getByRole('button', { name: 'Sign in' }));
        const alert = await screen.findByRole('alert');

        expect(within(alert).getByText('Error:', { exact: false, selector: 'span' })).toHaveClass('sr-only');
    });
});

describe('AuthModal tabs', () => {
    it('switches to the create-account panel', async () => {
        const user = userEvent.setup();
        render(<AuthModal onClose={vi.fn()} onSuccess={vi.fn()} />);

        await user.click(screen.getByRole('tab', { name: 'Create account' }));

        expect(screen.getByRole('tab', { name: 'Create account' })).toHaveAttribute('aria-selected', 'true');
        expect(screen.getByRole('dialog')).toHaveAccessibleName('Create an account');
        expect(screen.getByText('At least 8 characters.')).toBeInTheDocument();
    });

    it('clears a stale error when the tab changes', async () => {
        const user = userEvent.setup();
        render(<AuthModal onClose={vi.fn()} onSuccess={vi.fn()} />);

        await user.click(screen.getByRole('button', { name: 'Sign in' }));
        expect(await screen.findByRole('alert')).toBeInTheDocument();

        await user.click(screen.getByRole('tab', { name: 'Create account' }));

        expect(screen.queryByRole('alert')).toBeNull();
    });

    it('treats a confirmation-pending sign-up as a success, not an error', async () => {
        const user = userEvent.setup();
        render(<AuthModal onClose={vi.fn()} onSuccess={vi.fn()} />);

        await user.click(screen.getByRole('tab', { name: 'Create account' }));
        await user.type(screen.getByLabelText('Email address'), 'a@example.com');
        await user.type(screen.getByLabelText('Password'), 'a-long-password');
        await user.click(screen.getByRole('button', { name: 'Create account', selector: 'button[type="submit"]' }));

        expect(await screen.findByRole('status')).toHaveTextContent('Account created. Check your inbox');
        expect(screen.queryByRole('alert')).toBeNull();
    });

    it('says so when the address is already registered', async () => {
        const user = userEvent.setup();
        supabase.signUp = vi.fn(() => Promise.resolve({ data: { user: { identities: [] } }, error: null }));
        render(<AuthModal onClose={vi.fn()} onSuccess={vi.fn()} />);

        await user.click(screen.getByRole('tab', { name: 'Create account' }));
        await user.type(screen.getByLabelText('Email address'), 'a@example.com');
        await user.type(screen.getByLabelText('Password'), 'a-long-password');
        await user.click(screen.getByRole('button', { name: 'Create account', selector: 'button[type="submit"]' }));

        expect(await screen.findByRole('alert')).toHaveTextContent('That email is already registered.');
    });
});

describe('AuthModal sign-in request', () => {
    it('hands the session back through onSuccess', async () => {
        const user = userEvent.setup();
        const onSuccess = vi.fn();
        vi.spyOn(window, 'fetch').mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({ user: { id: 'u1' } }),
        });

        render(<AuthModal onClose={vi.fn()} onSuccess={onSuccess} />);

        await user.type(screen.getByLabelText('Email address'), 'a@example.com');
        await user.type(screen.getByLabelText('Password'), 'a-long-password');
        await user.click(screen.getByRole('button', { name: 'Sign in', selector: 'button[type="submit"]' }));

        await waitFor(() => expect(onSuccess).toHaveBeenCalledWith({ id: 'u1' }));
        expect(window.fetch).toHaveBeenCalledWith('/api/auth/signin', expect.objectContaining({ method: 'POST' }));
    });

    it('surfaces the server sentence on a refusal', async () => {
        const user = userEvent.setup();
        vi.spyOn(window, 'fetch').mockResolvedValue({
            ok: false,
            json: () => Promise.resolve({ error: 'That email and password do not match.' }),
        });

        render(<AuthModal onClose={vi.fn()} onSuccess={vi.fn()} />);

        await user.type(screen.getByLabelText('Email address'), 'a@example.com');
        await user.type(screen.getByLabelText('Password'), 'a-long-password');
        await user.click(screen.getByRole('button', { name: 'Sign in', selector: 'button[type="submit"]' }));

        expect(await screen.findByRole('alert')).toHaveTextContent('That email and password do not match.');
    });

    it('never prints a parser error at the visitor when the body is not JSON', async () => {
        const user = userEvent.setup();
        vi.spyOn(window, 'fetch').mockResolvedValue({
            ok: false,
            json: () => Promise.reject(new Error('Unexpected token <')),
        });

        render(<AuthModal onClose={vi.fn()} onSuccess={vi.fn()} />);

        await user.type(screen.getByLabelText('Email address'), 'a@example.com');
        await user.type(screen.getByLabelText('Password'), 'a-long-password');
        await user.click(screen.getByRole('button', { name: 'Sign in', selector: 'button[type="submit"]' }));

        const alert = await screen.findByRole('alert');
        expect(alert).toHaveTextContent('That sign-in did not go through. Try again.');
        expect(alert.textContent).not.toContain('Unexpected token');
    });
});

describe('AuthModal Google path', () => {
    it('asks Supabase for the Google redirect', async () => {
        const user = userEvent.setup();
        render(<AuthModal onClose={vi.fn()} onSuccess={vi.fn()} />);

        await user.click(screen.getByRole('button', { name: 'Continue with Google' }));

        await waitFor(() => expect(supabase.signInWithOAuth).toHaveBeenCalledTimes(1));
        expect(supabase.signInWithOAuth.mock.calls[0][0].provider).toBe('google');
    });

    it('reports a failure inline', async () => {
        const user = userEvent.setup();
        supabase.signInWithOAuth = vi.fn(() => Promise.resolve({ error: new Error('Could not reach Google. Try again.') }));
        render(<AuthModal onClose={vi.fn()} onSuccess={vi.fn()} />);

        await user.click(screen.getByRole('button', { name: 'Continue with Google' }));

        expect(await screen.findByRole('alert')).toHaveTextContent('Could not reach Google. Try again.');
    });
});
