/**
 * PrintSheetTool
 *
 * Modelled on tests/components/tools/fit-tool.test.jsx and passport-tool.test.jsx:
 * FrameCrop and useLocalProcess are stubbed the same faithful way (this suite
 * tests PrintSheetTool's own logic, not their internals), and SheetPreview is
 * stubbed too — its own geometry is covered by sheet-preview.test.jsx, so here
 * it only needs to prove PrintSheetTool feeds it the right layout/crop props.
 *
 * `lib/format/print-sheet` and `lib/catalog/application-presets` and
 * `lib/catalog/paper-sizes` are all real — every one of them has landed and is
 * covered by its own suite, so the capacity/notice/enlargement numbers below
 * are asserted against the real arithmetic, not a stub's guess at it.
 */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { imageFile, setInputFiles, stubImageProbe } from '../helpers';

vi.mock('@/components/tools/FrameCrop', () => ({
    default: function FrameCropStub({ id, label, aspect, value, onChange }) {
        return (
            <div role="group" aria-label={label} id={id} tabIndex={0} data-testid="frame-crop" data-aspect={aspect}>
                <span data-testid="frame-rect">{JSON.stringify(value)}</span>
                <button type="button" onClick={() => onChange({ x: 1, y: 2, width: 10, height: 10 })}>
                    Simulate drag
                </button>
            </div>
        );
    },
}));

vi.mock('@/app/(tools)/passport-photo-print/SheetPreview', () => ({
    default: function SheetPreviewStub({ layout, cropRect }) {
        if (!layout) return null;
        return (
            <div data-testid="sheet-preview" data-copies={layout.copies} data-crop={JSON.stringify(cropRect ?? null)} />
        );
    },
}));

const harness = vi.hoisted(() => ({
    submit: null,
    setResult: null,
    setFailure: null,
}));

vi.mock('@/lib/hooks/useLocalProcess', async () => {
    const { useState } = await import('react');

    return {
        default: function useStubbedProcess() {
            const [result, setResult] = useState(null);
            const [failure, setFailure] = useState(null);

            harness.setResult = (value) => { setFailure(null); setResult(value); };
            harness.setFailure = (value) => { setResult(null); setFailure(value); };

            return {
                submit: (...args) => harness.submit(...args),
                download: () => {},
                reset: () => { setResult(null); setFailure(null); },
                cancel: () => {},
                isProcessing: false,
                progress: 0,
                error: failure?.error ?? null,
                result,
                setError: () => {},
                phase: null,
                suggestion: failure?.suggestion ?? null,
                code: failure?.code ?? null,
            };
        },
    };
});

const { default: PrintSheetTool } = await import('@/app/(tools)/passport-photo-print/PrintSheetTool');

let probe;

beforeEach(() => {
    probe = stubImageProbe({ width: 600, height: 600 });
    harness.submit = vi.fn();
    harness.setResult = null;
    harness.setFailure = null;
});

afterEach(() => {
    probe.restore();
});

async function mountWithPhoto({ width = 600, height = 600, name = 'photo.jpg' } = {}) {
    probe.configure({ width, height });
    const view = render(<PrintSheetTool />);
    const input = document.getElementById('sheet-file');
    setInputFiles(input, [imageFile(name, 'jpeg', { size: 400 * 1024 })]);
    await act(async () => {
        input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await act(async () => {});
    return view;
}

const actionButton = () => screen.getByRole('button', { name: /^create sheet$/i });
const advancedButton = () => screen.getByRole('button', { name: /^advanced options$/i });

async function openAdvanced(user) {
    await user.click(advancedButton());
}

/* -------------------------------------------------------------- intake */

describe('intake', () => {
    it('has a labelled dropzone at #sheet-file with a Browse files button', () => {
        render(<PrintSheetTool />);
        expect(document.getElementById('sheet-file')).toBeInTheDocument();
        expect(document.getElementById('sheet-file-browse')).toBeInTheDocument();
    });

    it('offers the sample photo before any file is chosen', async () => {
        const user = userEvent.setup();
        const fetched = [];
        const original = globalThis.fetch;
        globalThis.fetch = async (url) => { fetched.push(String(url)); return { ok: false }; };
        try {
            render(<PrintSheetTool />);
            await user.click(screen.getByRole('button', { name: /try the sample photo/i }));
        } finally {
            globalThis.fetch = original;
        }
        expect(fetched).toHaveLength(1);
        expect(fetched[0]).toMatch(/^\/samples\//);
    });
});

/* ---------------------------------------------------------- photo size */

describe('the Photo size chips', () => {
    it('offers the three physical presets by their registry labels, plus Custom, defaulting to the US preset', () => {
        render(<PrintSheetTool />);
        const group = screen.getByRole('group', { name: /^photo size$/i });
        expect(group).toBeInTheDocument();
        const us = screen.getByRole('button', { name: /united states.*2.*×.*2.*in/i });
        expect(us).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByRole('button', { name: /united kingdom.*35.*×.*45.*mm/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /india.*3\.5.*×.*4\.5.*cm/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /^custom$/i })).toBeInTheDocument();
    });

    it('shows the sourcing note and the passport-language disclaimer with links', () => {
        render(<PrintSheetTool />);
        expect(screen.getByText(/sizes come from the same verified presets as passport & id photo/i)).toBeInTheDocument();
        const disclaimer = screen.getByText(/resizo preserves the selected photo dimensions on the sheet/i);
        expect(disclaimer).toBeInTheDocument();
        const scope = within(disclaimer.closest('p'));
        expect(scope.getByRole('link', { name: /passport & id photo/i })).toHaveAttribute('href', '/passport-photo');
        expect(scope.getByRole('link', { name: /image size fitter/i })).toHaveAttribute('href', '/image-size-fitter');
    });

    it('reveals Width, Height and Unit only once Custom is chosen', async () => {
        const user = userEvent.setup();
        render(<PrintSheetTool />);
        expect(document.getElementById('sheet-photo-width')).toBeNull();

        await user.click(screen.getByRole('button', { name: /^custom$/i }));

        expect(document.getElementById('sheet-photo-width')).toBeInTheDocument();
        expect(document.getElementById('sheet-photo-height')).toBeInTheDocument();
        expect(document.getElementById('sheet-photo-unit')).toBeInTheDocument();
    });
});

/* ------------------------------------------------------------- paper */

describe('the Paper select', () => {
    it('lists the four registry papers and defaults to 4 × 6 in', () => {
        render(<PrintSheetTool />);
        const select = document.getElementById('sheet-paper');
        expect(select).toBeInTheDocument();
        expect(select).toHaveValue('4x6');
        const optionLabels = Array.from(select.querySelectorAll('option')).map((option) => option.textContent);
        expect(optionLabels).toEqual(['4 × 6 in', '5 × 7 in', 'Letter (8.5 × 11 in)', 'A4 (210 × 297 mm)']);
    });
});

/* --------------------------------------------------------- orientation */

describe('orientation', () => {
    it('defaults to Auto and shows the resolved orientation and capacity', async () => {
        await mountWithPhoto();
        const auto = screen.getByRole('radio', { name: /^auto — portrait fits 2$/i });
        expect(auto).toBeChecked();
        // US 2x2in on 4x6in paper at the 5mm/3mm defaults resolves to portrait, 2 copies.
        expect(screen.getByText(/auto — portrait fits 2/i)).toBeInTheDocument();
    });

    it('drops the resolved note once an explicit orientation is chosen', async () => {
        const user = userEvent.setup();
        await mountWithPhoto();
        await user.click(screen.getByRole('radio', { name: /^landscape$/i }));
        expect(screen.queryByText(/^auto —/i)).toBeNull();
    });
});

/* -------------------------------------------------------------- DPI */

describe('DPI', () => {
    it('defaults to 300 with the Resizo hint, always visible (not behind Advanced)', () => {
        render(<PrintSheetTool />);
        const dpi = document.getElementById('sheet-dpi');
        expect(dpi).toBeVisible();
        expect(dpi).toHaveValue(300);
        expect(screen.getByText(/resizo(&rsquo;|’)s print default — no authority is being quoted\./i)).toBeInTheDocument();
    });
});

/* ------------------------------------------------------------- copies */

describe('copies', () => {
    it('defaults to Fill the sheet, with #sheet-copies hidden', () => {
        render(<PrintSheetTool />);
        expect(screen.getByRole('radio', { name: /^fill the sheet$/i })).toBeChecked();
        expect(document.getElementById('sheet-copies')).toBeNull();
    });

    it('reveals #sheet-copies once Number of copies is chosen', async () => {
        const user = userEvent.setup();
        render(<PrintSheetTool />);
        await user.click(screen.getByRole('radio', { name: /^number of copies$/i }));
        expect(document.getElementById('sheet-copies')).toBeInTheDocument();
    });

    it('shows the capacity sentence, verbatim, when a typed count exceeds capacity', async () => {
        const user = userEvent.setup();
        await mountWithPhoto();
        await user.click(screen.getByRole('radio', { name: /^number of copies$/i }));
        fireEvent.change(document.getElementById('sheet-copies'), { target: { value: '9' } });

        const notice = document.getElementById('sheet-capacity');
        expect(notice).toBeInTheDocument();
        expect(notice).toHaveAttribute('role', 'status');
        expect(notice).toHaveTextContent('Only 2 photos fit on this sheet with the current size and spacing.');
    });
});

/* --------------------------------------------------------- advanced */

describe('Advanced options', () => {
    it('is collapsed by default and reveals Margin, Spacing, Cut guides, the reference checkbox and Fill behaviour', async () => {
        const user = userEvent.setup();
        render(<PrintSheetTool />);

        const button = advancedButton();
        expect(button).toHaveAttribute('id', 'sheet-advanced');
        expect(button).toHaveAttribute('aria-expanded', 'false');
        expect(document.getElementById('sheet-margin')).not.toBeVisible();

        await user.click(button);

        expect(button).toHaveAttribute('aria-expanded', 'true');
        expect(document.getElementById('sheet-margin')).toHaveValue(5);
        expect(screen.getByText(
            'Set 0 only for borderless printing — six 2 × 2 in photos fit a 4 × 6 sheet edge to edge, and most '
                + 'home printers cannot print to the edge.',
        )).toBeInTheDocument();
        expect(document.getElementById('sheet-gap')).toHaveValue(3);
        expect(screen.getByRole('radio', { name: /^off$/i })).toBeInTheDocument();
        expect(screen.getByRole('radio', { name: /^corner marks$/i })).toBeChecked();
        expect(screen.getByRole('radio', { name: /^full lines$/i })).toBeInTheDocument();
        const reference = screen.getByRole('checkbox', { name: /50 mm reference line/i });
        expect(reference).toBeChecked();
        expect(screen.getByText(/a short line in the bottom margin — measure it after printing\./i)).toBeInTheDocument();
        expect(screen.getByRole('radio', { name: /^crop to fill$/i })).toBeChecked();
        expect(screen.getByRole('radio', { name: /^fit inside$/i })).toBeInTheDocument();
    });

    it('shows the padding-colour control only once Fit inside is chosen', async () => {
        const user = userEvent.setup();
        render(<PrintSheetTool />);
        await openAdvanced(user);
        expect(screen.queryByText(/transparent areas become/i)).toBeNull();

        await user.click(screen.getByRole('radio', { name: /^fit inside$/i }));
        expect(screen.getByText(/transparent areas become/i)).toBeInTheDocument();
    });

    it('stays open while Margin or Spacing is genuinely invalid, closes once fixed', async () => {
        const user = userEvent.setup();
        render(<PrintSheetTool />);
        await openAdvanced(user);

        fireEvent.change(document.getElementById('sheet-margin'), { target: { value: '-1' } });
        expect(advancedButton()).toHaveAttribute('aria-expanded', 'true');

        await user.click(advancedButton());
        expect(advancedButton()).toHaveAttribute('aria-expanded', 'true');

        fireEvent.change(document.getElementById('sheet-margin'), { target: { value: '5' } });
        expect(advancedButton()).toHaveAttribute('aria-expanded', 'false');
    });
});

/* -------------------------------------------------------------- output */

describe('Output', () => {
    it('is visible without opening Advanced options, defaulting to JPEG', () => {
        render(<PrintSheetTool />);
        expect(screen.getByRole('radio', { name: /^jpeg$/i })).toBeChecked();
        expect(screen.getByRole('radio', { name: /^pdf$/i })).toBeInTheDocument();
    });
});

/* ------------------------------------------------------ aspect mismatch */

describe('a source photo whose shape does not match the chosen size', () => {
    it('names both ratios and links to the two prep tools', async () => {
        await mountWithPhoto({ width: 800, height: 600 });
        // 800x600 is 4:3; the default US preset target is 1:1.
        expect(screen.getByText(/this photo is 4:3 and the size you chose is 1:1\./i)).toBeInTheDocument();
        expect(screen.getByText(/crop to fill keeps the middle; fit inside pads the edges/i)).toBeInTheDocument();
    });

    it('says nothing when the source already matches the target shape', async () => {
        await mountWithPhoto({ width: 600, height: 600 });
        expect(screen.queryByText(/this photo is/i)).toBeNull();
    });
});

/* ---------------------------------------------------------- enlargement */

describe('enlargement', () => {
    it('names the source and target pixels when the source is smaller than the printed photo', async () => {
        await mountWithPhoto({ width: 300, height: 300 });
        expect(screen.getByText(/your source will be enlarged from 300 × 300 to 600 × 600 pixels\. printing it may look softer\./i)).toBeInTheDocument();
    });

    it('says nothing when the source is already large enough', async () => {
        await mountWithPhoto({ width: 1200, height: 1200 });
        expect(screen.queryByText(/will be enlarged/i)).toBeNull();
    });
});

/* -------------------------------------------------------------- frame */

describe('the crop frame', () => {
    it('renders #sheet-frame at the photo aspect under Crop to fill, and not under Fit inside', async () => {
        const user = userEvent.setup();
        await mountWithPhoto();
        expect(document.getElementById('sheet-frame')).toBeInTheDocument();

        await openAdvanced(user);
        await user.click(screen.getByRole('radio', { name: /^fit inside$/i }));
        expect(document.getElementById('sheet-frame')).toBeNull();
    });

    it('feeds the crop frame value straight to the preview as cropRect, with no second geometry', async () => {
        await mountWithPhoto();
        const preview = screen.getByTestId('sheet-preview');
        const frameRect = JSON.parse(screen.getByTestId('frame-rect').textContent);
        expect(JSON.parse(preview.dataset.crop)).toEqual(frameRect);
    });
});

/* -------------------------------------------------------------- submit */

describe('the job sent to the engine', () => {
    it('sends the sheet op’s own field names, in millimetres, at the defaults', async () => {
        const user = userEvent.setup();
        await mountWithPhoto();
        await user.click(actionButton());

        expect(harness.submit).toHaveBeenCalledTimes(1);
        const [form] = harness.submit.mock.calls[0];
        expect(form.get('paper_width_mm')).toBe('101.6');
        expect(form.get('paper_height_mm')).toBe('152.4');
        expect(form.get('orientation')).toBe('auto');
        expect(form.get('photo_width_mm')).toBe('50.8');
        expect(form.get('photo_height_mm')).toBe('50.8');
        expect(form.get('dpi')).toBe('300');
        expect(form.get('margin_mm')).toBe('5');
        expect(form.get('gap_mm')).toBe('3');
        expect(form.get('copies')).toBe('auto');
        expect(form.get('guides')).toBe('corners');
        expect(form.get('reference')).toBe('on');
        expect(form.get('output')).toBe('jpeg');
        expect(form.get('fit')).toBe('cover');
        expect(form.get('crop_x')).not.toBeNull();
        expect(form.get('crop_width')).not.toBeNull();
    });

    it('posts a typed copy count and switches reference off and guides off correctly', async () => {
        const user = userEvent.setup();
        await mountWithPhoto();
        await user.click(screen.getByRole('radio', { name: /^number of copies$/i }));
        fireEvent.change(document.getElementById('sheet-copies'), { target: { value: '1' } });
        await openAdvanced(user);
        await user.click(screen.getByRole('checkbox', { name: /50 mm reference line/i }));
        await user.click(screen.getByRole('radio', { name: /^off$/i }));
        await user.click(screen.getByRole('radio', { name: /^pdf$/i }));

        await user.click(actionButton());

        const [form] = harness.submit.mock.calls.at(-1);
        expect(form.get('copies')).toBe('1');
        expect(form.get('reference')).toBe('off');
        expect(form.get('guides')).toBe('none');
        expect(form.get('output')).toBe('pdf');
    });

    it('does not submit without a photo, and says why', () => {
        render(<PrintSheetTool />);
        expect(actionButton()).toBeDisabled();
        expect(screen.getByText('Add a photo to turn this on.')).toBeInTheDocument();
    });

    it('clears a finished result when a field changes', async () => {
        const user = userEvent.setup();
        await mountWithPhoto();
        await user.click(actionButton());

        await act(async () => {
            harness.setResult({
                blob: new Blob(['x'], { type: 'image/jpeg' }),
                filename: 'resizo-print-sheet-4x6-300dpi.jpg',
                format: 'jpeg',
                layout: { paper: { widthPx: 1200, heightPx: 1800 }, copies: 2, photo: { widthPx: 600, heightPx: 600 } },
                originalBytes: 400 * 1024,
                checks: [],
                verified: true,
            });
        });
        expect(screen.queryByRole('button', { name: /^create sheet$/i })).toBeNull();

        fireEvent.change(document.getElementById('sheet-dpi'), { target: { value: '250' } });
        expect(screen.getByRole('button', { name: /^create sheet$/i })).toBeVisible();
    });

    it('clears a finished result when the frame moves', async () => {
        const user = userEvent.setup();
        await mountWithPhoto();
        await user.click(actionButton());
        await act(async () => {
            harness.setResult({
                blob: new Blob(['x'], { type: 'image/jpeg' }),
                filename: 'resizo-print-sheet-4x6-300dpi.jpg',
                format: 'jpeg',
                layout: { paper: { widthPx: 1200, heightPx: 1800 }, copies: 2, photo: { widthPx: 600, heightPx: 600 } },
                originalBytes: 400 * 1024,
                checks: [],
                verified: true,
            });
        });

        await user.click(screen.getByRole('button', { name: /simulate drag/i }));
        expect(screen.getByRole('button', { name: /^create sheet$/i })).toBeVisible();
    });
});

/* --------------------------------------------------------------- result */

describe('the finished result', () => {
    async function withResult(overrides = {}) {
        const view = await mountWithPhoto();
        await act(async () => {
            harness.setResult({
                blob: new Blob([new Uint8Array(8)], { type: 'image/jpeg' }),
                filename: 'resizo-print-sheet-4x6-300dpi.jpg',
                format: 'jpeg',
                layout: { paper: { widthPx: 1200, heightPx: 1800 }, copies: 2, photo: { widthPx: 600, heightPx: 600 } },
                originalBytes: 400 * 1024,
                checks: [{ key: 'paper', label: 'Paper', required: '4 × 6 in', actual: '4 × 6 in', ok: true }],
                verified: true,
                ...overrides,
            });
        });
        return view;
    }

    it('headlines "Sheet ready", focused, in a section labelled by it', async () => {
        await withResult();
        const heading = screen.getByRole('heading', { name: /^sheet ready$/i });
        expect(heading).toHaveAttribute('id', 'sheet-result-heading');
        expect(heading.closest('section')).toHaveAttribute('aria-labelledby', 'sheet-result-heading');
        await waitFor(() => expect(document.activeElement).toBe(heading));
    });

    it('shows the checklist from checks, with Meets from the validator', async () => {
        await withResult();
        const row = screen.getByText('Paper', { selector: 'dt' });
        expect(row).toBeInTheDocument();
        expect(row.closest('div')).toHaveTextContent('Meets');
    });

    it('shows the print note verbatim, with role="note"', async () => {
        await withResult();
        const note = document.getElementById('sheet-print-note');
        expect(note).toHaveAttribute('role', 'note');
        expect(note).toHaveTextContent(
            'Print at Actual Size or 100 %. If your print dialog uses Fit to Page or scaling, the physical photo dimensions may change. Your printer may add its own margins.',
        );
    });

    it('offers Download JPEG for a jpeg result and Download PDF for a pdf result', async () => {
        await withResult({ format: 'jpeg' });
        expect(screen.getByRole('button', { name: /^download jpeg$/i })).toBeInTheDocument();

        await withResult({ format: 'pdf', filename: 'resizo-print-sheet-4x6-300dpi.pdf' });
        expect(screen.getByRole('button', { name: /^download pdf$/i })).toBeInTheDocument();
    });
});

/* -------------------------------------------------------------- failure */

describe('a refusal', () => {
    it('shows the alert with id sheet-error and focuses it', async () => {
        await mountWithPhoto();
        await act(async () => {
            harness.setFailure({
                error: 'That would take more memory than this device can spare. Choose a smaller sheet.',
                suggestion: 'Choose a smaller sheet.',
                code: 'not-enough-memory',
            });
        });

        const alert = screen.getByRole('alert');
        expect(alert).toHaveAttribute('id', 'sheet-error');
        expect(alert).toHaveAttribute('tabIndex', '-1');
        await waitFor(() => expect(document.activeElement?.id).toBe('sheet-error'));
    });
});
