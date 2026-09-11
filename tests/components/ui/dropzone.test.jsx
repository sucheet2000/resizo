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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

    /**
     * The reason sits on the accent wash. Accent-on-wash measured 4.41:1 at
     * the reason's 14 px weight-500 size (an audit finding on
     * /favicon-generator), under the 4.5:1 floor, so the reason is ink.
     */
    it('prints the reject reason in ink, not accent, so it clears contrast on the wash', () => {
        renderZone({ state: 'reject', reason: 'That file is 34 MB.' });
        const reason = document.getElementById('test-zone-reason');
        expect(reason).toHaveClass('text-ink');
        expect(reason).not.toHaveClass('text-accent');
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

/**
 * The folder control.
 *
 * jsdom's HTMLInputElement has no `webkitdirectory`, which makes the default
 * state of this suite the unsupported browser — so every test above is already
 * an assertion that nothing changes where the attribute is missing. The
 * supported browser is created explicitly, by putting the attribute on the
 * prototype exactly as a real browser does.
 */
function withFolderSupport() {
    Object.defineProperty(window.HTMLInputElement.prototype, 'webkitdirectory', {
        value: false,
        configurable: true,
        writable: true,
    });
    return () => {
        delete window.HTMLInputElement.prototype.webkitdirectory;
    };
}

describe('Dropzone folder control — unsupported browser', () => {
    it('renders nothing at all: one input, one button, no folder anything', () => {
        const { container } = renderZone({ folderLabel: 'Choose a folder', onFolderFiles: vi.fn() });

        expect(container.querySelectorAll('input[type="file"]')).toHaveLength(1);
        expect(screen.queryByRole('button', { name: 'Choose a folder' })).toBeNull();
        expect(container.querySelector('[webkitdirectory]')).toBeNull();
    });
});

describe('Dropzone folder control — supported browser', () => {
    let restore;

    beforeEach(() => {
        restore = withFolderSupport();
    });

    afterEach(() => {
        restore();
    });

    it('renders a second control beside Browse, not instead of it', () => {
        renderZone({ folderLabel: 'Choose a folder', onFolderFiles: vi.fn() });

        expect(screen.getByRole('button', { name: 'Browse files' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Choose a folder' })).toBeInTheDocument();
    });

    it('stays absent unless the caller asked for it', () => {
        renderZone();
        expect(screen.queryByRole('button', { name: /folder/i })).toBeNull();
    });

    it('puts webkitdirectory on the second input and leaves the first alone', () => {
        const { container, input } = renderZone({ folderLabel: 'Choose a folder', onFolderFiles: vi.fn() });
        const folderInput = container.querySelector('#test-zone-folder');

        expect(folderInput).toHaveAttribute('webkitdirectory');
        expect(folderInput).toHaveAttribute('multiple');
        expect(input).not.toHaveAttribute('webkitdirectory');
    });

    it('hands the folder pick to onFolderFiles, never to onFiles', () => {
        const onFolderFiles = vi.fn();
        const { container, onFiles } = renderZone({ folderLabel: 'Choose a folder', onFolderFiles });
        const folderInput = container.querySelector('#test-zone-folder');
        const files = [imageFile('Trip/a.jpg'), imageFile('Trip/b.jpg')];

        setInputFiles(folderInput, files);
        fireEvent.change(folderInput);

        expect(onFolderFiles).toHaveBeenCalledTimes(1);
        expect(onFolderFiles.mock.calls[0][0]).toEqual(files);
        expect(onFiles).not.toHaveBeenCalled();
    });

    it('clears the folder input so picking the same folder again fires again', () => {
        const onFolderFiles = vi.fn();
        const { container } = renderZone({ folderLabel: 'Choose a folder', onFolderFiles });
        const folderInput = container.querySelector('#test-zone-folder');

        setInputFiles(folderInput, [imageFile('a.jpg')]);
        fireEvent.change(folderInput);

        expect(folderInput.value).toBe('');
    });

    it('opens the folder picker from its own button, by click and by keyboard', async () => {
        const user = userEvent.setup();
        const { container } = renderZone({ folderLabel: 'Choose a folder', onFolderFiles: vi.fn() });
        const folderInput = container.querySelector('#test-zone-folder');
        const click = vi.spyOn(folderInput, 'click').mockImplementation(() => {});

        // Browse first, then the folder control: both are real buttons in the
        // tab order, and neither is reachable only by mouse.
        await user.tab();
        expect(screen.getByRole('button', { name: 'Browse files' })).toHaveFocus();

        await user.tab();
        expect(screen.getByRole('button', { name: 'Choose a folder' })).toHaveFocus();

        await user.keyboard('{Enter}');
        expect(click).toHaveBeenCalledTimes(1);

        await user.click(screen.getByRole('button', { name: 'Choose a folder' }));
        expect(click).toHaveBeenCalledTimes(2);
    });

    it('keeps the folder input out of the tab order and names it for a screen reader', () => {
        const { container } = renderZone({ folderLabel: 'Choose a folder', onFolderFiles: vi.fn() });
        const folderInput = container.querySelector('#test-zone-folder');

        expect(folderInput).toHaveAttribute('tabindex', '-1');
        expect(folderInput).toHaveAttribute('aria-label', 'Choose a folder');
    });

    it('is disabled with the rest of the zone', () => {
        const onFolderFiles = vi.fn();
        const { container } = renderZone({ folderLabel: 'Choose a folder', onFolderFiles, disabled: true });
        const folderInput = container.querySelector('#test-zone-folder');
        const click = vi.spyOn(folderInput, 'click').mockImplementation(() => {});

        expect(folderInput).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Choose a folder' })).toBeDisabled();

        fireEvent.click(screen.getByRole('button', { name: 'Choose a folder' }));
        expect(click).not.toHaveBeenCalled();
    });

    it('leaves the drag-and-drop and file-picker paths exactly as they were', async () => {
        const user = userEvent.setup();
        const { zone, input, onFiles } = renderZone({ folderLabel: 'Choose a folder', onFolderFiles: vi.fn() });
        const dropped = imageFile('holiday.jpg');

        fireEvent.drop(zone, { dataTransfer: { files: [dropped], types: ['Files'] } });
        expect(onFiles.mock.calls[0][0]).toEqual([dropped]);

        await user.upload(input, imageFile('second.jpg'));
        expect(onFiles).toHaveBeenCalledTimes(2);
    });
});

describe('Dropzone children', () => {
    it('renders the extra slot inside the zone', () => {
        const { zone } = renderZone({ children: <p>Or open the resize tool first.</p> });
        expect(zone).toContainElement(screen.getByText('Or open the resize tool first.'));
    });
});
