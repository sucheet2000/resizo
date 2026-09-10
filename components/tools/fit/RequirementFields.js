'use client';

/**
 * RequirementFields
 *
 * The field pieces a requirement-fitting tool needs — a size, a DPI, an
 * output format, a byte ceiling and floor, a fill behaviour, a background for
 * whatever the format or the geometry cannot keep transparent, and (new for
 * /image-size-fitter) a lower-quality checkbox. /passport-photo held every one
 * of these inline; they are pulled out here so /image-size-fitter can reuse
 * the exact same inputs, ids-per-`idPrefix`, and validation wiring rather than
 * retyping them.
 *
 * THE TWO PAGES DO NOT SHARE ONE LAYOUT.
 *
 * /passport-photo shows Width, Height and Unit together, always, in one
 * "Size" fieldset — every field is relevant the moment a requirement is
 * being typed. /image-size-fitter shows Width, Height, a byte ceiling and the
 * format up front and defers Unit, DPI, the byte floor, fill behaviour,
 * background and the lower-quality checkbox behind an "Advanced options"
 * disclosure, because most visitors are typing plain pixels and only some
 * need the rest. A single fixed composition cannot serve both, so this module
 * exports the pieces individually — `SizeFields`, `UnitField`, `DpiField`,
 * `FormatFields`, `MaxKbField`, `MinKbField`, `GeometryFields`,
 * `BackgroundFields`, `LowerQualityField` — plus a default `RequirementFields`
 * that composes them in /passport-photo's own existing order, controlled the
 * same way every one of them is: a `values`/`onChange(name, value)` pair, an
 * `errors` map keyed by field name, and an `idPrefix` of 'passport' | 'fit'
 * that both sets every id (`${idPrefix}-width`, …) and selects the label/hint
 * copy the two pages have always shown differently (DPI's hint, Fill
 * behaviour's labels — passport's "recommended"/"padded" wording is what its
 * existing tests pin, and it is not image-size-fitter's own copy to inherit).
 *
 * /image-size-fitter's own background control is not one of these pieces —
 * the plan for it is "background radios via TransparencyBackground
 * semantics", i.e. the already-shared `components/tools/TransparencyBackground`,
 * which FitTool imports directly. `BackgroundFields` here is /passport-photo's
 * own version, with its own legend ("…and padding become") for its own
 * Fit-inside geometry.
 */
import Alert from '@/components/ui/Alert';
import Field, { fieldDescribedBy } from '@/components/ui/Field';
import { BACKGROUND_PRESETS } from '@/lib/image-client/flatten';
import { MAX_DPI, MIN_DPI } from '@/lib/limits';

const CONTROL = 'w-full rounded-input border border-line bg-surface-raised px-3 py-2 font-data text-ui text-ink';

const SELECT = 'w-full rounded-input border border-line bg-surface-raised px-3 py-2 text-ui text-ink';

const RADIO = 'size-4 accent-[var(--accent)] disabled:opacity-50';

const CUSTOM_BACKGROUND_DEFAULT = BACKGROUND_PRESETS.find((option) => option.value === 'white').hex;

const GEOMETRY_COPY = {
    passport: [
        { value: 'cover', label: 'Crop to fill (recommended)' },
        { value: 'contain', label: 'Fit inside, padded' },
        { value: 'stretch', label: 'Stretch to fit' },
    ],
    fit: [
        { value: 'cover', label: 'Crop to fill' },
        { value: 'contain', label: 'Fit inside' },
        { value: 'stretch', label: 'Stretch' },
    ],
};

/**
 * Width and Height, in a 2- or 3-column grid depending on whether the Unit
 * select shares the fieldset — /passport-photo always shows it (`showUnit`
 * defaults true); /image-size-fitter renders Width/Height on their own and
 * `UnitField` separately, inside its Advanced options panel.
 *
 * A single `error` renders once, under Width, and marks BOTH inputs invalid —
 * /passport-photo has always treated "a width" and "a height" as one
 * question ("enter a width and a height") rather than two independent ones,
 * and that is what tests/components/tools/passport-tool.test.jsx expects.
 */
export function SizeFields({ idPrefix, width, height, unit, onChange, error = null, showUnit = true, widthRef, className = '' }) {
    const errorId = error ? `${idPrefix}-width-error` : undefined;

    return (
        <fieldset className={className}>
            <legend className="text-ui text-ink">Size</legend>
            <div className={`mt-2 grid grid-cols-2 gap-3 sm:max-w-md ${showUnit ? 'sm:grid-cols-3' : ''}`.trim()}>
                <Field id={`${idPrefix}-width`} label="Width" error={error}>
                    <input
                        ref={widthRef}
                        id={`${idPrefix}-width`}
                        type="number"
                        inputMode="decimal"
                        min="0"
                        step="any"
                        value={width}
                        onChange={(event) => onChange('width', event.target.value)}
                        aria-describedby={errorId}
                        aria-invalid={error ? true : undefined}
                        className={CONTROL}
                    />
                </Field>

                <Field id={`${idPrefix}-height`} label="Height">
                    <input
                        id={`${idPrefix}-height`}
                        type="number"
                        inputMode="decimal"
                        min="0"
                        step="any"
                        value={height}
                        onChange={(event) => onChange('height', event.target.value)}
                        aria-describedby={errorId}
                        aria-invalid={error ? true : undefined}
                        className={CONTROL}
                    />
                </Field>

                {showUnit ? (
                    <Field id={`${idPrefix}-unit`} label="Unit">
                        <select
                            id={`${idPrefix}-unit`}
                            value={unit}
                            onChange={(event) => onChange('unit', event.target.value)}
                            className={SELECT}
                        >
                            <option value="px">px</option>
                            <option value="mm">mm</option>
                            <option value="cm">cm</option>
                            <option value="in">in</option>
                        </select>
                    </Field>
                ) : null}
            </div>
        </fieldset>
    );
}

/** The Unit select on its own, for a page that reveals it apart from Width/Height. */
export function UnitField({ idPrefix, unit, onChange, className = '' }) {
    return (
        <Field id={`${idPrefix}-unit`} label="Unit" className={className}>
            <select
                id={`${idPrefix}-unit`}
                value={unit}
                onChange={(event) => onChange('unit', event.target.value)}
                className={SELECT}
            >
                <option value="px">px</option>
                <option value="mm">mm</option>
                <option value="cm">cm</option>
                <option value="in">in</option>
            </select>
        </Field>
    );
}

/**
 * DPI's label is the one piece of copy both pages already agreed on —
 * optional in pixels, required once the unit is physical — so only the HINT
 * branches by `idPrefix`: /passport-photo explains what the number is for,
 * /image-size-fitter (which has no authority to name) says plainly that a
 * physical default is Resizo's own choice, not a quoted requirement.
 */
export function DpiField({ idPrefix, unit, dpi, onChange, error = null, className = '' }) {
    const isPhysical = unit !== 'px';
    const label = isPhysical ? 'DPI' : 'DPI (optional)';

    const hint = idPrefix === 'fit' && isPhysical
        ? 'Resizo’s own default — no authority is being quoted.'
        : (isPhysical
            ? 'Converts the size above into pixels, and is written into the file.'
            : 'Only needed if a form checks the print resolution — otherwise leave it empty.');

    return (
        <Field
            id={`${idPrefix}-dpi`}
            label={label}
            hint={hint}
            error={error}
            className={`max-w-[10rem] ${className}`.trim()}
        >
            <input
                id={`${idPrefix}-dpi`}
                type="number"
                inputMode="numeric"
                min={MIN_DPI}
                max={MAX_DPI}
                step="1"
                value={dpi}
                onChange={(event) => onChange('dpi', event.target.value)}
                aria-describedby={fieldDescribedBy(`${idPrefix}-dpi`, { hint: true, error })}
                aria-invalid={error ? true : undefined}
                className={CONTROL}
            />
        </Field>
    );
}

/**
 * The output-format radios. Which formats appear is the caller's call —
 * /passport-photo hides WebP until a recovery button has already switched to
 * it (a preset states JPEG or PNG; WebP is never one of the stated options),
 * /image-size-fitter always offers all three — so `options` is required
 * rather than read from `lib/format/fit-requirements`'s FORMATS here.
 */
export function FormatFields({ idPrefix, format, onChange, options, webpNote = false, className = '' }) {
    return (
        <fieldset className={className}>
            <legend className="text-ui text-ink">Output format</legend>
            <div className="mt-2 flex flex-wrap gap-x-6 gap-y-2">
                {options.map((option) => (
                    <label key={option.value} className="flex items-center gap-2 text-ui text-ink">
                        <input
                            type="radio"
                            name={`${idPrefix}-format`}
                            value={option.value}
                            checked={format === option.value}
                            onChange={() => onChange('format', option.value)}
                            className={RADIO}
                        />
                        {option.label}
                    </label>
                ))}
            </div>
            {webpNote ? (
                <p className="mt-2 text-micro text-ink-muted">
                    WebP carries no print-resolution record, so no DPI is written into a WebP file.
                </p>
            ) : null}
        </fieldset>
    );
}

export function MaxKbField({ idPrefix, value, onChange, error = null, inputRef, className = '' }) {
    return (
        <Field
            id={`${idPrefix}-max-kb`}
            label="Maximum file size (KB)"
            hint="Leave empty for no limit."
            error={error}
            className={className}
        >
            <input
                ref={inputRef}
                id={`${idPrefix}-max-kb`}
                type="number"
                inputMode="numeric"
                min="1"
                step="1"
                placeholder="No limit"
                value={value}
                onChange={(event) => onChange('maxKb', event.target.value)}
                aria-describedby={fieldDescribedBy(`${idPrefix}-max-kb`, { hint: true, error })}
                aria-invalid={error ? true : undefined}
                className={CONTROL}
            />
        </Field>
    );
}

export function MinKbField({ idPrefix, value, onChange, error = null, inputRef, className = '' }) {
    return (
        <Field
            id={`${idPrefix}-min-kb`}
            label="Minimum file size (KB)"
            hint="Leave empty for no minimum."
            error={error}
            className={className}
        >
            <input
                ref={inputRef}
                id={`${idPrefix}-min-kb`}
                type="number"
                inputMode="numeric"
                min="1"
                step="1"
                placeholder="No minimum"
                value={value}
                onChange={(event) => onChange('minKb', event.target.value)}
                aria-describedby={fieldDescribedBy(`${idPrefix}-min-kb`, { hint: true, error })}
                aria-invalid={error ? true : undefined}
                className={CONTROL}
            />
        </Field>
    );
}

/**
 * Fill behaviour. Labels and the Stretch warning both branch on `idPrefix`:
 * /passport-photo's labels ("recommended", "padded") and its Alert-boxed
 * warning are its own existing copy, pinned by its tests; /image-size-fitter
 * gets shorter labels and a plain hint rather than an Alert, since nothing
 * has gone wrong by choosing Stretch — it is a note, not an error.
 */
export function GeometryFields({ idPrefix, geometry, onChange, className = '' }) {
    const options = GEOMETRY_COPY[idPrefix] ?? GEOMETRY_COPY.fit;

    return (
        <fieldset className={className}>
            <legend className="text-ui text-ink">Fill behaviour</legend>
            <div className="mt-2 flex flex-col gap-2">
                {options.map((option) => (
                    <label key={option.value} className="flex items-center gap-2 text-ui text-ink">
                        <input
                            type="radio"
                            name={`${idPrefix}-geometry`}
                            value={option.value}
                            checked={geometry === option.value}
                            onChange={() => onChange('geometry', option.value)}
                            className={RADIO}
                        />
                        {option.label}
                    </label>
                ))}
            </div>
            {geometry === 'stretch' ? (
                idPrefix === 'passport' ? (
                    <Alert tone="info" className="mt-2">
                        Distorts the picture. Only for a portal that checks nothing but the pixel count.
                    </Alert>
                ) : (
                    <p className="mt-2 text-micro text-ink-muted">The picture may look distorted.</p>
                )
            ) : null}
        </fieldset>
    );
}

/**
 * /passport-photo's own background control: White/Black/Custom plus the
 * colour picker, legended for a tool where padding (Fit inside) as well as a
 * missing alpha channel (JPEG) both need a fill colour. This is NOT what
 * /image-size-fitter uses — see the file note above.
 */
export function BackgroundFields({ idPrefix, background, onChange, className = '' }) {
    const isCustomBackground = !BACKGROUND_PRESETS.some((option) => option.value === background);

    return (
        <fieldset className={className}>
            <legend className="text-ui text-ink">Transparent areas and padding become</legend>
            <p className="mt-1 text-micro text-ink-muted">
                A JPEG cannot stay see-through, and Fit inside adds padding around the photo — both are
                filled with this colour.
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-x-6 gap-y-2">
                {BACKGROUND_PRESETS.map((option) => (
                    <label key={option.value} className="flex items-center gap-2 text-ui text-ink">
                        <input
                            type="radio"
                            name={`${idPrefix}-background`}
                            value={option.value}
                            checked={background === option.value}
                            onChange={() => onChange('background', option.value)}
                            className={RADIO}
                        />
                        <span
                            aria-hidden="true"
                            className="size-4 shrink-0 rounded-[3px] border border-line"
                            style={{ background: option.hex }}
                        />
                        {option.label}
                    </label>
                ))}
                <label className="flex items-center gap-2 text-ui text-ink">
                    <input
                        type="radio"
                        name={`${idPrefix}-background`}
                        value="custom"
                        checked={isCustomBackground}
                        onChange={() => onChange('background', CUSTOM_BACKGROUND_DEFAULT)}
                        className={RADIO}
                    />
                    Custom
                </label>
            </div>
            {isCustomBackground ? (
                <Field id={`${idPrefix}-background-custom`} label="Custom colour" labelHidden className="mt-3">
                    <input
                        id={`${idPrefix}-background-custom`}
                        type="color"
                        value={background}
                        onChange={(event) => onChange('background', event.target.value)}
                        className="h-10 w-16 cursor-pointer rounded-input border border-line bg-surface-raised p-1"
                    />
                </Field>
            ) : null}
        </fieldset>
    );
}

/**
 * New for /image-size-fitter: the byte-search floor can be pushed all the way
 * to full quality loss rather than only what the ceiling already tries.
 * /passport-photo offers the same idea only as a post-failure recovery button
 * ("Allow lower quality"); this is the up-front checkbox /image-size-fitter's
 * plan asks for, so it is its own field rather than a `show` branch on
 * something passport already renders differently.
 */
export function LowerQualityField({ idPrefix, checked, onChange, className = '' }) {
    const id = `${idPrefix}-lower-quality`;
    const hintId = `${id}-hint`;

    return (
        <div className={`flex flex-col gap-1 ${className}`.trim()}>
            <label htmlFor={id} className="flex items-center gap-2 text-ui text-ink">
                <input
                    type="checkbox"
                    id={id}
                    checked={checked}
                    onChange={(event) => onChange('allowLowerQuality', event.target.checked)}
                    aria-describedby={hintId}
                    className="size-4 accent-[var(--accent)]"
                />
                Allow lower quality
            </label>
            <p id={hintId} className="text-micro text-ink-muted">
                Searches quality all the way down. The picture may show artefacts.
            </p>
        </div>
    );
}

/**
 * The default assembly: every field above, composed in /passport-photo's own
 * existing order (Size → DPI → Format → byte limits → Fill behaviour →
 * Background → [Lower quality, unused today]). This is what /passport-photo
 * renders; /image-size-fitter composes the individual pieces itself instead,
 * split across its primary row and its Advanced options panel.
 *
 * `show` gates the optional pieces: `unit` (SizeFields' third column),
 * `dpi`, `minKb` (or `minNote`, a sentence to show in its place — passport's
 * "this requirement also asks for at least …" under a preset with no
 * editable minimum field), `geometry`, `background`, `lowerQuality`.
 * `refs` exposes `{ width, maxKb, minKb }` for a caller's recovery buttons to
 * focus.
 */
export default function RequirementFields({
    idPrefix,
    values,
    onChange,
    errors = {},
    show = {},
    refs = {},
    formatOptions,
}) {
    const sizeError = errors.width || errors.height || errors.size || null;

    return (
        <div className="flex flex-col gap-6">
            <SizeFields
                idPrefix={idPrefix}
                width={values.width}
                height={values.height}
                unit={values.unit}
                onChange={onChange}
                error={sizeError}
                showUnit={show.unit !== false}
                widthRef={refs.width}
            />

            {show.dpi !== false ? (
                <DpiField
                    idPrefix={idPrefix}
                    unit={values.unit}
                    dpi={values.dpi}
                    onChange={onChange}
                    error={errors.dpi}
                />
            ) : null}

            <FormatFields
                idPrefix={idPrefix}
                format={values.format}
                onChange={onChange}
                options={formatOptions}
                webpNote={values.format === 'webp'}
            />

            <div className="grid grid-cols-1 gap-4 sm:max-w-md sm:grid-cols-2">
                <MaxKbField idPrefix={idPrefix} value={values.maxKb} onChange={onChange} error={errors.maxKb} inputRef={refs.maxKb} />
                {show.minKb ? (
                    <MinKbField idPrefix={idPrefix} value={values.minKb} onChange={onChange} error={errors.minKb} inputRef={refs.minKb} />
                ) : (show.minNote ? (
                    <p className="self-end text-micro text-ink-muted">{show.minNote}</p>
                ) : null)}
            </div>

            {show.geometry !== false ? (
                <GeometryFields idPrefix={idPrefix} geometry={values.geometry} onChange={onChange} />
            ) : null}

            {show.background !== false ? (
                <BackgroundFields idPrefix={idPrefix} background={values.background} onChange={onChange} />
            ) : null}

            {show.lowerQuality ? (
                <LowerQualityField idPrefix={idPrefix} checked={Boolean(values.allowLowerQuality)} onChange={onChange} />
            ) : null}
        </div>
    );
}
