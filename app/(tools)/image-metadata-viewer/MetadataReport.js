'use client';

/**
 * MetadataReport
 *
 * Renders one successful `inspectImageMetadata` report. Nothing here decodes
 * or writes a file — it is a read-only view over the REPORT shape the engine
 * hands back, and every value it prints reaches the DOM as a React text node.
 * There is no `dangerouslySetInnerHTML` anywhere in this file and there must
 * never be one: a value here is data out of the visitor's own photo, so a
 * `<script>` sitting inside an XMP description has to render as inert text,
 * not as markup.
 *
 * MOUNT KEY, NOT INTERNAL RESET
 *
 * The advanced disclosure and the "Copied" status are plain useState with no
 * effect that clears them on a new file. That is deliberate: the parent only
 * ever renders this component once a report exists, and it renders `null` in
 * between (see MetadataViewerTool's `clearReport`), so a second file mounts a
 * FRESH instance of this component. Mounting is what resets the disclosure and
 * moves focus to the summary heading — no extra bookkeeping required, and no
 * way for the two to drift apart.
 */
import { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import Link from 'next/link';

import { formatFileSize } from '@/lib/format/bytes';
import { formatLabel } from '@/lib/format/upload-helpers';

const LINK = 'rounded-input font-medium text-accent underline underline-offset-4 transition-[text-decoration-thickness] duration-120 ease-snap hover:decoration-2';

const PRIMARY_BUTTON = 'inline-flex w-full items-center justify-center gap-2 rounded-button bg-accent px-5 py-3 text-base font-semibold text-accent-ink transition-[filter] duration-180 ease-snap hover:brightness-95 sm:w-auto';

const SECONDARY_BUTTON = 'inline-flex min-h-11 items-center justify-center rounded-button border border-line px-3 py-2 text-ui font-medium text-ink transition-colors duration-120 ease-snap hover:bg-surface-sunken';

const COPY_BUTTON = 'rounded-input border border-line px-2 py-0.5 text-micro font-medium text-ink transition-colors duration-120 ease-snap hover:bg-surface-sunken';

const RESOLUTION_SOURCE_LABEL = {
    jfif: 'JFIF header',
    exif: 'EXIF',
    phys: 'PNG pHYs chunk',
};

/**
 * The seven categories a visitor is warned about that are not GPS. Location
 * gets its own headline and sentence above this list — see PrivacySection —
 * so it is deliberately excluded here rather than repeated.
 */
const PRIVACY_CATEGORY_LABELS = {
    'capture-time': 'Capture date and time',
    device: 'Camera make and model',
    creator: 'Name or copyright',
    software: 'Editing software',
    text: 'Comments or descriptions',
    thumbnail: 'Embedded preview image',
    'extra-images': 'Extra images after the picture',
};

const TEXT_SOURCE_LABEL = {
    comment: 'Comment',
    'png-text': 'Text',
    iptc: 'IPTC',
    'user-comment': 'User comment',
};

const RAW_GROUP_ORDER = ['JPEG', 'PNG', 'WebP', 'IFD0', 'Exif', 'GPS', 'XMP', 'ICC'];

const TRUNCATE_AT = 500;
const MAX_REVEAL = 20_000;

/** How long a copy button shows its own feedback before reverting to "Copy". */
const COPY_FEEDBACK_MS = 1500;

/**
 * UserComment is curated into the EXIF field list AND reported as a Comments
 * and text item — the same words duplicated under two headings. It stays out
 * of the EXIF list, where Comments and text already carries it.
 */
const EXIF_FIELD_ID_SKIP = new Set(['userComment']);

function triState(value) {
    if (value === true) return 'Yes';
    if (value === false) return 'No';
    return 'Unknown';
}

function commaNumber(value) {
    return Number(value ?? 0).toLocaleString('en-US');
}

/** Trims a GPS decimal to at most 6 places with no trailing zeros. */
function formatCoordinate(value) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return null;
    return String(Number(value.toFixed(6)));
}

function resolutionUnitLabel(unit) {
    return unit === 'cm' ? 'px/cm' : 'DPI';
}

function formatResolutionValue(resolution) {
    if (!resolution?.present) return null;
    return `${resolution.x} × ${resolution.y} ${resolutionUnitLabel(resolution.unit)}`;
}

function formatPrintSize(resolution) {
    if (!resolution?.present || !resolution.printSize) return null;
    const { widthIn, heightIn } = resolution.printSize;
    const dpiText = resolution.x === resolution.y ? `${resolution.x}` : `${resolution.x} × ${resolution.y}`;
    return `${widthIn.toFixed(2)} × ${heightIn.toFixed(2)} in at ${dpiText} ${resolutionUnitLabel(resolution.unit)}`;
}

function formatAltitude(altitude) {
    if (!altitude) return null;
    return `${altitude.metres} m${altitude.belowSeaLevel ? ' below sea level' : ''}`;
}

function formatGpsTime(timestamp) {
    if (!timestamp?.date && !timestamp?.time) return null;
    return `${timestamp.time ?? '—'} UTC on ${timestamp.date ?? '—'}`;
}

function formatOrientation(orientation) {
    if (!orientation?.value) return null;
    return `${orientation.description} (stored value ${orientation.value})`;
}

function extensionMismatchNote(file) {
    if (!file?.extensionMismatch) return null;
    const claimed = String(file.extension ?? '').toUpperCase();
    const actual = formatLabel(file.format);
    return `The file extension does not match the image data: the name says ${claimed} but the file is a ${actual}.`;
}

/** The summary's Format row: the detected format always wins, with the
 * claimed extension named alongside it when the two disagree. */
function formatSummaryFormat(file) {
    const detected = formatLabel(file.format);
    if (!file.extensionMismatch) return detected;
    const claimed = file.extension ? `.${file.extension}` : 'no extension';
    return `${detected} (named ${claimed})`;
}

function fieldById(fields, id) {
    return (fields ?? []).find((field) => field.id === id) ?? null;
}

/** The fields this section actually shows — userComment is a duplicate of a
 * Comments and text item, so it never reaches this list. */
function exifFieldsToShow(exif) {
    return (exif?.fields ?? []).filter((field) => !EXIF_FIELD_ID_SKIP.has(field.id));
}

/** True when the engine found real EXIF content — real curated fields (before
 * the userComment duplicate is filtered out) or an orientation tag. A block
 * reported present with neither is a container the reader opened but that
 * carried nothing readable, which is a different fact from "not found". */
function exifHasContent(exif) {
    return (exif?.fields?.length ?? 0) > 0 || Boolean(exif?.orientation?.value);
}

/** True when the section built from the DISPLAYED fields has a row to show —
 * separate from exifHasContent, since a block whose only field is the
 * userComment duplicate is genuine EXIF content with nothing left to render. */
function exifSectionHasRows(exif) {
    return exifFieldsToShow(exif).length > 0 || Boolean(exif?.orientation?.value);
}

/** How much of a text item the engine kept, when it had to cut one. */
function textCutNote(item) {
    if (!item?.truncated) return null;
    const shown = commaNumber(String(item.value ?? '').length);
    const total = commaNumber(item.bytes);
    return `Showing ${shown} of ${total} characters`;
}

/** A value that may exceed the display budget. Never truncated by the engine
 * beyond its own field-level cap, so this is the page's own safety net. */
function TruncatedValue({ value, breakAll = false }) {
    const [expanded, setExpanded] = useState(false);
    const text = String(value ?? '');
    const isLong = text.length > TRUNCATE_AT;
    const shown = !isLong || expanded ? text.slice(0, MAX_REVEAL) : text.slice(0, TRUNCATE_AT);

    return (
        <span className={breakAll ? 'min-w-0 break-all' : 'min-w-0 [overflow-wrap:anywhere]'}>
            {shown}
            {isLong && !expanded ? (
                <>
                    {'… '}
                    <button
                        type="button"
                        onClick={() => setExpanded(true)}
                        className={COPY_BUTTON}
                    >
                        Show full value
                    </button>
                </>
            ) : null}
        </span>
    );
}

/** One row of a report `<dl>`. Renders nothing for a null/empty value, so a
 * caller can list every possible row unconditionally. */
function Row({ term, children, action }) {
    if (children === null || children === undefined || children === '') return null;

    return (
        <div className="flex flex-col gap-0.5 border-b border-line py-2 sm:flex-row sm:gap-4">
            <dt className="text-ui text-ink-muted sm:w-48 sm:shrink-0">{term}</dt>
            <dd className="flex min-w-0 flex-wrap items-center gap-2 text-ui text-ink [overflow-wrap:anywhere]">
                {children}
                {action}
            </dd>
        </div>
    );
}

/**
 * `status` is the ONE most-recently-finished copy, shared by every button on
 * the page (see MetadataReport's own `copyStatus` state): only the button
 * whose label matches shows its own result. The accessible name is the
 * `aria-label` and never changes — the visible text is decoration a sighted
 * visitor watching their own click also gets, not a second channel of meaning.
 */
function CopyButton({ label, text, onCopy, status }) {
    if (!text) return null;

    const showing = status?.label === label;
    const buttonText = showing ? (status.ok ? 'Copied' : 'Could not copy') : 'Copy';

    return (
        <button
            type="button"
            onClick={() => onCopy(label, text)}
            aria-label={`Copy ${label}`}
            className={COPY_BUTTON}
        >
            {buttonText}
        </button>
    );
}

function Section({ id, heading, children }) {
    return (
        <section aria-labelledby={id} className="border-t border-line pt-4">
            <h2 id={id} className="text-lead font-semibold text-ink">{heading}</h2>
            <dl className="mt-2 flex flex-col">{children}</dl>
        </section>
    );
}

function exifSummaryText(exif) {
    if (!exif.present) return 'Not found';
    return exifHasContent(exif) ? 'Present' : 'Present but unreadable';
}

function SummarySection({ report, headingRef }) {
    const { file, resolution, exif, gps, xmp, icc } = report;
    const extensionNote = extensionMismatchNote(file);

    return (
        <>
            <section aria-labelledby="meta-summary-heading">
                <h2 id="meta-summary-heading" ref={headingRef} tabIndex={-1} className="text-title font-display font-bold tracking-tight text-ink">
                    What this file contains
                </h2>

                <dl className="mt-3 flex flex-col">
                    <Row term="Format">{formatSummaryFormat(file)}</Row>
                    <Row term="Pixels">{`${file.width} × ${file.height}`}</Row>
                    <Row term="Size">{formatFileSize(file.bytes)}</Row>
                    <Row term="EXIF">{exifSummaryText(exif)}</Row>
                    <Row term="GPS">
                        {gps.present ? (
                            <>
                                {'Present — location '}
                                <span aria-hidden="true">⚠</span>
                                <span className="sr-only">warning</span>
                            </>
                        ) : 'Not found'}
                    </Row>
                    <Row term="XMP">{xmp.present ? 'Present' : 'Not found'}</Row>
                    <Row term="ICC profile">{icc.present ? 'Present' : 'Not found'}</Row>
                    <Row term="Resolution">{resolution.present ? formatResolutionValue(resolution) : 'Not found'}</Row>
                    <Row term="Alpha channel">{triState(file.alphaChannel)}</Row>
                </dl>
            </section>

            {extensionNote ? (
                <p role="note" id="meta-extension-note" className="border-t border-line pt-4 text-ui text-ink">
                    {extensionNote}
                </p>
            ) : null}
        </>
    );
}

function PrivacySection({ report }) {
    const { gps, exif, xmp, icc, text, privacy } = report;
    const nonGpsPresent = privacy.categories.filter((category) => category.id !== 'location' && category.present);
    const nothingAtAll = !exif.present && !gps.present && !xmp.present && !icc.present && text.length === 0;

    return (
        <section aria-labelledby="meta-privacy-heading" id="meta-privacy" className="border-t border-line pt-4">
            <h2 id="meta-privacy-heading" className="text-lead font-semibold text-ink">
                {gps.present ? 'Location metadata detected' : 'No location metadata detected'}
            </h2>

            {gps.present ? <p className="mt-1 text-ui text-ink">This image contains GPS coordinates.</p> : null}

            {nothingAtAll ? (
                <p className="mt-1 text-ui text-ink-muted">No common embedded metadata was found.</p>
            ) : nonGpsPresent.length > 0 ? (
                <>
                    <p className="mt-2 text-ui text-ink">Metadata that may reveal information about the photo:</p>
                    <ul className="mt-1 flex list-disc flex-col gap-0.5 pl-5 text-ui text-ink">
                        {nonGpsPresent.map((category) => (
                            <li key={category.id}>{PRIVACY_CATEGORY_LABELS[category.id] ?? category.summary}</li>
                        ))}
                    </ul>
                </>
            ) : null}
        </section>
    );
}

/** Groups report.raw by container/IFD, in a fixed, readable order. */
function groupRaw(raw) {
    const map = new Map();
    for (const row of raw ?? []) {
        if (!map.has(row.group)) map.set(row.group, []);
        map.get(row.group).push(row);
    }

    const ordered = RAW_GROUP_ORDER.filter((group) => map.has(group)).map((group) => [group, map.get(group)]);
    for (const [group, rows] of map) {
        if (!RAW_GROUP_ORDER.includes(group)) ordered.push([group, rows]);
    }
    return ordered;
}

function AdvancedDisclosure({ raw, open, onToggle }) {
    const groups = groupRaw(raw);

    return (
        <div className="border-t border-line pt-4">
            {/* The standard accordion-heading pattern: the toggle button is
                the sole content of its own heading, so a screen reader's
                heading list finds this disclosure the same way it finds every
                other section, rather than nesting it under the section
                before it. */}
            <h2>
                <button
                    type="button"
                    id="meta-advanced"
                    aria-expanded={open}
                    aria-controls="meta-advanced-panel"
                    onClick={onToggle}
                    className={SECONDARY_BUTTON}
                >
                    All detected fields
                </button>
            </h2>

            {open ? (
                <div id="meta-advanced-panel" className="mt-3 flex flex-col gap-4">
                    {groups.length === 0 ? (
                        <p className="text-ui text-ink-muted">No raw fields were recorded for this file.</p>
                    ) : groups.map(([group, rows]) => (
                        <section key={group} aria-labelledby={`meta-raw-${group}-heading`}>
                            <h3 id={`meta-raw-${group}-heading`} className="text-ui font-semibold text-ink">{group}</h3>
                            <dl className="mt-1 flex flex-col">
                                {rows.map((row, index) => (
                                    <div key={`${row.tag}-${index}`} className="flex flex-col gap-0.5 border-b border-line py-2 sm:flex-row sm:gap-4">
                                        <dt className="font-data text-micro text-ink-muted sm:w-40 sm:shrink-0 break-words">
                                            {row.tag}{row.name ? ` (${row.name})` : ''}
                                        </dt>
                                        <dd className="min-w-0 text-micro text-ink [overflow-wrap:anywhere]">
                                            <TruncatedValue value={row.value} />
                                            {row.truncated ? (
                                                // The length actually kept, not this page's own 20,000-char
                                                // ceiling — a reader with a smaller cap of its own (EXIF's
                                                // Software tag caps at 4,096) truncates well before that.
                                                <span className="text-ink-muted"> {`(cut at ${commaNumber(row.value?.length ?? 0)} characters)`}</span>
                                            ) : null}
                                        </dd>
                                    </div>
                                ))}
                            </dl>
                        </section>
                    ))}
                </div>
            ) : null}
        </div>
    );
}

export default function MetadataReport({ report, parseMs = null, onDownload, onReset }) {
    const headingRef = useRef(null);
    const [advancedOpen, setAdvancedOpen] = useState(false);
    const [copyNotice, setCopyNotice] = useState('');
    // The one most recently finished copy, `{ label, ok }` — the button whose
    // own label matches shows "Copied"/"Could not copy"; every other button
    // keeps reading "Copy". Cleared on a timer so the feedback is temporary.
    const [copyStatus, setCopyStatus] = useState(null);

    useEffect(() => {
        headingRef.current?.focus();
    }, []);

    // Cleared before it is set, so a second copy is a change the live region
    // announces rather than the same text it already held. The clear has to
    // be its OWN committed paint, not merely its own state update: React 18's
    // automatic batching folds a plain setState('') and the setState(message)
    // right after it into one commit, so a screen reader — and a real
    // browser's accessibility tree — sees only the final value and never
    // hears the repeat. flushSync forces that first commit to the DOM before
    // this function moves on, which is why a MutationObserver (and AT) sees
    // two distinct changes instead of one.
    const announce = (message) => {
        flushSync(() => setCopyNotice(''));
        setCopyNotice(message);
    };

    const handleCopy = async (label, text) => {
        let ok = true;
        try {
            await navigator.clipboard.writeText(text);
            announce('Copied');
        } catch {
            // Clipboard access can be denied or unavailable; the value is still
            // on screen to select by hand, and the refusal is said out loud.
            ok = false;
            announce('Could not copy');
        }

        setCopyStatus({ label, ok });
        window.setTimeout(() => {
            // Only clear this button's own result — a second copy elsewhere
            // during the window must not have its feedback cut short.
            setCopyStatus((current) => (current?.label === label ? null : current));
        }, COPY_FEEDBACK_MS);
    };

    const { file, resolution, exif, gps, icc, xmp, text, other, privacy, problems } = report;

    const model = fieldById(exif.fields, 'model');
    const captureDate = fieldById(exif.fields, 'dateTimeOriginal');
    const coordinatesText = gps.present && formatCoordinate(gps.latitude) !== null && formatCoordinate(gps.longitude) !== null
        ? `${formatCoordinate(gps.latitude)}, ${formatCoordinate(gps.longitude)}`
        : null;

    return (
        <div className="flex flex-col gap-5" data-parse-ms={parseMs ?? undefined}>
            <SummarySection report={report} headingRef={headingRef} />

            <PrivacySection report={report} />

            <Section id="meta-section-file-heading" heading="File">
                <Row term="Filename">{file.name}</Row>
                <Row term="Detected format">{formatLabel(file.format)}</Row>
                <Row term="Extension">{file.extension ? `.${file.extension}` : 'None'}</Row>
                <Row term="MIME type">{file.mimeType}</Row>
                <Row term="Size">{formatFileSize(file.bytes)}</Row>
            </Section>

            <Section id="meta-section-image-heading" heading="Image">
                <Row
                    term="Pixels"
                    action={<CopyButton label="pixel dimensions" text={`${file.width} × ${file.height}`} onCopy={handleCopy} status={copyStatus} />}
                >
                    {`${file.width} × ${file.height}`}
                </Row>
                <Row term="Megapixels">{Number.isFinite(file.megapixels) ? `${file.megapixels} MP` : null}</Row>
                <Row term="Alpha channel">{triState(file.alphaChannel)}</Row>
                <Row term="Animated">{triState(file.animated)}</Row>
            </Section>

            {resolution.present ? (
                <Section id="meta-section-resolution-heading" heading="Resolution">
                    <Row term="Resolution metadata">{formatResolutionValue(resolution)}</Row>
                    <Row term="Source">{RESOLUTION_SOURCE_LABEL[resolution.source] ?? 'Unknown'}</Row>
                    <Row term="Calculated print size">{formatPrintSize(resolution)}</Row>
                </Section>
            ) : null}

            {exifSectionHasRows(exif) ? (
                <Section id="meta-section-exif-heading" heading="Camera and capture (EXIF)">
                    {exifFieldsToShow(exif).map((field) => (
                        <Row
                            key={field.id}
                            term={field.label}
                            action={field.id === 'model'
                                ? <CopyButton label="camera model" text={field.value} onCopy={handleCopy} status={copyStatus} />
                                : field.id === 'dateTimeOriginal'
                                    ? <CopyButton label="capture date" text={field.value} onCopy={handleCopy} status={copyStatus} />
                                    : null}
                        >
                            <TruncatedValue value={field.value} />
                        </Row>
                    ))}
                    <Row term="Orientation">{formatOrientation(exif.orientation)}</Row>
                </Section>
            ) : null}

            {gps.present ? (
                <Section id="meta-section-gps-heading" heading="Location (GPS)">
                    <Row term="Latitude">{formatCoordinate(gps.latitude)}</Row>
                    <Row
                        term="Longitude"
                        action={<CopyButton label="coordinates" text={coordinatesText} onCopy={handleCopy} status={copyStatus} />}
                    >
                        <span className="break-all">{formatCoordinate(gps.longitude)}</span>
                    </Row>
                    <Row term="Altitude">{formatAltitude(gps.altitude)}</Row>
                    <Row term="GPS time">{formatGpsTime(gps.timestamp)}</Row>
                </Section>
            ) : null}

            {icc.present ? (
                <Section id="meta-section-icc-heading" heading="Colour profile (ICC)">
                    <Row term="Profile">{`ICC colour profile present — ${commaNumber(icc.bytes)} bytes`}</Row>
                    <Row term="Description">{icc.description}</Row>
                    <Row term="Colour space">{icc.colourSpace}</Row>
                </Section>
            ) : null}

            {xmp.present ? (
                <Section id="meta-section-xmp-heading" heading="XMP">
                    <Row term="Packet">{`XMP packet — ${commaNumber(xmp.bytes)} bytes`}</Row>
                    {xmp.fields.map((field) => (
                        <Row key={field.id} term={field.label}>
                            <TruncatedValue value={field.value} />
                        </Row>
                    ))}
                </Section>
            ) : null}

            {text.length > 0 ? (
                <Section id="meta-section-text-heading" heading="Comments and text">
                    {text.map((item, index) => (
                        <Row key={index} term={item.keyword || TEXT_SOURCE_LABEL[item.source] || 'Text'}>
                            <TruncatedValue value={item.value} />
                            {item.truncated ? (
                                <span className="text-ink-muted"> {textCutNote(item)}</span>
                            ) : null}
                        </Row>
                    ))}
                </Section>
            ) : null}

            {other.thumbnail || other.iptc || other.mpf || other.trailer || other.pngTime ? (
                <Section id="meta-section-other-heading" heading="Other">
                    <Row term="Embedded thumbnail">{other.thumbnail ? 'Present' : null}</Row>
                    <Row term="IPTC">{other.iptc ? 'Present' : null}</Row>
                    <Row term="Extra data after the picture">
                        {other.mpf || other.trailer
                            ? [
                                other.mpf ? 'A second embedded image (MPF)' : null,
                                other.trailer ? `${formatFileSize(other.trailerBytes)} appended after the picture` : null,
                            ].filter(Boolean).join('; ')
                            : null}
                    </Row>
                    <Row term="PNG last-modified time">{other.pngTime}</Row>
                </Section>
            ) : null}

            {problems.length > 0 ? (
                <p role="note" id="meta-problems" className="border-t border-line pt-4 text-ui text-ink">
                    {`Some metadata could not be read. ${problems.join(' ')}`}
                </p>
            ) : null}

            <div className="border-t border-line pt-4">
                {privacy.removable ? (
                    <div className="flex flex-col gap-3">
                        <p className="text-ui text-ink-muted">
                            {'Want to remove this information? '}
                            <Link href="/remove-image-metadata" className={LINK}>Remove image metadata</Link>
                            {'.'}
                        </p>
                        <Link href="/remove-image-metadata" className={PRIMARY_BUTTON}>Remove metadata</Link>
                    </div>
                ) : (
                    <p className="text-ui text-ink-muted">There is nothing here for Remove Image Metadata to take out.</p>
                )}
            </div>

            <AdvancedDisclosure raw={report.raw} open={advancedOpen} onToggle={() => setAdvancedOpen((open) => !open)} />

            <div className="border-t border-line pt-4">
                <div className="flex flex-wrap items-center gap-3">
                    <button
                        type="button"
                        onClick={() => onDownload(report)}
                        aria-describedby="meta-download-note"
                        className={SECONDARY_BUTTON}
                    >
                        Download report (JSON)
                    </button>
                    <p id="meta-download-note" className="text-micro text-ink-muted">
                        The report includes any location data found in the file.
                    </p>
                </div>
            </div>

            <div>
                <button type="button" onClick={onReset} className={SECONDARY_BUTTON}>
                    Choose another photo
                </button>
            </div>

            <p role="status" className="sr-only">{copyNotice}</p>
        </div>
    );
}
