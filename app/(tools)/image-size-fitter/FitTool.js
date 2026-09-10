'use client';

/**
 * FitTool
 *
 * A standalone product over /passport-photo's requirement fitter: the SAME
 * engine, validator, crop frame, DPI writer and byte search (the `fit` op),
 * offered without a passport preset in front of it. Where /passport-photo
 * asks "which authority's numbers?", this page asks nothing first — Width,
 * Height, a byte ceiling and the format are the whole form, and everything
 * else (Unit, DPI, a byte floor, fill behaviour, background, a lower-quality
 * search) sits behind "Advanced options" for the visitor who needs it.
 *
 * THE EXAMPLES CHIPS ARE NOT A CLAIM.
 *
 * /passport-photo's preset chips cite a verified authority; there is no
 * authority here, so the row above the drop zone is labelled "Examples" and
 * says so underneath ("Examples only — use the numbers your form gives
 * you."). Picking one fills the fields the same way a preset does and drops
 * the moment any field is hand-edited, for the same reason /signature-resizer
 * and /change-image-dpi already treat a chip that way: it is a claim about
 * one exact set of numbers, false the instant one of them is typed over.
 *
 * WHY WIDTH/HEIGHT ARE PRIMARY BUT UNIT IS BEHIND ADVANCED.
 *
 * Most visitors here are typing plain pixels from a form ("600x600px, under
 * 100KB"); Unit only matters to the smaller group converting a printed
 * requirement, and DPI, a byte floor, fill behaviour, background and a
 * lower-quality search matter to a smaller group still. Putting all nine
 * fields in front of everyone pushes the drop zone off a phone screen for no
 * benefit to the visitor who only ever needed four of them.
 *
 * EVERYTHING BELOW IS SHARED WITH /passport-photo, ON PURPOSE.
 *
 * `components/tools/fit/RequirementFields` (individual pieces here, not its
 * default assembly — see that file for why the two pages compose them
 * differently), `RecoveryOptions`, `RequirementSummary` and
 * `lib/format/fit-requirements` are the exact modules /passport-photo's own
 * PassportTool.js was rewired onto. `components/tools/TransparencyBackground`
 * is the same background control /change-image-dpi's sibling tools already
 * share; /passport-photo keeps its own version (different legend, for its
 * own Fit-inside padding case) rather than this one.
 */
import { useEffect, useMemo, useRef, useState } from 'react';

import FrameCrop from '@/components/tools/FrameCrop';
import PresetChips from '@/components/tools/PresetChips';
import RecoveryOptions from '@/components/tools/fit/RecoveryOptions';
import {
    DpiField,
    FormatFields,
    GeometryFields,
    LowerQualityField,
    MaxKbField,
    MinKbField,
    SizeFields,
    UnitField,
} from '@/components/tools/fit/RequirementFields';
import RequirementSummary from '@/components/tools/fit/RequirementSummary';
import ResultPanel from '@/components/tools/ResultPanel';
import ToolShell, { ToolAction } from '@/components/tools/ToolShell';
import TransparencyBackground from '@/components/tools/TransparencyBackground';
import Dropzone from '@/components/ui/Dropzone';
import { centeredCoverRect, enlargementFor, recoveryFor, resolveRequirements } from '@/lib/format/fit-requirements';
import useImageUpload from '@/lib/hooks/useImageUpload';
import useLocalProcess from '@/lib/hooks/useLocalProcess';
import usePreviewUrl from '@/lib/hooks/usePreviewUrl';
import { TARGET_UNREACHABLE_CODE } from '@/lib/image-client/target-bytes';
import { RASTER_INPUT_FORMATS } from '@/lib/limits';

const MIN_UNREACHABLE_CODE = 'minimum-unreachable';

const SAMPLE_BUTTON = 'inline-flex min-h-11 items-center justify-center rounded-button border border-line bg-surface-raised px-3 text-ui font-medium text-ink transition-colors duration-120 ease-snap hover:bg-surface-sunken';

const SAMPLE = {
    src: '/samples/landscape-1600x1067.jpg',
    name: 'fit-sample-landscape.jpg',
};

const FORMAT_OPTIONS = [
    { value: 'jpeg', label: 'JPEG' },
    { value: 'png', label: 'PNG' },
    { value: 'webp', label: 'WebP' },
];

/**
 * Illustrative fills, not verified requirements — see the file note above.
 * Each chip's visible text ("Square 600 × 600", …) is its label and detail
 * concatenated, which is also what makes it its own accessible name.
 */
const EXAMPLES = [
    { id: 'square', label: 'Square', detail: '600 × 600', width: 600, height: 600, format: 'jpeg' },
    { id: 'signature', label: 'Signature', detail: '140 × 60 · 20 KB', width: 140, height: 60, format: 'jpeg', maxKb: 20 },
    { id: 'photo', label: 'Photo', detail: '200 × 230 · 50 KB', width: 200, height: 230, format: 'jpeg', maxKb: 50 },
];

function formatName(format) {
    const labels = { jpeg: 'JPEG', png: 'PNG', webp: 'WebP' };
    return labels[format] ?? String(format ?? '').toUpperCase();
}

export default function FitTool({
    title = 'Fit an Image to Exact Dimensions and File Size',
    intro = 'Exact pixels, a maximum file size, DPI and fill behaviour — from the numbers your own form gives you. Nothing is uploaded.',
    answer,
    breadcrumb,
    children,
}) {
    const [width, setWidth] = useState('');
    const [height, setHeight] = useState('');
    const [unit, setUnit] = useState('px');
    const [dpi, setDpi] = useState('');
    const [format, setFormat] = useState('jpeg');
    const [maxKb, setMaxKb] = useState('');
    const [minKb, setMinKb] = useState('');
    const [geometry, setGeometry] = useState('cover');
    const [background, setBackground] = useState('white');
    const [allowLowerQuality, setAllowLowerQuality] = useState(false);
    const [manualRect, setManualRect] = useState(null);
    const [activeExampleId, setActiveExampleId] = useState(null);
    const [advancedOpen, setAdvancedOpen] = useState(false);

    const advancedPanelId = 'fit-advanced-panel';

    const widthRef = useRef(null);
    const maxKbRef = useRef(null);
    const minKbRef = useRef(null);
    const focusAfterLoadRef = useRef(false);
    const resultHeadingRef = useRef(null);

    const upload = useImageUpload({ accept: RASTER_INPUT_FORMATS });
    const preview = usePreviewUrl();
    const submit = useLocalProcess({
        op: 'fit',
        onSuccess: (payload) => preview.show(payload.blob),
    });

    const entry = upload.file;

    /**
     * Every control that changes what the job means clears the active
     * example (a chip is a claim about one exact set of numbers, false the
     * moment any of them is edited by hand), the manual crop position (drawn
     * for one target shape, meaningless for another) and any finished
     * result — the same reset /passport-photo's own fields use.
     */
    const clearingSetter = (setter) => (value) => {
        submit.reset();
        setActiveExampleId(null);
        setManualRect(null);
        setter(value);
    };

    const handleUnitChange = (nextUnit) => {
        submit.reset();
        setActiveExampleId(null);
        setManualRect(null);
        setUnit(nextUnit);
        if (nextUnit !== 'px' && dpi.trim() === '') setDpi('300');
    };

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
        if (name === 'allowLowerQuality') { clearingSetter(setAllowLowerQuality)(value); return; }
    }

    const applyExample = (item) => {
        submit.reset();
        setManualRect(null);
        setActiveExampleId(item.id);
        setUnit('px');
        setWidth(String(item.width));
        setHeight(String(item.height));
        if (item.format) setFormat(item.format);
        setMaxKb(item.maxKb ? String(item.maxKb) : '');
    };

    const handleExampleSelect = (item) => {
        if (!item) { setActiveExampleId(null); return; }
        applyExample(item);
    };

    /* ---------------------------------------------------------- sizing */

    const requirement = entry
        ? resolveRequirements({ width, height, unit, dpi, format, maxKb, minKb, geometry, background, allowLowerQuality })
        : null;

    const sizeError = requirement ? (requirement.errors.width || requirement.errors.height || requirement.errors.size || null) : null;
    const dpiError = requirement?.errors.dpi || null;
    const maxKbError = requirement?.errors.maxKb || null;
    const minKbError = requirement?.errors.minKb || null;

    const pixels = requirement?.ok ? requirement.pixels : null;
    const aspect = pixels ? pixels.width / pixels.height : null;

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
            pixels,
        })
        : null;

    const enlargementNotice = enlargement
        ? `This image will be enlarged from ${enlargement.from.width} × ${enlargement.from.height} to `
            + `${enlargement.to.width} × ${enlargement.to.height}. Enlargement increases pixel dimensions but `
            + 'cannot create missing detail.'
        : null;

    const showWebpNote = format === 'webp' && dpi.trim() !== '';
    const showBackground = format === 'jpeg' || geometry === 'contain';

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
        setTimeout(() => document.getElementById('fit-file-browse')?.focus(), 0);
    };

    useEffect(() => {
        if (submit.error) document.getElementById('fit-recovery')?.focus();
    }, [submit.error]);

    useEffect(() => {
        if (submit.result) resultHeadingRef.current?.focus();
    }, [submit.result]);

    useEffect(() => {
        if (!focusAfterLoadRef.current || !entry) return;
        focusAfterLoadRef.current = false;
        (document.getElementById('fit-frame') ?? widthRef.current)?.focus();
    }, [entry]);

    /* ------------------------------------------------------------- submit */

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
        if (fields.minBytes) form.append('minBytes', String(fields.minBytes));
        if (fields.minQuality) form.append('minQuality', String(fields.minQuality));
        if (fields.dpi) form.append('dpi', String(fields.dpi));

        submit.submit(form, {
            originalBytes: entry.size,
            sourceWidth: entry.width,
            sourceHeight: entry.height,
            targetWidth: fields.width,
            targetHeight: fields.height,
        });
    };

    const runWithOverride = (overrides) => {
        if (!entry) return;
        const result = resolveRequirements({
            width, height, unit, dpi, format, maxKb, minKb, geometry, background, allowLowerQuality, ...overrides,
        });
        if (!result.ok) return;
        if (overrides.format) setFormat(overrides.format);
        if (overrides.allowLowerQuality) setAllowLowerQuality(true);
        submitFields(result.fields);
    };

    const handleSubmit = () => { if (requirement?.ok) submitFields(requirement.fields); };
    const handleAllowLowerQuality = () => runWithOverride({ allowLowerQuality: true });
    const handleSwitchToWebp = () => {
        setDpi('');
        runWithOverride({ format: 'webp', dpi: '' });
    };
    const handleSwitchToPng = () => runWithOverride({ format: 'png' });

    const isTargetFailure = Boolean(submit.error) && submit.code === TARGET_UNREACHABLE_CODE;
    const isMinFailure = Boolean(submit.error) && submit.code === MIN_UNREACHABLE_CODE;
    const showRecovery = isTargetFailure || isMinFailure;
    const recoveryOptions = showRecovery ? recoveryFor(submit.code, { format }) : [];

    const plainError = (() => {
        if (showRecovery || !submit.error) return null;
        const fix = submit.suggestion;
        if (!fix || submit.error.includes(fix)) return submit.error;
        return `${submit.error} ${fix}`;
    })();

    /* ----------------------------------------------------------- markup */

    const settings = (
        <div>
            <PresetChips
                label="Examples"
                items={EXAMPLES}
                value={activeExampleId}
                onSelect={handleExampleSelect}
            />
            <p className="mt-1.5 text-micro text-ink-muted">
                Examples only — use the numbers your form gives you.
            </p>
        </div>
    );

    const isSample = entry?.name === SAMPLE.name;

    const sourcePreview = entry ? (
        <div className="flex flex-col gap-4">
            <div className="checkerboard flex justify-center rounded-panel border border-line p-3">
                <div className="relative inline-block max-w-full">
                    {geometry === 'cover' && frameRect && aspect ? (
                        <FrameCrop
                            id="fit-frame"
                            src={entry.previewUrl}
                            sourceWidth={entry.width}
                            sourceHeight={entry.height}
                            aspect={aspect}
                            value={frameRect}
                            onChange={(rect) => {
                                submit.reset();
                                setManualRect(rect);
                            }}
                            label="Position your photo inside the frame"
                        />
                    ) : (
                        // eslint-disable-next-line @next/next/no-img-element -- blob: URL from the visitor's own file; next/image cannot optimise it.
                        <img
                            src={entry.previewUrl}
                            alt={isSample
                                ? 'The generated sample scene used to demonstrate this tool.'
                                : `${entry.name}, the image that will be fitted`}
                            className="block max-h-[380px] w-auto max-w-full"
                        />
                    )}
                </div>
            </div>

            <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 font-data text-micro text-ink-muted">
                <p>Source <span className="text-ink">{entry.width}×{entry.height}</span></p>
                {pixels ? <p>Target <span className="text-ink">{pixels.width}×{pixels.height}</span></p> : null}
            </div>

            {enlargementNotice ? (
                <p className="text-micro text-ink-muted">{enlargementNotice}</p>
            ) : null}

            {geometry !== 'cover' ? (
                <p className="text-micro text-ink-muted">
                    {geometry === 'contain'
                        ? 'The whole image is kept and padded to the exact box, so there is nothing to position here.'
                        : 'The whole image is kept and stretched to the exact box, so there is nothing to position here.'}
                </p>
            ) : null}

            <div>
                <button
                    type="button"
                    onClick={handleReset}
                    className="min-h-11 rounded-button border border-line px-3 py-2 text-ui text-ink transition-colors duration-120 ease-snap hover:bg-surface-sunken"
                >
                    Choose another image
                </button>
            </div>
        </div>
    ) : (
        <Dropzone
            id="fit-file"
            label="Drop an image here"
            constraints={upload.constraints}
            accept={upload.accept}
            state={upload.state}
            reason={upload.error}
            onFiles={handleFiles}
            onDragChange={upload.setDragging}
            disabled={upload.isReading}
        >
            <div className="mt-2 flex flex-col items-center gap-2">
                <p className="text-micro text-ink-muted">No image to hand?</p>
                <button type="button" onClick={loadSample} className={SAMPLE_BUTTON}>
                    Try the sample photo
                </button>
            </div>
        </Dropzone>
    );

    /* -------------------------------------------------------- output fields */

    const outputControls = (
        <div className="flex flex-col gap-6">
            <SizeFields
                idPrefix="fit"
                width={width}
                height={height}
                unit={unit}
                onChange={handleFieldChange}
                error={sizeError}
                showUnit={false}
                widthRef={widthRef}
            />

            <MaxKbField idPrefix="fit" value={maxKb} onChange={handleFieldChange} error={maxKbError} inputRef={maxKbRef} />

            <FormatFields
                idPrefix="fit"
                format={format}
                onChange={handleFieldChange}
                options={FORMAT_OPTIONS}
                webpNote={showWebpNote}
            />

            <div>
                <button
                    type="button"
                    id="fit-advanced"
                    aria-expanded={advancedOpen}
                    aria-controls={advancedPanelId}
                    onClick={() => setAdvancedOpen((open) => !open)}
                    className="inline-flex min-h-11 items-center gap-1.5 text-ui font-medium text-ink underline underline-offset-4 decoration-line transition-colors duration-120 ease-snap hover:text-accent"
                >
                    <span aria-hidden="true">{advancedOpen ? '−' : '+'}</span>
                    Advanced options
                </button>

                {advancedOpen ? (
                    <div id={advancedPanelId} className="mt-5 flex flex-col gap-6">
                        <UnitField idPrefix="fit" unit={unit} onChange={handleFieldChange} />

                        <DpiField idPrefix="fit" unit={unit} dpi={dpi} onChange={handleFieldChange} error={dpiError} />

                        <MinKbField idPrefix="fit" value={minKb} onChange={handleFieldChange} error={minKbError} inputRef={minKbRef} />

                        <GeometryFields idPrefix="fit" geometry={geometry} onChange={handleFieldChange} />

                        {showBackground ? (
                            <TransparencyBackground
                                value={background}
                                onChange={(value) => handleFieldChange('background', value)}
                            />
                        ) : null}

                        <LowerQualityField idPrefix="fit" checked={allowLowerQuality} onChange={handleFieldChange} />
                    </div>
                ) : null}
            </div>
        </div>
    );

    const recovery = (
        <RecoveryOptions
            id="fit-recovery"
            className="mt-4"
            error={showRecovery ? submit.error : null}
            suggestion={submit.suggestion}
            options={recoveryOptions}
            onAllowLowerQuality={handleAllowLowerQuality}
            onSwitchToWebp={handleSwitchToWebp}
            onChangeLimit={() => maxKbRef.current?.focus()}
            onSwitchToPng={handleSwitchToPng}
            onChangeSize={() => widthRef.current?.focus()}
            onChangeMinimum={() => {
                setAdvancedOpen(true);
                setTimeout(() => minKbRef.current?.focus(), 0);
            }}
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
    const resultHeadingText = outcome?.verified ? 'All requirements met' : 'Requirements not met';
    const payoff = outcome ? { value: `${outcome.width}×${outcome.height}`, label: 'exact' } : null;

    // Every number here comes off the RESULT, never off the live form — the
    // same rule /passport-photo's own footnote follows, for the same reason:
    // a setting still on screen after the job ran must not be mistaken for a
    // description of the file behind the Download button.
    const footnote = outcome ? (() => {
        const parts = [`Saved at ${outcome.width}×${outcome.height} px as ${formatName(outcome.format)}.`];

        if (outcome.fit === 'contain') parts.push('The whole image was kept, padded to the exact box.');
        if (outcome.fit === 'stretch') parts.push('The whole image was stretched to the exact box, which distorts it.');

        const kept = outcome.crop
            ?? (outcome.originalWidth && outcome.originalHeight
                ? { width: outcome.originalWidth, height: outcome.originalHeight }
                : null);
        if (kept && (outcome.width > kept.width || outcome.height > kept.height)) {
            parts.push(`The image was enlarged from ${kept.width}×${kept.height}, which cannot add detail.`);
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
    })() : null;

    const result = outcome ? (
        <section aria-labelledby="fit-result-heading" className="flex flex-col gap-5">
            <h2
                id="fit-result-heading"
                ref={resultHeadingRef}
                tabIndex={-1}
                className="font-display text-title font-bold tracking-tight text-ink focus:outline-none"
            >
                {resultHeadingText}
            </h2>
            <RequirementSummary checks={outcome.checks} />
            {outcome.verified ? (
                <ResultPanel
                    variant="single"
                    previewUrl={preview.url}
                    alt={`${entry?.name ?? 'Your image'} fitted to ${outcome.width}×${outcome.height}`}
                    filename={outcome.filename}
                    originalBytes={outcome.originalBytes}
                    resultBytes={outcome.resultBytes}
                    width={outcome.width}
                    height={outcome.height}
                    payoff={payoff}
                    onDownload={() => submit.download()}
                    onReset={handleReset}
                    downloadLabel="Download image"
                    footnote={footnote}
                />
            ) : (
                <p className="text-micro text-ink-muted">{footnote}</p>
            )}
        </section>
    ) : null;

    return (
        <ToolShell
            slug="image-size-fitter"
            title={title}
            intro={intro}
            answer={answer}
            breadcrumb={breadcrumb}
            settingsLabel="Examples"
            settings={settings}
            panel={panel}
            error={plainError || null}
            action={(
                <ToolAction
                    label="Fit image"
                    processingLabel={submit.phase === 'searching' ? 'Finding the size…' : 'Fitting…'}
                    isProcessing={submit.isProcessing}
                    progress={submit.progress}
                    disabled={!canSubmit}
                    hint={!canSubmit ? 'Add an image and a size to turn this on.' : undefined}
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
