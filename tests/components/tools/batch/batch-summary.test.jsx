/**
 * BatchSummary (shared) — the "Batch summary" panel extracted from the bulk
 * compressor: a focusable heading, an optional headline moment, a <dl> of
 * caller-supplied entries, the ZIP and Retry actions, and the ZIP failure
 * alert. Every number is the caller's; this component only lays them out.
 */
import { createRef } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import BatchSummary from '@/components/tools/batch/BatchSummary';

describe('BatchSummary (shared)', () => {
    it('renders a section labelled by its own heading, with the default heading text', () => {
        render(<BatchSummary headingId="my-summary-heading" entries={[]} />);
        const heading = screen.getByRole('heading', { name: 'Batch summary' });
        expect(heading).toHaveAttribute('id', 'my-summary-heading');
        expect(screen.getByRole('region', { name: 'Batch summary' })).toBeInTheDocument();
    });

    it('accepts a different heading', () => {
        render(<BatchSummary headingId="h" heading="Custom heading" entries={[]} />);
        expect(screen.getByRole('heading', { name: 'Custom heading' })).toBeInTheDocument();
    });

    it('exposes the heading to a ref so a caller can focus it once a run ends', () => {
        const ref = createRef();
        render(<BatchSummary ref={ref} headingId="h" entries={[]} />);
        expect(ref.current).toBe(screen.getByRole('heading', { name: 'Batch summary' }));
    });

    it('renders no headline when none is given, and the headline node when one is', () => {
        const { rerender } = render(<BatchSummary headingId="h" entries={[]} />);
        expect(document.querySelector('section p')).toBeNull();

        rerender(<BatchSummary headingId="h" entries={[]} headline={<>You saved <b>10 KB</b></>} />);
        expect(screen.getByText('You saved')).toBeInTheDocument();
        expect(screen.getByText('10 KB').tagName).toBe('B');
    });

    it('renders every [dt, dd] pair given, in order', () => {
        render(<BatchSummary headingId="h" entries={[['Selected', '2'], ['Converted', '1']]} />);
        expect(screen.getByText('Selected').nextElementSibling).toHaveTextContent('2');
        expect(screen.getByText('Converted').nextElementSibling).toHaveTextContent('1');
    });

    it('shows the ZIP button only once zip.count is positive, and wires the click', async () => {
        const user = userEvent.setup();
        const onClick = vi.fn();
        const { rerender } = render(<BatchSummary headingId="h" entries={[]} zip={{ count: 0, onClick }} />);
        expect(screen.queryByRole('button', { name: /download all as zip/i })).toBeNull();

        rerender(<BatchSummary headingId="h" entries={[]} zip={{ count: 3, onClick }} />);
        await user.click(screen.getByRole('button', { name: 'Download all as ZIP (3)' }));
        expect(onClick).toHaveBeenCalledTimes(1);
    });

    it('shows the Retry button only once retry.count is positive, and wires the click', async () => {
        const user = userEvent.setup();
        const onClick = vi.fn();
        const { rerender } = render(<BatchSummary headingId="h" entries={[]} retry={{ count: 0, onClick }} />);
        expect(screen.queryByRole('button', { name: /retry failed/i })).toBeNull();

        rerender(<BatchSummary headingId="h" entries={[]} retry={{ count: 2, onClick }} />);
        await user.click(screen.getByRole('button', { name: 'Retry failed (2)' }));
        expect(onClick).toHaveBeenCalledTimes(1);
    });

    it('shows the ZIP error as an alert only when one is given', () => {
        const { rerender } = render(<BatchSummary headingId="h" entries={[]} />);
        expect(screen.queryByRole('alert')).toBeNull();

        rerender(<BatchSummary headingId="h" entries={[]} zipError="Resizo couldn’t create the ZIP." />);
        expect(screen.getByRole('alert')).toHaveTextContent('Resizo couldn’t create the ZIP.');
    });

    it('gives the section no aria-live of its own', () => {
        render(<BatchSummary headingId="h" entries={[]} />);
        expect(screen.getByRole('region', { name: 'Batch summary' })).not.toHaveAttribute('aria-live');
    });
});
