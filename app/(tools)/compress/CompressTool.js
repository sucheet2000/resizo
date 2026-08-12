'use client';

/**
 * CompressTool
 *
 * Two honest ways to shrink a file, and the tool makes you pick one rather
 * than pretending a quality slider can hit a byte count:
 *
 *   quality  — the perceptual dial. On a JPEG or a WebP it is the encoder's
 *              quality. On a PNG it is palette quantisation, because PNG is
 *              lossless and the shipped libvips has no libimagequant, so the
 *              slider drives the colour count and the copy says exactly that.
 *   target   — a real byte target, posted as `targetBytes`. The server
 *              binary-searches the encoder and reports what it achieved.
 *
 * `preset` pre-selects the target mode for the /compress-image-to-NNNkb pages.
 */
import { useMemo, useState } from 'react';

import ResultPanel from '@/components/tools/ResultPanel';
import ToolShell, { ToolAction } from '@/components/tools/ToolShell';
import Dropzone from '@/components/ui/Dropzone';
import Field, { fieldDescribedBy } from '@/components/ui/Field';
import FilePreviewCard from '@/components/ui/FilePreviewCard';
import { DEFAULT_QUALITY, MAX_TARGET_BYTES, MIN_TARGET_BYTES } from '@/lib/constants';
import { formatFileSize } from '@/lib/format-bytes';
import useImageUpload from '@/lib/hooks/useImageUpload';
import usePreviewUrl from '@/lib/hooks/usePreviewUrl';
import useToolSubmit from '@/lib/hooks/useToolSubmit';

const CONTROL = 'w-full rounded-input border border-line bg-surface-raised px-3 py-2 font-data text-ui text-ink';

const UNIT_BYTES = { KB: 1024, MB: 1024 * 1024 };

const PNG_HINT = 'PNG compression reduces colours — best for graphics, not photos.';

const QUALITY_HINT = '80 is the web default. Below 50 the artefacts start to show.';

export default function CompressTool({
    preset,
    title = 'Compress Images Online',
    intro = 'Reduce a JPEG, PNG or WebP to a smaller file — by quality, or down to an exact size in KB.',
    breadcrumb,
    children,
}) {
    const [mode, setMode] = useState(preset?.targetKb ? 'target' : 'quality');
    const [quality, setQuality] = useState(DEFAULT_QUALITY);
    const [amount, setAmount] = useState(String(preset?.targetKb ?? 200));
    const [unit, setUnit] = useState('KB');

    const upload = useImageUpload();
    const preview = usePreviewUrl();
    const submit = useToolSubmit({
        endpoint: '/api/compress',
        onSuccess: (payload) => preview.show(payload.blob),
    });

    const entry = upload.file;
    const isPng = entry?.format === 'png';

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

    const handleFiles = (files) => {
        submit.reset();
        preview.clear();
        return upload.selectFiles(files);
    };

    const handleReset = () => {
        submit.reset();
        upload.clear();
        preview.clear();
    };

    const handleSubmit = () => {
        if (!entry || targetError) return;

        const form = new FormData();
        form.append('file', entry.file);
        if (mode === 'target') form.append('targetBytes', String(targetBytes));
        else form.append('quality', String(quality));

        submit.submit(form, { originalBytes: entry.size });
    };

    const qualityHint = isPng ? PNG_HINT : QUALITY_HINT;

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
                        onChange={(event) => setQuality(Number(event.target.value))}
                        aria-describedby={fieldDescribedBy('compress-quality', { hint: qualityHint })}
                        className="w-full accent-[var(--accent)]"
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

    const result = submit.result ? (
        <ResultPanel
            variant="single"
            previewUrl={preview.url}
            alt={`Compressed copy of ${entry?.name ?? 'your image'}`}
            filename={submit.result.filename}
            originalBytes={submit.result.originalBytes}
            resultBytes={submit.result.resultBytes}
            width={mode === 'quality' ? entry?.width : undefined}
            height={mode === 'quality' ? entry?.height : undefined}
            onDownload={() => submit.download()}
            onReset={handleReset}
            downloadLabel="Download compressed image"
            footnote={submit.result.targetBytes
                ? `Asked for ${formatFileSize(submit.result.targetBytes)} — the encoder landed on ${formatFileSize(submit.result.resultBytes)}.`
                : 'The image keeps its original format and dimensions.'}
        />
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
                    processingLabel="Compressing…"
                    isProcessing={submit.isProcessing}
                    progress={submit.progress}
                    disabled={!entry || Boolean(targetError)}
                    onClick={handleSubmit}
                />
            )}
            result={result}
        >
            {children}
        </ToolShell>
    );
}
