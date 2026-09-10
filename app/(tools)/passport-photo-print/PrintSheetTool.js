'use client';

/**
 * PrintSheetTool
 *
 * Lays one photo out as several copies on a sheet of paper at an exact
 * physical size — a requirement fitter for PAPER rather than for a single
 * photo's pixels. Modelled directly on app/(tools)/passport-photo/PassportTool.js
 * and app/(tools)/image-size-fitter/FitTool.js: the same sample-button intake,
 * the same FrameCrop for "Crop to fill", the same Advanced-options disclosure
 * that a genuine field error keeps open, the same enlargement notice, the same
 * refusal-alert and result-heading focus management, and the same rule that
 * changing any setting after a result clears it.
 *
 * ONE LAYOUT MODEL, DRAWN LOCALLY AND SENT REMOTELY. `layoutSheet()` from
 * lib/format/print-sheet — the same pure function the engine's `sheet` op
 * calls — runs here on every render so the capacity notice, the resolved
 * orientation, the enlargement notice and the SVG preview are all correct
 * BEFORE Create sheet is ever pressed. The submit still posts the raw
 * millimetre/DPI/margin fields for the engine to lay out again independently;
 * this mirrors that computation, it does not replace it.
 *
 * WHY PHOTO SIZE IS A CHIP ROW ABOVE THE DROP ZONE AND EVERYTHING ELSE IS BELOW IT.
 * Photo size is the one choice that changes which OTHER fields even make sense
 * (a UK preset has no Custom width to show), exactly the role /passport-photo's
 * own "Requirement" chips play — so it sits in the `settings` slot, above the
 * drop zone, and the rest (paper, orientation, DPI, copies, Advanced, output)
 * sits in the panel below it, unconditionally visible even before a photo
 * exists, the same way PassportTool's own RequirementFields already are.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';

import FrameCrop from '@/components/tools/FrameCrop';
import PresetChips from '@/components/tools/PresetChips';
import { SizeFields } from '@/components/tools/fit/RequirementFields';
import RequirementSummary from '@/components/tools/fit/RequirementSummary';
import ResultPanel from '@/components/tools/ResultPanel';
import ToolShell, { ToolAction } from '@/components/tools/ToolShell';
import TransparencyBackground from '@/components/tools/TransparencyBackground';
import Alert from '@/components/ui/Alert';
import Dropzone from '@/components/ui/Dropzone';
import Field, { fieldDescribedBy } from '@/components/ui/Field';
import SheetPreview from './SheetPreview';
import { APPLICATION_PRESETS, getApplicationPreset } from '@/lib/catalog/application-presets';
import { PAPER_SIZES, paperSize } from '@/lib/catalog/paper-sizes';
import { centeredCoverRect } from '@/lib/format/fit-requirements';
import { MM_PER_INCH, toMillimetres } from '@/lib/format/physical';
import {
    DEFAULT_GAP_MM,
    DEFAULT_MARGIN_MM,
    DEFAULT_SHEET_DPI,
    MAX_SHEET_DPI,
    MIN_SHEET_DPI,
    layoutSheet,
    sourceEnlargement,
} from '@/lib/format/print-sheet';
import useImageUpload from '@/lib/hooks/useImageUpload';
import useLocalProcess from '@/lib/hooks/useLocalProcess';
import usePreviewUrl from '@/lib/hooks/usePreviewUrl';
import { RASTER_INPUT_FORMATS } from '@/lib/limits';

const SAMPLE_BUTTON = 'inline-flex min-h-11 items-center justify-center rounded-button border border-line bg-surface-raised px-3 text-ui font-medium text-ink transition-colors duration-120 ease-snap hover:bg-surface-sunken';
const CONTROL = 'w-full rounded-input border border-line bg-surface-raised px-3 py-2 font-data text-ui text-ink';
const SELECT = 'w-full rounded-input border border-line bg-surface-raised px-3 py-2 text-ui text-ink';
const RADIO = 'size-4 accent-[var(--accent)] disabled:opacity-50';
const LINK = 'rounded-input font-medium text-accent underline underline-offset-4 transition-[text-decoration-thickness] duration-120 ease-snap hover:decoration-2';

const SAMPLE = {
    src: '/samples/portrait-1200x1600.jpg',
    name: 'print-sheet-sample-portrait.jpg',
};

const GUIDE_OPTIONS = [
    { value: 'none', label: 'Off' },
    { value: 'corners', label: 'Corner marks' },
    { value: 'lines', label: 'Full lines' },
];

const FIT_OPTIONS = [
    { value: 'cover', label: 'Crop to fill' },
    { value: 'contain', label: 'Fit inside' },
];

const OUTPUT_OPTIONS = [
    { value: 'jpeg', label: 'JPEG' },
    { value: 'pdf', label: 'PDF' },
];

/** The chip row: the three physical presets Passport & ID Photo also verifies, plus Custom. */
const PHOTO_PRESET_ITEMS = [
    ...APPLICATION_PRESETS.filter((preset) => preset.physical).map((preset) => ({
        id: preset.id,
        label: `${preset.jurisdiction} ${preset.physical.width} × ${preset.physical.height} ${preset.physical.unit}`,
    })),
    { id: 'custom', label: 'Custom' },
];

const DEFAULT_PRESET_ID = 'us-passport-print';

function gcd(a, b) {
    return b === 0 ? a : gcd(b, a % b);
}

/** A reduced integer ratio label, e.g. ratioLabel(800, 600) -> '4:3'. */
function ratioLabel(width, height) {
    const w = Math.round(width);
    const h = Math.round(height);
    const divisor = gcd(w, h) || 1;
    return `${w / divisor}:${h / divisor}`;
}

function parsePositive(value) {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : null;
}

/** Custom photo size, in whatever unit was chosen (including 'px', which SizeFields also offers) -> mm. */
function customSizeToMm(value, unit, dpi) {
    const n = parsePositive(value);
    if (!n) return null;

    if (unit === 'px') {
        const dpiNum = Number(dpi);
        if (!Number.isFinite(dpiNum) || dpiNum <= 0) return null;
        return (n / dpiNum) * MM_PER_INCH;
    }

    try {
        return toMillimetres(n, unit);
    } catch {
        return null;
    }
}

// The one capacity the margin hint quotes is computed, like every number on
// the page: six 2 x 2 in photos tile a 4 x 6 in sheet only when the margin
// and the gap are both zero.
const US_PRESET = getApplicationPreset('us-passport-print');
const FOUR_BY_SIX = paperSize('4x6');
const BORDERLESS_EXAMPLE = layoutSheet({
    paperWidthMm: FOUR_BY_SIX.widthMm,
    paperHeightMm: FOUR_BY_SIX.heightMm,
    photoWidthMm: US_PRESET.physical.widthMm,
    photoHeightMm: US_PRESET.physical.heightMm,
    marginMm: 0,
    gapMm: 0,
});
const MARGIN_HINT = `Set 0 only for borderless printing — ${BORDERLESS_EXAMPLE.copies} copies of a 2 × 2 in photo `
    + 'fit a 4 × 6 sheet edge to edge, and most home printers cannot print to the edge.';

const ORIENTATION_OPTIONS = [
    { value: 'auto', label: 'Auto' },
    { value: 'portrait', label: 'Portrait' },
    { value: 'landscape', label: 'Landscape' },
];

export default function PrintSheetTool({
    title = 'Create a Passport Photo Print Sheet',
    intro = 'Lay several copies of a passport or ID photo out on one sheet at exact physical size, as a JPEG or PDF. Nothing is uploaded.',
    answer,
    breadcrumb,
    children,
}) {
    const [presetId, setPresetId] = useState(DEFAULT_PRESET_ID);
    const [customWidth, setCustomWidth] = useState('');
    const [customHeight, setCustomHeight] = useState('');
    const [customUnit, setCustomUnit] = useState('mm');

    const [paperId, setPaperId] = useState('4x6');
    const [orientation, setOrientation] = useState('auto');
    const [dpi, setDpi] = useState(String(DEFAULT_SHEET_DPI));
    const [copiesMode, setCopiesMode] = useState('fill');
    const [copiesCount, setCopiesCount] = useState('');

    const [advancedOpen, setAdvancedOpen] = useState(false);
    const [marginMm, setMarginMm] = useState(String(DEFAULT_MARGIN_MM));
    const [gapMm, setGapMm] = useState(String(DEFAULT_GAP_MM));
    const [guides, setGuides] = useState('corners');
    const [referenceOn, setReferenceOn] = useState(true);
    const [fit, setFit] = useState('cover');
    const [background, setBackground] = useState('white');
    const [output, setOutput] = useState('jpeg');

    const [manualRect, setManualRect] = useState(null);
    const focusAfterLoadRef = useRef(false);
    const resultHeadingRef = useRef(null);

    const advancedPanelId = 'sheet-advanced-panel';

    const upload = useImageUpload({ accept: RASTER_INPUT_FORMATS });
    const preview = usePreviewUrl();
    const submit = useLocalProcess({
        op: 'sheet',
        onSuccess: (payload) => {
            if (payload.format === 'jpeg') preview.show(payload.blob);
            else preview.clear();
        },
    });

    const entry = upload.file;

    /* --------------------------------------------------------- geometry */

    const preset = presetId ? getApplicationPreset(presetId) : null;
    const isCustomPhoto = !preset;

    const photoWidthMm = preset ? preset.physical.widthMm : customSizeToMm(customWidth, customUnit, dpi);
    const photoHeightMm = preset ? preset.physical.heightMm : customSizeToMm(customHeight, customUnit, dpi);

    const photoSizeError = isCustomPhoto && (customWidth.trim() !== '' || customHeight.trim() !== '')
        && (photoWidthMm === null || photoHeightMm === null)
        ? 'Enter a width and a height greater than 0.'
        : null;

    const paper = paperSize(paperId);

    const layout = (paper && photoWidthMm && photoHeightMm)
        ? layoutSheet({
            paperWidthMm: paper.widthMm,
            paperHeightMm: paper.heightMm,
            orientation,
            photoWidthMm,
            photoHeightMm,
            dpi,
            marginMm,
            gapMm,
            copies: copiesMode === 'fill' ? 'auto' : copiesCount,
            guides,
            reference: referenceOn,
        })
        : null;

    const targetAspect = layout?.ok ? layout.photo.widthPx / layout.photo.heightPx : null;

    const defaultRect = useMemo(
        () => (entry && targetAspect ? centeredCoverRect(entry.width, entry.height, targetAspect) : null),
        [entry, targetAspect],
    );
    const frameRect = manualRect ?? defaultRect;

    const keptWidth = fit === 'cover' ? frameRect?.width : entry?.width;
    const keptHeight = fit === 'cover' ? frameRect?.height : entry?.height;
    const enlargement = (entry && layout?.ok)
        ? sourceEnlargement({
            keptWidth,
            keptHeight,
            photoWidthPx: layout.photo.widthPx,
            photoHeightPx: layout.photo.heightPx,
            fit,
        })
        : null;
    const enlargementNotice = enlargement
        ? `Your source will be enlarged from ${enlargement.from.width} × ${enlargement.from.height} to `
            + `${enlargement.to.width} × ${enlargement.to.height} pixels. Printing it may look softer.`
        : null;

    const sourceAspect = entry ? entry.width / entry.height : null;
    const aspectMismatch = Boolean(entry && targetAspect
        && Math.abs(sourceAspect / targetAspect - 1) > 0.01);

    // Only Margin and Spacing live behind Advanced options, so only THEIR own
    // typed value forces the disclosure open — a photo/paper mismatch is a
    // primary-field problem and auto-expanding Advanced would point at the
    // wrong control.
    const marginNum = Number(marginMm);
    const gapNum = Number(gapMm);
    const hasAdvancedFieldError = (marginMm.trim() !== '' && (!Number.isFinite(marginNum) || marginNum < 0))
        || (gapMm.trim() !== '' && (!Number.isFinite(gapNum) || gapNum < 0));
    const advancedVisible = advancedOpen || hasAdvancedFieldError;

    const showBackground = fit === 'contain';

    const canSubmit = Boolean(entry) && Boolean(layout?.ok);
    const actionHint = canSubmit
        ? undefined
        : (!entry ? 'Add a photo to turn this on.' : 'Fix the highlighted field first.');

    /* -------------------------------------------------------- resets */

    const clearingSetter = (setter) => (value) => {
        submit.reset();
        setManualRect(null);
        setter(value);
    };

    function handlePresetSelect(item) {
        submit.reset();
        setManualRect(null);
        if (!item || item.id === 'custom') { setPresetId(null); return; }
        setPresetId(item.id);
    }

    function handlePhotoFieldChange(name, value) {
        submit.reset();
        setManualRect(null);
        if (name === 'width') setCustomWidth(value);
        else if (name === 'height') setCustomHeight(value);
        else if (name === 'unit') setCustomUnit(value);
    }

    function handleCopiesModeChange(nextMode) {
        submit.reset();
        setManualRect(null);
        setCopiesMode(nextMode);
        if (nextMode === 'count' && copiesCount.trim() === '') {
            setCopiesCount(String(layout?.ok ? layout.capacity : 1));
        }
    }

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
        setTimeout(() => document.getElementById('sheet-file-browse')?.focus(), 0);
    };

    useEffect(() => {
        if (!submit.error) return;
        document.getElementById('sheet-error')?.focus();
    }, [submit.error]);

    useEffect(() => {
        if (submit.result) resultHeadingRef.current?.focus();
    }, [submit.result]);

    useEffect(() => {
        if (!focusAfterLoadRef.current || !entry) return;
        focusAfterLoadRef.current = false;
        (document.getElementById('sheet-frame') ?? document.getElementById('sheet-paper'))?.focus();
    }, [entry]);

    /* ------------------------------------------------------------- submit */

    const handleSubmit = () => {
        if (!entry || !layout?.ok) return;

        const form = new FormData();
        form.append('file', entry.file);
        form.append('paper_width_mm', String(paper.widthMm));
        form.append('paper_height_mm', String(paper.heightMm));
        form.append('orientation', orientation);
        form.append('photo_width_mm', String(photoWidthMm));
        form.append('photo_height_mm', String(photoHeightMm));
        form.append('dpi', String(dpi));
        form.append('margin_mm', String(marginMm));
        form.append('gap_mm', String(gapMm));
        form.append('copies', copiesMode === 'fill' ? 'auto' : String(copiesCount));
        form.append('guides', guides);
        form.append('reference', referenceOn ? 'on' : 'off');
        form.append('output', output);
        form.append('fit', fit);
        form.append('background', background);

        if (fit === 'cover' && frameRect) {
            form.append('crop_x', String(frameRect.x));
            form.append('crop_y', String(frameRect.y));
            form.append('crop_width', String(frameRect.width));
            form.append('crop_height', String(frameRect.height));
        }

        submit.submit(form, {
            originalBytes: entry.size,
            sourceWidth: entry.width,
            sourceHeight: entry.height,
            targetWidth: layout.paper.widthPx,
            targetHeight: layout.paper.heightPx,
        });
    };

    /* ----------------------------------------------------------- markup */

    const settings = (
        <div className="flex flex-col gap-3">
            <PresetChips
                label="Photo size"
                items={PHOTO_PRESET_ITEMS}
                value={presetId ?? 'custom'}
                onSelect={handlePresetSelect}
            />
            <p className="text-micro text-ink-muted">
                Sizes come from the same verified presets as Passport &amp; ID Photo; Resizo does not judge the
                photograph itself.
            </p>

            {isCustomPhoto ? (
                <SizeFields
                    idPrefix="sheet-photo"
                    width={customWidth}
                    height={customHeight}
                    unit={customUnit}
                    onChange={handlePhotoFieldChange}
                    sizeError={photoSizeError}
                    showUnit
                />
            ) : null}

            <p className="text-micro text-ink-muted">
                Resizo preserves the selected photo dimensions on the sheet. It does not determine whether the
                source photo meets pose, lighting, expression or other authority requirements. Need to prepare
                or crop the photo first? Use{' '}
                <Link href="/passport-photo" className={LINK}>Passport &amp; ID Photo</Link>
                {' or '}
                <Link href="/image-size-fitter" className={LINK}>Image Size Fitter</Link>.
            </p>
        </div>
    );

    const sourcePreview = entry ? (
        <div className="flex flex-col gap-4">
            <div className="checkerboard flex justify-center rounded-panel border border-line p-3">
                <div className="relative inline-block max-w-full">
                    {fit === 'cover' && frameRect && targetAspect ? (
                        <FrameCrop
                            id="sheet-frame"
                            src={entry.previewUrl}
                            sourceWidth={entry.width}
                            sourceHeight={entry.height}
                            aspect={targetAspect}
                            value={frameRect}
                            onChange={(rect) => { submit.reset(); setManualRect(rect); }}
                            label="Position your photo inside the frame"
                        />
                    ) : (
                        // eslint-disable-next-line @next/next/no-img-element -- blob: URL from the visitor's own file; next/image cannot optimise it.
                        <img
                            src={entry.previewUrl}
                            alt={`${entry.name}, the photo that will be printed`}
                            className="block max-h-[380px] w-auto max-w-full"
                        />
                    )}
                </div>
            </div>

            {aspectMismatch ? (
                <p className="text-micro text-ink-muted">
                    {`This photo is ${ratioLabel(entry.width, entry.height)} and the size you chose is `}
                    {`${ratioLabel(layout.photo.widthPx, layout.photo.heightPx)}. `}
                    {'Crop to fill keeps the middle; Fit inside pads the edges; or prepare it first with '}
                    <Link href="/passport-photo" className={LINK}>Passport &amp; ID Photo</Link>
                    {' or '}
                    <Link href="/image-size-fitter" className={LINK}>Image Size Fitter</Link>.
                </p>
            ) : null}

            {enlargementNotice ? <p className="text-micro text-ink-muted">{enlargementNotice}</p> : null}

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
            id="sheet-file"
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
            </div>
        </Dropzone>
    );

    const outputControls = (
        <div className="flex flex-col gap-6">
            <Field id="sheet-paper" label="Paper">
                <select
                    id="sheet-paper"
                    value={paperId}
                    onChange={(event) => clearingSetter(setPaperId)(event.target.value)}
                    className={SELECT}
                >
                    {PAPER_SIZES.map((size) => (
                        <option key={size.id} value={size.id}>{size.label}</option>
                    ))}
                </select>
            </Field>

            <fieldset>
                <legend className="text-ui text-ink">Orientation</legend>
                <div className="mt-2 flex flex-wrap gap-x-6 gap-y-2">
                    {ORIENTATION_OPTIONS.map(({ value, label }) => (
                        <label key={value} className="flex items-center gap-2 text-ui text-ink">
                            <input
                                type="radio"
                                name="sheet-orientation"
                                value={value}
                                checked={orientation === value}
                                onChange={() => clearingSetter(setOrientation)(value)}
                                className={RADIO}
                            />
                            {value === 'auto' && orientation === 'auto' && layout?.ok
                                ? `Auto — ${layout.orientation} fits ${layout.capacity}`
                                : label}
                        </label>
                    ))}
                </div>
            </fieldset>

            <Field
                id="sheet-dpi"
                label="DPI"
                hint="Resizo’s print default — no authority is being quoted."
                className="max-w-[10rem]"
            >
                <input
                    id="sheet-dpi"
                    type="number"
                    inputMode="numeric"
                    min={MIN_SHEET_DPI}
                    max={MAX_SHEET_DPI}
                    step="1"
                    value={dpi}
                    onChange={(event) => clearingSetter(setDpi)(event.target.value)}
                    className={CONTROL}
                />
            </Field>

            <fieldset>
                <legend className="text-ui text-ink">Copies</legend>
                <div className="mt-2 flex flex-col gap-2">
                    <label className="flex items-center gap-2 text-ui text-ink">
                        <input
                            type="radio"
                            name="sheet-copies-mode"
                            value="fill"
                            checked={copiesMode === 'fill'}
                            onChange={() => handleCopiesModeChange('fill')}
                            className={RADIO}
                        />
                        Fill the sheet
                    </label>
                    <label className="flex items-center gap-2 text-ui text-ink">
                        <input
                            type="radio"
                            name="sheet-copies-mode"
                            value="count"
                            checked={copiesMode === 'count'}
                            onChange={() => handleCopiesModeChange('count')}
                            className={RADIO}
                        />
                        Number of copies
                    </label>
                </div>
                {copiesMode === 'count' ? (
                    <Field id="sheet-copies" label="Number of copies" labelHidden className="mt-2 max-w-[10rem]">
                        <input
                            id="sheet-copies"
                            type="number"
                            inputMode="numeric"
                            min="1"
                            step="1"
                            value={copiesCount}
                            onChange={(event) => clearingSetter(setCopiesCount)(event.target.value)}
                            className={CONTROL}
                        />
                    </Field>
                ) : null}
                {layout?.notice ? (
                    <p role="status" id="sheet-capacity" className="mt-2 text-micro text-ink-muted">
                        {layout.notice}
                    </p>
                ) : null}
            </fieldset>

            <div>
                <button
                    type="button"
                    id="sheet-advanced"
                    aria-expanded={advancedVisible}
                    aria-controls={advancedPanelId}
                    onClick={() => setAdvancedOpen((open) => !open)}
                    className="inline-flex min-h-11 items-center gap-1.5 text-ui font-medium text-ink underline underline-offset-4 decoration-line transition-colors duration-120 ease-snap hover:text-accent"
                >
                    <span aria-hidden="true">{advancedVisible ? '−' : '+'}</span>
                    Advanced options
                </button>

                <div id={advancedPanelId} hidden={!advancedVisible} className="mt-5 flex flex-col gap-6">
                    <Field
                        id="sheet-margin"
                        label="Margin (mm)"
                        hint={MARGIN_HINT}
                    >
                        <input
                            id="sheet-margin"
                            type="number"
                            inputMode="decimal"
                            min="0"
                            step="any"
                            value={marginMm}
                            onChange={(event) => clearingSetter(setMarginMm)(event.target.value)}
                            aria-describedby={fieldDescribedBy('sheet-margin', { hint: true })}
                            className={`max-w-[10rem] ${CONTROL}`}
                        />
                    </Field>

                    <Field id="sheet-gap" label="Spacing (mm)" className="max-w-[10rem]">
                        <input
                            id="sheet-gap"
                            type="number"
                            inputMode="decimal"
                            min="0"
                            step="any"
                            value={gapMm}
                            onChange={(event) => clearingSetter(setGapMm)(event.target.value)}
                            className={CONTROL}
                        />
                    </Field>

                    <fieldset>
                        <legend className="text-ui text-ink">Cut guides</legend>
                        <div className="mt-2 flex flex-wrap gap-x-6 gap-y-2">
                            {GUIDE_OPTIONS.map((option) => (
                                <label key={option.value} className="flex items-center gap-2 text-ui text-ink">
                                    <input
                                        type="radio"
                                        name="sheet-guides"
                                        value={option.value}
                                        checked={guides === option.value}
                                        onChange={() => clearingSetter(setGuides)(option.value)}
                                        className={RADIO}
                                    />
                                    {option.label}
                                </label>
                            ))}
                        </div>
                    </fieldset>

                    <div className="flex flex-col gap-1">
                        <label htmlFor="sheet-reference" className="flex items-center gap-2 text-ui text-ink">
                            <input
                                type="checkbox"
                                id="sheet-reference"
                                checked={referenceOn}
                                onChange={(event) => clearingSetter(setReferenceOn)(event.target.checked)}
                                className="size-4 accent-[var(--accent)]"
                            />
                            50 mm reference line
                        </label>
                        <p className="text-micro text-ink-muted">
                            A short line in the bottom margin — measure it after printing.
                        </p>
                    </div>

                    <fieldset>
                        <legend className="text-ui text-ink">Fill behaviour</legend>
                        <div className="mt-2 flex flex-col gap-2">
                            {FIT_OPTIONS.map((option) => (
                                <label key={option.value} className="flex items-center gap-2 text-ui text-ink">
                                    <input
                                        type="radio"
                                        name="sheet-fit"
                                        value={option.value}
                                        checked={fit === option.value}
                                        onChange={() => clearingSetter(setFit)(option.value)}
                                        className={RADIO}
                                    />
                                    {option.label}
                                </label>
                            ))}
                        </div>
                        {showBackground ? (
                            <TransparencyBackground
                                className="mt-3"
                                value={background}
                                onChange={(value) => clearingSetter(setBackground)(value)}
                            />
                        ) : null}
                    </fieldset>
                </div>
            </div>

            <fieldset>
                <legend className="text-ui text-ink">Output</legend>
                <div className="mt-2 flex flex-wrap gap-x-6 gap-y-2">
                    {OUTPUT_OPTIONS.map((option) => (
                        <label key={option.value} className="flex items-center gap-2 text-ui text-ink">
                            <input
                                type="radio"
                                name="sheet-output"
                                value={option.value}
                                checked={output === option.value}
                                onChange={() => clearingSetter(setOutput)(option.value)}
                                className={RADIO}
                            />
                            {option.label}
                        </label>
                    ))}
                </div>
            </fieldset>
        </div>
    );

    const errorToShow = submit.error || (layout && layout.ok === false ? layout.error : null);

    const plainErrorAlert = errorToShow ? (
        <Alert id="sheet-error" tabIndex={-1} className="mt-4">
            {errorToShow}
        </Alert>
    ) : null;

    const previewFigure = (
        <SheetPreview
            layout={layout}
            previewUrl={entry?.previewUrl ?? null}
            sourceWidth={entry?.width ?? 0}
            sourceHeight={entry?.height ?? 0}
            cropRect={fit === 'cover' ? frameRect : null}
            background={background}
        />
    );

    const panel = (
        <div className="flex flex-col gap-5">
            {sourcePreview}
            {outputControls}
            {previewFigure}
            {plainErrorAlert}
        </div>
    );

    const outcome = submit.result;
    const payoff = outcome?.layout ? { value: `×${outcome.layout.copies}`, label: outcome.layout.copies === 1 ? 'copy' : 'copies' } : null;
    const outputDimensions = outcome?.layout?.paper ?? null;

    const result = outcome ? (
        <section aria-labelledby="sheet-result-heading" className="flex flex-col gap-5">
            <h2
                id="sheet-result-heading"
                ref={resultHeadingRef}
                tabIndex={-1}
                className="font-display text-title font-bold tracking-tight text-ink focus:outline-none"
            >
                Sheet ready
            </h2>

            <RequirementSummary checks={outcome.checks} />

            <div role="note" id="sheet-print-note" className="text-micro text-ink-muted">
                Print at Actual Size or 100 %. If your print dialog uses Fit to Page or scaling, the physical
                photo dimensions may change. Your printer may add its own margins.
            </div>

            <ResultPanel
                variant="single"
                previewUrl={outcome.format === 'jpeg' ? preview.url : null}
                alt={outputDimensions
                    ? `A print sheet of ${entry?.name ?? 'your photo'} with ${outcome.layout.copies} `
                        + `${outcome.layout.copies === 1 ? 'copy' : 'copies'} at `
                        + `${outcome.layout.photo.widthPx}×${outcome.layout.photo.heightPx} pixels each`
                    : 'Print sheet'}
                filename={outcome.filename}
                originalBytes={outcome.originalBytes}
                resultBytes={outcome.blob?.size}
                width={outputDimensions?.widthPx}
                height={outputDimensions?.heightPx}
                payoff={payoff}
                onDownload={() => submit.download()}
                onReset={handleReset}
                downloadLabel={outcome.format === 'pdf' ? 'Download PDF' : 'Download JPEG'}
            />
        </section>
    ) : null;

    return (
        <ToolShell
            slug="passport-photo-print"
            title={title}
            intro={intro}
            answer={answer}
            breadcrumb={breadcrumb}
            settingsLabel="Photo size"
            settings={settings}
            panel={panel}
            action={(
                <ToolAction
                    label="Create sheet"
                    processingLabel="Creating…"
                    isProcessing={submit.isProcessing}
                    progress={submit.progress}
                    disabled={!canSubmit}
                    hint={actionHint}
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
