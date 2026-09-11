'use client';

/**
 * BulkConvertTool
 *
 * One output format, a batch of JPEG, PNG and WebP files, and every file in
 * the queue leaves as that one format — because a folder of mixed screenshots,
 * photos and logos is a batch job people actually bring, and doing it one
 * file at a time on /convert is the twenty-click version of the same task.
 *
 * Built on the same batch platform as /bulk-image-compressor: the row model,
 * the sequencer, the summary and the ZIP all come from lib/upload/batch.js
 * through lib/hooks/useBulkBatch.js. What is here is everything that is
 * genuinely about CONVERTING: the format chips, the background control for a
 * transparent source going out as JPEG, the quality dial for the two formats
 * that have one, and the input/output pair each row shows instead of the
 * compressor's byte target.
 *
 * TWO KINDS OF ROW, ONE LIST — see BulkCompressTool.js for the fuller version
 * of this note, which applies unchanged: `hook.rows` are the engine's own
 * settled outcomes, `rejected` never reached the engine at all (wrong format,
 * or too large before a byte was read), and both render in the one Results
 * list and count in the one summary.
 *
 * A FILE ALREADY IN THE OUTPUT FORMAT IS STILL A SUCCESS, NOT A CONVERSION.
 * lib/upload/convert-batch.js hands it back untouched rather than
 * re-encoding it for nothing, and the summary counts it separately
 * ("Already in format") from files that actually changed ("Converted") —
 * see hook.summary.converted / hook.summary.kept, both from
 * summarizeConversion.
 *
 * SETTINGS OUTLIVE A RESULT, exactly as they do on the compressor: changing
 * the format, quality or background after a run does not clear what is on
 * screen, it marks the results stale and relabels the action "Convert again".
 *
 * WHERE THE WORK HAPPENS: every file is read and re-encoded on this device,
 * through useBulkBatch, which puts the same capability gate in front of each
 * file in turn. Nothing is uploaded.
 */
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';

import BatchRows from '@/components/tools/batch/BatchRows';
import BatchProgress from '@/components/tools/batch/BatchProgress';
import BatchSummary from '@/components/tools/batch/BatchSummary';
import ToolShell, { ToolAction } from '@/components/tools/ToolShell';
import TransparencyBackground from '@/components/tools/TransparencyBackground';
import Dropzone from '@/components/ui/Dropzone';
import Field from '@/components/ui/Field';
import FilePreviewCard from '@/components/ui/FilePreviewCard';
import PresetChips from '@/components/tools/PresetChips';
import { formatFileSize } from '@/lib/format/bytes';
import { checkBatchLimits, formatLabel, rejectReason } from '@/lib/format/upload-helpers';
import useImageUpload from '@/lib/hooks/useImageUpload';
import { useBulkBatch } from '@/lib/hooks/useBulkBatch';
import { assessBatchJob, refusalMessage } from '@/lib/image-client/capability';
import { CONVERT_INPUT_FORMATS, MAX_BULK_FILES, MAX_BULK_TOTAL_BYTES, MAX_FILE_SIZE } from '@/lib/limits';
import { STATUS, STATUS_LABELS } from '@/lib/upload/batch';
import { DEFAULT_OUTPUT_FORMAT, DEFAULT_QUALITY, OUTPUT_FORMATS, QUALITY_FORMATS, ZIP_FILENAME, createConvertProcessor, summarizeConversion } from '@/lib/upload/convert-batch';

const HEIC_MESSAGE = 'HEIC isn’t accepted in a batch. Convert it to JPEG first with the HEIC converter at /heic, then add it here.';

/**
 * Short chip labels — 'JPG' rather than formatLabel's 'JPEG' — for the one
 * place on this page that wants the three-letter form. The SET of formats
 * still comes from OUTPUT_FORMATS, never re-typed.
 */
const FORMAT_CHIP_LABELS = { jpeg: 'JPG', png: 'PNG', webp: 'WebP' };
const FORMAT_ITEMS = OUTPUT_FORMATS.map((format) => ({
    id: format,
    label: FORMAT_CHIP_LABELS[format] ?? formatLabel(format),
}));

/**
 * AVIF is a bulk INPUT only: a batch of phone-side AVIF encodes is not proven
 * safe under this tool's 20-file / 80 MB memory model, so writing AVIF stays
 * on the single-file converter, which costs one encode at a time. Gated on
 * the registry rather than always shown, so this note has nothing to say
 * until AVIF is actually an accepted input here.
 */
const ACCEPTS_AVIF_INPUT = CONVERT_INPUT_FORMATS.includes('avif');

const FAILURE_STATUSES = new Set([STATUS.unsupported, STATUS.unsafe, STATUS.cancelled, STATUS.failed]);
const RETRYABLE_STATUSES = new Set([STATUS.unsafe, STATUS.cancelled, STATUS.failed]);

/** 'PNG · 1.8 MB · 2400 × 1600' — format, size and dimensions, the one triple this row shows either side of. */
function describeFile(format, bytes, width, height) {
    const parts = [
        format ? formatLabel(format) : null,
        Number.isFinite(bytes) ? formatFileSize(bytes) : null,
        Number.isFinite(width) && Number.isFinite(height) ? `${width} × ${height}` : null,
    ].filter(Boolean);
    return parts.length > 0 ? parts.join(' · ') : null;
}

/** 'Converted' vs 'Already in format' are both STATUS.success — the note alone cannot carry a dt/status distinction. */
function convertStatusText(row) {
    if (row.status === STATUS.success) return row.kept ? 'Already in format' : 'Converted';
    if (row.status === STATUS.failed) return 'Could not convert';
    return STATUS_LABELS[row.status] ?? row.status;
}

function describeConvertRow(row) {
    // A row the tool rejected before the engine ever saw it carries only
    // {id, name, status, error} — no originalBytes, no format — exactly like
    // the compressor's own rejected rows, and for the same reason: there is
    // nothing here to show an Input cell for.
    const hasEngineData = Number.isFinite(row.originalBytes) && typeof row.format === 'string';
    const cells = [];

    if (hasEngineData) {
        const input = describeFile(row.format, row.originalBytes, row.sourceWidth, row.sourceHeight);
        if (input) cells.push({ field: 'input', label: 'Input', value: input });

        const output = row.status === STATUS.success
            ? describeFile(row.outputFormat, row.resultBytes, row.width, row.height)
            : null;
        cells.push({ field: 'output', label: 'Output', value: output ?? '—' });
    }

    return {
        status: convertStatusText(row),
        cells,
        // The engine's own note: why a success row isn't the ordinary case —
        // kept unchanged, or a transparent source flattened onto a colour.
        note: row.status === STATUS.success && row.note ? row.note : null,
        error: FAILURE_STATUSES.has(row.status) && row.error ? row.error : null,
        download: row.status === STATUS.success ? `Download ${row.filename ?? row.name}` : null,
    };
}

/** '+2.4 MB' / '−32.9 MB' (a real minus sign) / '0 Bytes' — the batch's byte total moving either way. */
function signedByteDifference(bytes) {
    const value = Number.isFinite(bytes) ? bytes : 0;
    if (value > 0) return `+${formatFileSize(value)}`;
    if (value < 0) return `−${formatFileSize(Math.abs(value))}`;
    return formatFileSize(0);
}

/**
 * Why one bounced file did not reach the engine — see BulkCompressTool.js's
 * own classifyRejection for the fuller note. Duplicated rather than shared: it
 * is a dozen lines, unlikely to change, and the same duplication already
 * stands between BulkCompressTool.js and compress-batch.js for groupThousands.
 */
function classifyRejection(file) {
    const size = Number(file?.size) || 0;

    if (size > MAX_FILE_SIZE) {
        return { status: STATUS.unsafe, error: rejectReason.tooLarge(size, MAX_FILE_SIZE) };
    }

    if (looksLikeHeic(file)) {
        return { status: STATUS.unsupported, error: HEIC_MESSAGE };
    }

    return { status: STATUS.unsupported, error: rejectReason.wrongType(CONVERT_INPUT_FORMATS) };
}

function looksLikeHeic(file) {
    const name = String(file?.name ?? '').toLowerCase();
    const type = String(file?.type ?? '').toLowerCase();
    return /\.hei[cf]$/.test(name) || type === 'image/heic' || type === 'image/heif';
}

function focusBrowseButton() {
    document.getElementById('bulk-convert-file-browse')?.focus();
}

export default function BulkConvertTool({
    title = 'Convert Many Images to One Format',
    intro = 'Choose one output format, drop a batch of JPEG, PNG or WebP photos, and every file converts to it '
        + 'in one pass. Nothing is uploaded.',
    answer,
    breadcrumb,
    children,
}) {
    const [outputFormat, setOutputFormat] = useState(DEFAULT_OUTPUT_FORMAT);
    const [quality, setQuality] = useState(DEFAULT_QUALITY);
    const [background, setBackground] = useState('white');
    const [rejected, setRejected] = useState([]);

    const rejectedSeq = useRef(0);
    const itemsRef = useRef([]);
    const summaryHeadingRef = useRef(null);
    const stopRef = useRef(null);
    const wasProcessingRef = useRef(false);

    const upload = useImageUpload({ accept: CONVERT_INPUT_FORMATS, multiple: true, maxFiles: MAX_BULK_FILES });
    const processFile = useMemo(() => createConvertProcessor(), []);
    const hook = useBulkBatch({ processFile, zipFilename: ZIP_FILENAME, summarise: summarizeConversion });

    const batchAssessment = useMemo(() => {
        if (upload.files.length === 0) return null;
        return assessBatchJob({
            files: upload.files.map((entry) => ({
                fileBytes: entry.size,
                sourceWidth: entry.width,
                sourceHeight: entry.height,
            })),
            format: outputFormat,
            operation: 'convert',
        });
    }, [upload.files, outputFormat]);

    const batchError = batchAssessment && !batchAssessment.ok ? refusalMessage(batchAssessment) : null;

    /**
     * Adds a {id, name, status, error} row for every incoming file
     * useImageUpload did not accept — see BulkCompressTool.js's own
     * registerRejections for the fuller note; the reasoning is identical.
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
    const selectedCount = n + rejected.length;

    const settingsChanged = Boolean(hook.settings) && (
        hook.settings.outputFormat !== outputFormat
        || hook.settings.quality !== quality
        || hook.settings.background !== background
    );

    const currentFileIds = new Set(upload.files.map((entry) => entry.id));
    const selectionChanged = Boolean(hook.settings) && (
        itemsRef.current.length !== currentFileIds.size
        || itemsRef.current.some((item) => !currentFileIds.has(item.id))
    );

    // See BulkCompressTool.js's own mixedRowSettings for why this compares the
    // ROWS rather than hook.settings: a retry redoes only the rows a retry can
    // change, so a format changed after the first run can leave some rows at
    // the old setting and some at the new one.
    const mixedRowSettings = hook.rows.length > 1 && hook.rows.some((row) => (
        row.outputFormat !== hook.rows[0].outputFormat
        || row.quality !== hook.rows[0].quality
        || row.background !== hook.rows[0].background
    ));

    const isStale = settingsChanged || selectionChanged || mixedRowSettings;

    const actionLabel = isStale
        ? 'Convert again'
        : (n === 1 ? 'Convert 1 image' : `Convert ${n} images`);

    const actionDisabled = n === 0 || Boolean(batchError) || upload.isReading;

    const handleSubmit = () => {
        if (actionDisabled) return;

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
        hook.run(items, { outputFormat, quality, background });
    };

    const retryCount = useMemo(
        () => hook.rows.filter((row) => RETRYABLE_STATUSES.has(row.status)).length,
        [hook.rows],
    );

    const handleRetry = () => {
        hook.retry(itemsRef.current, { outputFormat, quality, background });
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
            selected: selectedCount,
            unsupported: base.unsupported + rejectedUnsupported,
            unsafe: base.unsafe + rejectedUnsafe,
        };
    }, [hook.summary, selectedCount, rejected]);

    // A file accepted AFTER the last run has no hook row at all — see
    // BulkCompressTool.js's own pendingRows for the fuller note. Matched by id
    // only, for the same reason: two files can share a name.
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
                outputFormat,
                quality,
                background,
                filename: null,
                error: null,
                resized: false,
                kept: false,
                note: null,
            }))
        : [];

    const displayRows = [...hook.rows, ...pendingRows, ...rejected];
    const hasResults = displayRows.length > 0;

    useEffect(() => {
        if (wasProcessingRef.current && !hook.isProcessing && hook.rows.length > 0) {
            summaryHeadingRef.current?.focus();
        }
        // The action button is disabled the moment a run starts, and a
        // disabled button drops keyboard focus to the body. Stop is the one
        // control that matters during a run, so focus lands there.
        if (!wasProcessingRef.current && hook.isProcessing) {
            stopRef.current?.focus();
        }
        wasProcessingRef.current = hook.isProcessing;
    }, [hook.isProcessing, hook.rows.length]);

    const hasAlphaCapableSource = upload.files.some((entry) => entry.format === 'png' || entry.format === 'webp');
    const showBackground = outputFormat === 'jpeg' && hasAlphaCapableSource;
    const showQuality = QUALITY_FORMATS.includes(outputFormat);

    const panel = (
        <div className="flex flex-col gap-5">
            <Dropzone
                id="bulk-convert-file"
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

            <fieldset disabled={hook.isProcessing} className="m-0 min-w-0 max-w-full flex flex-col gap-5 border-0 p-0">
                <PresetChips
                    label="Output format"
                    items={FORMAT_ITEMS}
                    value={outputFormat}
                    onSelect={(item) => { if (item) setOutputFormat(item.id); }}
                />

                {ACCEPTS_AVIF_INPUT ? (
                    <p className="text-micro text-ink-muted">
                        AVIF files can be added above. Writing AVIF output isn&rsquo;t available in a batch yet
                        {' — convert to AVIF one file at a time on the '}
                        <Link href="/convert" className="font-medium text-accent underline underline-offset-4 transition-[text-decoration-thickness] duration-120 ease-snap hover:decoration-2">
                            single-image converter
                        </Link>
                        .
                    </p>
                ) : null}

                {showBackground ? (
                    <TransparencyBackground value={background} onChange={setBackground} />
                ) : null}

                {showQuality ? (
                    <Field
                        id="bulk-convert-quality"
                        label={<>Quality <span className="font-data text-accent">{quality}</span></>}
                    >
                        <input
                            id="bulk-convert-quality"
                            type="range"
                            min="1"
                            max="100"
                            step="1"
                            value={quality}
                            onChange={(event) => setQuality(Number(event.target.value))}
                            aria-describedby="bulk-convert-quality-hint"
                            className="w-full accent-[var(--accent)] disabled:opacity-50"
                        />
                        <p id="bulk-convert-quality-hint" className="text-micro text-ink-muted">
                            80 is the web default. Lower means a smaller file with more visible artefacts.
                        </p>
                    </Field>
                ) : (
                    <p className="text-ui text-ink-muted">PNG is lossless — there is no quality setting.</p>
                )}
            </fieldset>
        </div>
    );

    const action = (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
            <ToolAction
                label={actionLabel}
                processingLabel="Converting…"
                isProcessing={hook.isProcessing}
                progress={hook.progress}
                disabled={actionDisabled}
                onClick={handleSubmit}
                hint={n === 0 ? 'Add images to turn this on.' : undefined}
                className="flex-1"
            />
            {hook.isProcessing ? (
                <button
                    ref={stopRef}
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
            + (hook.counts.current ? ` · Converting ${hook.counts.current}` : '')
        : `${hook.summary.converted} of ${hook.summary.selected} converted`;

    const staleMessage = mixedRowSettings
        ? 'These results were made with more than one setting — each row states its own format. '
            + 'Press Convert again to redo them all with the current settings. The ZIP still holds the previous results.'
        : settingsChanged
            ? `These results were made as ${formatLabel(hook.settings?.outputFormat)} with the previous settings. `
                + 'Press Convert again to apply your new settings. The ZIP still holds the previous results.'
            : 'You changed the selection since the last run. Press Convert again to apply it. The ZIP still holds the previous results.';

    const result = (
        <div className="flex flex-col gap-6">
            <BatchProgress text={hook.rows.length > 0 ? progressText : ''} />

            {isStale ? (
                <p role="status" data-stale className="text-ui text-ink-muted">
                    {staleMessage}
                </p>
            ) : null}

            {hasResults ? <BatchRows rows={displayRows} onDownload={hook.downloadOne} describe={describeConvertRow} /> : null}

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
                    headingId="bulk-convert-summary-heading"
                    entries={[
                        ['Selected', combinedSummary.selected],
                        ['Converted', combinedSummary.converted],
                        ['Already in format', combinedSummary.kept],
                        ['Could not convert', combinedSummary.failed],
                        ['Unsupported', combinedSummary.unsupported],
                        ['Too large for this device', combinedSummary.unsafe],
                        ['Cancelled', combinedSummary.cancelled],
                        ['Input total', formatFileSize(combinedSummary.inputBytes)],
                        ['Output total', formatFileSize(combinedSummary.outputBytes)],
                        ['Difference', signedByteDifference(combinedSummary.differenceBytes)],
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
            slug="bulk-image-converter"
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
