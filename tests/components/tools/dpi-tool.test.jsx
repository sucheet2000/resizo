/**
 * /change-image-dpi — the checker, the arithmetic and the sentence afterwards.
 *
 * This tool is unusual twice over, and both are what this suite pins.
 *
 *  1. It READS before it writes. Every other tool takes a file and offers to do
 *     something to it; this one has to tell the visitor what the file already
 *     claims, because "my print shop says this is 72 DPI" is the reason they
 *     came. The readout is therefore a load-bearing part of the tool rather
 *     than decoration, and its arithmetic — pixels ÷ DPI = inches — is the only
 *     number on the page nothing else in the repo computes.
 *
 *  2. Nothing it does changes a pixel. The result panel is a byte comparison by
 *     construction, so the words underneath it are the only place that can say
 *     the picture is untouched, which fields were written and what the file now
 *     claims to print at. A footnote that drifts from the result is the same
 *     defect /crop had: a panel describing a file other than the one behind the
 *     Download button.
 *
 * useLocalProcess is stubbed as it is for the other tool tests, and
 * lib/image-client/dpi is mocked so the readings can be driven directly: what
 * is under test is what the page says about a reading, not how a JFIF header is
 * parsed (tests/lib/image-client/dpi.test.js owns that).
 */
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import DpiTool from '@/app/(tools)/change-image-dpi/DpiTool';
import { MAX_DPI, MIN_DPI } from '@/lib/limits';
import { imageFile, setInputFiles, stubImageProbe } from '../helpers';

const harness = vi.hoisted(() => ({
    submit: null,
    setResult: null,
    reading: null,
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
                code: null,
            };
        },
    };
});

/**
 * The engine's reader, driven by the test. `harness.reading` is either the
 * reading to hand back or the Error a file the module refuses would throw —
 * which is the real contract: readResolution throws for a WebP, a GIF or a
 * damaged file rather than returning nulls for them.
 */
vi.mock('@/lib/image-client/dpi', async (importOriginal) => ({
    ...(await importOriginal()),
    readResolution: () => {
        if (harness.reading instanceof Error) throw harness.reading;
        return harness.reading;
    },
}));

/* ----------------------------------------------------------- the readings */

const JFIF_300 = {
    format: 'jpeg',
    dpi: { x: 300, y: 300 },
    source: 'jfif',
    jfif: { units: 1, xDensity: 300, yDensity: 300 },
    exif: null,
    phys: null,
};

const EXIF_144 = {
    format: 'jpeg',
    dpi: { x: 144, y: 144 },
    source: 'exif',
    jfif: null,
    exif: { xResolution: 144, yResolution: 144, unit: 2 },
    phys: null,
};

const PHYS_300 = {
    format: 'png',
    dpi: { x: 300, y: 300 },
    source: 'phys',
    jfif: null,
    exif: null,
    phys: { xPixelsPerUnit: 11811, yPixelsPerUnit: 11811, unit: 1 },
};

/**
 * A file whose two axes disagree. Rare, real, and the only fixture that can
 * tell `width / x` apart from `width / y` — every square reading in this file
 * passes either way, so without this one an axis swap ships silently.
 */
const LOPSIDED = {
    format: 'jpeg',
    dpi: { x: 200, y: 400 },
    source: 'exif',
    jfif: null,
    exif: { xResolution: 200, yResolution: 400, unit: 2 },
    phys: null,
};

const NOTHING_RECORDED = {
    format: 'jpeg',
    dpi: null,
    source: null,
    jfif: null,
    exif: null,
    phys: null,
};

const unsupported = () => Object.assign(
    new Error('Only JPG and PNG files store a resolution that can be changed.'),
    { code: 'unsupported-format' },
);

const damaged = () => Object.assign(
    new Error('This file is damaged and cannot be rewritten.'),
    { code: 'invalid-file' },
);

/* ------------------------------------------------------------ the results */

/** A JPEG that already had a JFIF header, rewritten from 72 to 300. */
const REWRITTEN_JPEG = {
    blob: new Blob([new Uint8Array(8)], { type: 'image/jpeg' }),
    filename: 'resizo-300dpi-photo.jpg',
    format: 'jpeg',
    width: 1600,
    height: 1200,
    originalBytes: 500 * 1024,
    resultBytes: 500 * 1024,
    dpi: {
        before: { dpi: { x: 72, y: 72 }, source: 'jfif' },
        after: { dpi: { x: 300, y: 300 }, source: 'jfif' },
    },
    inserted: false,
    changed: ['jfif', 'exif'],
};

/** A JPEG with no resolution at all, so a JFIF header had to be added. */
const INSERTED_JPEG = {
    ...REWRITTEN_JPEG,
    resultBytes: 500 * 1024 + 18,
    dpi: {
        before: { dpi: null, source: null },
        after: { dpi: { x: 300, y: 300 }, source: 'jfif' },
    },
    inserted: true,
    changed: ['jfif'],
};

/**
 * The common case, and the one that was wrong.
 *
 * sharp writes a JPEG's density into EXIF and emits no JFIF header at all, so a
 * file that plainly HAS a resolution still comes back with `inserted: true` —
 * a JFIF header had to be created. Reading the before-sentence off `inserted`
 * therefore told a visitor their 144 DPI scan had no resolution recorded, three
 * lines under a readout that had just said it was 144 DPI from the EXIF block.
 */
const EXIF_ONLY_JPEG = {
    ...REWRITTEN_JPEG,
    resultBytes: 500 * 1024 + 18,
    dpi: {
        before: { dpi: { x: 144, y: 144 }, source: 'exif' },
        after: { dpi: { x: 300, y: 300 }, source: 'jfif' },
    },
    inserted: true,
    changed: ['jfif', 'exif'],
};

/** A PNG that had no pHYs chunk until this write created one. */
const INSERTED_PNG = {
    ...REWRITTEN_JPEG,
    blob: new Blob([new Uint8Array(8)], { type: 'image/png' }),
    filename: 'resizo-300dpi-photo.png',
    format: 'png',
    dpi: {
        before: { dpi: null, source: null },
        after: { dpi: { x: 300, y: 300 }, source: 'phys' },
    },
    inserted: true,
    changed: ['phys'],
};

/** A PNG carrying both a pHYs chunk and an eXIf block. */
const REWRITTEN_PNG = {
    ...REWRITTEN_JPEG,
    blob: new Blob([new Uint8Array(8)], { type: 'image/png' }),
    filename: 'resizo-300dpi-photo.png',
    format: 'png',
    dpi: {
        before: { dpi: { x: 144, y: 144 }, source: 'phys' },
        after: { dpi: { x: 300, y: 300 }, source: 'phys' },
    },
    changed: ['phys', 'exif'],
};

/** A PNG with a pHYs chunk and nothing else. */
const PHYS_ONLY_PNG = {
    ...REWRITTEN_PNG,
    changed: ['phys'],
};

/* -------------------------------------------------------------- the mount */

let probe;

beforeEach(() => {
    probe = stubImageProbe({ width: 1600, height: 1200 });
    harness.submit = vi.fn();
    harness.setResult = null;
    harness.reading = JFIF_300;
});

afterEach(() => {
    probe.restore();
});

/** Renders the tool and gets a file past the drop zone, so the checker exists. */
async function mountWithImage({ reading = JFIF_300, format = 'jpeg' } = {}) {
    harness.reading = reading;

    const view = render(<DpiTool />);
    const input = document.getElementById('dpi-file');
    const name = format === 'png' ? 'photo.png' : 'photo.jpg';
    setInputFiles(input, [imageFile(name, format, { size: 500 * 1024 })]);

    await act(async () => {
        input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    // The header read is a second await behind selectFiles, so the readout
    // lands one microtask turn after the file does.
    await act(async () => {});

    return view;
}

async function withResult(payload) {
    const view = await mountWithImage({ format: payload.format === 'png' ? 'png' : 'jpeg' });
    await act(async () => harness.setResult(payload));
    return view;
}

/* ------------------------------------------------------------- the probes */

const dpiField = () => screen.getByRole('spinbutton', { name: /new dpi/i });
const actionButton = () => screen.queryByRole('button', { name: /^set dpi$/i });
/** The whole checker, every row of it. */
const readoutRegion = () => screen.getByRole('region', { name: /what this file says/i });

/** Only the part a screen reader is told about unprompted. */
const liveRegion = () => screen.getByRole('status', { name: /what this file says/i });

/** One row of the checker, read the way a person reads it: term then value. */
function readoutRow(term) {
    const dt = [...readoutRegion().querySelectorAll('dt')]
        .find((node) => term.test(node.textContent.replace(/\s+/g, ' ').trim()));
    return dt?.nextElementSibling?.textContent.replace(/\s+/g, ' ').trim() ?? null;
}

/** The label of the row that follows the field, which carries its number. */
function willPrintTerm() {
    const dt = [...readoutRegion().querySelectorAll('dt')]
        .find((node) => /^Will print at/.test(node.textContent.trim()));
    return dt?.textContent.replace(/\s+/g, ' ').trim() ?? null;
}

async function typeDpi(value) {
    await act(async () => {
        fireEvent.change(dpiField(), { target: { value } });
    });
}

/** The whole footnote under the result, as one readable string. */
const footnote = () => screen
    .getByText(/The compressed picture data is the same bytes/)
    .textContent
    .replace(/\s+/g, ' ')
    .trim();

/* ------------------------------------------------------------------ tests */

describe('the checker reads the file before anything is written', () => {
    it.each([
        ['a JFIF header', JFIF_300, '300 × 300 DPI, from the JFIF header'],
        ['an EXIF block', EXIF_144, '144 × 144 DPI, from the EXIF block'],
        ['a pHYs chunk', PHYS_300, '300 × 300 DPI, from the pHYs chunk'],
    ])('names the resolution and where it came from, for %s', async (_label, reading, expected) => {
        await mountWithImage({ reading, format: reading.format === 'png' ? 'png' : 'jpeg' });

        expect(readoutRow(/^Recorded resolution$/)).toBe(expected);
    });

    it('says None recorded when the file carries no resolution at all', async () => {
        await mountWithImage({ reading: NOTHING_RECORDED });

        expect(readoutRow(/^Recorded resolution$/)).toBe('None recorded');
        expect(
            readoutRow(/^Prints at the recorded DPI$/),
            'a file with no resolution cannot have an implied print size',
        ).toBe('—');
    });

    it('reports the measured pixel size, which is the one thing this tool never changes', async () => {
        await mountWithImage();

        expect(readoutRow(/^Pixel size$/)).toBe('1600 × 1200 px');
    });

    it('does not exist before a file is chosen', () => {
        render(<DpiTool />);

        expect(screen.queryByRole('status', { name: /what this file says/i })).toBeNull();
    });
});

/**
 * WHAT GETS SAID OUT LOUD, AND WHAT DOES NOT.
 *
 * The checker holds two kinds of row. Three of them are facts about the file
 * and land once, when it is chosen — those are worth announcing, because a
 * screen-reader user otherwise has no idea the tool just answered the question
 * they came with. The fourth follows the New DPI field, and typing "300" is
 * three keystrokes: inside a live region that is three polite announcements
 * fired into the middle of someone typing a number.
 *
 * So the live region is scoped to the file-derived rows. The row that follows
 * the field updates silently and is read on demand, and the same arithmetic is
 * restated in the result footnote once the job has run.
 */
describe('what the readout announces', () => {
    it('announces the reading the file arrived with', async () => {
        await mountWithImage({ reading: EXIF_144 });
        const live = liveRegion();

        expect(within(live).getByText('144 × 144 DPI, from the EXIF block')).toBeInTheDocument();
        expect(within(live).getByText('1600 × 1200 px')).toBeInTheDocument();
        expect(within(live).getByText('11.11 × 8.33 in (28.2 × 21.2 cm)')).toBeInTheDocument();
    });

    it('leaves the row that follows the field outside the live region', async () => {
        await mountWithImage();

        expect(
            within(readoutRegion()).getByText(/^Will print at/),
            'the row has to exist — it is only its liveness that is wrong',
        ).toBeInTheDocument();
        expect(
            within(liveRegion()).queryByText(/^Will print at/),
            'typing a three-digit number would announce the whole reading three times',
        ).toBeNull();
    });

    it('still updates that row silently as the field changes', async () => {
        await mountWithImage();
        await typeDpi('150');

        expect(willPrintTerm()).toBe('Will print at 150 DPI');
        expect(readoutRow(/^Will print at/)).toBe('10.67 × 8.00 in (27.1 × 20.3 cm)');
    });
});

/**
 * THE ARITHMETIC. Pixels ÷ DPI is the whole reason someone opens this page, and
 * nothing else in the repo computes it — so a wrong divisor here would ship
 * silently. 1600×1200 at 300 is exactly 5⅓ × 4 inches, which is why it is the
 * anchor: one side lands on a repeating decimal and the other on a whole
 * number, so a rounding change shows up on one side and not the other.
 */
describe('the print size it implies', () => {
    it('reads 5.33 × 4.00 in for a 1600×1200 photo at 300 DPI', async () => {
        await mountWithImage({ reading: JFIF_300 });

        expect(readoutRow(/^Prints at the recorded DPI$/))
            .toBe('5.33 × 4.00 in (13.5 × 10.2 cm)');
    });

    it('reads 11.11 × 8.33 in at 144 DPI', async () => {
        await mountWithImage({ reading: EXIF_144 });

        expect(readoutRow(/^Prints at the recorded DPI$/))
            .toBe('11.11 × 8.33 in (28.2 × 21.2 cm)');
    });

    /**
     * The axis check. A file may record a different resolution horizontally and
     * vertically, so the width must be divided by x and the height by y — and a
     * 1600×1200 photo at 200×400 is the pair that proves it, because swapping
     * the divisors turns 8.00 × 3.00 into 4.00 × 3.00.
     */
    it('divides each side by its own axis when the file records two', async () => {
        await mountWithImage({ reading: LOPSIDED });

        expect(readoutRow(/^Recorded resolution$/)).toBe('200 × 400 DPI, from the EXIF block');
        expect(readoutRow(/^Prints at the recorded DPI$/)).toBe('8.00 × 3.00 in (20.3 × 7.6 cm)');
    });

    it('follows the field, live, without a file being reprocessed', async () => {
        await mountWithImage();

        expect(willPrintTerm(), 'the row starts at the default the field holds').toBe('Will print at 300 DPI');
        expect(readoutRow(/^Will print at/)).toBe('5.33 × 4.00 in (13.5 × 10.2 cm)');

        await typeDpi('150');

        expect(willPrintTerm()).toBe('Will print at 150 DPI');
        expect(readoutRow(/^Will print at/)).toBe('10.67 × 8.00 in (27.1 × 20.3 cm)');
    });

    it('shows no size for a number it would refuse', async () => {
        await mountWithImage();
        await typeDpi('0');

        expect(willPrintTerm()).toBe('Will print at the new DPI');
        expect(readoutRow(/^Will print at/)).toBe('—');
    });
});

describe('a file whose resolution cannot be read', () => {
    it.each([
        ['a format with no resolution field', unsupported()],
        ['a damaged file', damaged()],
    ])('shows the reason and refuses to run, for %s', async (_label, failure) => {
        await mountWithImage({ reading: failure });

        expect(screen.getByRole('alert')).toHaveTextContent(failure.message);
        expect(actionButton(), 'a file that cannot be read must not be written to').toBeDisabled();
    });

    it('shows no checker it cannot fill in', async () => {
        await mountWithImage({ reading: damaged() });

        expect(screen.queryByRole('status', { name: /what this file says/i })).toBeNull();
    });
});

describe('the DPI control', () => {
    it('starts at 300, the number print shops ask for', () => {
        render(<DpiTool />);

        expect(dpiField()).toHaveValue(300);
    });

    it.each([
        [/screens/i, '72'],
        [/home printing/i, '150'],
        [/fine print/i, '600'],
    ])('fills the field from the %s chip', async (name, expected) => {
        const user = userEvent.setup();
        render(<DpiTool />);

        await user.click(screen.getByRole('button', { name }));

        expect(dpiField()).toHaveValue(Number(expected));
    });

    it('presses the chip whose number the field is showing', async () => {
        const user = userEvent.setup();
        render(<DpiTool />);

        await user.click(screen.getByRole('button', { name: /screens/i }));

        expect(screen.getByRole('button', { name: /screens/i })).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByRole('button', { name: /^print/i })).toHaveAttribute('aria-pressed', 'false');
    });

    it('groups the chips under a heading that does not claim they are required', () => {
        render(<DpiTool />);

        expect(screen.getByRole('group', { name: /common print resolutions/i })).toBeInTheDocument();
        expect(screen.getByText(/not rules any printer or upload form enforces/i)).toBeInTheDocument();
    });

    it.each([
        ['zero', '0'],
        ['one past the ceiling', String(MAX_DPI + 1)],
        ['a fraction', '72.5'],
        ['nothing at all', ''],
    ])('refuses %s, and says what it wants instead', async (_label, value) => {
        const user = userEvent.setup();
        await mountWithImage();
        await typeDpi(value);

        expect(screen.getByText(`Enter a whole number between ${MIN_DPI} and ${MAX_DPI}.`))
            .toBeInTheDocument();
        expect(actionButton()).toBeDisabled();

        await user.click(actionButton()).catch(() => {});
        expect(harness.submit, 'a refused number reached the engine').not.toHaveBeenCalled();
    });

    it.each([[String(MIN_DPI)], [String(MAX_DPI)]])('accepts %s, the edge of the range', async (value) => {
        await mountWithImage();
        await typeDpi(value);

        expect(screen.queryByText(`Enter a whole number between ${MIN_DPI} and ${MAX_DPI}.`)).toBeNull();
        expect(actionButton()).toBeEnabled();
    });

    it('will not run before a file is chosen', () => {
        render(<DpiTool />);

        expect(actionButton()).toBeDisabled();
    });
});

describe('the job it posts', () => {
    it('carries the DPI the field is showing', async () => {
        const user = userEvent.setup();
        await mountWithImage();
        await typeDpi('600');

        await user.click(actionButton());

        expect(harness.submit).toHaveBeenCalledTimes(1);
        const [form] = harness.submit.mock.calls[0];
        expect(form.get('dpi')).toBe('600');
        expect(form.get('file')).toBeInstanceOf(File);
    });

    it('carries the DPI a chip filled in', async () => {
        const user = userEvent.setup();
        await mountWithImage();

        await user.click(screen.getByRole('button', { name: /home printing/i }));
        await user.click(actionButton());

        expect(harness.submit.mock.calls[0][0].get('dpi')).toBe('150');
    });

    it('sends the measured source dimensions, so the memory gate can cost it', async () => {
        const user = userEvent.setup();
        await mountWithImage();

        await user.click(actionButton());

        expect(harness.submit.mock.calls[0][1]).toMatchObject({
            originalBytes: 500 * 1024,
            sourceWidth: 1600,
            sourceHeight: 1200,
        });
    });

    it('clears a finished result the moment the number changes', async () => {
        await withResult(REWRITTEN_JPEG);
        expect(actionButton(), 'precondition: the action is hidden while a result is shown').toBeNull();

        await typeDpi('600');

        expect(
            actionButton(),
            'changed the DPI with no control on screen able to write it',
        ).toBeInTheDocument();
    });
});

/**
 * THE FOOTNOTE. It is the only place the page can say the picture is untouched,
 * so every clause is asserted rather than the paragraph being spot-checked: a
 * sentence quietly dropped in a refactor is exactly the kind of loss nothing
 * else would notice.
 */
describe('what the panel says afterwards', () => {
    it('describes a rewritten JPEG in full', async () => {
        await withResult(REWRITTEN_JPEG);

        expect(footnote()).toBe(
            'This file was 72 × 72 DPI from the JFIF header. '
            + 'It now says 300 × 300 DPI. '
            + 'The picture is still 1600 × 1200 pixels. '
            + 'The compressed picture data is the same bytes you gave it; only the header changed. '
            + 'The file is exactly the same size — nothing was compressed. '
            + 'Both the JFIF and the EXIF resolution fields now say 300, so every program reads the same number. '
            + 'At 300 DPI it prints at 5.33 × 4.00 in (13.5 × 10.2 cm).',
        );
    });

    it('says a record was added when the file had none, and accounts for the extra bytes', async () => {
        await withResult(INSERTED_JPEG);

        expect(footnote()).toContain('This file had no resolution recorded.');
        expect(footnote()).toContain('A JFIF header was added as well.');
        expect(footnote()).toContain(
            'The file is 18 bytes larger, which is the resolution record itself, not a change to the picture.',
        );
        expect(footnote()).toContain('The JFIF header now says 300 DPI.');
        expect(footnote(), 'no EXIF block was written, so none may be claimed')
            .not.toContain('EXIF resolution fields');
    });

    /**
     * THE AUDIT FINDING. `inserted` answers "was a header created?", which is a
     * different question from "did this file have a resolution?" — a sharp-made
     * JPEG says yes to the first and yes to the second. Reading the
     * before-sentence off the reading is the only thing that keeps it agreeing
     * with the checker three lines above it.
     */
    it('reads the before-sentence from the file’s own reading, not from whether a header was created', async () => {
        await withResult(EXIF_ONLY_JPEG);

        expect(footnote()).toContain('This file was 144 × 144 DPI from the EXIF block.');
        expect(
            footnote(),
            'the footnote contradicted the readout, which had just said 144 DPI from the EXIF block',
        ).not.toContain('had no resolution recorded');
        expect(footnote()).toContain('A JFIF header was added as well.');
    });

    it('names the pHYs chunk as the one added to a PNG that had none', async () => {
        await withResult(INSERTED_PNG);

        expect(footnote()).toContain('This file had no resolution recorded.');
        expect(footnote()).toContain('A pHYs chunk was added.');
        expect(footnote(), 'a PNG has no JFIF header to add').not.toContain('JFIF');
    });

    it('claims nothing was added when nothing was', async () => {
        await withResult(REWRITTEN_JPEG);

        expect(footnote()).not.toContain('was added');
    });

    it('names the PNG chunks, including the eXIf block when one was rewritten', async () => {
        await withResult(REWRITTEN_PNG);

        expect(footnote()).toContain('This file was 144 × 144 DPI from the pHYs chunk.');
        expect(footnote()).toContain(
            'The pHYs chunk now says 300 DPI, and the eXIf resolution was rewritten to match.',
        );
    });

    it('claims only the pHYs chunk when that is all there was to write', async () => {
        await withResult(PHYS_ONLY_PNG);

        expect(footnote()).toContain('The pHYs chunk now says 300 DPI.');
        expect(footnote()).not.toContain('eXIf');
    });

    /**
     * The /crop lesson: the panel describes the FILE, not the form. Typing a new
     * number clears the result here, so the way to prove which one is read is to
     * hand back a result whose DPI differs from the field's default.
     */
    it('reads its numbers from the result, not from the field on screen', async () => {
        await withResult({
            ...REWRITTEN_JPEG,
            dpi: {
                before: { dpi: { x: 72, y: 72 }, source: 'jfif' },
                after: { dpi: { x: 96, y: 96 }, source: 'jfif' },
            },
        });

        expect(dpiField(), 'the form still holds the default').toHaveValue(300);
        expect(footnote()).toContain('It now says 96 × 96 DPI.');
        expect(footnote()).toContain('At 96 DPI it prints at 16.67 × 12.50 in (42.3 × 31.8 cm).');
    });

    it('reports the pixel size the engine returned, unchanged', async () => {
        const { container } = await withResult(REWRITTEN_JPEG);

        const term = [...container.querySelectorAll('dt')].find(
            (node) => node.textContent.trim() === 'Size',
        );
        expect(term?.nextElementSibling?.textContent).toBe('1600×1200');
    });

    /**
     * The hero. ResultPanel's default is a percentage of bytes saved, which on
     * this tool is always 0% and announces a successful write as a compression
     * that achieved nothing. The number worth setting large here is the one the
     * visitor came to change — read off the RESULT, so it names the DPI the
     * downloaded file actually carries rather than whatever the field holds.
     */
    it('sets the new resolution as the oversized figure, not a percentage', async () => {
        await withResult(REWRITTEN_JPEG);

        expect(screen.getByText('300 DPI')).toBeInTheDocument();
        expect(screen.getByText('New resolution')).toBeInTheDocument();
        expect(screen.queryByText('0%'), 'the savings numeral survived').toBeNull();
        expect(screen.queryByText(/the same size as the original/)).toBeNull();
    });

    it('takes the hero from the result, not from the field on screen', async () => {
        await withResult({
            ...REWRITTEN_JPEG,
            dpi: {
                before: { dpi: { x: 72, y: 72 }, source: 'jfif' },
                after: { dpi: { x: 96, y: 96 }, source: 'jfif' },
            },
        });

        expect(dpiField(), 'the form still holds the default').toHaveValue(300);
        expect(screen.getByText('96 DPI')).toBeInTheDocument();
    });

    it('still shows the real before and after bytes under the hero', async () => {
        await withResult(INSERTED_JPEG);

        expect(screen.getByText('Before')).toBeInTheDocument();
        expect(screen.getByText('After')).toBeInTheDocument();
    });

    it('offers the file under a label that names what is being downloaded', async () => {
        await withResult(REWRITTEN_JPEG);

        expect(screen.getByRole('button', { name: /download image/i })).toBeInTheDocument();
    });
});
