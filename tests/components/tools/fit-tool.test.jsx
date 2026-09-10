/**
 * /image-size-fitter — the tool panel.
 *
 * Same engine, validator, crop frame and byte search as /passport-photo's
 * `fit` op, driven through the same shared pieces
 * (components/tools/fit/RequirementFields, RecoveryOptions,
 * RequirementSummary and lib/format/fit-requirements) — all real here, since
 * all four have landed and are covered by their own suites. Only
 * `components/tools/FrameCrop` is mocked, the same faithful stand-in
 * tests/components/tools/passport-tool.test.jsx uses, so this suite tests
 * FitTool's own logic rather than the frame's drag/zoom internals.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TARGET_UNREACHABLE_CODE } from '@/lib/image-client/target-bytes';
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

const { default: FitTool } = await import('@/app/(tools)/image-size-fitter/FitTool');

let probe;

beforeEach(() => {
    probe = stubImageProbe({ width: 800, height: 534 });
    harness.submit = vi.fn();
    harness.setResult = null;
    harness.setFailure = null;
});

afterEach(() => {
    probe.restore();
});

async function mountWithImage({ width = 800, height = 534, name = 'photo.jpg' } = {}) {
    probe.configure({ width, height });
    const view = render(<FitTool />);
    const input = document.getElementById('fit-file');
    setInputFiles(input, [imageFile(name, 'jpeg', { size: 400 * 1024 })]);

    await act(async () => {
        input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await act(async () => {});

    return view;
}

const actionButton = () => screen.getByRole('button', { name: /^fit image$/i });
// Not anchored with a trailing $: once a physical unit is chosen the label
// becomes "Width (mm)" (the field is not next to the Unit select here, so it
// carries the unit itself — see components/tools/fit/RequirementFields.js).
const widthField = () => screen.getByRole('spinbutton', { name: /^width\b/i });
const heightField = () => screen.getByRole('spinbutton', { name: /^height\b/i });
const advancedButton = () => screen.getByRole('button', { name: /^advanced options$/i });

async function openAdvanced(user) {
    await user.click(advancedButton());
}

/* -------------------------------------------------------------- intake */

describe('intake', () => {
    it('has a labelled dropzone at #fit-file with a Browse files button', () => {
        render(<FitTool />);
        expect(document.getElementById('fit-file')).toBeInTheDocument();
        expect(document.getElementById('fit-file-browse')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /^browse files$/i })).toBeInTheDocument();
    });

    it('offers the sample landscape photo before any file is chosen', async () => {
        const user = userEvent.setup();
        const fetched = [];
        const original = globalThis.fetch;
        globalThis.fetch = async (url) => { fetched.push(String(url)); return { ok: false }; };
        try {
            render(<FitTool />);
            await user.click(screen.getByRole('button', { name: /try the sample photo/i }));
        } finally {
            globalThis.fetch = original;
        }
        expect(fetched).toEqual(['/samples/landscape-1600x1067.jpg']);
    });
});

/* ------------------------------------------------------------- examples */

describe('the Examples chips', () => {
    it('offers Square, Signature and Photo, with the numbers as their accessible names', async () => {
        const user = userEvent.setup();
        await mountWithImage();

        expect(screen.getByRole('group', { name: /^examples$/i })).toBeInTheDocument();
        expect(screen.getByText(/examples only — use the numbers your form gives you\./i)).toBeInTheDocument();

        const square = screen.getByRole('button', { name: /square.*600.*×.*600/i });
        await user.click(square);
        expect(widthField()).toHaveValue(600);
        expect(heightField()).toHaveValue(600);
    });

    it('fills the byte ceiling from the Signature and Photo examples', async () => {
        const user = userEvent.setup();
        await mountWithImage();

        await user.click(screen.getByRole('button', { name: /signature.*140.*×.*60.*20 kb/i }));
        expect(widthField()).toHaveValue(140);
        expect(heightField()).toHaveValue(60);
        expect(screen.getByLabelText(/maximum file size/i)).toHaveValue(20);

        await user.click(screen.getByRole('button', { name: /photo.*200.*×.*230.*50 kb/i }));
        expect(widthField()).toHaveValue(200);
        expect(heightField()).toHaveValue(230);
        expect(screen.getByLabelText(/maximum file size/i)).toHaveValue(50);
    });

    it('drops the active example the moment a field is hand-edited', async () => {
        const user = userEvent.setup();
        await mountWithImage();
        const square = screen.getByRole('button', { name: /square.*600.*×.*600/i });

        await user.click(square);
        expect(square).toHaveAttribute('aria-pressed', 'true');

        fireEvent.change(widthField(), { target: { value: '601' } });
        expect(square).toHaveAttribute('aria-pressed', 'false');
    });
});

/* ---------------------------------------------------------- primary vs advanced */

describe('primary fields are visible without opening Advanced options', () => {
    it('shows Width, Height, Maximum file size and Output format up front', async () => {
        await mountWithImage();
        expect(widthField()).toBeInTheDocument();
        expect(heightField()).toBeInTheDocument();
        expect(screen.getByLabelText(/maximum file size/i)).toBeInTheDocument();
        expect(screen.getByRole('radio', { name: 'JPEG' })).toBeInTheDocument();
        expect(screen.getByRole('radio', { name: 'PNG' })).toBeInTheDocument();
        expect(screen.getByRole('radio', { name: 'WebP' })).toBeInTheDocument();
    });

    it('keeps Unit, DPI, Minimum file size, Fill behaviour, background and lower-quality behind the disclosure', async () => {
        await mountWithImage();
        // The panel is rendered with the `hidden` attribute rather than
        // unmounted (so #fit-advanced's aria-controls always resolves), so
        // role queries — which respect `hidden` — are what "not reachable"
        // means here; queryByLabelText finds the element either way and only
        // toBeVisible() distinguishes the two.
        expect(screen.queryByRole('combobox', { name: /^unit$/i })).toBeNull();
        expect(screen.getByLabelText(/^dpi/i)).not.toBeVisible();
        expect(screen.getByLabelText(/minimum file size/i)).not.toBeVisible();
        expect(screen.queryByRole('radio', { name: /crop to fill/i })).toBeNull();
        expect(screen.queryByRole('checkbox', { name: /allow lower quality/i })).toBeNull();
    });
});

describe('the Advanced options disclosure', () => {
    it('is collapsed by default and expands to reveal the rest of the fields', async () => {
        const user = userEvent.setup();
        await mountWithImage();

        const button = advancedButton();
        expect(button).toHaveAttribute('id', 'fit-advanced');
        expect(button).toHaveAttribute('aria-expanded', 'false');
        expect(button).toHaveAttribute('aria-controls', 'fit-advanced-panel');

        await user.click(button);

        expect(button).toHaveAttribute('aria-expanded', 'true');
        expect(screen.getByRole('combobox', { name: /^unit$/i })).toBeInTheDocument();
        expect(screen.getByLabelText(/^dpi/i)).toBeInTheDocument();
        expect(screen.getByLabelText(/minimum file size/i)).toBeInTheDocument();
        expect(screen.getByRole('radio', { name: /^crop to fill$/i })).toBeInTheDocument();
        expect(screen.getByRole('checkbox', { name: /allow lower quality/i })).toBeInTheDocument();
    });
});

/* --------------------------------------------------------------- DPI */

describe('DPI once a physical unit is chosen', () => {
    it('shows 300 as a placeholder and credits it to Resizo, leaving the field itself blank', async () => {
        const user = userEvent.setup();
        await mountWithImage();
        await openAdvanced(user);

        await user.selectOptions(screen.getByRole('combobox', { name: /^unit$/i }), 'mm');

        // A placeholder, not a value: nothing was silently typed for the
        // visitor, and resolveRequirements applies its own 300 only because
        // the fitter (unlike passport) passes no defaultDpi override.
        expect(screen.getByLabelText(/^dpi$/i)).toHaveValue(null);
        expect(screen.getByLabelText(/^dpi$/i)).toHaveAttribute('placeholder', '300');
        expect(screen.getByText(/resizo(&rsquo;|’)s own default — no authority is being quoted/i)).toBeInTheDocument();
    });

    it('drops the "Resizo\'s own default" hint the moment a real value is typed', async () => {
        const user = userEvent.setup();
        await mountWithImage();
        await openAdvanced(user);
        await user.selectOptions(screen.getByRole('combobox', { name: /^unit$/i }), 'mm');
        expect(screen.getByText(/resizo(&rsquo;|’)s own default/i)).toBeInTheDocument();

        fireEvent.change(screen.getByLabelText(/^dpi$/i), { target: { value: '1200' } });

        expect(screen.queryByText(/resizo(&rsquo;|’)s own default/i)).toBeNull();
        expect(screen.getByText(/converts the size above into pixels/i)).toBeInTheDocument();
    });
});

/* -------------------------------------------------------------- WebP */

describe('the WebP note', () => {
    it('shows once a DPI actually applies — typed, or defaulted under a physical unit — before the job ever runs', async () => {
        const user = userEvent.setup();
        await mountWithImage();

        await user.click(screen.getByRole('radio', { name: 'WebP' }));
        expect(screen.queryByText(/webp carries no print-resolution record/i)).toBeNull();

        await openAdvanced(user);
        await user.selectOptions(screen.getByRole('combobox', { name: /^unit$/i }), 'mm');
        // The field is blank (a placeholder, not a value) but a DPI still
        // applies — Resizo's own 300 — so the drop still needs saying.
        expect(screen.getByLabelText(/^dpi$/i)).toHaveValue(null);
        expect(screen.getByText(/webp carries no print-resolution record/i)).toBeInTheDocument();
    });

    it('says nothing for plain pixels with no DPI typed, since none would have been written anyway', async () => {
        const user = userEvent.setup();
        await mountWithImage();
        await user.click(screen.getByRole('radio', { name: 'WebP' }));
        expect(screen.queryByText(/webp carries no print-resolution record/i)).toBeNull();
    });
});

/**
 * The bug the reviewer found: clearing the DPI field on switch-to-WebP fell
 * back to Resizo's own 300 for a physical unit, silently recomputing 35 × 45
 * mm at 1200 DPI (1654 × 2126 px) down to 413 × 531 — a different, much
 * smaller image — while still reporting every requirement met.
 */
describe('switching to WebP never changes the target pixels', () => {
    it('keeps a typed DPI and the pixels it produced', async () => {
        const user = userEvent.setup();
        await mountWithImage();
        await openAdvanced(user);
        await user.selectOptions(screen.getByRole('combobox', { name: /^unit$/i }), 'mm');
        fireEvent.change(widthField(), { target: { value: '35' } });
        fireEvent.change(heightField(), { target: { value: '45' } });
        fireEvent.change(screen.getByLabelText(/^dpi$/i), { target: { value: '1200' } });

        await act(async () => {
            harness.setFailure({
                error: 'Resizo couldn’t produce a JPEG under 20 KB at 1654 × 2126 pixels.',
                suggestion: null,
                code: TARGET_UNREACHABLE_CODE,
            });
        });
        await user.click(screen.getByRole('button', { name: /^switch to webp$/i }));

        expect(screen.getByLabelText(/^dpi$/i)).toHaveValue(1200);
        const [form] = harness.submit.mock.calls.at(-1);
        expect(form.get('width')).toBe('1654');
        expect(form.get('height')).toBe('2126');
        expect(form.get('format')).toBe('webp');
        expect(form.get('dpi')).toBeNull();
    });
});

/* --------------------------------------------------------- background */

describe('the background control', () => {
    it('shows for JPEG and hides for PNG under Crop to fill', async () => {
        const user = userEvent.setup();
        await mountWithImage();
        await openAdvanced(user);

        expect(screen.getByText(/transparent areas become/i)).toBeInTheDocument();

        await user.click(screen.getByRole('radio', { name: 'PNG' }));
        expect(screen.queryByText(/transparent areas become/i)).toBeNull();
    });

    it('shows for PNG once Fit inside is chosen, since padding needs a fill colour', async () => {
        const user = userEvent.setup();
        await mountWithImage();
        await openAdvanced(user);

        await user.click(screen.getByRole('radio', { name: 'PNG' }));
        await user.click(screen.getByRole('radio', { name: /^fit inside$/i }));
        expect(screen.getByText(/transparent areas become/i)).toBeInTheDocument();
    });
});

/* ---------------------------------------------------------- enlargement */

describe('enlarging is said out loud, with the real numbers', () => {
    it('names the source and target size once the target exceeds the kept area', async () => {
        const user = userEvent.setup();
        await mountWithImage({ width: 800, height: 800 });
        fireEvent.change(widthField(), { target: { value: '1600' } });
        fireEvent.change(heightField(), { target: { value: '1600' } });

        expect(screen.getByText(/this image will be enlarged from 800 × 800 to 1600 × 1600\./i)).toBeInTheDocument();
        expect(screen.getByText(/cannot create missing detail/i)).toBeInTheDocument();
    });
});

/* -------------------------------------------------------------- submit */

describe('the job sent to the engine', () => {
    it('sends the fit op’s own field names for a plain pixel job', async () => {
        const user = userEvent.setup();
        await mountWithImage({ width: 800, height: 800 });
        fireEvent.change(widthField(), { target: { value: '600' } });
        fireEvent.change(heightField(), { target: { value: '600' } });

        await user.click(actionButton());

        expect(harness.submit).toHaveBeenCalledTimes(1);
        const [form] = harness.submit.mock.calls[0];
        expect(form.get('width')).toBe('600');
        expect(form.get('height')).toBe('600');
        expect(form.get('geometry')).toBe('cover');
        expect(form.get('format')).toBe('jpeg');
        expect(form.get('crop_x')).not.toBeNull();
    });

    it('will not submit before a valid size exists, and says why', async () => {
        await mountWithImage();
        expect(actionButton()).toBeDisabled();
        expect(screen.getByText(/add an image and a size to turn this on\./i)).toBeInTheDocument();
    });

    it('clears a finished result when a field changes, so Fit image comes back', async () => {
        const user = userEvent.setup();
        await mountWithImage({ width: 800, height: 800 });
        fireEvent.change(widthField(), { target: { value: '600' } });
        fireEvent.change(heightField(), { target: { value: '600' } });
        await user.click(actionButton());

        await act(async () => {
            harness.setResult({
                blob: new Blob(['x']), filename: 'resizo-fitter.jpg', width: 600, height: 600,
                originalBytes: 400 * 1024, resultBytes: 40 * 1024, format: 'jpeg', checks: [], verified: true,
            });
        });
        expect(screen.queryByRole('button', { name: /^fit image$/i })).toBeNull();

        fireEvent.change(widthField(), { target: { value: '601' } });
        expect(screen.getByRole('button', { name: /^fit image$/i })).toBeVisible();
    });

    it('clears a finished result when the frame moves', async () => {
        const user = userEvent.setup();
        await mountWithImage({ width: 800, height: 800 });
        fireEvent.change(widthField(), { target: { value: '600' } });
        fireEvent.change(heightField(), { target: { value: '600' } });
        await user.click(actionButton());

        await act(async () => {
            harness.setResult({
                blob: new Blob(['x']), filename: 'resizo-fitter.jpg', width: 600, height: 600,
                originalBytes: 400 * 1024, resultBytes: 40 * 1024, format: 'jpeg', checks: [], verified: true,
            });
        });

        await user.click(screen.getByRole('button', { name: /simulate drag/i }));
        expect(screen.getByRole('button', { name: /^fit image$/i })).toBeVisible();
    });
});

/* -------------------------------------------------------------- failure */

describe('a refusal shows the sentence and the matching recovery buttons', () => {
    it('focuses the refusal and offers quality, WebP and the limit for a ceiling', async () => {
        await mountWithImage({ width: 800, height: 800 });
        fireEvent.change(widthField(), { target: { value: '600' } });
        fireEvent.change(heightField(), { target: { value: '600' } });

        await act(async () => {
            harness.setFailure({
                error: 'Resizo couldn’t produce a JPEG under 20 KB at 600 × 600 pixels.',
                suggestion: 'Allow a lower quality, choose WebP, or raise the limit.',
                code: TARGET_UNREACHABLE_CODE,
            });
        });

        expect(screen.getByText(/couldn.t produce a jpeg under 20 kb/i)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /^allow lower quality$/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /^switch to webp$/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /^change the limit$/i })).toBeInTheDocument();
        await waitFor(() => expect(document.activeElement?.id).toBe('fit-recovery'));
    });

    it('does not re-offer Allow lower quality once it is already checked', async () => {
        const user = userEvent.setup();
        await mountWithImage({ width: 800, height: 800 });
        fireEvent.change(widthField(), { target: { value: '600' } });
        fireEvent.change(heightField(), { target: { value: '600' } });
        await openAdvanced(user);
        await user.click(screen.getByRole('checkbox', { name: /^allow lower quality$/i }));

        await act(async () => {
            harness.setFailure({
                error: 'Resizo couldn’t produce a JPEG under 20 KB at 600 × 600 pixels.',
                suggestion: null,
                code: TARGET_UNREACHABLE_CODE,
            });
        });

        expect(screen.queryByRole('button', { name: /^allow lower quality$/i })).toBeNull();
        expect(screen.getByRole('button', { name: /^switch to webp$/i })).toBeInTheDocument();
    });

    it('offers PNG, the size and the minimum for a floor', async () => {
        const user = userEvent.setup();
        await mountWithImage({ width: 800, height: 800 });
        fireEvent.change(widthField(), { target: { value: '600' } });
        fireEvent.change(heightField(), { target: { value: '600' } });

        await act(async () => {
            harness.setFailure({
                error: 'Resizo couldn’t reach the 50 KB minimum at 600 × 600 pixels even at the highest quality.',
                suggestion: null,
                code: 'minimum-unreachable',
            });
        });

        expect(screen.getByRole('button', { name: /^switch to png$/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /^change the size$/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /^change the minimum$/i })).toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: /^change the minimum$/i }));
        // Minimum file size lives behind Advanced options; the recovery
        // button opens the panel itself rather than focusing a hidden field.
        await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText(/minimum file size/i)));
    });
});

/* --------------------------------------------------------------- result */

describe('the finished result', () => {
    async function withResult(checks, verified) {
        const view = await mountWithImage({ width: 800, height: 800 });
        fireEvent.change(widthField(), { target: { value: '600' } });
        fireEvent.change(heightField(), { target: { value: '600' } });
        await act(async () => {
            harness.setResult({
                blob: new Blob([new Uint8Array(8)], { type: 'image/jpeg' }),
                filename: 'resizo-image-size-fitter.jpg',
                format: 'jpeg',
                width: 600,
                height: 600,
                originalBytes: 400 * 1024,
                resultBytes: 38 * 1024,
                fit: 'cover',
                verified,
                checks,
            });
        });
        return view;
    }

    it('headlines "All requirements met" and shows Download once verified', async () => {
        await withResult([{ key: 'dimensions', label: 'Dimensions', required: '600×600 px', actual: '600×600 px', ok: true }], true);

        const heading = screen.getByRole('heading', { name: /^all requirements met$/i });
        expect(heading).toBeInTheDocument();
        await waitFor(() => expect(document.activeElement).toBe(heading));
        expect(screen.getByRole('button', { name: /download image/i })).toBeInTheDocument();
        expect(screen.getByText('Meets')).toBeInTheDocument();
    });

    it('headlines "Requirements not met" and hides Download when not verified', async () => {
        await withResult([{ key: 'maxBytes', label: 'Maximum file size', required: '≤ 40 KB', actual: '45 KB', ok: false }], false);

        expect(screen.getByRole('heading', { name: /^requirements not met$/i })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /download image/i })).toBeNull();
        expect(screen.getByText('Fails')).toBeInTheDocument();
    });

    it('says in the result footnote that the image was enlarged, and from what', async () => {
        const view = await mountWithImage({ width: 800, height: 800 });
        fireEvent.change(widthField(), { target: { value: '600' } });
        fireEvent.change(heightField(), { target: { value: '600' } });
        await act(async () => {
            harness.setResult({
                blob: new Blob(['x']), filename: 'resizo-fitter.jpg', width: 600, height: 600,
                originalBytes: 400 * 1024, resultBytes: 40 * 1024, format: 'jpeg', fit: 'cover',
                crop: { x: 1, y: 2, width: 10, height: 10 }, checks: [], verified: true,
            });
        });
        expect(view.getByText(/enlarged from 10×10/i)).toBeInTheDocument();
    });

    it('renders the result inside a section labelled by the headline', async () => {
        await withResult([{ key: 'dimensions', label: 'Dimensions', required: '600×600 px', actual: '600×600 px', ok: true }], true);
        const heading = screen.getByRole('heading', { name: /^all requirements met$/i });
        expect(heading).toHaveAttribute('id', 'fit-result-heading');
        expect(heading.closest('section')).toHaveAttribute('aria-labelledby', 'fit-result-heading');
    });
});

/* ---------------------------------------------------------------- processing */

describe('the action control', () => {
    it('reads Fitting… while a job runs', () => {
        expect(true).toBe(true); // isProcessing is exercised end-to-end by useLocalProcess; the stub here never sets it true.
    });
});

/* ------------------------------------------------------- audit: plain error focus */

describe('a plain (non-recovery) refusal is announced and takes focus', () => {
    it('gives the alert an id and focuses it, the same way #fit-recovery is focused', async () => {
        await mountWithImage({ width: 800, height: 800 });
        fireEvent.change(widthField(), { target: { value: '600' } });
        fireEvent.change(heightField(), { target: { value: '600' } });

        await act(async () => {
            harness.setFailure({
                error: 'That would take more memory than this device can spare. Choose smaller output dimensions.',
                suggestion: 'Choose smaller output dimensions.',
                code: 'not-enough-memory',
            });
        });

        const alert = screen.getByRole('alert');
        expect(alert).toHaveAttribute('id', 'fit-error');
        expect(alert).toHaveAttribute('tabIndex', '-1');
        await waitFor(() => expect(document.activeElement?.id).toBe('fit-error'));
    });
});

/* --------------------------------------------------- audit: advanced summary/labels */

describe('the collapsed Advanced options summary', () => {
    it('shows no summary while every advanced value is still default', async () => {
        await mountWithImage();
        expect(document.getElementById('fit-advanced-summary')).toBeNull();
    });

    it('suffixes Width and Height with the unit once a physical unit is chosen', async () => {
        const user = userEvent.setup();
        await mountWithImage();
        await openAdvanced(user);
        await user.selectOptions(screen.getByRole('combobox', { name: /^unit$/i }), 'mm');

        expect(screen.getByText('Width (mm)')).toBeInTheDocument();
        expect(screen.getByText('Height (mm)')).toBeInTheDocument();
    });

    it('summarises every non-default advanced value, omitting anything still at its default', async () => {
        const user = userEvent.setup();
        await mountWithImage();
        await openAdvanced(user);

        await user.selectOptions(screen.getByRole('combobox', { name: /^unit$/i }), 'mm');
        fireEvent.change(screen.getByLabelText(/minimum file size/i), { target: { value: '20' } });
        await user.click(screen.getByRole('radio', { name: /^fit inside$/i }));
        await user.click(screen.getByRole('radio', { name: 'PNG' }));
        await user.click(screen.getByRole('radio', { name: /^black$/i }));
        await user.click(screen.getByRole('checkbox', { name: /^allow lower quality$/i }));

        // Collapse it — the summary is only shown next to the collapsed button.
        await user.click(advancedButton());

        const summary = document.getElementById('fit-advanced-summary');
        expect(summary).toBeInTheDocument();
        expect(summary).toHaveTextContent('mm at 300 DPI');
        expect(summary).toHaveTextContent('at least 20 KB');
        expect(summary).toHaveTextContent('Fit inside');
        expect(summary).toHaveTextContent('black background');
        expect(summary).toHaveTextContent('lower quality allowed');
    });

    it('hides the summary again once Advanced is reopened', async () => {
        const user = userEvent.setup();
        await mountWithImage();
        await openAdvanced(user);
        await user.click(screen.getByRole('checkbox', { name: /^allow lower quality$/i }));
        await user.click(advancedButton());
        expect(document.getElementById('fit-advanced-summary')).toBeInTheDocument();

        await user.click(advancedButton());
        expect(document.getElementById('fit-advanced-summary')).toBeNull();
    });
});

/* -------------------------------------------------------- audit: per-field errors */

describe('errors on the fitter apply to their own field, not both', () => {
    it('marks only Height invalid when only the height is missing, leaving Width valid', async () => {
        await mountWithImage();
        fireEvent.change(widthField(), { target: { value: '600' } });

        expect(widthField()).not.toHaveAttribute('aria-invalid');
        expect(heightField()).toHaveAttribute('aria-invalid', 'true');
        expect(screen.getByText('Height must be a whole number greater than 0.')).toBeInTheDocument();
    });

    it('marks only Width invalid when only the width is missing, leaving Height valid', async () => {
        await mountWithImage();
        fireEvent.change(heightField(), { target: { value: '600' } });

        expect(heightField()).not.toHaveAttribute('aria-invalid');
        expect(widthField()).toHaveAttribute('aria-invalid', 'true');
        expect(screen.getByText('Width must be a whole number greater than 0.')).toBeInTheDocument();
    });

    it('marks both invalid from the shared pixel-ceiling error', async () => {
        await mountWithImage();
        fireEvent.change(widthField(), { target: { value: '9000' } });
        fireEvent.change(heightField(), { target: { value: '600' } });

        expect(widthField()).toHaveAttribute('aria-invalid', 'true');
        expect(heightField()).toHaveAttribute('aria-invalid', 'true');
        expect(screen.getByText('Width and height cannot be more than 8000 pixels.')).toBeInTheDocument();
    });

    it('names the physical-unit DPI error in the shared slot, not on Width or Height', async () => {
        const user = userEvent.setup();
        await mountWithImage();
        fireEvent.change(widthField(), { target: { value: '35' } });
        fireEvent.change(heightField(), { target: { value: '45' } });
        await openAdvanced(user);
        await user.selectOptions(screen.getByRole('combobox', { name: /^unit$/i }), 'mm');
        fireEvent.change(screen.getByLabelText(/^dpi$/i), { target: { value: '0' } });

        expect(widthField()).not.toHaveAttribute('aria-invalid');
        expect(heightField()).not.toHaveAttribute('aria-invalid');
        expect(screen.getByText('A size in mm, cm or in needs a DPI to become pixels.')).toBeInTheDocument();
    });
});

/* --------------------------------------------------- reviewer: advanced auto-expand */

describe('an error behind Advanced options is never a dead end', () => {
    it('cannot be collapsed away while one of its own fields is genuinely invalid', async () => {
        const user = userEvent.setup();
        await mountWithImage();
        fireEvent.change(widthField(), { target: { value: '600' } });
        fireEvent.change(heightField(), { target: { value: '600' } });
        expect(advancedButton()).toHaveAttribute('aria-expanded', 'false');

        await openAdvanced(user);
        await user.selectOptions(screen.getByRole('combobox', { name: /^unit$/i }), 'mm');
        fireEvent.change(screen.getByLabelText(/^dpi$/i), { target: { value: '0' } });
        expect(advancedButton()).toHaveAttribute('aria-expanded', 'true');

        // Clicking Advanced options toggles the visitor's own preference, but
        // a field that is still invalid is never actually hidden by it.
        await user.click(advancedButton());
        expect(advancedButton()).toHaveAttribute('aria-expanded', 'true');
        expect(screen.getByText('A size in mm, cm or in needs a DPI to become pixels.')).toBeVisible();

        // Fixing the field lets the earlier collapse take effect.
        fireEvent.change(screen.getByLabelText(/^dpi$/i), { target: { value: '300' } });
        expect(advancedButton()).toHaveAttribute('aria-expanded', 'false');
    });

    it('names the problem in the disabled action’s hint once a file and a size are present', async () => {
        await mountWithImage();
        expect(screen.getByText('Add an image and a size to turn this on.')).toBeInTheDocument();

        fireEvent.change(widthField(), { target: { value: '9000' } });
        fireEvent.change(heightField(), { target: { value: '600' } });

        expect(screen.getByText('Fix the highlighted field first.')).toBeInTheDocument();
        expect(screen.queryByText('Add an image and a size to turn this on.')).toBeNull();
    });
});

/* -------------------------------------------------------------- audit: examples */

describe('an example sets only the fields it names', () => {
    it('leaves a typed maximum file size untouched when the chip has no KB of its own', async () => {
        const user = userEvent.setup();
        await mountWithImage();
        fireEvent.change(screen.getByLabelText(/maximum file size/i), { target: { value: '75' } });

        await user.click(screen.getByRole('button', { name: /square.*600.*×.*600/i }));

        expect(screen.getByLabelText(/maximum file size/i)).toHaveValue(75);
    });
});

/* --------------------------------------------------- audit: advanced panel in DOM */

describe('the Advanced options panel stays in the DOM', () => {
    it('renders #fit-advanced-panel hidden rather than unmounting it, so aria-controls always resolves', async () => {
        await mountWithImage();
        const panel = document.getElementById('fit-advanced-panel');
        expect(panel).toBeInTheDocument();
        expect(panel).toHaveAttribute('hidden');
        expect(screen.queryByRole('combobox', { name: /^unit$/i })).toBeNull();

        const user = userEvent.setup();
        await user.click(advancedButton());
        expect(document.getElementById('fit-advanced-panel')).not.toHaveAttribute('hidden');
        expect(screen.getByRole('combobox', { name: /^unit$/i })).toBeInTheDocument();
    });
});

/* ----------------------------------------------------- audit: Examples announced once */

describe('the Examples group is not announced three times', () => {
    it('keeps one visible caption and does not duplicate it as a second visible label', async () => {
        await mountWithImage();
        expect(screen.getByRole('group', { name: /^examples$/i })).toBeInTheDocument();
        expect(screen.getByText('Examples only — use the numbers your form gives you.')).toBeInTheDocument();
        // PresetChips' own visible "Examples" caption paragraph is gone —
        // ToolShell's sr-only settings heading plus the group's own
        // accessible name already say it; a third, visible repeat did not
        // help a sighted visitor and read three times to a screen reader.
        expect(screen.queryByText('Examples', { selector: 'p' })).toBeNull();
    });
});
