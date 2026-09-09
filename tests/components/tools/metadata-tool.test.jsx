/**
 * /remove-image-metadata — the readout, and what it is allowed to say.
 *
 * This tool is the one page on the site whose whole job is to look inside a
 * personal file and describe it. That makes the interesting failure a PRIVACY
 * failure rather than a wiring one: a panel that helpfully prints "51.5074,
 * -0.1278" or "Canon EOS R5" has published the exact thing the visitor came
 * here to delete, on their screen, in a browser they may not own.
 *
 * So the load-bearing assertion in this suite is the negative one. The report
 * fixtures deliberately carry the values a real Exif block would — coordinates,
 * a camera model, a capture date — and the panel has to render the CATEGORY and
 * nothing else. A component that read `item.value` would look perfectly correct
 * against every other test here.
 *
 * The rest is the wiring that can be wrong while looking finished:
 *
 *  - the list is ordered by the page's own table, not by whatever order the
 *    engine happened to hand back, so the report is read the same way every time
 *  - ICC is reported and NOT removed, and the row has to say so — a colour
 *    profile silently listed beside eight things that are about to be deleted
 *    reads as a ninth
 *  - the action is disabled unless something removable is actually there, and a
 *    file with nothing in it says so in a sentence rather than by going grey
 *  - a refusal from inspectMetadata reaches the panel as text (DESIGN.md:
 *    inline in the panel, never a toast) and stops the run
 *  - the footnote describes the RESULT — what went, what stayed, and that the
 *    pixels did not move
 *
 * useLocalProcess is stubbed as it is for every other tool suite, and
 * metadata-strip is mocked at its module boundary: what is under test is what
 * the page displays and when it offers to run, not the container rewriter.
 */
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => ({
    inspect: null,
    submit: null,
    setResult: null,
}));

vi.mock('@/lib/image-client/metadata-strip', () => ({
    inspectMetadata: (...args) => harness.inspect(...args),
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

import MetadataTool from '@/app/(tools)/remove-image-metadata/MetadataTool';
import { formatFileSize } from '@/lib/format/bytes';
import { imageFile, setInputFiles, stubImageProbe } from '../helpers.jsx';

const SOURCE_BYTES = 500 * 1024;

let probe;

beforeEach(() => {
    probe = stubImageProbe({ width: 1200, height: 800 });
    harness.submit = vi.fn();
    harness.setResult = null;
    harness.inspect = vi.fn(() => ({ format: 'jpeg', found: [] }));
});

afterEach(() => {
    probe.restore();
});

/**
 * A report whose entries carry the values a real Exif block would. Nothing here
 * may reach the screen except the two category labels.
 */
const LEAKY_REPORT = {
    format: 'jpeg',
    found: [
        {
            id: 'gps',
            count: 1,
            removable: true,
            value: '51.5074, -0.1278',
            latitude: 51.5074,
            longitude: -0.1278,
        },
        {
            id: 'exif',
            count: 2,
            removable: true,
            value: 'Canon EOS R5',
            model: 'Canon EOS R5',
            dateTaken: '2026-04-02 14:11:03',
        },
    ],
};

const SECRETS = ['51.5074', '-0.1278', 'Canon EOS R5', '2026-04-02', '14:11:03'];

/** One of every category the engine can report, handed back out of order. */
const EVERYTHING = {
    format: 'jpeg',
    found: [
        { id: 'icc', count: 1, removable: false },
        { id: 'time', count: 1, removable: true },
        { id: 'text', count: 4, removable: true },
        { id: 'trailer', count: 1, removable: true },
        { id: 'comment', count: 1, removable: true },
        { id: 'iptc', count: 1, removable: true },
        { id: 'xmp', count: 2, removable: true },
        { id: 'thumbnail', count: 1, removable: true },
        { id: 'gps', count: 1, removable: true },
        { id: 'exif', count: 1, removable: true },
    ],
};

const LABELS_IN_ORDER = [
    'Camera and capture data (EXIF)',
    'Location (GPS coordinates)',
    'Embedded preview thumbnail',
    'Editing history, keywords and ratings (XMP)',
    'Captions and credits (IPTC)',
    'Comments',
    'Extra data appended after the picture',
    'Text chunks',
    'Last-modified time',
    'Colour profile (ICC)',
];

/** The engine's answer for a file that had two blocks taken out and one kept. */
const CLEANED = {
    blob: new Blob([new Uint8Array(8)], { type: 'image/jpeg' }),
    filename: 'photo-clean.jpg',
    format: 'jpeg',
    width: 1200,
    height: 800,
    originalBytes: SOURCE_BYTES,
    resultBytes: SOURCE_BYTES - 12 * 1024,
    detected: [
        { id: 'exif', count: 1, removable: true },
        { id: 'gps', count: 1, removable: true },
        { id: 'icc', count: 1, removable: false },
    ],
    removed: [{ id: 'exif', count: 1 }, { id: 'gps', count: 1 }],
    kept: [{ id: 'icc', count: 1 }],
};

async function mountWithFile(file = imageFile('photo.jpg', 'jpeg', { size: SOURCE_BYTES })) {
    const view = render(<MetadataTool />);

    const input = document.getElementById('metadata-file');
    setInputFiles(input, [file]);
    await act(async () => {
        input.dispatchEvent(new Event('change', { bubbles: true }));
    });

    return view;
}

async function withResult(payload = CLEANED) {
    const view = await mountWithFile();
    await act(async () => harness.setResult(payload));
    return view;
}

const actionButton = () => screen.queryByRole('button', { name: /^Remove metadata$/ });

/** The readout, found the way a screen reader finds it: by its heading. */
function readout() {
    return screen.getByRole('list', { name: /what this file carries/i });
}

const rowTexts = () => within(readout())
    .getAllByRole('listitem')
    .map((row) => row.textContent.replace(/\s+/g, ' ').trim());

describe('the readout of what a file carries', () => {
    it('lists every category by its human label, in the page’s own order', async () => {
        harness.inspect = vi.fn(() => EVERYTHING);
        await mountWithFile();

        await waitFor(() => expect(readout()).toBeInTheDocument());

        expect(
            rowTexts().map((text) => text.split(' ×')[0].split(' — ')[0]),
            'the list follows the engine’s ordering instead of the page’s label table',
        ).toEqual(LABELS_IN_ORDER);
    });

    it('is headed "What this file carries" and announced politely when it appears', async () => {
        harness.inspect = vi.fn(() => EVERYTHING);
        const { container } = await mountWithFile();

        await waitFor(() => expect(readout()).toBeInTheDocument());

        expect(screen.getByRole('heading', { name: 'What this file carries' })).toBeInTheDocument();
        expect(
            container.querySelector('[role="status"]'),
            'the readout appears with nothing announced',
        ).toBeTruthy();
    });

    it('prints a count only when a category appears more than once', async () => {
        harness.inspect = vi.fn(() => EVERYTHING);
        await mountWithFile();

        await waitFor(() => expect(readout()).toBeInTheDocument());
        const rows = rowTexts();

        expect(rows).toContain('Editing history, keywords and ratings (XMP) ×2');
        expect(rows).toContain('Text chunks ×4');
        expect(rows, 'a single block was labelled ×1').toContain('Location (GPS coordinates)');
    });

    it('says the colour profile is kept, on its own row', async () => {
        harness.inspect = vi.fn(() => EVERYTHING);
        await mountWithFile();

        await waitFor(() => expect(readout()).toBeInTheDocument());

        expect(rowTexts()).toContain('Colour profile (ICC) — kept, so colours still display the same');
    });

    it('carries the sentence that says no value is read out of the picture', async () => {
        harness.inspect = vi.fn(() => EVERYTHING);
        await mountWithFile();

        await waitFor(() => expect(readout()).toBeInTheDocument());

        expect(screen.getByText(
            'Only the file’s own descriptive blocks are listed — the picture itself is not read, and no value is shown here or anywhere else.',
        )).toBeInTheDocument();
    });

    it('does not exist before a file is chosen', () => {
        render(<MetadataTool />);

        expect(screen.queryByRole('list', { name: /what this file carries/i })).toBeNull();
        expect(harness.inspect, 'the file was read before there was a file').not.toHaveBeenCalled();
    });

    it('reads the whole file, not a slice of it', async () => {
        harness.inspect = vi.fn(() => EVERYTHING);
        await mountWithFile();

        await waitFor(() => expect(harness.inspect).toHaveBeenCalled());
        const [bytes] = harness.inspect.mock.calls[0];
        expect(bytes, 'inspectMetadata takes a Uint8Array of the whole file').toBeInstanceOf(Uint8Array);
        expect(bytes.length).toBe(16);
    });
});

/**
 * THE ONE THAT MATTERS. Every entry in LEAKY_REPORT carries the value a real
 * block would, and the panel has to render the category and nothing else.
 */
describe('no value out of the file ever reaches the screen', () => {
    it('shows the categories and none of the values in them', async () => {
        harness.inspect = vi.fn(() => LEAKY_REPORT);
        const { container } = await mountWithFile();

        await waitFor(() => expect(readout()).toBeInTheDocument());

        expect(rowTexts()).toEqual([
            'Camera and capture data (EXIF) ×2',
            'Location (GPS coordinates)',
        ]);

        for (const secret of SECRETS) {
            expect(
                container.textContent,
                `the panel printed ${secret} — a value out of the visitor’s own file`,
            ).not.toContain(secret);
        }
    });

    it('keeps them off the screen after the job has run, too', async () => {
        harness.inspect = vi.fn(() => LEAKY_REPORT);
        const { container } = await withResult({
            ...CLEANED,
            removed: [
                { id: 'exif', count: 2, value: 'Canon EOS R5' },
                { id: 'gps', count: 1, value: '51.5074, -0.1278' },
            ],
        });

        expect(screen.getByRole('button', { name: /Download clean image/ })).toBeInTheDocument();

        for (const secret of SECRETS) {
            expect(
                container.textContent,
                `the result panel printed ${secret}`,
            ).not.toContain(secret);
        }
    });
});

describe('when there is nothing to take out', () => {
    it('says so and disables the action for an empty report', async () => {
        harness.inspect = vi.fn(() => ({ format: 'png', found: [] }));
        await mountWithFile(imageFile('flat.png', 'png', { size: SOURCE_BYTES }));

        expect(await screen.findByText(
            'Nothing to remove — this file carries no metadata blocks.',
        )).toBeInTheDocument();
        expect(screen.queryByRole('list', { name: /what this file carries/i })).toBeNull();
        expect(actionButton()).toBeDisabled();
    });

    it('disables the action when the only block found is one that stays', async () => {
        harness.inspect = vi.fn(() => ({
            format: 'jpeg',
            found: [{ id: 'icc', count: 1, removable: false }],
        }));
        await mountWithFile();

        await waitFor(() => expect(readout()).toBeInTheDocument());

        expect(rowTexts()).toEqual(['Colour profile (ICC) — kept, so colours still display the same']);
        expect(actionButton(), 'offered to remove a block it is never going to remove').toBeDisabled();
    });

    it('enables the action as soon as one removable block is there', async () => {
        harness.inspect = vi.fn(() => LEAKY_REPORT);
        await mountWithFile();

        await waitFor(() => expect(readout()).toBeInTheDocument());
        expect(actionButton()).toBeEnabled();
    });

    it('offers nothing to press before a file is chosen', () => {
        render(<MetadataTool />);

        expect(actionButton()).toBeDisabled();
    });
});

describe('a file inspectMetadata refuses', () => {
    it.each([
        ['unsupported-format', 'Metadata can only be removed from a JPG, PNG or WebP.'],
        ['invalid-file', 'This file is damaged or incomplete, so it cannot be rewritten without changing the picture.'],
    ])('shows the %s message inline and stops the run', async (code, message) => {
        harness.inspect = vi.fn(() => {
            throw Object.assign(new Error(message), { code });
        });
        await mountWithFile();

        const alert = await screen.findByRole('alert');
        expect(alert).toHaveTextContent(message);
        expect(screen.queryByRole('list', { name: /what this file carries/i })).toBeNull();
        expect(actionButton()).toBeDisabled();
    });

    it('sends nothing when the visitor clicks through a refusal', async () => {
        const user = userEvent.setup();
        harness.inspect = vi.fn(() => {
            throw Object.assign(new Error('Metadata can only be removed from a JPG, PNG or WebP.'), {
                code: 'unsupported-format',
            });
        });
        await mountWithFile();

        await screen.findByRole('alert');
        await user.click(actionButton()).catch(() => {});

        expect(harness.submit, 'a refused file reached the engine').not.toHaveBeenCalled();
    });
});

describe('the job that is posted', () => {
    it('carries the file and nothing else', async () => {
        const user = userEvent.setup();
        harness.inspect = vi.fn(() => LEAKY_REPORT);
        const file = imageFile('photo.jpg', 'jpeg', { size: SOURCE_BYTES });
        await mountWithFile(file);

        await waitFor(() => expect(actionButton()).toBeEnabled());
        await user.click(actionButton());

        expect(harness.submit).toHaveBeenCalledTimes(1);
        const [form] = harness.submit.mock.calls[0];
        expect([...form.keys()], 'the strip op takes no options').toEqual(['file']);
        expect(form.get('file')).toBe(file);
    });

    it('sends the measured source dimensions, so the memory gate can cost it', async () => {
        const user = userEvent.setup();
        harness.inspect = vi.fn(() => LEAKY_REPORT);
        await mountWithFile();

        await waitFor(() => expect(actionButton()).toBeEnabled());
        await user.click(actionButton());

        expect(harness.submit.mock.calls[0][1]).toMatchObject({
            originalBytes: SOURCE_BYTES,
            sourceWidth: 1200,
            sourceHeight: 800,
        });
    });
});

describe('the result', () => {
    /** Scoped to the result panel's own Size row, as the crop suite does. */
    function reportedSize(container) {
        const term = [...container.querySelectorAll('dt')].find(
            (node) => node.textContent.trim() === 'Size',
        );
        return term?.nextElementSibling?.textContent;
    }

    it('reports the pixel size unchanged', async () => {
        harness.inspect = vi.fn(() => LEAKY_REPORT);
        const { container } = await withResult();

        expect(
            reportedSize(container),
            'a strip that cannot touch a pixel reported a different size',
        ).toBe('1200×800');
    });

    it('names what went, what stayed and what did not move', async () => {
        harness.inspect = vi.fn(() => LEAKY_REPORT);
        await withResult();

        expect(screen.getByText([
            'Removed: Camera and capture data (EXIF), Location (GPS coordinates).',
            'Kept: Colour profile (ICC), because removing it would change how the colours display.',
            `The compressed picture data was not touched — the pixels are the same bytes you gave in, ${formatFileSize(12 * 1024)} smaller without the blocks.`,
        ].join(' '))).toBeInTheDocument();
    });

    it('leaves the Kept sentence out when nothing was kept', async () => {
        harness.inspect = vi.fn(() => LEAKY_REPORT);
        await withResult({ ...CLEANED, kept: [] });

        const footnote = screen.getByText(/^Removed:/);
        expect(footnote.textContent).not.toContain('Kept:');
        expect(footnote.textContent).toContain('12 KB smaller without the blocks.');
    });

    it('says the download is a copy when nothing was removed', async () => {
        harness.inspect = vi.fn(() => LEAKY_REPORT);
        await withResult({
            ...CLEANED,
            resultBytes: SOURCE_BYTES,
            removed: [],
            kept: [{ id: 'icc', count: 1 }],
        });

        expect(screen.getByText(
            'This file carried nothing to remove; the download is a copy.',
        )).toBeInTheDocument();
    });

    it('offers the download by name', async () => {
        harness.inspect = vi.fn(() => LEAKY_REPORT);
        await withResult();

        expect(screen.getByRole('button', { name: /Download clean image/ })).toBeInTheDocument();
    });
});

/**
 * THE HERO IS THE REMOVAL, NOT THE SAVING.
 *
 * ResultPanel's default oversized numeral answers "how much smaller?", and on
 * this tool that is the wrong question loudly: a strip that takes a GPS block
 * out of a 4 MB photo saves a few hundred bytes, so the payoff moment would
 * have printed "−0%" over a job that did exactly what it was asked. Worse, the
 * numeral's screen-reader suffix reads "smaller than the original", which
 * announces a successful redaction as a compression that achieved nothing.
 *
 * The count of blocks removed is the thing the visitor came for, so it takes
 * the slot. The before/after byte pair stays underneath — it is still the truth
 * about the file; what goes is only the framing that called the difference a
 * saving.
 */
describe('the payoff figure', () => {
    const hero = (container) => container.querySelector('.text-numeral')?.textContent;

    it.each([
        ['one block', [{ id: 'exif', count: 1 }], '1 block'],
        ['two categories', [{ id: 'exif', count: 1 }, { id: 'gps', count: 1 }], '2 blocks'],
        ['a category counted more than once', [{ id: 'xmp', count: 2 }, { id: 'exif', count: 1 }], '3 blocks'],
    ])('counts %s', async (_label, removed, expected) => {
        harness.inspect = vi.fn(() => LEAKY_REPORT);
        const { container } = await withResult({ ...CLEANED, removed });

        expect(hero(container)).toBe(expected);
        expect(screen.getByText('Removed from the file')).toBeInTheDocument();
    });

    it('says nothing was removed rather than printing a zero saving', async () => {
        harness.inspect = vi.fn(() => LEAKY_REPORT);
        const { container } = await withResult({
            ...CLEANED,
            resultBytes: SOURCE_BYTES,
            removed: [],
        });

        expect(hero(container)).toBe('0 blocks');
        expect(screen.getByText('Nothing to remove')).toBeInTheDocument();
    });

    it('never shows a savings percentage over a job that did not compress anything', async () => {
        harness.inspect = vi.fn(() => LEAKY_REPORT);
        const { container } = await withResult();

        expect(container.textContent, 'the byte saving took the payoff slot').not.toContain('−2%');
        expect(
            screen.queryByText(/smaller than the original/),
            'a redaction was announced as a compression',
        ).toBeNull();
    });

    it('keeps the real before and after bytes underneath it', async () => {
        harness.inspect = vi.fn(() => LEAKY_REPORT);
        const { container } = await withResult();

        const read = (term) => [...container.querySelectorAll('dt')]
            .find((node) => node.textContent.trim() === term)
            ?.nextElementSibling?.textContent;

        expect(read('Before')).toBe(formatFileSize(SOURCE_BYTES));
        expect(read('After')).toBe(formatFileSize(SOURCE_BYTES - 12 * 1024));
    });
});
