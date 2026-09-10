/**
 * BatchProgress (shared) — the single live-region status line every batch
 * tool mounts from its very first render, so a screen reader has already
 * seen the element before there is ever anything to announce in it.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import BatchProgress from '@/components/tools/batch/BatchProgress';

describe('BatchProgress (shared)', () => {
    it('renders a single status live region', () => {
        render(<BatchProgress text="" />);
        const status = screen.getByRole('status');
        expect(status).toHaveAttribute('aria-live', 'polite');
        expect(status).toHaveAttribute('aria-atomic', 'true');
    });

    it('renders empty text as an empty (but present) live region', () => {
        render(<BatchProgress text="" />);
        expect(screen.getByRole('status')).toHaveTextContent('');
    });

    it('renders the given text', () => {
        render(<BatchProgress text="2 of 5 done · Converting b.jpg" />);
        expect(screen.getByText('2 of 5 done · Converting b.jpg')).toBeInTheDocument();
    });
});
