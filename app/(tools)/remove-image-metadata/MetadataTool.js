'use client';

/**
 * MetadataTool
 *
 * The one tool whose job is to look inside a personal file and describe it,
 * which makes it the one tool where the interesting failure is a PRIVACY
 * failure rather than a wiring one.
 *
 * THE READOUT NAMES CATEGORIES AND NEVER VALUES
 *
 * inspectMetadata hands back `{ id, count, removable }` per block and nothing
 * else, and this page renders `id` through a fixed table of sentences. That is
 * deliberate on both sides: a panel that helpfully printed "51.5074, -0.1278"
 * or "Canon EOS R5" would have published the exact thing the visitor came here
 * to delete, on their screen, in a browser they may not own — a coffee-shop
 * laptop, a shared desktop, a screen-shared call. Telling someone their photo
 * carries coordinates is the whole service; telling them WHICH coordinates is
 * a leak wearing the costume of a feature.
 *
 * So there is no rendering path from a value to the DOM, and there is no id
 * that reaches the screen raw either — an id with no sentence falls back to a
 * generic label rather than printing itself.
 *
 * WHY THE FILE IS INSPECTED THE MOMENT IT LANDS
 *
 * A person decides whether to strip a photo by being told what is in it. Doing
 * that after the job has run answers the question too late to be a decision.
 * inspectMetadata walks the container and allocates nothing, so it is cheap
 * enough to run on the main thread at intake — see its own note. It reads the
 * WHOLE file, not the head: a trailer sits after the picture by definition.
 *
 * THERE ARE NO SETTINGS, AND THAT IS THE FEATURE
 *
 * Every removable block goes. A quality control, a format control or a
 * per-category checkbox would all imply the picture is being re-encoded, and it
 * is not — the compressed image data is copied through byte for byte. The panel
 * says so in one line where the settings would otherwise be, because a tool
 * with a bare drop zone and no explanation reads as unfinished.
 */
import { useRef, useState } from 'react';

import ResultPanel from '@/components/tools/ResultPanel';
import ToolShell, { ToolAction } from '@/components/tools/ToolShell';
import Dropzone from '@/components/ui/Dropzone';
import FilePreviewCard from '@/components/ui/FilePreviewCard';
import { formatFileSize } from '@/lib/format/bytes';
import useImageUpload from '@/lib/hooks/useImageUpload';
import useLocalProcess from '@/lib/hooks/useLocalProcess';
import usePreviewUrl from '@/lib/hooks/usePreviewUrl';
import { inspectMetadata } from '@/lib/image-client/metadata-strip';
import { METADATA_INPUT_FORMATS } from '@/lib/limits';

const READOUT_HEADING_ID = 'metadata-readout';

/**
 * One sentence per category id, and the ORDER the list is rendered in.
 *
 * Ordering here rather than trusting the report means the list reads the same
 * way every time regardless of where in the container a block happened to sit,
 * and it is roughly "how much this says about a person": the Exif block and the
 * coordinates inside it first, container housekeeping last, the colour profile
 * at the end because it is the one entry reported without being removed.
 */
const CATEGORY_LABELS = {
    exif: 'Camera and capture data (EXIF)',
    gps: 'Location (GPS coordinates)',
    thumbnail: 'Embedded preview thumbnail',
    xmp: 'Editing history, keywords and ratings (XMP)',
    iptc: 'Captions and credits (IPTC)',
    comment: 'Comments',
    trailer: 'Extra data appended after the picture',
    text: 'Text chunks',
    time: 'Last-modified time',
    other: 'Other application blocks',
    icc: 'Colour profile (ICC)',
};

const CATEGORY_ORDER = Object.keys(CATEGORY_LABELS);

const FALLBACK_ERROR = 'That file could not be read well enough to say what it carries.';

/**
 * A category with no sentence of its own is still described, never printed as
 * its id. An engine that learns to report something new shows up as a vague
 * row rather than as jargon out of a source file.
 */
function labelFor(id) {
    return CATEGORY_LABELS[id] ?? CATEGORY_LABELS.other;
}

function rank(id) {
    const index = CATEGORY_ORDER.indexOf(id);
    return index === -1 ? CATEGORY_ORDER.length : index;
}

function ordered(found) {
    return [...(found ?? [])].sort((left, right) => rank(left.id) - rank(right.id));
}

function labelList(blocks) {
    return ordered(blocks).map((block) => labelFor(block.id)).join(', ');
}

/**
 * THE PAYOFF FIGURE, AND WHY IT IS NOT THE BYTE SAVING.
 *
 * ResultPanel's default oversized numeral answers "how much smaller?", which is
 * the right question for six of the seven tools and loudly the wrong one here:
 * taking a GPS block out of a 4 MB photo saves a few hundred bytes, so the one
 * moment the product has to prove it worked would print "−0%" over a job that
 * did exactly what it was asked. Its screen-reader suffix is worse — it
 * announces a successful redaction as a compression that achieved nothing.
 *
 * The count of blocks removed is what the visitor came for, so it takes the
 * slot. The before/after byte pair underneath is untouched: those are still the
 * truth about the file, and what goes is only the framing that called their
 * difference a saving.
 */
function resultPayoff(result) {
    const count = (result?.removed ?? []).reduce((sum, block) => sum + (Number(block.count) || 0), 0);

    return {
        value: `${count} ${count === 1 ? 'block' : 'blocks'}`,
        label: count > 0 ? 'Removed from the file' : 'Nothing to remove',
    };
}

/**
 * The sentence under the result: what went, what stayed, and the fact the
 * pixels did not move. Built from the RESULT rather than from the report taken
 * at intake, so it always describes the file behind the Download button.
 */
function resultFootnote(result) {
    const removed = result?.removed ?? [];
    const kept = result?.kept ?? [];

    if (removed.length === 0) {
        return 'This file carried nothing to remove; the download is a copy.';
    }

    const parts = [`Removed: ${labelList(removed)}.`];

    if (kept.length > 0) {
        parts.push(`Kept: ${labelList(kept)}, because removing it would change how the colours display.`);
    }

    const saved = (Number(result?.originalBytes) || 0) - (Number(result?.resultBytes) || 0);
    parts.push(saved > 0
        ? `The compressed picture data was not touched — the pixels are the same bytes you gave in, ${formatFileSize(saved)} smaller without the blocks.`
        : 'The compressed picture data was not touched — the pixels are the same bytes you gave in.');

    return parts.join(' ');
}

export default function MetadataTool({
    title = 'Remove Image Metadata',
    intro = 'Take the camera model, the GPS coordinates and the editing history out of a JPEG, PNG or WebP — the picture itself is copied through untouched, on your own device.',
    answer,
    breadcrumb,
    children,
}) {
    const [report, setReport] = useState(null);
    const [inspectError, setInspectError] = useState(null);

    const upload = useImageUpload({ accept: METADATA_INPUT_FORMATS });
    const preview = usePreviewUrl();
    const submit = useLocalProcess({
        op: 'strip',
        onSuccess: (payload) => preview.show(payload.blob),
    });

    // Two files picked in quick succession finish reading in whichever order
    // the disk feels like. Without this the first file's report can land last
    // and describe a file that is no longer on screen.
    const inspection = useRef(0);

    const entry = upload.file;
    const rows = ordered(report?.found);
    const removable = rows.filter((row) => row.removable);
    const canRemove = Boolean(entry) && !inspectError && removable.length > 0;

    const clearReport = () => {
        inspection.current += 1;
        setReport(null);
        setInspectError(null);
    };

    const handleReset = () => {
        submit.reset();
        upload.clear();
        preview.clear();
        clearReport();
    };

    const handleFiles = async (files) => {
        submit.reset();
        preview.clear();
        clearReport();

        const token = inspection.current;
        const accepted = await upload.selectFiles(files);
        const chosen = accepted[0];
        if (!chosen || inspection.current !== token) return accepted;

        try {
            // The whole file, not a slice: a trailer sits after the picture, so
            // a head-only read would report a clean file that is not one.
            const bytes = new Uint8Array(await chosen.file.arrayBuffer());
            const found = inspectMetadata(bytes);
            if (inspection.current === token) setReport(found);
        } catch (failure) {
            if (inspection.current === token) setInspectError(failure?.message || FALLBACK_ERROR);
        }

        return accepted;
    };

    const handleSubmit = () => {
        if (!canRemove) return;
        const form = new FormData();
        form.append('file', entry.file);
        submit.submit(form, {
            originalBytes: entry.size,
            sourceWidth: entry.width,
            sourceHeight: entry.height,
        });
    };

    const readout = entry && !inspectError && report ? (
        <div role="status" className="rounded-panel border border-line bg-surface-sunken p-4">
            {rows.length > 0 ? (
                <>
                    <h2 id={READOUT_HEADING_ID} className="text-ui font-semibold text-ink">
                        What this file carries
                    </h2>

                    <ul aria-labelledby={READOUT_HEADING_ID} className="mt-2 flex flex-col gap-1.5">
                        {rows.map((row) => (
                            <li key={row.id} className="text-ui text-ink">
                                {labelFor(row.id)}
                                {row.count > 1 ? (
                                    <>
                                        {' '}
                                        <span className="font-data tabular-nums text-ink-muted">×{row.count}</span>
                                    </>
                                ) : null}
                                {row.removable ? null : (
                                    <span className="text-ink-muted"> — kept, so colours still display the same</span>
                                )}
                            </li>
                        ))}
                    </ul>

                    <p className="mt-3 text-micro text-ink-muted">
                        Only the file’s own descriptive blocks are listed — the picture itself is not read, and no value is shown here or anywhere else.
                    </p>
                </>
            ) : null}

            {removable.length === 0 ? (
                <p className={`text-ui text-ink${rows.length > 0 ? ' mt-3' : ''}`}>
                    {rows.length > 0
                        ? 'Nothing to remove — every block listed here is one that has to stay for the picture to display correctly.'
                        : 'Nothing to remove — this file carries no metadata blocks.'}
                </p>
            ) : null}
        </div>
    ) : null;

    const panel = (
        <div className="flex flex-col gap-4">
            <p className="text-ui text-ink-muted">
                There is nothing to set here: every block that can go, goes, and the picture is copied through untouched.
            </p>

            {entry ? (
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
                    id="metadata-file"
                    label="Drop a JPEG, PNG or WebP here"
                    constraints={upload.constraints}
                    accept={upload.accept}
                    state={upload.state}
                    reason={upload.error}
                    onFiles={handleFiles}
                    onDragChange={upload.setDragging}
                    disabled={upload.isReading}
                    browseLabel="Browse images"
                />
            )}

            {readout}
        </div>
    );

    const result = submit.result ? (
        <ResultPanel
            variant="single"
            previewUrl={preview.url}
            alt={`${entry?.name ?? 'Your image'} with its metadata removed`}
            filename={submit.result.filename}
            originalBytes={submit.result.originalBytes}
            resultBytes={submit.result.resultBytes}
            width={submit.result.width}
            height={submit.result.height}
            onDownload={() => submit.download()}
            onReset={handleReset}
            downloadLabel="Download clean image"
            payoff={resultPayoff(submit.result)}
            footnote={resultFootnote(submit.result)}
        />
    ) : null;

    return (
        <ToolShell
            slug="remove-image-metadata"
            title={title}
            intro={intro}
            answer={answer}
            breadcrumb={breadcrumb}
            panel={panel}
            error={inspectError ?? submit.error}
            action={(
                <ToolAction
                    label="Remove metadata"
                    processingLabel="Rewriting…"
                    isProcessing={submit.isProcessing}
                    progress={submit.progress}
                    disabled={!canRemove}
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
