'use client';

/**
 * DpiTool
 *
 * THE ONLY TOOL HERE THAT READS BEFORE IT OFFERS TO WRITE.
 *
 * Everyone who lands on this page arrives holding a sentence somebody else
 * wrote them — "images must be 300 DPI", "your scan is only 72 DPI" — and the
 * first thing they need is not a control, it is an answer: what does this file
 * actually say, and where does it say it? So the panel opens a checker the
 * moment a file is chosen. readResolution walks a header and never the picture,
 * which is what makes that affordable on the main thread; the engine module it
 * comes from imports no decoder, no encoder and no WebAssembly, so nothing
 * heavy is pulled into this page for the sake of a readout.
 *
 * THE SECOND THING THEY NEED IS THE ARITHMETIC, NOT THE NUMBER.
 *
 * "300 DPI" means nothing on its own. Pixels ÷ DPI = inches is the whole content
 * of the concept, and it is the one calculation on this page nothing else in the
 * repo does — so the readout prints it twice, once for what the file claims now
 * and once for what the field would make it claim, side by side and updating as
 * the field is typed. A visitor who can see 1600×1200 turn from 22 inches wide
 * into 5⅓ inches wide has understood DPI, and understanding it is what stops
 * them looking for a tool that "increases" it by inventing pixels.
 *
 * WHY THE PAYOFF PANEL IS THE WEAKEST PART OF THIS PAGE, DELIBERATELY.
 *
 * ResultPanel's hero is a percentage of bytes saved, because six of the seven
 * tools exist to make a file smaller. This one changes a header and leaves the
 * compressed picture data byte for byte where it was, so that percentage is
 * always 0% and always beside the point. It is left standing rather than worked
 * around — one repeated primitive is worth more than a bespoke panel — and the
 * footnote does the job instead: it states, in words, that the bytes did not
 * move because nothing was re-encoded, which of the file's resolution fields
 * were written, and what the file now claims to print at. The panel is asked
 * for a `payoff` slot in the hand-off notes; until it has one this is the
 * honest arrangement rather than a silent 0%.
 *
 * The chips are derived, not remembered. A DPI chip is a claim about exactly
 * one number, so pressing it is true precisely when the field holds that number
 * — unlike /crop, where one ratio fits many rectangles and the chip has to be
 * tracked separately. Typing 72 by hand lights the Screens chip, which is
 * correct: the value really is the one that chip names.
 */
import { useRef, useState } from 'react';

import PresetChips from '@/components/tools/PresetChips';
import ResultPanel from '@/components/tools/ResultPanel';
import ToolShell, { ToolAction } from '@/components/tools/ToolShell';
import Alert from '@/components/ui/Alert';
import Dropzone from '@/components/ui/Dropzone';
import Field, { fieldDescribedBy } from '@/components/ui/Field';
import FilePreviewCard from '@/components/ui/FilePreviewCard';
import useImageUpload from '@/lib/hooks/useImageUpload';
import useLocalProcess from '@/lib/hooks/useLocalProcess';
import usePreviewUrl from '@/lib/hooks/usePreviewUrl';
import { CM_PER_INCH, readResolution } from '@/lib/image-client/dpi';
import { DPI_INPUT_FORMATS, MAX_DPI, MIN_DPI } from '@/lib/limits';

const CONTROL = 'w-full rounded-input border border-line bg-surface-raised px-3 py-2 font-data text-ui text-ink';

const DEFAULT_DPI = '300';

/**
 * What each block is called in a sentence a person can act on. The engine
 * returns 'jfif' / 'exif' / 'phys'; nobody types those, but a print shop's
 * support page will say "the JFIF header", so the real names are used rather
 * than a euphemism.
 */
const SOURCE_NAMES = {
    jfif: 'JFIF header',
    exif: 'EXIF block',
    phys: 'pHYs chunk',
};

/**
 * The four numbers people are actually asked for, and what each is for. The
 * number lives in `detail` because PresetChips sets that half in mono — every
 * figure on this site is tabular — and the use lives in the label, which is
 * also the half a screen reader hears first.
 */
const PRESETS = [
    { id: 72, label: 'Screens', detail: '72' },
    { id: 150, label: 'Home printing', detail: '150' },
    { id: 300, label: 'Print', detail: '300' },
    { id: 600, label: 'Fine print', detail: '600' },
];

const FALLBACK_READ_ERROR = 'This file’s resolution could not be read.';

/** Mirrors lib/image-client/dpi.js parseDpi exactly — never a looser rule, and never a stricter one. */
function parseDpi(raw) {
    const text = String(raw ?? '').trim();
    if (text === '') return null;

    const value = Number(text);
    if (!Number.isInteger(value) || value < MIN_DPI || value > MAX_DPI) return null;

    return value;
}

/** '300' when both axes agree, '300 × 200' when a file disagrees with itself. */
function dpiText(dpi) {
    if (!dpi) return null;
    return dpi.x === dpi.y ? String(dpi.x) : `${dpi.x} × ${dpi.y}`;
}

/** '300 × 300', always the pair — the form the checker and the footnote read in. */
function dpiPair(dpi) {
    return dpi ? `${dpi.x} × ${dpi.y}` : null;
}

/**
 * How large this many pixels claims to be on paper. Inches to two places
 * because that is the precision a print shop asks in; centimetres to one,
 * because a tenth of a centimetre is already finer than any printer's margin.
 */
function printSize(pixelWidth, pixelHeight, dpi) {
    const x = Number(dpi?.x);
    const y = Number(dpi?.y);

    if (!Number.isFinite(pixelWidth) || !Number.isFinite(pixelHeight)) return null;
    if (!(x > 0) || !(y > 0)) return null;

    const inchesWide = pixelWidth / x;
    const inchesTall = pixelHeight / y;

    return `${inchesWide.toFixed(2)} × ${inchesTall.toFixed(2)} in`
        + ` (${(inchesWide * CM_PER_INCH).toFixed(1)} × ${(inchesTall * CM_PER_INCH).toFixed(1)} cm)`;
}

/**
 * The bytes, said neutrally.
 *
 * ResultPanel prints a before/after byte pair and a percentage above this line,
 * and on this tool that pair is not a saving and not a cost — it is the size of
 * a header. Saying so is the difference between "your file grew" and "a
 * resolution record was added".
 */
function byteSentence(before, after) {
    const from = Number(before);
    const to = Number(after);
    if (!Number.isFinite(from) || !Number.isFinite(to)) return null;

    const delta = to - from;
    if (delta === 0) return 'The file is exactly the same size — nothing was compressed.';

    const count = Math.abs(delta);
    return `The file is ${count} ${count === 1 ? 'byte' : 'bytes'} ${delta > 0 ? 'larger' : 'smaller'},`
        + ' which is the resolution record itself, not a change to the picture.';
}

/**
 * Which fields were written, and why that matters.
 *
 * A JPEG carrying a stale EXIF resolution beside a fresh JFIF one reports two
 * different numbers to two different programs, which is the exact failure this
 * tool exists to fix — so when both were written the sentence says both, and
 * when only one was, it claims only one.
 */
function fieldsSentence(format, changed, value) {
    const wrote = (name) => changed.includes(name);

    if (format === 'png') {
        return wrote('exif')
            ? `The pHYs chunk now says ${value} DPI, and the eXIf resolution was rewritten to match.`
            : `The pHYs chunk now says ${value} DPI.`;
    }

    return wrote('exif')
        ? `Both the JFIF and the EXIF resolution fields now say ${value}, so every program reads the same number.`
        : `The JFIF header now says ${value} DPI.`;
}

/**
 * The whole sentence under the result, built from the RESULT and never from the
 * form. /crop shipped a panel whose Size row followed the live fields and so
 * described a file other than the one behind the Download button; the same
 * mistake here would have the page claim a DPI the downloaded file does not
 * carry.
 */
function footnoteFor(result) {
    const before = result?.dpi?.before ?? null;
    const target = result?.dpi?.after?.dpi ?? null;
    if (!target) return null;

    const changed = Array.isArray(result.changed) ? result.changed : [];
    const measured = Number.isFinite(result.width) && Number.isFinite(result.height);

    const parts = [
        result.inserted || !before?.dpi
            ? 'This file had no resolution recorded.'
            : `This file was ${dpiPair(before.dpi)} DPI from the ${SOURCE_NAMES[before.source] ?? 'file header'}.`,
        `It now says ${dpiPair(target)} DPI.`,
        measured ? `The picture is still ${result.width} × ${result.height} pixels.` : null,
        'The compressed picture data is the same bytes you gave it; only the header changed.',
        byteSentence(result.originalBytes, result.resultBytes),
        fieldsSentence(result.format, changed, dpiText(target)),
    ];

    const size = measured ? printSize(result.width, result.height, target) : null;
    if (size) parts.push(`At ${dpiText(target)} DPI it prints at ${size}.`);

    return parts.filter(Boolean).join(' ');
}

/**
 * The hero, read off the result rather than the form.
 *
 * ResultPanel's default is a percentage of bytes saved, which here is always 0%
 * — this tool rewrites a header and re-encodes nothing. The number a visitor
 * came to change is the one worth setting large, so it takes the payoff slot.
 */
function payoffFor(result) {
    const written = dpiText(result?.dpi?.after?.dpi);
    return written ? { value: `${written} DPI`, label: 'New resolution' } : null;
}

/** One row of the checker: what it is called, and what it says. */
function ReadoutRow({ term, children }) {
    return (
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-0.5">
            <dt className="text-ui text-ink-muted">{term}</dt>
            <dd className="font-data text-ui text-ink">{children}</dd>
        </div>
    );
}

export default function DpiTool({
    title = 'Change Image DPI',
    intro = 'Set the print resolution a JPEG or PNG reports — 300 DPI for a print shop, 72 for a screen — without re-encoding a single pixel, here on your device.',
    answer,
    breadcrumb,
    children,
}) {
    const [dpi, setDpi] = useState(DEFAULT_DPI);
    // { reading } once the header has been read, { message } when the module
    // refused the file, null while there is nothing to say.
    const [inspection, setInspection] = useState(null);

    // A second file chosen while the first is still being read must not have
    // its readout overwritten by the slower answer behind it.
    const readTokenRef = useRef(0);

    const upload = useImageUpload({ accept: DPI_INPUT_FORMATS });
    const preview = usePreviewUrl();
    const submit = useLocalProcess({
        op: 'dpi',
        onSuccess: (payload) => preview.show(payload.blob),
    });

    const entry = upload.file;
    const requested = parseDpi(dpi);
    const dpiError = requested === null
        ? `Enter a whole number between ${MIN_DPI} and ${MAX_DPI}.`
        : null;

    const reading = inspection?.reading ?? null;
    const readError = inspection?.message ?? null;

    const inspect = async (candidate) => {
        readTokenRef.current += 1;
        const token = readTokenRef.current;

        if (!candidate) {
            setInspection(null);
            return;
        }

        try {
            const bytes = new Uint8Array(await candidate.file.arrayBuffer());
            const result = readResolution(bytes);
            if (readTokenRef.current === token) setInspection({ reading: result, message: null });
        } catch (failure) {
            if (readTokenRef.current === token) {
                setInspection({ reading: null, message: failure?.message || FALLBACK_READ_ERROR });
            }
        }
    };

    const handleReset = () => {
        readTokenRef.current += 1;
        submit.reset();
        upload.clear();
        preview.clear();
        setInspection(null);
    };

    const handleFiles = async (files) => {
        submit.reset();
        preview.clear();
        setInspection(null);

        const accepted = await upload.selectFiles(files);
        await inspect(accepted[0] ?? null);
        return accepted;
    };

    /**
     * A result on screen describes a file written at one number. Changing the
     * number leaves it describing something nobody asked for, and ToolShell
     * removes the submit action while a result stands — so clearing it is also
     * what puts the button back.
     */
    const handleDpiChange = (next) => {
        submit.reset();
        setDpi(next);
    };

    const handleSubmit = () => {
        if (!entry || requested === null || readError) return;

        const form = new FormData();
        form.append('file', entry.file);
        form.append('dpi', String(requested));

        submit.submit(form, {
            originalBytes: entry.size,
            sourceWidth: entry.width,
            sourceHeight: entry.height,
        });
    };

    const settings = (
        <div className="flex flex-col gap-4">
            <Field
                id="dpi-value"
                label="New DPI"
                hint="The number the file will report to a printer or a print shop."
                error={dpiError}
                className="max-w-[16rem]"
            >
                <input
                    id="dpi-value"
                    type="number"
                    inputMode="numeric"
                    min={MIN_DPI}
                    max={MAX_DPI}
                    step="1"
                    value={dpi}
                    onChange={(event) => handleDpiChange(event.target.value)}
                    aria-describedby={fieldDescribedBy('dpi-value', { hint: true, error: dpiError })}
                    className={CONTROL}
                />
            </Field>

            <div>
                <PresetChips
                    label="Common print resolutions"
                    items={PRESETS}
                    value={requested}
                    onSelect={(item) => {
                        if (!item) return;
                        handleDpiChange(String(item.id));
                    }}
                />
                <p className="mt-2 max-w-[60ch] text-micro text-ink-muted">
                    These are the numbers people are usually asked for, not rules any printer or
                    upload form enforces.
                </p>
            </div>
        </div>
    );

    const recorded = reading?.dpi ?? null;

    const checker = reading ? (
        <div
            role="status"
            aria-atomic="false"
            aria-labelledby="dpi-readout-heading"
            className="rounded-panel border border-line bg-surface-sunken p-4"
        >
            <h3 id="dpi-readout-heading" className="text-ui font-medium text-ink">
                What this file says
            </h3>

            <dl className="mt-3 flex flex-col gap-1.5">
                <ReadoutRow term="Recorded resolution">
                    {recorded
                        ? `${dpiPair(recorded)} DPI, from the ${SOURCE_NAMES[reading.source] ?? 'file header'}`
                        : 'None recorded'}
                </ReadoutRow>

                <ReadoutRow term="Pixel size">
                    {Number.isFinite(entry?.width) && Number.isFinite(entry?.height)
                        ? `${entry.width} × ${entry.height} px`
                        : '—'}
                </ReadoutRow>

                <ReadoutRow term="Prints at the recorded DPI">
                    {printSize(entry?.width, entry?.height, recorded) ?? '—'}
                </ReadoutRow>

                <ReadoutRow term={requested === null ? 'Will print at the new DPI' : `Will print at ${requested} DPI`}>
                    {(requested === null
                        ? null
                        : printSize(entry?.width, entry?.height, { x: requested, y: requested })) ?? '—'}
                </ReadoutRow>
            </dl>
        </div>
    ) : null;

    const panel = entry ? (
        <div className="flex flex-col gap-4">
            <FilePreviewCard
                name={entry.name}
                size={entry.size}
                format={entry.format}
                width={entry.width}
                height={entry.height}
                previewUrl={entry.previewUrl}
                onRemove={handleReset}
            />

            {readError ? <Alert>{readError}</Alert> : checker}

            <p className="max-w-[72ch] text-micro text-ink-muted">
                DPI is a note in the file about how large to print it. Changing it adds or removes
                no pixels; only the implied print size moves.
            </p>
        </div>
    ) : (
        <Dropzone
            id="dpi-file"
            label="Drop a JPEG or PNG here"
            constraints={upload.constraints}
            accept={upload.accept}
            state={upload.state}
            reason={upload.error}
            onFiles={handleFiles}
            onDragChange={upload.setDragging}
            disabled={upload.isReading}
            browseLabel="Browse images"
        />
    );

    const result = submit.result ? (
        <ResultPanel
            variant="single"
            previewUrl={preview.url}
            alt={`${entry?.name ?? 'Your image'} with its resolution set to ${dpiText(submit.result.dpi?.after?.dpi) ?? 'a new value'} DPI`}
            filename={submit.result.filename}
            originalBytes={submit.result.originalBytes}
            resultBytes={submit.result.resultBytes}
            width={submit.result.width}
            height={submit.result.height}
            payoff={payoffFor(submit.result)}
            onDownload={() => submit.download()}
            onReset={handleReset}
            downloadLabel="Download image"
            footnote={footnoteFor(submit.result)}
        />
    ) : null;

    return (
        <ToolShell
            slug="change-image-dpi"
            title={title}
            intro={intro}
            answer={answer}
            breadcrumb={breadcrumb}
            settingsLabel="Resolution settings"
            settings={settings}
            panel={panel}
            error={submit.error}
            action={(
                <ToolAction
                    label="Set DPI"
                    processingLabel="Writing…"
                    isProcessing={submit.isProcessing}
                    progress={submit.progress}
                    disabled={!entry || requested === null || Boolean(readError)}
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
