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
 */
import ResultPanel from '@/components/tools/ResultPanel';
import ToolShell, { ToolAction } from '@/components/tools/ToolShell';
import Dropzone from '@/components/ui/Dropzone';
import FilePreviewCard from '@/components/ui/FilePreviewCard';
import { HEIC_INPUT_FORMATS } from '@/lib/constants';
import useImageUpload from '@/lib/hooks/useImageUpload';
import usePreviewUrl from '@/lib/hooks/usePreviewUrl';
import useToolSubmit from '@/lib/hooks/useToolSubmit';

export default function HeicTool({
    title = 'Convert HEIC to JPG',
    intro = 'Turn an iPhone HEIC or HEIF photo into a JPG that Windows, Android and every upload form will accept.',
    breadcrumb,
    children,
}) {
    const upload = useImageUpload({ accept: HEIC_INPUT_FORMATS, previews: false });
    const preview = usePreviewUrl();
    const submit = useToolSubmit({
        endpoint: '/api/heic',
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
        submit.submit(form, { originalBytes: entry.size });
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
                />
            )}
            result={result}
        >
            {children}
        </ToolShell>
    );
}
