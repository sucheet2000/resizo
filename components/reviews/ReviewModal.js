'use client';

/**
 * ReviewModal
 *
 * The write half of the reviews block: its own trigger plus the dialog behind
 * it, so the server-rendered list stays a server component.
 *
 * Focus trapping, Escape and focus restoration come from <Modal/> — the old
 * inline review dialog had none of the three, and Tab walked straight out of
 * it into the page underneath. Every field is wrapped in <Field/>, so the
 * labels are actually associated, which none of them were.
 */
import { useEffect, useMemo, useState } from 'react';

import { StarRatingInput } from '@/components/reviews/StarRating';
import Alert from '@/components/ui/Alert';
import Field from '@/components/ui/Field';
import Modal from '@/components/ui/Modal';
import Spinner from '@/components/ui/Spinner';
import { createClient } from '@/lib/supabase/client';

const MAX_NAME = 60;
const MAX_ROLE = 60;
const MAX_REVIEW = 600;

const EMPTY = { name: '', role: '', body: '', rating: 5 };

export default function ReviewModal({ triggerLabel = 'Write a review', className = '' }) {
    const supabase = useMemo(() => createClient(), []);

    const [open, setOpen] = useState(false);
    const [user, setUser] = useState(null);
    const [form, setForm] = useState(EMPTY);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState(null);
    const [done, setDone] = useState(false);

    useEffect(() => {
        let active = true;

        supabase.auth.getUser()
            .then(({ data }) => {
                if (active) setUser(data?.user ?? null);
            })
            .catch(() => {
                // Anonymous is the default state already.
            });

        const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
            setUser(session?.user ?? null);
        });

        return () => {
            active = false;
            subscription?.subscription?.unsubscribe();
        };
    }, [supabase]);

    const close = () => {
        setOpen(false);
        setError(null);
        setDone(false);
    };

    const submit = async (event) => {
        event.preventDefault();

        if (!user) {
            setError('Sign in from the header first — reviews are tied to an account so they can be moderated.');
            return;
        }

        const name = form.name.trim();
        const body = form.body.trim();

        if (!name || !body) {
            setError('A name and a few words about what you used it for are both needed.');
            return;
        }

        setSubmitting(true);
        setError(null);

        const { error: insertError } = await supabase.from('reviews').insert({
            name: name.slice(0, MAX_NAME),
            role: form.role.trim().slice(0, MAX_ROLE) || null,
            review: body.slice(0, MAX_REVIEW),
            rating: form.rating,
        });

        setSubmitting(false);

        if (insertError) {
            setError('That review could not be saved. Try again in a moment.');
            return;
        }

        setForm(EMPTY);
        setDone(true);
    };

    const controlClass =
        'w-full rounded-input border border-line bg-surface px-3 py-2 text-base text-ink transition-colors duration-120 ease-snap';

    return (
        <div className={className}>
            <button
                type="button"
                onClick={() => setOpen(true)}
                className="rounded-button border border-line px-4 py-2 text-ui text-ink transition-colors duration-120 ease-snap hover:bg-surface-sunken"
            >
                {triggerLabel}
            </button>

            {open ? (
                <Modal
                    open
                    onClose={close}
                    title="Write a review"
                    description="Published after a moderator reads it."
                    closeLabel="Close the review form"
                >
                    {done ? (
                        <div className="flex flex-col gap-4">
                            <p className="text-base text-ink">
                                Thank you. Your review is queued and appears here once it has been read.
                            </p>
                            <button
                                type="button"
                                onClick={close}
                                className="w-fit rounded-button bg-accent px-4 py-2 text-ui font-semibold text-accent-ink transition-opacity duration-120 ease-snap hover:opacity-90"
                            >
                                Done
                            </button>
                        </div>
                    ) : (
                        // noValidate: the inline Alert below is this panel's
                        // error surface, not the browser's floating bubble.
                        <form onSubmit={submit} noValidate className="flex flex-col gap-4">
                            {user ? null : (
                                <Alert tone="info">
                                    Sign in from the header to leave a review. An account is only used to keep
                                    the list honest — it is not needed for any of the tools.
                                </Alert>
                            )}

                            <div>
                                <p className="text-ui text-ink">Rating</p>
                                <div className="mt-1.5">
                                    <StarRatingInput
                                        label="Rating out of five"
                                        value={form.rating}
                                        onChange={(rating) => setForm((current) => ({ ...current, rating }))}
                                    />
                                </div>
                            </div>

                            <Field id="review-name" label="Your name">
                                <input
                                    id="review-name"
                                    type="text"
                                    required
                                    maxLength={MAX_NAME}
                                    value={form.name}
                                    onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                                    className={controlClass}
                                />
                            </Field>

                            <Field id="review-role" label="What you do (optional)">
                                <input
                                    id="review-role"
                                    type="text"
                                    maxLength={MAX_ROLE}
                                    value={form.role}
                                    onChange={(event) => setForm((current) => ({ ...current, role: event.target.value }))}
                                    className={controlClass}
                                />
                            </Field>

                            <Field
                                id="review-body"
                                label="Your review"
                                hint={`${form.body.length}/${MAX_REVIEW} characters`}
                            >
                                <textarea
                                    id="review-body"
                                    required
                                    rows={4}
                                    maxLength={MAX_REVIEW}
                                    aria-describedby="review-body-hint"
                                    value={form.body}
                                    onChange={(event) => setForm((current) => ({ ...current, body: event.target.value }))}
                                    className={`${controlClass} resize-y`}
                                />
                            </Field>

                            <Alert>{error}</Alert>

                            <div className="flex items-center gap-3">
                                <button
                                    type="submit"
                                    disabled={submitting || !user}
                                    aria-busy={submitting || undefined}
                                    className="inline-flex items-center gap-2 rounded-button bg-accent px-4 py-2 text-ui font-semibold text-accent-ink transition-opacity duration-120 ease-snap hover:opacity-90 disabled:opacity-60"
                                >
                                    {submitting ? <Spinner size={14} /> : null}
                                    {submitting ? 'Sending' : 'Send review'}
                                </button>

                                <button
                                    type="button"
                                    onClick={close}
                                    className="rounded-button border border-line px-4 py-2 text-ui text-ink transition-colors duration-120 ease-snap hover:bg-surface-sunken"
                                >
                                    Cancel
                                </button>
                            </div>
                        </form>
                    )}
                </Modal>
            ) : null}
        </div>
    );
}
