'use client';

/**
 * FaviconTool
 *
 * One logo in, a favicon.ico, five PNGs and a site.webmanifest out — the
 * whole package `lib/format/icon-package.js` names. Composed from the same
 * pieces as /image-size-fitter and /passport-photo-print: FrameCrop for the
 * square crop, TransparencyBackground (now with a genuine Transparent choice
 * — every format this tool writes carries an alpha channel) for what happens
 * where the logo does not cover the square, and the same sample-button
 * intake, focus management and stale-result rule every requirement-fitting
 * tool on this site already uses.
 *
 * WHY THERE IS NO WIDTH/HEIGHT FIELD HERE. Every other fitter asks "what
 * exact size", because the visitor's own form states one. A favicon package
 * is not one size, it is the six a browser and an OS actually look for
 * (lib/format/icon-package.js ICON_ASSETS), so the only real choices are HOW
 * the square is filled (Crop to square / Fit inside square) and WHAT shows
 * behind a transparent logo — never a pixel count, which would just be wrong
 * for the other five files the moment it was typed.
 *
 * THE COMPOSED PREVIEW IS ONE GEOMETRY, READ TWICE. IconPreview draws from
 * the exact same crop rect (FrameCrop's own `value`) and the exact same
 * `fitGeometry` contain/pad arithmetic the engine's `icons` op runs — see
 * IconPreview.js. This component never computes a rect of its own; it only
 * decides which of the two the preview should read, from `geometry`.
 */
import { useEffect, useMemo, useRef, useState } from 'react';

import FrameCrop from '@/components/tools/FrameCrop';
import ToolShell, { ToolAction } from '@/components/tools/ToolShell';
import TransparencyBackground from '@/components/tools/TransparencyBackground';
import Alert from '@/components/ui/Alert';
import Dropzone from '@/components/ui/Dropzone';
import Field, { fieldDescribedBy } from '@/components/ui/Field';
import IconAssets from './IconAssets';
import IconPreview from './IconPreview';
import { centeredCoverRect, enlargementFor } from '@/lib/format/fit-requirements';
import useImageUpload from '@/lib/hooks/useImageUpload';
import useLocalProcess from '@/lib/hooks/useLocalProcess';
import { RASTER_INPUT_FORMATS } from '@/lib/limits';

const SAMPLE_BUTTON = 'inline-flex min-h-11 items-center justify-center rounded-button border border-line bg-surface-raised px-3 text-ui font-medium text-ink transition-colors duration-120 ease-snap hover:bg-surface-sunken';

const RADIO = 'size-4 accent-[var(--accent)] disabled:opacity-50';

const CONTROL = 'w-full rounded-input border border-line bg-surface-raised px-3 py-2 text-ui text-ink';

const SAMPLE = {
    src: '/samples/logo-mark-640x400.png',
    name: 'favicon-sample-logo.png',
};

/** The one target the pre-generation enlargement notice compares against — the largest icon the package writes. */
const LARGEST_ICON = { width: 512, height: 512 };

/** A source (or a chosen crop) this far from square gets the far-from-square note, whichever geometry is selected. */
const FAR_FROM_SQUARE_RATIO = 2;

export default function FaviconTool({
    title = 'Generate Favicons and App Icons',
    intro = 'One logo becomes favicon.ico, five PNG icons and a web app manifest, entirely in your browser — '
        + 'nothing is uploaded.',
    answer,
    breadcrumb,
    children,
}) {
    const [geometry, setGeometry] = useState('cover');
    const [manualRect, setManualRect] = useState(null);
    const [background, setBackground] = useState('transparent');
    const [showGuides, setShowGuides] = useState(false);
    const [manifestOpen, setManifestOpen] = useState(false);
    const [appName, setAppName] = useState('');
    const [shortName, setShortName] = useState('');
    const [themeColor, setThemeColor] = useState('');
    const [manifestBackground, setManifestBackground] = useState('');
    const [generateMs, setGenerateMs] = useState(null);

    const manifestPanelId = 'icon-manifest-fields-panel';

    const focusAfterLoadRef = useRef(false);
    const resultHeadingRef = useRef(null);
    const submitStartRef = useRef(null);

    const upload = useImageUpload({ accept: RASTER_INPUT_FORMATS });
    const submit = useLocalProcess({ op: 'icons' });

    const entry = upload.file;

    /* ------------------------------------------------------------ sizing */

    const defaultRect = useMemo(
        () => (entry ? centeredCoverRect(entry.width, entry.height, 1) : null),
        [entry],
    );
    const frameRect = manualRect ?? defaultRect;

    const sourceAspect = entry ? entry.width / entry.height : null;
    const isFarFromSquare = sourceAspect !== null
        && (sourceAspect >= FAR_FROM_SQUARE_RATIO || sourceAspect <= 1 / FAR_FROM_SQUARE_RATIO);

    // The square the icons are made of, which is the engine's own rule: a crop
    // keeps the frame, a fit keeps the whole picture inside a square whose side
    // is the LONGER edge — so a 640 × 400 fitted inside 512 is scaled down and
    // padded, never enlarged, and only a source short on both edges is.
    const longestEdge = entry ? Math.max(entry.width, entry.height) : 0;
    const enlargement = entry
        ? enlargementFor({
            sourceWidth: entry.width,
            sourceHeight: entry.height,
            keptRect: geometry === 'cover' ? frameRect : { width: longestEdge, height: longestEdge },
            pixels: LARGEST_ICON,
        })
        : null;
    const enlargedFrom = enlargement
        ? (geometry === 'cover' ? enlargement.from : { width: entry.width, height: entry.height })
        : null;

    const enlargementNotice = enlargedFrom
        ? `Your source is ${enlargedFrom.width} × ${enlargedFrom.height} and will be enlarged for the `
            + `${LARGEST_ICON.width} × ${LARGEST_ICON.height} icon. Enlargement increases dimensions but cannot `
            + 'restore missing detail.'
        : null;

    const canSubmit = Boolean(entry);
    const actionHint = canSubmit ? undefined : 'Add a logo to turn this on.';

    /* ------------------------------------------------------------ resets */

    const clearingSetter = (setter) => (value) => {
        submit.reset();
        setter(value);
    };

    const handleGeometryChange = clearingSetter(setGeometry);
    const handleBackgroundChange = clearingSetter(setBackground);
    const handleAppNameChange = clearingSetter(setAppName);
    const handleShortNameChange = clearingSetter(setShortName);
    const handleThemeColorChange = clearingSetter(setThemeColor);
    const handleManifestBackgroundChange = clearingSetter(setManifestBackground);

    /* ------------------------------------------------------------ intake */

    const handleFiles = async (files) => {
        focusAfterLoadRef.current = true;
        submit.reset();
        setManualRect(null);
        return upload.selectFiles(files);
    };

    const loadSample = async () => {
        try {
            const response = await fetch(SAMPLE.src);
            if (!response.ok) throw new Error('sample unavailable');
            const blob = await response.blob();
            focusAfterLoadRef.current = true;
            await handleFiles([new File([blob], SAMPLE.name, { type: 'image/png' })]);
        } catch {
            focusAfterLoadRef.current = false;
            upload.setError('That sample could not be loaded. Try again, or use a logo of your own.');
        }
    };

    const handleReset = () => {
        submit.reset();
        upload.clear();
        setManualRect(null);
        setGenerateMs(null);
        setTimeout(() => document.getElementById('icon-file-browse')?.focus(), 0);
    };

    useEffect(() => {
        if (!submit.error) return;
        document.getElementById('icon-error')?.focus();
    }, [submit.error]);

    useEffect(() => {
        if (!submit.result) return;
        resultHeadingRef.current?.focus();
        // Consumed once per result: a later reset must not leave a stale
        // start time for the NEXT run's own onSuccess (there is none) to
        // read — this effect is the only place a duration is ever computed.
        if (submitStartRef.current !== null) {
            setGenerateMs(Math.round(performance.now() - submitStartRef.current));
            submitStartRef.current = null;
        }
    }, [submit.result]);

    useEffect(() => {
        if (!focusAfterLoadRef.current || !entry) return;
        focusAfterLoadRef.current = false;
        (document.getElementById('icon-frame') ?? document.getElementById('icon-file-browse'))?.focus();
    }, [entry]);

    /* ------------------------------------------------------------- submit */

    const handleSubmit = () => {
        if (!entry) return;

        const form = new FormData();
        form.append('file', entry.file);
        form.append('geometry', geometry);
        form.append('background', background);

        if (geometry === 'cover' && frameRect) {
            form.append('crop_x', String(frameRect.x));
            form.append('crop_y', String(frameRect.y));
            form.append('crop_width', String(frameRect.width));
            form.append('crop_height', String(frameRect.height));
        }

        submitStartRef.current = performance.now();
        submit.submit(form, {
            originalBytes: entry.size,
            sourceWidth: entry.width,
            sourceHeight: entry.height,
            targetWidth: LARGEST_ICON.width,
            targetHeight: LARGEST_ICON.height,
        });
    };

    /* ----------------------------------------------------------- markup */

    const sourcePreview = entry ? (
        <div className="flex flex-col gap-4">
            <div className="checkerboard flex justify-center rounded-panel border border-line p-3">
                <div className="relative inline-block max-w-full">
                    {geometry === 'cover' && frameRect ? (
                        <FrameCrop
                            id="icon-frame"
                            src={entry.previewUrl}
                            sourceWidth={entry.width}
                            sourceHeight={entry.height}
                            aspect={1}
                            value={frameRect}
                            onChange={(rect) => {
                                submit.reset();
                                setManualRect(rect);
                            }}
                            label="Position your logo inside the frame"
                        />
                    ) : (
                        // eslint-disable-next-line @next/next/no-img-element -- blob: URL from the visitor's own file; next/image cannot optimise it.
                        <img
                            src={entry.previewUrl}
                            alt={`${entry.name}, the logo icons will be generated from`}
                            className="block max-h-[380px] w-auto max-w-full"
                        />
                    )}
                </div>
            </div>

            <div>
                <button
                    type="button"
                    onClick={handleReset}
                    className="min-h-11 rounded-button border border-line px-3 py-2 text-ui text-ink transition-colors duration-120 ease-snap hover:bg-surface-sunken"
                >
                    Choose another logo
                </button>
            </div>
        </div>
    ) : (
        <Dropzone
            id="icon-file"
            label="Drop a logo here"
            constraints={upload.constraints}
            accept={upload.accept}
            state={upload.state}
            reason={upload.error}
            onFiles={handleFiles}
            onDragChange={upload.setDragging}
            disabled={upload.isReading}
        >
            <div className="mt-2 flex flex-col items-center gap-2">
                <p className="text-micro text-ink-muted">No logo to hand?</p>
                <button type="button" onClick={loadSample} className={SAMPLE_BUTTON}>
                    Try the sample logo
                </button>
            </div>
        </Dropzone>
    );

    const outputControls = entry ? (
        <div className="flex flex-col gap-6">
            <fieldset>
                <legend className="text-ui text-ink">Fill behaviour</legend>
                <div className="mt-2 flex flex-col gap-2">
                    <label className="flex items-center gap-2 text-ui text-ink">
                        <input
                            type="radio"
                            name="icon-geometry"
                            value="cover"
                            checked={geometry === 'cover'}
                            onChange={() => handleGeometryChange('cover')}
                            className={RADIO}
                        />
                        Crop to square
                    </label>
                    <label className="flex items-center gap-2 text-ui text-ink">
                        <input
                            type="radio"
                            name="icon-geometry"
                            value="contain"
                            checked={geometry === 'contain'}
                            onChange={() => handleGeometryChange('contain')}
                            className={RADIO}
                        />
                        Fit inside square
                    </label>
                </div>
                {isFarFromSquare ? (
                    <p className="mt-2 text-micro text-ink-muted">
                        This image is far from square. Crop to square keeps the part inside the frame; Fit inside
                        square keeps all of it and pads the rest.
                    </p>
                ) : null}
            </fieldset>

            {enlargementNotice ? (
                <p id="icon-enlargement" className="text-micro text-ink-muted">{enlargementNotice}</p>
            ) : null}

            <div>
                <TransparencyBackground
                    id="icon-background"
                    allowTransparent
                    value={background}
                    onChange={handleBackgroundChange}
                />
                {background === 'transparent' ? (
                    <p role="note" id="icon-apple-note" className="mt-2 text-micro text-ink-muted">
                        Apple’s guidelines ask for an opaque, full-bleed background and iOS masks the rounded
                        corners itself, so choose a background if this icon will be added to an iPhone home
                        screen.
                    </p>
                ) : null}
            </div>

            <div>
                <IconPreview
                    entry={entry}
                    geometry={geometry}
                    frameRect={geometry === 'cover' ? frameRect : null}
                    background={background}
                    showGuides={showGuides}
                />

                <label htmlFor="icon-guide" className="mt-3 flex items-center gap-2 text-ui text-ink">
                    <input
                        type="checkbox"
                        id="icon-guide"
                        checked={showGuides}
                        onChange={(event) => setShowGuides(event.target.checked)}
                        className="size-4 accent-[var(--accent)]"
                    />
                    Preview guide: circle and rounded-square masks
                </label>
                <p className="mt-1 text-micro text-ink-muted">
                    Very small details may disappear at 16 × 16. Check the favicon preview before downloading.
                </p>
            </div>

            <div>
                <button
                    type="button"
                    id="icon-manifest-fields"
                    aria-expanded={manifestOpen}
                    aria-controls={manifestPanelId}
                    onClick={() => setManifestOpen((open) => !open)}
                    className="inline-flex min-h-11 items-center gap-1.5 text-ui font-medium text-ink underline underline-offset-4 decoration-line transition-colors duration-120 ease-snap hover:text-accent"
                >
                    <span aria-hidden="true">{manifestOpen ? '−' : '+'}</span>
                    Web app manifest details (optional)
                </button>

                {/* Rendered with `hidden`, never unmounted: the button's
                    aria-controls names this id, and a screen reader following
                    that reference needs an element to actually land on. */}
                <div id={manifestPanelId} hidden={!manifestOpen} className="mt-5 flex flex-col gap-4">
                    <Field id="icon-app-name" label="App name">
                        <input
                            id="icon-app-name"
                            type="text"
                            value={appName}
                            onChange={(event) => handleAppNameChange(event.target.value)}
                            className={CONTROL}
                        />
                    </Field>
                    <Field id="icon-short-name" label="Short name">
                        <input
                            id="icon-short-name"
                            type="text"
                            value={shortName}
                            onChange={(event) => handleShortNameChange(event.target.value)}
                            className={CONTROL}
                        />
                    </Field>
                    <Field id="icon-theme-color" label="Theme colour" hint="Hex colour, starting with # and six digits." className="max-w-[10rem]">
                        <input
                            id="icon-theme-color"
                            type="text"
                            value={themeColor}
                            onChange={(event) => handleThemeColorChange(event.target.value)}
                            aria-describedby={fieldDescribedBy('icon-theme-color', { hint: true })}
                            className={CONTROL}
                        />
                    </Field>
                    <Field id="icon-manifest-background" label="Background colour" hint="Hex colour, starting with # and six digits." className="max-w-[10rem]">
                        <input
                            id="icon-manifest-background"
                            type="text"
                            value={manifestBackground}
                            onChange={(event) => handleManifestBackgroundChange(event.target.value)}
                            aria-describedby={fieldDescribedBy('icon-manifest-background', { hint: true })}
                            className={CONTROL}
                        />
                    </Field>
                    <p className="text-micro text-ink-muted">
                        Only what you type here goes into site.webmanifest; leave a field empty to leave it out.
                    </p>
                </div>
            </div>
        </div>
    ) : null;

    const plainErrorAlert = submit.error ? (
        <Alert id="icon-error" tabIndex={-1} className="mt-4">
            {submit.error}
        </Alert>
    ) : null;

    const panel = (
        <div className="flex flex-col gap-5">
            {sourcePreview}
            {outputControls}
            {plainErrorAlert}
        </div>
    );

    const outcome = submit.result;

    const result = outcome ? (
        <section
            aria-labelledby="icon-result-heading"
            className="flex flex-col gap-5"
            data-generate-ms={generateMs ?? undefined}
        >
            <h2
                id="icon-result-heading"
                ref={resultHeadingRef}
                tabIndex={-1}
                className="font-display text-title font-bold tracking-tight text-ink focus:outline-none"
            >
                Icons ready
            </h2>
            <IconAssets
                assets={outcome.assets}
                checks={outcome.checks}
                manifestFields={{
                    name: appName,
                    shortName,
                    themeColor,
                    backgroundColor: manifestBackground,
                }}
                onReset={handleReset}
            />
        </section>
    ) : null;

    return (
        <ToolShell
            slug="favicon-generator"
            title={title}
            intro={intro}
            answer={answer}
            breadcrumb={breadcrumb}
            panel={panel}
            action={(
                <ToolAction
                    label="Generate icons"
                    processingLabel="Generating…"
                    isProcessing={submit.isProcessing}
                    progress={submit.progress}
                    disabled={!canSubmit}
                    hint={actionHint}
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
