/**
 * PresetChips — the chip row itself, tested once because it has two callers.
 *
 * /resize's platform sizes and /crop's aspect ratios are now the same twelve
 * lines of markup. That is the point of the extraction and also its risk: a
 * regression in the toggle-off branch, or in aria-pressed, is now a regression
 * in BOTH tools, and neither tool's own test file is the place a reader would
 * look for it. So the interaction contract lives here, exercised against
 * injected fixture items rather than against either real registry.
 *
 * FIXTURE ITEMS, DELIBERATELY. Rendering SOCIAL_PRESETS or ASPECT_RATIOS here
 * would test the catalogue as much as the component, and it would hide the one
 * property most worth pinning: this component knows nothing about either
 * registry. Chips it was never handed must not appear — which is what fails if
 * somebody "helpfully" imports a default list into it.
 */
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import PresetChips from '@/components/tools/PresetChips';

const ITEMS = [
    { id: 'first', label: 'Square', detail: '1:1' },
    { id: 'second', label: 'Widescreen', detail: '16:9' },
    { id: 'third', label: 'Tall', detail: '9:16' },
];

function chips() {
    return within(screen.getByRole('group')).getAllByRole('button');
}

describe('the injected items are the whole row', () => {
    it('renders one chip per item, with its label and its detail', () => {
        render(<PresetChips label="Aspect ratio" items={ITEMS} value={null} onSelect={() => {}} />);

        expect(chips()).toHaveLength(ITEMS.length);

        for (const item of ITEMS) {
            const chip = screen.getByRole('button', { name: new RegExp(`${item.label}\\s*${item.detail}`) });
            expect(chip).toHaveTextContent(item.label);
            expect(chip).toHaveTextContent(item.detail);
        }
    });

    /**
     * The extraction's whole claim is that this component imports no
     * catalogue. A row that rendered a hard-coded list would still pass the
     * assertion above — every injected item would be present, just not alone.
     */
    it('renders nothing it was not handed', () => {
        render(<PresetChips label="Aspect ratio" items={ITEMS} value={null} onSelect={() => {}} />);

        const labels = chips().map((chip) => chip.textContent);
        expect(labels).toEqual(['Square1:1', 'Widescreen16:9', 'Tall9:16']);
    });

    it('renders an empty row without a chip and without throwing', () => {
        render(<PresetChips label="Aspect ratio" items={[]} value={null} onSelect={() => {}} />);

        expect(within(screen.getByRole('group')).queryAllByRole('button')).toHaveLength(0);
    });

    it('renders a label-only chip when an item carries no detail', () => {
        render(
            <PresetChips
                label="Aspect ratio"
                items={[{ id: 'only', label: 'Original' }]}
                value={null}
                onSelect={() => {}}
            />,
        );

        const [chip] = chips();
        expect(chip).toHaveTextContent('Original');
        expect(chip.textContent).toBe('Original');
    });
});

describe('which chip reads as chosen', () => {
    it('presses exactly the chip whose id is the value', () => {
        render(<PresetChips label="Aspect ratio" items={ITEMS} value="second" onSelect={() => {}} />);

        const pressed = chips().map((chip) => chip.getAttribute('aria-pressed'));
        expect(pressed).toEqual(['false', 'true', 'false']);
    });

    it('presses nothing when the value matches no item', () => {
        render(<PresetChips label="Aspect ratio" items={ITEMS} value="free-form" onSelect={() => {}} />);

        for (const chip of chips()) {
            expect(chip).toHaveAttribute('aria-pressed', 'false');
        }
    });

    it.each([
        ['null', null],
        ['undefined', undefined],
    ])('presses nothing when the value is %s', (_label, value) => {
        render(<PresetChips label="Aspect ratio" items={ITEMS} value={value} onSelect={() => {}} />);

        for (const chip of chips()) {
            expect(chip).toHaveAttribute('aria-pressed', 'false');
        }
    });
});

describe('choosing and unchoosing', () => {
    it('hands the whole item back when an unpressed chip is clicked', async () => {
        const user = userEvent.setup();
        const onSelect = vi.fn();
        render(<PresetChips label="Aspect ratio" items={ITEMS} value={null} onSelect={onSelect} />);

        await user.click(screen.getByRole('button', { name: /widescreen/i }));

        expect(onSelect).toHaveBeenCalledTimes(1);
        expect(onSelect).toHaveBeenCalledWith(ITEMS[1]);
    });

    /**
     * The toggle-off branch. /resize reads it as "back to free numbers" and
     * /crop as "back to free-form", and both depend on the argument being
     * null rather than the item again — a chip that re-selected itself would
     * leave the visitor no way out of a ratio without reloading.
     */
    it('hands back null when the pressed chip is clicked again', async () => {
        const user = userEvent.setup();
        const onSelect = vi.fn();
        render(<PresetChips label="Aspect ratio" items={ITEMS} value="second" onSelect={onSelect} />);

        await user.click(screen.getByRole('button', { name: /widescreen/i }));

        expect(onSelect).toHaveBeenCalledWith(null);
    });

    it('reaches every chip from the keyboard', async () => {
        const user = userEvent.setup();
        const onSelect = vi.fn();
        render(<PresetChips label="Aspect ratio" items={ITEMS} value={null} onSelect={onSelect} />);

        await user.tab();
        await user.tab();
        expect(document.activeElement).toBe(chips()[1]);

        await user.keyboard('{Enter}');
        expect(onSelect).toHaveBeenCalledWith(ITEMS[1]);
    });

    it('is a plain button, so a chip inside a form never submits it', () => {
        render(<PresetChips label="Aspect ratio" items={ITEMS} value={null} onSelect={() => {}} />);

        for (const chip of chips()) {
            expect(chip).toHaveAttribute('type', 'button');
        }
    });
});

describe('the group is named either way', () => {
    it('names the group and shows the label by default', () => {
        render(<PresetChips label="Aspect ratio" items={ITEMS} value={null} onSelect={() => {}} />);

        expect(screen.getByRole('group', { name: 'Aspect ratio' })).toBeInTheDocument();
        expect(screen.getByText('Aspect ratio')).toBeInTheDocument();
    });

    /**
     * labelHidden is what /resize uses: its disclosure toggle already says
     * "Platform sizes" on screen, so painting it twice would be a duplicate
     * heading — but a group with no accessible name is worse, so the name
     * stays and only the visible copy goes.
     */
    it('keeps the accessible name when the visible label is hidden', () => {
        render(
            <PresetChips label="Platform sizes" labelHidden items={ITEMS} value={null} onSelect={() => {}} />,
        );

        expect(screen.getByRole('group', { name: 'Platform sizes' })).toBeInTheDocument();
        expect(screen.queryByText('Platform sizes')).toBeNull();
    });
});

describe('a chip stays readable and reachable', () => {
    it('does not fade the detail on the active chip — white at 80% on accent measured 3.6:1', () => {
        render(<PresetChips label="Aspect ratio" items={ITEMS} value="second" onSelect={() => {}} />);

        const active = screen.getByRole('button', { pressed: true });
        const detail = within(active).getByText('16:9');
        expect(detail.className).not.toMatch(/opacity-/);
    });

    it('scrolls a chip fully into the row when it takes focus', () => {
        const scrollIntoView = vi.fn();
        Element.prototype.scrollIntoView = scrollIntoView;
        render(<PresetChips label="Aspect ratio" items={ITEMS} value={null} onSelect={() => {}} />);

        chips()[1].focus();

        expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest' });
    });
});
