'use client';

/**
 * CropTool
 *
 * The source dimensions come from useImageUpload, which probes them with the
 * window-qualified Image constructor. The old client constructed Image without
 * the window prefix in a module that also imported next/image, so the
 * constructor resolved to the React component and threw — the width and height
 * stayed at 0 and every crop was rejected as out of bounds. Reading them from
 * the hook fixes that by construction.
 *
 * The controls sit in the panel rather than in the settings slot on purpose:
 * a crop rectangle is meaningless until there is an image to measure it
 * against, so there is nothing useful to pre-configure above the drop zone.
 *
 * The overlay is the one earned grid in the design system. It is not texture:
 * it dims what will be discarded, outlines what will be kept, and draws thirds
 * inside the kept region so the frame can be judged before the request is sent.
 */
import { useState } from 'react';

import ResultPanel from '@/components/tools/ResultPanel';
import ToolShell, { ToolAction } from '@/components/tools/ToolShell';
import Dropzone from '@/components/ui/Dropzone';
import Field from '@/components/ui/Field';
import useImageUpload from '@/lib/hooks/useImageUpload';
import useLocalProcess from '@/lib/hooks/useLocalProcess';
import usePreviewUrl from '@/lib/hooks/usePreviewUrl';

const CONTROL = 'w-full rounded-input border border-line bg-surface-raised px-3 py-2 font-data text-ui text-ink';

const EMPTY_RECT = { x: 0, y: 0, width: 0, height: 0 };

const FIELDS = [
    { key: 'x', label: 'X', hint: 'from the left edge' },
    { key: 'y', label: 'Y', hint: 'from the top edge' },
    { key: 'width', label: 'Width', hint: 'pixels to keep' },
    { key: 'height', label: 'Height', hint: 'pixels to keep' },
];

function toPixels(value) {
    const parsed = Math.trunc(Number(value));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function CropOverlay({ width, height, rect }) {
    const { x, y, width: w, height: h } = rect;
    if (w <= 0 || h <= 0) return null;

    const guide = {
        stroke: 'var(--accent)',
        strokeOpacity: 0.45,
        strokeDasharray: '5 5',
        vectorEffect: 'non-scaling-stroke',
    };

    return (
        <svg
            viewBox={`0 0 ${width} ${height}`}
            preserveAspectRatio="none"
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 size-full"
        >
            {/* even-odd: the second subpath punches the kept region out of the dim. */}
            <path
                fillRule="evenodd"
                d={`M0 0H${width}V${height}H0Z M${x} ${y}H${x + w}V${y + h}H${x}Z`}
                fill="var(--overlay)"
            />
            {[1, 2].map((step) => (
                <line
                    key={`column-${step}`}
                    x1={x + (w * step) / 3}
                    y1={y}
                    x2={x + (w * step) / 3}
                    y2={y + h}
                    {...guide}
                />
            ))}
            {[1, 2].map((step) => (
                <line
                    key={`row-${step}`}
                    x1={x}
                    y1={y + (h * step) / 3}
                    x2={x + w}
                    y2={y + (h * step) / 3}
                    {...guide}
                />
            ))}
            <rect
                x={x}
                y={y}
                width={w}
                height={h}
                fill="none"
                stroke="var(--accent)"
                strokeWidth="2"
                vectorEffect="non-scaling-stroke"
            />
        </svg>
    );
}

export default function CropTool({ answer, breadcrumb, children }) {
    const [rect, setRect] = useState(EMPTY_RECT);

    const upload = useImageUpload();
    const preview = usePreviewUrl();
    const submit = useLocalProcess({
        op: 'crop',
        onSuccess: (payload) => preview.show(payload.blob),
    });

    const entry = upload.file;
    const sourceWidth = entry?.width ?? 0;
    const sourceHeight = entry?.height ?? 0;

    const fitsInside = rect.width > 0
        && rect.height > 0
        && rect.x + rect.width <= sourceWidth
        && rect.y + rect.height <= sourceHeight;

    const boundsError = entry && !fitsInside
        ? `That region falls outside the image. It has to fit inside ${sourceWidth}×${sourceHeight} pixels, counting from the top-left corner.`
        : null;

    const handleReset = () => {
        submit.reset();
        upload.clear();
        preview.clear();
        setRect(EMPTY_RECT);
    };

    const handleFiles = async (files) => {
        submit.reset();
        preview.clear();
        const [accepted] = await upload.selectFiles(files);
        setRect(accepted?.width
            ? { x: 0, y: 0, width: accepted.width, height: accepted.height }
            : EMPTY_RECT);
        return accepted ? [accepted] : [];
    };

    const handleSubmit = () => {
        if (!entry || boundsError) return;
        const form = new FormData();
        form.append('file', entry.file);
        form.append('crop_x', String(rect.x));
        form.append('crop_y', String(rect.y));
        form.append('crop_width', String(rect.width));
        form.append('crop_height', String(rect.height));
        // The measured dimensions go with the job, not just the rectangle: the
        // memory gate can only refuse a job it can cost, and it has to do that
        // before anything decodes.
        submit.submit(form, {
            originalBytes: entry.size,
            sourceWidth,
            sourceHeight,
        });
    };

    const panel = entry ? (
        <div className="flex flex-col gap-5">
            <div className="checkerboard flex justify-center rounded-panel border border-line p-3">
                <div className="relative inline-block max-w-full">
                    {/* eslint-disable-next-line @next/next/no-img-element -- blob: URL from the visitor's own file; next/image cannot optimise it. */}
                    <img
                        src={entry.previewUrl}
                        alt={`Crop preview of ${entry.name}`}
                        className="block max-h-[380px] w-auto max-w-full"
                    />
                    <CropOverlay width={sourceWidth} height={sourceHeight} rect={rect} />
                </div>
            </div>

            <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 font-data text-micro text-ink-muted">
                <p>
                    Source <span className="text-ink">{sourceWidth}×{sourceHeight}</span>
                </p>
                <p>
                    Keeping <span className="text-ink">{rect.width}×{rect.height}</span> from x {rect.x}, y {rect.y}
                </p>
            </div>

            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                {FIELDS.map((field) => (
                    <Field key={field.key} id={`crop-${field.key}`} label={field.label} hint={field.hint}>
                        <input
                            id={`crop-${field.key}`}
                            type="number"
                            inputMode="numeric"
                            min="0"
                            step="1"
                            value={rect[field.key]}
                            onChange={(event) => {
                                submit.reset();
                                setRect((current) => ({
                                    ...current,
                                    [field.key]: toPixels(event.target.value),
                                }));
                            }}
                            aria-describedby={`crop-${field.key}-hint`}
                            className={CONTROL}
                        />
                    </Field>
                ))}
            </div>

            <div className="flex flex-wrap gap-3">
                <button
                    type="button"
                    onClick={() => setRect({ x: 0, y: 0, width: sourceWidth, height: sourceHeight })}
                    className="rounded-button border border-line px-3 py-2 text-ui text-ink transition-colors duration-120 ease-snap hover:bg-surface-sunken"
                >
                    Select the whole image
                </button>
                <button
                    type="button"
                    onClick={handleReset}
                    className="rounded-button border border-line px-3 py-2 text-ui text-ink transition-colors duration-120 ease-snap hover:bg-surface-sunken"
                >
                    Choose another image
                </button>
            </div>
        </div>
    ) : (
        <Dropzone
            id="crop-file"
            label="Drop an image here"
            constraints={upload.constraints}
            accept={upload.accept}
            state={upload.state}
            reason={upload.error}
            onFiles={handleFiles}
            onDragChange={upload.setDragging}
            disabled={upload.isReading}
        />
    );

    /**
     * Width and height come off the RESULT, not off `rect`. The four crop
     * fields stay mounted and enabled after a job, so reading the live form
     * here made the reported Size follow keystrokes while the blob behind the
     * Download button stayed as it was — a 1200×800 crop labelled 400×800.
     */
    const result = submit.result ? (
        <ResultPanel
            variant="single"
            previewUrl={preview.url}
            alt={`Cropped copy of ${entry?.name ?? 'your image'}`}
            filename={submit.result.filename}
            originalBytes={submit.result.originalBytes}
            resultBytes={submit.result.resultBytes}
            width={submit.result.width}
            height={submit.result.height}
            onDownload={() => submit.download()}
            onReset={handleReset}
            downloadLabel="Download cropped image"
            footnote="The crop keeps the original format. Only the pixels inside the outlined region were kept."
        />
    ) : null;

    return (
        <ToolShell
            slug="crop"
            title="Crop Images Online"
            intro="Cut a rectangle out of a JPEG, PNG or WebP by exact pixel coordinates, measured from the top-left corner. Cropped on your device, never uploaded."
            answer={answer}
            breadcrumb={breadcrumb}
            panel={panel}
            error={submit.error ?? boundsError}
            action={(
                <ToolAction
                    label="Crop image"
                    processingLabel="Cropping…"
                    isProcessing={submit.isProcessing}
                    progress={submit.progress}
                    disabled={!entry || Boolean(boundsError)}
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
