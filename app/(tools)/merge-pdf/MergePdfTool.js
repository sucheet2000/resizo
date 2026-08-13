'use client';

/**
 * MergePdfTool
 *
 * The second tool on this site whose interface IS a list, and the first whose
 * files are documents. It is built on the same bones as /jpg-to-pdf — a
 * numbered <ol> where the row order is the page order, with a real Move up and
 * Move down button on every row — because that page already answered the two
 * questions this one asks, and answering them a second way would mean two
 * things to keep right.
 *
 * REORDERING IS BUTTONS, NOT DRAG. Same rule, same reason: a drag handle locks
 * out anyone who does not use a pointer, and most of the mobile browsers this
 * site is used from. A handle can be added on top later; it can never be the
 * only way.
 *
 * WHY THE FILE IS OPENED THE MOMENT IT LANDS
 *
 * Two things about a PDF cannot be known from the outside, and a person needs
 * both before they press anything. How many pages it has, because a page box
 * with nothing to validate against is a box that accepts "1-99" and fails
 * later. And whether it is locked — a password-protected bank statement is the
 * most likely bad file this tool will ever be handed, and pdf-lib's own advice
 * for one (`ignoreEncryption`) produces a document of blank pages that reports
 * success. So readPdfPageCount runs per file at intake, and a file it cannot
 * read is refused THERE, by name, in the engine's own sentence.
 *
 * THE DEFAULT IS ONE ACTION
 *
 * Add the files, press Combine. Every file contributes every page, in the order
 * the rows are in. Choosing pages is a per-row option that has to be opened,
 * and it produces the plan lib/image-client/pdf-merge.js takes: one entry per
 * file, `pageIndices: null` meaning all of them.
 *
 * NOTHING IS DECODED HERE, which is why there is no quality control, no format
 * choice and no size target on this page. A page moves between documents as an
 * object graph with its streams untouched — see lib/image-client/pdf-merge.js —
 * so there is no setting that could exist without lying about what the tool
 * does.
 */
import { useCallback, useMemo, useState } from 'react';

import ResultPanel from '@/components/tools/ResultPanel';
import ToolShell, { ToolAction } from '@/components/tools/ToolShell';
import Dropzone from '@/components/ui/Dropzone';
import Field, { fieldDescribedBy } from '@/components/ui/Field';
import FilePreviewCard from '@/components/ui/FilePreviewCard';
import { MAX_BULK_FILES, MERGE_PDF_INPUT_FORMATS } from '@/lib/limits';
import { formatFileSize } from '@/lib/format/bytes';
import { rejectReason } from '@/lib/format/upload-helpers';
import useImageUpload from '@/lib/hooks/useImageUpload';
import useLocalProcess from '@/lib/hooks/useLocalProcess';
import { isPdfSignature } from '@/lib/image/magic-bytes';
import { parsePageRange, readPdfPageCount } from '@/lib/image-client/pdf-merge';

const CONTROL = 'w-full rounded-input border border-line bg-surface-raised px-3 py-2 font-data text-ui text-ink';

const SELECT = 'rounded-input border border-line bg-surface-raised px-2 py-2 font-data text-ui text-ink';

const ARROW = 'flex size-7 items-center justify-center rounded-button border border-line font-data text-ui text-ink transition-colors duration-120 ease-snap hover:bg-surface-sunken disabled:opacity-40';

const ALL_PAGES = 'all';
const SOME_PAGES = 'some';

/**
 * The document sniff, as a module constant rather than an inline arrow: it is a
 * dependency of the intake hook's own callbacks, and a new function identity on
 * every render would rebuild them on every render.
 *
 * `pdf` and not `null` is the whole point — sniffImageType has no answer for a
 * PDF and must not be made to have one, because its answer feeds image codecs.
 */
function sniffPdf(bytes) {
    return isPdfSignature(bytes) ? 'pdf' : null;
}

function plural(count, singular, pluralWord) {
    return count === 1 ? singular : pluralWord;
}

/** A refusal from the engine as one sentence: what is wrong, then what to do. */
function refusalText(error) {
    return [error?.message, error?.suggestion].filter(Boolean).join(' ');
}

/**
 * What this row contributes, resolved once and read by three places: the line
 * under the file, whether the button is allowed to be on, and the plan.
 */
function selectionFor(entry) {
    const pageCount = Number(entry?.pageCount);
    const known = Number.isInteger(pageCount) && pageCount > 0;

    if (!known) return { known: false, pageIndices: null, error: null, count: null };
    if (entry.pageMode !== SOME_PAGES) {
        return { known: true, pageIndices: null, error: null, count: pageCount };
    }

    const parsed = parsePageRange(entry.pageRange ?? '', pageCount);

    return parsed.ok
        ? { known: true, pageIndices: parsed.value, error: null, count: parsed.value.length }
        : { known: true, pageIndices: null, error: parsed.error, count: null };
}

export default function MergePdfTool({
    title = 'Merge PDF',
    intro = 'Combine several PDFs into one file, in the order you choose. The documents stay on your device.',
    answer,
    breadcrumb,
    children,
}) {
    // True while the page counts are being read. The button stays off until
    // every file has answered, because a plan built against an unknown page
    // count is a plan nothing has validated.
    const [isReadingPages, setIsReadingPages] = useState(false);

    const upload = useImageUpload({
        accept: MERGE_PDF_INPUT_FORMATS,
        multiple: true,
        // No thumbnail and no dimension probe: a document has neither, and the
        // probe is `new window.Image()`, which would fail every file here and
        // report it as damaged.
        previews: false,
        sniff: sniffPdf,
        rejectWrongType: rejectReason.wrongDocument,
    });

    const submit = useLocalProcess({ op: 'merge' });

    const files = upload.files;

    const totalBytes = useMemo(
        () => files.reduce((sum, entry) => sum + (Number(entry.size) || 0), 0),
        [files],
    );

    const selections = useMemo(() => files.map(selectionFor), [files]);

    const pendingPages = selections.some((selection) => !selection.known);
    const rangeError = selections.some((selection) => selection.error !== null);

    const totalPages = selections.reduce(
        (sum, selection) => sum + (Number.isFinite(selection.count) ? selection.count : 0),
        0,
    );

    const summaryLine = [
        `${files.length} ${plural(files.length, 'PDF', 'PDFs')}`,
        formatFileSize(totalBytes),
        pendingPages
            ? 'reading the pages…'
            : `${totalPages} ${plural(totalPages, 'page', 'pages')} out, in the order below`,
    ].join(' · ');

    const { setError: setUploadError, updateFile, removeFile } = upload;

    /**
     * Opens each accepted file once and records what it holds, or drops it and
     * says why.
     *
     * Sequential rather than Promise.all, for the same reason the intake hook
     * reads its files sequentially: twenty documents parsed at once is twenty
     * buffers resident at once, and the refusals have to arrive in the order
     * the files were chosen so the first bad one is the one named.
     */
    const readPageCounts = useCallback(async (entries) => {
        setIsReadingPages(true);

        for (const entry of entries) {
            try {
                const pageCount = await readPdfPageCount({ source: entry.file, name: entry.name });
                updateFile(entry.id, { pageCount, pageMode: ALL_PAGES, pageRange: '' });
            } catch (error) {
                // Out of the list, not left in it greyed out: a file whose
                // pages cannot be read cannot contribute any, and a row that
                // can never take part is a row that has to be explained.
                removeFile(entry.id);
                setUploadError(refusalText(error) || 'That PDF could not be read.');
            }
        }

        setIsReadingPages(false);
    }, [removeFile, setUploadError, updateFile]);

    const handleFiles = useCallback(async (incoming) => {
        submit.reset();
        const accepted = await upload.selectFiles(incoming);
        if (accepted.length > 0) await readPageCounts(accepted);
        return accepted;
    }, [readPageCounts, submit, upload]);

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
        // The same conditions the button is disabled on. Stated twice on
        // purpose: a disabled button is a hint, not a guarantee.
        if (files.length < 2 || pendingPages || rangeError) return;

        submit.submit({
            file: files.map((entry) => entry.file),
            // One step per file, in the order the rows are in, so the plan and
            // the list a person is looking at are the same statement. A file
            // taking every page passes null, which is exactly what
            // buildDefaultPlan produces — the default path is not a special
            // case here either.
            plan: files.map((entry, index) => ({
                fileIndex: index,
                pageIndices: selections[index].pageIndices,
            })),
        }, {
            originalBytes: totalBytes,
        });
    }, [files, pendingPages, rangeError, selections, submit, totalBytes]);

    const setPageMode = useCallback((id, mode) => {
        submit.reset();
        upload.updateFile(id, { pageMode: mode });
    }, [submit, upload]);

    const setPageRange = useCallback((id, text) => {
        submit.reset();
        upload.updateFile(id, { pageRange: text });
    }, [submit, upload]);

    const panel = (
        <div className="flex flex-col gap-4">
            <Dropzone
                id="merge-file"
                multiple
                label={files.length > 0 ? 'Drop more PDFs here' : `Drop up to ${MAX_BULK_FILES} PDFs here`}
                browseLabel={files.length > 0 ? 'Add more PDFs' : 'Choose PDFs'}
                constraints={upload.constraints}
                accept={upload.accept}
                state={upload.state}
                reason={upload.error}
                onFiles={handleFiles}
                onDragChange={upload.setDragging}
                disabled={upload.isReading || isReadingPages || submit.isProcessing}
            />

            {files.length > 0 ? (
                <>
                    <p className="font-data text-micro text-ink-muted">{summaryLine}</p>

                    {/* Labelled, because "list" is not a useful thing to land on
                        and this one IS the order the pages come out in. */}
                    <ol aria-label="Document order" className="flex flex-col gap-3">
                        {files.map((entry, index) => {
                            const first = index === 0;
                            const last = index === files.length - 1;
                            const selection = selections[index];
                            const rangeId = `merge-pages-${entry.id}`;
                            const takingSome = entry.pageMode === SOME_PAGES;

                            const pageLine = selection.known
                                ? `${entry.pageCount} ${plural(entry.pageCount, 'page', 'pages')}`
                                    + (takingSome && selection.count !== null
                                        ? ` · taking ${selection.count}`
                                        : '')
                                : 'reading the pages…';

                            return (
                                <li key={entry.id} className="flex flex-col gap-2">
                                    <div className="flex items-center gap-3">
                                        <span className="w-6 shrink-0 text-right font-data text-ui tabular-nums text-ink-muted">
                                            <span className="sr-only">Document </span>
                                            {index + 1}
                                        </span>

                                        <FilePreviewCard
                                            className="min-w-0 flex-1"
                                            name={entry.name}
                                            size={entry.size}
                                            format={entry.format}
                                            onRemove={() => handleRemove(entry.id)}
                                            removeLabel="Remove"
                                            meta={(
                                                <p className="font-data text-micro text-ink-muted">{pageLine}</p>
                                            )}
                                        />

                                        {/* A disabled control is still read out,
                                            so the label must not name a position
                                            that does not exist. */}
                                        <div className="flex shrink-0 flex-col gap-1">
                                            <button
                                                type="button"
                                                onClick={() => handleMove(entry.id, -1)}
                                                disabled={first}
                                                aria-label={first
                                                    ? `${entry.name} is already first`
                                                    : `Move ${entry.name} up to position ${index}`}
                                                className={ARROW}
                                            >
                                                <span aria-hidden="true">↑</span>
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => handleMove(entry.id, 1)}
                                                disabled={last}
                                                aria-label={last
                                                    ? `${entry.name} is already last`
                                                    : `Move ${entry.name} down to position ${index + 2}`}
                                                className={ARROW}
                                            >
                                                <span aria-hidden="true">↓</span>
                                            </button>
                                        </div>
                                    </div>

                                    {selection.known ? (
                                        <div className="flex flex-wrap items-start gap-3 pl-9">
                                            <Field
                                                id={`merge-mode-${entry.id}`}
                                                label={`Pages from ${entry.name}`}
                                                labelHidden
                                                className="shrink-0"
                                            >
                                                <select
                                                    id={`merge-mode-${entry.id}`}
                                                    value={entry.pageMode ?? ALL_PAGES}
                                                    onChange={(event) => setPageMode(entry.id, event.target.value)}
                                                    className={SELECT}
                                                >
                                                    <option value={ALL_PAGES}>All pages</option>
                                                    <option value={SOME_PAGES}>Some pages</option>
                                                </select>
                                            </Field>

                                            {takingSome ? (
                                                <Field
                                                    id={rangeId}
                                                    label={`Which pages from ${entry.name}`}
                                                    labelHidden
                                                    hint={`Page numbers and ranges, such as 1-3, 7. This file has ${entry.pageCount}.`}
                                                    error={selection.error}
                                                    className="min-w-[14rem] flex-1"
                                                >
                                                    <input
                                                        id={rangeId}
                                                        type="text"
                                                        inputMode="numeric"
                                                        autoComplete="off"
                                                        placeholder={`1-${Math.min(3, entry.pageCount)}`}
                                                        value={entry.pageRange ?? ''}
                                                        onChange={(event) => setPageRange(entry.id, event.target.value)}
                                                        aria-describedby={fieldDescribedBy(rangeId, {
                                                            hint: true,
                                                            error: selection.error,
                                                        })}
                                                        className={CONTROL}
                                                    />
                                                </Field>
                                            ) : null}
                                        </div>
                                    ) : null}
                                </li>
                            );
                        })}
                    </ol>
                </>
            ) : null}
        </div>
    );

    const outcome = submit.result;

    const footnote = outcome ? [
        `${outcome.pageCount} ${plural(outcome.pageCount, 'page', 'pages')}, in the order shown above.`,
        'The pages were copied across as they are, so nothing was re-drawn and no quality was lost.',
        'The title, author and producer fields of the files that went in are not carried over.',
    ].join(' ') : null;

    const result = outcome ? (
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
    ) : null;

    /**
     * The reason and the fix as one sentence, without saying the fix twice.
     *
     * The two refusal paths in useLocalProcess do not agree about where the fix
     * lives. The capability gate joins its suggestion onto the reason before
     * handing it over (refusalMessage) AND repeats it in `suggestion`; a
     * failure thrown by the engine hands back a bare message with the
     * suggestion only in that second field. Every other tool renders `error`
     * alone, which is fine for them and would be wrong here: the password
     * refusal's whole value is its second half — remove the password in the app
     * that made it — and that half only exists in `suggestion`.
     */
    const panelError = (() => {
        const reason = submit.error;
        const fix = submit.suggestion;
        if (!reason) return null;
        if (!fix || reason.includes(fix)) return reason;
        return `${reason} ${fix}`;
    })();

    return (
        <ToolShell
            slug="merge-pdf"
            title={title}
            intro={intro}
            answer={answer}
            breadcrumb={breadcrumb}
            panel={panel}
            error={panelError}
            privacyNote="Your documents never leave your device — the work happens here, in this browser tab. No account, no watermark."
            action={(
                <ToolAction
                    label={files.length > 1 ? `Combine ${files.length} PDFs` : 'Combine PDFs'}
                    processingLabel="Combining…"
                    isProcessing={submit.isProcessing}
                    progress={submit.progress}
                    disabled={files.length < 2 || upload.isReading || isReadingPages || rangeError}
                    onClick={handleSubmit}
                    onCancel={submit.cancel}
                    hint={files.length < 2 ? 'Add two or more PDFs to turn this on.' : undefined}
                />
            )}
            result={result}
        >
            {children}
        </ToolShell>
    );
}
