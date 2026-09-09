/**
 * /signature-resizer — the workflow a form makes somebody perform by hand.
 *
 * A signature goes onto an application form under three constraints at once: an
 * exact pixel size, a shape that is almost never the shape of the scan, and a
 * byte ceiling. Doing that with three separate tools is what this page exists to
 * replace, so the properties worth pinning here are the ones that live in the
 * SEAMS between those three jobs rather than inside any of them:
 *
 *   1. The crop and the size are separate numbers, and the job carries BOTH.
 *      The rectangle is in source pixels; the size is what comes out. A page
 *      that posted one and painted the other would look right and hand back the
 *      wrong file, and nothing in the engine's own tests could tell.
 *   2. `fit` is a promise about distortion. 'fit' never distorts and 'stretch'
 *      always does, so 'stretch' has to be impossible to reach by accident —
 *      the default is asserted, not assumed.
 *   3. A byte ceiling can cost the visitor pixels they explicitly asked for.
 *      When that happens the panel has to say so in words, and when it does not
 *      happen it has to say that too. "20 KB" on a form is worth nothing if the
 *      signature quietly came back at a third of the size the form wants.
 *
 * useLocalProcess is stubbed exactly as it is for the other tool suites: what is
 * under test is what the page displays and what it hands over, not the codecs.
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import SignatureTool from '@/app/(tools)/signature-resizer/SignatureTool';
import { MIN_TARGET_BYTES } from '@/lib/limits';
import { imageFile, setInputFiles, stubImageProbe } from '../helpers';

const harness = vi.hoisted(() => ({
    submit: null,
    setResult: null,
    setWorking: null,
}));

vi.mock('@/lib/hooks/useLocalProcess', async () => {
    const { useState } = await import('react');

    return {
        default: function useStubbedProcess() {
            const [result, setResult] = useState(null);
            const [working, setWorking] = useState({ isProcessing: false, phase: null });
            harness.setResult = setResult;
            harness.setWorking = setWorking;

            return {
                submit: (...args) => harness.submit(...args),
                download: () => {},
                reset: () => setResult(null),
                cancel: () => {},
                isProcessing: working.isProcessing,
                progress: 0,
                error: null,
                result,
                setError: () => {},
                phase: working.phase,
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
    harness.setWorking = null;
});

afterEach(() => {
    probe.restore();
});

const SOURCE = { width: 1200, height: 800 };
const SOURCE_BYTES = 500 * 1024;

/** The engine's answer: a signature it actually made. */
const MADE = {
    blob: new Blob([new Uint8Array(8)], { type: 'image/jpeg' }),
    filename: 'resizo-signature-scan.jpg',
    format: 'jpeg',
    width: 300,
    height: 80,
    originalBytes: SOURCE_BYTES,
    resultBytes: 18 * 1024,
    originalWidth: SOURCE.width,
    originalHeight: SOURCE.height,
    requestedWidth: 300,
    requestedHeight: 80,
    crop: { x: 0, y: 0, width: SOURCE.width, height: SOURCE.height },
    fit: 'fit',
    quality: 78,
    qualityApplied: true,
    resized: false,
    targetBytes: 20 * 1024,
    targetMet: true,
    steps: 0,
    scalePercent: 100,
};

async function mountWithImage() {
    const view = render(<SignatureTool />);

    const input = document.getElementById('signature-file');
    setInputFiles(input, [imageFile('scan.jpg', 'jpeg', { size: SOURCE_BYTES })]);
    await act(async () => {
        input.dispatchEvent(new Event('change', { bubbles: true }));
    });

    return view;
}

async function withResult(payload = MADE) {
    const view = await mountWithImage();
    await act(async () => harness.setResult(payload));
    return view;
}

const submitButton = () => screen.queryByRole('button', { name: /^make signature$/i });
const numberField = (name) => screen.getByRole('spinbutton', { name });
const describedBy = (name) => (numberField(name).getAttribute('aria-describedby') ?? '').split(/\s+/);
const radio = (name) => screen.getByRole('radio', { name });

async function setField(name, value) {
    await act(async () => {
        fireEvent.change(numberField(name), { target: { value } });
    });
}

/** The output size the visitor asked for. */
async function setSize(width, height) {
    if (width !== null) await setField('Width (px)', width);
    if (height !== null) await setField('Height (px)', height);
}

/** The four numbers of the rectangle, read off the rendered form. */
function displayedRect() {
    const read = (name) => Number(numberField(name).value);
    return { x: read('X'), y: read('Y'), width: read('Width'), height: read('Height') };
}

/** Everything the job carried, except the file itself. */
function postedFields() {
    expect(harness.submit, 'nothing was submitted').toHaveBeenCalledTimes(1);
    const [form] = harness.submit.mock.calls[0];
    return Object.fromEntries([...form.entries()].filter(([key]) => key !== 'file'));
}

/**
 * THE TOOL IS THE HERO, AND THE DROP ZONE IS THE TOOL.
 *
 * Measured on a 393×844 phone, this page put its drop zone at 860px — past the
 * first screen entirely, while every other tool lands one between 181px and
 * 451px. Six controls sat above it because all six can be answered off the form
 * before a file exists, which is true and is still the wrong trade: settings go
 * above the drop zone so a file lands CONFIGURED, not so every setting can.
 *
 * The size is the one a file genuinely has to land with — it is the reason
 * somebody is on this page and the only field with no working default — so it
 * and its examples stay above. Everything else is answered in the same pass,
 * before the button, and reads just as well below the picture it applies to.
 *
 * Document order is the assertion because it is what the phone paints and what
 * a screen reader reads.
 */
describe('what a visitor sees first', () => {
    const precedes = (first, second) => Boolean(
        first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING,
    );

    const legend = (container, text) => [...container.querySelectorAll('legend')]
        .find((node) => node.textContent.trim() === text);

    it('paints the size, then the drop zone, then everything else', () => {
        const { container } = render(<SignatureTool />);
        const dropzone = document.getElementById('signature-file');

        expect(
            precedes(numberField('Width (px)'), dropzone),
            'the size no longer sits above the drop zone',
        ).toBe(true);
        expect(
            precedes(numberField('Height (px)'), dropzone),
            'the size no longer sits above the drop zone',
        ).toBe(true);
        expect(
            precedes(screen.getByRole('button', { name: /^Large\s*300×80$/ }), dropzone),
            'the example sizes no longer sit above the drop zone',
        ).toBe(true);

        for (const below of ['Save as', 'Background']) {
            expect(
                precedes(dropzone, legend(container, below)),
                `${below} is still above the drop zone, pushing it down the page`,
            ).toBe(true);
        }
        expect(
            precedes(dropzone, screen.getByRole('combobox', { name: 'If the crop is a different shape' })),
            'the fit select is still above the drop zone, pushing it down the page',
        ).toBe(true);
        expect(
            precedes(dropzone, numberField('Maximum file size (KB)')),
            'the maximum size is still above the drop zone, pushing it down the page',
        ).toBe(true);
    });

    /**
     * Moving them below the drop zone must not move them below the BUTTON:
     * every one of them is still set in the same pass, before the job runs.
     */
    it('keeps every output control ahead of the button that uses them', async () => {
        const { container } = await mountWithImage();
        await setSize('300', '80');

        for (const control of [
            legend(container, 'Save as'),
            legend(container, 'Background'),
            numberField('Maximum file size (KB)'),
        ]) {
            expect(precedes(control, submitButton()), 'a setting is painted after the submit button').toBe(true);
        }
    });
});

describe('choosing a file', () => {
    it('starts with the whole image selected', async () => {
        await mountWithImage();

        expect(displayedRect()).toEqual({ x: 0, y: 0, width: SOURCE.width, height: SOURCE.height });
        expect(screen.getByText(/^Keeping/).textContent.replace(/\s+/g, ' ')).toBe(
            `Keeping ${SOURCE.width}×${SOURCE.height} from x 0, y 0`,
        );
        expect(screen.getByText(/^Source/).textContent.replace(/\s+/g, ' ')).toBe(
            `Source ${SOURCE.width}×${SOURCE.height}`,
        );
    });

    /**
     * The overlay is the shared component now — CropTool and this page render
     * the same file. Asserting it from here is what makes the extraction
     * observable on this side of it: an import that resolved to nothing would
     * leave the preview with no outline and no test would notice.
     */
    it('draws the crop overlay over the preview', async () => {
        const { container } = await mountWithImage();

        const overlay = container.querySelector(`svg[viewBox="0 0 ${SOURCE.width} ${SOURCE.height}"]`);
        expect(overlay, 'the preview has no crop overlay drawn over it').toBeInTheDocument();
        expect(overlay).toHaveAttribute('aria-hidden', 'true');
    });
});

/**
 * THE SIZE IS THE POINT OF THE PAGE.
 *
 * Every other control has a working default; this one cannot have one, because
 * the whole reason somebody is here is that a form named a size. So the panel
 * has to ask, and it must not ask before there is a file to ask about — an
 * error sitting on an empty page accuses the visitor of something they have not
 * done yet.
 */
describe('the size the form asked for', () => {
    const ASK = /Enter a width or a height in pixels\./;

    it('says nothing before a file is chosen', () => {
        render(<SignatureTool />);

        expect(screen.queryByText(ASK)).toBeNull();
    });

    it('asks for a size once a file is chosen, and refuses to run without one', async () => {
        await mountWithImage();

        expect(screen.getByText(ASK)).toBeInTheDocument();
        expect(submitButton()).toBeDisabled();
    });

    it.each([
        ['a width', 'Width (px)'],
        ['a height', 'Height (px)'],
    ])('stops asking once %s is typed', async (_label, field) => {
        await mountWithImage();
        await setField(field, '300');

        expect(screen.queryByText(ASK)).toBeNull();
        expect(submitButton()).toBeEnabled();
    });

    /**
     * Either field can be the one that satisfies the requirement, so either
     * field is where a screen-reader user may land while the button is dead.
     * Describing the error from only one of them leaves the other silent about
     * the thing blocking the job.
     */
    it('points both size fields at the error while it shows', async () => {
        await mountWithImage();

        const errorId = screen.getByText(ASK).id;
        expect(errorId, 'the error has no id to point at').toBeTruthy();

        for (const field of ['Width (px)', 'Height (px)']) {
            expect(describedBy(field), `${field} never mentions the error`).toContain(errorId);
            expect(numberField(field)).toHaveAttribute('aria-invalid', 'true');
        }
    });

    it('stops pointing at it once either side is typed', async () => {
        await mountWithImage();
        const errorId = screen.getByText(ASK).id;

        await setField('Height (px)', '80');

        for (const field of ['Width (px)', 'Height (px)']) {
            expect(describedBy(field), `${field} still points at a cleared error`).not.toContain(errorId);
            expect(numberField(field)).not.toHaveAttribute('aria-invalid');
            expect(describedBy(field), 'the shared hint was dropped with the error').toContain('signature-size-hint');
        }
    });

    it('asks again when the last size is cleared', async () => {
        await mountWithImage();
        await setField('Width (px)', '300');
        await setField('Width (px)', '');

        expect(screen.getByText(ASK)).toBeInTheDocument();
        expect(submitButton()).toBeDisabled();
    });
});

/**
 * THE JOB. The crop rectangle and the output size are two different pairs of
 * numbers on the same page, which is exactly the shape of mistake nothing else
 * can catch: the overlay, the "Keeping …" line and the four rectangle fields all
 * read one piece of state, while handleSubmit reads it separately into a
 * FormData alongside a second pair. A page that painted 1200×800 and posted the
 * output size as the crop would look perfect.
 */
describe('what the job carries', () => {
    it('posts the crop, the size, the fit, the format and the background', async () => {
        const user = userEvent.setup();
        await mountWithImage();
        await setSize('300', '80');

        await user.click(submitButton());

        expect(postedFields()).toEqual({
            crop_x: '0',
            crop_y: '0',
            crop_width: String(SOURCE.width),
            crop_height: String(SOURCE.height),
            width: '300',
            height: '80',
            fit: 'fit',
            format: 'jpeg',
            background: 'white',
        });
    });

    it('posts the rectangle that is on screen, not the whole image', async () => {
        const user = userEvent.setup();
        await mountWithImage();
        await setSize('300', '80');
        await setField('X', '100');
        await setField('Y', '50');
        await setField('Width', '600');
        await setField('Height', '200');

        await user.click(submitButton());

        const posted = postedFields();
        const displayed = displayedRect();
        expect({
            x: Number(posted.crop_x),
            y: Number(posted.crop_y),
            width: Number(posted.crop_width),
            height: Number(posted.crop_height),
        }, 'the job carries a different rectangle from the one on screen').toEqual(displayed);
        expect(displayed).toEqual({ x: 100, y: 50, width: 600, height: 200 });
    });

    it('leaves out the side that was not typed, so the engine derives it', async () => {
        const user = userEvent.setup();
        await mountWithImage();
        await setSize('300', null);

        await user.click(submitButton());

        const posted = postedFields();
        expect(posted.width).toBe('300');
        expect(posted, 'an empty height was posted as a size').not.toHaveProperty('height');
    });

    it('sends the measured source dimensions with the job, so the memory gate can cost it', async () => {
        const user = userEvent.setup();
        await mountWithImage();
        await setSize('300', '80');

        await user.click(submitButton());

        expect(harness.submit.mock.calls[0][1]).toMatchObject({
            originalBytes: SOURCE_BYTES,
            sourceWidth: SOURCE.width,
            sourceHeight: SOURCE.height,
        });
    });
});

/**
 * `fit` IS A PROMISE ABOUT DISTORTION.
 *
 * Two of the three modes preserve the shape of the signature and one destroys
 * it. A default that reached 'stretch' — or a select whose value drifted from
 * what is posted — would hand back a squashed signature that the visitor never
 * asked for and would only notice on the printed form.
 */
describe('the fit', () => {
    it('defaults to fitting inside the size, which never distorts', async () => {
        const user = userEvent.setup();
        await mountWithImage();
        await setSize('300', '80');

        await user.click(submitButton());

        expect(postedFields().fit).toBe('fit');
    });

    it.each([
        ['Fill the size and trim the edges', 'cover'],
        ['Stretch to the exact size (distorts)', 'stretch'],
    ])('posts %s only after it is chosen', async (label, value) => {
        const user = userEvent.setup();
        await mountWithImage();
        await setSize('300', '80');

        await user.selectOptions(
            screen.getByRole('combobox', { name: 'If the crop is a different shape' }),
            value,
        );
        await user.click(submitButton());

        const posted = postedFields();
        expect(posted.fit).toBe(value);
        expect(
            screen.getByRole('option', { name: label }).selected,
            'the option the visitor picked is not the one shown',
        ).toBe(true);
    });
});

describe('the output format and the colour behind the signature', () => {
    it('starts as a JPG on white', async () => {
        await mountWithImage();

        expect(radio('JPG')).toBeChecked();
        expect(radio('White')).toBeChecked();
    });

    it('turns the background off for PNG, and says why', async () => {
        const user = userEvent.setup();
        await mountWithImage();

        await user.click(radio('PNG'));

        expect(radio('White')).toBeDisabled();
        expect(radio('Black')).toBeDisabled();
        expect(screen.getByText('PNG keeps transparency; nothing is filled in.')).toBeInTheDocument();
    });

    it('posts the format and the background that are showing', async () => {
        const user = userEvent.setup();
        await mountWithImage();
        await setSize('300', '80');

        await user.click(radio('Black'));
        await user.click(submitButton());

        expect(postedFields()).toMatchObject({ format: 'jpeg', background: 'black' });
    });

    it('posts png once PNG is chosen', async () => {
        const user = userEvent.setup();
        await mountWithImage();
        await setSize('300', '80');

        await user.click(radio('PNG'));
        await user.click(submitButton());

        expect(postedFields().format).toBe('png');
    });
});

/**
 * THE BYTE CEILING IS OPTIONAL, AND OPTIONAL HAS TO MEAN ABSENT.
 *
 * An empty field that posted `targetBytes: 0` would put every job through the
 * size search for nothing. And a typed number below the floor has to be refused
 * before the job starts rather than after eight encodes fail to reach it.
 */
describe('the maximum file size', () => {
    const FIELD = 'Maximum file size (KB)';

    it('posts nothing when it is left empty', async () => {
        const user = userEvent.setup();
        await mountWithImage();
        await setSize('300', '80');

        await user.click(submitButton());

        expect(postedFields(), 'an empty maximum reached the engine').not.toHaveProperty('targetBytes');
    });

    it('posts the typed kilobytes as bytes', async () => {
        const user = userEvent.setup();
        await mountWithImage();
        await setSize('300', '80');
        await setField(FIELD, '20');

        await user.click(submitButton());

        expect(postedFields().targetBytes).toBe(String(20 * 1024));
    });

    it('refuses a maximum below the floor, naming the range, and runs nothing', async () => {
        const user = userEvent.setup();
        await mountWithImage();
        await setSize('300', '80');
        await setField(FIELD, '5');

        expect(screen.getByText(/Pick a maximum between 10 KB and 20 MB\./)).toBeInTheDocument();
        expect(submitButton()).toBeDisabled();

        await user.click(submitButton()).catch(() => {});
        expect(harness.submit, 'a refused target reached the engine').not.toHaveBeenCalled();
    });

    it('accepts the smallest maximum the engine will search for', async () => {
        const user = userEvent.setup();
        await mountWithImage();
        await setSize('300', '80');
        await setField(FIELD, String(MIN_TARGET_BYTES / 1024));

        await user.click(submitButton());

        expect(postedFields().targetBytes).toBe(String(MIN_TARGET_BYTES));
    });
});

describe('the example sizes', () => {
    it('fills both sides from a chip', async () => {
        const user = userEvent.setup();
        await mountWithImage();

        await user.click(screen.getByRole('button', { name: /^Large\s*300×80$/ }));

        expect(numberField('Width (px)')).toHaveValue(300);
        expect(numberField('Height (px)')).toHaveValue(80);
        expect(screen.queryByText(/Enter a width or a height in pixels\./)).toBeNull();
    });

    /**
     * The chips are the one place this page could imply that a size is
     * official. It never may: the sizes forms ask for differ by form, and a
     * visitor who trusts a chip over the form in front of them has been sent
     * back to the start of the queue by this page.
     */
    it('says out loud that they are examples', async () => {
        await mountWithImage();

        expect(
            screen.getByText('Examples only. Use the exact size the form you are filling in asks for.'),
        ).toBeInTheDocument();
    });
});

/**
 * THE RECTANGLE THAT LEAVES THE IMAGE.
 *
 * Computed in the component and never reaching the engine, so no lib test
 * covers it: the numbers in the sentence and the disabling of the action are
 * only observable here.
 */
describe('a rectangle that leaves the image', () => {
    const OUTSIDE = /That region falls outside the image\. It has to fit inside 1200×800 pixels/;

    it('refuses it, naming the size it has to fit, and runs nothing', async () => {
        const user = userEvent.setup();
        await mountWithImage();
        await setSize('300', '80');
        await setField('Width', '5000');

        expect(screen.getByRole('alert')).toHaveTextContent(OUTSIDE);
        expect(submitButton()).toBeDisabled();

        await user.click(submitButton()).catch(() => {});
        expect(harness.submit, 'a refused rectangle reached the engine').not.toHaveBeenCalled();
    });

    it('clears the refusal once the rectangle fits again', async () => {
        await mountWithImage();
        await setSize('300', '80');
        await setField('Width', '5000');
        expect(screen.getByRole('alert')).toBeInTheDocument();

        await setField('Width', '1200');

        expect(screen.queryByRole('alert')).toBeNull();
        expect(submitButton()).toBeEnabled();
    });

    it('takes the whole image back in one button', async () => {
        const user = userEvent.setup();
        await mountWithImage();
        await setField('X', '400');
        await setField('Width', '100');

        await user.click(screen.getByRole('button', { name: /select the whole image/i }));

        expect(displayedRect()).toEqual({ x: 0, y: 0, width: SOURCE.width, height: SOURCE.height });
    });
});

/**
 * WHAT THE PANEL SAYS ABOUT THE FILE IT PRODUCED.
 *
 * The footnote is the only place the visitor learns whether the size they typed
 * survived the byte ceiling. A signature that came back at 240×64 when the form
 * asked for 300×80 is a rejected application, and it is invisible in the
 * download button, the preview and the savings numeral alike.
 */
describe('the footnote', () => {
    it('reports the whole transition — dimensions, bytes and format', async () => {
        await withResult();

        expect(
            screen.getByText(/1200×800 at 500 KB became 300×80 at 18 KB, saved as JPG\./),
        ).toBeInTheDocument();
    });

    it('says the dimensions were left alone when the ceiling did not cost any', async () => {
        await withResult();

        expect(screen.getByText(/Dimensions were not changed to meet the size limit\./)).toBeInTheDocument();
        expect(screen.getByText(/It fits the 20 KB limit you set\./)).toBeInTheDocument();
    });

    it('says what the ceiling cost when it cost pixels', async () => {
        await withResult({
            ...MADE,
            width: 240,
            height: 64,
            resized: true,
            steps: 1,
            scalePercent: 80,
            resultBytes: 19 * 1024,
        });

        expect(
            screen.getByText(/The picture was shrunk from 300×80 to 240×64 to get under 20 KB\./),
        ).toBeInTheDocument();
        expect(screen.queryByText(/Dimensions were not changed to meet the size limit\./)).toBeNull();
    });

    it('says the ceiling was missed rather than implying it was met', async () => {
        await withResult({ ...MADE, targetMet: false, resultBytes: 26 * 1024 });

        expect(screen.getByText(/It did not reach the 20 KB limit you set/)).toBeInTheDocument();
    });

    it('names the region when it was not the whole image', async () => {
        await withResult({ ...MADE, crop: { x: 100, y: 50, width: 600, height: 400 } });

        expect(screen.getByText(/Kept 600×400 from x 100, y 50\./)).toBeInTheDocument();
    });

    it('stays quiet about the region when the whole image was used', async () => {
        await withResult();

        expect(screen.queryByText(/^Kept /)).toBeNull();
    });

    it('admits the distortion when the size was stretched to', async () => {
        await withResult({ ...MADE, fit: 'stretch' });

        expect(screen.getByText(/Stretched to the exact size you chose\./)).toBeInTheDocument();
    });

    it('says nothing about a limit that was never set', async () => {
        await withResult({ ...MADE, targetBytes: null, targetMet: null });

        expect(screen.queryByText(/limit you set/)).toBeNull();
        expect(screen.queryByText(/Dimensions were not changed to meet the size limit\./)).toBeNull();
        expect(screen.getByText(/1200×800 at 500 KB became 300×80 at 18 KB, saved as JPG\./)).toBeInTheDocument();
    });
});

/**
 * ToolShell removes the submit control the moment a result exists, and every
 * control on this page stays mounted and enabled afterwards. Changing one with
 * a stale result on screen would leave the visitor with settings that no button
 * can run — the defect /crop shipped and had to be fixed twice.
 */
describe('changing a setting after a result', () => {
    it.each([
        ['the size', async () => setField('Width (px)', '200')],
        ['the rectangle', async () => setField('Width', '600')],
        ['the fit', async (user) => user.selectOptions(
            screen.getByRole('combobox', { name: 'If the crop is a different shape' }),
            'cover',
        )],
        ['the format', async (user) => user.click(radio('PNG'))],
        ['the maximum size', async () => setField('Maximum file size (KB)', '40')],
    ])('brings the submit action back after %s changes', async (_label, mutate) => {
        const user = userEvent.setup();
        await withResult();
        await setSize('300', '80');
        await act(async () => harness.setResult(MADE));
        expect(submitButton(), 'precondition: the action is hidden while a result is shown').toBeNull();

        await mutate(user);

        expect(
            submitButton(),
            'changed a setting with no control on screen able to run it',
        ).toBeInTheDocument();
    });
});

describe('while the job runs', () => {
    it('says what the bar is counting during a size search', async () => {
        await mountWithImage();
        await setSize('300', '80');

        await act(async () => harness.setWorking({ isProcessing: true, phase: 'searching' }));

        expect(screen.getByRole('button', { name: /Finding the size…/ })).toBeInTheDocument();
    });

    it('says the plain thing for every other stage', async () => {
        await mountWithImage();
        await setSize('300', '80');

        await act(async () => harness.setWorking({ isProcessing: true, phase: 'encode' }));

        expect(screen.getByRole('button', { name: /Working…/ })).toBeInTheDocument();
    });
});
