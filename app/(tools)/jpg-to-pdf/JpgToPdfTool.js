'use client';

/**
 * JpgToPdfTool
 *
 * The one tool on the site that takes a LIST, and the list is the interface.
 * Everything else here processes a file; this arranges files, and the order of
 * the rows is the order of the pages with no sorting and nothing clever in
 * between. That is why the panel is a numbered <ol> rather than a grid of
 * cards: a grid does not have a first item.
 *
 * REORDERING IS BUTTONS, NOT DRAG.
 *
 * Every row carries a real "Move up" and "Move down" button, so the order can
 * be set from the keyboard alone. A drag handle can be added on top of that
 * later; it can never be the only way, because it locks out anyone who does not
 * use a pointer and most of the mobile browsers this site is used from.
 *
 * WHAT THE PAGE HAS TO ADMIT ABOUT PNG, WebP AND HEIC.
 *
 * A PDF stores a JPEG stream as the JPEG already is, which is what makes twenty
 * photos possible in a browser tab at all — the bytes are copied, nothing is
 * decoded, nothing is allocated. No other format gets that: a PNG has to be
 * opened, flattened and written back out as a JPEG before it can be a page, and
 * the engine deliberately does that rather than embedding it losslessly, which
 * would cost the memory of a full decode and usually produce a BIGGER document
 * than the pictures that went into it (see lib/image-client/pdf.js).
 *
 * There is therefore no lossless option to offer, and the wrong answer would be
 * to stay quiet about it. So the panel counts the files it is going to re-draw
 * and says so BEFORE the button is pressed, and the result panel reports the
 * number the engine actually re-drew afterwards. Nobody has to open the PDF to
 * find out.
 *
 * WHERE THE WORK HAPPENS
 *
 * On this device, through useLocalProcess, which gates every file against what
 * this tab can spare before anything is read, and then hands the whole list to
 * the worker where the document gate asks the question no per-file check can:
 * do all of these pages fit at once. A refusal from either is shown in the
 * gate's own words. useLocalProcess also terminates the worker on unmount, so
 * an idle codec heap does not follow the visitor to the next page.
 */
import { useCallback, useMemo, useState } from 'react';

import ResultPanel from '@/components/tools/ResultPanel';
import ToolShell, { ToolAction } from '@/components/tools/ToolShell';
import Alert from '@/components/ui/Alert';
import Dropzone from '@/components/ui/Dropzone';
import Field, { fieldDescribedBy } from '@/components/ui/Field';
import FilePreviewCard from '@/components/ui/FilePreviewCard';
import {
    MAX_BULK_FILES,
    MAX_TARGET_BYTES,
    MIN_TARGET_BYTES,
    PDF_INPUT_FORMATS,
    RASTER_INPUT_FORMATS,
} from '@/lib/limits';
import { formatFileSize } from '@/lib/format-bytes';
import { formatProse } from '@/lib/format/upload-helpers';
import useImageUpload from '@/lib/hooks/useImageUpload';
import useLocalProcess from '@/lib/hooks/useLocalProcess';
import {
    canEmbedWithoutDecoding,
    LANDSCAPE,
    PAGE_SIZE_A4,
    PAGE_SIZE_FIT,
    PAGE_SIZE_LETTER,
    PDF_JPEG_QUALITY,
    PORTRAIT,
} from '@/lib/image-client/pdf';

const CONTROL = 'w-full rounded-input border border-line bg-surface-raised px-3 py-2 font-data text-ui text-ink';

const SELECT = 'rounded-input border border-line bg-surface-raised px-2 py-2 font-data text-ui text-ink';

const UNIT_BYTES = { KB: 1024, MB: 1024 * 1024 };

const PAGE_SIZE_OPTIONS = [
    { value: PAGE_SIZE_FIT, label: 'Fit each page to its photo' },
    { value: PAGE_SIZE_A4, label: 'A4' },
    { value: PAGE_SIZE_LETTER, label: 'US Letter' },
];

const ORIENTATION_OPTIONS = [
    { value: PORTRAIT, label: 'Portrait' },
    { value: LANDSCAPE, label: 'Landscape' },
];

/**
 * Margins in PDF points, which is what parseMarginPoints takes. All four sit
 * inside its 0-108 ceiling — 72 points is a one-inch border, the widest anyone
 * printing a scan asks for.
 */
const MARGIN_OPTIONS = [
    { value: '0', label: 'None' },
    { value: '18', label: 'Narrow' },
    { value: '36', label: 'Standard' },
    { value: '72', label: 'Wide' },
];

const ARROW = 'flex size-7 items-center justify-center rounded-button border border-line font-data text-ui text-ink transition-colors duration-120 ease-snap hover:bg-surface-sunken disabled:opacity-40';

function plural(count, singular, pluralWord) {
    return count === 1 ? singular : pluralWord;
}

export default function JpgToPdfTool({
    title = 'JPG to PDF',
    intro = 'Combine photos into one PDF, in the order you choose. PNG, WebP and HEIC go in too. Nothing is uploaded.',
    answer,
    breadcrumb,
    children,
}) {
    const [pageSize, setPageSize] = useState(PAGE_SIZE_FIT);
    const [orientation, setOrientation] = useState(PORTRAIT);
    const [margin, setMargin] = useState('0');
    const [mode, setMode] = useState('as-is');
    const [amount, setAmount] = useState('2');
    const [unit, setUnit] = useState('MB');

    const upload = useImageUpload({
        accept: PDF_INPUT_FORMATS,
        multiple: true,
        // A HEIC is accepted and never previewed: no browser outside Safari can
        // decode one, and a probe that fails would reject the file as damaged.
        // The other three are measured, which is what lets the memory gate cost
        // the document before a single byte is read.
        previewFormats: RASTER_INPUT_FORMATS,
    });

    const submit = useLocalProcess({ op: 'pdf' });

    const files = upload.files;
    const totalBytes = useMemo(
        () => files.reduce((sum, entry) => sum + (Number(entry.size) || 0), 0),
        [files],
    );

    const fixedPage = pageSize !== PAGE_SIZE_FIT;

    const targetBytes = useMemo(() => {
        const value = Number(amount);
        if (!Number.isFinite(value) || value <= 0) return null;
        return Math.round(value * UNIT_BYTES[unit]);
    }, [amount, unit]);

    const targetError = mode === 'target' && (targetBytes === null
        || targetBytes < MIN_TARGET_BYTES
        || targetBytes > MAX_TARGET_BYTES)
        ? `Pick a maximum between ${formatFileSize(MIN_TARGET_BYTES)} and ${formatFileSize(MAX_TARGET_BYTES)}.`
        : null;

    // The engine's own predicate, not a re-typed list of format names. It reads
    // the EXIF Orientation too, which this page cannot see, so a JPEG counted
    // here as free may still be re-drawn if the camera saved it sideways — the
    // note below says so, and the result reports the real number.
    const reencoded = useMemo(
        () => files.filter((entry) => !canEmbedWithoutDecoding({ format: entry.format })),
        [files],
    );

    const handleFiles = useCallback((incoming) => {
        submit.reset();
        return upload.selectFiles(incoming);
    }, [submit, upload]);

    const handleRemove = useCallback((id) => {
        submit.reset();
        upload.removeFile(id);
    }, [submit, upload]);

    const handleMove = useCallback((id, offset) => {
        submit.reset();
        upload.moveFile(id, offset);
    }, [submit, upload]);

    const handleReset = useCallback(() => {
        submit.reset();
        upload.clear();
    }, [submit, upload]);

    const handleSubmit = useCallback(() => {
        if (files.length === 0 || targetError) return;

        submit.submit({
            file: files.map((entry) => entry.file),
            // Lined up with the files, one per page, so the memory gate can cost
            // each one before anything is decoded. A HEIC has no measurement and
            // passes null, which the gate reads as "defer to the decoder".
            sizes: files.map((entry) => ({ width: entry.width, height: entry.height })),
            pageSize,
            pageOrientation: orientation,
            margin,
            ...(mode === 'target' ? { targetBytes: String(targetBytes) } : {}),
        }, {
            originalBytes: totalBytes,
        });
    }, [files, margin, mode, orientation, pageSize, submit, targetBytes, targetError, totalBytes]);

    const settings = (
        <div className="flex flex-col gap-5">
            <fieldset className="flex flex-col gap-2">
                <legend className="text-ui text-ink">Page size</legend>
                <div className="flex flex-wrap gap-x-6 gap-y-2">
                    {PAGE_SIZE_OPTIONS.map((option) => (
                        <label key={option.value} className="flex items-center gap-2 text-ui text-ink">
                            <input
                                type="radio"
                                name="pdf-page-size"
                                value={option.value}
                                checked={pageSize === option.value}
                                onChange={() => setPageSize(option.value)}
                                className="size-4 accent-[var(--accent)]"
                            />
                            {option.label}
                        </label>
                    ))}
                </div>
                <p className="text-micro text-ink-muted">
                    {fixedPage
                        ? 'Each photo is scaled to fit the sheet with its shape kept, and centred.'
                        : 'Every page becomes the shape of its own photo, edge to edge.'}
                </p>
            </fieldset>

            {fixedPage ? (
                <div className="flex flex-wrap items-end gap-5">
                    <fieldset className="flex flex-col gap-2">
                        <legend className="text-ui text-ink">Orientation</legend>
                        <div className="flex flex-wrap gap-x-6 gap-y-2">
                            {ORIENTATION_OPTIONS.map((option) => (
                                <label key={option.value} className="flex items-center gap-2 text-ui text-ink">
                                    <input
                                        type="radio"
                                        name="pdf-orientation"
                                        value={option.value}
                                        checked={orientation === option.value}
                                        onChange={() => setOrientation(option.value)}
                                        className="size-4 accent-[var(--accent)]"
                                    />
                                    {option.label}
                                </label>
                            ))}
                        </div>
                    </fieldset>

                    <Field
                        id="pdf-margin"
                        label="Margin"
                        hint="White space around the photo on every sheet."
                        className="max-w-[12rem]"
                    >
                        <select
                            id="pdf-margin"
                            value={margin}
                            onChange={(event) => setMargin(event.target.value)}
                            aria-describedby={fieldDescribedBy('pdf-margin', { hint: true })}
                            className={CONTROL}
                        >
                            {MARGIN_OPTIONS.map((option) => (
                                <option key={option.value} value={option.value}>{option.label}</option>
                            ))}
                        </select>
                    </Field>
                </div>
            ) : null}

            <fieldset className="flex flex-col gap-2">
                <legend className="text-ui text-ink">PDF size</legend>
                <div className="flex flex-wrap gap-x-6 gap-y-2">
                    {[
                        { value: 'as-is', label: 'Keep the photos as they are' },
                        { value: 'target', label: 'Aim for a maximum size' },
                    ].map((option) => (
                        <label key={option.value} className="flex items-center gap-2 text-ui text-ink">
                            <input
                                type="radio"
                                name="pdf-size-mode"
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

            {mode === 'target' ? (
                <Field
                    id="pdf-target"
                    label="Maximum size"
                    hint="Every photo is re-drawn smaller until the whole PDF fits, and the result says what it really weighs."
                    error={targetError}
                    className="max-w-xs"
                    suffix={(
                        <select
                            id="pdf-target-unit"
                            aria-label="Maximum size unit"
                            value={unit}
                            onChange={(event) => setUnit(event.target.value)}
                            className={SELECT}
                        >
                            <option value="KB">KB</option>
                            <option value="MB">MB</option>
                        </select>
                    )}
                >
                    <input
                        id="pdf-target"
                        type="number"
                        inputMode="numeric"
                        min="1"
                        step="1"
                        value={amount}
                        onChange={(event) => setAmount(event.target.value)}
                        aria-describedby={fieldDescribedBy('pdf-target', {
                            hint: true,
                            error: targetError,
                        })}
                        className={CONTROL}
                    />
                </Field>
            ) : null}
        </div>
    );

    const conversionNote = reencoded.length > 0 ? (
        <Alert tone="info">
            {`${reencoded.length} of these ${plural(reencoded.length, 'is a', 'are')} `}
            {`${formatProse(Array.from(new Set(reencoded.map((entry) => entry.format))), 'or')}. `}
            {'A PDF page carries a JPEG, so '}
            {plural(reencoded.length, 'that one is', 'those are')}
            {` re-drawn as ${plural(reencoded.length, 'a JPEG', 'JPEGs')} at quality ${PDF_JPEG_QUALITY}, and see-through areas turn white. `}
            {'A JPEG goes in exactly as it is, unless the camera saved it sideways, in which case it is re-drawn too so the page is the right way up.'}
        </Alert>
    ) : null;

    const panel = (
        <div className="flex flex-col gap-4">
            <Dropzone
                id="pdf-file"
                multiple
                label={files.length > 0 ? 'Drop more images here' : `Drop up to ${MAX_BULK_FILES} images here`}
                browseLabel={files.length > 0 ? 'Add more images' : 'Choose images'}
                constraints={upload.constraints}
                accept={upload.accept}
                state={upload.state}
                reason={upload.error}
                onFiles={handleFiles}
                onDragChange={upload.setDragging}
                disabled={upload.isReading || submit.isProcessing}
            />

            {files.length > 0 ? (
                <>
                    <p className="font-data text-micro text-ink-muted">
                        {`${files.length} ${plural(files.length, 'image', 'images')} · ${formatFileSize(totalBytes)} · page order top to bottom`}
                    </p>

                    {/* Labelled, because "list" is not a useful thing to land
                        on and this one IS the page order. */}
                    <ol aria-label="Page order" className="flex flex-col gap-2">
                        {files.map((entry, index) => {
                            const first = index === 0;
                            const last = index === files.length - 1;

                            return (
                                <li key={entry.id} className="flex items-center gap-3">
                                    <span className="w-6 shrink-0 text-right font-data text-ui tabular-nums text-ink-muted">
                                        <span className="sr-only">Page </span>
                                        {index + 1}
                                    </span>

                                    <FilePreviewCard
                                        className="min-w-0 flex-1"
                                        name={entry.name}
                                        size={entry.size}
                                        format={entry.format}
                                        width={entry.width}
                                        height={entry.height}
                                        previewUrl={entry.previewUrl}
                                        onRemove={() => handleRemove(entry.id)}
                                        removeLabel="Remove"
                                    />

                                    {/* A disabled control is still read out, so the
                                        label must not name a page that does not
                                        exist — "up to page 0" was the first version
                                        of this and it was nonsense on row one. */}
                                    <div className="flex shrink-0 flex-col gap-1">
                                        <button
                                            type="button"
                                            onClick={() => handleMove(entry.id, -1)}
                                            disabled={first}
                                            aria-label={first
                                                ? `${entry.name} is already page 1`
                                                : `Move ${entry.name} up to page ${index}`}
                                            className={ARROW}
                                        >
                                            <span aria-hidden="true">↑</span>
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => handleMove(entry.id, 1)}
                                            disabled={last}
                                            aria-label={last
                                                ? `${entry.name} is already the last page`
                                                : `Move ${entry.name} down to page ${index + 2}`}
                                            className={ARROW}
                                        >
                                            <span aria-hidden="true">↓</span>
                                        </button>
                                    </div>
                                </li>
                            );
                        })}
                    </ol>
                </>
            ) : null}

            {conversionNote}
        </div>
    );

    const outcome = submit.result;
    const targetMissed = Boolean(outcome?.targetBytes) && outcome.targetMet === false;

    const footnote = (() => {
        if (!outcome) return null;

        const parts = [
            `${outcome.pageCount} ${plural(outcome.pageCount, 'page', 'pages')}, in the order shown above.`,
        ];

        if (outcome.reencodedCount > 0) {
            // The "and the rest went in untouched" half only exists when there
            // IS a rest. A size target usually re-draws every page, and saying
            // otherwise would be a sentence contradicting the number beside it.
            const untouched = outcome.pageCount - outcome.reencodedCount;

            parts.push(
                `${outcome.reencodedCount} ${plural(outcome.reencodedCount, 'image was', 'images were')} `
                + `re-drawn as ${plural(outcome.reencodedCount, 'a JPEG', 'JPEGs')} to become ${plural(outcome.reencodedCount, 'a page', 'pages')}`
                + (untouched > 0
                    ? `; ${plural(untouched, 'the other went', 'the rest went')} in untouched.`
                    : '.'),
            );
        }

        if (outcome.targetBytes && !targetMissed) {
            parts.push(`Asked for at most ${formatFileSize(outcome.targetBytes)} — the PDF came out at ${formatFileSize(outcome.resultBytes)}.`);
        }

        parts.push('EXIF and GPS metadata are stripped from every page.');

        return parts.join(' ');
    })();

    const result = outcome ? (
        <div className="flex flex-col gap-4">
            {targetMissed ? <Alert tone="info">{outcome.targetMessage}</Alert> : null}

            <ResultPanel
                variant="single"
                filename={outcome.filename}
                originalBytes={outcome.originalBytes}
                resultBytes={outcome.resultBytes}
                onDownload={() => submit.download()}
                onReset={handleReset}
                downloadLabel="Download PDF"
                footnote={footnote}
            />
        </div>
    ) : null;

    return (
        <ToolShell
            slug="jpg-to-pdf"
            title={title}
            intro={intro}
            answer={answer}
            breadcrumb={breadcrumb}
            settingsLabel="PDF settings"
            settings={settings}
            panel={panel}
            error={submit.error}
            action={(
                <ToolAction
                    label={files.length > 1 ? `Make a ${files.length}-page PDF` : 'Make PDF'}
                    processingLabel="Building the PDF…"
                    isProcessing={submit.isProcessing}
                    progress={submit.progress}
                    disabled={files.length === 0 || upload.isReading || Boolean(targetError)}
                    onClick={handleSubmit}
                    onCancel={submit.cancel}
                    hint={files.length === 0 ? 'Add images to turn this on.' : undefined}
                />
            )}
            result={result}
        >
            {children}
        </ToolShell>
    );
}
