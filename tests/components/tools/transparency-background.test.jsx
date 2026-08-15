/**
 * TransparencyBackground — the control, and the rule about when it appears.
 *
 * The engine composites a transparent pixel onto black, which is what libvips
 * does and what the pages promise. Black is right for a photograph and wrong
 * for a logo, and only the visitor knows which they have — so the choice is
 * offered and the DEFAULT DOES NOT MOVE. A test that let the default drift to
 * white would quietly falsify /png-to-jpg and /resize-png, both of which say in
 * as many words that the fill is black.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import TransparencyBackground from '@/components/tools/TransparencyBackground';
import { BACKGROUND_PRESETS } from '@/lib/image-client/flatten';

function renderControl(value = 'black') {
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

    it('starts on black, which is what the engine and the page copy both say', () => {
        renderControl();

        expect(screen.getByRole('radio', { name: /black/i })).toBeChecked();
        expect(screen.getByRole('radio', { name: /white/i })).not.toBeChecked();
    });

    it('explains why the choice exists at all', () => {
        renderControl();

        expect(screen.getByText(/cannot store transparency/i)).toBeInTheDocument();
    });
});

describe('choosing', () => {
    it('reports the named colour', async () => {
        const user = userEvent.setup();
        const onChange = renderControl('black');

        await user.click(screen.getByRole('radio', { name: /white/i }));

        expect(onChange).toHaveBeenCalledWith('white');
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
