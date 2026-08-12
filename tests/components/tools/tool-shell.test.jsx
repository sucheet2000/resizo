/**
 * ToolShell + ToolAction
 *
 * The one repeated primitive. Its order IS the design — DESIGN.md: "Settings
 * sit above the drop zone so a file lands already configured — no
 * upload→configure→reprocess loop." That is a DOM-order assertion, not a
 * styling one, so it is checked against a real Dropzone.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import ToolShell, { ToolAction } from '@/components/tools/ToolShell';
import Dropzone from '@/components/ui/Dropzone';

function renderShell(props = {}) {
    return render(
        <ToolShell
            slug="compress"
            title="Compress an image to an exact file size"
            intro="Aim at a byte target and see what you got."
            settings={<div data-testid="settings">Target size</div>}
            panel={(
                <Dropzone
                    id="compress-zone"
                    label="Drop an image here"
                    constraints="JPEG, PNG, WebP · up to 20 MB"
                    onFiles={vi.fn()}
                />
            )}
            {...props}
        />,
    );
}

function isBefore(first, second) {
    return Boolean(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING);
}

describe('ToolShell order', () => {
    it('puts the settings above the drop zone in the DOM', () => {
        renderShell();

        const settings = screen.getByTestId('settings');
        const zone = screen.getByLabelText('Drop an image here');

        expect(isBefore(settings, zone)).toBe(true);
    });

    it('puts the h1 above the settings', () => {
        renderShell();

        expect(isBefore(screen.getByRole('heading', { level: 1 }), screen.getByTestId('settings'))).toBe(true);
    });

    it('has exactly one h1', () => {
        renderShell();
        expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    });

    it('labels the settings block for a screen reader without adding a visible heading', () => {
        renderShell({ settingsLabel: 'Compression settings' });
        const heading = screen.getByRole('heading', { level: 2, name: 'Compression settings' });

        expect(heading).toHaveClass('sr-only');
    });

    it('omits the settings block entirely when a tool has no settings', () => {
        renderShell({ settings: null, settingsLabel: 'Compression settings' });
        expect(screen.queryByRole('heading', { name: 'Compression settings' })).toBeNull();
    });
});

describe('ToolShell slots', () => {
    it('renders the error slot as an inline alert, not a toast', () => {
        renderShell({ error: 'That file is not a JPEG, PNG, WebP image.' });
        expect(screen.getByRole('alert')).toHaveTextContent('That file is not a JPEG, PNG, WebP image.');
    });

    it('renders no alert when there is no error', () => {
        renderShell();
        expect(screen.queryByRole('alert')).toBeNull();
    });

    it('replaces the action with the result — the CTA morph', () => {
        const { rerender } = renderShell({ action: <button type="button">Compress</button> });
        expect(screen.getByRole('button', { name: 'Compress' })).toBeInTheDocument();

        rerender(
            <ToolShell
                slug="compress"
                title="Compress an image"
                action={<button type="button">Compress</button>}
                result={<p>Done.</p>}
            />,
        );

        expect(screen.queryByRole('button', { name: 'Compress' })).toBeNull();
        expect(screen.getByText('Done.')).toBeInTheDocument();
    });

    it('keeps both when a tool asks for it', () => {
        renderShell({
            action: <button type="button">Compress</button>,
            result: <p>Done.</p>,
            keepActionWithResult: true,
        });

        expect(screen.getByRole('button', { name: 'Compress' })).toBeInTheDocument();
        expect(screen.getByText('Done.')).toBeInTheDocument();
    });

    it('renders the page content below the panel', () => {
        renderShell({ children: <section data-testid="content">How this works</section> });

        expect(isBefore(screen.getByTestId('settings'), screen.getByTestId('content'))).toBe(true);
    });

    it('renders the breadcrumb trail when one is given', () => {
        renderShell({ breadcrumb: [{ name: 'Home', path: '/' }, { name: 'Compress Image' }] });

        expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toBeInTheDocument();
    });
});

describe('ToolShell privacy line', () => {
    it('states where processing happens, truthfully', () => {
        renderShell();
        const note = screen.getByText(/Processed on our server/);

        expect(note).toHaveTextContent('never kept');
        expect(note).toHaveTextContent('deleted the moment your download starts');
        // Large files transit Vercel Blob, so the memory-only / never-written-to-disk
        // absolutes would be false — the note must not make them.
        expect(note).not.toHaveTextContent('never written to disk');
    });

    it('never claims the work happens in the browser', () => {
        const { container } = renderShell();

        expect(container.textContent).not.toMatch(/in your browser/i);
        expect(container.textContent).not.toMatch(/never leaves? your device/i);
    });
});

describe('ToolShell related links', () => {
    it('renders the related block by default', () => {
        renderShell();
        expect(screen.getByRole('heading', { name: 'What to do next' })).toBeInTheDocument();
    });

    it('can be turned off for a page that has its own', () => {
        renderShell({ related: false });
        expect(screen.queryByRole('heading', { name: 'What to do next' })).toBeNull();
    });

    it('takes a replacement block', () => {
        renderShell({ related: <section data-testid="custom-related">Sibling pages</section> });

        expect(screen.getByTestId('custom-related')).toBeInTheDocument();
        expect(screen.queryByRole('heading', { name: 'What to do next' })).toBeNull();
    });
});

describe('ToolAction', () => {
    it('is a real button that fires its handler', async () => {
        const user = userEvent.setup();
        const onClick = vi.fn();
        render(<ToolAction label="Compress image" onClick={onClick} />);

        await user.click(screen.getByRole('button', { name: 'Compress image' }));

        expect(onClick).toHaveBeenCalledTimes(1);
    });

    it('swaps to the processing label and blocks a second submit', () => {
        render(<ToolAction label="Compress image" isProcessing progress={40} />);
        const button = screen.getByRole('button');

        expect(button).toBeDisabled();
        expect(button).toHaveAttribute('aria-busy', 'true');
        expect(button).toHaveTextContent('Working…');
        expect(button).toHaveTextContent('40%');
    });

    it('exposes measured progress on a real progressbar', () => {
        render(<ToolAction label="Compress image" isProcessing progress={40} />);
        const bar = screen.getByRole('progressbar');

        expect(bar).toHaveAttribute('aria-valuenow', '40');
        expect(bar).toHaveAttribute('aria-valuemin', '0');
        expect(bar).toHaveAttribute('aria-valuemax', '100');
    });

    it('shows no progressbar at rest', () => {
        render(<ToolAction label="Compress image" hint="20 MB limit." />);

        expect(screen.queryByRole('progressbar')).toBeNull();
        expect(screen.getByText('20 MB limit.')).toBeInTheDocument();
    });

    it('hides the hint while it is working', () => {
        render(<ToolAction label="Compress image" hint="20 MB limit." isProcessing />);
        expect(screen.queryByText('20 MB limit.')).toBeNull();
    });

    it('stays disabled when the caller says so', () => {
        render(<ToolAction label="Compress image" disabled />);
        expect(screen.getByRole('button')).toBeDisabled();
    });

    it('surfaces a Cancel button only while processing and fires its handler', async () => {
        const user = userEvent.setup();
        const onCancel = vi.fn();
        const { rerender } = render(<ToolAction label="Compress image" onCancel={onCancel} />);

        // Nothing is in flight at rest, so there is nothing to cancel.
        expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();

        rerender(<ToolAction label="Compress image" isProcessing progress={40} onCancel={onCancel} />);
        const cancel = screen.getByRole('button', { name: 'Cancel' });
        expect(cancel).toBeEnabled();

        await user.click(cancel);
        expect(onCancel).toHaveBeenCalledTimes(1);
    });

    it('shows no Cancel button while processing when no handler is wired', () => {
        render(<ToolAction label="Compress image" isProcessing progress={40} />);

        expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
        expect(screen.getAllByRole('button')).toHaveLength(1);
    });
});
