/**
 * FrameCrop — tested purely through rendering and interaction, the same way
 * PresetChips and every other tools/ component is: no reaching into internal
 * rectangle maths, because the contract is what a caller can observe (the
 * rect handed to onChange, the DOM, the aria-live sentence).
 *
 * `Controlled` stands in for the real caller (PassportTool): FrameCrop takes
 * `value`/`onChange` like a controlled input and does not remember the
 * rectangle itself, so a test that never feeds a change back through `value`
 * would only ever see the very first computed rectangle.
 *
 * Source is a fixed 1200x1600 portrait photo against a square (aspect 1)
 * target throughout, so "the largest centred square inside it" is always
 * 1200x1200 at (0, 200) and the arithmetic in each test can be checked by
 * hand against that one fixed case.
 */
import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import FrameCrop from '@/components/tools/FrameCrop';

const SOURCE_WIDTH = 1200;
const SOURCE_HEIGHT = 1600;
const ASPECT = 1;
const COVER_RECT = { x: 0, y: 200, width: 1200, height: 1200 };

function Controlled({
    onChangeSpy,
    initialValue = null,
    guides,
    sourceWidth = SOURCE_WIDTH,
    sourceHeight = SOURCE_HEIGHT,
    aspect = ASPECT,
    label = 'Position your photo inside the frame',
    id = 'test-frame',
}) {
    const [value, setValue] = useState(initialValue);
    return (
        <FrameCrop
            src="blob:mock"
            sourceWidth={sourceWidth}
            sourceHeight={sourceHeight}
            aspect={aspect}
            value={value}
            onChange={(rect) => {
                setValue(rect);
                onChangeSpy?.(rect);
            }}
            guides={guides}
            label={label}
            id={id}
        />
    );
}

function frame() {
    return screen.getByRole('group');
}

/** jsdom performs no layout, so every element reports a 0x0 rect by default. */
function mockFrameSize(width, height = width) {
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
        width,
        height,
        top: 0,
        left: 0,
        right: width,
        bottom: height,
        x: 0,
        y: 0,
        toJSON() {},
    });
}

describe('the initial rectangle', () => {
    it('covers the frame with the largest centred rectangle of the target aspect, and reports it once', () => {
        const onChangeSpy = vi.fn();
        render(<Controlled onChangeSpy={onChangeSpy} />);

        expect(onChangeSpy).toHaveBeenCalledTimes(1);
        expect(onChangeSpy).toHaveBeenCalledWith(COVER_RECT);
    });

    it('does not call onChange when a value is already provided', () => {
        const onChangeSpy = vi.fn();
        render(<Controlled onChangeSpy={onChangeSpy} initialValue={{ x: 10, y: 20, width: 400, height: 400 }} />);

        expect(onChangeSpy).not.toHaveBeenCalled();
    });
});

describe('structure and labelling', () => {
    it('names the frame group from the label prop and makes it keyboard-reachable', () => {
        render(<Controlled label="Position your photo inside the frame" initialValue={COVER_RECT} />);

        const group = screen.getByRole('group', { name: 'Position your photo inside the frame' });
        expect(group).toHaveAttribute('tabIndex', '0');
    });

    it('marks the preview image as decorative, since the group already carries the description', () => {
        const { container } = render(<Controlled initialValue={COVER_RECT} />);

        const img = container.querySelector('img');
        expect(img).not.toBeNull();
        expect(img).toHaveAttribute('alt', '');
    });

    it('states what it is keeping, from the source pixels, in an aria-live sentence', () => {
        render(<Controlled initialValue={{ x: 10, y: 20, width: 400, height: 400 }} />);

        expect(screen.getByText('Keeping 400×400 pixels from 10, 20')).toHaveAttribute('aria-live', 'polite');
    });
});

describe('zoom', () => {
    it('is a range input labelled Zoom, from 1 to 4 in 0.05 steps', () => {
        render(<Controlled initialValue={COVER_RECT} />);

        const slider = screen.getByRole('slider', { name: 'Zoom' });
        expect(slider).toHaveAttribute('type', 'range');
        expect(slider).toHaveAttribute('min', '1');
        expect(slider).toHaveAttribute('max', '4');
        expect(slider).toHaveAttribute('step', '0.05');
    });

    it('shrinks the rectangle around its own centre when zoomed in', () => {
        const onChangeSpy = vi.fn();
        render(<Controlled onChangeSpy={onChangeSpy} initialValue={COVER_RECT} />);

        fireEvent.change(screen.getByRole('slider', { name: 'Zoom' }), { target: { value: '2' } });

        // Centre of the cover rect is (600, 800); zoom 2 halves each side.
        expect(onChangeSpy).toHaveBeenLastCalledWith({ x: 300, y: 500, width: 600, height: 600 });
    });

    it('"Zoom in" shrinks the rectangle and "Zoom out" grows it back', async () => {
        const user = userEvent.setup();
        const onChangeSpy = vi.fn();
        render(<Controlled onChangeSpy={onChangeSpy} initialValue={COVER_RECT} />);

        await user.click(screen.getByRole('button', { name: 'Zoom in' }));
        const zoomedInWidth = onChangeSpy.mock.calls.at(-1)[0].width;
        expect(zoomedInWidth).toBeLessThan(COVER_RECT.width);

        await user.click(screen.getByRole('button', { name: 'Zoom out' }));
        const backOutWidth = onChangeSpy.mock.calls.at(-1)[0].width;
        expect(backOutWidth).toBeGreaterThan(zoomedInWidth);
    });

    it('disables "Zoom out" at the cover size and "Zoom in" at the 4x limit', () => {
        const { unmount } = render(<Controlled initialValue={COVER_RECT} />);
        expect(screen.getByRole('button', { name: 'Zoom out' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Zoom in' })).not.toBeDisabled();
        unmount();

        // A fresh instance, not a rerender of the same one: Controlled's
        // useState(initialValue) only reads its initial value on mount, so
        // reusing the first instance would silently keep the cover rect.
        render(<Controlled initialValue={{ x: 450, y: 650, width: 300, height: 300 }} />);
        expect(screen.getByRole('button', { name: 'Zoom in' })).toBeDisabled();
    });

    it('"Reset" returns to the initial cover rectangle after zooming and moving', async () => {
        const user = userEvent.setup();
        const onChangeSpy = vi.fn();
        render(<Controlled onChangeSpy={onChangeSpy} initialValue={{ x: 450, y: 650, width: 300, height: 300 }} />);

        await user.click(screen.getByRole('button', { name: 'Reset' }));

        expect(onChangeSpy).toHaveBeenLastCalledWith(COVER_RECT);
    });
});

describe('keyboard nudging', () => {
    it('moves the photo the way a drag does: ArrowRight slides it right, so the kept window moves 2% left', () => {
        const onChangeSpy = vi.fn();
        render(<Controlled onChangeSpy={onChangeSpy} initialValue={{ x: 500, y: 500, width: 400, height: 400 }} />);

        fireEvent.keyDown(frame(), { key: 'ArrowRight' });

        expect(onChangeSpy).toHaveBeenLastCalledWith({ x: 492, y: 500, width: 400, height: 400 });
    });

    it('moves 10% of its own size when Shift is held', () => {
        const onChangeSpy = vi.fn();
        render(<Controlled onChangeSpy={onChangeSpy} initialValue={{ x: 500, y: 500, width: 400, height: 400 }} />);

        fireEvent.keyDown(frame(), { key: 'ArrowDown', shiftKey: true });

        expect(onChangeSpy).toHaveBeenLastCalledWith({ x: 500, y: 460, width: 400, height: 400 });
    });

    it('clamps at the source bounds rather than moving the rectangle outside them', () => {
        const onChangeSpy = vi.fn();
        render(<Controlled onChangeSpy={onChangeSpy} initialValue={COVER_RECT} />);

        fireEvent.keyDown(frame(), { key: 'ArrowRight' });

        expect(onChangeSpy).toHaveBeenLastCalledWith(COVER_RECT);
    });

    it('ignores keys other than the four arrows', () => {
        const onChangeSpy = vi.fn();
        render(<Controlled onChangeSpy={onChangeSpy} initialValue={{ x: 500, y: 500, width: 400, height: 400 }} />);

        fireEvent.keyDown(frame(), { key: 'a' });

        expect(onChangeSpy).not.toHaveBeenCalled();
    });
});

describe('pointer drag', () => {
    it('drags the photo: moving the pointer right and down reveals more of the top-left', () => {
        mockFrameSize(400);
        const onChangeSpy = vi.fn();
        render(<Controlled onChangeSpy={onChangeSpy} initialValue={{ x: 500, y: 500, width: 400, height: 400 }} />);

        const el = frame();
        fireEvent.pointerDown(el, { pointerId: 1, clientX: 200, clientY: 200 });
        fireEvent.pointerMove(el, { pointerId: 1, clientX: 240, clientY: 220 });
        fireEvent.pointerUp(el, { pointerId: 1, clientX: 240, clientY: 220 });

        // Frame is 400 screen px for a 400 source-px window: scale 1. Dragging
        // +40, +20 on screen moves the visible window -40, -20 in source space.
        expect(onChangeSpy).toHaveBeenLastCalledWith({ x: 460, y: 480, width: 400, height: 400 });
    });

    it('clamps a drag that would push the rectangle past the source bounds', () => {
        mockFrameSize(800);
        const onChangeSpy = vi.fn();
        render(<Controlled onChangeSpy={onChangeSpy} initialValue={{ x: 100, y: 300, width: 800, height: 800 }} />);

        const el = frame();
        fireEvent.pointerDown(el, { pointerId: 1, clientX: 0, clientY: 0 });
        fireEvent.pointerMove(el, { pointerId: 1, clientX: -1000, clientY: -1000 });

        expect(onChangeSpy).toHaveBeenLastCalledWith({ x: 400, y: 800, width: 800, height: 800 });
    });

    it('does nothing on pointermove before a pointerdown, or after pointerup', () => {
        mockFrameSize(400);
        const onChangeSpy = vi.fn();
        render(<Controlled onChangeSpy={onChangeSpy} initialValue={{ x: 500, y: 500, width: 400, height: 400 }} />);

        const el = frame();
        fireEvent.pointerMove(el, { pointerId: 1, clientX: 999, clientY: 999 });
        expect(onChangeSpy).not.toHaveBeenCalled();

        fireEvent.pointerDown(el, { pointerId: 1, clientX: 0, clientY: 0 });
        fireEvent.pointerUp(el, { pointerId: 1, clientX: 10, clientY: 10 });
        fireEvent.pointerMove(el, { pointerId: 1, clientX: 999, clientY: 999 });
        expect(onChangeSpy).not.toHaveBeenCalled();
    });

    it('ignores a pointermove from a different pointer than the one that started the drag', () => {
        mockFrameSize(400);
        const onChangeSpy = vi.fn();
        render(<Controlled onChangeSpy={onChangeSpy} initialValue={{ x: 500, y: 500, width: 400, height: 400 }} />);

        const el = frame();
        fireEvent.pointerDown(el, { pointerId: 1, clientX: 0, clientY: 0 });
        fireEvent.pointerMove(el, { pointerId: 2, clientX: 999, clientY: 999 });

        expect(onChangeSpy).not.toHaveBeenCalled();
    });
});

describe('wheel', () => {
    it('does nothing on a wheel event', () => {
        const onChangeSpy = vi.fn();
        render(<Controlled onChangeSpy={onChangeSpy} initialValue={{ x: 500, y: 500, width: 400, height: 400 }} />);

        fireEvent.wheel(frame(), { deltaY: 100 });

        expect(onChangeSpy).not.toHaveBeenCalled();
    });
});

describe('guides', () => {
    const GUIDES = [
        { kind: 'official', label: 'Head 25–35 mm', from: 0.3, to: 0.55 },
        { kind: 'guidance', label: 'Eyes near the centre', from: 0.4, to: 0.42 },
    ];

    it('renders each guide as an aria-hidden band plus a visible legend line', () => {
        const { container } = render(<Controlled initialValue={COVER_RECT} guides={GUIDES} />);

        const svg = container.querySelector('svg[aria-hidden="true"]');
        expect(svg).not.toBeNull();
        // One outline rect plus one band rect per guide.
        expect(svg.querySelectorAll('rect')).toHaveLength(GUIDES.length + 1);

        expect(screen.getByText('Official requirement: Head 25–35 mm')).toBeInTheDocument();
        expect(screen.getByText('Guidance: Eyes near the centre')).toBeInTheDocument();
    });

    it('renders no legend when there are no guides', () => {
        render(<Controlled initialValue={COVER_RECT} guides={[]} />);

        expect(screen.queryByText(/Official requirement:|Guidance:/)).toBeNull();
    });
});

describe('what a screen reader and a keyboard are told', () => {
    it('announces the whole sentence at once, as one text node', () => {
        render(<Controlled initialValue={{ x: 500, y: 500, width: 400, height: 400 }} />);
        const live = screen.getByText(/^Keeping 400×400 pixels from 500, 500$/);
        expect(live).toHaveAttribute('aria-live', 'polite');
        expect(live).toHaveAttribute('aria-atomic', 'true');
        expect(live.childNodes).toHaveLength(1);
    });

    it('carries a visible hint the frame is described by, and names its keys', () => {
        render(<Controlled initialValue={{ x: 500, y: 500, width: 400, height: 400 }} />);
        const hint = screen.getByText(/arrow keys/i);
        expect(frame()).toHaveAttribute('aria-describedby', hint.id);
        expect(frame()).toHaveAttribute('aria-keyshortcuts', expect.stringContaining('ArrowRight'));
        expect(frame()).toHaveAttribute('aria-roledescription');
    });

    it('swallows Space so the page does not scroll under the frame', () => {
        render(<Controlled initialValue={{ x: 500, y: 500, width: 400, height: 400 }} />);
        const notPrevented = fireEvent.keyDown(frame(), { key: ' ' });
        expect(notPrevented).toBe(false);
    });

    it('reads the zoom out as a magnification, and gives the slider a 44 px hit area', () => {
        render(<Controlled initialValue={{ x: 500, y: 500, width: 400, height: 400 }} />);
        const slider = screen.getByRole('slider', { name: 'Zoom' });
        expect(slider).toHaveAttribute('aria-valuetext', expect.stringMatching(/×|times/));
        expect(slider.className).toMatch(/\bmin-h-11\b/);
    });
});
