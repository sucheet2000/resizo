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
 *
 * THE SIZE/DPI/FORMAT/BYTE FIELDS AND THEIR VALIDATION ARE SHARED.
 *
 * `components/tools/fit/RequirementFields` renders every field below the
 * drop zone (in this page's own existing order and copy — its `idPrefix`
 * 'passport' selects that copy) and `lib/format/fit-requirements` parses and
 * validates them the same way /image-size-fitter does, since both pages ask
 * an engine `fit` job to satisfy the same kind of requirement. The recovery
 * buttons after a failure (`RecoveryOptions`, driven by `recoveryFor`) and
 * the finished checklist (`RequirementSummary`, moved to
 * components/tools/fit/) are shared the same way.
 */
import { useEffect, useMemo, useRef, useState } from 'react';

import FrameCrop from '@/components/tools/FrameCrop';
import PresetChips from '@/components/tools/PresetChips';
import RecoveryOptions from '@/components/tools/fit/RecoveryOptions';
import RequirementFields from '@/components/tools/fit/RequirementFields';
import RequirementSummary from '@/components/tools/fit/RequirementSummary';
import ResultPanel from '@/components/tools/ResultPanel';
import ToolShell, { ToolAction } from '@/components/tools/ToolShell';
import Dropzone from '@/components/ui/Dropzone';
import {
    APPLICATION_PRESETS,
    applicationPresetToRequirement,
    getApplicationPreset,
} from '@/lib/catalog/application-presets';
import { formatFileSize } from '@/lib/format/bytes';
import { centeredCoverRect, enlargementFor, recoveryFor, resolveRequirements } from '@/lib/format/fit-requirements';
import useImageUpload from '@/lib/hooks/useImageUpload';
import useLocalProcess from '@/lib/hooks/useLocalProcess';
import usePreviewUrl from '@/lib/hooks/usePreviewUrl';
import { MINIMUM_UNREACHABLE_CODE } from '@/lib/image-client/requirements';
import { TARGET_UNREACHABLE_CODE } from '@/lib/image-client/target-bytes';
import { RASTER_INPUT_FORMATS } from '@/lib/limits';

const SAMPLE_BUTTON = 'inline-flex min-h-11 items-center justify-center rounded-button border border-line bg-surface-raised px-3 text-ui font-medium text-ink transition-colors duration-120 ease-snap hover:bg-surface-sunken';

const SAMPLE = {
    src: '/samples/portrait-1200x1600.jpg',
    name: 'passport-sample-portrait.jpg',
};

const BASE_FORMAT_OPTIONS = [
    { value: 'jpeg', label: 'JPEG' },
    { value: 'png', label: 'PNG' },
];

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
            label: 'Centre the head in the frame',
            from: 0.42,
            to: 0.58,
        };
    }

    return {
        kind: 'guidance',
        label: 'Head, shoulders and upper body filling the frame',
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

    // Enlarging is said out loud: a 100×100 source asked for 600×600 comes
    // back "600×600 exact", and exact is true, but detail was not added.
    const kept = outcome.crop
        ?? (outcome.originalWidth && outcome.originalHeight
            ? { width: outcome.originalWidth, height: outcome.originalHeight }
            : null);
    if (kept && (outcome.width > kept.width || outcome.height > kept.height)) {
        parts.push(`The photo was enlarged from ${kept.width}×${kept.height}, which cannot add detail.`);
    }

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
    // Not a form field here — "Allow lower quality" is a recovery action, not
    // a checkbox (see the file note) — but recoveryFor still needs to know
    // it has already been granted for THIS pending job, so a retried search
    // that still fails does not re-offer the same button.
    const [lowerQualityAllowed, setLowerQualityAllowed] = useState(false);

    const maxKbRef = useRef(null);
    const minKbRef = useRef(null);
    const widthRef = useRef(null);
    const focusAfterLoadRef = useRef(false);

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
        setLowerQualityAllowed(false);
        setter(value);
    };

    /**
     * Unit gets its own handler rather than `clearingSetter(setUnit)` for the
     * three resets every other field also needs. It does NOT fill in a DPI
     * of its own: passport's numbers come from an authority, and silently
     * completing one nobody stated would be the same mistake `defaultDpi`
     * exists to refuse below — the field's own placeholder (see DpiField)
     * shows Resizo's 300 only as a suggestion, never as a typed value. Moving
     * back to pixels leaves whatever was there — DPI stays optional in
     * pixels, it does not need clearing.
     */
    const handleUnitChange = (nextUnit) => {
        submit.reset();
        setPresetId(null);
        setManualRect(null);
        setLowerQualityAllowed(false);
        setUnit(nextUnit);
    };

    /** Routes RequirementFields' single onChange(name, value) to the right setter. */
    function handleFieldChange(name, value) {
        if (name === 'unit') { handleUnitChange(value); return; }
        if (name === 'width') { clearingSetter(setWidth)(value); return; }
        if (name === 'height') { clearingSetter(setHeight)(value); return; }
        if (name === 'dpi') { clearingSetter(setDpi)(value); return; }
        if (name === 'format') { clearingSetter(setFormat)(value); return; }
        if (name === 'maxKb') { clearingSetter(setMaxKb)(value); return; }
        if (name === 'minKb') { clearingSetter(setMinKb)(value); return; }
        if (name === 'geometry') { clearingSetter(setGeometry)(value); return; }
        if (name === 'background') { clearingSetter(setBackground)(value); return; }
    }

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

    // Under a preset there is no editable minimum FIELD — the minimum is the
    // authority's own number, shown as a note rather than validated as typed
    // input — so the shared resolver is asked about a custom minimum only in
    // Custom mode; a preset's own minimum is applied afterwards, in bytes,
    // straight from the registry.
    const requirement = entry
        ? resolveRequirements({
            width,
            height,
            unit,
            dpi,
            format,
            maxKb,
            minKb: isCustom ? minKb : '',
            geometry,
            background,
        }, { defaultDpi: null })
        : null;

    const sizeError = requirement ? (requirement.errors.width || requirement.errors.height || requirement.errors.size || null) : null;
    const dpiError = requirement?.errors.dpi || null;
    const targetError = requirement?.errors.maxKb || null;
    const minError = isCustom ? (requirement?.errors.minKb || null) : null;

    const pixelWidth = requirement?.ok ? requirement.pixels.width : null;
    const pixelHeight = requirement?.ok ? requirement.pixels.height : null;

    const aspect = pixelWidth && pixelHeight ? pixelWidth / pixelHeight : null;

    const defaultRect = useMemo(
        () => (entry && aspect ? centeredCoverRect(entry.width, entry.height, aspect) : null),
        [entry, aspect],
    );
    const frameRect = manualRect ?? defaultRect;

    const enlargement = requirement?.ok
        ? enlargementFor({
            sourceWidth: entry?.width,
            sourceHeight: entry?.height,
            keptRect: geometry === 'cover' ? frameRect : null,
            pixels: requirement.pixels,
        })
        : null;
    const willEnlarge = Boolean(enlargement);

    const guide = preset ? headGuideFor(preset) : null;
    const guides = guide ? [guide] : [];

    // A preset's own minimum (bytes, straight from the registry) once the
    // resolver's own fields are known to be usable; a custom job's minimum
    // comes back from the resolver itself.
    const effectiveMinBytes = requirement?.ok
        ? (isCustom ? (requirement.fields.minBytes ?? null) : (preset?.bytes?.min ?? null))
        : null;

    const canSubmit = Boolean(entry) && Boolean(requirement?.ok);

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
            // The button that was pressed is gone with the drop zone; focus
            // follows to the frame once it has rendered, or to the size field
            // when there is no frame yet. The effect keyed on the photo does
            // the moving, so the flag is raised before the photo lands.
            focusAfterLoadRef.current = true;
            await handleFiles([new File([blob], SAMPLE.name, { type: 'image/jpeg' })]);
        } catch {
            focusAfterLoadRef.current = false;
            upload.setError('That sample could not be loaded. Try again, or use a photo of your own.');
        }
    };

    const handleReset = () => {
        submit.reset();
        upload.clear();
        preview.clear();
        setManualRect(null);
        // Start over and Choose another photo unmount themselves; the drop
        // zone's own button is what replaces them.
        setTimeout(() => document.getElementById('passport-file-browse')?.focus(), 0);
    };

    // A refusal takes focus, so a second one after a recovery button is
    // heard and seen rather than only announced.
    useEffect(() => {
        if (submit.error) document.getElementById('passport-recovery')?.focus();
    }, [submit.error]);

    useEffect(() => {
        if (!focusAfterLoadRef.current || !entry) return;
        focusAfterLoadRef.current = false;
        (document.getElementById('passport-frame') ?? widthRef.current)?.focus();
    }, [entry]);

    /* ------------------------------------------------------------- submit */

    /** Builds and sends the FormData for a resolved set of fields. */
    const submitFields = (fields) => {
        const form = new FormData();
        form.append('file', entry.file);
        form.append('width', String(fields.width));
        form.append('height', String(fields.height));
        form.append('geometry', fields.geometry);
        form.append('format', fields.format);
        form.append('background', fields.background);

        if (fields.geometry === 'cover' && frameRect) {
            form.append('crop_x', String(frameRect.x));
            form.append('crop_y', String(frameRect.y));
            form.append('crop_width', String(frameRect.width));
            form.append('crop_height', String(frameRect.height));
        }

        if (fields.targetBytes) form.append('targetBytes', String(fields.targetBytes));
        if (effectiveMinBytes) form.append('minBytes', String(effectiveMinBytes));
        if (fields.minQuality) form.append('minQuality', String(fields.minQuality));
        // WebP carries no density field — resolveRequirements already omits
        // `dpi` for it, so nothing extra is needed here to keep it unsent.
        if (fields.dpi) form.append('dpi', String(fields.dpi));

        submit.submit(form, {
            originalBytes: entry.size,
            sourceWidth: entry.width,
            sourceHeight: entry.height,
            targetWidth: fields.width,
            targetHeight: fields.height,
        });
    };

    /** Re-resolves the requirement with one or more fields overridden, for a recovery action. */
    const runWithOverride = (overrides) => {
        if (!entry) return;
        const result = resolveRequirements({
            width,
            height,
            unit,
            dpi,
            format,
            maxKb,
            minKb: isCustom ? minKb : '',
            geometry,
            background,
            ...overrides,
        }, { defaultDpi: null });
        if (!result.ok) return;
        if (overrides.format) setFormat(overrides.format);
        if (overrides.allowLowerQuality) {
            setLowerQualityAllowed(true);
            submitFields({ ...result.fields, minQuality: 1 });
        } else {
            submitFields(result.fields);
        }
    };

    const handleSubmit = () => { if (requirement?.ok) submitFields(requirement.fields); };
    const handleAllowLowerQuality = () => runWithOverride({ allowLowerQuality: true });
    // Format only. A typed DPI must survive the switch: for a physical unit
    // it is what turns the size into pixels, so clearing it would silently
    // recompute the target at a resolution nobody asked for instead of the
    // number the visitor actually typed — resolveRequirements already omits
    // `dpi` from the posted fields for WebP on its own.
    const handleSwitchToWebp = () => runWithOverride({ format: 'webp' });
    const handleSwitchToPng = () => runWithOverride({ format: 'png' });

    const isTargetFailure = Boolean(submit.error) && submit.code === TARGET_UNREACHABLE_CODE;
    const isMinFailure = Boolean(submit.error) && submit.code === MINIMUM_UNREACHABLE_CODE;
    const showRecovery = isTargetFailure || isMinFailure;
    const recoveryOptions = showRecovery
        ? recoveryFor(submit.code, { format, isCustom, allowLowerQuality: lowerQualityAllowed })
        : [];

    /* ----------------------------------------------------------- markup */

    const formatOptions = format === 'webp'
        ? [...BASE_FORMAT_OPTIONS, { value: 'webp', label: 'WebP' }]
        : BASE_FORMAT_OPTIONS;

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
                            // A move after a result is a new job: the result
                            // goes, so Make photo comes back for the new
                            // crop. The preset stays — reframing does not
                            // change which requirement is being met.
                            onChange={(rect) => {
                                submit.reset();
                                setManualRect(rect);
                            }}
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

            {willEnlarge ? (
                <p className="text-micro text-ink-muted">
                    The target is larger than the area kept, so the photo will be enlarged — which cannot add detail.
                </p>
            ) : null}

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
                    className="min-h-11 rounded-button border border-line px-3 py-2 text-ui text-ink transition-colors duration-120 ease-snap hover:bg-surface-sunken"
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
     * Every field except the requirement chips sits under the drop zone. A
     * chip fills the size, the DPI, the format and the limits, so the file
     * lands already configured; the fields are where a custom size is typed
     * and where a preset is checked, and nothing runs until Make photo. Above
     * the drop zone they pushed it a full screen down on a phone, measured.
     */
    const outputControls = (
        <RequirementFields
            idPrefix="passport"
            values={{ width, height, unit, dpi, format, maxKb, minKb, geometry, background }}
            onChange={handleFieldChange}
            errors={{ width: sizeError, height: sizeError, dpi: dpiError, maxKb: targetError, minKb: minError }}
            show={{
                minKb: isCustom,
                minNote: (!isCustom && preset?.bytes?.min)
                    ? `This requirement also asks for at least ${formatFileSize(preset.bytes.min)}.`
                    : null,
            }}
            refs={{ width: widthRef, maxKb: maxKbRef, minKb: minKbRef }}
            formatOptions={formatOptions}
        />
    );

    const recovery = (
        <RecoveryOptions
            id="passport-recovery"
            className="mt-4"
            error={showRecovery ? submit.error : null}
            suggestion={submit.suggestion}
            options={recoveryOptions}
            onAllowLowerQuality={handleAllowLowerQuality}
            onSwitchToWebp={handleSwitchToWebp}
            onChangeLimit={() => maxKbRef.current?.focus()}
            onSwitchToPng={handleSwitchToPng}
            onChangeSize={() => widthRef.current?.focus()}
            onChangeMinimum={() => minKbRef.current?.focus()}
        />
    );

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

    // The capability gate has already joined its suggestion onto the reason
    // (refusalMessage) and repeats it in `suggestion`; an engine failure hands
    // back a bare message with the fix only in that second field. Say the fix
    // once either way — the same guard /merge-pdf carries.
    const plainError = (() => {
        if (showRecovery || !submit.error) return null;
        const fix = submit.suggestion;
        if (!fix || submit.error.includes(fix)) return submit.error;
        return `${submit.error} ${fix}`;
    })();

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
