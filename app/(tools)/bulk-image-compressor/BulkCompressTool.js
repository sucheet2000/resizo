'use client';

/**
 * BulkCompressTool
 *
 * One maximum size in KB, a batch of JPEG, PNG and WebP files, and every file
 * gets its own attempt at that ceiling — because a screenshot and a busy photo
 * do not compress the same amount at the same quality, and averaging them
 * across a batch would hide exactly the file that needs the most help.
 *
 * TWO KINDS OF ROW, ONE LIST
 *
 * `hook.rows` are the engine's own settled outcomes: success, unmet (quality
 * alone could not reach the limit), unsafe (this device could not open it) or
 * cancelled. `rejected` never reached the engine at all — the wrong format, or
 * larger than this tool accepts outright — caught the moment the file was
 * dropped, by diffing what useImageUpload accepted against what came in. Both
 * render in the same Results list and count in the same summary, because a
 * visitor who dropped twenty files needs one place that accounts for all
 * twenty, including the ones that were never going to run.
 *
 * A rejection's wording is reconstructed from the same pure helpers
 * useImageUpload itself calls (`rejectReason.wrongType` / `rejectReason.tooLarge`)
 * rather than read back off `upload.error` after the fact: `selectFiles` sets
 * that state from inside an async function, and reading it from the closure
 * captured before the `await` would be one render behind. Recomputing it here
 * produces the identical sentence without the race.
 *
 * SETTINGS OUTLIVE A RESULT
 *
 * Changing the limit or the mode after a run does NOT clear what is on screen
 * — the rows are still real and still downloadable. It marks them stale
 * instead: a notice names the settings they were actually made with, and the
 * action relabels itself "Compress again" so nobody mistakes an old batch for
 * a fresh one.
 *
 * WHERE THE WORK HAPPENS
 *
 * Every file is read and re-encoded on this device, through useBulkCompress,
 * which puts the same capability gate in front of each file in turn. Nothing
 * is uploaded, so a device that cannot hold the batch is told so — via
 * assessBatchJob, before a single file is decoded — rather than left to find
 * out by watching the tab die.
 */
import { useEffect, useMemo, useRef, useState } from 'react';

import BatchRows from './BatchRows';
import ToolShell, { ToolAction } from '@/components/tools/ToolShell';
import Dropzone from '@/components/ui/Dropzone';
import Field, { fieldDescribedBy } from '@/components/ui/Field';
import FilePreviewCard from '@/components/ui/FilePreviewCard';
import PresetChips from '@/components/tools/PresetChips';
import { formatFileSize } from '@/lib/format/bytes';
import { checkBatchLimits, rejectReason } from '@/lib/format/upload-helpers';
import useImageUpload from '@/lib/hooks/useImageUpload';
import useBulkCompress from '@/lib/hooks/useBulkCompress';
import { assessBatchJob, refusalMessage } from '@/lib/image-client/capability';
import { MAX_BULK_FILES, MAX_BULK_TOTAL_BYTES, MAX_FILE_SIZE, RASTER_INPUT_FORMATS } from '@/lib/limits';
import {
    DEFAULT_LIMIT_KB,
    LIMIT_PRESETS,
    MAX_LIMIT_KB,
    MIN_LIMIT_KB,
    STATUS,
    limitLabel,
    parseLimitKb,
} from '@/lib/upload/compress-batch';

const CONTROL = 'w-full rounded-input border border-line bg-surface-raised px-3 py-2 font-data text-ui text-ink';

const GENERIC_UNSUPPORTED_MESSAGE = 'Not a JPEG, PNG or WebP.';

const PRESET_ITEMS = LIMIT_PRESETS.map((preset) => ({ id: String(preset.kb), label: preset.label, kb: preset.kb }));

const MODE_OPTIONS = [
    {
        value: 'preserve',
        label: 'Preserve dimensions',
        hint: 'Quality only. A file that can’t get under the limit at its size is reported, never resized.',
    },
    {
        value: 'fit',
        label: 'Fit under limit',
        hint: 'Quality first, then a smaller picture with the same shape, down to the smallest size Resizo allows.',
    },
];

const RETRYABLE_STATUSES = new Set([STATUS.unmet, STATUS.unsafe, STATUS.cancelled]);

/** A whole number with thousands separators — see the identical helper in compress-batch.js. */
function groupThousands(value) {
    return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function modeLabel(mode) {
    return MODE_OPTIONS.find((option) => option.value === mode)?.label ?? MODE_OPTIONS[0].label;
}

/**
 * Why ONE bounced file did not reach the engine, in the same words
 * useImageUpload itself would have used for it. Size is checked first because
 * that is the order buildEntry checks in: a file that is both the wrong
 * format AND too large is, correctly, "too large" — that is the sentence a
 * person can act on without also being told the format is wrong on a file
 * they are about to discard anyway.
 */
function classifyRejection(file) {
    const size = Number(file?.size) || 0;

    if (size > MAX_FILE_SIZE) {
        return { status: STATUS.unsafe, error: rejectReason.tooLarge(size, MAX_FILE_SIZE) };
    }

    return { status: STATUS.unsupported, error: rejectReason.wrongType(RASTER_INPUT_FORMATS) };
}

export default function BulkCompressTool({
    title = 'Compress Many Images to a Maximum File Size',
    intro = 'Pick a maximum size in KB, drop a batch of JPEG, PNG or WebP photos, and each one is compressed '
        + 'to fit on its own. Nothing is uploaded.',
    answer,
    breadcrumb,
    children,
}) {
    const [mode, setMode] = useState(MODE_OPTIONS[0].value);
    const [presetKb, setPresetKb] = useState(DEFAULT_LIMIT_KB);
    const [limitText, setLimitText] = useState(String(DEFAULT_LIMIT_KB));
    const [rejected, setRejected] = useState([]);

    const rejectedSeq = useRef(0);
    const itemsRef = useRef([]);
    const summaryHeadingRef = useRef(null);
    const wasProcessingRef = useRef(false);

    const upload = useImageUpload({ accept: RASTER_INPUT_FORMATS, multiple: true, maxFiles: MAX_BULK_FILES });
    const hook = useBulkCompress();

    const parsedLimit = useMemo(() => parseLimitKb(limitText), [limitText]);
    const limitError = parsedLimit.ok ? null : parsedLimit.error;
    const targetBytes = parsedLimit.ok ? parsedLimit.bytes : null;

    const batchAssessment = useMemo(() => {
        if (upload.files.length === 0) return null;
        return assessBatchJob({
            files: upload.files.map((entry) => ({
                fileBytes: entry.size,
                sourceWidth: entry.width,
                sourceHeight: entry.height,
            })),
            format: 'original',
            operation: 'compress',
        });
    }, [upload.files]);

    const batchError = batchAssessment && !batchAssessment.ok ? refusalMessage(batchAssessment) : null;

    /** Adds a {id, name, status, error} row for every incoming file useImageUpload did not accept. */
    function registerRejections(incoming, accepted) {
        const acceptedFiles = new Set(accepted.map((entry) => entry.file));
        const newlyRejected = incoming.filter((file) => !acceptedFiles.has(file));
        if (newlyRejected.length === 0) return;

        setRejected((current) => [
            ...current,
            ...newlyRejected.map((file, index) => {
                rejectedSeq.current += 1;
                const classified = classifyRejection(file);
                return {
                    id: `rejected-${rejectedSeq.current}`,
                    name: file.name,
                    status: classified.status,
                    error: index === 0 ? classified.error : GENERIC_UNSUPPORTED_MESSAGE,
                };
            }),
        ]);
    }

    const handleFiles = async (files) => {
        const incoming = Array.from(files ?? []);
        const existingBytes = upload.files.reduce((sum, entry) => sum + (Number(entry.size) || 0), 0);
        const incomingBytes = incoming.reduce((sum, file) => sum + (Number(file.size) || 0), 0);

        // A whole-batch limit (too many files, or too many bytes) is refused
        // outright by useImageUpload — none of `incoming` is even attempted —
        // and Dropzone already shows that sentence via `upload.error`. Diffing
        // against an empty `accepted` in that case would mislabel every one of
        // those files as individually unsupported or unsafe, which is not why
        // any of them was refused.
        const batchLimitHit = Boolean(checkBatchLimits({
            incomingCount: incoming.length,
            existingCount: upload.files.length,
            incomingBytes,
            existingBytes,
            maxFiles: MAX_BULK_FILES,
            maxTotalBytes: MAX_BULK_TOTAL_BYTES,
        }));

        const accepted = await upload.selectFiles(incoming);
        if (!batchLimitHit) registerRejections(incoming, accepted);
    };

    const handleFolderFiles = async (files) => {
        await upload.selectFolder(Array.from(files ?? []));
    };

    const n = upload.files.length;
    // What the button counts is what was DROPPED, not just what can run — a
    // batch of three where one is unsupported is still the batch of three the
    // visitor handed over, and the Results list right below it says which one
    // did not make it. This is the same count "Selected" uses in the summary.
    const selectedCount = n + rejected.length;

    const isStale = Boolean(hook.settings)
        && (hook.settings.targetBytes !== targetBytes || hook.settings.mode !== mode);

    const actionLabel = isStale
        ? 'Compress again'
        : (selectedCount === 1 ? 'Compress 1 image' : `Compress ${selectedCount} images`);

    const actionDisabled = n === 0 || Boolean(limitError) || Boolean(batchError) || upload.isReading;

    const handleSubmit = () => {
        if (actionDisabled || !targetBytes) return;

        const items = upload.files.map((entry) => ({
            id: entry.id,
            name: entry.relativePath || entry.name,
            file: entry.file,
            folder: entry.folder ?? null,
            sourceWidth: entry.width,
            sourceHeight: entry.height,
            format: entry.format,
        }));

        itemsRef.current = items;
        hook.run(items, { targetBytes, mode });
    };

    const retryCount = useMemo(
        () => hook.rows.filter((row) => RETRYABLE_STATUSES.has(row.status)).length,
        [hook.rows],
    );

    const handleRetry = () => {
        if (!targetBytes) return;
        hook.retry(itemsRef.current, { targetBytes, mode });
    };

    const handleStartOver = () => {
        hook.reset();
        upload.clear();
        setRejected([]);
    };

    const combinedSummary = useMemo(() => {
        const base = hook.summary;
        const rejectedUnsupported = rejected.filter((row) => row.status === STATUS.unsupported).length;
        const rejectedUnsafe = rejected.filter((row) => row.status === STATUS.unsafe).length;

        return {
            ...base,
            // "Selected" is what is currently in the batch — queued plus
            // bounced — which is true before, during and after a run. It is
            // deliberately NOT base.selected: the engine's own count is only
            // as many rows as the last run() call seeded, which is stale the
            // moment a file is added afterwards.
            selected: selectedCount,
            unsupported: base.unsupported + rejectedUnsupported,
            unsafe: base.unsafe + rejectedUnsafe,
        };
    }, [hook.summary, selectedCount, rejected]);

    const displayRows = useMemo(() => [...hook.rows, ...rejected], [hook.rows, rejected]);
    const hasResults = displayRows.length > 0;

    // Focus the payoff once a run actually finishes — not on every render
    // while it settles, and not for the rejections-only case where no run has
    // happened at all.
    useEffect(() => {
        if (wasProcessingRef.current && !hook.isProcessing && hook.rows.length > 0) {
            summaryHeadingRef.current?.focus();
        }
        wasProcessingRef.current = hook.isProcessing;
    }, [hook.isProcessing, hook.rows.length]);

    /**
     * The drop zone comes FIRST in this panel, settings after it — the
     * opposite of DESIGN.md's usual "settings above the drop zone" rule,
     * and for the same reason CompressTool's own policy fieldset sits below
     * its drop zone rather than above: three settings groups (chips, a
     * custom-KB field, a two-radio fieldset with a wrapped hint each) are
     * enough copy to push the drop zone off the fold, which is the one thing
     * DESIGN.md never trades away — "the tool is the hero… above the fold on
     * a mid-tier Android phone, zero scrolling". Measured on this page:
     * with settings above, the drop zone's top sat at 950px on a 1280×900
     * desktop viewport and 771px on a 390×844 phone — both off screen.
     */
    const panel = (
        <div className="flex flex-col gap-5">
            <Dropzone
                id="bulk-compress-file"
                multiple
                label={n > 0 ? 'Drop more images here' : `Drop up to ${MAX_BULK_FILES} images here`}
                browseLabel={n > 0 ? 'Add more images' : 'Choose images'}
                folderLabel="Choose a folder"
                constraints={upload.constraints}
                accept={upload.accept}
                state={upload.state}
                reason={upload.error}
                onFiles={handleFiles}
                onFolderFiles={handleFolderFiles}
                onDragChange={upload.setDragging}
                disabled={upload.isReading || hook.isProcessing}
            >
                {upload.notice ? (
                    <p role="status" className="max-w-[52ch] text-ui text-ink-muted">
                        {upload.notice}
                    </p>
                ) : null}
            </Dropzone>

            {n > 0 ? (
                <ul className="grid gap-2 sm:grid-cols-2">
                    {upload.files.map((entry) => (
                        <li key={entry.id}>
                            <FilePreviewCard
                                name={entry.name}
                                size={entry.size}
                                format={entry.format}
                                width={entry.width}
                                height={entry.height}
                                previewUrl={entry.previewUrl}
                                onRemove={hook.isProcessing ? undefined : () => upload.removeFile(entry.id)}
                                removeLabel="Remove"
                            />
                        </li>
                    ))}
                </ul>
            ) : null}

            <PresetChips
                label="Maximum size per image"
                items={PRESET_ITEMS}
                value={presetKb !== null ? String(presetKb) : null}
                onSelect={(item) => {
                    if (!item) {
                        setPresetKb(null);
                        return;
                    }
                    setPresetKb(item.kb);
                    setLimitText(String(item.kb));
                }}
            />

            <Field
                id="bulk-compress-limit"
                label="Custom limit (KB)"
                hint={`1 KB = 1,024 bytes. Between ${groupThousands(MIN_LIMIT_KB)} KB and ${groupThousands(MAX_LIMIT_KB)} KB.`}
                error={limitError}
                className="max-w-xs"
            >
                <input
                    id="bulk-compress-limit"
                    type="number"
                    inputMode="numeric"
                    min={MIN_LIMIT_KB}
                    max={MAX_LIMIT_KB}
                    value={limitText}
                    onChange={(event) => {
                        setLimitText(event.target.value);
                        setPresetKb(null);
                    }}
                    aria-describedby={fieldDescribedBy('bulk-compress-limit', { hint: true, error: limitError })}
                    aria-invalid={limitError ? true : undefined}
                    className={CONTROL}
                />
            </Field>

            <fieldset className="flex flex-col gap-3">
                <legend className="text-ui text-ink">If the limit cannot be reached at full size</legend>
                {MODE_OPTIONS.map((option) => {
                    const optionId = `bulk-compress-mode-${option.value}`;
                    return (
                        <div key={option.value} className="flex flex-col gap-1">
                            <label htmlFor={optionId} className="flex items-start gap-2 text-ui text-ink">
                                <input
                                    id={optionId}
                                    type="radio"
                                    name="bulk-compress-mode"
                                    value={option.value}
                                    checked={mode === option.value}
                                    onChange={() => setMode(option.value)}
                                    aria-describedby={`${optionId}-hint`}
                                    className="mt-1 size-4 shrink-0 accent-[var(--accent)]"
                                />
                                {option.label}
                            </label>
                            <p id={`${optionId}-hint`} className="pl-6 text-micro text-ink-muted">
                                {option.hint}
                            </p>
                        </div>
                    );
                })}
            </fieldset>
        </div>
    );

    const action = (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
            <ToolAction
                label={actionLabel}
                processingLabel="Compressing…"
                isProcessing={hook.isProcessing}
                progress={hook.progress}
                disabled={actionDisabled}
                onClick={handleSubmit}
                hint={n === 0 ? 'Add images to turn this on.' : undefined}
                className="flex-1"
            />
            {hook.isProcessing ? (
                <button
                    type="button"
                    onClick={hook.cancel}
                    className="inline-flex w-full items-center justify-center rounded-button border border-line px-5 py-3 text-base font-semibold text-ink transition-colors duration-120 ease-snap hover:bg-surface-sunken sm:w-auto"
                >
                    Stop
                </button>
            ) : null}
        </div>
    );

    const progressText = hook.isProcessing
        ? `${hook.counts.settled} of ${hook.counts.total} done`
            + (hook.counts.current ? ` · Compressing ${hook.counts.current}` : '')
        : `${hook.summary.successful} of ${hook.summary.selected} compressed`;

    const result = hasResults ? (
        <div className="flex flex-col gap-6">
            {hook.rows.length > 0 ? (
                <p role="status" aria-live="polite" className="text-ui text-ink">
                    {progressText}
                </p>
            ) : null}

            {isStale ? (
                <p role="status" data-stale className="text-ui text-ink-muted">
                    {`These results were made with ${limitLabel(hook.settings.targetBytes)} · `
                        + `${modeLabel(hook.settings.mode)}. Press Compress again to apply your new settings.`}
                </p>
            ) : null}

            <BatchRows rows={displayRows} onDownload={hook.downloadOne} />

            {!hook.isProcessing ? (
                <section
                    aria-labelledby="bulk-compress-summary-heading"
                    aria-live="polite"
                    className="rounded-panel border border-line bg-surface-raised p-4"
                >
                    <h2
                        id="bulk-compress-summary-heading"
                        ref={summaryHeadingRef}
                        tabIndex={-1}
                        className="font-display text-title font-bold tracking-tight text-ink focus:outline-none"
                    >
                        Batch summary
                    </h2>

                    {combinedSummary.reductionPercent !== null ? (
                        <p className="mt-2 font-display text-lead font-bold text-ink">
                            {'You saved '}
                            <span className="font-data text-accent">{formatFileSize(combinedSummary.savedBytes)}</span>
                            {' — '}
                            {/* The unsigned percent from summarize(): this sentence already
                                says "smaller", so the per-row minus sign (formatSavings)
                                would read as a double negative — "−88% smaller". */}
                            <span className="font-data text-accent">{combinedSummary.reductionPercent}%</span>
                            {' smaller'}
                        </p>
                    ) : null}

                    <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 font-data text-ui sm:grid-cols-3">
                        {[
                            ['Selected', combinedSummary.selected],
                            ['Successful', combinedSummary.successful],
                            ['Could not meet target', combinedSummary.unmet],
                            ['Unsupported', combinedSummary.unsupported],
                            ['Too large for this device', combinedSummary.unsafe],
                            ['Cancelled', combinedSummary.cancelled],
                            ['Total before', formatFileSize(combinedSummary.inputBytes)],
                            ['Total after', formatFileSize(combinedSummary.outputBytes)],
                            ['Saved', formatFileSize(combinedSummary.savedBytes)],
                            ['Reduction', combinedSummary.reductionPercent !== null ? `${combinedSummary.reductionPercent}%` : '—'],
                        ].map(([label, value]) => (
                            <div key={label}>
                                <dt className="text-ink-muted">{label}</dt>
                                <dd className="text-ink">{value}</dd>
                            </div>
                        ))}
                    </dl>

                    <div className="mt-4 flex flex-wrap items-center gap-3">
                        {combinedSummary.successful > 0 ? (
                            <button
                                type="button"
                                onClick={hook.downloadZip}
                                className="inline-flex items-center justify-center gap-2 rounded-button bg-accent px-5 py-3 text-base font-semibold text-accent-ink transition-[filter] duration-180 ease-snap hover:brightness-95"
                            >
                                {`Download all as ZIP (${combinedSummary.successful})`}
                            </button>
                        ) : null}

                        {retryCount > 0 ? (
                            <button
                                type="button"
                                onClick={handleRetry}
                                className="rounded-button border border-line px-4 py-3 text-base text-ink transition-colors duration-120 ease-snap hover:bg-surface-sunken"
                            >
                                {`Retry failed (${retryCount})`}
                            </button>
                        ) : null}

                        <button
                            type="button"
                            onClick={handleStartOver}
                            className="rounded-button border border-line px-4 py-3 text-base text-ink transition-colors duration-120 ease-snap hover:bg-surface-sunken"
                        >
                            Start over
                        </button>
                    </div>

                    {hook.zipError ? <p role="alert">{hook.zipError}</p> : null}
                </section>
            ) : null}
        </div>
    ) : null;

    return (
        <ToolShell
            slug="bulk-image-compressor"
            title={title}
            intro={intro}
            answer={answer}
            breadcrumb={breadcrumb}
            panel={panel}
            error={batchError}
            action={action}
            result={result}
            keepActionWithResult
        >
            {children}
        </ToolShell>
    );
}
