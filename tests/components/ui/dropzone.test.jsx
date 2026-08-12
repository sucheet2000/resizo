/**
 * Dropzone
 *
 * The one repeated primitive's intake half. Four things have to hold or the
 * panel is broken: the constraints read inside the zone, the four states are
 * distinguishable, the reject reason is inline and announced as an error, and
 * all three intake paths — drop, picker, keyboard — reach the same callback.
 */
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import Dropzone from '@/components/ui/Dropzone';
import { imageFile, setInputFiles } from '../helpers.jsx';

const BASE = {
    id: 'test-zone',
    label: 'Drop an image here',
    constraints: 'JPEG, PNG, WebP · up to 20 MB',
    accept: 'image/jpeg,image/png',
};

/**
 * jsdom has no DragEvent, and Testing Library's fallback constructor drops
 * `relatedTarget` — the one field the "did the pointer leave the zone or just
 * move onto a child" branch reads. A MouseEvent carries it.
 */
function dragLeave(zone, relatedTarget) {
    fireEvent(zone, new MouseEvent('dragleave', { bubbles: true, cancelable: true, relatedTarget }));
}

function renderZone(props = {}) {
    const onFiles = vi.fn();
    const utils = render(<Dropzone {...BASE} onFiles={onFiles} {...props} />);
    const input = utils.container.querySelector('input[type="file"]');
    const zone = input.closest('[data-state]');
    return { ...utils, onFiles, input, zone };
}

describe('Dropzone constraints', () => {
    it('renders the constraints line inside the zone, not above it', () => {
        const { zone } = renderZone();
        const constraints = screen.getByText(BASE.constraints);

        expect(zone).toContainElement(constraints);
        expect(constraints).toHaveAttribute('id', 'test-zone-constraints');
    });

    it('points the file input at the constraints so a screen reader hears them', () => {
        const { input } = renderZone();
        expect(input).toHaveAttribute('aria-describedby', 'test-zone-constraints');
    });

    it('describes the input with both the constraints and the reason when rejected', () => {
        const { input } = renderZone({ state: 'reject', reason: 'That file is 34 MB.' });
        expect(input).toHaveAttribute('aria-describedby', 'test-zone-constraints test-zone-reason');
    });
});

describe('Dropzone states', () => {
    it('rests by default', () => {
        const { zone } = renderZone();
        expect(zone).toHaveAttribute('data-state', 'rest');
    });

    it('switches to dragover on dragenter and back on dragleave', () => {
        const onDragChange = vi.fn();
        const { zone } = renderZone({ onDragChange });

        fireEvent.dragEnter(zone);
        expect(zone).toHaveAttribute('data-state', 'dragover');
        expect(onDragChange).toHaveBeenLastCalledWith(true);

        dragLeave(zone, document.body);
        expect(zone).toHaveAttribute('data-state', 'rest');
        expect(onDragChange).toHaveBeenLastCalledWith(false);
    });

    it('stays in dragover while the pointer moves inside the zone', () => {
        const { zone } = renderZone();

        fireEvent.dragEnter(zone);
        dragLeave(zone, screen.getByRole('button', { name: 'Browse files' }));

        expect(zone).toHaveAttribute('data-state', 'dragover');
    });

    it('reports the accepted state once a file is held', () => {
        const { zone } = renderZone({ state: 'accepted' });
        expect(zone).toHaveAttribute('data-state', 'accepted');
    });

    it('keeps showing the reject reason while the same bad file is dragged again', () => {
        const { zone } = renderZone({ state: 'reject', reason: 'That file is not a JPEG, PNG, WebP image.' });

        fireEvent.dragEnter(zone);

        expect(zone).toHaveAttribute('data-state', 'reject');
    });
});

describe('Dropzone reject reason', () => {
    const reason = 'That file is 34.2 MB. The limit is 20 MB — compress it first, or pick a smaller one.';

    it('shows the specific reason inline, inside the panel', () => {
        const { zone } = renderZone({ state: 'reject', reason });
        const alert = screen.getByRole('alert');

        expect(zone).toContainElement(alert);
        expect(alert).toHaveTextContent(reason);
    });

    it('carries the sr-only "Error: " prefix', () => {
        renderZone({ state: 'reject', reason });
        const prefix = within(screen.getByRole('alert')).getByText('Error:', { exact: false, selector: 'span' });

        expect(prefix).toHaveClass('sr-only');
        expect(prefix).toHaveTextContent('Error:');
    });

    it('renders no alert at all when there is nothing wrong', () => {
        renderZone();
        expect(screen.queryByRole('alert')).toBeNull();
    });
});

describe('Dropzone intake paths', () => {
    it('takes a drop', () => {
        const { zone, onFiles } = renderZone();
        const file = imageFile('holiday.jpg');

        fireEvent.drop(zone, { dataTransfer: { files: [file], types: ['Files'] } });

        expect(onFiles).toHaveBeenCalledTimes(1);
        expect(onFiles.mock.calls[0][0]).toEqual([file]);
    });

    it('ignores a drop that carried no files', () => {
        const { zone, onFiles } = renderZone();

        fireEvent.drop(zone, { dataTransfer: { files: [], types: [] } });

        expect(onFiles).not.toHaveBeenCalled();
    });

    it('takes a pick from the file input', async () => {
        const user = userEvent.setup();
        const { input, onFiles } = renderZone();
        const file = imageFile('holiday.jpg');

        await user.upload(input, file);

        expect(onFiles).toHaveBeenCalledTimes(1);
        expect(onFiles.mock.calls[0][0]).toEqual([file]);
    });

    it('clears the input value so re-picking the same file fires again', async () => {
        const user = userEvent.setup();
        const { input, onFiles } = renderZone();

        await user.upload(input, imageFile('holiday.jpg'));
        expect(input.value).toBe('');

        await user.upload(input, imageFile('holiday.jpg'));
        expect(onFiles).toHaveBeenCalledTimes(2);
    });

    it('takes a pick reached entirely by keyboard', async () => {
        const user = userEvent.setup();
        const { input, onFiles } = renderZone();
        const file = imageFile('holiday.jpg');

        // A real browser opens the picker here and hands the choice back as a
        // change event; jsdom has no picker, so the click stands in for it.
        vi.spyOn(input, 'click').mockImplementation(() => {
            setInputFiles(input, [file]);
            fireEvent.change(input);
        });

        await user.tab();
        const browse = screen.getByRole('button', { name: 'Browse files' });
        expect(browse).toHaveFocus();

        await user.keyboard('{Enter}');

        expect(onFiles).toHaveBeenCalledTimes(1);
        expect(onFiles.mock.calls[0][0]).toEqual([file]);
    });
});

describe('Dropzone keyboard reachability', () => {
    it('gives the file input an accessible name', () => {
        const { input } = renderZone();
        expect(screen.getByLabelText(BASE.label)).toBe(input);
    });

    it('keeps the visually hidden input out of the tab order', async () => {
        const user = userEvent.setup();
        const { input } = renderZone();

        // A focus ring on an sr-only control is a focus ring nobody can see.
        expect(input).toHaveAttribute('tabindex', '-1');

        await user.tab();
        expect(screen.getByRole('button', { name: 'Browse files' })).toHaveFocus();
    });
});

describe('Dropzone browse control', () => {
    it('is a real button, not a div with a click handler', () => {
        renderZone();
        const browse = screen.getByRole('button', { name: 'Browse files' });

        expect(browse.tagName).toBe('BUTTON');
        expect(browse).toHaveAttribute('type', 'button');
    });

    it('takes a custom label', () => {
        renderZone({ browseLabel: 'Choose an image' });
        expect(screen.getByRole('button', { name: 'Choose an image' })).toBeInTheDocument();
    });

    it('opens the picker on click', async () => {
        const user = userEvent.setup();
        const { input } = renderZone();
        const click = vi.spyOn(input, 'click').mockImplementation(() => {});

        await user.click(screen.getByRole('button', { name: 'Browse files' }));

        expect(click).toHaveBeenCalledTimes(1);
    });
});

describe('Dropzone disabled', () => {
    it('refuses a drop and disables both controls', () => {
        const { zone, input, onFiles } = renderZone({ disabled: true });

        fireEvent.drop(zone, { dataTransfer: { files: [imageFile()], types: ['Files'] } });

        expect(onFiles).not.toHaveBeenCalled();
        expect(input).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Browse files' })).toBeDisabled();
    });

    it('does not open the picker', async () => {
        const { input } = renderZone({ disabled: true });
        const click = vi.spyOn(input, 'click').mockImplementation(() => {});

        fireEvent.click(screen.getByRole('button', { name: 'Browse files' }));

        expect(click).not.toHaveBeenCalled();
    });
});

describe('Dropzone children', () => {
    it('renders the extra slot inside the zone', () => {
        const { zone } = renderZone({ children: <p>Or open the resize tool first.</p> });
        expect(zone).toContainElement(screen.getByText('Or open the resize tool first.'));
    });
});
