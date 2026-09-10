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

    /**
     * The row used to be headed "Platform sizes", which told a visitor that all
     * twelve were rules. Five are not: Instagram publishes no story or
     * profile-picture size, X publishes a range of shapes and no pixel count,
     * and WhatsApp and Discord publish only a floor. The heading hedges now,
     * and the line under the row says which kind is which.
     *
     * This panel also renders on /resize-jpg, /resize-png and /resize-webp,
     * which have no sources section beneath them, so the line has to be true
     * on its own — it may not point at a section that is not there.
     */
    it('heads the row as common sizes rather than as platform rules', () => {
        render(<PlatformSizes value={null} onSelect={() => {}} />);

        expect(getToggle()).toHaveAccessibleName(/common platform sizes/i);
        expect(screen.getByRole('group', { name: 'Common platform sizes' })).toBeInTheDocument();
        expect(screen.queryByText('Platform sizes')).not.toBeInTheDocument();
    });

    it('says both what a platform size does and how much to trust it', () => {
        const { container } = render(<PlatformSizes value={null} onSelect={() => {}} />);
        const hint = [...container.querySelectorAll('p')]
            .map((node) => node.textContent.replace(/\s+/g, ' '))
            .find((text) => text.includes('overflow is trimmed'));

        expect(hint).toBeTruthy();
        expect(hint).toContain('A platform size fixes both sides, so the overflow is trimmed.');
        expect(hint).toMatch(/the platform’s own help page states/);
        expect(hint).toMatch(/common export sizes, not requirements/);
        // Self-contained: the intent pages render this panel with no sources
        // section under it, so the line may not send anyone "below".
        expect(hint).not.toMatch(/\bbelow\b|\bfurther down\b/i);
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

describe('PlatformSizes toggle: tap target', () => {
    it('is at least 44 px tall on a phone, via the class contract', () => {
        render(<PlatformSizes value={null} onSelect={() => {}} />);

        expect(getToggle().className).toMatch(/\bmin-h-11\b/);
    });
});
