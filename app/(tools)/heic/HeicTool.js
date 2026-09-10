'use client';

/**
 * HeicTool
 *
 * `previews: false` is not an oversight. No browser can decode a HEIC file, so
 * URL.createObjectURL on one produces a broken image element and the dimension
 * probe never fires — the panel shows the format token instead, and the first
 * real preview a visitor sees is the converted file that comes back.
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
 *
 * WHY THERE IS A CHOICE OF OUTPUT AT ALL
 *
 * JPG is the answer to "nothing will open this", which is why it is the
 * default and why a page with no preset still behaves exactly as it always
 * did. PNG answers a different, narrower question — an editor or an upload
 * form that names PNG and takes nothing else — and it is a genuinely worse
 * answer for a photograph, so the control says what it costs rather than
 * presenting the two as equivalent. /heic-to-png preselects it and does NOT
 * lock it: someone who lands there and then wants the small file should not
 * have to go and find another page.
 */
import { useState } from 'react';

import OperationMark from '@/components/tools/OperationMark';
import ResultPanel from '@/components/tools/ResultPanel';
import ToolShell, { ToolAction } from '@/components/tools/ToolShell';
import Dropzone from '@/components/ui/Dropzone';
import FilePreviewCard from '@/components/ui/FilePreviewCard';
import { HEIC_INPUT_FORMATS, HEIC_OUTPUT_FORMATS } from '@/lib/limits';
import { formatLabel } from '@/lib/format/upload-helpers';
import useImageUpload from '@/lib/hooks/useImageUpload';
import useLocalProcess from '@/lib/hooks/useLocalProcess';
import usePreviewUrl from '@/lib/hooks/usePreviewUrl';

/** What the engine writes when the form names nothing — today's behaviour. */
const DEFAULT_FORMAT = 'jpeg';

/**
 * JPG, not JPEG, and only on this tool.
 *
 * formatLabel says JPEG, which is right for /convert: every sentence on
 * /png-to-jpg and /webp-to-jpg tells the visitor to press "Convert to JPEG".
 * This tool's route is /heic-to-jpg, and its page, its intent entry and its
 * how-to steps all say "press Convert to JPG" instead — because that is how
 * someone with an iPhone full of .heic files writes it. A button that
 * disagrees with the sentence telling them to press it is the same defect as
 * a wrong format list, so the spelling is overridden here rather than the copy
 * being rewritten on three pages. Everything else still comes from formatLabel.
 */
const SPELLING = { jpeg: 'JPG' };

/** One line per control: what each format costs, not what it is. */
const OUTPUT_NOTES = {
    jpeg: 'smaller, opens everywhere',
    png: 'lossless, keeps transparency, much larger',
};

const FOOTNOTES = {
    jpeg: 'A JPG is normally larger than the HEIC it came from — that is the cost of a format every app can open. Converted at quality 90.',
    png: 'A PNG stores every decoded pixel exactly, so it is far larger than the HEIC — many times, on a photograph — and nothing is lost on the way. No quality setting applies.',
};

const outputLabel = (format) => SPELLING[format] ?? formatLabel(format);

/** Degrades to the bare token, so a format added to the list is still usable. */
function optionLabel(format) {
    const note = OUTPUT_NOTES[format];
    return note ? `${outputLabel(format)} (${note})` : outputLabel(format);
}

export default function HeicTool({
    preset,
    title = 'Convert HEIC to JPG',
    intro = 'Turn an iPhone HEIC or HEIF photo into a JPG that Windows, Android and every upload form will accept — converted on your device, never uploaded.',
    answer,
    breadcrumb,
    children,
}) {
    const [format, setFormat] = useState(preset?.format ?? DEFAULT_FORMAT);

    const upload = useImageUpload({ accept: HEIC_INPUT_FORMATS, previews: false });
    const preview = usePreviewUrl();
    const submit = useLocalProcess({
        op: 'heic',
        onSuccess: (payload) => preview.show(payload.blob),
    });

    const entry = upload.file;

    /**
     * The result's own format wins while one is on screen, so the download
     * label and the footnote always describe the file that is actually there.
     * Before a run there is nothing to read but the control.
     */
    const outputFormat = submit.result?.format ?? format;

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

    /**
     * The file stays; the finished job does not. A result panel left standing
     * under a changed control prints the byte figures of a conversion that is
     * no longer the one being offered, which is worse than showing nothing.
     */
    const handleFormatChange = (next) => {
        submit.reset();
        preview.clear();
        setFormat(next);
    };

    const handleSubmit = () => {
        if (!entry) return;
        const form = new FormData();
        form.append('file', entry.file);
        form.append('format', format);
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

    const settings = (
        <fieldset className="flex flex-col gap-2">
            <legend className="text-ui text-ink">Save as</legend>
            <div className="flex flex-wrap gap-x-6 gap-y-2">
                {HEIC_OUTPUT_FORMATS.map((option) => (
                    <label key={option} className="flex items-center gap-2 text-ui text-ink">
                        <input
                            type="radio"
                            name="heic-format"
                            value={option}
                            checked={format === option}
                            onChange={() => handleFormatChange(option)}
                            className="size-4 accent-[var(--accent)]"
                        />
                        {optionLabel(option)}
                    </label>
                ))}
            </div>
        </fieldset>
    );

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
            alt={`${outputLabel(outputFormat)} copy of ${entry?.name ?? 'your photo'}`}
            filename={submit.result.filename}
            originalBytes={submit.result.originalBytes}
            resultBytes={submit.result.resultBytes}
            onDownload={() => submit.download()}
            onReset={handleReset}
            downloadLabel={`Download ${outputLabel(outputFormat)}`}
            footnote={FOOTNOTES[outputFormat] ?? null}
        />
    ) : null;

    return (
        <ToolShell
            preset={preset}
            slug="heic"
            title={title}
            intro={intro}
            answer={answer}
            // The registry mark reads HEIC→JPG, which is the wrong operation on
            // a page that writes a PNG. It follows the choice instead, and the
            // node form is used rather than the string one so the sr-only name
            // survives — a bare `mark` prop drops it.
            mark={<OperationMark mark={`HEIC→${outputLabel(outputFormat)}`} label={`Convert HEIC to ${outputLabel(outputFormat)}`} size="lead" />}
            breadcrumb={breadcrumb}
            settingsLabel="Format settings"
            settings={settings}
            panel={panel}
            error={submit.error}
            action={(
                <ToolAction
                    label={`Convert to ${outputLabel(outputFormat)}`}
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
