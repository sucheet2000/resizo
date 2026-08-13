/**
 * /merge-pdf — the page and the panel.
 *
 * The engine is proved against real PDF bytes in
 * tests/lib/image-client/pdf-merge.test.js. What is asserted here is everything
 * that decides whether the page is honest, reachable and usable:
 *
 *   - the indexable-page checklist: one h1, its own canonical, a place in the
 *     registry that drives the sitemap and the nav, and a JSON-LD graph whose
 *     HowTo describes the step list the page really renders;
 *   - the ORDER, which is the whole interaction. It has to be settable from the
 *     keyboard, visible as positions, and the plan handed over has to be in that
 *     order rather than the order the files arrived;
 *   - the page selection, which has to reach the engine as 0-based indices;
 *   - the REFUSALS reaching a person as words — the password one at intake and
 *     the memory gate's at submit, each with the half that says what to do.
 *
 * THE SEAM IS ONE LEVEL LOWER THAN THE OTHER TOOL SUITES. /compress and
 * /jpg-to-pdf stub useLocalProcess; this stubs the worker client underneath it
 * and lets the real hook run. That is deliberate and it is what makes three
 * things assertable that a stubbed hook hides: that a PDF survives the hook's
 * pre-flight at all (its default gate is an IMAGE gate and would refuse every
 * document as an invalid file type), that the panel prints the fix as well as
 * the reason, and that the worker is torn down when the page goes away.
 *
 * readPdfPageCount is stubbed for the opposite reason: it is real parsing of
 * real bytes, it has its own suite, and the fixtures here are file headers.
 */
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import MergePdfPage, { metadata } from '@/app/(tools)/merge-pdf/page';
import MergePdfTool from '@/app/(tools)/merge-pdf/MergePdfTool';
import { getTool, MAX_BULK_TOTAL_BYTES, MAX_FILE_SIZE } from '@/lib/constants';
import { absoluteUrl } from '@/lib/seo';
import { imageFile, installNetworkSentinel, setInputFiles } from '../helpers';

const harness = vi.hoisted(() => ({
    /** name -> page count, or an Error to throw for that file. */
    pages: new Map(),
    process: null,
    terminate: null,
}));

vi.mock('@/lib/image-client/client', () => ({
    processImage: (...args) => harness.process(...args),
    terminateWorker: (...args) => harness.terminate(...args),
    workerSupported: () => true,
}));

vi.mock('@/lib/image-client/pdf-merge', async (importOriginal) => {
    const actual = await importOriginal();

    return {
        ...actual,
        // Real parsing has its own suite; here the file bytes are headers.
        readPdfPageCount: async (entry) => {
            const answer = harness.pages.get(entry.name);
            if (answer instanceof Error) throw answer;
            return answer ?? 1;
        },
    };
});

let network;

beforeEach(() => {
    network = installNetworkSentinel();
    harness.pages = new Map();
    harness.terminate = vi.fn();
    harness.process = vi.fn(() => new Promise(() => {}));
});

afterEach(() => {
    network.restore();
    // Some tests below shrink the device to reach the memory gate; nothing
    // after them should inherit a 1 GB machine.
    delete navigator.deviceMemory;
    vi.restoreAllMocks();
});

/** A file whose first bytes really are `%PDF-`, which is what the sniff reads. */
function pdf(name, { size = 2_000_000 } = {}) {
    return imageFile(name, 'other', { size, type: 'application/pdf' });
}

/** Drops files on the panel and waits for every page count to come back. */
async function addFiles(files) {
    const input = document.getElementById('merge-file');
    setInputFiles(input, files);
    await act(async () => {
        input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await waitFor(() => expect(screen.queryByText(/reading the pages/i)).toBeNull());
}

function rows() {
    return within(screen.getByRole('list', { name: 'Document order' })).getAllByRole('listitem');
}

/** The visible order, read off the rows rather than off the state. */
function documentOrder() {
    return rows()
        .map((row) => within(row).queryByTitle(/\.pdf$/i)?.textContent)
        .filter(Boolean);
}

function moveButton(name, direction) {
    return screen.getByRole('button', { name: new RegExp(`Move ${name} ${direction}`, 'i') });
}

function combineButton() {
    return screen.getByRole('button', { name: /^Combine/i });
}

/** What the page most recently handed the worker: [op, files, options]. */
function lastJob() {
    const call = harness.process.mock.calls.at(-1);
    return call ? { op: call[0], files: call[1], options: call[2] } : null;
}

function ldNodes(container) {
    const script = container.querySelector('script[type="application/ld+json"]');
    return JSON.parse(script.textContent);
}

/* ------------------------------------------------------------------ *
 * The page: indexable, and its markup describes what it renders
 * ------------------------------------------------------------------ */

describe('the /merge-pdf page satisfies the indexable-page checklist', () => {
    it('is in the registry that drives the sitemap, the nav and the related blocks', () => {
        const tool = getTool('merge-pdf');

        expect(tool).toBeTruthy();
        expect(tool.hasOwnPage).toBe(true);
        expect(tool.href).toBe('/merge-pdf');
    });

    it('carries its own canonical rather than inheriting the layout’s', () => {
        expect(metadata.alternates.canonical).toBe(absoluteUrl('/merge-pdf'));
        expect(metadata.openGraph.url).toBe(absoluteUrl('/merge-pdf'));
        expect(metadata.robots.index).toBe(true);
    });

    it('targets the real query in the title and describes the job in the description', () => {
        expect(metadata.title).toMatch(/Merge PDF/i);
        expect(metadata.description).toMatch(/one document/i);
        expect(metadata.description).toMatch(/order/i);
    });

    it('renders exactly one h1', () => {
        render(<MergePdfPage />);
        expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    });

    it('emits the four graphs the other tool pages emit', () => {
        const { container } = render(<MergePdfPage />);
        const types = ldNodes(container).map((node) => node['@type']);

        expect(types).toEqual(['SoftwareApplication', 'BreadcrumbList', 'HowTo', 'FAQPage']);
    });

    it('marks up a HowTo whose steps are the steps the page shows', () => {
        const { container } = render(<MergePdfPage />);
        const howTo = ldNodes(container).find((node) => node['@type'] === 'HowTo');

        expect(howTo['@id']).toBe(`${absoluteUrl('/merge-pdf')}#howto`);
        expect(howTo.url).toContain('#how-to-merge-pdf');

        const visible = screen.getByRole('region', { name: /How to combine PDFs into one file/i });
        const rendered = within(visible).getAllByRole('listitem').map((item) => item.textContent);

        expect(rendered).toHaveLength(howTo.step.length);
        for (const step of howTo.step) {
            expect(rendered.some((text) => text.includes(step.name))).toBe(true);
            expect(rendered.some((text) => text.includes(step.text))).toBe(true);
        }
    });

    it('marks up an FAQ that answers what people actually ask', () => {
        const { container } = render(<MergePdfPage />);
        const faq = ldNodes(container).find((node) => node['@type'] === 'FAQPage');
        const questions = faq.mainEntity.map((entry) => entry.name).join(' ');

        for (const pattern of [/order/i, /password/i, /some pages/i, /uploaded/i, /quality/i, /how many/i]) {
            expect(questions, `no FAQ covers ${pattern}`).toMatch(pattern);
        }

        // Every marked-up answer is visible on the page, or the markup is a
        // manual-action risk rather than a ranking trick.
        for (const entry of faq.mainEntity) {
            expect(screen.getByText(entry.name)).toBeInTheDocument();
        }
    });

    it('answers the password question with a no and the reason for it', () => {
        const { container } = render(<MergePdfPage />);
        const faq = ldNodes(container).find((node) => node['@type'] === 'FAQPage');
        const locked = faq.mainEntity.find((entry) => /password/i.test(entry.name));

        expect(locked.acceptedAnswer.text).toMatch(/^No/);
        expect(locked.acceptedAnswer.text).toMatch(/blank/i);
    });

    it('renders the direct answer paragraph, at every width', () => {
        render(<MergePdfPage />);

        const answer = screen.getByText(/Merging PDFs means writing the pages/i);
        expect(answer).toBeInTheDocument();
        expect(answer.className).not.toMatch(/hidden/);
    });

    it('never positions itself as a PDF suite — it is one more tool in the same list', () => {
        const { container } = render(<MergePdfPage />);
        expect(container.textContent).not.toMatch(/PDF tools/i);

        for (const link of screen.getAllByRole('link')) {
            expect(link.getAttribute('href')).not.toBe('/pdf');
        }
    });

    it('claims no transfer anywhere in its copy', () => {
        const { container } = render(<MergePdfPage />);
        const text = container.textContent;

        for (const claim of [/\buploaded to\b/i, /\bour servers?\b/i, /\bdeleted after\b/i, /\boffline\b/i]) {
            expect(text, `the page claims ${claim}`).not.toMatch(claim);
        }
    });
});

/* ------------------------------------------------------------------ *
 * The order is the interaction
 * ------------------------------------------------------------------ */

describe('document order can be set without a mouse', () => {
    it('numbers every row with the position it holds, and shows its page count', async () => {
        harness.pages = new Map([['a.pdf', 4], ['b.pdf', 2]]);
        render(<MergePdfTool />);
        await addFiles([pdf('a.pdf'), pdf('b.pdf')]);

        const list = rows();
        expect(list).toHaveLength(2);
        expect(list[0]).toHaveTextContent('Document 1');
        expect(list[0]).toHaveTextContent('4 pages');
        expect(list[1]).toHaveTextContent('2 pages');
        expect(screen.getByText(/6 pages out, in the order below/i)).toBeInTheDocument();
    });

    it('moves a row with the keyboard alone', async () => {
        const user = userEvent.setup();
        render(<MergePdfTool />);
        await addFiles([pdf('a.pdf'), pdf('b.pdf'), pdf('c.pdf')]);

        const up = moveButton('c.pdf', 'up');
        // Focused and driven by a key press, never by a synthetic pointer: a
        // drag-only reorder would fail here, which is the point of the test.
        await act(async () => up.focus());
        expect(up).toHaveFocus();
        await user.keyboard('{Enter}');

        expect(documentOrder()).toEqual(['a.pdf', 'c.pdf', 'b.pdf']);

        const down = moveButton('a.pdf', 'down');
        await act(async () => down.focus());
        await user.keyboard(' ');

        expect(documentOrder()).toEqual(['c.pdf', 'a.pdf', 'b.pdf']);
    });

    it('names the position a move lands on, so the control is not a bare arrow', async () => {
        render(<MergePdfTool />);
        await addFiles([pdf('a.pdf'), pdf('b.pdf')]);

        expect(moveButton('b.pdf', 'up')).toHaveAccessibleName('Move b.pdf up to position 1');
        expect(moveButton('a.pdf', 'down')).toHaveAccessibleName('Move a.pdf down to position 2');
    });

    it('disables the move that would fall off either end, and names no position that does not exist', async () => {
        render(<MergePdfTool />);
        await addFiles([pdf('a.pdf'), pdf('b.pdf')]);

        expect(screen.getByRole('button', { name: 'a.pdf is already first' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'b.pdf is already last' })).toBeDisabled();

        for (const button of screen.getAllByRole('button')) {
            expect(button.getAttribute('aria-label') ?? '').not.toMatch(/position 0\b|position 3\b/);
        }
    });

    it('hands the engine the files in the order shown, not the order they arrived', async () => {
        const user = userEvent.setup();
        render(<MergePdfTool />);
        await addFiles([pdf('a.pdf'), pdf('b.pdf'), pdf('c.pdf')]);

        await user.click(moveButton('c.pdf', 'up'));
        await user.click(moveButton('c.pdf', 'up'));
        await user.click(combineButton());

        const job = lastJob();
        expect(job.op).toBe('merge');
        expect(job.files.map((file) => file.name)).toEqual(['c.pdf', 'a.pdf', 'b.pdf']);
        // One plan step per file, in the same order, so the list on screen and
        // the instruction the engine gets are the same statement.
        expect(job.options.plan).toEqual([
            { fileIndex: 0, pageIndices: null },
            { fileIndex: 1, pageIndices: null },
            { fileIndex: 2, pageIndices: null },
        ]);
    });

    it('drops a row out of the set without disturbing the rest', async () => {
        const user = userEvent.setup();
        render(<MergePdfTool />);
        await addFiles([pdf('a.pdf'), pdf('b.pdf'), pdf('c.pdf')]);

        await user.click(screen.getByRole('button', { name: /Remove: b\.pdf/i }));
        expect(documentOrder()).toEqual(['a.pdf', 'c.pdf']);
    });
});

/* ------------------------------------------------------------------ *
 * Choosing pages, without making it the default
 * ------------------------------------------------------------------ */

describe('every page of every file is the default, and choosing is one row at a time', () => {
    it('takes everything with no extra input, which is the whole default path', async () => {
        const user = userEvent.setup();
        harness.pages = new Map([['a.pdf', 4], ['b.pdf', 2]]);
        render(<MergePdfTool />);
        await addFiles([pdf('a.pdf'), pdf('b.pdf')]);

        expect(screen.getByRole('combobox', { name: 'Pages from a.pdf' })).toHaveValue('all');
        expect(screen.queryByRole('textbox', { name: /Which pages/i })).toBeNull();

        await user.click(combineButton());
        expect(lastJob().options.plan.every((step) => step.pageIndices === null)).toBe(true);
    });

    it('turns typed page numbers into the 0-based indices the engine takes', async () => {
        const user = userEvent.setup();
        harness.pages = new Map([['a.pdf', 9], ['b.pdf', 2]]);
        render(<MergePdfTool />);
        await addFiles([pdf('a.pdf'), pdf('b.pdf')]);

        await user.selectOptions(screen.getByRole('combobox', { name: 'Pages from a.pdf' }), 'some');
        await user.type(screen.getByRole('textbox', { name: 'Which pages from a.pdf' }), '1-3, 7');

        expect(screen.getByText(/9 pages · taking 4/)).toBeInTheDocument();

        await user.click(combineButton());
        expect(lastJob().options.plan).toEqual([
            { fileIndex: 0, pageIndices: [0, 1, 2, 6] },
            { fileIndex: 1, pageIndices: null },
        ]);
    });

    it('refuses a page the file does not have, in the box rather than after the button', async () => {
        const user = userEvent.setup();
        harness.pages = new Map([['a.pdf', 2], ['b.pdf', 2]]);
        render(<MergePdfTool />);
        await addFiles([pdf('a.pdf'), pdf('b.pdf')]);

        await user.selectOptions(screen.getByRole('combobox', { name: 'Pages from a.pdf' }), 'some');
        await user.type(screen.getByRole('textbox', { name: 'Which pages from a.pdf' }), '5');

        expect(screen.getByText(/there is no page 5/i)).toBeInTheDocument();
        expect(combineButton()).toBeDisabled();
        expect(harness.process).not.toHaveBeenCalled();
    });

    it('tells the box which file it belongs to, so several rows are not one anonymous field', async () => {
        const user = userEvent.setup();
        harness.pages = new Map([['a.pdf', 5], ['b.pdf', 5]]);
        render(<MergePdfTool />);
        await addFiles([pdf('a.pdf'), pdf('b.pdf')]);

        await user.selectOptions(screen.getByRole('combobox', { name: 'Pages from b.pdf' }), 'some');

        const field = screen.getByRole('textbox', { name: 'Which pages from b.pdf' });
        expect(field).toBeInTheDocument();
        expect(screen.queryByRole('textbox', { name: 'Which pages from a.pdf' })).toBeNull();
    });
});

/* ------------------------------------------------------------------ *
 * Every refusal reaches a person as a sentence
 * ------------------------------------------------------------------ */

describe('a file that cannot be read is named as it lands', () => {
    it('says a PDF is password-protected and what to do about it, at intake', async () => {
        harness.pages = new Map([
            ['ok.pdf', 3],
            ['statement.pdf', Object.assign(new Error('statement.pdf is password-protected, so its pages cannot be read.'), {
                code: 'encrypted-pdf',
                suggestion: 'Remove the password in the app that made it, then add the file again.',
            })],
        ]);

        render(<MergePdfTool />);
        await addFiles([pdf('ok.pdf'), pdf('statement.pdf')]);

        const reason = screen.getByRole('alert');
        expect(reason).toHaveTextContent(/statement\.pdf is password-protected/);
        expect(reason).toHaveTextContent(/Remove the password in the app that made it/);

        // The bad file is out of the list and the good one is untouched.
        expect(documentOrder()).toEqual(['ok.pdf']);
    });

    it('keeps a damaged file out of the list with its own reason, not a generic one', async () => {
        harness.pages = new Map([
            ['torn.pdf', Object.assign(new Error('torn.pdf could not be read. The file looks damaged or incomplete.'), {
                code: 'damaged-pdf',
                suggestion: 'Try opening it in another app and saving a copy, then add that copy.',
            })],
        ]);

        render(<MergePdfTool />);
        await addFiles([pdf('torn.pdf')]);

        expect(screen.getByRole('alert')).toHaveTextContent(/looks damaged or incomplete/);
        expect(screen.queryByRole('list', { name: 'Document order' })).toBeNull();
    });

    it('refuses a file that is not a PDF by its bytes, before it is opened at all', async () => {
        render(<MergePdfTool />);
        await addFiles([imageFile('photo.pdf', 'jpeg')]);

        expect(screen.getByRole('alert')).toHaveTextContent(/not a PDF/i);
        expect(screen.queryByRole('list', { name: 'Document order' })).toBeNull();
    });
});

/**
 * A job at the published ceiling — four files at the 20 MB per-file cap — on a
 * device that reports 1 GB. That is under the batch limits the drop zone
 * enforces, so what refuses it is the capability gate and nothing else.
 */
function fillTheDevice() {
    Object.defineProperty(navigator, 'deviceMemory', { value: 1, configurable: true });
    return ['a.pdf', 'b.pdf', 'c.pdf', 'd.pdf'].map((name) => pdf(name, { size: MAX_FILE_SIZE }));
}

describe('a device that cannot do the job is told so', () => {
    it('shows the memory gate’s refusal and its suggestion as the panel error', async () => {
        const user = userEvent.setup();
        const files = fillTheDevice();

        render(<MergePdfTool />);
        await addFiles(files);
        await user.click(combineButton());

        const alert = await screen.findByRole('alert');
        expect(alert).toHaveTextContent(/of memory to combine/i);
        expect(alert).toHaveTextContent(/can only spare about/i);
        expect(alert).toHaveTextContent(/Combine fewer at a time/i);
        // Refused before anything was handed to the worker, which is the point
        // of a gate that runs first.
        expect(harness.process).not.toHaveBeenCalled();
    });

    it('refuses a batch past the published total before the gate is even asked', async () => {
        render(<MergePdfTool />);
        await addFiles([
            pdf('a.pdf', { size: MAX_BULK_TOTAL_BYTES * 0.7 }),
            pdf('b.pdf', { size: MAX_BULK_TOTAL_BYTES * 0.7 }),
        ]);

        expect(screen.getByRole('alert')).toHaveTextContent(/add up to more than/i);
        expect(screen.queryByRole('list', { name: 'Document order' })).toBeNull();
    });

    it('lets a PDF past the pre-flight at all — the default gate is an image gate', async () => {
        const user = userEvent.setup();

        render(<MergePdfTool />);
        await addFiles([pdf('a.pdf'), pdf('b.pdf')]);
        await user.click(combineButton());

        expect(harness.process).toHaveBeenCalledTimes(1);
        expect(screen.queryByRole('alert')).toBeNull();
    });

    it('prints the engine’s own failure with the fix, not just the complaint', async () => {
        const user = userEvent.setup();
        harness.process = vi.fn(() => Promise.reject(Object.assign(
            new Error('statement.pdf is password-protected, so its pages cannot be read.'),
            { code: 'encrypted-pdf', suggestion: 'Remove the password in the app that made it, then add the file again.' },
        )));

        render(<MergePdfTool />);
        await addFiles([pdf('a.pdf'), pdf('b.pdf')]);
        await user.click(combineButton());

        const alert = await screen.findByRole('alert');
        expect(alert).toHaveTextContent(/password-protected/);
        expect(alert).toHaveTextContent(/Remove the password in the app that made it/);
    });

    it('never says the fix twice, whichever of the two refusal paths it came down', async () => {
        // The gate joins its suggestion onto the reason AND reports it
        // separately; an engine failure only reports it separately. A panel
        // that concatenated blindly would say this one twice.
        const user = userEvent.setup();
        const files = fillTheDevice();

        render(<MergePdfTool />);
        await addFiles(files);
        await user.click(combineButton());

        const alert = await screen.findByRole('alert');
        const said = alert.textContent.match(/Combine fewer at a time/gi) ?? [];
        expect(said).toHaveLength(1);
    });

    it('leaves the action off until there are two documents to combine', async () => {
        render(<MergePdfTool />);

        expect(combineButton()).toBeDisabled();
        expect(screen.getByText('Add two or more PDFs to turn this on.')).toBeInTheDocument();

        await addFiles([pdf('a.pdf')]);
        expect(combineButton()).toBeDisabled();

        await addFiles([pdf('b.pdf')]);
        expect(combineButton()).toBeEnabled();
    });
});

/* ------------------------------------------------------------------ *
 * The result, and the promise underneath all of it
 * ------------------------------------------------------------------ */

describe('the result reports the document that came out', () => {
    it('prints the page count, the real size and a download button', async () => {
        const user = userEvent.setup();
        harness.process = vi.fn(() => Promise.resolve({
            blob: new Blob([new Uint8Array(8)], { type: 'application/pdf' }),
            filename: 'resizo-merged-a.pdf',
            format: 'pdf',
            originalBytes: 4_000_000,
            resultBytes: 4_020_000,
            pageCount: 6,
        }));

        render(<MergePdfTool />);
        await addFiles([pdf('a.pdf'), pdf('b.pdf')]);
        await user.click(combineButton());

        expect(await screen.findByRole('button', { name: /Download PDF/i })).toBeInTheDocument();
        expect(screen.getByText(/6 pages, in the order shown above/i)).toBeInTheDocument();
        expect(screen.getByText(/nothing was re-drawn and no quality was lost/i)).toBeInTheDocument();
        expect(screen.getByTitle('resizo-merged-a.pdf')).toBeInTheDocument();
    });
});

describe('nothing leaves the tab', () => {
    it('sends nothing anywhere, through any of the three routes out of a browser', async () => {
        const user = userEvent.setup();
        render(<MergePdfTool />);
        await addFiles([pdf('a.pdf'), pdf('b.pdf')]);
        await user.click(combineButton());

        expect(network.calls).toHaveLength(0);
    });

    it('tears the worker down when the page goes away, rather than leaving it warm', async () => {
        const { unmount } = render(<MergePdfTool />);
        await addFiles([pdf('a.pdf'), pdf('b.pdf')]);

        expect(harness.terminate).not.toHaveBeenCalled();
        unmount();
        expect(harness.terminate).toHaveBeenCalledTimes(1);
    });
});
