'use client';

/**
 * CompressTool
 *
 * Two honest ways to shrink a file, and the tool makes you pick one rather
 * than pretending a quality slider can hit a byte count:
 *
 *   quality  — the perceptual dial. On a JPEG or a WebP it is the encoder's
 *              quality.
 *   target   — a real byte target, posted as `targetBytes`. The encoder is
 *              measured and the tool reports what it actually achieved.
 *
 * `preset` pre-selects the target mode for the /compress-image-to-NNNkb pages.
 *
 * WHERE THE COMPRESSION HAPPENS
 *
 * On this device, through useLocalProcess, and nowhere else. Nothing is
 * uploaded, so a file the device cannot handle is refused in the capability
 * gate's own words rather than sent somewhere it might have worked.
 *
 * THE PNG PROBLEM, AND WHY THIS PAGE TALKS ABOUT IT
 *
 * A browser has no PNG colour quantiser. The server shrank a PNG by reducing
 * its palette; @jsquash/png is lossless with no such knob, which makes two
 * things newly true on this page and both of them are stated out loud rather
 * than papered over:
 *
 *   1. The quality slider cannot change a PNG's size at all. It is disabled,
 *      and it says why. Letting it slide while nothing happens is the lie this
 *      page refuses to tell.
 *   2. A byte target cannot be reached by compression alone. The only lever
 *      left would be pixels, and shrinking the PICTURE is not what somebody
 *      asking for a smaller FILE asked for — measured, a 499 KB PNG asked for
 *      20 KB came back at 13% scale, 800x600 turned into 104x78.
 *
 * So the page offers WebP instead, in one tap, and says why. That is a genuine
 * upgrade rather than an apology: libwebp has a native target-size mode, so a
 * WebP byte target is one encode where JPEG needs a bounded search of up to
 * eight, and WebP keeps the transparency a PNG is likely to be carrying.
 *
 * Decline the offer and the PNG still runs — at FULL RESOLUTION, at the
 * smallest size a lossless encoder can reach — and if that misses the target
 * the result says so in as many words. Never a silent thumbnail.
 *
 * This used to be conditional: the page asked the capability gate whether the
 * file would run here before claiming any of it, because the server had a
 * quantiser and would have had no such limitation. There is no server, so the
 * limitation is unconditional and the page states it plainly.
 */
import { useMemo, useState } from 'react';

import ResultPanel from '@/components/tools/ResultPanel';
import ToolShell, { ToolAction } from '@/components/tools/ToolShell';
import Alert from '@/components/ui/Alert';
import Dropzone from '@/components/ui/Dropzone';
import Field, { fieldDescribedBy } from '@/components/ui/Field';
import FilePreviewCard from '@/components/ui/FilePreviewCard';
import { DEFAULT_QUALITY, MAX_TARGET_BYTES, MIN_TARGET_BYTES } from '@/lib/constants';
import { formatFileSize } from '@/lib/format-bytes';
import { formatLabel } from '@/lib/hooks/upload-helpers';
import useImageUpload from '@/lib/hooks/useImageUpload';
import useLocalProcess from '@/lib/hooks/useLocalProcess';
import usePreviewUrl from '@/lib/hooks/usePreviewUrl';
import { reachesTargetBytes, TARGET_FALLBACK_FORMAT } from '@/lib/image-client/compress-target';
import { formatSupportsQuality } from '@/lib/image-client/encode';

const CONTROL = 'w-full rounded-input border border-line bg-surface-raised px-3 py-2 font-data text-ui text-ink';

const UNIT_BYTES = { KB: 1024, MB: 1024 * 1024 };

/** The sentinel the engine reads as "whatever came in", same word bulk uses. */
const SOURCE_FORMAT = 'original';

const FALLBACK_LABEL = formatLabel(TARGET_FALLBACK_FORMAT);

const QUALITY_HINT = '80 is the web default. Below 50 the artefacts start to show.';

const LINK = 'font-semibold text-accent underline underline-offset-2 transition-opacity duration-120 ease-snap hover:opacity-80';

function InlineButton({ children, ...rest }) {
    return (
        <button type="button" className={LINK} {...rest}>
            {children}
        </button>
    );
}

export default function CompressTool({
    preset,
    title = 'Compress Images Online',
    intro = 'Reduce a JPEG, PNG or WebP to a smaller file — by quality, or down to an exact size in KB. Nothing is uploaded.',
    breadcrumb,
    children,
}) {
    const [mode, setMode] = useState(preset?.targetKb ? 'target' : 'quality');
    const [quality, setQuality] = useState(DEFAULT_QUALITY);
    const [amount, setAmount] = useState(String(preset?.targetKb ?? 200));
    const [unit, setUnit] = useState('KB');
    const [outputFormat, setOutputFormat] = useState(SOURCE_FORMAT);

    const upload = useImageUpload();
    const preview = usePreviewUrl();
    const submit = useLocalProcess({
        op: 'compress',
        onSuccess: (payload) => preview.show(payload.blob),
    });

    const entry = upload.file;
    const sourceFormat = entry?.format ?? null;
    const wantsFallback = outputFormat === TARGET_FALLBACK_FORMAT;

    const targetBytes = useMemo(() => {
        const value = Number(amount);
        if (!Number.isFinite(value) || value <= 0) return null;
        return Math.round(value * UNIT_BYTES[unit]);
    }, [amount, unit]);

    const targetError = mode === 'target' && (targetBytes === null
        || targetBytes < MIN_TARGET_BYTES
        || targetBytes > MAX_TARGET_BYTES)
        ? `Pick a target between ${formatFileSize(MIN_TARGET_BYTES)} and ${formatFileSize(MAX_TARGET_BYTES)}.`
        : null;

    // The two things a browser cannot do to the source format, asked of the
    // engine's own predicates rather than restated as a list of format names.
    const qualityIsInert = Boolean(sourceFormat) && !wantsFallback
        && !formatSupportsQuality(sourceFormat);
    const targetNeedsFallback = Boolean(sourceFormat) && !wantsFallback
        && !reachesTargetBytes(sourceFormat);

    // In target mode the offer quotes the number that was typed, so it waits
    // until that number is a real one rather than advertising a nonsense size.
    const offerFallback = mode === 'quality' ? qualityIsInert : (targetNeedsFallback && !targetError);
    const sourceLabel = sourceFormat ? formatLabel(sourceFormat) : 'this format';
    const dimensions = entry?.width && entry?.height ? `${entry.width}×${entry.height}` : null;

    const handleFiles = (files) => {
        submit.reset();
        preview.clear();
        setOutputFormat(SOURCE_FORMAT);
        return upload.selectFiles(files);
    };

    const handleReset = () => {
        submit.reset();
        upload.clear();
        preview.clear();
        setOutputFormat(SOURCE_FORMAT);
    };

    const chooseFallback = () => {
        submit.reset();
        preview.clear();
        setOutputFormat(TARGET_FALLBACK_FORMAT);
    };

    const chooseSourceFormat = () => {
        submit.reset();
        preview.clear();
        setOutputFormat(SOURCE_FORMAT);
    };

    const handleSubmit = () => {
        if (!entry || targetError) return;

        const form = new FormData();
        form.append('file', entry.file);
        if (mode === 'target') form.append('targetBytes', String(targetBytes));
        else form.append('quality', String(quality));
        if (wantsFallback) form.append('output_format', TARGET_FALLBACK_FORMAT);

        submit.submit(form, {
            originalBytes: entry.size,
            sourceWidth: entry.width,
            sourceHeight: entry.height,
        });
    };

    const formatNote = offerFallback ? (
        <Alert tone="info">
            {mode === 'quality'
                ? `${sourceLabel} is lossless and nothing here can reduce its colours, so this slider cannot change the file size. `
                : `${sourceLabel} is lossless and nothing here can reduce its colours, so the only way to reach ${formatFileSize(targetBytes)} would be to shrink the picture itself. `}
            {mode === 'quality'
                ? `${FALLBACK_LABEL} gives you a working quality dial and keeps transparency. `
                : `${FALLBACK_LABEL} can reach an exact size${dimensions ? ` at the full ${dimensions}` : ' at full resolution'}, and keeps transparency. `}
            <InlineButton onClick={chooseFallback}>
                Save it as {FALLBACK_LABEL} instead
            </InlineButton>
        </Alert>
    ) : (wantsFallback ? (
        <Alert tone="info">
            {`Saving as ${FALLBACK_LABEL} at the original dimensions. `}
            <InlineButton onClick={chooseSourceFormat}>
                Keep {sourceLabel} instead
            </InlineButton>
        </Alert>
    ) : null);

    const qualityHint = qualityIsInert
        ? `${sourceLabel} is lossless here, so this dial is off.`
        : QUALITY_HINT;

    const settings = (
        <div className="flex flex-col gap-5">
            <fieldset className="flex flex-col gap-2">
                <legend className="text-ui text-ink">How to compress</legend>
                <div className="flex flex-wrap gap-x-6 gap-y-2">
                    {[
                        { value: 'quality', label: 'By quality' },
                        { value: 'target', label: 'To a target size' },
                    ].map((option) => (
                        <label key={option.value} className="flex items-center gap-2 text-ui text-ink">
                            <input
                                type="radio"
                                name="compress-mode"
                                value={option.value}
                                checked={mode === option.value}
                                onChange={() => setMode(option.value)}
                                className="size-4 accent-[var(--accent)]"
                            />
                            {option.label}
                        </label>
                    ))}
                </div>
            </fieldset>

            {mode === 'quality' ? (
                <Field
                    id="compress-quality"
                    label={<>Quality <span className="font-data text-accent">{quality}</span></>}
                    hint={qualityHint}
                >
                    <input
                        id="compress-quality"
                        type="range"
                        min="1"
                        max="100"
                        step="1"
                        value={quality}
                        disabled={qualityIsInert}
                        onChange={(event) => setQuality(Number(event.target.value))}
                        aria-describedby={fieldDescribedBy('compress-quality', { hint: qualityHint })}
                        className="w-full accent-[var(--accent)] disabled:opacity-50"
                    />
                </Field>
            ) : (
                <Field
                    id="compress-target"
                    label="Target size"
                    hint="The result lands at or just under this size."
                    error={targetError}
                    className="max-w-xs"
                    suffix={(
                        <select
                            id="compress-target-unit"
                            aria-label="Target size unit"
                            value={unit}
                            onChange={(event) => setUnit(event.target.value)}
                            className="rounded-input border border-line bg-surface-raised px-2 py-2 font-data text-ui text-ink"
                        >
                            <option value="KB">KB</option>
                            <option value="MB">MB</option>
                        </select>
                    )}
                >
                    <input
                        id="compress-target"
                        type="number"
                        inputMode="numeric"
                        min="1"
                        step="1"
                        value={amount}
                        onChange={(event) => setAmount(event.target.value)}
                        aria-describedby={fieldDescribedBy('compress-target', {
                            hint: true,
                            error: targetError,
                        })}
                        className={CONTROL}
                    />
                </Field>
            )}

            {formatNote}
        </div>
    );

    const panel = entry ? (
        <FilePreviewCard
            name={entry.name}
            size={entry.size}
            format={entry.format}
            width={entry.width}
            height={entry.height}
            previewUrl={entry.previewUrl}
            onRemove={handleReset}
        />
    ) : (
        <Dropzone
            id="compress-file"
            label="Drop an image here"
            constraints={upload.constraints}
            accept={upload.accept}
            state={upload.state}
            reason={upload.error}
            onFiles={handleFiles}
            onDragChange={upload.setDragging}
            disabled={upload.isReading}
        />
    );

    const outcome = submit.result;
    // Only ever false for a PNG that was asked for a byte target the lossless
    // encoder could not reach.
    const targetMissed = Boolean(outcome?.targetBytes) && outcome.targetMet === false;

    const footnote = (() => {
        if (!outcome) return null;
        if (targetMissed) {
            return `${formatLabel(outcome.format)} is lossless and nothing here can reduce its colours, so ${outcome.width}×${outcome.height} `
                + `does not go below ${formatFileSize(outcome.resultBytes)} — the ${formatFileSize(outcome.targetBytes)} `
                + 'target was not met, and the picture was left at its full size rather than shrunk to fake a hit.';
        }
        if (outcome.targetBytes) {
            return `Asked for ${formatFileSize(outcome.targetBytes)} — the encoder landed on ${formatFileSize(outcome.resultBytes)}, `
                + `at the original ${outcome.width}×${outcome.height}.`;
        }
        if (outcome.format && outcome.sourceFormat && outcome.format !== outcome.sourceFormat) {
            return `Saved as ${formatLabel(outcome.format)} at the original dimensions.`;
        }
        return 'The image keeps its original format and dimensions.';
    })();

    const result = outcome ? (
        <div className="flex flex-col gap-4">
            {targetMissed ? (
                <Alert tone="info">
                    {`The ${formatFileSize(outcome.targetBytes)} target was not met. `}
                    <InlineButton onClick={chooseFallback}>
                        Save it as {FALLBACK_LABEL} instead
                    </InlineButton>
                    {` to reach ${formatFileSize(outcome.targetBytes)} at the full ${outcome.width}×${outcome.height}.`}
                </Alert>
            ) : null}

            <ResultPanel
                variant="single"
                previewUrl={preview.url}
                alt={`Compressed copy of ${entry?.name ?? 'your image'}`}
                filename={outcome.filename}
                originalBytes={outcome.originalBytes}
                resultBytes={outcome.resultBytes}
                width={outcome.width ?? (mode === 'quality' ? entry?.width : undefined)}
                height={outcome.height ?? (mode === 'quality' ? entry?.height : undefined)}
                onDownload={() => submit.download()}
                onReset={handleReset}
                downloadLabel="Download compressed image"
                footnote={footnote}
            />
        </div>
    ) : null;

    return (
        <ToolShell
            slug="compress"
            title={title}
            intro={intro}
            breadcrumb={breadcrumb}
            settingsLabel="Compression settings"
            settings={settings}
            panel={panel}
            error={submit.error}
            action={(
                <ToolAction
                    label="Compress image"
                    // The exact-size search is the slowest job on the site and it
                    // reports every probe, so the label says what the bar is
                    // counting rather than leaving eight encodes unexplained.
                    processingLabel={submit.phase === 'searching' ? 'Finding the exact size…' : 'Compressing…'}
                    isProcessing={submit.isProcessing}
                    progress={submit.progress}
                    disabled={!entry || Boolean(targetError)}
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
