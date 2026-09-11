/**
 * TransparencyBackground — the control, and the rule about when it appears.
 *
 * The engine composites a transparent pixel onto WHITE, because what this
 * control actually gets used on is a logo or a signature headed for a document
 * or a form, and those sit on a white page. Black is what a missing alpha
 * channel looks like when it has gone wrong; it stays on the list because a
 * white mark or a dark screenshot wants it, but it is no longer what a visitor
 * gets by saying nothing.
 *
 * THE ORDER OF THE PRESETS IS THE DEFAULT. The panel renders the engine's own
 * list and the custom picker seeds itself from the white entry, so the check
 * below reads the default out of the engine rather than repeating it here — a
 * copy of the default in a test is the thing that lets the two drift apart.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import TransparencyBackground from '@/components/tools/TransparencyBackground';
import { BACKGROUND_PRESETS } from '@/lib/image-client/flatten';

/** The colour a caller that has chosen nothing will be holding. */
const DEFAULT_VALUE = BACKGROUND_PRESETS[0].value;

function renderControl(value = DEFAULT_VALUE) {
    const onChange = vi.fn();
    render(<TransparencyBackground value={value} onChange={onChange} />);
    return onChange;
}

describe('the choices offered', () => {
    it('offers black, white and a custom colour', () => {
        renderControl();

        expect(screen.getByRole('radio', { name: /black/i })).toBeInTheDocument();
        expect(screen.getByRole('radio', { name: /white/i })).toBeInTheDocument();
        expect(screen.getByRole('radio', { name: /custom/i })).toBeInTheDocument();
    });

    it('takes its presets from the engine, so the two cannot drift', () => {
        renderControl();

        for (const preset of BACKGROUND_PRESETS) {
            expect(screen.getByRole('radio', { name: new RegExp(preset.label, 'i') })).toBeInTheDocument();
        }
    });

    it('starts on white, which is what the engine and the page copy both say', () => {
        expect(DEFAULT_VALUE, 'the engine no longer leads with white').toBe('white');

        renderControl();

        expect(screen.getByRole('radio', { name: /white/i })).toBeChecked();
        expect(screen.getByRole('radio', { name: /black/i })).not.toBeChecked();
    });

    /**
     * Both halves, in one sentence: what JPEG cannot do, and what this control
     * therefore does to the picture. The first half alone leaves a visitor
     * knowing there is a problem and not what the radios will do about it.
     */
    it('explains why the choice exists at all, and what it does', () => {
        renderControl();

        const line = screen.getByText(/cannot store transparency/i);

        expect(line).toBeInTheDocument();
        expect(line.textContent).toMatch(/filled with this colour/i);
    });
});

describe('choosing', () => {
    it('reports the named colour', async () => {
        const user = userEvent.setup();
        const onChange = renderControl('white');

        await user.click(screen.getByRole('radio', { name: /black/i }));

        expect(onChange).toHaveBeenCalledWith('black');
    });

    it('hides the colour picker until custom is chosen', async () => {
        const user = userEvent.setup();
        const onChange = renderControl('black');

        expect(screen.queryByLabelText(/custom colour/i)).toBeNull();

        await user.click(screen.getByRole('radio', { name: /^custom$/i }));

        // The control is stateless: it reports a hex and the caller re-renders.
        expect(onChange).toHaveBeenCalledWith('#ffffff');
    });

    it('shows the picker and keeps the colour once one is held', () => {
        renderControl('#3366ff');

        expect(screen.getByRole('radio', { name: /^custom$/i })).toBeChecked();
        expect(screen.getByLabelText(/custom colour/i)).toHaveValue('#3366ff');
    });

    it('treats a hex value as custom rather than as an unknown preset', () => {
        renderControl('#ff0000');

        expect(screen.getByRole('radio', { name: /black/i })).not.toBeChecked();
        expect(screen.getByRole('radio', { name: /white/i })).not.toBeChecked();
        expect(screen.getByRole('radio', { name: /^custom$/i })).toBeChecked();
    });
});

describe('the group is a real fieldset', () => {
    it('is labelled, so a screen reader announces what the radios are for', () => {
        renderControl();

        expect(screen.getByRole('group', { name: /transparent areas become/i })).toBeInTheDocument();
    });

    it('gives every instance its own radio name, so two on a page do not fight', () => {
        const { unmount } = render(<TransparencyBackground value="black" onChange={() => {}} />);
        const first = screen.getByRole('radio', { name: /black/i }).getAttribute('name');
        unmount();

        render(<TransparencyBackground value="black" onChange={() => {}} />);
        const second = screen.getByRole('radio', { name: /black/i }).getAttribute('name');

        expect(first).toBeTruthy();
        expect(second).not.toBe(first);
    });
});

/**
 * allowTransparent — added for /favicon-generator, where a background is a
 * genuine third choice rather than a fallback for a format with no alpha
 * channel. Off by default, so every existing caller (FitTool, PrintSheetTool,
 * BulkConvertTool) is provably unchanged by every test above this line.
 */
describe('allowTransparent', () => {
    it('adds no Transparent option when the prop is left off', () => {
        renderControl();
        expect(screen.queryByRole('radio', { name: /^transparent$/i })).toBeNull();
    });

    it('prepends a Transparent option, before White', () => {
        const onChange = vi.fn();
        render(<TransparencyBackground value="transparent" onChange={onChange} allowTransparent />);

        const radios = screen.getAllByRole('radio');
        expect(radios[0]).toHaveAccessibleName(/^transparent$/i);
        expect(radios[0]).toBeChecked();
        expect(screen.getByRole('radio', { name: /^white$/i })).toBeInTheDocument();
        expect(screen.getByRole('radio', { name: /^black$/i })).toBeInTheDocument();
        expect(screen.getByRole('radio', { name: /^custom$/i })).toBeInTheDocument();
    });

    it('reports "transparent" when that option is chosen', async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        render(<TransparencyBackground value="white" onChange={onChange} allowTransparent />);

        await user.click(screen.getByRole('radio', { name: /^transparent$/i }));

        expect(onChange).toHaveBeenCalledWith('transparent');
    });

    it('marks the Transparent swatch with the checkerboard texture rather than a solid fill', () => {
        render(<TransparencyBackground value="transparent" onChange={() => {}} allowTransparent />);

        const radio = screen.getByRole('radio', { name: /^transparent$/i });
        const swatch = radio.closest('label').querySelector('[aria-hidden="true"]');
        expect(swatch).toHaveClass('checkerboard');
        expect(swatch).not.toHaveAttribute('style');
    });

    it('does not treat "transparent" as an unrecognised value needing the custom picker', () => {
        render(<TransparencyBackground value="transparent" onChange={() => {}} allowTransparent />);
        expect(screen.queryByLabelText(/custom colour/i)).toBeNull();
        expect(screen.getByRole('radio', { name: /^custom$/i })).not.toBeChecked();
    });

    it('still offers black, white and custom underneath', () => {
        render(<TransparencyBackground value="transparent" onChange={() => {}} allowTransparent />);
        for (const preset of BACKGROUND_PRESETS) {
            expect(screen.getByRole('radio', { name: new RegExp(`^${preset.label}$`, 'i') })).toBeInTheDocument();
        }
    });
});

/**
 * An explicit `id` — /favicon-generator needs a literal, predictable name for
 * its E2E contract (`icon-background`), rather than the per-instance id every
 * other caller is happy to let useId() invent.
 */
describe('an explicit id', () => {
    it('names every radio in the group with it, instead of an auto-generated id', () => {
        render(<TransparencyBackground id="icon-background" value="white" onChange={() => {}} allowTransparent />);

        for (const radio of screen.getAllByRole('radio')) {
            expect(radio).toHaveAttribute('name', 'icon-background');
        }
    });

    it('builds the custom colour field id from it', () => {
        // A held custom value, exactly like "shows the picker and keeps the
        // colour once one is held" above — the control is stateless, so a
        // no-op onChange from a click can never re-reveal the picker itself.
        render(<TransparencyBackground id="icon-background" value="#112233" onChange={() => {}} allowTransparent />);

        expect(document.getElementById('icon-background-custom')).toBe(screen.getByLabelText(/custom colour/i));
    });

    it('falls back to an auto-generated id when none is given, exactly as before', () => {
        render(<TransparencyBackground value="black" onChange={() => {}} />);
        const name = screen.getByRole('radio', { name: /^black$/i }).getAttribute('name');
        expect(name).toBeTruthy();
        expect(name).not.toBe('icon-background');
    });
});
