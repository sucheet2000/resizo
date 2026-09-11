'use client';

/**
 * TransparencyBackground
 *
 * JPEG has no alpha channel, so something has to be decided about a transparent
 * pixel on the way out. The engine composites onto WHITE — see
 * lib/image-client/flatten.js for why that colour and not the black libvips
 * hands out when nobody asks.
 *
 * White is the right default and still not everybody's answer: a white logo or
 * a screenshot of a dark interface wants black, and a brand wants its own
 * colour. The visitor is the only one who knows which they have, so all three
 * are offered here rather than decided for them. The legend and the line under
 * it say what the control does in plain words, because the transparent pixels
 * are the one thing a person cannot see going wrong until the file is saved.
 *
 * ONLY RENDERED WHEN IT CAN MATTER. A control that appears for a JPEG source,
 * or for a PNG output, is a control that teaches people to ignore it. The
 * caller decides, because only it knows both formats.
 *
 * ALLOWTRANSPARENT — added for /favicon-generator. Every icon format this
 * engine writes (PNG, and the PNG payloads inside favicon.ico) carries an
 * alpha channel, so "leave it transparent" is a genuine fourth choice there,
 * not merely the fallback JPEG forces. `allowTransparent` prepends that
 * option; it defaults to off, so every existing caller (FitTool,
 * PrintSheetTool, BulkConvertTool) renders exactly as before. The swatch for
 * it is the site's own alpha checkerboard rather than a solid colour, because
 * there is no colour to show — it is the one preset with nothing behind it.
 *
 * `id` lets a caller with an E2E contract on the DOM `name` (favicon-generator
 * needs `icon-background`) give the group a literal, predictable name instead
 * of the auto-generated one every other caller is happy to leave to useId().
 * It also becomes the custom colour field's id, `${id}-custom`.
 */
import { useId } from 'react';

import Field from '@/components/ui/Field';
import { BACKGROUND_PRESETS } from '@/lib/image-client/flatten';

/**
 * The colour the custom picker opens on. Taken from the engine's own preset
 * list rather than written here: a hex literal in a component is a design
 * token in the wrong place, and tests/design/contract.test.js is right to say
 * so. This one is DATA — the colour a visitor's pixels become — and its single
 * source is lib/image-client/flatten.js.
 */
const CUSTOM_DEFAULT = BACKGROUND_PRESETS.find((preset) => preset.value === 'white').hex;

const CUSTOM = 'custom';

const TRANSPARENT = 'transparent';

/** Not one of the engine's own presets: it has no colour, only a texture. */
const TRANSPARENT_PRESET = { value: TRANSPARENT, label: 'Transparent' };

const SWATCH = 'size-4 shrink-0 rounded-[3px] border border-line';

export default function TransparencyBackground({ value, onChange, className = '', allowTransparent = false, id }) {
    const generatedId = useId();
    const group = id ?? generatedId;
    const presets = allowTransparent ? [TRANSPARENT_PRESET, ...BACKGROUND_PRESETS] : BACKGROUND_PRESETS;
    const isPreset = presets.some((preset) => preset.value === value);
    const custom = isPreset ? CUSTOM_DEFAULT : (value || CUSTOM_DEFAULT);

    const legend = allowTransparent ? 'Icon background' : 'Transparent areas become';
    const helpText = allowTransparent
        ? 'Transparent keeps the see-through parts of your image see-through in every generated icon. Choosing a colour fills them in instead.'
        : 'JPEG cannot store transparency, so the see-through parts of your image are filled with this colour.';

    return (
        <fieldset className={className}>
            <legend className="text-micro font-semibold text-ink">
                {legend}
            </legend>
            <p className="mt-1 text-micro text-ink-muted">
                {helpText}
            </p>

            <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-2">
                {presets.map((preset) => (
                    <label key={preset.value} className="flex items-center gap-2 text-ui text-ink">
                        <input
                            type="radio"
                            name={group}
                            value={preset.value}
                            checked={value === preset.value}
                            onChange={() => onChange(preset.value)}
                            className="size-4 accent-[var(--accent)]"
                        />
                        {preset.value === TRANSPARENT ? (
                            <span aria-hidden="true" className={`${SWATCH} checkerboard`} />
                        ) : (
                            <span aria-hidden="true" className={SWATCH} style={{ background: preset.hex }} />
                        )}
                        {preset.label}
                    </label>
                ))}

                <label className="flex items-center gap-2 text-ui text-ink">
                    <input
                        type="radio"
                        name={group}
                        value={CUSTOM}
                        checked={!isPreset}
                        onChange={() => onChange(custom)}
                        className="size-4 accent-[var(--accent)]"
                    />
                    Custom
                </label>
            </div>

            {!isPreset ? (
                <Field
                    id={`${group}-custom`}
                    label="Custom colour"
                    labelHidden
                    className="mt-3"
                >
                    <input
                        id={`${group}-custom`}
                        type="color"
                        value={custom}
                        onChange={(event) => onChange(event.target.value)}
                        className="h-10 w-16 cursor-pointer rounded-input border border-line bg-surface-raised p-1"
                    />
                </Field>
            ) : null}
        </fieldset>
    );
}
