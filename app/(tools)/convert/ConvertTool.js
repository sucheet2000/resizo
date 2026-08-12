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
 * converter — because a page that silently refuses three of the four formats
 * is a dead end.
 */
import Link from 'next/link';
import { useMemo, useState } from 'react';

import ResultPanel from '@/components/tools/ResultPanel';
import ToolShell, { ToolAction } from '@/components/tools/ToolShell';
import Dropzone from '@/components/ui/Dropzone';
import Field from '@/components/ui/Field';
import FilePreviewCard from '@/components/ui/FilePreviewCard';
import { CONVERT_INPUT_FORMATS, CONVERT_OUTPUT_FORMATS } from '@/lib/constants';
import { formatLabel } from '@/lib/hooks/upload-helpers';
import useImageUpload from '@/lib/hooks/useImageUpload';
import usePreviewUrl from '@/lib/hooks/usePreviewUrl';
import useToolSubmit from '@/lib/hooks/useToolSubmit';

const CONTROL = 'w-full rounded-input border border-line bg-surface-raised px-3 py-2 font-data text-ui text-ink';

export default function ConvertTool({
    preset,
    title = 'Convert Image Format Online',
    intro = 'Turn a JPEG, PNG, WebP or AVIF into any of the other three. One file, one pass, no account.',
    breadcrumb,
    children,
}) {
    const locked = Boolean(preset?.from && preset?.to);

    const [from, setFrom] = useState(preset?.from ?? '');
    const [to, setTo] = useState(preset?.to ?? 'webp');

    const accept = useMemo(() => (from ? [from] : CONVERT_INPUT_FORMATS), [from]);
    const upload = useImageUpload({ accept });
    const preview = usePreviewUrl();
    const submit = useToolSubmit({
        endpoint: '/api/convert',
        onSuccess: (payload) => preview.show(payload.blob),
    });

    const entry = upload.file;

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
        submit.submit(form, { originalBytes: entry.size });
    };

    const settings = locked ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="font-data text-lead text-ink">
                {formatLabel(from)}
                <span aria-hidden="true" className="px-2 text-accent">→</span>
                <span className="sr-only"> to </span>
                {formatLabel(to)}
            </p>
            <Link
                href="/convert"
                className="rounded-input text-ui font-medium text-accent underline underline-offset-4 transition-opacity duration-120 ease-snap hover:opacity-80"
            >
                Convert a different pair
                <span aria-hidden="true"> →</span>
            </Link>
        </div>
    ) : (
        <div className="grid gap-4 sm:grid-cols-2 sm:max-w-lg">
            <Field id="convert-from" label="From" hint="Leave on Detect to accept any of the four.">
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

            <Field id="convert-to" label="To" hint="WebP is the smallest of the four at the same quality.">
                <select
                    id="convert-to"
                    value={to}
                    onChange={(event) => { setTo(event.target.value); submit.reset(); }}
                    aria-describedby="convert-to-hint"
                    className={CONTROL}
                >
                    {CONVERT_OUTPUT_FORMATS.filter((format) => format !== from).map((format) => (
                        <option key={format} value={format}>{formatLabel(format)}</option>
                    ))}
                </select>
            </Field>
        </div>
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
            footnote={`${formatLabel(entry?.format)} → ${formatLabel(to)} at the same pixel dimensions.`}
        />
    ) : null;

    return (
        <ToolShell
            slug="convert"
            title={title}
            intro={intro}
            mark={locked ? `${formatLabel(from)}→${formatLabel(to)}` : `→${formatLabel(to)}`}
            breadcrumb={breadcrumb}
            settingsLabel="Format settings"
            settings={settings}
            panel={panel}
            error={submit.error}
            action={(
                <ToolAction
                    label={`Convert to ${formatLabel(to)}`}
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
