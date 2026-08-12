/**
 * Modal
 *
 * DESIGN.md's accessibility floor: "modals trap and restore focus + Escape".
 * Each of those four words is a test here, because none of the three dialogs
 * this component replaced did any of them.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRef, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import Modal from '@/components/ui/Modal';

function Body() {
    return (
        <form>
            <label htmlFor="modal-name">Your name</label>
            <input id="modal-name" />
            <button type="submit">Send</button>
        </form>
    );
}

/** A trigger plus the dialog it opens — the arrangement focus restoration needs. */
function Harness({ initialFocus = false }) {
    const [open, setOpen] = useState(false);
    const nameRef = useRef(null);

    return (
        <div>
            <button type="button" onClick={() => setOpen(true)}>
                Open dialog
            </button>

            <Modal
                open={open}
                onClose={() => setOpen(false)}
                title="Write a review"
                description="Published after a moderator reads it."
                initialFocusRef={initialFocus ? nameRef : undefined}
            >
                <form>
                    <label htmlFor="modal-name">Your name</label>
                    <input id="modal-name" ref={nameRef} />
                    <button type="submit">Send</button>
                </form>
            </Modal>
        </div>
    );
}

describe('Modal semantics', () => {
    it('is a labelled, described, modal dialog', () => {
        render(<Modal onClose={vi.fn()} title="Write a review" description="Read before publishing."><Body /></Modal>);
        const dialog = screen.getByRole('dialog');

        expect(dialog).toHaveAttribute('aria-modal', 'true');
        expect(dialog).toHaveAccessibleName('Write a review');
        expect(dialog).toHaveAccessibleDescription('Read before publishing.');
    });

    it('renders nothing when closed', () => {
        render(<Modal open={false} onClose={vi.fn()} title="Write a review"><Body /></Modal>);
        expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('locks the page behind it from scrolling and releases it on close', () => {
        const { unmount } = render(<Modal onClose={vi.fn()} title="Write a review"><Body /></Modal>);
        expect(document.body.style.overflow).toBe('hidden');

        unmount();
        expect(document.body.style.overflow).toBe('');
    });
});

describe('Modal focus', () => {
    it('opens with focus on the first interactive element', () => {
        render(<Modal onClose={vi.fn()} title="Write a review"><Body /></Modal>);
        expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
    });

    it('honours an explicit initial focus target', async () => {
        const user = userEvent.setup();
        render(<Harness initialFocus />);

        await user.click(screen.getByRole('button', { name: 'Open dialog' }));

        expect(screen.getByLabelText('Your name')).toHaveFocus();
    });

    it('cycles Tab back to the first control instead of leaking into the page', async () => {
        const user = userEvent.setup();
        render(
            <div>
                <button type="button">Behind the dialog</button>
                <Modal onClose={vi.fn()} title="Write a review"><Body /></Modal>
            </div>,
        );

        const close = screen.getByRole('button', { name: 'Close' });
        const name = screen.getByLabelText('Your name');
        const send = screen.getByRole('button', { name: 'Send' });

        expect(close).toHaveFocus();
        await user.tab();
        expect(name).toHaveFocus();
        await user.tab();
        expect(send).toHaveFocus();
        await user.tab();
        expect(close).toHaveFocus();
    });

    it('cycles Shift+Tab from the first control to the last', async () => {
        const user = userEvent.setup();
        render(
            <div>
                <button type="button">Behind the dialog</button>
                <Modal onClose={vi.fn()} title="Write a review"><Body /></Modal>
            </div>,
        );

        expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();

        await user.tab({ shift: true });

        expect(screen.getByRole('button', { name: 'Send' })).toHaveFocus();
    });

    it('returns focus to the trigger when it closes', async () => {
        const user = userEvent.setup();
        render(<Harness />);
        const trigger = screen.getByRole('button', { name: 'Open dialog' });

        await user.click(trigger);
        expect(screen.getByRole('dialog')).toBeInTheDocument();
        expect(trigger).not.toHaveFocus();

        await user.keyboard('{Escape}');

        expect(screen.queryByRole('dialog')).toBeNull();
        expect(trigger).toHaveFocus();
    });
});

describe('Modal dismissal', () => {
    it('closes on Escape', async () => {
        const user = userEvent.setup();
        const onClose = vi.fn();
        render(<Modal onClose={onClose} title="Write a review"><Body /></Modal>);

        await user.keyboard('{Escape}');

        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('closes from the header control', async () => {
        const user = userEvent.setup();
        const onClose = vi.fn();
        render(<Modal onClose={onClose} title="Write a review" closeLabel="Close the review form"><Body /></Modal>);

        await user.click(screen.getByRole('button', { name: 'Close the review form' }));

        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('keeps the backdrop out of the accessibility tree', () => {
        const { container } = render(<Modal onClose={vi.fn()} title="Write a review"><Body /></Modal>);

        // One "Close" control, not two: the backdrop is a pointer affordance.
        expect(screen.getAllByRole('button', { name: 'Close' })).toHaveLength(1);
        expect(container.querySelector('button.absolute')).toHaveAttribute('aria-hidden', 'true');
    });

    it('closes on a backdrop click', async () => {
        const user = userEvent.setup();
        const onClose = vi.fn();
        const { container } = render(<Modal onClose={onClose} title="Write a review"><Body /></Modal>);

        await user.click(container.querySelector('button.absolute'));

        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('stops listening for Escape once it is gone', async () => {
        const user = userEvent.setup();
        const onClose = vi.fn();
        const { unmount } = render(<Modal onClose={onClose} title="Write a review"><Body /></Modal>);

        unmount();
        await user.keyboard('{Escape}');

        expect(onClose).not.toHaveBeenCalled();
    });
});

describe('Modal footer', () => {
    it('renders the footer slot when one is given', () => {
        render(
            <Modal onClose={vi.fn()} title="Write a review" footer={<p>Moderated before publishing.</p>}>
                <Body />
            </Modal>,
        );

        expect(screen.getByText('Moderated before publishing.')).toBeInTheDocument();
    });
});
