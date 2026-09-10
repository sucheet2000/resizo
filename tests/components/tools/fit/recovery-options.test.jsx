/**
 * RecoveryOptions
 *
 * The Alert-plus-buttons block /passport-photo built inline, generalised so
 * /image-size-fitter can drive the same buttons off `recoveryFor`'s own
 * vocabulary ('lower-quality' | 'webp' | 'limit' | 'png' | 'size' | 'minimum')
 * instead of a page re-deriving which button applies. The component itself
 * knows nothing about the failure — it renders exactly the `options` it is
 * given, in order, and calls back on click.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import RecoveryOptions from '@/components/tools/fit/RecoveryOptions';

function callbacks() {
    return {
        onAllowLowerQuality: vi.fn(),
        onSwitchToWebp: vi.fn(),
        onChangeLimit: vi.fn(),
        onSwitchToPng: vi.fn(),
        onChangeSize: vi.fn(),
        onChangeMinimum: vi.fn(),
    };
}

describe('RecoveryOptions renders nothing without a failure', () => {
    it('renders no alert when there is no error', () => {
        render(<RecoveryOptions id="fit-recovery" error={null} options={[]} {...callbacks()} />);
        expect(screen.queryByRole('alert')).toBeNull();
    });
});

describe('RecoveryOptions shows the message and only the buttons named in options', () => {
    it('shows the error, the suggestion, and the id for focus', () => {
        render(
            <RecoveryOptions
                id="fit-recovery"
                error="Resizo couldn’t produce a JPEG under 20 KB at 600 × 600 pixels."
                suggestion="Allow a lower quality, choose WebP, or raise the limit."
                options={['lower-quality', 'webp', 'limit']}
                {...callbacks()}
            />,
        );

        const alert = screen.getByRole('alert');
        expect(alert).toHaveAttribute('id', 'fit-recovery');
        expect(alert).toHaveAttribute('tabIndex', '-1');
        expect(screen.getByText(/couldn.t produce a jpeg under 20 kb/i)).toBeInTheDocument();
        expect(screen.getByText(/allow a lower quality, choose webp/i)).toBeInTheDocument();
    });

    it('renders exactly the target-failure trio and wires each click', async () => {
        const user = userEvent.setup();
        const handlers = callbacks();
        render(
            <RecoveryOptions
                id="fit-recovery"
                error="Too small."
                options={['lower-quality', 'webp', 'limit']}
                {...handlers}
            />,
        );

        expect(screen.getByRole('button', { name: /^allow lower quality$/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /^switch to webp$/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /^change the limit$/i })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /^switch to png$/i })).toBeNull();
        expect(screen.queryByRole('button', { name: /^change the size$/i })).toBeNull();
        expect(screen.queryByRole('button', { name: /^change the minimum$/i })).toBeNull();

        await user.click(screen.getByRole('button', { name: /^switch to webp$/i }));
        expect(handlers.onSwitchToWebp).toHaveBeenCalledTimes(1);
        expect(handlers.onAllowLowerQuality).not.toHaveBeenCalled();
    });

    it('renders exactly the minimum-failure trio and wires each click', async () => {
        const user = userEvent.setup();
        const handlers = callbacks();
        render(
            <RecoveryOptions
                id="fit-recovery"
                error="Too big a floor."
                options={['png', 'size', 'minimum']}
                {...handlers}
            />,
        );

        expect(screen.getByRole('button', { name: /^switch to png$/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /^change the size$/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /^change the minimum$/i })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /^allow lower quality$/i })).toBeNull();
        expect(screen.queryByRole('button', { name: /^switch to webp$/i })).toBeNull();
        expect(screen.queryByRole('button', { name: /^change the limit$/i })).toBeNull();

        await user.click(screen.getByRole('button', { name: /^change the minimum$/i }));
        expect(handlers.onChangeMinimum).toHaveBeenCalledTimes(1);
    });

    it('renders no buttons at all when options is empty, but still shows the message', () => {
        render(<RecoveryOptions id="fit-recovery" error="Something failed." options={[]} {...callbacks()} />);
        expect(screen.getByRole('alert')).toHaveTextContent('Something failed.');
        expect(screen.queryByRole('button')).toBeNull();
    });
});
