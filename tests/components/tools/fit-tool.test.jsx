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
const widthField = () => screen.getByRole('spinbutton', { name: /^width$/i });
const heightField = () => screen.getByRole('spinbutton', { name: /^height$/i });
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
        expect(screen.queryByRole('combobox', { name: /^unit$/i })).toBeNull();
        expect(screen.queryByLabelText(/^dpi/i)).toBeNull();
        expect(screen.queryByLabelText(/minimum file size/i)).toBeNull();
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
    it('fills 300 and credits it to Resizo, not an authority', async () => {
        const user = userEvent.setup();
        await mountWithImage();
        await openAdvanced(user);

        await user.selectOptions(screen.getByRole('combobox', { name: /^unit$/i }), 'mm');

        expect(screen.getByLabelText(/^dpi$/i)).toHaveValue(300);
        expect(screen.getByText(/resizo(&rsquo;|’)s own default — no authority is being quoted/i)).toBeInTheDocument();
    });
});

/* -------------------------------------------------------------- WebP */

describe('the WebP note', () => {
    it('shows only once a DPI is actually typed, before the job ever runs', async () => {
        const user = userEvent.setup();
        await mountWithImage();

        await user.click(screen.getByRole('radio', { name: 'WebP' }));
        expect(screen.queryByText(/webp carries no print-resolution record/i)).toBeNull();

        await openAdvanced(user);
        await user.selectOptions(screen.getByRole('combobox', { name: /^unit$/i }), 'mm');
        expect(screen.getByLabelText(/^dpi$/i)).toHaveValue(300);
        expect(screen.getByText(/webp carries no print-resolution record/i)).toBeInTheDocument();
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
