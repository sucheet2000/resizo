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

import ResultPanel from '@/components/tools/ResultPanel';
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

/**
 * THE INTRO IS THE SNIPPET.
 *
 * It used to be `hidden … sm:block` — invisible on a phone, and Google indexes
 * mobile-first, so the one line describing the tool did not exist for the
 * crawler that decides the ranking. The reason it was hidden was real: 16px of
 * copy above the panel pushed the drop zone off a 640px-tall phone screen, and
 * DESIGN.md makes the tool the hero. So it is no longer hidden anywhere — on a
 * phone it moves BELOW the panel with `order-last`, which costs the fold
 * nothing, and from `sm` up it sits back under the h1 where DESIGN.md puts it
 * ("Headline is one explanatory line above it").
 *
 * DOM order is unchanged: h1 → intro → panel. That is the order a crawler and
 * a screen reader read, whichever way the flexbox paints it.
 */
describe('ToolShell intro', () => {
    const INTRO = 'Aim at a byte target and see what you got.';

    it('renders the intro for every visitor, phones included', () => {
        renderShell();
        const intro = screen.getByText(INTRO);

        expect(intro).toBeVisible();
        expect(
            intro.className.split(/\s+/),
            'a `hidden` intro does not exist for a mobile-first crawler',
        ).not.toContain('hidden');
    });

    it('keeps it out of the vertical path to the drop zone on a phone', () => {
        renderShell();
        const classes = screen.getByText(INTRO).className.split(/\s+/);

        expect(classes, 'below the panel on a phone, so the fold is unchanged').toContain('order-last');
        expect(classes, 'back under the h1 from sm up').toContain('sm:order-none');
    });

    it('reads h1 → intro → drop zone in the DOM, which is what a crawler sees', () => {
        renderShell();
        const intro = screen.getByText(INTRO);

        expect(isBefore(screen.getByRole('heading', { level: 1 }), intro)).toBe(true);
        expect(isBefore(intro, screen.getByLabelText('Drop an image here'))).toBe(true);
    });

    it('renders no empty paragraph for a tool with no intro', () => {
        const { container } = renderShell({ intro: null });
        expect(container.querySelector('header + p')).toBeNull();
    });
});

/**
 * THE DIRECT ANSWER IS THE SNIPPET BAIT.
 *
 * 1.12M impressions a quarter at position 9 and a 3.1% click-through: the site
 * is found and not chosen. The `answer` slot is three sentences that a featured
 * snippet or an AI Overview can lift whole, so the one thing that must never
 * happen to it is being hidden — not on a phone, not behind a breakpoint,
 * because Google indexes mobile-first and copy a phone cannot see does not
 * count. It is also not the `intro`: the sub-line is one line under the h1 and
 * this is a paragraph, and a page needs both.
 *
 * It is painted BELOW the panel at every width. Above the panel it would cost
 * roughly three lines of the fold on a 640px phone, and DESIGN.md makes the
 * tool the hero — "zero scrolling to the drop zone".
 */
describe('ToolShell answer', () => {
    const ANSWER = 'To compress an image you name the size you need and let the encoder find the quality '
        + 'that fits it. On Resizo you type the number, add the file and press Compress image. '
        + 'The encoding runs on your own device, on code the page downloads, so nothing travels.';

    const GATED = /^(sm|md|lg|xl|2xl):(hidden|invisible|block|inline|inline-block|flex|grid)$/;

    it('renders the answer at every width, phones included', () => {
        renderShell({ answer: ANSWER });
        const answer = screen.getByText(ANSWER);

        expect(answer).toBeVisible();

        const classes = answer.className.split(/\s+/);
        expect(classes, 'hidden copy does not exist for a mobile-first crawler').not.toContain('hidden');
        expect(classes).not.toContain('invisible');
        expect(classes).not.toContain('sr-only');
        expect(
            classes.filter((token) => GATED.test(token)),
            'the answer must not appear or disappear at a breakpoint',
        ).toEqual([]);
    });

    /**
     * jsdom applies no CSS, so the class-list check above is what actually
     * proves nothing gates the paragraph by width. This case proves the other
     * half — the component renders it at a phone viewport rather than branching
     * on window size in JavaScript. tests/e2e/seo.spec.js measures the pixels.
     */
    it('still renders it at 360x640', () => {
        window.innerWidth = 360;
        window.innerHeight = 640;
        window.dispatchEvent(new Event('resize'));

        renderShell({ answer: ANSWER });

        expect(screen.getByText(ANSWER)).toBeVisible();
    });

    it('is a separate paragraph from the one-line intro', () => {
        renderShell({ answer: ANSWER });

        const intro = screen.getByText('Aim at a byte target and see what you got.');
        const answer = screen.getByText(ANSWER);

        expect(answer).not.toBe(intro);
        expect(intro).toBeVisible();
    });

    it('sits below the drop zone, so the fold is untouched', () => {
        renderShell({ answer: ANSWER });

        expect(isBefore(screen.getByLabelText('Drop an image here'), screen.getByText(ANSWER))).toBe(true);
    });

    it('sits above the page content, not buried in it', () => {
        renderShell({ answer: ANSWER, children: <section data-testid="content">How this works</section> });

        expect(isBefore(screen.getByText(ANSWER), screen.getByTestId('content'))).toBe(true);
    });

    it('renders it as the shell’s own paragraph, in the same place on every page', () => {
        const { container } = renderShell({ answer: ANSWER });
        expect(container.querySelector('.shell > p')).toHaveTextContent(ANSWER);
    });

    it('renders no empty paragraph for a shell with no answer', () => {
        const { container } = renderShell();
        expect(container.querySelector('.shell > p')).toBeNull();
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

    /**
     * THE MORPH STRANDS THE KEYBOARD, AND SAYS NOTHING.
     *
     * The submit button is unmounted the instant a result exists — that is the
     * morph working as designed. But the button was what the visitor had just
     * activated, so removing it drops document.activeElement back to <body>:
     * the next Tab restarts from the top of the page, and a screen reader is
     * told nothing at all.
     *
     * Measured across all seven tools before the fix: `ACTIVE WHILE BUSY:
     * BUTTON "Converting…"` then `ACTIVE AFTER RESULT: BODY`, with zero live
     * regions on the page.
     *
     * What makes this specifically wrong rather than merely unpolished is that
     * the FAILURE path is already handled — Alert carries role="alert" and the
     * action stays mounted, so an error is both announced and leaves focus
     * somewhere real. Success was the only outcome a screen-reader user could
     * not distinguish from nothing having happened.
     */
    it('announces the result and does not strand focus on <body>', () => {
        const { rerender } = renderShell({ action: <button type="button">Compress</button> });

        const submit = screen.getByRole('button', { name: 'Compress' });
        submit.focus();
        expect(document.activeElement).toBe(submit);

        rerender(
            <ToolShell
                slug="compress"
                title="Compress an image"
                action={<button type="button">Compress</button>}
                result={(
                    <ResultPanel
                        variant="single"
                        filename="resizo-compressed-photo.jpg"
                        originalBytes={2_400_000}
                        resultBytes={900_000}
                        onDownload={() => {}}
                        downloadLabel="Download compressed image"
                    />
                )}
            />,
        );

        // The morph has removed the button the visitor was standing on.
        expect(screen.queryByRole('button', { name: 'Compress' })).toBeNull();

        const announced = screen.getByRole('status');
        expect(announced, 'nothing announced the finished job').toBeInTheDocument();
        expect(announced).toHaveTextContent('Download compressed image');

        // The assertion that matters is not "not body" — jsdom keeps a detached
        // node as activeElement, which would pass for the wrong reason. It is
        // that focus sits on something still IN the document.
        expect(
            document.body.contains(document.activeElement),
            'focus was left on a node that is no longer on the page',
        ).toBe(true);
        expect(document.activeElement).toBe(announced);
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

/**
 * The two cases below used to assert the opposite of what they assert now, and
 * they were right both times: the panel must describe where the work actually
 * happens. It happened on a server, so "in your browser" was banned; it happens
 * in the visitor's own tab, so the claim of a transfer is what is banned.
 */
describe('ToolShell privacy line', () => {
    it('states where processing happens, truthfully', () => {
        renderShell();
        const note = screen.getByText(/never leaves your device/i);

        expect(note).toHaveTextContent('in this browser tab');
        expect(note).toHaveTextContent('No account, no watermark');
    });

    it('never claims the file is uploaded, stored or deleted afterwards', () => {
        const { container } = renderShell();

        expect(container.textContent).not.toMatch(/our servers?/i);
        expect(container.textContent).not.toMatch(/over https/i);
        expect(container.textContent).not.toMatch(/never kept/i);
        expect(container.textContent).not.toMatch(/deleted the moment/i);
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
