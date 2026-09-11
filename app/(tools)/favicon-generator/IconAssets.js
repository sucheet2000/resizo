'use client';

/**
 * IconAssets
 *
 * Everything the finished favicon package renders: the four-size sanity
 * preview, the seven-row asset list (six files the engine wrote plus the
 * manifest this page builds), the ZIP, and the HTML/manifest text blocks with
 * their copy buttons.
 *
 * THE MANIFEST IS BUILT HERE, NOT BY THE ENGINE. The `icons` op hands back six
 * binary assets in ICON_ASSETS order, minus the manifest — site.webmanifest is
 * text assembled from two free-text fields (App name, Short name) and two
 * colours, and lib/format/icon-package.js's buildManifest is what turns those
 * into JSON safely (JSON.stringify, never a template). This component is the
 * one place that calls it, so the visible manifest, the copied manifest and
 * the manifest inside the ZIP can never be three different strings.
 *
 * ORDER IS ICON_ASSETS' OWN. The engine, the ZIP and this list all read the
 * same array, so a filename can never appear here that the ZIP does not
 * contain, or in an order that does not match the snippet's own citations.
 *
 * JSZip loads on the ZIP click and nowhere else — `buildZip`
 * (lib/upload/batch.js) is what defers the `import('jszip')`, so nothing here
 * has to.
 */
import { useEffect, useMemo, useState } from 'react';
import { flushSync } from 'react-dom';

import Alert from '@/components/ui/Alert';
import { formatFileSize } from '@/lib/format/bytes';
import { ICON_ASSETS, ZIP_FILENAME, buildHtmlSnippet, buildManifest } from '@/lib/format/icon-package';
import { STATUS, ZIP_FAILED_MESSAGE, buildZip } from '@/lib/upload/batch';

const PREVIEW_SIZES = [16, 32, 192, 512];
const ENLARGED_SIZES = new Set([16, 32]);
const ENLARGE_FACTOR = 4;

const SECONDARY_BUTTON = 'inline-flex min-h-11 items-center justify-center rounded-button border border-line px-3 py-2 text-ui font-medium text-ink transition-colors duration-120 ease-snap hover:bg-surface-sunken disabled:opacity-60';

const PRIMARY_BUTTON = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-button bg-accent px-4 py-2 text-ui font-semibold text-accent-ink transition-[filter] duration-180 ease-snap hover:brightness-95 disabled:opacity-60';

/** How long a copy button shows its own feedback before reverting to "Copy". */
const COPY_FEEDBACK_MS = 1500;

function typeLabel(kind) {
    if (kind === 'ico') return 'ICO';
    if (kind === 'manifest') return 'JSON';
    return 'PNG';
}

function dimensionsLabel(row) {
    if (row.kind === 'ico') return `ICO: ${row.sizes.join(', ')}`;
    if (row.kind === 'manifest') return 'Web app manifest';
    return `${row.width} × ${row.height}`;
}

function isVerified(row, checks) {
    const check = (Array.isArray(checks) ? checks : []).find((entry) => entry.key === row.filename);
    return Boolean(check?.ok);
}

/**
 * The manifest is the one file the engine never sees, so the page checks it
 * the only way it honestly can: the text it just built parses as JSON and
 * every icon it names is a file in this package. A manifest that names a file
 * the ZIP does not hold is valid JSON and a 404 on install day.
 */
function manifestVerified(manifestJson, filenames) {
    try {
        const document = JSON.parse(manifestJson);
        return Array.isArray(document.icons)
            && document.icons.length > 0
            && document.icons.every((icon) => filenames.includes(String(icon.src).replace(/^\//, '')));
    } catch {
        return false;
    }
}

/** The same anchor-click-and-revoke download every hook in this codebase uses, for one blob rather than a whole result. */
function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename || 'resizo-output';
    anchor.rel = 'noopener';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
}

/**
 * Object URLs for the four preview sizes only — the asset LIST needs no
 * `<img>`, just the blob and the filename, so nothing is created for the ICO
 * or the other three PNGs.
 *
 * Computed with useMemo rather than an effect + setState: creating the map IS
 * the value, with nothing to synchronise afterwards, so there is no state to
 * set. The effect below carries only the cleanup half — revoking whichever
 * map was current gets replaced or unmounted — which is a subscription-style
 * effect rather than the derived-state-in-an-effect pattern the React
 * Compiler's own lint rule (react-hooks/set-state-in-effect) exists to catch.
 */
function usePreviewUrls(assets) {
    const urls = useMemo(() => {
        const next = {};
        for (const asset of Array.isArray(assets) ? assets : []) {
            if (asset?.blob && PREVIEW_SIZES.includes(asset.width)) {
                next[asset.id] = URL.createObjectURL(asset.blob);
            }
        }
        return next;
    }, [assets]);

    useEffect(() => () => {
        for (const url of Object.values(urls)) URL.revokeObjectURL(url);
    }, [urls]);

    return urls;
}

export default function IconAssets({ assets, checks, manifestFields, onReset }) {
    const [zipError, setZipError] = useState(null);
    const [isZipping, setIsZipping] = useState(false);
    const [copyNotice, setCopyNotice] = useState('');
    // The one most recently finished copy — see MetadataReport.js's own
    // identical pattern, which this mirrors: only the button whose label
    // matches shows its own result.
    const [copyStatus, setCopyStatus] = useState(null);

    const previewUrls = usePreviewUrls(assets);

    const manifestJson = buildManifest(manifestFields);
    const manifestBlob = new Blob([manifestJson], { type: 'application/manifest+json' });
    const htmlSnippet = buildHtmlSnippet({ manifest: true });

    const packageFilenames = ICON_ASSETS.map((entry) => entry.filename);
    const rows = ICON_ASSETS.map((entry) => {
        if (entry.kind === 'manifest') {
            return {
                ...entry,
                blob: manifestBlob,
                bytes: manifestBlob.size,
                verified: manifestVerified(manifestJson, packageFilenames),
            };
        }
        const asset = (Array.isArray(assets) ? assets : []).find((item) => item.id === entry.id);
        return {
            ...entry,
            blob: asset?.blob ?? null,
            bytes: asset?.bytes ?? asset?.blob?.size ?? null,
        };
    });

    // Cleared before it is set, so a second copy is a change the live region
    // announces rather than the same text it already held — flushSync forces
    // the clear to actually paint before the real message does.
    const announce = (message) => {
        flushSync(() => setCopyNotice(''));
        setCopyNotice(message);
    };

    async function handleCopy(label, text) {
        let ok = true;
        try {
            await navigator.clipboard.writeText(text);
            announce('Copied');
        } catch {
            ok = false;
            announce('Could not copy');
        }

        setCopyStatus({ label, ok });
        window.setTimeout(() => {
            setCopyStatus((current) => (current?.label === label ? null : current));
        }, COPY_FEEDBACK_MS);
    }

    function copyButtonText(label, fallback) {
        return copyStatus?.label === label ? (copyStatus.ok ? 'Copied' : 'Could not copy') : fallback;
    }

    async function handleDownloadZip() {
        setZipError(null);
        setIsZipping(true);
        try {
            const zipRows = rows
                .filter((row) => row.blob)
                .map((row) => ({ id: row.id, status: STATUS.success, blob: row.blob, filename: row.filename }));
            const { blob, filename } = await buildZip(zipRows, { filename: ZIP_FILENAME });
            downloadBlob(blob, filename);
        } catch {
            setZipError(ZIP_FAILED_MESSAGE);
        } finally {
            setIsZipping(false);
        }
    }

    return (
        <div className="flex flex-col gap-6">
            <div id="icon-sizes" className="flex flex-wrap gap-4">
                {PREVIEW_SIZES.map((size) => {
                    const row = rows.find((entry) => entry.kind === 'png' && entry.width === size);
                    const url = row ? previewUrls[row.id] : null;
                    if (!row || !url) return null;

                    const alt = `Generated ${size} × ${size} icon`;

                    return (
                        <div key={size} className="flex flex-wrap items-end gap-3">
                            <figure className="flex flex-col items-center gap-1">
                                {/* eslint-disable-next-line @next/next/no-img-element -- blob: URL of the generated icon; next/image cannot optimise it. */}
                                <img src={url} width={size} height={size} alt={alt} className="checkerboard rounded-input border border-line" />
                                <figcaption className="font-data text-micro text-ink-muted">{size} × {size}</figcaption>
                            </figure>

                            {ENLARGED_SIZES.has(size) ? (
                                <figure className="flex flex-col items-center gap-1">
                                    {/* eslint-disable-next-line @next/next/no-img-element -- same generated icon, shown larger to check fine detail. */}
                                    <img
                                        src={url}
                                        width={size * ENLARGE_FACTOR}
                                        height={size * ENLARGE_FACTOR}
                                        alt={alt}
                                        style={{ imageRendering: 'pixelated' }}
                                        className="checkerboard rounded-input border border-line"
                                    />
                                    <figcaption className="font-data text-micro text-ink-muted">
                                        {size} × {size} (enlarged to check)
                                    </figcaption>
                                </figure>
                            ) : null}
                        </div>
                    );
                })}
            </div>

            <ul id="icon-assets" className="flex flex-col divide-y divide-line">
                {rows.map((row) => (
                    <li key={row.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                        <div className="min-w-0">
                            <p className="break-all font-data text-ui text-ink">{row.filename}</p>
                            <p className="text-micro text-ink-muted">
                                {dimensionsLabel(row)}
                                {' · '}{typeLabel(row.kind)}
                                {Number.isFinite(row.bytes) ? <> · {formatFileSize(row.bytes)}</> : null}
                                {(row.kind === 'manifest' ? row.verified : isVerified(row, checks)) ? <> · Verified</> : null}
                            </p>
                        </div>
                        {row.blob ? (
                            <button
                                type="button"
                                aria-label={`Download ${row.filename}`}
                                onClick={() => downloadBlob(row.blob, row.filename)}
                                className={SECONDARY_BUTTON}
                            >
                                Download
                            </button>
                        ) : null}
                    </li>
                ))}
            </ul>

            <div className="flex flex-col items-start gap-2">
                <button type="button" onClick={handleDownloadZip} disabled={isZipping} className={PRIMARY_BUTTON}>
                    {isZipping ? 'Zipping…' : 'Download all as ZIP'}
                </button>
                {zipError ? <Alert>{zipError}</Alert> : null}
            </div>

            <div className="min-w-0">
                <p className="text-micro text-ink-muted">Example HTML for these generated files.</p>
                <pre id="icon-html" className="mt-1.5 overflow-x-auto rounded-input border border-line bg-surface-sunken p-3 text-micro">
                    <code className="font-data">{htmlSnippet}</code>
                </pre>
                <button type="button" onClick={() => handleCopy('html', htmlSnippet)} className={`${SECONDARY_BUTTON} mt-2`}>
                    {copyButtonText('html', 'Copy HTML')}
                </button>
            </div>

            <div className="min-w-0">
                <p className="text-micro text-ink-muted">The web app manifest for this package.</p>
                <pre id="icon-manifest" className="mt-1.5 overflow-x-auto rounded-input border border-line bg-surface-sunken p-3 text-micro">
                    <code className="font-data">{manifestJson}</code>
                </pre>
                <button type="button" onClick={() => handleCopy('manifest', manifestJson)} className={`${SECONDARY_BUTTON} mt-2`}>
                    {copyButtonText('manifest', 'Copy manifest')}
                </button>
            </div>

            <div>
                <button type="button" onClick={onReset} className={SECONDARY_BUTTON}>
                    Start over
                </button>
            </div>

            <p role="status" className="sr-only">{copyNotice}</p>
        </div>
    );
}
