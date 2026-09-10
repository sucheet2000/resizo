/**
 * RequirementFields
 *
 * The field pieces /passport-photo and /image-size-fitter both need, pulled
 * out so neither page re-types a label, an id scheme or a validation wire-up.
 * The default export composes them in /passport-photo's own existing order
 * and is exercised end-to-end by tests/components/tools/passport-tool.test.jsx;
 * this suite covers the pieces directly, including the split /image-size-fitter
 * needs (Width/Height without Unit, Unit and the byte/geometry/background/
 * lower-quality fields on their own) that the default assembly does not
 * exercise.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import RequirementFields, {
    BackgroundFields,
    DpiField,
    FormatFields,
    GeometryFields,
    LowerQualityField,
    MaxKbField,
    MinKbField,
    SizeFields,
    UnitField,
} from '@/components/tools/fit/RequirementFields';

const FORMAT_OPTIONS = [
    { value: 'jpeg', label: 'JPEG' },
    { value: 'png', label: 'PNG' },
    { value: 'webp', label: 'WebP' },
];

describe('SizeFields', () => {
    it('renders Width, Height and Unit, wired to onChange by name', async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        render(<SizeFields idPrefix="fit" width="600" height="" unit="px" onChange={onChange} error={null} />);

        expect(screen.getByRole('spinbutton', { name: /^width$/i })).toHaveValue(600);
        expect(document.getElementById('fit-width')).toBeInTheDocument();
        expect(document.getElementById('fit-height')).toBeInTheDocument();

        await user.type(screen.getByRole('spinbutton', { name: /^height$/i }), '7');
        expect(onChange).toHaveBeenCalledWith('height', '7');

        await user.selectOptions(screen.getByRole('combobox', { name: /^unit$/i }), 'mm');
        expect(onChange).toHaveBeenCalledWith('unit', 'mm');
    });

    it('omits the Unit select when showUnit is false, leaving Width and Height alone', () => {
        render(<SizeFields idPrefix="fit" width="" height="" unit="px" onChange={() => {}} showUnit={false} />);
        expect(screen.queryByRole('combobox', { name: /^unit$/i })).toBeNull();
        expect(document.getElementById('fit-unit')).toBeNull();
        expect(screen.getByRole('spinbutton', { name: /^width$/i })).toBeInTheDocument();
    });

    it('marks both Width and Height invalid under one error, shown once', () => {
        render(<SizeFields idPrefix="fit" width="" height="600" unit="px" onChange={() => {}} error="Width must be a whole number greater than 0." />);
        expect(screen.getByRole('spinbutton', { name: /^width$/i })).toHaveAttribute('aria-invalid', 'true');
        expect(screen.getByRole('spinbutton', { name: /^height$/i })).toHaveAttribute('aria-invalid', 'true');
        expect(screen.getAllByText('Width must be a whole number greater than 0.')).toHaveLength(1);
    });
});

describe('UnitField', () => {
    it('renders a standalone Unit select at the given id', async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        render(<UnitField idPrefix="fit" unit="px" onChange={onChange} />);
        expect(document.getElementById('fit-unit')).toBeInTheDocument();
        await user.selectOptions(screen.getByRole('combobox', { name: /^unit$/i }), 'in');
        expect(onChange).toHaveBeenCalledWith('unit', 'in');
    });
});

describe('DpiField', () => {
    it('labels DPI optional in pixels and required once physical, for passport', () => {
        const { rerender } = render(<DpiField idPrefix="passport" unit="px" dpi="" onChange={() => {}} />);
        expect(screen.getByText('DPI (optional)')).toBeInTheDocument();
        expect(screen.getByText(/only needed if a form checks the print resolution/i)).toBeInTheDocument();

        rerender(<DpiField idPrefix="passport" unit="mm" dpi="300" onChange={() => {}} />);
        expect(screen.getByText(/^DPI$/)).toBeInTheDocument();
        expect(screen.getByText(/converts the size above into pixels/i)).toBeInTheDocument();
    });

    it('credits a physical DPI to Resizo, not an authority, for fit', () => {
        render(<DpiField idPrefix="fit" unit="mm" dpi="300" onChange={() => {}} />);
        expect(screen.getByText(/resizo(&rsquo;|’)s own default — no authority is being quoted/i)).toBeInTheDocument();
    });

    it('shows the field error and wires onChange', async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        render(<DpiField idPrefix="fit" unit="px" dpi="" onChange={onChange} error="DPI must be a whole number between 1 and 10000." />);
        expect(screen.getByText('DPI must be a whole number between 1 and 10000.')).toBeInTheDocument();
        expect(screen.getByLabelText(/^dpi/i)).toHaveAttribute('aria-invalid', 'true');
        await user.type(screen.getByLabelText(/^dpi/i), '3');
        expect(onChange).toHaveBeenCalledWith('dpi', '3');
    });
});

describe('FormatFields', () => {
    it('renders exactly the options it is given, under one radio group name', async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        render(<FormatFields idPrefix="fit" format="jpeg" onChange={onChange} options={FORMAT_OPTIONS} />);

        expect(screen.getByRole('radio', { name: 'JPEG' })).toBeChecked();
        expect(screen.getByRole('radio', { name: 'PNG' })).not.toBeChecked();
        expect(screen.getByRole('radio', { name: 'WebP' })).not.toBeChecked();

        await user.click(screen.getByRole('radio', { name: 'WebP' }));
        expect(onChange).toHaveBeenCalledWith('format', 'webp');
    });

    it('shows the WebP note only when asked to', () => {
        const { rerender } = render(
            <FormatFields idPrefix="fit" format="webp" onChange={() => {}} options={FORMAT_OPTIONS} webpNote={false} />,
        );
        expect(screen.queryByText(/webp carries no print-resolution record/i)).toBeNull();

        rerender(<FormatFields idPrefix="fit" format="webp" onChange={() => {}} options={FORMAT_OPTIONS} webpNote />);
        expect(screen.getByText(/webp carries no print-resolution record/i)).toBeInTheDocument();
    });
});

describe('MaxKbField and MinKbField', () => {
    it('render independent fields at their own ids, each wired to its own name', async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        render(
            <>
                <MaxKbField idPrefix="fit" value="" onChange={onChange} />
                <MinKbField idPrefix="fit" value="" onChange={onChange} />
            </>,
        );

        expect(document.getElementById('fit-max-kb')).toBeInTheDocument();
        expect(document.getElementById('fit-min-kb')).toBeInTheDocument();

        await user.type(screen.getByLabelText(/maximum file size/i), '5');
        expect(onChange).toHaveBeenCalledWith('maxKb', '5');

        await user.type(screen.getByLabelText(/minimum file size/i), '2');
        expect(onChange).toHaveBeenCalledWith('minKb', '2');
    });

    it('shows a field-specific error message', () => {
        render(<MaxKbField idPrefix="fit" value="0" onChange={() => {}} error="Maximum file size must be greater than 0 KB." />);
        expect(screen.getByText('Maximum file size must be greater than 0 KB.')).toBeInTheDocument();
        expect(screen.getByLabelText(/maximum file size/i)).toHaveAttribute('aria-invalid', 'true');
    });
});

describe('GeometryFields', () => {
    it('uses passport’s own labels and an info Alert on Stretch', () => {
        const { rerender } = render(<GeometryFields idPrefix="passport" geometry="cover" onChange={() => {}} />);
        expect(screen.getByRole('radio', { name: /crop to fill \(recommended\)/i })).toBeInTheDocument();
        expect(screen.getByRole('radio', { name: /fit inside, padded/i })).toBeInTheDocument();
        expect(screen.getByRole('radio', { name: /stretch to fit/i })).toBeInTheDocument();
        expect(screen.queryByText(/distorts the picture/i)).toBeNull();

        rerender(<GeometryFields idPrefix="passport" geometry="stretch" onChange={() => {}} />);
        // Alert's info tone renders role="status", not role="alert" — nothing
        // has gone wrong by choosing Stretch, it is a note.
        expect(screen.getByRole('status')).toHaveTextContent(/distorts the picture/i);
    });

    it('uses fit’s own shorter labels and a plain hint on Stretch', () => {
        render(<GeometryFields idPrefix="fit" geometry="stretch" onChange={() => {}} />);
        expect(screen.getByRole('radio', { name: /^crop to fill$/i })).toBeInTheDocument();
        expect(screen.getByRole('radio', { name: /^fit inside$/i })).toBeInTheDocument();
        expect(screen.getByRole('radio', { name: /^stretch$/i })).toBeInTheDocument();
        expect(screen.queryByRole('status')).toBeNull();
        expect(screen.getByText(/the picture may look distorted/i)).toBeInTheDocument();
    });
});

describe('BackgroundFields', () => {
    it('offers White, Black and Custom, revealing the colour picker for Custom', async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        render(<BackgroundFields idPrefix="passport" background="white" onChange={onChange} />);

        expect(screen.getByRole('radio', { name: /white/i })).toBeChecked();
        expect(screen.queryByLabelText(/custom colour/i)).toBeNull();

        await user.click(screen.getByRole('radio', { name: /^custom$/i }));
        expect(onChange).toHaveBeenCalledWith('background', expect.stringMatching(/^#/));
    });

    it('shows the colour field once the background is a custom hex', () => {
        render(<BackgroundFields idPrefix="passport" background="#2f6fed" onChange={() => {}} />);
        expect(screen.getByLabelText(/custom colour/i)).toHaveValue('#2f6fed');
        expect(screen.getByRole('radio', { name: /^custom$/i })).toBeChecked();
    });
});

describe('LowerQualityField', () => {
    it('is an accessible checkbox named "Allow lower quality" with its hint attached', async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        render(<LowerQualityField idPrefix="fit" checked={false} onChange={onChange} />);

        const checkbox = screen.getByRole('checkbox', { name: /^allow lower quality$/i });
        expect(checkbox).not.toBeChecked();
        expect(screen.getByText(/searches quality all the way down/i)).toBeInTheDocument();

        await user.click(checkbox);
        expect(onChange).toHaveBeenCalledWith('allowLowerQuality', true);
    });
});

describe('the default RequirementFields assembly matches passport’s existing shape', () => {
    it('renders Size, DPI, Format, byte limits, Fill behaviour and Background in one call', () => {
        render(
            <RequirementFields
                idPrefix="passport"
                values={{
                    width: '600', height: '750', unit: 'px', dpi: '', format: 'jpeg',
                    maxKb: '', minKb: '', geometry: 'cover', background: 'white',
                }}
                onChange={() => {}}
                errors={{}}
                show={{ minKb: true }}
                formatOptions={[{ value: 'jpeg', label: 'JPEG' }, { value: 'png', label: 'PNG' }]}
            />,
        );

        expect(screen.getByRole('spinbutton', { name: /^width$/i })).toBeInTheDocument();
        expect(screen.getByRole('combobox', { name: /^unit$/i })).toBeInTheDocument();
        expect(screen.getByLabelText(/^dpi/i)).toBeInTheDocument();
        expect(screen.getByRole('radio', { name: 'JPEG' })).toBeInTheDocument();
        expect(screen.getByLabelText(/maximum file size/i)).toBeInTheDocument();
        expect(screen.getByLabelText(/minimum file size/i)).toBeInTheDocument();
        expect(screen.getByRole('radio', { name: /crop to fill \(recommended\)/i })).toBeInTheDocument();
        expect(screen.getByText(/transparent areas and padding become/i)).toBeInTheDocument();
    });

    it('hides Minimum file size and shows the preset note instead when show.minKb is false', () => {
        render(
            <RequirementFields
                idPrefix="passport"
                values={{
                    width: '600', height: '750', unit: 'px', dpi: '', format: 'jpeg',
                    maxKb: '', minKb: '', geometry: 'cover', background: 'white',
                }}
                onChange={() => {}}
                errors={{}}
                show={{ minKb: false, minNote: 'This requirement also asks for at least 50 KB.' }}
                formatOptions={[{ value: 'jpeg', label: 'JPEG' }]}
            />,
        );

        expect(screen.queryByLabelText(/minimum file size/i)).toBeNull();
        expect(screen.getByText('This requirement also asks for at least 50 KB.')).toBeInTheDocument();
    });

    it('omits the Lower-quality checkbox unless show.lowerQuality is set', () => {
        const { rerender } = render(
            <RequirementFields
                idPrefix="fit"
                values={{ width: '600', height: '600', unit: 'px', dpi: '', format: 'jpeg', maxKb: '', minKb: '', geometry: 'cover', background: 'white' }}
                onChange={() => {}}
                errors={{}}
                show={{}}
                formatOptions={FORMAT_OPTIONS}
            />,
        );
        expect(screen.queryByRole('checkbox', { name: /allow lower quality/i })).toBeNull();

        rerender(
            <RequirementFields
                idPrefix="fit"
                values={{ width: '600', height: '600', unit: 'px', dpi: '', format: 'jpeg', maxKb: '', minKb: '', geometry: 'cover', background: 'white' }}
                onChange={() => {}}
                errors={{}}
                show={{ lowerQuality: true }}
                formatOptions={FORMAT_OPTIONS}
            />,
        );
        expect(screen.getByRole('checkbox', { name: /allow lower quality/i })).toBeInTheDocument();
    });
});
