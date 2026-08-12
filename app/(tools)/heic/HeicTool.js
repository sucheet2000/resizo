'use client';

/**
 * HeicTool
 *
 * `previews: false` is not an oversight. No browser can decode a HEIC file, so
 * URL.createObjectURL on one produces a broken image element and the dimension
 * probe never fires — the panel shows the format token instead, and the first
 * real preview a visitor sees is the JPG that comes back.
 *
 * The result is almost always LARGER than the input, because HEIC is roughly
 * twice as efficient as JPEG. The panel prints that honestly as a plus figure
 * rather than hiding the number.
 *
 * THIS IS THE ONE TOOL THAT CANNOT MEASURE ITS OWN INPUT
 *
 * Every other tool hands useLocalProcess the width and height useImageUpload
 * read from a preview at intake, so the memory gate can refuse a job before
 * anything allocates. Here there is no preview to read — the same reason
 * `previews: false` is set above — so the dimensions are genuinely unknown and
 * are passed as such rather than as a made-up 0. The gate reads that as
 * `dimensions-unknown`, defers instead of refusing, and the engine re-costs the
 * job against the real size the moment libheif reports it
 * (decodePixels in lib/image-client/operations.js). Sending 0 would instead trip
 * the "this image's dimensions could not be read" refusal and turn every single
 * HEIC away, which is the opposite of the point.
 *
 * No rotation is applied anywhere on this path. HEIF carries its turn as irot
 * and imir properties and libheif applies them itself — see the note above
 * decodeHeic in lib/image-client/decode.js. A second turn here would rotate
 * every affected photo twice.
 */
import ResultPanel from '@/components/tools/ResultPanel';
import ToolShell, { ToolAction } from '@/components/tools/ToolShell';
import Dropzone from '@/components/ui/Dropzone';
import FilePreviewCard from '@/components/ui/FilePreviewCard';
import { HEIC_INPUT_FORMATS } from '@/lib/constants';
import useImageUpload from '@/lib/hooks/useImageUpload';
import useLocalProcess from '@/lib/hooks/useLocalProcess';
import usePreviewUrl from '@/lib/hooks/usePreviewUrl';

export default function HeicTool({
    title = 'Convert HEIC to JPG',
    intro = 'Turn an iPhone HEIC or HEIF photo into a JPG that Windows, Android and every upload form will accept — converted on your device, never uploaded.',
    answer,
    breadcrumb,
    children,
}) {
    const upload = useImageUpload({ accept: HEIC_INPUT_FORMATS, previews: false });
    const preview = usePreviewUrl();
    const submit = useLocalProcess({
        op: 'heic',
        onSuccess: (payload) => preview.show(payload.blob),
    });

    const entry = upload.file;

    const handleReset = () => {
        submit.reset();
        upload.clear();
        preview.clear();
    };

    const handleFiles = (files) => {
        submit.reset();
        preview.clear();
        return upload.selectFiles(files);
    };

    const handleSubmit = () => {
        if (!entry) return;
        const form = new FormData();
        form.append('file', entry.file);
        // Null today and honestly so: no browser gives us a HEIC preview to
        // measure. They are still passed through rather than hard-coded, so if
        // intake ever learns to measure one, the gate gets the real numbers
        // without another change here.
        submit.submit(form, {
            originalBytes: entry.size,
            sourceWidth: entry.width,
            sourceHeight: entry.height,
        });
    };

    const panel = entry ? (
        <FilePreviewCard
            name={entry.name}
            size={entry.size}
            format={entry.format}
            onRemove={handleReset}
            meta={<p className="mt-1 text-micro text-ink-muted">No browser can display a HEIC file, so there is no preview until it is converted.</p>}
        />
    ) : (
        <Dropzone
            id="heic-file"
            label="Drop a HEIC photo here"
            constraints={upload.constraints}
            accept={upload.accept}
            state={upload.state}
            reason={upload.error}
            onFiles={handleFiles}
            onDragChange={upload.setDragging}
            disabled={upload.isReading}
            browseLabel="Browse photos"
        />
    );

    const result = submit.result ? (
        <ResultPanel
            variant="single"
            previewUrl={preview.url}
            alt={`JPG copy of ${entry?.name ?? 'your photo'}`}
            filename={submit.result.filename}
            originalBytes={submit.result.originalBytes}
            resultBytes={submit.result.resultBytes}
            onDownload={() => submit.download()}
            onReset={handleReset}
            downloadLabel="Download JPG"
            footnote="A JPG is normally larger than the HEIC it came from — that is the cost of a format every app can open. Converted at quality 90."
        />
    ) : null;

    return (
        <ToolShell
            slug="heic"
            title={title}
            intro={intro}
            answer={answer}
            breadcrumb={breadcrumb}
            panel={panel}
            error={submit.error}
            action={(
                <ToolAction
                    label="Convert to JPG"
                    processingLabel="Converting…"
                    isProcessing={submit.isProcessing}
                    progress={submit.progress}
                    disabled={!entry}
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
