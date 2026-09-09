'use client';

/**
 * SignatureTool
 *
 * One page for the job an application form makes somebody do with three tools.
 * A form asks for a signature at an exact pixel size, under an exact byte
 * ceiling, from a photo of a piece of paper — so this page crops, sizes and
 * compresses in one pass rather than sending the visitor to /crop, then
 * /resize, then /compress and hoping the third does not undo the second.
 *
 * WHY THE SIZE SITS ABOVE THE DROP ZONE AND THE RECTANGLE DOES NOT
 *
 * The size, the fit, the format, the colour behind it and the byte ceiling are
 * all knowable before there is a file: they come off the form the visitor is
 * looking at. They belong in the settings slot, so a file lands already
 * configured (DESIGN.md > Layout).
 *
 * The rectangle does not. A crop is meaningless until there is an image to
 * measure it against, which is the same reason /crop keeps its four fields in
 * the panel. Selecting a file therefore starts with the whole image kept, and
 * narrowing it is an edit rather than a required step.
 *
 * THE THREE THINGS THIS PAGE MUST NOT DO QUIETLY
 *
 *   1. Distort. 'fit' and 'cover' both preserve the signature's shape; only
 *      'stretch' does not, so it is never the default and its result says so in
 *      words.
 *   2. Shrink the picture to hit the byte ceiling without saying so. A form
 *      that asked for 300×80 does not want 240×64, and the visitor cannot see
 *      the difference in a preview. The footnote states which way it went, in
 *      both directions — "not changed" is as load-bearing as "shrunk from".
 *   3. Present an example size as a requirement. Forms differ; the chips are
 *      labelled as examples and the line under them says to use the size the
 *      form actually asks for.
 */
import { useMemo, useState } from 'react';

import CropOverlay from '@/components/tools/CropOverlay';
import PresetChips from '@/components/tools/PresetChips';
import ResultPanel from '@/components/tools/ResultPanel';
import ToolShell, { ToolAction } from '@/components/tools/ToolShell';
import Dropzone from '@/components/ui/Dropzone';
import Field, { fieldDescribedBy } from '@/components/ui/Field';
import { formatFileSize } from '@/lib/format/bytes';
import useImageUpload from '@/lib/hooks/useImageUpload';
import useLocalProcess from '@/lib/hooks/useLocalProcess';
import usePreviewUrl from '@/lib/hooks/usePreviewUrl';
import {
    MAX_TARGET_BYTES,
    MIN_TARGET_BYTES,
    RASTER_INPUT_FORMATS,
    SIGNATURE_OUTPUT_FORMATS,
} from '@/lib/limits';

const CONTROL = 'w-full rounded-input border border-line bg-surface-raised px-3 py-2 font-data text-ui text-ink';

const SELECT = 'w-full rounded-input border border-line bg-surface-raised px-3 py-2 text-ui text-ink';

const RADIO = 'size-4 accent-[var(--accent)] disabled:opacity-50';

const EMPTY_RECT = { x: 0, y: 0, width: 0, height: 0 };

const SIZE_HINT_ID = 'signature-size-hint';

/**
 * The id Field gives the error it renders under the width input, and the one
 * thing on this page that BOTH size inputs have to point at: either side alone
 * satisfies the requirement, so either side is where somebody may be standing
 * while the button is dead, and a field that does not describe the error is a
 * field that explains nothing about why.
 */
const SIZE_ERROR_ID = 'signature-width-error';

const BACKGROUND_HINT_ID = 'signature-background-hint';

const TARGET_HINT = 'Leave empty for no limit. When set, quality is reduced first and the picture is '
    + 'shrunk only if it still does not fit — the result says so.';

const FIT_OPTIONS = [
    { value: 'fit', label: 'Fit inside the size (no distortion)' },
    { value: 'cover', label: 'Fill the size and trim the edges' },
    { value: 'stretch', label: 'Stretch to the exact size (distorts)' },
];

/**
 * What a form calls these two formats, which is not what the engine calls them.
 * The LIST comes from lib/limits.js — restating it here is how /resize once
 * offered a format the encoder could not write — and this map only supplies the
 * word a visitor reads on the form in front of them: forms say JPG.
 */
const FORMAT_LABELS = { jpeg: 'JPG', png: 'PNG' };

function formatName(format) {
    return FORMAT_LABELS[format] ?? String(format ?? '').toUpperCase();
}

const FORMAT_OPTIONS = SIGNATURE_OUTPUT_FORMATS.map((value) => ({
    value,
    label: formatName(value),
}));

const [DEFAULT_FORMAT] = SIGNATURE_OUTPUT_FORMATS;

const BACKGROUNDS = [
    { value: 'white', label: 'White' },
    { value: 'black', label: 'Black' },
];

/**
 * Sizes that are common on forms, labelled by how big they are and NOTHING
 * else. Naming an authority here — a passport office, a bank, an exam board —
 * would be a claim this page cannot stand behind for a visitor filling in a
 * different form, and a visitor who trusts a chip over the form in front of
 * them gets sent back to the start of the queue.
 */
const EXAMPLE_SIZES = [
    { id: '140x60', label: 'Small', width: 140, height: 60 },
    { id: '200x60', label: 'Medium', width: 200, height: 60 },
    { id: '300x80', label: 'Large', width: 300, height: 80 },
    { id: '600x200', label: 'Extra large', width: 600, height: 200 },
];

const EXAMPLE_ITEMS = EXAMPLE_SIZES.map((size) => ({
    ...size,
    detail: `${size.width}×${size.height}`,
}));

const CROP_FIELDS = [
    { key: 'x', label: 'X', hint: 'from the left edge' },
    { key: 'y', label: 'Y', hint: 'from the top edge' },
    { key: 'width', label: 'Width', hint: 'pixels to keep' },
    { key: 'height', label: 'Height', hint: 'pixels to keep' },
];

function toPixels(value) {
    const parsed = Math.trunc(Number(value));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function pair(width, height) {
    return Number.isFinite(width) && Number.isFinite(height) ? `${width}×${height}` : null;
}

/**
 * The sentence under the result, and the only place four separate outcomes are
 * visible at once: what came in, what went out, which region was used, and
 * whether the byte ceiling cost the visitor the size they asked for.
 *
 * The last one is why this is not a one-liner. A signature that came back at
 * 240×64 when the form wanted 300×80 looks perfectly correct in a preview, in
 * the download button and in the savings numeral — the only way to find out is
 * to be told, so the "not changed" case is stated as explicitly as the shrunk
 * one rather than left as an absence.
 */
export function describeResult(outcome, source) {
    if (!outcome) return null;

    const sourceWidth = outcome.originalWidth ?? source?.width;
    const sourceHeight = outcome.originalHeight ?? source?.height;
    const before = pair(sourceWidth, sourceHeight);
    const after = pair(outcome.width, outcome.height);
    const saved = formatName(outcome.format);

    const parts = [
        before && after
            ? `${before} at ${formatFileSize(outcome.originalBytes)} became ${after} at `
                + `${formatFileSize(outcome.resultBytes)}, saved as ${saved}.`
            : `${formatFileSize(outcome.originalBytes)} became ${formatFileSize(outcome.resultBytes)}, `
                + `saved as ${saved}.`,
    ];

    const crop = outcome.crop;
    const wholeImage = !crop
        || (crop.x === 0 && crop.y === 0 && crop.width === sourceWidth && crop.height === sourceHeight);
    if (crop && !wholeImage) {
        parts.push(`Kept ${crop.width}×${crop.height} from x ${crop.x}, y ${crop.y}.`);
    }

    if (outcome.fit === 'stretch') parts.push('Stretched to the exact size you chose.');

    if (outcome.targetBytes) {
        const limit = formatFileSize(outcome.targetBytes);

        parts.push(outcome.targetMet === false
            ? `It did not reach the ${limit} limit you set — ${formatFileSize(outcome.resultBytes)} is as `
                + 'small as this picture goes here.'
            : `It fits the ${limit} limit you set.`);

        const asked = pair(outcome.requestedWidth, outcome.requestedHeight);
        if (!outcome.resized) {
            parts.push('Dimensions were not changed to meet the size limit.');
        } else {
            parts.push(asked && after
                ? `The picture was shrunk from ${asked} to ${after} to get under ${limit}.`
                : `The picture was shrunk to get under ${limit}.`);
        }
    }

    return parts.join(' ');
}

export default function SignatureTool({
    title = 'Signature Resizer for Online Forms',
    intro = 'Crop a scanned signature, fit it into the pixel box a form asks for and keep it under the file size limit the form sets — done on your device, never uploaded.',
    answer,
    breadcrumb,
    children,
}) {
    const [rect, setRect] = useState(EMPTY_RECT);
    const [width, setWidth] = useState('');
    const [height, setHeight] = useState('');
    const [fit, setFit] = useState(FIT_OPTIONS[0].value);
    const [format, setFormat] = useState(DEFAULT_FORMAT);
    const [background, setBackground] = useState(BACKGROUNDS[0].value);
    const [maxKb, setMaxKb] = useState('');
    const [presetId, setPresetId] = useState(null);

    const upload = useImageUpload({ accept: RASTER_INPUT_FORMATS });
    const preview = usePreviewUrl();
    const submit = useLocalProcess({
        op: 'signature',
        onSuccess: (payload) => preview.show(payload.blob),
    });

    const entry = upload.file;
    const sourceWidth = entry?.width ?? 0;
    const sourceHeight = entry?.height ?? 0;
    const keepsTransparency = format === 'png';

    const fitsInside = rect.width > 0
        && rect.height > 0
        && rect.x + rect.width <= sourceWidth
        && rect.y + rect.height <= sourceHeight;

    const boundsError = entry && !fitsInside
        ? `That region falls outside the image. It has to fit inside ${sourceWidth}×${sourceHeight} pixels, counting from the top-left corner.`
        : null;

    const askedWidth = width.trim();
    const askedHeight = height.trim();

    // Only once there is a file. An error sitting on an empty page accuses the
    // visitor of something they have not had the chance to do yet.
    const sizeError = entry && askedWidth === '' && askedHeight === ''
        ? 'Enter a width or a height in pixels.'
        : null;

    // 0 means "typed, but not a number a size can be made from" — it fails the
    // floor check below and so never reaches the engine, while `null` means the
    // field was left empty and no ceiling was asked for at all.
    const targetBytes = useMemo(() => {
        const raw = maxKb.trim();
        if (raw === '') return null;
        const value = Number(raw);
        if (!Number.isFinite(value) || value <= 0) return 0;
        return Math.round(value * 1024);
    }, [maxKb]);

    const targetError = targetBytes !== null
        && (targetBytes < MIN_TARGET_BYTES || targetBytes > MAX_TARGET_BYTES)
        ? `Pick a maximum between ${formatFileSize(MIN_TARGET_BYTES)} and ${formatFileSize(MAX_TARGET_BYTES)}.`
        : null;

    const handleReset = () => {
        submit.reset();
        upload.clear();
        preview.clear();
        setRect(EMPTY_RECT);
    };

    const handleFiles = async (files) => {
        submit.reset();
        preview.clear();
        const [accepted] = await upload.selectFiles(files);
        setRect(accepted?.width
            ? { x: 0, y: 0, width: accepted.width, height: accepted.height }
            : EMPTY_RECT);
        return accepted ? [accepted] : [];
    };

    /**
     * Every control clears the result, for the reason /crop had to learn twice:
     * ToolShell removes the submit action while a result is on screen, so a
     * setting changed under a stale result leaves the visitor with numbers no
     * button can run — and on this page the drop zone has been replaced by the
     * preview by then, so the only way out would be to start over and lose the
     * scan.
     */
    const handleSize = (setter) => (value) => {
        submit.reset();
        setPresetId(null);
        setter(value);
    };

    const handleExample = (item) => {
        submit.reset();

        if (!item) {
            setPresetId(null);
            return;
        }

        setPresetId(item.id);
        setWidth(String(item.width));
        setHeight(String(item.height));
    };

    const handleWholeImage = () => {
        submit.reset();
        setRect({ x: 0, y: 0, width: sourceWidth, height: sourceHeight });
    };

    const handleSubmit = () => {
        if (!entry || boundsError || sizeError || targetError) return;

        const form = new FormData();
        form.append('file', entry.file);
        form.append('crop_x', String(rect.x));
        form.append('crop_y', String(rect.y));
        form.append('crop_width', String(rect.width));
        form.append('crop_height', String(rect.height));
        // Only the side that was typed. An empty one posted as '' would look
        // like a requested size of nothing rather than a side the engine is
        // supposed to derive from the shape of the crop.
        if (askedWidth !== '') form.append('width', askedWidth);
        if (askedHeight !== '') form.append('height', askedHeight);
        form.append('fit', fit);
        form.append('format', format);
        form.append('background', background);
        if (targetBytes) form.append('targetBytes', String(targetBytes));

        // The measured dimensions go with the job, not just the rectangle: the
        // memory gate can only refuse a job it can cost, and it has to do that
        // before anything decodes.
        submit.submit(form, {
            originalBytes: entry.size,
            sourceWidth,
            sourceHeight,
        });
    };

    const sizeDescribedBy = [SIZE_HINT_ID, sizeError ? SIZE_ERROR_ID : null]
        .filter(Boolean)
        .join(' ');

    const settings = (
        <div className="flex flex-col gap-5">
            <div>
                <div className="grid grid-cols-2 gap-3 sm:max-w-md">
                    <Field id="signature-width" label="Width (px)" error={sizeError}>
                        <input
                            id="signature-width"
                            type="number"
                            inputMode="numeric"
                            min="1"
                            step="1"
                            placeholder="300"
                            value={width}
                            onChange={(event) => handleSize(setWidth)(event.target.value)}
                            aria-describedby={sizeDescribedBy}
                            aria-invalid={sizeError ? true : undefined}
                            className={CONTROL}
                        />
                    </Field>

                    <Field id="signature-height" label="Height (px)">
                        <input
                            id="signature-height"
                            type="number"
                            inputMode="numeric"
                            min="1"
                            step="1"
                            placeholder="80"
                            value={height}
                            onChange={(event) => handleSize(setHeight)(event.target.value)}
                            aria-describedby={sizeDescribedBy}
                            aria-invalid={sizeError ? true : undefined}
                            className={CONTROL}
                        />
                    </Field>
                </div>

                <p id={SIZE_HINT_ID} className="mt-1.5 text-micro text-ink-muted">
                    Leave one side empty and it is worked out from the area you keep.
                </p>
            </div>

            <div>
                <PresetChips
                    label="Examples of sizes forms ask for"
                    items={EXAMPLE_ITEMS}
                    value={presetId}
                    onSelect={handleExample}
                />
                <p className="mt-1.5 text-micro text-ink-muted">
                    Examples only. Use the exact size the form you are filling in asks for.
                </p>
            </div>
        </div>
    );

    /**
     * Everything else the job needs, painted BELOW the drop zone and above the
     * button. Measured on a 393×844 phone, holding all six controls above the
     * zone put it at 860px — off the first screen entirely, while every other
     * tool lands one between 181px and 451px, and a page whose drop zone cannot
     * be seen is a page that does nothing at first paint.
     *
     * "Settings above the drop zone" buys one thing: a file that lands already
     * configured, finished in one pass. The size is what a signature genuinely
     * has to land with — it is why the visitor is here and the only field with
     * no working default — so it stays up there with its examples. The shape,
     * the format, the colour behind it and the byte ceiling are answered in the
     * same pass either way, and each of them reads better beside the picture it
     * applies to than above an empty box.
     */
    const outputControls = (
        <div role="group" aria-label="Output" className="border-t border-line pt-5">
            <p className="text-ui text-ink">Output</p>

            <div className="mt-3 flex flex-col gap-5">
                <Field
                    id="signature-fit"
                    label="If the crop is a different shape"
                    className="sm:max-w-md"
                >
                    <select
                        id="signature-fit"
                        value={fit}
                        onChange={(event) => { submit.reset(); setFit(event.target.value); }}
                        className={SELECT}
                    >
                        {FIT_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                                {option.label}
                            </option>
                        ))}
                    </select>
                </Field>

                <div className="flex flex-wrap gap-x-8 gap-y-5">
                    <fieldset className="flex flex-col gap-2">
                        <legend className="text-ui text-ink">Save as</legend>
                        <div className="flex flex-wrap gap-x-6 gap-y-2">
                            {FORMAT_OPTIONS.map((option) => (
                                <label key={option.value} className="flex items-center gap-2 text-ui text-ink">
                                    <input
                                        type="radio"
                                        name="signature-format"
                                        value={option.value}
                                        checked={format === option.value}
                                        onChange={() => { submit.reset(); setFormat(option.value); }}
                                        className={RADIO}
                                    />
                                    {option.label}
                                </label>
                            ))}
                        </div>
                    </fieldset>

                    <fieldset className="flex flex-col gap-2">
                        <legend className="text-ui text-ink">Background</legend>
                        <div className="flex flex-wrap gap-x-6 gap-y-2">
                            {BACKGROUNDS.map((option) => (
                                <label
                                    key={option.value}
                                    className={[
                                        'flex items-center gap-2 text-ui',
                                        keepsTransparency ? 'text-ink-muted' : 'text-ink',
                                    ].join(' ')}
                                >
                                    <input
                                        type="radio"
                                        name="signature-background"
                                        value={option.value}
                                        checked={background === option.value}
                                        disabled={keepsTransparency}
                                        onChange={() => { submit.reset(); setBackground(option.value); }}
                                        aria-describedby={BACKGROUND_HINT_ID}
                                        className={RADIO}
                                    />
                                    {option.label}
                                </label>
                            ))}
                        </div>
                        <p id={BACKGROUND_HINT_ID} className="text-micro text-ink-muted">
                            {keepsTransparency
                                ? 'PNG keeps transparency; nothing is filled in.'
                                : 'JPG cannot be transparent, so the area behind the signature is filled.'}
                        </p>
                    </fieldset>
                </div>

                <Field
                    id="signature-max-bytes"
                    label="Maximum file size (KB)"
                    hint={TARGET_HINT}
                    error={targetError}
                    className="sm:max-w-sm"
                >
                    <input
                        id="signature-max-bytes"
                        type="number"
                        inputMode="numeric"
                        min="1"
                        step="1"
                        placeholder="No limit"
                        value={maxKb}
                        onChange={(event) => { submit.reset(); setMaxKb(event.target.value); }}
                        aria-describedby={fieldDescribedBy('signature-max-bytes', {
                            hint: true,
                            error: targetError,
                        })}
                        className={CONTROL}
                    />
                </Field>
            </div>
        </div>
    );

    const source = entry ? (
        <div className="flex flex-col gap-5">
            <div className="checkerboard flex justify-center rounded-panel border border-line p-3">
                <div className="relative inline-block max-w-full">
                    {/* eslint-disable-next-line @next/next/no-img-element -- blob: URL from the visitor's own file; next/image cannot optimise it. */}
                    <img
                        src={entry.previewUrl}
                        alt={`Signature preview of ${entry.name}`}
                        className="block max-h-[380px] w-auto max-w-full"
                    />
                    <CropOverlay width={sourceWidth} height={sourceHeight} rect={rect} />
                </div>
            </div>

            <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 font-data text-micro text-ink-muted">
                <p>
                    Source <span className="text-ink">{sourceWidth}×{sourceHeight}</span>
                </p>
                <p>
                    Keeping <span className="text-ink">{rect.width}×{rect.height}</span> from x {rect.x}, y {rect.y}
                </p>
            </div>

            {/* A fieldset, not four loose fields: "Width" here and "Width (px)"
                in the settings are two different numbers, and the legend is what
                tells a screen-reader user which one they have landed on. */}
            <fieldset>
                <legend className="text-ui text-ink">Area to keep</legend>
                <div className="mt-2 grid grid-cols-2 gap-4 sm:grid-cols-4">
                    {CROP_FIELDS.map((field) => (
                        <Field
                            key={field.key}
                            id={`signature-crop-${field.key}`}
                            label={field.label}
                            hint={field.hint}
                        >
                            <input
                                id={`signature-crop-${field.key}`}
                                type="number"
                                inputMode="numeric"
                                min="0"
                                step="1"
                                value={rect[field.key]}
                                onChange={(event) => {
                                    submit.reset();
                                    setRect((current) => ({
                                        ...current,
                                        [field.key]: toPixels(event.target.value),
                                    }));
                                }}
                                aria-describedby={`signature-crop-${field.key}-hint`}
                                className={CONTROL}
                            />
                        </Field>
                    ))}
                </div>
            </fieldset>

            <div className="flex flex-wrap gap-3">
                <button
                    type="button"
                    onClick={handleWholeImage}
                    className="rounded-button border border-line px-3 py-2 text-ui text-ink transition-colors duration-120 ease-snap hover:bg-surface-sunken"
                >
                    Select the whole image
                </button>
                <button
                    type="button"
                    onClick={handleReset}
                    className="rounded-button border border-line px-3 py-2 text-ui text-ink transition-colors duration-120 ease-snap hover:bg-surface-sunken"
                >
                    Choose another image
                </button>
            </div>
        </div>
    ) : (
        <Dropzone
            id="signature-file"
            label="Drop a signature scan or photo here"
            constraints={upload.constraints}
            accept={upload.accept}
            state={upload.state}
            reason={upload.error}
            onFiles={handleFiles}
            onDragChange={upload.setDragging}
            disabled={upload.isReading}
        />
    );

    const panel = (
        <div className="flex flex-col gap-5">
            {source}
            {outputControls}
        </div>
    );

    const outcome = submit.result;

    /**
     * Every number here comes off the RESULT, never off the live form. The
     * settings and the four rectangle fields stay mounted and enabled after a
     * job, so reading them would make the panel describe a file that no longer
     * exists — /crop shipped exactly that and labelled a 1200×800 crop 400×800.
     */
    const result = outcome ? (
        <ResultPanel
            variant="single"
            previewUrl={preview.url}
            alt={`Signature made from ${entry?.name ?? 'your image'}`}
            filename={outcome.filename}
            originalBytes={outcome.originalBytes}
            resultBytes={outcome.resultBytes}
            width={outcome.width}
            height={outcome.height}
            onDownload={() => submit.download()}
            onReset={handleReset}
            downloadLabel="Download signature"
            footnote={describeResult(outcome, { width: entry?.width, height: entry?.height })}
        />
    ) : null;

    return (
        <ToolShell
            slug="signature-resizer"
            title={title}
            intro={intro}
            answer={answer}
            breadcrumb={breadcrumb}
            settingsLabel="Signature settings"
            settings={settings}
            panel={panel}
            error={submit.error ?? boundsError}
            action={(
                <ToolAction
                    label="Make signature"
                    // A byte ceiling puts the job through a search of up to
                    // eight encodes, and the bar ticks per probe — the label
                    // says what it is counting rather than leaving the extra
                    // seconds unexplained.
                    processingLabel={submit.phase === 'searching' ? 'Finding the size…' : 'Working…'}
                    isProcessing={submit.isProcessing}
                    progress={submit.progress}
                    disabled={!entry || Boolean(boundsError) || Boolean(sizeError) || Boolean(targetError)}
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
