/**
 * PlatformSizes — the /resize platform-size disclosure
 *
 * Below md the twelve platform sizes fold behind a keyboard-operable toggle so
 * they cost one line and never push the drop zone below a phone's fold; from md
 * up the panel is always open and the toggle is dropped. jsdom loads no CSS, so
 * the "always open from md up" half is pinned through the class contract
 * (md:block) rather than measured layout — the disclosure semantics
 * (aria-expanded, aria-controls, keyboard) are exercised for real.
 *
 * The chip row itself moved to components/tools/PresetChips.js, which /crop's
 * aspect-ratio chips now also render; this component is what still owns the
 * mobile toggle wrapped around it.
 */
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { PlatformSizes } from '@/app/(tools)/resize/ResizeSettings';
import { SOCIAL_PRESETS } from '@/lib/catalog';

function getToggle() {
    return screen.getByRole('button', { name: /platform sizes/i });
}

function getPanel() {
    return document.getElementById(getToggle().getAttribute('aria-controls'));
}

describe('PlatformSizes disclosure', () => {
    it('starts collapsed behind a toggle that controls the panel', () => {
        render(<PlatformSizes value={null} onSelect={() => {}} />);
        const toggle = getToggle();

        expect(toggle).toHaveAttribute('aria-expanded', 'false');
        expect(toggle).toHaveAttribute('aria-controls', 'resize-presets-panel');

        const panel = getPanel();
        expect(panel).not.toBeNull();
        expect(panel.className).toContain('hidden');
    });

    it('stays open from md up regardless of the toggle, via the class contract', () => {
        render(<PlatformSizes value={null} onSelect={() => {}} />);
        // Collapsed on mobile, but md:block forces the panel open on wider
        // screens — the crux of "open from md up".
        expect(getPanel().className).toMatch(/\bmd:block\b/);
    });

    it('opens and closes from the keyboard', async () => {
        const user = userEvent.setup();
        render(<PlatformSizes value={null} onSelect={() => {}} />);
        const toggle = getToggle();

        await user.tab();
        expect(toggle).toHaveFocus();

        await user.keyboard('{Enter}');
        expect(toggle).toHaveAttribute('aria-expanded', 'true');
        expect(getPanel().className).not.toContain('hidden');

        await user.keyboard(' ');
        expect(toggle).toHaveAttribute('aria-expanded', 'false');
        expect(getPanel().className).toContain('hidden');
    });

    it('renders every platform size as a chip', () => {
        render(<PlatformSizes value={null} onSelect={() => {}} />);
        const panel = getPanel();

        for (const preset of SOCIAL_PRESETS) {
            expect(within(panel).getByText(preset.label)).toBeInTheDocument();
        }
    });

    it('selects a preset, and clears it when the active one is pressed again', async () => {
        const user = userEvent.setup();
        const onSelect = vi.fn();
        const active = SOCIAL_PRESETS[0];

        // PresetChips carries every field the caller injected (id/label/width/
        // height/group) plus the `detail` string it renders, so the callback
        // argument is checked with objectContaining rather than exact equality.
        const { rerender } = render(<PlatformSizes value={null} onSelect={onSelect} />);
        await user.click(screen.getByRole('button', { name: new RegExp(active.label, 'i') }));
        expect(onSelect).toHaveBeenCalledWith(expect.objectContaining(active));

        rerender(<PlatformSizes value={active.id} onSelect={onSelect} />);
        await user.click(screen.getByRole('button', { name: new RegExp(active.label, 'i') }));
        expect(onSelect).toHaveBeenLastCalledWith(null);
    });
});
