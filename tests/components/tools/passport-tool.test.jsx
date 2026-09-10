/**
 * /passport-photo — the tool panel.
 *
 * Three of the four contract modules this page is built against
 * (`components/tools/FrameCrop`, `lib/catalog/application-presets`,
 * `lib/format/physical`) belong to other agents building in parallel and may
 * not exist on disk yet, so every one of them is mocked here with a small,
 * faithful stand-in of its documented contract (scratchpad/passport/plan.md)
 * rather than the real module. `@/lib/hooks/useLocalProcess` is mocked the
 * same way every other tool test in this suite mocks it — real file, driven
 * state — except it also drives `error` / `code` / `suggestion`, which no
 * existing stub needed until this tool's recovery buttons did.
 *
 * What is under test is PassportTool's own logic: which fields a preset
 * fills in, the pixel arithmetic it derives from Width/Height/Unit/DPI, which
 * FormData fields reach the engine, and how the panel reacts to a result or a
 * failure — never the internals of the mocked modules themselves.
 */
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TARGET_UNREACHABLE_CODE } from '@/lib/image-client/target-bytes';
import { imageFile, setInputFiles, stubImageProbe } from '../helpers';

/* ------------------------------------------------------------- fixtures */

/**
 * Copied from the real `lib/catalog/application-presets/index.js` (Agent C
 * landed it after this suite was first drafted — see the note at the top of
 * this file). `vi.mock` factories are hoisted above every top-level
 * declaration in the module, so every value one of them closes over has to be
 * created inside `vi.hoisted()` — a plain `const` here throws "Cannot access
 * '…' before initialization" the moment the mock is used.
 *
 * The important shape this fixture pins: a physical size carries the UNIT the
 * authority actually published in (`width`/`height`/`unit`) alongside a
 * millimetre conversion (`widthMm`/`heightMm`) that is NOT what the pixel
 * arithmetic runs on — 2 in is 50.8 mm exactly, and using the rounded 51 mm
 * figure instead of "2 in" would derive 602 px where the source's own unit
 * derives 600. PassportTool.js reads `.width`/`.unit`, never `.widthMm`, for
 * exactly this reason.
 */
const FIXTURES = vi.hoisted(() => {
    const usPrint = {
        id: 'us-passport-print',
        jurisdiction: 'United States',
        authority: 'U.S. Department of State',
        name: 'US passport photo (printed 2 × 2 in)',
        use: 'print',
        physical: { width: 2, height: 2, unit: 'in', widthMm: 50.8, heightMm: 50.8, statedAs: '2 x 2 inches (51 x 51 mm)' },
        digital: null,
        aspect: [1, 1],
        head: { minMm: 25, maxMm: 35, statedAs: 'from the bottom of the chin to the top of the head' },
        dpi: { required: false, default: 300 },
        bytes: { min: null, max: null },
        formats: ['jpeg', 'png'],
        formatsStated: false,
        background: { stated: 'plain white or off-white background free of shadows, textures, or objects', resizoSets: 'transparent-only' },
        enforces: ['dimensions', 'format', 'dpi'],
        cannotVerify: ['Eyes open and mouth closed, with no exaggerated expression', 'Head not tilted'],
        notes: ['Submit the original, unchanged photo.'],
        source: {
            label: 'U.S. Department of State, Passport Photos (Last Updated: March 24, 2026)',
            url: 'https://travel.state.gov/en/passports/apply/help/photos.html',
            verifiedAt: '2026-09-10',
        },
    };

    const ukPrint = {
        id: 'uk-passport-print',
        jurisdiction: 'United Kingdom',
        authority: 'HM Passport Office',
        name: 'UK passport photo (printed 45 × 35 mm)',
        use: 'print',
        physical: { width: 35, height: 45, unit: 'mm', widthMm: 35, heightMm: 45, statedAs: '45 millimetres (mm) high by 35mm wide' },
        digital: null,
        aspect: [7, 9],
        head: { minMm: 29, maxMm: 34, statedAs: 'from the crown of your head to your chin' },
        dpi: { required: false, default: 300 },
        bytes: { min: null, max: null },
        formats: ['jpeg', 'png'],
        formatsStated: false,
        background: { stated: 'plain cream or light grey background', resizoSets: 'transparent-only' },
        enforces: ['dimensions', 'format', 'dpi'],
        cannotVerify: ['No head covering, apart from religious or medical exceptions'],
        notes: ['Printed to a professional standard.'],
        source: {
            label: 'HM Passport Office, Photos for passports — photo requirements',
            url: 'https://www.gov.uk/photos-for-passports/photo-requirements',
            verifiedAt: '2026-09-10',
        },
    };

    const ukDigital = {
        id: 'uk-passport-digital',
        jurisdiction: 'United Kingdom',
        authority: 'HM Passport Office',
        name: 'UK passport photo (digital, 600 × 750 px)',
        use: 'digital',
        physical: null,
        digital: { minWidth: 600, minHeight: 750, maxWidth: null, maxHeight: null },
        aspect: [4, 5],
        // No head-height figure is published for the digital route at all.
        head: null,
        // No resolution is published either — this is the case that catches
        // a DPI field defaulting itself to 300 when the source asks for none.
        dpi: { required: false, default: null },
        bytes: { min: 50 * 1024, max: 10 * 1024 * 1024 },
        formats: ['jpeg', 'png'],
        formatsStated: false,
        background: { stated: 'plain light-coloured background', resizoSets: 'transparent-only' },
        enforces: ['dimensions', 'format', 'maxBytes', 'minBytes'],
        cannotVerify: ['Taken in the last month'],
        notes: ['Do not crop your photo - it will be done for you.'],
        source: {
            label: 'HM Passport Office, Photos for passports',
            url: 'https://www.gov.uk/photos-for-passports',
            verifiedAt: '2026-09-10',
        },
    };

    const india = {
        id: 'india-passport-print',
        jurisdiction: 'India',
        authority: 'Ministry of External Affairs, Passport Seva',
        name: 'India passport photo (pasted 4.5 × 3.5 cm)',
        use: 'print',
        // The one fixture published in centimetres, and the one with no
        // numeric head rule at all — India draws a centred guidance band
        // instead of an official one for exactly that reason.
        physical: { width: 3.5, height: 4.5, unit: 'cm', widthMm: 35, heightMm: 45, statedAs: 'recent passport size photograph (4.5 cm length x 3.5 cm width) in colour' },
        digital: null,
        aspect: [7, 9],
        head: null,
        dpi: { required: false, default: 300 },
        bytes: { min: null, max: null },
        formats: ['jpeg', 'png'],
        formatsStated: false,
        background: { stated: 'plain white, and the dress should be in dark colour', resizoSets: 'transparent-only' },
        enforces: ['dimensions', 'format', 'dpi'],
        cannotVerify: ['Frontal view of the full face should be visible'],
        notes: ['Not required for applications at PSK/POPSK.'],
        source: {
            label: 'Ministry of External Affairs, Passport Seva — Application Form Instruction Booklet V3.0, section B',
            url: 'https://www.passportindia.gov.in/AppOnlineProject/pdf/ApplicationformInstructionBooklet-V3.0.pdf',
            verifiedAt: '2026-09-10',
        },
    };

    return { usPrint, ukPrint, ukDigital, india, all: [usPrint, ukPrint, ukDigital, india] };
});

const US_PRINT = FIXTURES.usPrint;
const UK_PRINT = FIXTURES.ukPrint;
const UK_DIGITAL = FIXTURES.ukDigital;
const INDIA = FIXTURES.india;

vi.mock('@/lib/catalog/application-presets', () => ({
    APPLICATION_PRESETS: FIXTURES.all,
    getApplicationPreset: (id) => FIXTURES.all.find((preset) => preset.id === id) ?? null,
    // Mirrors the real function precisely: a physical size converts through
    // its OWN unit, a digital size ignores dpi entirely and reports it as
    // null, since no resolution was published for it.
    applicationPresetToRequirement: (preset, { dpi } = {}) => {
        const print = preset.use === 'print' && preset.physical;
        const resolution = Number.isFinite(dpi) && dpi > 0 ? dpi : (preset.dpi?.default ?? null);
        const toPx = (value, unit) => {
            const mm = unit === 'mm' ? value : unit === 'cm' ? value * 10 : unit === 'in' ? value * 25.4 : NaN;
            return Math.round((mm / 25.4) * resolution);
        };

        const { width, height } = print
            ? { width: toPx(preset.physical.width, preset.physical.unit), height: toPx(preset.physical.height, preset.physical.unit) }
            : { width: preset.digital?.minWidth ?? null, height: preset.digital?.minHeight ?? null };

        return {
            width,
            height,
            geometry: 'cover',
            format: preset.formats?.[0] ?? null,
            targetBytes: preset.bytes?.max ?? null,
            minBytes: preset.bytes?.min ?? null,
            dpi: print ? resolution : null,
        };
    },
}));

vi.mock('@/lib/format/physical', () => ({
    MM_PER_INCH: 25.4,
    toMillimetres: (value, unit) => {
        if (unit === 'mm') return value;
        if (unit === 'cm') return value * 10;
        if (unit === 'in') return value * 25.4;
        throw new Error(`unsupported unit: ${unit}`);
    },
    pixelsFor: (value, unit, dpi) => {
        const mm = unit === 'mm' ? value : unit === 'cm' ? value * 10 : unit === 'in' ? value * 25.4 : NaN;
        if (!Number.isFinite(mm) || mm <= 0 || !Number.isFinite(dpi) || dpi <= 0) {
            throw new Error('pixelsFor: invalid input');
        }
        return Math.round((mm / 25.4) * dpi);
    },
    describePhysical: (widthMm, heightMm) => `${widthMm} × ${heightMm} mm`,
}));

vi.mock('@/components/tools/FrameCrop', () => ({
    default: function FrameCropStub({ id, label, aspect, value, onChange, guides }) {
        return (
            <div role="group" aria-label={label} id={id} data-testid="frame-crop" data-aspect={aspect}>
                <span data-testid="frame-rect">{JSON.stringify(value)}</span>
                <span data-testid="frame-guides">{JSON.stringify(guides)}</span>
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

const { default: PassportTool } = await import('@/app/(tools)/passport-photo/PassportTool');

/* ------------------------------------------------------------------ mount */

let probe;

beforeEach(() => {
    probe = stubImageProbe({ width: 1200, height: 1600 });
    harness.submit = vi.fn();
    harness.setResult = null;
    harness.setFailure = null;
});

afterEach(() => {
    probe.restore();
});

async function mountWithImage({ width = 1200, height = 1600, name = 'photo.jpg' } = {}) {
    probe.configure({ width, height });
    const view = render(<PassportTool />);
    const input = document.getElementById('passport-file');
    setInputFiles(input, [imageFile(name, 'jpeg', { size: 500 * 1024 })]);

    await act(async () => {
        input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await act(async () => {});

    return view;
}

const actionButton = () => screen.getByRole('button', { name: /^make photo$/i });
const widthField = () => screen.getByRole('spinbutton', { name: /^width$/i });
const heightField = () => screen.getByRole('spinbutton', { name: /^height$/i });
const unitField = () => screen.getByRole('combobox', { name: /^unit$/i });
const dpiField = () => screen.getByLabelText(/^dpi/i);

/* -------------------------------------------------------------- presets */

describe('the preset chip fills the fields', () => {
    it('fills width, height, unit, DPI and format from a physical preset', async () => {
        const user = userEvent.setup();
        render(<PassportTool />);

        await user.click(screen.getByRole('button', { name: /united kingdom.*printed/i }));

        expect(widthField()).toHaveValue(35);
        expect(heightField()).toHaveValue(45);
        expect(unitField()).toHaveValue('mm');
        expect(dpiField()).toHaveValue(300);
        expect(screen.getByRole('radio', { name: 'JPEG' })).toBeChecked();
    });

    it('fills width, height and unit in pixels from a digital preset', async () => {
        const user = userEvent.setup();
        render(<PassportTool />);

        await user.click(screen.getByRole('button', { name: /united kingdom.*digital/i }));

        expect(widthField()).toHaveValue(600);
        expect(heightField()).toHaveValue(750);
        expect(unitField()).toHaveValue('px');
    });

    it('drops back to a custom size the moment any filled field is edited', async () => {
        const user = userEvent.setup();
        render(<PassportTool />);

        await user.click(screen.getByRole('button', { name: /united states/i }));
        expect(screen.getByRole('button', { name: /united states/i })).toHaveAttribute('aria-pressed', 'true');

        fireEvent.change(widthField(), { target: { value: '40' } });

        expect(screen.getByRole('button', { name: /united states/i })).toHaveAttribute('aria-pressed', 'false');
        expect(screen.getByRole('button', { name: /^custom$/i })).toHaveAttribute('aria-pressed', 'true');
    });

    it('shows a photographic requirement Resizo cannot check has no numeric head band by drawing a centred guidance band, not an official one', async () => {
        const user = userEvent.setup();
        await mountWithImage();

        await user.click(screen.getByRole('button', { name: /^india/i }));

        const guides = JSON.parse(screen.getByTestId('frame-guides').textContent);
        expect(guides).toHaveLength(1);
        expect(guides[0].kind).toBe('guidance');
    });

    it('draws the official head band at the fraction the source numbers imply', async () => {
        const user = userEvent.setup();
        await mountWithImage();

        await user.click(screen.getByRole('button', { name: /united kingdom.*printed/i }));

        const [guide] = JSON.parse(screen.getByTestId('frame-guides').textContent);
        expect(guide.kind).toBe('official');
        expect(guide.from).toBeCloseTo(29 / 45, 3);
        expect(guide.to).toBeCloseTo(34 / 45, 3);
    });

    /**
     * The regression this fixture exists for. The US preset publishes its
     * size in INCHES ("2 x 2 inches (51 x 51 mm)"), and 2 in is 50.8 mm
     * exactly — an earlier version of this field filled Width/Height from
     * the rounded millimetre figure instead, which would show "51 mm" for a
     * source that says "2 in" and derive 602 px where the source's own unit
     * derives 600.
     */
    it('fills the field in the unit the source actually published, not a millimetre rounding', async () => {
        const user = userEvent.setup();
        render(<PassportTool />);

        await user.click(screen.getByRole('button', { name: /united states/i }));

        expect(widthField()).toHaveValue(2);
        expect(heightField()).toHaveValue(2);
        expect(unitField()).toHaveValue('in');
    });

    it('leaves DPI empty for a digital preset that publishes no resolution', async () => {
        const user = userEvent.setup();
        render(<PassportTool />);

        await user.click(screen.getByRole('button', { name: /united kingdom.*digital/i }));

        expect(dpiField().value).toBe('');
    });
});

/* ------------------------------------------------------------------ unit */

describe('the unit switch shows DPI', () => {
    it('marks DPI optional in pixels and required once the unit is physical', async () => {
        await mountWithImage();

        expect(screen.getByText(/^DPI \(optional\)$/)).toBeInTheDocument();

        fireEvent.change(unitField(), { target: { value: 'mm' } });

        expect(screen.queryByText(/^DPI \(optional\)$/)).toBeNull();
        expect(screen.getByText(/^DPI$/)).toBeInTheDocument();
    });
});

/* -------------------------------------------------------------- geometry */

describe('Fill behaviour', () => {
    it('shows the distortion warning only once Stretch is chosen', async () => {
        const user = userEvent.setup();
        await mountWithImage();

        expect(screen.queryByText(/distorts the picture/i)).toBeNull();

        await user.click(screen.getByRole('radio', { name: /stretch to fit/i }));

        expect(screen.getByText(/distorts the picture/i)).toBeInTheDocument();
    });

    it('removes the crop frame once Stretch or Fit inside is chosen, since there is nothing left to position', async () => {
        const user = userEvent.setup();
        await mountWithImage();
        fireEvent.change(widthField(), { target: { value: '600' } });
        fireEvent.change(heightField(), { target: { value: '750' } });

        expect(screen.getByTestId('frame-crop')).toBeInTheDocument();

        await user.click(screen.getByRole('radio', { name: /fit inside/i }));

        expect(screen.queryByTestId('frame-crop')).toBeNull();
        expect(screen.getByText(/nothing to position here/i)).toBeInTheDocument();
    });
});

/* ------------------------------------------------------------------- job */

describe('the FormData built for the engine', () => {
    it('carries the contract fields for a custom job', async () => {
        const user = userEvent.setup();
        await mountWithImage({ width: 1200, height: 1600 });

        fireEvent.change(widthField(), { target: { value: '600' } });
        fireEvent.change(heightField(), { target: { value: '750' } });
        fireEvent.change(screen.getByLabelText(/maximum file size/i), { target: { value: '40' } });

        await user.click(actionButton());

        expect(harness.submit).toHaveBeenCalledTimes(1);
        const [form, extras] = harness.submit.mock.calls[0];

        expect(form.get('file')).toBeInstanceOf(File);
        expect(form.get('width')).toBe('600');
        expect(form.get('height')).toBe('750');
        expect(form.get('geometry')).toBe('cover');
        expect(form.get('format')).toBe('jpeg');
        expect(form.get('background')).toBe('white');
        expect(form.get('targetBytes')).toBe(String(40 * 1024));
        // The default centred-cover crop for a 1200x1600 source at a 600x750
        // (0.8) target: width stays 1200, height becomes 1500, centred.
        expect(form.get('crop_x')).toBe('0');
        expect(form.get('crop_y')).toBe('50');
        expect(form.get('crop_width')).toBe('1200');
        expect(form.get('crop_height')).toBe('1500');
        expect(form.get('minBytes')).toBeNull();
        expect(form.get('dpi')).toBeNull();

        expect(extras).toMatchObject({
            sourceWidth: 1200,
            sourceHeight: 1600,
            targetWidth: 600,
            targetHeight: 750,
        });
    });

    it('clears a finished result when the frame moves, so Make photo comes back for the new crop', async () => {
        const user = userEvent.setup();
        await mountWithImage();

        fireEvent.change(widthField(), { target: { value: '600' } });
        fireEvent.change(heightField(), { target: { value: '600' } });
        await user.click(actionButton());
        await act(async () => {
            harness.setResult({
                blob: new Blob(['x']), filename: 'resizo-passport.jpg', width: 600, height: 600,
                originalBytes: 500 * 1024, resultBytes: 40 * 1024, format: 'jpeg', checks: [], verified: true,
            });
        });
        expect(screen.queryByRole('button', { name: /^make photo$/i })).toBeNull();

        await user.click(screen.getByRole('button', { name: /simulate drag/i }));

        expect(screen.getByRole('button', { name: /^make photo$/i })).toBeVisible();
        expect(screen.queryByRole('button', { name: /download photo/i })).toBeNull();
    });

    it('sends the crop the frame reports once the visitor has moved it', async () => {
        const user = userEvent.setup();
        await mountWithImage();

        fireEvent.change(widthField(), { target: { value: '600' } });
        fireEvent.change(heightField(), { target: { value: '750' } });
        await user.click(screen.getByRole('button', { name: /simulate drag/i }));

        await user.click(actionButton());

        const [form] = harness.submit.mock.calls[0];
        expect(form.get('crop_x')).toBe('1');
        expect(form.get('crop_y')).toBe('2');
        expect(form.get('crop_width')).toBe('10');
        expect(form.get('crop_height')).toBe('10');
    });

    it('derives pixels from a physical preset and writes the matching DPI', async () => {
        const user = userEvent.setup();
        await mountWithImage();

        await user.click(screen.getByRole('button', { name: /united kingdom.*printed/i }));
        await user.click(actionButton());

        const [form] = harness.submit.mock.calls[0];
        expect(form.get('width')).toBe('413');
        expect(form.get('height')).toBe('531');
        expect(form.get('dpi')).toBe('300');
    });

    /**
     * 2 inches at 300 DPI is exactly 600 px — inches multiply straight
     * through with no ÷ 25.4 step. If the field had filled itself from the
     * rounded 51 mm figure instead of "2 in", this would submit 602.
     */
    it('derives pixels from an inch-published preset without a millimetre rounding', async () => {
        const user = userEvent.setup();
        await mountWithImage();

        await user.click(screen.getByRole('button', { name: /united states/i }));
        await user.click(actionButton());

        const [form] = harness.submit.mock.calls[0];
        expect(form.get('width')).toBe('600');
        expect(form.get('height')).toBe('600');
        expect(form.get('dpi')).toBe('300');
    });

    it('sends no crop fields once the photo is kept whole under Fit inside', async () => {
        const user = userEvent.setup();
        await mountWithImage();

        fireEvent.change(widthField(), { target: { value: '600' } });
        fireEvent.change(heightField(), { target: { value: '750' } });
        await user.click(screen.getByRole('radio', { name: /fit inside/i }));
        await user.click(actionButton());

        const [form] = harness.submit.mock.calls[0];
        expect(form.get('geometry')).toBe('contain');
        expect(form.get('crop_x')).toBeNull();
        expect(form.get('crop_y')).toBeNull();
        expect(form.get('crop_width')).toBeNull();
        expect(form.get('crop_height')).toBeNull();
    });

    it('will not submit before a width and a height exist', async () => {
        const user = userEvent.setup();
        await mountWithImage();

        expect(actionButton()).toBeDisabled();
        await user.click(actionButton()).catch(() => {});
        expect(harness.submit).not.toHaveBeenCalled();
    });
});

/* -------------------------------------------------------------- failure */

describe('the error state', () => {
    it('renders all three recovery buttons in custom mode', async () => {
        await mountWithImage();

        await act(async () => {
            harness.setFailure({
                error: 'Resizo couldn’t produce a JPEG under 20 KB at 600 × 750 pixels.',
                suggestion: 'Allow a lower quality, choose WebP, or raise the limit.',
                code: TARGET_UNREACHABLE_CODE,
            });
        });

        expect(screen.getByText(/couldn.t produce a jpeg under 20 kb/i)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /^allow lower quality$/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /^switch to webp$/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /^change the limit$/i })).toBeInTheDocument();
    });

    it('hides Switch to WebP once a verified preset is active', async () => {
        const user = userEvent.setup();
        await mountWithImage();

        await user.click(screen.getByRole('button', { name: /united states/i }));

        await act(async () => {
            harness.setFailure({
                error: 'Resizo couldn’t produce a JPEG under 20 KB at 602 × 602 pixels.',
                suggestion: 'Allow a lower quality, or raise the limit.',
                code: TARGET_UNREACHABLE_CODE,
            });
        });

        expect(screen.getByRole('button', { name: /^allow lower quality$/i })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /^switch to webp$/i })).toBeNull();
    });

    it('focuses the maximum-size field for a ceiling that could not be reached', async () => {
        const user = userEvent.setup();
        await mountWithImage();

        await act(async () => {
            harness.setFailure({ error: 'Too small.', suggestion: null, code: TARGET_UNREACHABLE_CODE });
        });

        await user.click(screen.getByRole('button', { name: /^change the limit$/i }));

        expect(document.activeElement).toBe(screen.getByLabelText(/maximum file size/i));
    });

    it('focuses the minimum-size field for a floor that could not be reached', async () => {
        const user = userEvent.setup();
        await mountWithImage();

        await act(async () => {
            harness.setFailure({ error: 'Too big a floor.', suggestion: null, code: 'minimum-unreachable' });
        });

        await user.click(screen.getByRole('button', { name: /^change the minimum$/i }));

        expect(document.activeElement).toBe(screen.getByLabelText(/minimum file size/i));
    });
});

/* -------------------------------------------------------------- summary */

describe('the finished result', () => {
    async function withResult(checks) {
        const view = await mountWithImage();
        await act(async () => {
            harness.setResult({
                blob: new Blob([new Uint8Array(8)], { type: 'image/jpeg' }),
                filename: 'resizo-passport-photo.jpg',
                format: 'jpeg',
                width: 600,
                height: 750,
                originalBytes: 500 * 1024,
                resultBytes: 38 * 1024,
                fit: 'cover',
                dpi: { before: null, after: null },
                verified: checks.every((check) => check.ok !== false),
                checks,
            });
        });
        return view;
    }

    it('renders Meets, Fails and Not required as words in the requirement summary', async () => {
        await withResult([
            { key: 'dimensions', label: 'Dimensions', required: '600×750 px', actual: '600×750 px', ok: true },
            { key: 'dpi', label: 'DPI', required: 'Not requested', actual: '—', ok: null },
        ]);

        expect(screen.getByText('Meets')).toBeInTheDocument();
        expect(screen.getByText('Not required')).toBeInTheDocument();

        await act(async () => {
            harness.setResult({
                blob: new Blob([new Uint8Array(8)], { type: 'image/jpeg' }),
                filename: 'resizo-passport-photo.jpg',
                format: 'jpeg',
                width: 600,
                height: 750,
                originalBytes: 500 * 1024,
                resultBytes: 45 * 1024,
                fit: 'cover',
                dpi: { before: null, after: null },
                verified: false,
                checks: [
                    { key: 'maxBytes', label: 'Maximum file size', required: '≤ 40 KB', actual: '45 KB', ok: false },
                ],
            });
        });

        expect(screen.getByText('Fails')).toBeInTheDocument();
    });

    it('offers the finished photo under a button naming what it is', async () => {
        await withResult([{ key: 'dimensions', label: 'Dimensions', required: '600×750 px', actual: '600×750 px', ok: true }]);

        expect(screen.getByRole('button', { name: /download photo/i })).toBeInTheDocument();
    });

    it('shows the exact size as the payoff rather than a savings percentage', async () => {
        const { container } = await withResult([
            { key: 'dimensions', label: 'Dimensions', required: '600×750 px', actual: '600×750 px', ok: true },
        ]);

        // The oversized payoff numeral is the ONE element carrying this
        // class; the "Size" row underneath repeats the same digits in plain
        // mono text, so a bare getByText('600×750') matches both.
        expect(container.querySelector('.text-numeral')).toHaveTextContent('600×750');
        expect(screen.getByText('exact')).toBeInTheDocument();
    });
});

/* -------------------------------------------------------------------- a11y */

describe('the sample offer', () => {
    it('loads the generated portrait that ships in public/samples, so the sentence about it is true', async () => {
        const fs = await import('node:fs');
        const path = await import('node:path');
        const user = userEvent.setup();
        const fetched = [];
        const original = globalThis.fetch;
        globalThis.fetch = async (url) => { fetched.push(String(url)); return { ok: false }; };
        try {
            render(<PassportTool />);
            await user.click(screen.getByRole('button', { name: /try the sample photo/i }));
        } finally {
            globalThis.fetch = original;
        }
        expect(fetched).toEqual(['/samples/portrait-1200x1600.jpg']);
        expect(fs.existsSync(path.join(process.cwd(), 'public', 'samples', 'portrait-1200x1600.jpg'))).toBe(true);
    });

    it('names the sample as a generated scene, not a real person, before any file is chosen', () => {
        render(<PassportTool />);

        expect(screen.getByRole('button', { name: /try the sample photo/i })).toBeInTheDocument();
        expect(screen.getByText(/not a real person/i)).toBeInTheDocument();
    });
});

describe('within the frame', () => {
    it('exposes the frame as a labelled group', async () => {
        await mountWithImage();
        fireEvent.change(widthField(), { target: { value: '600' } });
        fireEvent.change(heightField(), { target: { value: '750' } });

        expect(within(screen.getByTestId('frame-crop')).getByRole).toBeTruthy();
        expect(screen.getByRole('group', { name: /position your photo inside the frame/i })).toBeInTheDocument();
    });
});

/* ---------------------------------------------------- recovery matches the failure */

describe('the recovery buttons match the failure and the format', () => {
    const FLOOR = {
        error: 'Resizo couldn’t reach the 50 KB minimum at 600 × 750 pixels even at the highest quality.',
        suggestion: 'Ask for larger dimensions, or PNG, which is bigger.',
        code: 'minimum-unreachable',
    };

    it('offers PNG and a larger size for a floor, and never a lower quality, which only lowers a ceiling', async () => {
        const user = userEvent.setup();
        await mountWithImage();
        fireEvent.change(widthField(), { target: { value: '600' } });
        fireEvent.change(heightField(), { target: { value: '750' } });

        await act(async () => { harness.setFailure(FLOOR); });

        expect(screen.queryByRole('button', { name: /^allow lower quality$/i })).toBeNull();
        expect(screen.getByRole('button', { name: /^switch to png$/i })).toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: /^change the size$/i }));
        expect(document.activeElement).toBe(widthField());
    });

    it('offers no minimum to change under a preset, whose minimum is not a field', async () => {
        const user = userEvent.setup();
        await mountWithImage();
        await user.click(screen.getByRole('button', { name: /united kingdom\s*digital/i }));

        await act(async () => { harness.setFailure(FLOOR); });

        expect(screen.queryByRole('button', { name: /^change the minimum$/i })).toBeNull();
        expect(screen.getByRole('button', { name: /^switch to png$/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /^change the size$/i })).toBeInTheDocument();
    });

    it('does not offer a lower quality for a PNG ceiling, since PNG has no quality here', async () => {
        const user = userEvent.setup();
        await mountWithImage();
        await user.click(screen.getByRole('radio', { name: /^png$/i }));

        await act(async () => {
            harness.setFailure({ error: 'Resizo couldn’t produce a PNG under 20 KB at 600 × 600 pixels.', suggestion: null, code: TARGET_UNREACHABLE_CODE });
        });

        expect(screen.queryByRole('button', { name: /^allow lower quality$/i })).toBeNull();
        expect(screen.getByRole('button', { name: /^change the limit$/i })).toBeInTheDocument();
    });

    it('clears the DPI field when switching to WebP, and says why', async () => {
        const user = userEvent.setup();
        await mountWithImage();
        fireEvent.change(widthField(), { target: { value: '600' } });
        fireEvent.change(heightField(), { target: { value: '600' } });
        fireEvent.change(dpiField(), { target: { value: '300' } });

        await act(async () => {
            harness.setFailure({ error: 'Resizo couldn’t produce a JPEG under 20 KB at 600 × 600 pixels.', suggestion: null, code: TARGET_UNREACHABLE_CODE });
        });
        await user.click(screen.getByRole('button', { name: /^switch to webp$/i }));

        expect(dpiField()).toHaveValue(null);
        expect(screen.getByText(/WebP carries no print-resolution record/i)).toBeInTheDocument();
        expect(screen.getByRole('radio', { name: /^webp$/i })).toBeChecked();
    });
});

describe('enlarging is said out loud', () => {
    it('warns before the run when the target is larger than the area kept', async () => {
        const user = userEvent.setup();
        await mountWithImage();
        fireEvent.change(widthField(), { target: { value: '600' } });
        fireEvent.change(heightField(), { target: { value: '600' } });
        expect(screen.queryByText(/will be enlarged/i)).toBeNull();

        await user.click(screen.getByRole('button', { name: /simulate drag/i }));

        expect(screen.getByText(/will be enlarged/i)).toBeInTheDocument();
    });

    it('says in the result that the photo was enlarged, and from what', async () => {
        await mountWithImage();
        fireEvent.change(widthField(), { target: { value: '600' } });
        fireEvent.change(heightField(), { target: { value: '600' } });

        await act(async () => {
            harness.setResult({
                blob: new Blob(['x']), filename: 'resizo-passport.jpg', width: 600, height: 600,
                originalBytes: 500 * 1024, resultBytes: 40 * 1024, format: 'jpeg', fit: 'cover',
                crop: { x: 1, y: 2, width: 10, height: 10 }, checks: [], verified: true,
            });
        });

        expect(screen.getByText(/enlarged from 10×10/i)).toBeInTheDocument();
    });
});
