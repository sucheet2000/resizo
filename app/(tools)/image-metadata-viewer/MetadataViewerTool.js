'use client';

/**
 * MetadataViewerTool
 *
 * The one tool on the site that hands back nothing. Every control here is a
 * question about a file already on the visitor's device, never a job posted
 * anywhere: `file.arrayBuffer()` reads the bytes, `inspectImageMetadata` walks
 * them on the main thread, and the result is a report rendered as text. There
 * is no useLocalProcess, no worker and no decode, because nothing here needs
 * a pixel — only the descriptive blocks around the picture.
 *
 * WHY HEIC IS LET PAST THE DROP ZONE'S OWN FORMAT GATE
 *
 * useImageUpload's accept list normally IS the drop zone's constraint line and
 * its rejection message, so a format outside it is refused before this
 * component sees it. HEIC is a real, nameable case here rather than a bare
 * "wrong format": inspectImageMetadata reports it as
 * `{ code: 'unsupported', format: 'heic' }` specifically so the panel can
 * point at /heic instead of a generic "pick a JPEG, PNG or WebP" sentence. So
 * the intake list quietly widens to include it (no thumbnail, no dimension
 * probe — `previews: false` skips that for every format, since every number
 * this page shows comes from the report, never from a browser decode), while
 * the DROP ZONE's own visible constraints and its generic wrong-type message
 * are built from METADATA_INPUT_FORMATS directly, so neither ever advertises
 * HEIC as something this tool actually reads.
 *
 * WHY DIMENSIONS COME FROM THE REPORT, NEVER FROM A DECODE
 *
 * useImageUpload can measure a file by loading it into an `<img>`, but that
 * depends on the browser being ABLE to decode it — and this tool's whole job
 * is to describe a file independently of whether it decodes cleanly. Turning
 * that probe off and reading width/height off `readImageSize` (inside the
 * report) means a structurally odd but readable file still gets a full
 * report instead of a bare "could not be read".
 */
import { useRef, useState } from 'react';
import Link from 'next/link';

import MetadataReport from './MetadataReport';
import ToolShell from '@/components/tools/ToolShell';
import Alert from '@/components/ui/Alert';
import Dropzone from '@/components/ui/Dropzone';
import FilePreviewCard from '@/components/ui/FilePreviewCard';
import { acceptAttribute, constraintsLine, rejectReason } from '@/lib/format/upload-helpers';
import useImageUpload from '@/lib/hooks/useImageUpload';
import usePreviewUrl from '@/lib/hooks/usePreviewUrl';
import { inspectImageMetadata } from '@/lib/image-client/metadata-report';
import { MAX_FILE_SIZE, METADATA_INPUT_FORMATS } from '@/lib/limits';

const SAMPLE_BUTTON = 'inline-flex min-h-11 items-center justify-center rounded-button border border-line bg-surface-raised px-3 text-ui font-medium text-ink transition-colors duration-120 ease-snap hover:bg-surface-sunken';

const HEIC_LINK = 'rounded-input font-medium text-accent underline underline-offset-4 transition-[text-decoration-thickness] duration-120 ease-snap hover:decoration-2';

const SAMPLE = { src: '/samples/metadata-sample.jpg', name: 'metadata-sample.jpg' };

// The drop zone widens its own sniff-acceptance to let a HEIC file structurally
// through so inspectImageMetadata can give its specific refusal (see the file
// note above) — but the visible constraints and the generic wrong-type
// message are built from this narrower list, never the widened one.
const INTAKE_FORMATS = [...METADATA_INPUT_FORMATS, 'heic'];

const REVOKE_DELAY_MS = 1500;

const FALLBACK_ERROR = 'This file could not be read well enough to report on.';

function triggerDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.rel = 'noopener';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS);
}

/** The report minus raw[] and xmp.packet — see DESIGN note in the plan: a
 * value shown nowhere on screen should not sit inside a downloaded file either. */
function buildDownloadPayload(report) {
    const payload = { ...report };
    delete payload.raw;
    if (payload.xmp) {
        payload.xmp = { ...payload.xmp };
        delete payload.xmp.packet;
    }
    return payload;
}

function baseNameFor(name) {
    const stem = String(name ?? '').replace(/\.[^./]+$/, '');
    return stem || 'image';
}

/** The refusal's sentence, plus — for HEIC only — a link to the tool that can
 * actually take it. Every other refusal (too large, not an image, a damaged
 * file) is just its own sentence. */
function RefusalMessage({ refusal }) {
    if (!refusal) return null;

    if (refusal.format === 'heic') {
        return (
            <>
                {refusal.message}
                {' '}
                <Link href="/heic" className={HEIC_LINK}>
                    Convert it with HEIC to JPG first, then inspect the result.
                </Link>
            </>
        );
    }

    return refusal.message;
}

export default function MetadataViewerTool({
    title = 'View Image Metadata',
    intro = 'See the EXIF, GPS, XMP and colour-profile data a JPEG, PNG or WebP carries — read on your own device, nothing is changed and nothing is uploaded.',
    answer,
    breadcrumb,
    children,
}) {
    const [report, setReport] = useState(null);
    const [refusal, setRefusal] = useState(null);
    const [isInspecting, setIsInspecting] = useState(false);

    // A second file chosen while the first is still being read must not have
    // its report land after the file that is now on screen.
    const inspectionRef = useRef(0);

    const upload = useImageUpload({
        accept: INTAKE_FORMATS,
        previews: false,
        rejectWrongType: () => rejectReason.wrongType(METADATA_INPUT_FORMATS),
    });
    const preview = usePreviewUrl();

    const entry = upload.file;

    const clearReport = () => {
        inspectionRef.current += 1;
        setReport(null);
        setRefusal(null);
        setIsInspecting(false);
    };

    const focusBrowse = () => {
        setTimeout(() => document.getElementById('meta-file-browse')?.focus(), 0);
    };

    const handleReset = () => {
        upload.clear();
        preview.clear();
        clearReport();
        focusBrowse();
    };

    const handleFiles = async (files) => {
        preview.clear();
        clearReport();

        const token = inspectionRef.current;
        const accepted = await upload.selectFiles(files);
        const chosen = accepted[0];
        if (!chosen || inspectionRef.current !== token) return accepted;

        setIsInspecting(true);

        try {
            const bytes = new Uint8Array(await chosen.file.arrayBuffer());
            if (inspectionRef.current !== token) return accepted;

            const result = inspectImageMetadata(bytes, { name: chosen.name });
            if (inspectionRef.current !== token) return accepted;

            if (result.ok) {
                setReport(result);
                preview.show(chosen.file);
            } else {
                setRefusal(result);
            }
        } catch (failure) {
            if (inspectionRef.current === token) {
                setRefusal({ code: 'invalid', message: failure?.message || FALLBACK_ERROR });
            }
        } finally {
            if (inspectionRef.current === token) setIsInspecting(false);
        }

        return accepted;
    };

    const loadSample = async () => {
        try {
            const response = await fetch(SAMPLE.src);
            if (!response.ok) throw new Error('sample unavailable');
            const blob = await response.blob();
            await handleFiles([new File([blob], SAMPLE.name, { type: 'image/jpeg' })]);
        } catch {
            upload.setError('That sample could not be loaded. Try again, or use a photo of your own.');
        }
    };

    const handleDownload = (fullReport) => {
        const payload = buildDownloadPayload(fullReport);
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
        triggerDownload(blob, `${baseNameFor(fullReport.file.name)}-metadata.json`);
    };

    const panelError = upload.error ?? (refusal ? <RefusalMessage refusal={refusal} /> : null);

    const panel = entry ? (
        <div className="flex flex-col gap-4">
            <FilePreviewCard
                name={entry.name}
                size={report?.file?.bytes ?? entry.size}
                format={report?.file?.format ?? entry.format}
                width={report?.file?.width}
                height={report?.file?.height}
                previewUrl={preview.url}
                onRemove={handleReset}
            />

            {isInspecting ? <p role="status" className="text-ui text-ink-muted">Reading…</p> : null}

            {panelError ? <Alert id="meta-error">{panelError}</Alert> : null}

            {report ? (
                <MetadataReport report={report} onDownload={handleDownload} onReset={handleReset} />
            ) : null}
        </div>
    ) : (
        <Dropzone
            id="meta-file"
            label="Drop a JPEG, PNG or WebP here"
            constraints={constraintsLine({ formats: METADATA_INPUT_FORMATS, maxBytes: MAX_FILE_SIZE })}
            accept={acceptAttribute(METADATA_INPUT_FORMATS)}
            state={upload.state}
            reason={upload.error}
            onFiles={handleFiles}
            onDragChange={upload.setDragging}
            disabled={upload.isReading || isInspecting}
            browseLabel="Browse images"
        >
            <div className="mt-2 flex flex-col items-center gap-2">
                <p className="text-micro text-ink-muted">No image to hand?</p>
                <button type="button" onClick={loadSample} className={SAMPLE_BUTTON}>
                    Try the sample photo
                </button>
            </div>
        </Dropzone>
    );

    return (
        <ToolShell
            slug="image-metadata-viewer"
            title={title}
            intro={intro}
            answer={answer}
            breadcrumb={breadcrumb}
            panel={panel}
        >
            {children}
        </ToolShell>
    );
}
