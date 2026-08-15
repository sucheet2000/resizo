'use client';

/**
 * TransparencyBackground
 *
 * JPEG has no alpha channel, so something has to be decided about a transparent
 * pixel on the way out. The engine composites onto BLACK, because that is what
 * libvips does with no background given and what every output here has always
 * done — see lib/image-client/flatten.js.
 *
 * Black is the right default and the wrong answer for a logo. A cut-out mark or
 * a flat graphic — most of what /png-to-jpg actually receives — comes back
 * looking broken on black, and the visitor is the only one who knows whether
 * they have a photograph or a logo. So the choice is offered rather than
 * decided, and the default does not move: the pages that promise black stay
 * true, and the sharp reference the test suite measures against keeps agreeing.
 *
 * ONLY RENDERED WHEN IT CAN MATTER. A control that appears for a JPEG source,
 * or for a PNG output, is a control that teaches people to ignore it. The
 * caller decides, because only it knows both formats.
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

const SWATCH = 'size-4 shrink-0 rounded-[3px] border border-line';

export default function TransparencyBackground({ value, onChange, className = '' }) {
    const group = useId();
    const isPreset = BACKGROUND_PRESETS.some((preset) => preset.value === value);
    const custom = isPreset ? CUSTOM_DEFAULT : (value || CUSTOM_DEFAULT);

    return (
        <fieldset className={className}>
            <legend className="text-micro font-semibold text-ink">
                Transparent areas become
            </legend>
            <p className="mt-1 text-micro text-ink-muted">
                JPEG cannot store transparency, so it has to be filled with something.
            </p>

            <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-2">
                {BACKGROUND_PRESETS.map((preset) => (
                    <label key={preset.value} className="flex items-center gap-2 text-ui text-ink">
                        <input
                            type="radio"
                            name={group}
                            value={preset.value}
                            checked={value === preset.value}
                            onChange={() => onChange(preset.value)}
                            className="size-4 accent-[var(--accent)]"
                        />
                        <span aria-hidden="true" className={SWATCH} style={{ background: preset.hex }} />
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
