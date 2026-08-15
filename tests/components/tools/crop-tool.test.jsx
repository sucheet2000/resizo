/**
 * /crop — what the panel says after the crop has run.
 *
 * Two defects lived here, both of them in the gap between "the job finished"
 * and "the four rectangle fields are still mounted and enabled".
 *
 *  1. The result panel was fed `width={rect.width} height={rect.height}` — the
 *     LIVE form — instead of the dimensions the engine returned. Typing in the
 *     Width field after a result silently rewrote the reported Size of a file
 *     that had already been produced from different numbers. The blob behind
 *     the Download button was always correct; the label lied about it.
 *
 *  2. Editing the rectangle did not clear the result, and ToolShell removes the
 *     submit action while a result exists. So the visitor could change the crop
 *     and have nothing on screen able to run it — and on /crop the dropzone has
 *     been replaced by a preview card by then, so the only way out was "Start
 *     over", which throws the source file away.
 *
 * useLocalProcess is stubbed, as it is for the other tool tests: what is under
 * test is what the page displays and when it offers to run, not the codecs.
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import CropTool from '@/app/(tools)/crop/CropTool';
import { ASPECT_RATIOS } from '@/lib/catalog';
import { centeredRectForRatio } from '@/lib/image/crop';
import { imageFile, setInputFiles, stubImageProbe } from '../helpers';

const harness = vi.hoisted(() => ({
    submit: null,
    setResult: null,
}));

vi.mock('@/lib/hooks/useLocalProcess', async () => {
    const { useState } = await import('react');

    return {
        default: function useStubbedProcess() {
            const [result, setResult] = useState(null);
            harness.setResult = setResult;

            return {
                submit: (...args) => harness.submit(...args),
                download: () => {},
                reset: () => setResult(null),
                cancel: () => {},
                isProcessing: false,
                progress: 0,
                error: null,
                result,
                setError: () => {},
                phase: null,
                suggestion: null,
            };
        },
    };
});

let probe;

beforeEach(() => {
    probe = stubImageProbe({ width: 1200, height: 800 });
    harness.submit = vi.fn();
    harness.setResult = null;
});

afterEach(() => {
    probe.restore();
});

/** The engine's answer: the crop it actually performed. */
const CROPPED = {
    blob: new Blob([new Uint8Array(8)], { type: 'image/jpeg' }),
    filename: 'resizo-cropped-photo.jpg',
    format: 'jpeg',
    sourceFormat: 'jpeg',
    width: 1200,
    height: 800,
    originalBytes: 500 * 1024,
    resultBytes: 1024,
};

/** Renders the tool and gets past the drop zone, so the rectangle controls exist. */
async function mountWithImage() {
    const view = render(<CropTool />);

    const input = document.getElementById('crop-file');
    setInputFiles(input, [imageFile('photo.jpg', 'jpeg', { size: 500 * 1024 })]);
    await act(async () => {
        input.dispatchEvent(new Event('change', { bubbles: true }));
    });

    return view;
}

async function withResult(payload = CROPPED) {
    const view = await mountWithImage();
    await act(async () => harness.setResult(payload));
    return view;
}

const widthField = () => screen.getByRole('spinbutton', { name: /^width$/i });
const submitButton = () => screen.queryByRole('button', { name: /^crop image$/i });

/** The four numbers the visitor can read off the form. */
function displayedRect() {
    const read = (name) => Number(screen.getByRole('spinbutton', { name }).value);
    return {
        x: read(/^x$/i),
        y: read(/^y$/i),
        width: read(/^width$/i),
        height: read(/^height$/i),
    };
}

/** The four numbers the engine was actually handed. */
function postedRect() {
    expect(harness.submit, 'nothing was submitted').toHaveBeenCalledTimes(1);
    const [form] = harness.submit.mock.calls[0];
    return {
        x: Number(form.get('crop_x')),
        y: Number(form.get('crop_y')),
        width: Number(form.get('crop_width')),
        height: Number(form.get('crop_height')),
    };
}

const chipFor = (ratio) => screen.getByRole('button', {
    name: new RegExp(`^${ratio.label}\\s*${ratio.ratio}$`),
});

describe('the size reported after a crop', () => {
    /**
     * Scoped to the result panel's own "Size" row on purpose. The overlay and
     * the "Keeping …" line are supposed to track the form live — that is what
     * makes the rectangle previewable. The result panel is the one place that
     * must describe the file already sitting behind the Download button.
     */
    function reportedSize(container) {
        const term = [...container.querySelectorAll('dt')].find(
            (node) => node.textContent.trim() === 'Size',
        );
        return term?.nextElementSibling?.textContent;
    }

    /**
     * The two fixes interact, which is worth stating because it changes how
     * this is tested. Now that editing the rectangle clears the result, the
     * panel unmounts before it can go stale — so the original reproduction
     * ("type 400 and watch the Size follow") no longer reaches the bug.
     *
     * The property still worth pinning is the one that does not depend on that:
     * the panel must describe the FILE, so its numbers must come from the
     * result even when the form says something else. Handing back a crop whose
     * dimensions differ from the rectangle on screen proves which one is read,
     * and keeps working if the reset behaviour ever changes.
     */
    it('reads its numbers from the result, not from the rectangle on screen', async () => {
        const { container } = await withResult({ ...CROPPED, width: 640, height: 480 });

        expect(widthField(), 'the form still holds the full-image rectangle').toHaveValue(1200);
        expect(
            reportedSize(container),
            'the panel reported the form rectangle instead of the crop that ran',
        ).toBe('640×480');
    });
});

describe('editing the rectangle after a crop', () => {
    it('brings the submit action back', async () => {
        await withResult();
        expect(submitButton(), 'precondition: the action is hidden while a result is shown').toBeNull();

        await act(async () => {
            fireEvent.change(widthField(), { target: { value: '400' } });
        });

        expect(
            submitButton(),
            'changed the crop with no control on screen able to run it',
        ).toBeInTheDocument();
    });

    /**
     * Same defect, second control. "Select the whole image" rewrote the
     * rectangle without clearing the result, so after a crop it left the
     * visitor in exactly the state the Width field used to: a changed
     * rectangle, a stale result panel, and no button able to run it. The
     * button reaching the whole image is not the property — the action
     * coming back is.
     */
    it('brings the submit action back after "Select the whole image"', async () => {
        const user = userEvent.setup();
        await withResult();
        expect(submitButton(), 'precondition: the action is hidden while a result is shown').toBeNull();

        await user.click(screen.getByRole('button', { name: /select the whole image/i }));

        expect(
            submitButton(),
            'selected the whole image with no control on screen able to run it',
        ).toBeInTheDocument();
    });

    it('brings the submit action back when a ratio chip is chosen', async () => {
        const user = userEvent.setup();
        await withResult();
        expect(submitButton(), 'precondition: the action is hidden while a result is shown').toBeNull();

        await user.click(chipFor(ASPECT_RATIOS[0]));

        expect(
            submitButton(),
            'chose a ratio with no control on screen able to run it',
        ).toBeInTheDocument();
    });
});

/**
 * THE WIRING. A chip is the only control that fills the four fields without the
 * visitor typing them, so it is the only one where the number on screen and the
 * number in the job can disagree silently. Nothing else in this suite would
 * notice: the overlay, the "Keeping …" line and the fields all read `rect`,
 * while handleSubmit reads it separately into a FormData — a chip that painted
 * 640×800 and posted the source's 1200×800 would look perfect and hand back a
 * file cropped to something else.
 *
 * The load-bearing assertion is therefore `posted` against `displayed`, both
 * read out of the rendered page, per chip. The comparison against
 * centeredRectForRatio is the second half: it pins that what is painted is the
 * fitted rectangle in the first place, so the pair cannot agree on the wrong
 * numbers.
 */
describe('an aspect-ratio chip posts the rectangle it paints', () => {
    const SOURCE = { width: 1200, height: 800 };

    it.each(ASPECT_RATIOS.map((ratio) => [ratio.ratio, ratio]))(
        '%s',
        async (_label, ratio) => {
            const user = userEvent.setup();
            await mountWithImage();

            await user.click(chipFor(ratio));

            const fitted = centeredRectForRatio(
                SOURCE.width,
                SOURCE.height,
                ratio.ratioWidth,
                ratio.ratioHeight,
            );
            const displayed = displayedRect();

            expect(displayed, 'the fields show something other than the fitted rectangle').toEqual(fitted.rect);
            expect(screen.getByText(/^Keeping/).textContent.replace(/\s+/g, ' ')).toBe(
                `Keeping ${displayed.width}×${displayed.height} from x ${displayed.x}, y ${displayed.y}`,
            );

            await user.click(submitButton());

            expect(postedRect(), 'the job carries a different rectangle from the one on screen')
                .toEqual(displayed);
        },
    );

    /**
     * The self-check for the sweep above: on a 1200×800 source most chips must
     * move the rectangle off the whole image, or "post the source dimensions"
     * would satisfy every case. 3:2 is deliberately among them — that source IS
     * 3:2, so its chip legitimately keeps the whole image.
     */
    it('moves the rectangle off the whole image for all but the source ratio', async () => {
        const user = userEvent.setup();
        const changed = [];

        for (const ratio of ASPECT_RATIOS) {
            const view = await mountWithImage();
            await user.click(chipFor(ratio));
            const rect = displayedRect();
            if (rect.width !== SOURCE.width || rect.height !== SOURCE.height) changed.push(ratio.ratio);
            view.unmount();
        }

        expect(changed).toEqual(['1:1', '4:3', '4:5', '16:9', '9:16']);
    });

    /** The same property with the numbers written out, as a reader's anchor. */
    it('posts 640×800 from x 280 for a 4:5 chip on a 1200×800 photo', async () => {
        const user = userEvent.setup();
        await mountWithImage();

        await user.click(chipFor(ASPECT_RATIOS.find((ratio) => ratio.ratio === '4:5')));
        await user.click(submitButton());

        expect(postedRect()).toEqual({ x: 280, y: 0, width: 640, height: 800 });
    });

    /**
     * The chip is a claim about the rectangle, so it has to stop being pressed
     * the moment the rectangle stops matching it. Otherwise a visitor types a
     * width, the fields say 400 and the chip still says 4:5 — and the chip is
     * the thing they will believe.
     */
    it.each([
        ['a field is typed into', async () => {
            await act(async () => {
                fireEvent.change(widthField(), { target: { value: '400' } });
            });
        }],
        ['the whole image is selected', async (user) => {
            await user.click(screen.getByRole('button', { name: /select the whole image/i }));
        }],
    ])('un-presses the chip once %s', async (_label, mutate) => {
        const user = userEvent.setup();
        await mountWithImage();
        const ratio = ASPECT_RATIOS.find((entry) => entry.ratio === '4:5');

        await user.click(chipFor(ratio));
        expect(chipFor(ratio)).toHaveAttribute('aria-pressed', 'true');

        await mutate(user);

        expect(chipFor(ratio), 'the chip still claims a ratio the rectangle no longer has')
            .toHaveAttribute('aria-pressed', 'false');
    });

    /**
     * X AND Y MOVE THE FRAME; THEY DO NOT CHANGE THE SHAPE.
     *
     * The reviewer caught this as a contradiction between the code and the
     * shipped copy: /crop's page says "move the frame off centre with X and Y
     * and the shape is unchanged", and the FAQ says "you can move it afterwards
     * with X and Y" — but all four fields cleared the chip, so following that
     * instruction made the 4:5 chip go dark on a rectangle that was still 4:5.
     *
     * The chip is a claim about the SHAPE. Only Width and Height can falsify
     * it. Fixing the code rather than the copy is the right way round: the copy
     * was describing the behaviour a visitor would expect.
     */
    it.each([['x'], ['y']])('keeps the chip pressed when %s moves the frame', async (field) => {
        const user = userEvent.setup();
        await mountWithImage();
        const ratio = ASPECT_RATIOS.find((entry) => entry.ratio === '4:5');

        const sides = () => [
            screen.getByRole('spinbutton', { name: /^width$/i }).value,
            screen.getByRole('spinbutton', { name: /^height$/i }).value,
        ];

        await user.click(chipFor(ratio));
        const before = sides();

        await act(async () => {
            fireEvent.change(screen.getByRole('spinbutton', { name: new RegExp(`^${field}$`, 'i') }), {
                target: { value: '10' },
            });
        });

        expect(chipFor(ratio), 'moving the frame does not change its shape')
            .toHaveAttribute('aria-pressed', 'true');

        // And the shape really is unchanged — only the origin moved.
        expect(sides()).toEqual(before);
    });

    /**
     * Clicking the pressed chip is the way back to free-form. It gives up the
     * claim without giving up the rectangle — re-fitting or resetting it here
     * would throw away a crop the visitor had just chosen.
     */
    it('lets the pressed chip be switched off, keeping the rectangle it produced', async () => {
        const user = userEvent.setup();
        await mountWithImage();
        const ratio = ASPECT_RATIOS.find((entry) => entry.ratio === '4:5');

        await user.click(chipFor(ratio));
        const chosen = displayedRect();

        await user.click(chipFor(ratio));

        expect(chipFor(ratio)).toHaveAttribute('aria-pressed', 'false');
        expect(displayedRect()).toEqual(chosen);
    });

    it('presses one chip at a time', async () => {
        const user = userEvent.setup();
        await mountWithImage();

        await user.click(chipFor(ASPECT_RATIOS[0]));
        await user.click(chipFor(ASPECT_RATIOS[4]));

        const pressed = ASPECT_RATIOS.filter(
            (ratio) => chipFor(ratio).getAttribute('aria-pressed') === 'true',
        );
        expect(pressed.map((ratio) => ratio.ratio)).toEqual([ASPECT_RATIOS[4].ratio]);
    });

    it('sends the measured source dimensions with the job, so the memory gate can cost it', async () => {
        const user = userEvent.setup();
        await mountWithImage();

        await user.click(chipFor(ASPECT_RATIOS[0]));
        await user.click(submitButton());

        expect(harness.submit.mock.calls[0][1]).toMatchObject({
            sourceWidth: SOURCE.width,
            sourceHeight: SOURCE.height,
        });
    });
});

/**
 * boundsError — the refusal the panel shows for a rectangle that leaves the
 * image. It is computed in the component and never reached the engine, so no
 * lib test covers it: the numbers in the sentence, and the disabling of the
 * action, are only observable here.
 */
describe('a rectangle that leaves the image', () => {
    const OUTSIDE = /That region falls outside the image\. It has to fit inside 1200×800 pixels/;

    async function setField(name, value) {
        await act(async () => {
            fireEvent.change(screen.getByRole('spinbutton', { name }), { target: { value } });
        });
    }

    it('says nothing while the rectangle still fits', async () => {
        await mountWithImage();

        expect(screen.queryByRole('alert')).toBeNull();
        expect(submitButton()).toBeEnabled();
    });

    it('accepts the rectangle that exactly fills the image', async () => {
        await mountWithImage();
        await setField(/^width$/i, '1200');
        await setField(/^height$/i, '800');

        expect(screen.queryByRole('alert')).toBeNull();
        expect(submitButton()).toBeEnabled();
    });

    it.each([
        ['one pixel too wide', /^width$/i, '1201'],
        ['one pixel too tall', /^height$/i, '801'],
        ['offset one pixel past the right edge', /^x$/i, '1'],
        ['offset one pixel past the bottom edge', /^y$/i, '1'],
        ['a width of zero', /^width$/i, '0'],
        ['a width cleared to nothing', /^width$/i, ''],
        ['a width that is not a number', /^width$/i, 'abc'],
    ])('refuses %s, naming the size it has to fit', async (_label, name, value) => {
        await mountWithImage();
        await setField(name, value);

        expect(screen.getByRole('alert')).toHaveTextContent(OUTSIDE);
        expect(submitButton()).toBeDisabled();
    });

    it('sends nothing when the visitor clicks through a bad rectangle', async () => {
        const user = userEvent.setup();
        await mountWithImage();
        await setField(/^width$/i, '5000');

        await user.click(submitButton()).catch(() => {});

        expect(harness.submit, 'a refused rectangle reached the engine').not.toHaveBeenCalled();
    });

    it('clears the refusal once the rectangle fits again', async () => {
        await mountWithImage();
        await setField(/^width$/i, '5000');
        expect(screen.getByRole('alert')).toBeInTheDocument();

        await setField(/^width$/i, '1200');

        expect(screen.queryByRole('alert')).toBeNull();
        expect(submitButton()).toBeEnabled();
    });

    it('says nothing before a file is chosen, when there is no image to be outside of', () => {
        render(<CropTool />);

        expect(screen.queryByRole('alert')).toBeNull();
    });
});
