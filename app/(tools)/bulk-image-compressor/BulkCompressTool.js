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
import BatchProgress from '@/components/tools/batch/BatchProgress';
import BatchSummary from '@/components/tools/batch/BatchSummary';
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

const HEIC_MESSAGE = 'HEIC isn’t accepted in a batch. Convert it to JPEG first with the HEIC converter at /heic, then add it here.';

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

    if (looksLikeHeic(file)) {
        return { status: STATUS.unsupported, error: HEIC_MESSAGE };
    }

    return { status: STATUS.unsupported, error: rejectReason.wrongType(RASTER_INPUT_FORMATS) };
}

/**
 * A HEIC is refused by the batch, but it is the one refusal with a next step:
 * the converter turns it into a JPEG this tool takes. Judged by name and
 * declared type only — the file was never opened, and the sentence is a
 * pointer, not a verdict on its bytes.
 */
function looksLikeHeic(file) {
    const name = String(file?.name ?? '').toLowerCase();
    const type = String(file?.type ?? '').toLowerCase();
    return /\.hei[cf]$/.test(name) || type === 'image/heic' || type === 'image/heif';
}

/**
 * Removing a card or starting over both take the just-activated control out
 * of the document, which drops focus to <body> with nothing announced. The
 * browse button is the one control in this panel that survives every one of
 * those changes, so it is where focus goes back to either way.
 */
function focusBrowseButton() {
    document.getElementById('bulk-compress-file-browse')?.focus();
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

    /**
     * Adds a {id, name, status, error} row for every incoming file
     * useImageUpload did not accept — each with ITS OWN reason from
     * classifyRejection, never a shared placeholder. A second oversized file
     * in the same drop is "too large", not "not a JPEG" — the two rejections
     * do not become truer or falser depending on which one happened to land
     * first.
     */
    function registerRejections(incoming, accepted) {
        const acceptedFiles = new Set(accepted.map((entry) => entry.file));
        const newlyRejected = incoming.filter((file) => !acceptedFiles.has(file));
        if (newlyRejected.length === 0) return;

        setRejected((current) => [
            ...current,
            ...newlyRejected.map((file) => {
                rejectedSeq.current += 1;
                const classified = classifyRejection(file);
                return {
                    id: `rejected-${rejectedSeq.current}`,
                    name: file.name,
                    status: classified.status,
                    error: classified.error,
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
    // "Selected" in the summary counts what was DROPPED — accepted plus
    // rejected — because a batch of three where one is unsupported is still
    // the batch of three the visitor handed over. The action button counts
    // the other thing: how many will actually run, which is `n` alone.
    const selectedCount = n + rejected.length;

    const settingsChanged = Boolean(hook.settings)
        && (hook.settings.targetBytes !== targetBytes || hook.settings.mode !== mode);

    // Not memoised: it is a handful of id comparisons, run on every render,
    // against a ref rather than state — memoising it against `itemsRef`
    // would either miss updates (refs are not reactive) or need its own
    // effect to keep in sync for no real cost saved.
    const currentFileIds = new Set(upload.files.map((entry) => entry.id));
    const selectionChanged = Boolean(hook.settings) && (
        itemsRef.current.length !== currentFileIds.size
        || itemsRef.current.some((item) => !currentFileIds.has(item.id))
    );

    // A retry redoes only the rows that could still change, so a limit or
    // mode changed AFTER the first run leaves some rows at the OLD setting
    // and some at the NEW one — hook.settings is only ever the latest of the
    // two, so it can equal the current controls while a row on screen still
    // does not. Checked directly against the rows themselves, not against
    // hook.settings, because that is the only place the disagreement is
    // actually visible.
    const mixedRowSettings = hook.rows.length > 1 && hook.rows.some(
        (row) => row.targetBytes !== hook.rows[0].targetBytes || row.mode !== hook.rows[0].mode,
    );

    const isStale = settingsChanged || selectionChanged || mixedRowSettings;

    const actionLabel = isStale
        ? 'Compress again'
        : (n === 1 ? 'Compress 1 image' : `Compress ${n} images`);

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
        focusBrowseButton();
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

    // A file accepted AFTER the last run has no hook row at all — the engine
    // has never heard of it — which used to mean it had no row anywhere on
    // screen either, while "Selected" and the action label already counted
    // it. Synthesised here as a plain 'waiting' row, once a run has actually
    // happened (never before one — see the "before any run" contract below),
    // placed after the real hook rows and before the rejections.
    //
    // Matched by id ONLY. Two files can share a name — the same photo added
    // twice, or two IMG_0001.jpg from different folders — and matching by
    // name too would make the second one invisible, which is the exact bug
    // this row exists to fix. Production ids always agree end to end
    // (handleSubmit hands the engine the same id useImageUpload gave the
    // entry, and a row keeps it), so id alone is both correct and sufficient.
    const hookRowIds = new Set(hook.rows.map((row) => row.id));
    const pendingRows = hook.settings !== null
        ? upload.files
            .filter((entry) => !hookRowIds.has(entry.id))
            .map((entry) => ({
                id: entry.id,
                name: entry.relativePath || entry.name,
                folder: entry.folder ?? null,
                status: STATUS.waiting,
                originalBytes: entry.size,
                resultBytes: null,
                width: null,
                height: null,
                sourceWidth: entry.width,
                sourceHeight: entry.height,
                format: entry.format,
                targetBytes,
                mode,
                filename: null,
                error: null,
                resized: false,
                kept: false,
                note: null,
            }))
        : [];

    const displayRows = [...hook.rows, ...pendingRows, ...rejected];
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
                <>
                    <ul className="grid gap-2 sm:grid-cols-2">
                        {upload.files.map((entry) => (
                            <li key={entry.id} className="min-w-0 max-w-full">
                                <FilePreviewCard
                                    name={entry.name}
                                    size={entry.size}
                                    format={entry.format}
                                    width={entry.width}
                                    height={entry.height}
                                    previewUrl={entry.previewUrl}
                                    // Removable only before the first run: once hook.settings
                                    // is set, the rows on screen were made from a specific
                                    // file set, and quietly shrinking that set behind them
                                    // is exactly the kind of drift Start over exists to avoid
                                    // doing silently. hook.settings already covers "mid-run"
                                    // too, since it is set the instant run() starts.
                                    onRemove={hook.settings !== null ? undefined : () => {
                                        upload.removeFile(entry.id);
                                        focusBrowseButton();
                                    }}
                                    removeLabel="Remove"
                                />
                            </li>
                        ))}
                    </ul>
                    {hook.settings !== null ? (
                        <p className="text-micro text-ink-muted">
                            To take a file out after a run, press Start over.
                        </p>
                    ) : null}
                </>
            ) : null}

            {/* A disabled fieldset disables every input and button inside it
                natively, which is what lets this cover PresetChips (no
                disabled prop of its own) for free. No legend here — this
                wrapper groups controls for the DOM, not for a screen reader
                heading; the mode fieldset below keeps its own legend. */}
            <fieldset disabled={hook.isProcessing} className="m-0 min-w-0 max-w-full flex flex-col gap-5 border-0 p-0">
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

                <fieldset className="min-w-0 flex flex-col gap-3">
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

    // The message names WHICH change made the results stale. Mixed row
    // settings comes first: it means the rows themselves disagree with each
    // other, which hook.settings — a single {targetBytes, mode} pair — cannot
    // even describe, let alone match against the current controls. Settings
    // beats selection when both of those are true, since a limit or a mode is
    // the more specific fact to act on. Either way `isStale` already covers
    // the union, so this only has to decide the wording once it is true.
    const staleMessage = mixedRowSettings
        ? 'These results were made with more than one setting — each row states its own limit. '
            + 'Press Compress again to redo them all with the current settings.'
        : settingsChanged
            ? `These results were made with ${limitLabel(hook.settings?.targetBytes)} · `
                + `${modeLabel(hook.settings?.mode)}. Press Compress again to apply your new settings.`
            : 'You changed the selection since the last run. Press Compress again to apply it.';

    const result = (
        <div className="flex flex-col gap-6">
            {/* Mounted from the very first render, text empty until a run
                starts — see components/tools/batch/BatchProgress.js for why. */}
            <BatchProgress text={hook.rows.length > 0 ? progressText : ''} />

            {isStale ? (
                <p role="status" data-stale className="text-ui text-ink-muted">
                    {staleMessage}
                </p>
            ) : null}

            {hasResults ? <BatchRows rows={displayRows} onDownload={hook.downloadOne} /> : null}

            {/* Start over lives here rather than only inside the summary
                below, because it is the only way to clear a REJECTED file —
                a rejected row has no remove button of its own — and that has
                to work before a run has ever happened, not only after one. */}
            {!hook.isProcessing && selectedCount > 0 ? (
                <div>
                    <button
                        type="button"
                        onClick={handleStartOver}
                        className="rounded-button border border-line px-4 py-3 text-base text-ink transition-colors duration-120 ease-snap hover:bg-surface-sunken"
                    >
                        Start over
                    </button>
                </div>
            ) : null}

            {!hook.isProcessing && hook.settings !== null ? (
                <BatchSummary
                    ref={summaryHeadingRef}
                    headingId="bulk-compress-summary-heading"
                    // Falsy for both null (nothing succeeded) and 0 (everything that
                    // succeeded was kept as-is, never re-encoded) — a batch with
                    // nothing saved gets no "saved" headline, on top of and below
                    // which every kept row already says why in its own words.
                    headline={combinedSummary.reductionPercent ? (
                        <>
                            {'You saved '}
                            <span className="font-data text-accent">{formatFileSize(combinedSummary.savedBytes)}</span>
                            {' — '}
                            {/* The unsigned percent from summarize(): this sentence already
                                says "smaller", so the per-row minus sign (formatSavings)
                                would read as a double negative — "−88% smaller". */}
                            <span className="font-data text-accent">{combinedSummary.reductionPercent}%</span>
                            {' smaller'}
                        </>
                    ) : null}
                    entries={[
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
                    ]}
                    zip={{ count: combinedSummary.successful, onClick: hook.downloadZip, busy: hook.isZipping }}
                    retry={{ count: retryCount, onClick: handleRetry }}
                    zipError={hook.zipError}
                />
            ) : null}
        </div>
    );

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
