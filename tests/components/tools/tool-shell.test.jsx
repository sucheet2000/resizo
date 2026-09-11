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
 * THE PRIVACY LINE IS THE TRUST STRIP NOW.
 *
 * These cases used to assert the opposite of what they assert now, and they
 * were right both times: the panel must describe where the work actually
 * happens. It happened on a server, so "in your browser" was banned; it happens
 * in the visitor's own tab, so the claim of a transfer is what is banned.
 *
 * What changed this time is the shape, not the claim. One sentence under the
 * panel said the same four things the homepage and the directory said in
 * slightly different words — three copies of one promise and three places for
 * it to drift. The shell renders the shared strip instead, so there is one
 * source for the wording and the panel still states where the file stays.
 */
describe('ToolShell privacy line', () => {
    it('states where processing happens, truthfully', () => {
        renderShell();
        const promises = screen.getByRole('list', { name: 'What Resizo promises' });

        expect(promises).toHaveTextContent(/on your device/i);
        expect(promises).toHaveTextContent(/no image upload/i);
        expect(promises).toHaveTextContent(/no account/i);
        expect(promises).toHaveTextContent(/no watermark/i);
    });

    it('says it once — no tool repeats the strip in its own words', () => {
        const { container } = renderShell();
        expect(container.querySelectorAll('ul[aria-label="What Resizo promises"]')).toHaveLength(1);
        expect(container.textContent.match(/on your device/gi)).toHaveLength(1);
    });

    it('still takes a note from a page with something extra to say', () => {
        renderShell({ privacyNote: 'A HEIC is decoded by code this page downloads.' });

        expect(screen.getByText('A HEIC is decoded by code this page downloads.')).toBeVisible();
        expect(screen.getByRole('list', { name: 'What Resizo promises' })).toBeInTheDocument();
    });

    it('never claims the file is uploaded, stored or deleted afterwards', () => {
        const { container } = renderShell();

        expect(container.textContent).not.toMatch(/our servers?/i);
        expect(container.textContent).not.toMatch(/over https/i);
        expect(container.textContent).not.toMatch(/never kept/i);
        expect(container.textContent).not.toMatch(/deleted the moment/i);
    });
});

/**
 * WHAT THE TOOL CHANGES, IN THE SAME PLACE ON EVERY PAGE.
 *
 * The spec block is rendered by the shell rather than by each tool for the
 * reason every other slot is: ten tools that each decided where to put it would
 * be ten pages a reader has to search. It sits between the paragraph that
 * answers the search and the page's own prose, which is where a visitor asks
 * the question — after "will this work" and before anything else.
 */
describe('ToolShell behaviour spec', () => {
    it('renders the block for the tool the shell is showing', () => {
        renderShell();
        expect(screen.getByRole('heading', { level: 2, name: 'What this tool changes' })).toBeVisible();
    });

    it('sits after the direct answer and before the page content', () => {
        const ANSWER = 'Name the size you need and the encoder finds the quality that fits it.';
        renderShell({ answer: ANSWER, children: <section data-testid="content">How this works</section> });

        const spec = screen.getByRole('heading', { level: 2, name: 'What this tool changes' });
        expect(isBefore(screen.getByText(ANSWER), spec)).toBe(true);
        expect(isBefore(spec, screen.getByTestId('content'))).toBe(true);
    });

    /**
     * An intent page pins the output format its tool would otherwise leave to
     * the visitor, and the spec block has to say the single thing that page
     * actually does rather than the two things the tool can do.
     */
    it('passes an intent’s preset through, which resolves the transparency row', () => {
        const { container, unmount } = render(<ToolShell slug="convert" title="Convert an image" />);
        expect(container.textContent).toMatch(/png and webp keep it/i);
        unmount();

        const pinned = render(<ToolShell slug="convert" title="PNG to JPG" preset={{ from: 'png', to: 'jpeg' }} />);
        expect(pinned.container.textContent).toMatch(/flattened onto the background colour/i);
        expect(pinned.container.textContent).not.toMatch(/png and webp keep it/i);
    });

    it('renders nothing for a shell with no slug, rather than an empty block', () => {
        render(<ToolShell title="Something else" />);
        expect(screen.queryByRole('heading', { name: 'What this tool changes' })).toBeNull();
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

    /**
     * AVIF ENCODE PROGRESS IS TWO FIXED STAGE NUMBERS, NOT A MEASUREMENT.
     *
     * The engine reports 65 then 95 for an AVIF encode — real stage markers,
     * not a continuous count — so a percentage or a bar tied to them would show
     * the visitor a number that means nothing and jumps without warning. The
     * label and the spinner still say the job is running; `hideProgress` just
     * stops this one case from claiming a precision it does not have.
     */
    describe('hideProgress', () => {
        it('shows neither a percentage nor a progressbar while processing', () => {
            render(<ToolAction label="Convert to AVIF" processingLabel="Encoding AVIF…" isProcessing progress={65} hideProgress />);
            const button = screen.getByRole('button');

            expect(button).toHaveTextContent('Encoding AVIF…');
            expect(button).not.toHaveTextContent('65%');
            expect(screen.queryByRole('progressbar')).toBeNull();
        });

        it('still disables the button and shows the spinner', () => {
            render(<ToolAction label="Convert to AVIF" processingLabel="Encoding AVIF…" isProcessing progress={65} hideProgress />);
            const button = screen.getByRole('button');

            expect(button).toBeDisabled();
            expect(button).toHaveAttribute('aria-busy', 'true');
        });

        it('does not affect a normal job — the default stays measured', () => {
            render(<ToolAction label="Compress image" isProcessing progress={40} />);
            const button = screen.getByRole('button');

            expect(button).toHaveTextContent('40%');
            expect(screen.getByRole('progressbar')).toBeInTheDocument();
        });
    });
});

describe('ToolAction — Cancel keeps the keyboard somewhere real', () => {
    // Cancel unmounts itself the moment the job stops, which dropped focus to
    // <body>: the next Tab skipped the re-enabled action (an audit finding on
    // /convert while "Encoding AVIF…"). The action button is where the visitor
    // started, so it is where they land.
    it('hands focus back to the action button after Cancel', async () => {
        const onCancel = vi.fn();
        const { rerender } = render(<ToolAction label="Convert" isProcessing onCancel={onCancel} />);

        const cancel = screen.getByRole('button', { name: 'Cancel' });
        cancel.focus();
        await userEvent.click(cancel);
        expect(onCancel).toHaveBeenCalledTimes(1);

        rerender(<ToolAction label="Convert" isProcessing={false} onCancel={onCancel} />);

        expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Convert' }));
    });
});
