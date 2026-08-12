/**
 * StarRating, ReviewList, ReviewModal
 *
 * The reviews block feeds the page's AggregateRating, so what is visible and
 * what the markup claims have to be the same set. The rating graphic gets one
 * accessible name rather than five identical ones, and the write dialog
 * inherits the focus trap from <Modal/>.
 */
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import ReviewList from '@/components/reviews/ReviewList';
import ReviewModal from '@/components/reviews/ReviewModal';
import StarRating, { StarRatingInput } from '@/components/reviews/StarRating';

const supabase = {
    user: null,
    insert: vi.fn(),
    unsubscribe: vi.fn(),
};

vi.mock('@/lib/supabase/client', () => ({
    createClient: () => ({
        auth: {
            getUser: () => Promise.resolve({ data: { user: supabase.user } }),
            onAuthStateChange: () => ({ data: { subscription: { unsubscribe: supabase.unsubscribe } } }),
        },
        from: () => ({ insert: (...args) => supabase.insert(...args) }),
    }),
}));

beforeEach(() => {
    supabase.user = { id: 'u1', email: 'a@example.com' };
    supabase.insert = vi.fn(() => Promise.resolve({ error: null }));
});

const REVIEWS = [
    {
        id: 1,
        name: 'Priya',
        role: 'Photographer',
        rating: 5,
        review: 'Got a 4 MB JPEG under 100 KB for a job portal in one go.',
        created_at: '2026-05-14T10:00:00.000Z',
    },
    {
        id: 2,
        name: 'Tom',
        rating: 4,
        review: 'The HEIC tool saved me from installing anything.',
        created_at: '2026-06-02T10:00:00.000Z',
    },
];

describe('StarRating', () => {
    it('has one accessible name for the whole rating, not five identical ones', () => {
        render(<StarRating value={4} />);
        expect(screen.getByRole('img', { name: '4 out of 5 stars' })).toBeInTheDocument();
    });

    it('hides every individual star from assistive technology', () => {
        const { container } = render(<StarRating value={3} />);
        const stars = container.querySelectorAll('svg');

        expect(stars).toHaveLength(5);
        for (const star of stars) expect(star).toHaveAttribute('aria-hidden', 'true');
    });

    it.each([
        [-2, '0 out of 5 stars'],
        [9, '5 out of 5 stars'],
        [null, '0 out of 5 stars'],
        ['4', '4 out of 5 stars'],
    ])('clamps %s to %s', (value, expected) => {
        render(<StarRating value={value} />);
        expect(screen.getByRole('img', { name: expected })).toBeInTheDocument();
    });
});

describe('StarRatingInput', () => {
    it('names each control after the value it sets', () => {
        render(<StarRatingInput value={3} onChange={vi.fn()} />);

        expect(screen.getByRole('button', { name: 'Rate 1 star' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Rate 4 stars' })).toBeInTheDocument();
    });

    it('carries the current choice on aria-pressed', () => {
        render(<StarRatingInput value={3} onChange={vi.fn()} />);

        expect(screen.getByRole('button', { name: 'Rate 3 stars' })).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByRole('button', { name: 'Rate 2 stars' })).toHaveAttribute('aria-pressed', 'false');
    });

    it('is reachable and operable from the keyboard', async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        render(<StarRatingInput value={3} onChange={onChange} label="Rating out of five" />);

        await user.tab();
        expect(screen.getByRole('button', { name: 'Rate 1 star' })).toHaveFocus();

        await user.keyboard('{Enter}');
        expect(onChange).toHaveBeenCalledWith(1);
    });

    it('groups the controls under one label', () => {
        render(<StarRatingInput value={3} onChange={vi.fn()} label="Rating out of five" />);
        expect(screen.getByRole('group', { name: 'Rating out of five' })).toBeInTheDocument();
    });

    it('prints the value in mono beside the stars', () => {
        render(<StarRatingInput value={3} onChange={vi.fn()} />);
        expect(screen.getByText('3/5')).toBeInTheDocument();
    });
});

describe('ReviewList', () => {
    it('renders every review server-side, in the markup Google reads', () => {
        render(<ReviewList reviews={REVIEWS} />);

        expect(screen.getAllByRole('listitem')).toHaveLength(2);
        expect(screen.getByText(REVIEWS[0].review)).toBeInTheDocument();
        expect(screen.getByRole('img', { name: '5 out of 5 stars' })).toBeInTheDocument();
    });

    it('dates each review to the month, in UTC', () => {
        render(<ReviewList reviews={REVIEWS} />);
        const first = screen.getAllByRole('listitem')[0];

        expect(within(first).getByText('May 2026')).toHaveAttribute('datetime', '2026-05-14');
    });

    it('renders a role only when there is one', () => {
        render(<ReviewList reviews={REVIEWS} />);

        expect(screen.getByText(/Photographer/)).toBeInTheDocument();
        expect(screen.getByText('Tom')).toBeInTheDocument();
    });

    it('invites the first review rather than showing an empty grid', () => {
        render(<ReviewList reviews={[]} />);
        expect(screen.getByText(/No reviews yet/)).toBeInTheDocument();
    });

    it('drops an entry with no body', () => {
        render(<ReviewList reviews={[...REVIEWS, { id: 3, name: 'Ghost', rating: 5 }]} />);
        expect(screen.getAllByRole('listitem')).toHaveLength(2);
    });

    it('omits an unparseable date rather than printing Invalid Date', () => {
        render(<ReviewList reviews={[{ id: 4, name: 'A', rating: 5, review: 'Good.', created_at: 'not a date' }]} />);
        expect(screen.queryByText(/Invalid Date/)).toBeNull();
    });
});

describe('ReviewModal', () => {
    it('opens from its own trigger', async () => {
        const user = userEvent.setup();
        render(<ReviewModal />);

        await user.click(screen.getByRole('button', { name: 'Write a review' }));

        expect(screen.getByRole('dialog', { name: 'Write a review' })).toBeInTheDocument();
    });

    it('labels every field', async () => {
        const user = userEvent.setup();
        render(<ReviewModal />);

        await user.click(screen.getByRole('button', { name: 'Write a review' }));

        expect(screen.getByLabelText('Your name')).toBeInTheDocument();
        expect(screen.getByLabelText('What you do (optional)')).toBeInTheDocument();
        expect(screen.getByLabelText('Your review')).toBeInTheDocument();
        expect(screen.getByRole('group', { name: 'Rating out of five' })).toBeInTheDocument();
    });

    it('keeps Tab inside the dialog', async () => {
        const user = userEvent.setup();
        render(
            <div>
                <button type="button">Behind the dialog</button>
                <ReviewModal />
            </div>,
        );

        await user.click(screen.getByRole('button', { name: 'Write a review' }));
        const dialog = screen.getByRole('dialog');

        for (let step = 0; step < 14; step += 1) {
            await user.tab();
            expect(dialog).toContainElement(document.activeElement);
        }
    });

    it('returns focus to the trigger on Escape', async () => {
        const user = userEvent.setup();
        render(<ReviewModal />);
        const trigger = screen.getByRole('button', { name: 'Write a review' });

        await user.click(trigger);
        await user.keyboard('{Escape}');

        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
        expect(trigger).toHaveFocus();
    });

    it('tells an anonymous visitor what to do instead of failing silently', async () => {
        const user = userEvent.setup();
        supabase.user = null;
        render(<ReviewModal />);

        await user.click(screen.getByRole('button', { name: 'Write a review' }));

        expect(await screen.findByRole('status')).toHaveTextContent('Sign in from the header to leave a review.');
        expect(screen.getByRole('button', { name: 'Send review' })).toBeDisabled();
    });

    it('names the missing fields inline rather than in a browser bubble', async () => {
        const user = userEvent.setup();
        render(<ReviewModal />);

        await user.click(screen.getByRole('button', { name: 'Write a review' }));
        await user.click(screen.getByRole('button', { name: 'Send review' }));

        expect(await screen.findByRole('alert'))
            .toHaveTextContent('A name and a few words about what you used it for are both needed.');
        expect(supabase.insert).not.toHaveBeenCalled();
    });

    it('saves a complete review and confirms it is queued', async () => {
        const user = userEvent.setup();
        render(<ReviewModal />);

        await user.click(screen.getByRole('button', { name: 'Write a review' }));
        await user.type(screen.getByLabelText('Your name'), 'Priya');
        await user.type(screen.getByLabelText('Your review'), 'Under 100 KB in one go.');
        await user.click(screen.getByRole('button', { name: 'Rate 4 stars' }));
        await user.click(screen.getByRole('button', { name: 'Send review' }));

        await waitFor(() => expect(supabase.insert).toHaveBeenCalledTimes(1));
        expect(supabase.insert.mock.calls[0][0]).toMatchObject({
            name: 'Priya',
            review: 'Under 100 KB in one go.',
            rating: 4,
            role: null,
        });
        expect(await screen.findByText(/Thank you\./)).toBeInTheDocument();
    });

    it('counts the characters left in the body', async () => {
        const user = userEvent.setup();
        render(<ReviewModal />);

        await user.click(screen.getByRole('button', { name: 'Write a review' }));
        await user.type(screen.getByLabelText('Your review'), 'Four');

        expect(screen.getByText('4/600 characters')).toBeInTheDocument();
    });

    it('reports a failed save without losing what was typed', async () => {
        const user = userEvent.setup();
        supabase.insert = vi.fn(() => Promise.resolve({ error: new Error('nope') }));
        render(<ReviewModal />);

        await user.click(screen.getByRole('button', { name: 'Write a review' }));
        await user.type(screen.getByLabelText('Your name'), 'Priya');
        await user.type(screen.getByLabelText('Your review'), 'Under 100 KB.');
        await user.click(screen.getByRole('button', { name: 'Send review' }));

        expect(await screen.findByRole('alert')).toHaveTextContent('That review could not be saved.');
        expect(screen.getByLabelText('Your name')).toHaveValue('Priya');
    });
});
