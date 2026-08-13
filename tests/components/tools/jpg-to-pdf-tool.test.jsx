/**
 * /jpg-to-pdf — the page and the panel.
 *
 * The engine is proved against real bytes in tests/lib/image-client/pdf.test.js.
 * What is asserted here is everything that decides whether the page is honest
 * and reachable:
 *
 *   - the indexable-page checklist: one h1, its own canonical, and a JSON-LD
 *     graph whose HowTo describes the step list the page really renders;
 *   - the ORDER, which is the whole interaction. It has to be settable from the
 *     keyboard, it has to be visible as page numbers, and the list the engine is
 *     handed has to be in that order rather than in the order the files arrived;
 *   - the PNG admission. A PNG cannot go onto a page without being re-drawn as a
 *     JPEG, and the panel has to say so BEFORE the button is pressed rather than
 *     leaving somebody to discover it in the output;
 *   - the capability gate's refusal reaching the panel as words.
 *
 * useLocalProcess is the seam and is stubbed, exactly as the /compress suite
 * stubs it: the point is what the page says and what it submits, not what the
 * codecs return.
 */
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import JpgToPdfPage, { metadata } from '@/app/(tools)/jpg-to-pdf/page';
import JpgToPdfTool from '@/app/(tools)/jpg-to-pdf/JpgToPdfTool';
import { getTool } from '@/lib/catalog';
import { absoluteUrl } from '@/lib/seo';
import { imageFile, installNetworkSentinel, setInputFiles, stubImageProbe } from '../helpers';

const harness = vi.hoisted(() => ({
    submit: null,
    setResult: null,
    error: null,
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
                error: harness.error,
                result,
                setError: () => {},
                phase: null,
                suggestion: null,
            };
        },
    };
});

let probe;
let network;

beforeEach(() => {
    probe = stubImageProbe({ width: 1200, height: 800 });
    network = installNetworkSentinel();
    harness.submit = vi.fn();
    harness.setResult = null;
    harness.error = null;
});

afterEach(() => {
    probe.restore();
    network.restore();
});

/** Drops files on the panel and waits for the dimension probes to settle. */
async function addFiles(files) {
    const input = document.getElementById('pdf-file');
    setInputFiles(input, files);
    await act(async () => {
        input.dispatchEvent(new Event('change', { bubbles: true }));
    });
}

function jpeg(name) {
    return imageFile(name, 'jpeg', { size: 2_000_000 });
}

function png(name = 'scan.png') {
    return imageFile(name, 'png', { size: 900_000 });
}

function heic(name = 'IMG_0042.HEIC') {
    return imageFile(name, 'heic', { size: 1_600_000 });
}

/** The rows of the page-order list, which is not the only list on the page. */
function rows() {
    return within(screen.getByRole('list', { name: 'Page order' })).getAllByRole('listitem');
}

/** The visible page order, read off the rows rather than off the state. */
function pageOrder() {
    return rows()
        .map((row) => within(row).queryByTitle(/\.(jpg|png|heic)$/i)?.textContent)
        .filter(Boolean);
}

/** The info notice whose text matches, since the panel can show more than one. */
function notice(pattern) {
    return screen.queryAllByRole('status').find((node) => pattern.test(node.textContent)) ?? null;
}

function moveButton(name, direction) {
    return screen.getByRole('button', { name: new RegExp(`Move ${name} ${direction}`, 'i') });
}

/** Whatever the page most recently handed the seam. */
function lastPayload() {
    return harness.submit.mock.calls.at(-1)?.[0];
}

function ldNodes(container) {
    const script = container.querySelector('script[type="application/ld+json"]');
    return JSON.parse(script.textContent);
}

/* ------------------------------------------------------------------ *
 * The page: indexable, and its markup describes what it renders
 * ------------------------------------------------------------------ */

describe('the /jpg-to-pdf page satisfies the indexable-page checklist', () => {
    it('is in the tool registry with a page of its own at its slug', () => {
        const tool = getTool('jpg-to-pdf');

        expect(tool).toBeTruthy();
        expect(tool.hasOwnPage).toBe(true);
        expect(tool.href).toBe('/jpg-to-pdf');
    });

    it('carries its own canonical rather than inheriting the layout’s', () => {
        expect(metadata.alternates.canonical).toBe(absoluteUrl('/jpg-to-pdf'));
        expect(metadata.openGraph.url).toBe(absoluteUrl('/jpg-to-pdf'));
        expect(metadata.robots.index).toBe(true);
    });

    it('targets the query in the title while the description tells the truth about the other formats', () => {
        expect(metadata.title).toMatch(/JPG to PDF/i);
        expect(metadata.description).toMatch(/PNG/);
        expect(metadata.description).toMatch(/WebP/);
        expect(metadata.description).toMatch(/HEIC/);
    });

    it('renders exactly one h1', () => {
        render(<JpgToPdfPage />);
        expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    });

    it('emits the four graphs the other tool pages emit', () => {
        const { container } = render(<JpgToPdfPage />);
        const types = ldNodes(container).map((node) => node['@type']);

        expect(types).toEqual(['SoftwareApplication', 'BreadcrumbList', 'HowTo', 'FAQPage']);
    });

    it('marks up a HowTo whose steps are the steps the page shows', () => {
        const { container } = render(<JpgToPdfPage />);
        const howTo = ldNodes(container).find((node) => node['@type'] === 'HowTo');

        expect(howTo['@id']).toBe(`${absoluteUrl('/jpg-to-pdf')}#howto`);
        expect(howTo.url).toContain('#how-to-jpg-to-pdf');

        const visible = screen.getByRole('region', { name: /How to combine photos into a PDF/i });
        const rendered = within(visible).getAllByRole('listitem').map((item) => item.textContent);

        expect(rendered).toHaveLength(howTo.step.length);
        for (const step of howTo.step) {
            expect(rendered.some((text) => text.includes(step.name))).toBe(true);
            expect(rendered.some((text) => text.includes(step.text))).toBe(true);
        }
    });

    it('marks up an FAQ that answers the questions people actually ask', () => {
        const { container } = render(<JpgToPdfPage />);
        const faq = ldNodes(container).find((node) => node['@type'] === 'FAQPage');
        const questions = faq.mainEntity.map((entry) => entry.name).join(' ');

        for (const pattern of [/order/i, /uploaded/i, /mix/i, /page size/i, /limit/i, /EXIF/i]) {
            expect(questions, `no FAQ covers ${pattern}`).toMatch(pattern);
        }

        // Every marked-up answer is visible on the page, or the markup is a
        // manual-action risk rather than a ranking trick.
        for (const entry of faq.mainEntity) {
            expect(screen.getByText(entry.name)).toBeInTheDocument();
        }
    });

    it('never positions itself as a PDF suite — it is an image tool with a document output', () => {
        const { container } = render(<JpgToPdfPage />);
        expect(container.textContent).not.toMatch(/PDF tools/i);

        for (const link of screen.getAllByRole('link')) {
            expect(link.getAttribute('href')).not.toBe('/pdf');
        }
    });
});

/* ------------------------------------------------------------------ *
 * The order is the interaction
 * ------------------------------------------------------------------ */

describe('page order can be set without a mouse', () => {
    it('numbers every row with the page it will become', async () => {
        render(<JpgToPdfTool />);
        await addFiles([jpeg('a.jpg'), jpeg('b.jpg'), jpeg('c.jpg')]);

        const list = rows();
        expect(list).toHaveLength(3);
        expect(list[0]).toHaveTextContent('Page 1');
        expect(list[2]).toHaveTextContent('Page 3');
        expect(pageOrder()).toEqual(['a.jpg', 'b.jpg', 'c.jpg']);
    });

    it('moves a row with the keyboard alone', async () => {
        const user = userEvent.setup();
        render(<JpgToPdfTool />);
        await addFiles([jpeg('a.jpg'), jpeg('b.jpg'), jpeg('c.jpg')]);

        const up = moveButton('c.jpg', 'up');
        // Focused and driven by a key press, never by a synthetic pointer: a
        // drag-only reorder would fail here, which is the point of the test.
        await act(async () => up.focus());
        expect(up).toHaveFocus();
        await user.keyboard('{Enter}');

        expect(pageOrder()).toEqual(['a.jpg', 'c.jpg', 'b.jpg']);

        const down = moveButton('a.jpg', 'down');
        await act(async () => down.focus());
        await user.keyboard(' ');

        expect(pageOrder()).toEqual(['c.jpg', 'a.jpg', 'b.jpg']);
    });

    it('names the page a move lands on, so the control is not a bare arrow', async () => {
        render(<JpgToPdfTool />);
        await addFiles([jpeg('a.jpg'), jpeg('b.jpg')]);

        expect(moveButton('b.jpg', 'up')).toHaveAccessibleName('Move b.jpg up to page 1');
        expect(moveButton('a.jpg', 'down')).toHaveAccessibleName('Move a.jpg down to page 2');
    });

    it('disables the move that would fall off either end, and never names a page that does not exist', async () => {
        render(<JpgToPdfTool />);
        await addFiles([jpeg('a.jpg'), jpeg('b.jpg')]);

        // A disabled button is still announced. "up to page 0" and "down to
        // page 3" were both real, and both were nonsense.
        const first = screen.getByRole('button', { name: 'a.jpg is already page 1' });
        const lastRow = screen.getByRole('button', { name: 'b.jpg is already the last page' });

        expect(first).toBeDisabled();
        expect(lastRow).toBeDisabled();
        expect(moveButton('a.jpg', 'down')).toBeEnabled();

        for (const button of screen.getAllByRole('button')) {
            expect(button.getAttribute('aria-label') ?? '').not.toMatch(/page 0\b|page 3\b/);
        }
    });

    it('hands the engine the files in the order shown, not the order they arrived', async () => {
        const user = userEvent.setup();
        render(<JpgToPdfTool />);
        await addFiles([jpeg('a.jpg'), jpeg('b.jpg'), jpeg('c.jpg')]);

        await user.click(moveButton('c.jpg', 'up'));
        await user.click(moveButton('c.jpg', 'up'));
        await user.click(screen.getByRole('button', { name: /Make a 3-page PDF/i }));

        const payload = lastPayload();
        expect(payload.file.map((file) => file.name)).toEqual(['c.jpg', 'a.jpg', 'b.jpg']);
        // The measurements ride along in the same order, or the memory gate is
        // costing the wrong page.
        expect(payload.sizes).toEqual([
            { width: 1200, height: 800 },
            { width: 1200, height: 800 },
            { width: 1200, height: 800 },
        ]);
    });

    it('drops a row out of the set without disturbing the rest', async () => {
        const user = userEvent.setup();
        render(<JpgToPdfTool />);
        await addFiles([jpeg('a.jpg'), jpeg('b.jpg'), jpeg('c.jpg')]);

        await user.click(screen.getByRole('button', { name: /Remove: b\.jpg/i }));
        expect(pageOrder()).toEqual(['a.jpg', 'c.jpg']);
    });
});

/* ------------------------------------------------------------------ *
 * What gets said before the button is pressed
 * ------------------------------------------------------------------ */

describe('the panel admits what will be re-drawn before anything runs', () => {
    it('says nothing when every file takes the free lane', async () => {
        render(<JpgToPdfTool />);
        await addFiles([jpeg('a.jpg'), jpeg('b.jpg')]);

        expect(screen.queryByRole('status')).toBeNull();
    });

    it('names the formats that have to become JPEGs, and what happens to transparency', async () => {
        render(<JpgToPdfTool />);
        await addFiles([jpeg('a.jpg'), png(), heic()]);

        const note = screen.getByRole('status');
        expect(note).toHaveTextContent(/2 of these are PNG or HEIC/i);
        expect(note).toHaveTextContent(/re-drawn as JPEGs at quality 88/i);
        expect(note).toHaveTextContent(/see-through areas turn white/i);
        // The one thing a format check cannot see, said out loud rather than
        // discovered in the output.
        expect(note).toHaveTextContent(/saved it sideways/i);
    });

    it('takes a HEIC with no thumbnail rather than rejecting it as damaged', async () => {
        // No browser outside Safari decodes a HEIC, so the dimension probe would
        // fail it. It is accepted, labelled, and left for the engine to measure.
        probe.configure({ fail: true });
        render(<JpgToPdfTool />);
        await addFiles([heic()]);

        expect(pageOrder()).toEqual(['IMG_0042.HEIC']);
        expect(screen.getByText('HEIC')).toBeInTheDocument();
        expect(lastPayload()).toBeUndefined();
    });
});

/* ------------------------------------------------------------------ *
 * Settings, the size target, and the result
 * ------------------------------------------------------------------ */

describe('the settings reach the engine as the engine names them', () => {
    it('defaults to a page shaped like the photo and sends no size target', async () => {
        const user = userEvent.setup();
        render(<JpgToPdfTool />);
        await addFiles([jpeg('a.jpg')]);

        await user.click(screen.getByRole('button', { name: /^Make PDF$/i }));

        expect(lastPayload()).toMatchObject({ pageSize: 'fit', margin: '0' });
        expect(lastPayload().targetBytes).toBeUndefined();
    });

    it('reveals orientation and margin only for a fixed sheet, and posts them', async () => {
        const user = userEvent.setup();
        render(<JpgToPdfTool />);
        await addFiles([jpeg('a.jpg')]);

        expect(screen.queryByRole('radio', { name: 'Landscape' })).toBeNull();

        await user.click(screen.getByRole('radio', { name: 'A4' }));
        await user.click(screen.getByRole('radio', { name: 'Landscape' }));
        await user.selectOptions(screen.getByRole('combobox', { name: 'Margin' }), '36');
        await user.click(screen.getByRole('button', { name: /^Make PDF$/i }));

        expect(lastPayload()).toMatchObject({
            pageSize: 'a4',
            pageOrientation: 'landscape',
            margin: '36',
        });
    });

    it('posts a maximum size in bytes and refuses an out-of-range one', async () => {
        const user = userEvent.setup();
        render(<JpgToPdfTool />);
        await addFiles([jpeg('a.jpg')]);

        await user.click(screen.getByRole('radio', { name: /Aim for a maximum size/i }));

        const field = screen.getByRole('spinbutton', { name: /Maximum size/i });
        await user.clear(field);
        await user.type(field, '1');

        // 1 KB is below the floor, so the button is off and the reason is shown.
        await user.selectOptions(screen.getByRole('combobox', { name: 'Maximum size unit' }), 'KB');
        expect(screen.getByRole('button', { name: /^Make PDF$/i })).toBeDisabled();
        expect(screen.getByText(/Pick a maximum between/i)).toBeInTheDocument();

        await user.selectOptions(screen.getByRole('combobox', { name: 'Maximum size unit' }), 'MB');
        await user.click(screen.getByRole('button', { name: /^Make PDF$/i }));

        expect(lastPayload().targetBytes).toBe(String(1024 * 1024));
    });
});

describe('the result panel reports the document, not a guess', () => {
    const built = {
        blob: new Blob([new Uint8Array(8)], { type: 'application/pdf' }),
        filename: 'resizo-a.pdf',
        format: 'pdf',
        originalBytes: 4_000_000,
        resultBytes: 4_060_000,
        pageCount: 3,
        reencodedCount: 1,
        targetBytes: null,
        targetMet: null,
        targetMessage: null,
    };

    async function showResult(payload) {
        render(<JpgToPdfTool />);
        await addFiles([jpeg('a.jpg'), jpeg('b.jpg'), png()]);
        await act(async () => harness.setResult(payload));
    }

    it('prints the page count, the real size and a download button', async () => {
        await showResult(built);

        expect(screen.getByRole('button', { name: /Download PDF/i })).toBeInTheDocument();
        expect(screen.getByText(/3 pages, in the order shown above/i)).toBeInTheDocument();
        expect(screen.getByText(/1 image was re-drawn as a JPEG/i)).toHaveTextContent(/the rest went in untouched/i);
    });

    it('does not claim a rest went in untouched when every page was re-drawn', async () => {
        // A size target re-draws all of them, which is exactly when the second
        // half of that sentence stops being true.
        await showResult({ ...built, reencodedCount: 3, targetBytes: 1024 * 1024, targetMet: true });

        const line = screen.getByText(/3 images were re-drawn as JPEGs/i);
        expect(line).toHaveTextContent(/re-drawn as JPEGs to become pages\./i);
        expect(line).not.toHaveTextContent(/untouched/i);
    });

    it('quotes the target it was given and what actually came out', async () => {
        await showResult({ ...built, resultBytes: 900_000, targetBytes: 1024 * 1024, targetMet: true });

        expect(screen.getByText(/Asked for at most 1 MB/i)).toHaveTextContent(/came out at 878\.91 KB/i);
        expect(notice(/smallest this PDF gets/i)).toBeNull();
    });

    it('says a missed target was missed, in the engine’s own words', async () => {
        await showResult({
            ...built,
            resultBytes: 1_400_000,
            targetBytes: 1024 * 1024,
            targetMet: false,
            targetMessage: 'Cannot reach 1024 KB for these images. The smallest this PDF gets is 1367 KB. Raise the target.',
        });

        expect(notice(/smallest this PDF gets/i)).toHaveTextContent(/The smallest this PDF gets is 1367 KB/);
    });

    it('treats an absent targetMet as "not reported", never as a miss', async () => {
        const { targetMet, ...withoutTheField } = built;
        await showResult({ ...withoutTheField, targetBytes: 1024 * 1024 });

        expect(notice(/smallest this PDF gets/i)).toBeNull();
    });
});

/* ------------------------------------------------------------------ *
 * The gate, and the promise underneath all of it
 * ------------------------------------------------------------------ */

describe('a device that cannot do the job is told so', () => {
    it('shows the gate’s refusal and its suggestion as the panel error', async () => {
        harness.error = 'These 20 images need about 900 MB of memory to turn into a PDF, and this device '
            + 'can only spare about 380 MB. Make the PDF from fewer images at a time, or try it on a computer.';

        render(<JpgToPdfTool />);
        await addFiles([jpeg('a.jpg')]);

        const alert = screen.getByRole('alert');
        expect(alert).toHaveTextContent(/can only spare about 380 MB/);
        expect(alert).toHaveTextContent(/fewer images at a time/);
    });

    it('leaves the action off until there is something to build from', () => {
        render(<JpgToPdfTool />);

        expect(screen.getByRole('button', { name: /^Make PDF$/i })).toBeDisabled();
        expect(screen.getByText('Add images to turn this on.')).toBeInTheDocument();
    });

    it('sends nothing anywhere, through any of the three routes out of a tab', async () => {
        const user = userEvent.setup();
        render(<JpgToPdfTool />);
        await addFiles([jpeg('a.jpg'), png()]);
        await user.click(screen.getByRole('button', { name: /Make a 2-page PDF/i }));

        expect(network.calls).toHaveLength(0);
    });
});
