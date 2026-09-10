'use client';

/**
 * PassportTool
 *
 * A requirement fitter, not a plain resizer: a visitor arrives holding a
 * sentence somebody else published — exact pixels or a physical size, a
 * format, a byte ceiling, sometimes a DPI record — and this page has to
 * satisfy every one of those at once rather than one tool at a time undoing
 * the last.
 *
 * FOUR VERIFIED PRESETS, AND A CUSTOM MODE THAT IS NOT A LESSER PATH.
 *
 * Picking a preset chip fills every field it can answer — size, unit, DPI,
 * format, the byte ceiling — from `lib/catalog/application-presets`, which is
 * the one place those numbers are sourced and dated. Editing ANY field
 * afterwards drops back to Custom, exactly like the size chips on
 * /signature-resizer and the DPI chips on /change-image-dpi: a chip is a
 * claim about one exact set of numbers, and typing over any of them makes the
 * claim false. Custom mode is not second-class — it is the same engine op
 * with the same checks, just without an authority to cite afterwards.
 *
 * WHAT RESIZO CAN ENFORCE, AND WHAT IT CANNOT.
 *
 * The engine can hit exact pixels, an exact aspect ratio, a format, a byte
 * ceiling and floor, and a DPI record — all mechanical, all independently
 * re-checked against the actual output bytes after the job runs
 * (`validateOutput`, surfaced by RequirementSummary). It cannot see a face:
 * pose, expression, lighting, a real backdrop, red-eye, recency — none of
 * that is measurable from pixels, and every preset's `cannotVerify` list says
 * so before a visitor mistakes "Meets" for "the passport office will accept
 * this".
 *
 * WHY THE CROP FRAME ONLY APPEARS FOR "CROP TO FILL".
 *
 * "Fit inside" keeps the whole photo and pads the rest, and "Stretch" keeps
 * the whole photo and distorts it to the box — neither has a sub-region left
 * to choose, so offering a frame to drag would be a control with nothing to
 * do. Only "Crop to fill" trims to a region, which is exactly the case where
 * letting a visitor pick WHICH region — instead of a blind centre crop — is
 * worth a whole dedicated control.
 */
import { useMemo, useRef, useState } from 'react';

import FrameCrop from '@/components/tools/FrameCrop';
import PresetChips from '@/components/tools/PresetChips';
import ResultPanel from '@/components/tools/ResultPanel';
import ToolShell, { ToolAction } from '@/components/tools/ToolShell';
import Alert from '@/components/ui/Alert';
import Dropzone from '@/components/ui/Dropzone';
import Field, { fieldDescribedBy } from '@/components/ui/Field';
import RequirementSummary from './RequirementSummary';
import {
    APPLICATION_PRESETS,
    applicationPresetToRequirement,
    getApplicationPreset,
} from '@/lib/catalog/application-presets';
import { formatFileSize } from '@/lib/format/bytes';
import { pixelsFor } from '@/lib/format/physical';
import useImageUpload from '@/lib/hooks/useImageUpload';
import useLocalProcess from '@/lib/hooks/useLocalProcess';
import usePreviewUrl from '@/lib/hooks/usePreviewUrl';
import { BACKGROUND_PRESETS } from '@/lib/image-client/flatten';
import { TARGET_UNREACHABLE_CODE } from '@/lib/image-client/target-bytes';
import {
    MAX_DIMENSION,
    MAX_DPI,
    MAX_TARGET_BYTES,
    MIN_DPI,
    MIN_TARGET_BYTES,
    RASTER_INPUT_FORMATS,
} from '@/lib/limits';

const CONTROL = 'w-full rounded-input border border-line bg-surface-raised px-3 py-2 font-data text-ui text-ink';

const SELECT = 'w-full rounded-input border border-line bg-surface-raised px-3 py-2 text-ui text-ink';

const RADIO = 'size-4 accent-[var(--accent)] disabled:opacity-50';

// min-h-11 (44px) on every new touch control on this page, matching the
// tap-target floor components/tools/FrameCrop.js's own buttons already set.
const RECOVERY_BUTTON = 'inline-flex min-h-11 items-center justify-center rounded-button border border-line bg-surface-raised px-3 text-ui font-medium text-ink transition-colors duration-120 ease-snap hover:bg-surface-sunken';

const SAMPLE_BUTTON = 'inline-flex min-h-11 items-center justify-center rounded-button border border-line bg-surface-raised px-3 text-ui font-medium text-ink transition-colors duration-120 ease-snap hover:bg-surface-sunken';

/**
 * lib/image-client/requirements.js reports this exact string for a floor the
 * byte search could not reach even at full quality — see the contract in
 * scratchpad/passport/plan.md. There is no shared constant to import for it
 * the way TARGET_UNREACHABLE_CODE already exists for the ceiling case, so the
 * literal is named once, here, rather than repeated at each comparison.
 */
const MIN_UNREACHABLE_CODE = 'minimum-unreachable';

const SAMPLE = {
    src: '/samples/portrait-1080x1440.jpg',
    name: 'passport-sample-portrait.jpg',
};

const SIZE_ERROR_ID = 'passport-width-error';

const BASE_FORMAT_OPTIONS = [
    { value: 'jpeg', label: 'JPEG' },
    { value: 'png', label: 'PNG' },
];

const GEOMETRY_OPTIONS = [
    { value: 'cover', label: 'Crop to fill (recommended)' },
    { value: 'contain', label: 'Fit inside, padded' },
    { value: 'stretch', label: 'Stretch to fit' },
];

const CUSTOM_BACKGROUND_DEFAULT = BACKGROUND_PRESETS.find((option) => option.value === 'white').hex;

/** The chip row: every verified preset, in registry order, plus Custom last. */
const PRESET_ITEMS = [
    ...APPLICATION_PRESETS.map((item) => ({
        id: item.id,
        label: item.jurisdiction,
        detail: item.use === 'digital' ? 'Digital' : 'Printed',
    })),
    { id: 'custom', label: 'Custom', detail: null },
];

const FORMAT_LABELS = { jpeg: 'JPEG', png: 'PNG', webp: 'WebP' };

function formatName(format) {
    return FORMAT_LABELS[format] ?? String(format ?? '').toUpperCase();
}

function parsePositiveNumber(raw) {
    const value = Number(String(raw ?? '').trim());
    return Number.isFinite(value) && value > 0 ? value : null;
}

function parseDpiValue(raw) {
    const text = String(raw ?? '').trim();
    if (text === '') return null;
    const value = Number(text);
    if (!Number.isInteger(value) || value < MIN_DPI || value > MAX_DPI) return null;
    return value;
}

function parseKbToBytes(raw) {
    const text = String(raw ?? '').trim();
    if (text === '') return null;
    const value = Number(text);
    if (!Number.isFinite(value) || value <= 0) return 0;
    return Math.round(value * 1024);
}

/**
 * The largest centred rectangle of `aspect` that fits inside the source —
 * the same shape a plain 'cover' fit would land on with nobody dragging
 * anything, so a photo run without ever touching the frame gets exactly the
 * same crop the geometry option alone would have produced.
 */
function centeredCoverRect(sourceWidth, sourceHeight, aspect) {
    if (!(sourceWidth > 0) || !(sourceHeight > 0) || !(aspect > 0)) return null;

    const sourceAspect = sourceWidth / sourceHeight;
    let width;
    let height;

    if (sourceAspect > aspect) {
        height = sourceHeight;
        width = Math.round(height * aspect);
    } else {
        width = sourceWidth;
        height = Math.round(width / aspect);
    }

    width = Math.min(Math.max(width, 1), sourceWidth);
    height = Math.min(Math.max(height, 1), sourceHeight);

    return {
        x: Math.round((sourceWidth - width) / 2),
        y: Math.round((sourceHeight - height) / 2),
        width,
        height,
    };
}

/**
 * The head-band overlay FrameCrop draws, derived from whatever the preset
 * actually publishes rather than a hard-coded id.
 *
 *   - A physical preset with a published head range (US, UK print — verified
 *     against the source facts: 25/51 and 35/51 round to the 0.49/0.69 the
 *     contract quotes for the US case) draws that band, labelled 'official'.
 *   - A physical preset that asks for a centred head but publishes no
 *     min/max (India: "No numeric head-height rule") draws a generic centre
 *     band rather than either inventing a number or drawing nothing.
 *   - A pixel-only (digital) preset has no physical frame to measure a band
 *     against at all, so the guide is a wide, explicitly unmeasured
 *     composition hint instead of a claim about millimetres.
 */
function headGuideFor(preset) {
    if (!preset) return null;

    if (preset.head?.minMm && preset.head?.maxMm && preset.physical?.heightMm) {
        const heightMm = preset.physical.heightMm;
        return {
            kind: 'official',
            label: `Head ${preset.head.minMm}–${preset.head.maxMm} mm`,
            from: preset.head.minMm / heightMm,
            to: preset.head.maxMm / heightMm,
        };
    }

    if (preset.physical) {
        return {
            kind: 'guidance',
            label: 'Guidance: centre the head in the frame',
            from: 0.42,
            to: 0.58,
        };
    }

    return {
        kind: 'guidance',
        label: 'Guidance: head, shoulders and upper body filling the frame',
        from: 0.12,
        to: 0.88,
    };
}

/**
 * The line under the finished photo. Every number in it comes off the
 * RESULT, never off the live form — a setting left on screen after the job
 * ran must not be mistaken for a description of the file behind the
 * Download button.
 */
function describeOutcome(outcome) {
    if (!outcome) return null;

    const parts = [`Saved at ${outcome.width}×${outcome.height} px as ${formatName(outcome.format)}.`];

    if (outcome.fit === 'contain') parts.push('The whole photo was kept, padded to the exact box.');
    if (outcome.fit === 'stretch') parts.push('The whole photo was stretched to the exact box, which distorts it.');

    const writtenDpi = outcome.dpi?.after?.dpi;
    if (writtenDpi) {
        parts.push(writtenDpi.x === writtenDpi.y
            ? `The file now records ${writtenDpi.x} DPI.`
            : `The file now records ${writtenDpi.x} × ${writtenDpi.y} DPI.`);
    }

    parts.push(outcome.verified
        ? 'Every requirement Resizo can check was met — see the list below.'
        : 'Not every requirement Resizo can check was met — see the list below.');

    return parts.join(' ');
}

export default function PassportTool({
    title = 'Make a Passport or ID Photo to Exact Size',
    intro = 'Exact pixels, DPI, format and file size — from a verified requirement or your own numbers. Nothing is uploaded.',
    answer,
    breadcrumb,
    children,
}) {
    const [presetId, setPresetId] = useState(null);
    const [width, setWidth] = useState('');
    const [height, setHeight] = useState('');
    const [unit, setUnit] = useState('px');
    // Empty, not '300': DPI is optional in pixels, and pre-filling a value
    // nobody asked for would stamp every plain custom-pixel job with a
    // record it never requested. '300 for physical' is the default the plan
    // asks for, and it is applied the moment the unit BECOMES physical,
    // below — never before.
    const [dpi, setDpi] = useState('');
    const [format, setFormat] = useState('jpeg');
    const [maxKb, setMaxKb] = useState('');
    const [minKb, setMinKb] = useState('');
    const [geometry, setGeometry] = useState('cover');
    const [background, setBackground] = useState('white');
    const [manualRect, setManualRect] = useState(null);

    const maxKbRef = useRef(null);
    const minKbRef = useRef(null);

    const upload = useImageUpload({ accept: RASTER_INPUT_FORMATS });
    const preview = usePreviewUrl();
    const submit = useLocalProcess({
        op: 'fit',
        onSuccess: (payload) => preview.show(payload.blob),
    });

    const entry = upload.file;
    const preset = presetId ? getApplicationPreset(presetId) : null;
    const isCustom = !preset;

    /**
     * Every control on this page that changes what the job means clears both
     * the preset (a chip is a claim about ONE exact set of numbers, false the
     * moment any of them is edited by hand) and the manual crop position (a
     * rectangle drawn for one target shape is not a rectangle for another)
     * and any finished result — the same three-part reset /signature-resizer
     * and /change-image-dpi already use for their own chip-derived fields.
     */
    const clearingSetter = (setter) => (value) => {
        submit.reset();
        setPresetId(null);
        setManualRect(null);
        setter(value);
    };

    /**
     * Unit gets its own handler rather than `clearingSetter(setUnit)`: moving
     * to a physical unit with no DPI typed yet fills in the plan's own
     * default (300) as a courtesy, exactly once, so the field is not left
     * failing its own required-ness the instant the select changes. Moving
     * back to pixels leaves whatever was there — DPI stays optional in
     * pixels, it does not need clearing.
     */
    const handleUnitChange = (nextUnit) => {
        submit.reset();
        setPresetId(null);
        setManualRect(null);
        setUnit(nextUnit);
        if (nextUnit !== 'px' && dpi.trim() === '') setDpi('300');
    };

    const applyPreset = (nextPreset) => {
        const requirement = applicationPresetToRequirement(nextPreset, {
            dpi: nextPreset.dpi?.default,
        });

        submit.reset();
        setManualRect(null);
        setPresetId(nextPreset.id);

        // The FIELD carries the unit the authority actually published in, not
        // a millimetre conversion — the US preset states "2 x 2 inches (51 x
        // 51 mm)", and 2 in is 50.8 mm exactly, so filling Width/Height/Unit
        // from a rounded mm figure would show 51 mm where the source says 2
        // in, and the two round to different pixel counts at 300 DPI (602 vs
        // 600). `applicationPresetToRequirement` runs the same conversion
        // this field will run again at submit time, from the same
        // width/unit pair, which is what keeps the two from ever disagreeing.
        if (nextPreset.physical) {
            setUnit(nextPreset.physical.unit);
            setWidth(String(nextPreset.physical.width));
            setHeight(String(nextPreset.physical.height));
        } else {
            setUnit('px');
            setWidth(String(nextPreset.digital?.minWidth ?? requirement.width));
            setHeight(String(nextPreset.digital?.minHeight ?? requirement.height));
        }

        // A digital preset (UK) states no resolution at all — `requirement.dpi`
        // and `nextPreset.dpi.default` are both null for one — so the field is
        // left empty rather than implying a DPI record the authority never
        // asked for. A physical preset always has a real default (300).
        const dpiToShow = requirement.dpi ?? nextPreset.dpi?.default ?? null;
        setDpi(dpiToShow !== null ? String(dpiToShow) : '');
        setFormat(requirement.format ?? nextPreset.formats?.[0] ?? 'jpeg');
        setMaxKb(requirement.targetBytes ? String(Math.round(requirement.targetBytes / 1024)) : '');
        setMinKb(requirement.minBytes ? String(Math.round(requirement.minBytes / 1024)) : '');
        setGeometry('cover');
        setBackground('white');
    };

    const handlePresetSelect = (item) => {
        if (!item || item.id === 'custom') {
            submit.reset();
            setManualRect(null);
            setPresetId(null);
            return;
        }

        const nextPreset = getApplicationPreset(item.id);
        if (nextPreset) applyPreset(nextPreset);
    };

    /* ---------------------------------------------------------- sizing */

    const widthNumber = parsePositiveNumber(width);
    const heightNumber = parsePositiveNumber(height);
    const parsedDpi = parseDpiValue(dpi);

    let pixelWidth = null;
    let pixelHeight = null;
    let sizeError = null;

    if (entry) {
        if (widthNumber === null || heightNumber === null) {
            sizeError = 'Enter a width and a height.';
        } else if (unit === 'px') {
            if (!Number.isInteger(widthNumber) || !Number.isInteger(heightNumber)) {
                sizeError = 'Width and height in pixels must be whole numbers.';
            } else if (widthNumber > MAX_DIMENSION || heightNumber > MAX_DIMENSION) {
                sizeError = `Width and height cannot be more than ${MAX_DIMENSION} pixels.`;
            } else {
                pixelWidth = widthNumber;
                pixelHeight = heightNumber;
            }
        } else if (parsedDpi !== null) {
            try {
                const derivedWidth = pixelsFor(widthNumber, unit, parsedDpi);
                const derivedHeight = pixelsFor(heightNumber, unit, parsedDpi);
                if (derivedWidth > MAX_DIMENSION || derivedHeight > MAX_DIMENSION) {
                    sizeError = `At ${parsedDpi} DPI that is larger than ${MAX_DIMENSION} pixels on a side — `
                        + 'lower the DPI or the size.';
                } else {
                    pixelWidth = derivedWidth;
                    pixelHeight = derivedHeight;
                }
            } catch {
                sizeError = 'Enter a valid width and height.';
            }
        }
        // parsedDpi === null with a physical unit is reported by dpiError below,
        // so it is not also reported here as a size problem.
    }

    const dpiRequired = unit !== 'px';
    const dpiError = entry && dpi.trim() !== '' && parsedDpi === null
        ? `Enter a whole number between ${MIN_DPI} and ${MAX_DPI}.`
        : (entry && dpiRequired && dpi.trim() === ''
            ? `Enter a whole number between ${MIN_DPI} and ${MAX_DPI}.`
            : null);

    const aspect = pixelWidth && pixelHeight ? pixelWidth / pixelHeight : null;

    const defaultRect = useMemo(
        () => (entry && aspect ? centeredCoverRect(entry.width, entry.height, aspect) : null),
        [entry, aspect],
    );
    const frameRect = manualRect ?? defaultRect;

    const guide = preset ? headGuideFor(preset) : null;
    const guides = guide ? [guide] : [];

    /* -------------------------------------------------------- byte limits */

    const targetBytes = useMemo(() => parseKbToBytes(maxKb), [maxKb]);
    const targetError = entry && targetBytes !== null
        && (targetBytes < MIN_TARGET_BYTES || targetBytes > MAX_TARGET_BYTES)
        ? `Pick a maximum between ${formatFileSize(MIN_TARGET_BYTES)} and ${formatFileSize(MAX_TARGET_BYTES)}.`
        : null;

    const customMinBytes = useMemo(() => parseKbToBytes(minKb), [minKb]);
    const minBytes = isCustom ? customMinBytes : (preset?.bytes?.min ?? null);

    const minError = entry && isCustom && customMinBytes !== null
        && (customMinBytes < MIN_TARGET_BYTES || customMinBytes > MAX_TARGET_BYTES)
        ? `Pick a minimum between ${formatFileSize(MIN_TARGET_BYTES)} and ${formatFileSize(MAX_TARGET_BYTES)}.`
        : (entry && minBytes !== null && targetBytes !== null && minBytes >= targetBytes
            ? 'The minimum has to be smaller than the maximum.'
            : null);

    const canSubmit = Boolean(entry) && pixelWidth !== null && pixelHeight !== null
        && !sizeError && !dpiError && !targetError && !minError;

    /* ------------------------------------------------------------ intake */

    const handleFiles = async (files) => {
        submit.reset();
        preview.clear();
        setManualRect(null);
        return upload.selectFiles(files);
    };

    const loadSample = async () => {
        try {
            const response = await fetch(SAMPLE.src);
            if (!response.ok) throw new Error('sample unavailable');
            const blob = await response.blob();
            await handleFiles([new File([blob], SAMPLE.name, { type: 'image/jpeg' })]);
        } catch {
            upload.setError('That sample could not be loaded. Try again, or use a photo of your own.');
        }
    };

    const handleReset = () => {
        submit.reset();
        upload.clear();
        preview.clear();
        setManualRect(null);
    };

    /* ------------------------------------------------------------- submit */

    const runSubmit = (extra = {}) => {
        if (!entry || !canSubmit) return;

        const effectiveFormat = extra.format ?? format;

        const form = new FormData();
        form.append('file', entry.file);
        form.append('width', String(pixelWidth));
        form.append('height', String(pixelHeight));
        form.append('geometry', geometry);
        form.append('format', effectiveFormat);
        form.append('background', background);

        if (geometry === 'cover' && frameRect) {
            form.append('crop_x', String(frameRect.x));
            form.append('crop_y', String(frameRect.y));
            form.append('crop_width', String(frameRect.width));
            form.append('crop_height', String(frameRect.height));
        }

        if (targetBytes) form.append('targetBytes', String(targetBytes));
        if (minBytes) form.append('minBytes', String(minBytes));
        if (extra.minQuality) form.append('minQuality', String(extra.minQuality));

        // WebP carries no density field — writeResolution refuses it, so the
        // engine's own parse step is the backstop, but there is no reason to
        // send a field it will only reject.
        if (parsedDpi !== null && effectiveFormat !== 'webp') form.append('dpi', String(parsedDpi));

        if (extra.format) setFormat(extra.format);

        submit.submit(form, {
            originalBytes: entry.size,
            sourceWidth: entry.width,
            sourceHeight: entry.height,
            targetWidth: pixelWidth,
            targetHeight: pixelHeight,
        });
    };

    const handleSubmit = () => runSubmit();
    const handleAllowLowerQuality = () => runSubmit({ minQuality: 1 });
    const handleSwitchToWebp = () => runSubmit({ format: 'webp' });

    const isTargetFailure = Boolean(submit.error) && submit.code === TARGET_UNREACHABLE_CODE;
    const isMinFailure = Boolean(submit.error) && submit.code === MIN_UNREACHABLE_CODE;
    const showRecovery = isTargetFailure || isMinFailure;

    /* ----------------------------------------------------------- markup */

    const formatOptions = format === 'webp'
        ? [...BASE_FORMAT_OPTIONS, { value: 'webp', label: 'WebP' }]
        : BASE_FORMAT_OPTIONS;

    const isCustomBackground = !BACKGROUND_PRESETS.some((option) => option.value === background);

    const settings = (
        <div className="flex flex-col gap-6">
            <div>
                <PresetChips
                    label="Requirement"
                    items={PRESET_ITEMS}
                    value={presetId ?? 'custom'}
                    onSelect={handlePresetSelect}
                />
                <p className="mt-1.5 text-micro text-ink-muted">
                    {preset
                        ? `${preset.name ?? preset.jurisdiction}. Edit any field below and this becomes a custom size.`
                        : 'Pick a verified requirement, or set your own numbers below.'}
                </p>
            </div>

            <fieldset>
                <legend className="text-ui text-ink">Size</legend>
                <div className="mt-2 grid grid-cols-2 gap-3 sm:max-w-md sm:grid-cols-3">
                    <Field id="passport-width" label="Width" error={sizeError}>
                        <input
                            id="passport-width"
                            type="number"
                            inputMode="decimal"
                            min="0"
                            step="any"
                            value={width}
                            onChange={(event) => clearingSetter(setWidth)(event.target.value)}
                            aria-describedby={sizeError ? SIZE_ERROR_ID : undefined}
                            aria-invalid={sizeError ? true : undefined}
                            className={CONTROL}
                        />
                    </Field>

                    <Field id="passport-height" label="Height">
                        <input
                            id="passport-height"
                            type="number"
                            inputMode="decimal"
                            min="0"
                            step="any"
                            value={height}
                            onChange={(event) => clearingSetter(setHeight)(event.target.value)}
                            aria-describedby={sizeError ? SIZE_ERROR_ID : undefined}
                            className={CONTROL}
                        />
                    </Field>

                    <Field id="passport-unit" label="Unit">
                        <select
                            id="passport-unit"
                            value={unit}
                            onChange={(event) => handleUnitChange(event.target.value)}
                            className={SELECT}
                        >
                            <option value="px">px</option>
                            <option value="mm">mm</option>
                            <option value="cm">cm</option>
                            <option value="in">in</option>
                        </select>
                    </Field>
                </div>
            </fieldset>

            <Field
                id="passport-dpi"
                label={unit === 'px' ? 'DPI (optional)' : 'DPI'}
                hint={unit === 'px'
                    ? 'Only needed if a form checks the print resolution — otherwise leave it empty.'
                    : 'Converts the size above into pixels, and is written into the file.'}
                error={dpiError}
                className="max-w-[10rem]"
            >
                <input
                    id="passport-dpi"
                    type="number"
                    inputMode="numeric"
                    min={MIN_DPI}
                    max={MAX_DPI}
                    step="1"
                    value={dpi}
                    onChange={(event) => clearingSetter(setDpi)(event.target.value)}
                    aria-describedby={fieldDescribedBy('passport-dpi', { hint: true, error: dpiError })}
                    aria-invalid={dpiError ? true : undefined}
                    className={CONTROL}
                />
            </Field>
        </div>
    );

    const isSample = entry?.name === SAMPLE.name;

    const sourcePreview = entry ? (
        <div className="flex flex-col gap-4">
            <div className="checkerboard flex justify-center rounded-panel border border-line p-3">
                <div className="relative inline-block max-w-full">
                    {geometry === 'cover' && frameRect && aspect ? (
                        <FrameCrop
                            id="passport-frame"
                            src={entry.previewUrl}
                            sourceWidth={entry.width}
                            sourceHeight={entry.height}
                            aspect={aspect}
                            value={frameRect}
                            onChange={setManualRect}
                            guides={guides}
                            label="Position your photo inside the frame"
                        />
                    ) : (
                        // eslint-disable-next-line @next/next/no-img-element -- blob: URL from the visitor's own file; next/image cannot optimise it.
                        <img
                            src={entry.previewUrl}
                            alt={isSample
                                ? 'The generated sample scene — not a real person.'
                                : `${entry.name}, the photo that will be resized`}
                            className="block max-h-[380px] w-auto max-w-full"
                        />
                    )}
                </div>
            </div>

            <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 font-data text-micro text-ink-muted">
                <p>Source <span className="text-ink">{entry.width}×{entry.height}</span></p>
                {pixelWidth && pixelHeight ? (
                    <p>Target <span className="text-ink">{pixelWidth}×{pixelHeight}</span></p>
                ) : null}
            </div>

            {geometry !== 'cover' ? (
                <p className="text-micro text-ink-muted">
                    {geometry === 'contain'
                        ? 'The whole photo is kept and padded to the exact box, so there is nothing to position here.'
                        : 'The whole photo is kept and stretched to the exact box, so there is nothing to position here.'}
                </p>
            ) : null}

            <div>
                <button
                    type="button"
                    onClick={handleReset}
                    className="rounded-button border border-line px-3 py-2 text-ui text-ink transition-colors duration-120 ease-snap hover:bg-surface-sunken"
                >
                    Choose another photo
                </button>
            </div>
        </div>
    ) : (
        <Dropzone
            id="passport-file"
            label="Drop a passport or ID photo here"
            constraints={upload.constraints}
            accept={upload.accept}
            state={upload.state}
            reason={upload.error}
            onFiles={handleFiles}
            onDragChange={upload.setDragging}
            disabled={upload.isReading}
        >
            <div className="mt-2 flex flex-col items-center gap-2">
                <p className="text-micro text-ink-muted">No photo to hand?</p>
                <button type="button" onClick={loadSample} className={SAMPLE_BUTTON}>
                    Try the sample photo
                </button>
                <p className="max-w-[38ch] text-micro text-ink-muted">
                    A generated scene — a plain head-and-shoulders shape on a light background — not a real
                    person.
                </p>
            </div>
        </Dropzone>
    );

    /* ------------------------------------------- output, under the drop zone */

    /**
     * Format, the byte limits, the fill behaviour and the background sit
     * under the drop zone, not above it, for the reason /signature-resizer
     * puts its Output group there: a phone that opens on a requirement chip,
     * a size and the drop zone gets to the file in one screen, and the
     * numbers a form checks are all still set before anything runs.
     */
    const outputControls = (
        <div className="flex flex-col gap-6">
            <fieldset>
                <legend className="text-ui text-ink">Output format</legend>
                <div className="mt-2 flex flex-wrap gap-x-6 gap-y-2">
                    {formatOptions.map((option) => (
                        <label key={option.value} className="flex items-center gap-2 text-ui text-ink">
                            <input
                                type="radio"
                                name="passport-format"
                                value={option.value}
                                checked={format === option.value}
                                onChange={() => clearingSetter(setFormat)(option.value)}
                                className={RADIO}
                            />
                            {option.label}
                        </label>
                    ))}
                </div>
            </fieldset>

            <div className="grid grid-cols-1 gap-4 sm:max-w-md sm:grid-cols-2">
                <Field
                    id="passport-max-kb"
                    label="Maximum file size (KB)"
                    hint="Leave empty for no limit."
                    error={targetError}
                >
                    <input
                        ref={maxKbRef}
                        id="passport-max-kb"
                        type="number"
                        inputMode="numeric"
                        min="1"
                        step="1"
                        placeholder="No limit"
                        value={maxKb}
                        onChange={(event) => clearingSetter(setMaxKb)(event.target.value)}
                        aria-describedby={fieldDescribedBy('passport-max-kb', { hint: true, error: targetError })}
                        aria-invalid={targetError ? true : undefined}
                        className={CONTROL}
                    />
                </Field>

                {isCustom ? (
                    <Field
                        id="passport-min-kb"
                        label="Minimum file size (KB)"
                        hint="Leave empty for no minimum."
                        error={minError}
                    >
                        <input
                            ref={minKbRef}
                            id="passport-min-kb"
                            type="number"
                            inputMode="numeric"
                            min="1"
                            step="1"
                            placeholder="No minimum"
                            value={minKb}
                            onChange={(event) => clearingSetter(setMinKb)(event.target.value)}
                            aria-describedby={fieldDescribedBy('passport-min-kb', { hint: true, error: minError })}
                            aria-invalid={minError ? true : undefined}
                            className={CONTROL}
                        />
                    </Field>
                ) : (preset?.bytes?.min ? (
                    <p className="self-end text-micro text-ink-muted">
                        {`This requirement also asks for at least ${formatFileSize(preset.bytes.min)}.`}
                    </p>
                ) : null)}
            </div>

            <fieldset>
                <legend className="text-ui text-ink">Fill behaviour</legend>
                <div className="mt-2 flex flex-col gap-2">
                    {GEOMETRY_OPTIONS.map((option) => (
                        <label key={option.value} className="flex items-center gap-2 text-ui text-ink">
                            <input
                                type="radio"
                                name="passport-geometry"
                                value={option.value}
                                checked={geometry === option.value}
                                onChange={() => clearingSetter(setGeometry)(option.value)}
                                className={RADIO}
                            />
                            {option.label}
                        </label>
                    ))}
                </div>
                {geometry === 'stretch' ? (
                    <Alert tone="info" className="mt-2">
                        Distorts the picture. Only for a portal that checks nothing but the pixel count.
                    </Alert>
                ) : null}
            </fieldset>

            <fieldset>
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
                                name="passport-background"
                                value={option.value}
                                checked={background === option.value}
                                onChange={() => clearingSetter(setBackground)(option.value)}
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
                            name="passport-background"
                            value="custom"
                            checked={isCustomBackground}
                            onChange={() => clearingSetter(setBackground)(CUSTOM_BACKGROUND_DEFAULT)}
                            className={RADIO}
                        />
                        Custom
                    </label>
                </div>
                {isCustomBackground ? (
                    <Field id="passport-background-custom" label="Custom colour" labelHidden className="mt-3">
                        <input
                            id="passport-background-custom"
                            type="color"
                            value={background}
                            onChange={(event) => clearingSetter(setBackground)(event.target.value)}
                            className="h-10 w-16 cursor-pointer rounded-input border border-line bg-surface-raised p-1"
                        />
                    </Field>
                ) : null}
            </fieldset>
        </div>
    );

    const recovery = showRecovery ? (
        <Alert className="mt-4">
            <span className="block">{submit.error}</span>
            {submit.suggestion ? <span className="mt-1 block text-ink-muted">{submit.suggestion}</span> : null}
            <span className="mt-3 flex flex-wrap gap-3">
                <button type="button" onClick={handleAllowLowerQuality} className={RECOVERY_BUTTON}>
                    Allow lower quality
                </button>
                {isCustom ? (
                    <button type="button" onClick={handleSwitchToWebp} className={RECOVERY_BUTTON}>
                        Switch to WebP
                    </button>
                ) : null}
                <button
                    type="button"
                    onClick={() => (isTargetFailure ? maxKbRef : minKbRef).current?.focus()}
                    className={RECOVERY_BUTTON}
                >
                    Change the limit
                </button>
            </span>
        </Alert>
    ) : null;

    const panel = (
        <div className="flex flex-col gap-5">
            {sourcePreview}
            {outputControls}
            {recovery}
        </div>
    );

    const outcome = submit.result;
    const payoff = outcome ? { value: `${outcome.width}×${outcome.height}`, label: 'exact' } : null;

    const result = outcome ? (
        <div className="flex flex-col gap-5">
            <ResultPanel
                variant="single"
                previewUrl={preview.url}
                alt={`${entry?.name ?? 'Your photo'} resized to ${outcome.width}×${outcome.height}`}
                filename={outcome.filename}
                originalBytes={outcome.originalBytes}
                resultBytes={outcome.resultBytes}
                width={outcome.width}
                height={outcome.height}
                payoff={payoff}
                onDownload={() => submit.download()}
                onReset={handleReset}
                downloadLabel="Download photo"
                footnote={describeOutcome(outcome)}
            />
            <RequirementSummary checks={outcome.checks} preset={preset} />
        </div>
    ) : null;

    const plainError = !showRecovery
        ? [submit.error, submit.suggestion].filter(Boolean).join(' ')
        : null;

    return (
        <ToolShell
            slug="passport-photo"
            title={title}
            intro={intro}
            answer={answer}
            breadcrumb={breadcrumb}
            settingsLabel="Requirement settings"
            settings={settings}
            panel={panel}
            error={plainError || null}
            action={(
                <ToolAction
                    label="Make photo"
                    processingLabel={submit.phase === 'searching' ? 'Finding the size…' : 'Working…'}
                    isProcessing={submit.isProcessing}
                    progress={submit.progress}
                    disabled={!canSubmit}
                    onClick={handleSubmit}
                    onCancel={submit.cancel}
                />
            )}
            result={result}
        >
            {children}
        </ToolShell>
    );
}
