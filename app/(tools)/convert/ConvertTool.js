'use client';

/**
 * ConvertTool
 *
 * A from/to pair, not a row of format buttons. The `from` value narrows what
 * the drop zone will accept, so a PNG-to-JPG page rejects a WebP at the point
 * of drop with a reason, instead of at the server with a 400.
 *
 * `preset` locks the pair for the long-tail routes (/png-to-jpg and friends).
 * A locked pair always ships a visible way out — a link back to the open
 * converter — because a page that silently refuses every other format is a
 * dead end.
 *
 * WHERE THE CONVERSION HAPPENS
 *
 * On this device, through useLocalProcess, and nowhere else. Nothing is
 * uploaded, so a file the device cannot handle is refused in the capability
 * gate's own words rather than sent somewhere it might have worked.
 *
 * The dimensions are not optional. The memory gate inside the hook has to cost
 * the job BEFORE anything decodes — on iOS a tab that over-commits is killed
 * with nothing to catch — and useImageUpload has already measured the file at
 * intake, so there is nothing to pay for passing them on.
 *
 * Nothing here names a format. Both menus and every sentence around them are
 * built from lib/limits.js through ./formats.js.
 */
import Link from 'next/link';
import { useMemo, useState } from 'react';

import ResultPanel from '@/components/tools/ResultPanel';
import TransparencyBackground from '@/components/tools/TransparencyBackground';
import ToolShell, { ToolAction } from '@/components/tools/ToolShell';
import Dropzone from '@/components/ui/Dropzone';
import Field from '@/components/ui/Field';
import FilePreviewCard from '@/components/ui/FilePreviewCard';
import { formatKeepsAlpha } from '@/lib/image-client/flatten';
import { CONVERT_INPUT_FORMATS, CONVERT_OUTPUT_FORMATS } from '@/lib/limits';
import { formatLabel } from '@/lib/format/upload-helpers';
import useImageUpload from '@/lib/hooks/useImageUpload';
import useLocalProcess from '@/lib/hooks/useLocalProcess';
import usePreviewUrl from '@/lib/hooks/usePreviewUrl';
import { inputFormatsProse } from './formats';

const CONTROL = 'w-full rounded-input border border-line bg-surface-raised px-3 py-2 font-data text-ui text-ink';

const PLAIN_TO_HINT = 'WebP is usually the smallest of these at the same quality.';

/**
 * Two different sentences for two different registry states, chosen by what
 * CONVERT_OUTPUT_FORMATS actually contains rather than by which build this is
 * — so this stays true both before and after AVIF joins that list. AVIF is
 * "often smaller still", never "the smallest": the format comparison table
 * this page also renders is measured to say it is not always smaller than
 * WebP, and a hint that overclaimed would disagree with its own page.
 */
function toHint(outputFormats) {
    return outputFormats.includes('avif')
        ? 'WebP is usually the smallest of the classic three at the same quality; AVIF is often smaller '
            + 'still but slower to write, and not every app opens it.'
        : PLAIN_TO_HINT;
}

export default function ConvertTool({
    preset,
    title = 'Convert Image Format Online',
    intro = `Turn a ${inputFormatsProse('or')} into any of the others. One file, one pass, no upload and no account.`,
    answer,
    breadcrumb,
    children,
}) {
    const locked = Boolean(preset?.from && preset?.to);

    const [from, setFrom] = useState(preset?.from ?? '');
    const [requestedTo, setTo] = useState(preset?.to ?? 'webp');

    const accept = useMemo(() => (from ? [from] : CONVERT_INPUT_FORMATS), [from]);

    // White, the engine's own default — see lib/image-client/flatten.js. The
    // panel and the engine have to open on the same colour or a visitor who
    // never touches the control gets one answer and the copy promises another.
    const [background, setBackground] = useState('white');

    const upload = useImageUpload({ accept });
    const preview = usePreviewUrl();
    const submit = useLocalProcess({
        op: 'convert',
        onSuccess: (payload) => preview.show(payload.blob),
    });

    const entry = upload.file;
    /**
     * The output is what was asked for unless the dropped file already IS that
     * format. Detect mode has no From to move away from, so the file's own
     * sniffed format is the one To must not equal: an AVIF dropped while AVIF
     * is chosen would otherwise be decoded and re-encoded for nothing, and the
     * single converter never copies a file unchanged the way the bulk lane
     * does. Derived rather than stored, so removing the file restores the
     * choice and nothing is written to state in an effect.
     */
    const to = entry?.format && entry.format === requestedTo
        ? (CONVERT_OUTPUT_FORMATS.find((format) => format !== entry.format) ?? requestedTo)
        : requestedTo;
    /**
     * Only when it can matter. The output has to be a format that drops alpha,
     * and the SOURCE has to be one that could carry it — a JPEG source has no
     * transparency to place, so offering the choice there teaches people to
     * ignore the control. `from` is the declared pair on a long-tail page and
     * empty on /convert itself, where the file's own sniffed format decides.
     */
    const sourceFormat = from || entry?.format || null;
    const sourceCouldHaveAlpha = sourceFormat ? formatKeepsAlpha(sourceFormat) : true;
    const flattens = sourceCouldHaveAlpha && !formatKeepsAlpha(to);

    const handleReset = () => {
        submit.reset();
        upload.clear();
        preview.clear();
    };

    const handleFromChange = (next) => {
        setFrom(next);
        if (next && next === to) {
            setTo(CONVERT_OUTPUT_FORMATS.find((format) => format !== next) ?? to);
        }
        handleReset();
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
        form.append('target_format', to);
        if (flattens) form.append('background', background);
        submit.submit(form, {
            originalBytes: entry.size,
            sourceWidth: entry.width,
            sourceHeight: entry.height,
        });
    };

    const backgroundControl = flattens ? (
        <TransparencyBackground
            value={background}
            onChange={(next) => { submit.reset(); setBackground(next); }}
            className="mt-5 border-t border-line pt-4"
        />
    ) : null;

    const formatChoice = locked ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="font-data text-lead text-ink">
                {formatLabel(from)}
                <span aria-hidden="true" className="px-2 text-accent">→</span>
                <span className="sr-only"> to </span>
                {formatLabel(to)}
            </p>
            <Link
                href="/convert"
                className="rounded-input text-ui font-medium text-accent underline underline-offset-4 transition-[text-decoration-thickness] duration-120 ease-snap hover:decoration-2"
            >
                Convert a different pair
                <span aria-hidden="true">&nbsp;→</span>
            </Link>
        </div>
    ) : (
        <div className="grid gap-4 sm:grid-cols-2 sm:max-w-lg">
            <Field id="convert-from" label="From" hint={`Leave on Detect to accept ${inputFormatsProse('or')}.`}>
                <select
                    id="convert-from"
                    value={from}
                    onChange={(event) => handleFromChange(event.target.value)}
                    aria-describedby="convert-from-hint"
                    className={CONTROL}
                >
                    <option value="">Detect from file</option>
                    {CONVERT_INPUT_FORMATS.map((format) => (
                        <option key={format} value={format}>{formatLabel(format)}</option>
                    ))}
                </select>
            </Field>

            <Field id="convert-to" label="To" hint={toHint(CONVERT_OUTPUT_FORMATS)}>
                <select
                    id="convert-to"
                    value={to}
                    onChange={(event) => { setTo(event.target.value); submit.reset(); }}
                    aria-describedby="convert-to-hint"
                    className={CONTROL}
                >
                    {CONVERT_OUTPUT_FORMATS.filter((format) => format !== from && format !== entry?.format).map((format) => (
                        <option key={format} value={format}>{formatLabel(format)}</option>
                    ))}
                </select>
            </Field>
        </div>
    );

    // One place, so the control cannot appear on the /convert form and go
    // missing on the long-tail pages that are the actual PNG-to-JPG route.
    const settings = (
        <>
            {formatChoice}
            {backgroundControl}
        </>
    );

    const panel = entry ? (
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
            id="convert-file"
            label={from ? `Drop a ${formatLabel(from)} here` : 'Drop an image here'}
            constraints={upload.constraints}
            accept={upload.accept}
            state={upload.state}
            reason={upload.error}
            onFiles={handleFiles}
            onDragChange={upload.setDragging}
            disabled={upload.isReading}
        />
    );

    // Set only by a decode that actually read a higher bit depth off the
    // header (AVIF can carry 10 or 12); everything else stays 8-bit and this
    // stays empty. AVIF is encoded 8-bit only, so a 10/12-bit source is
    // genuinely narrowed on the way out, which is worth saying rather than
    // leaving the payoff numeral to imply nothing changed but the container.
    const bitDepthNote = submit.result?.sourceBitDepth > 8
        ? ` ${submit.result.sourceBitDepth}-bit source decoded to 8-bit.`
        : '';

    const isAvifOutput = to === 'avif';

    const result = submit.result ? (
        <ResultPanel
            variant="single"
            previewUrl={preview.url}
            alt={`${formatLabel(to)} copy of ${entry?.name ?? 'your image'}`}
            filename={submit.result.filename}
            originalBytes={submit.result.originalBytes}
            resultBytes={submit.result.resultBytes}
            width={entry?.width}
            height={entry?.height}
            onDownload={() => submit.download()}
            onReset={handleReset}
            downloadLabel={`Download ${formatLabel(to)}`}
            footnote={`${formatLabel(entry?.format)} → ${formatLabel(to)} at the same pixel dimensions.${bitDepthNote}`}
        />
    ) : null;

    return (
        <ToolShell
            preset={preset}
            slug="convert"
            title={title}
            intro={intro}
            answer={answer}
            mark={locked ? `${formatLabel(from)}→${formatLabel(to)}` : `→${formatLabel(to)}`}
            breadcrumb={breadcrumb}
            settingsLabel="Format settings"
            settings={settings}
            panel={panel}
            error={submit.error}
            action={(
                <ToolAction
                    label={`Convert to ${formatLabel(to)}`}
                    // The engine reports two fixed stage numbers for an AVIF
                    // encode (65, then 95), not a continuous measurement — see
                    // ToolShell's own note on hideProgress — so this is the one
                    // output format whose action names the codec rather than
                    // showing a percentage that would jump without warning.
                    processingLabel={isAvifOutput ? 'Encoding AVIF…' : 'Converting…'}
                    hideProgress={isAvifOutput}
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
