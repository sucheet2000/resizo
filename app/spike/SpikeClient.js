'use client';

/**
 * PHASE 0 SPIKE — THROWAWAY. Not for merge.
 *
 * A phone-readable harness that answers one question: can a real device decode,
 * resize and re-encode a real photo entirely on-device? Everything heavy runs in
 * spike.worker.js. This file only renders, keeps crash breadcrumbs in
 * localStorage, and produces a paste-able text report.
 *
 * Deliberately styled with inline styles: no design tokens, no ToolShell, so it
 * cannot drift into looking like a shipped page.
 */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';

const BREADCRUMB_KEY = 'resizo:spike:breadcrumb';

const styles = {
    page: {
        maxWidth: 780,
        margin: '0 auto',
        padding: '16px 14px 96px',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: 15,
        lineHeight: 1.5,
        color: '#111',
        background: '#fff',
        overflowWrap: 'anywhere',
        wordBreak: 'break-word',
    },
    h1: { fontSize: 22, fontWeight: 700, margin: '0 0 4px' },
    h2: { fontSize: 17, fontWeight: 700, margin: '28px 0 8px' },
    note: { fontSize: 13, color: '#555', margin: '0 0 16px' },
    banner: {
        background: '#b00020',
        color: '#fff',
        padding: '14px 12px',
        borderRadius: 8,
        margin: '0 0 16px',
        fontWeight: 700,
        fontSize: 16,
    },
    bannerButton: {
        marginTop: 10,
        background: '#fff',
        color: '#b00020',
        border: 0,
        borderRadius: 6,
        padding: '8px 14px',
        fontSize: 15,
        fontWeight: 700,
    },
    dropZone: {
        border: '2px dashed #888',
        borderRadius: 10,
        padding: 18,
        textAlign: 'center',
        background: '#fafafa',
    },
    input: { fontSize: 16, width: '100%', maxWidth: '100%' },
    bigButton: {
        display: 'block',
        width: '100%',
        padding: '18px 12px',
        fontSize: 19,
        fontWeight: 700,
        background: '#0b5fff',
        color: '#fff',
        border: 0,
        borderRadius: 10,
        marginTop: 8,
    },
    row: {
        borderTop: '1px solid #e2e2e2',
        padding: '10px 0',
    },
    rowHead: { display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'baseline' },
    step: { fontWeight: 700 },
    detail: { fontSize: 13, color: '#333', marginTop: 2 },
    heap: { fontSize: 12, color: '#666', marginTop: 2 },
    kv: { fontSize: 13, margin: '2px 0' },
    report: {
        width: '100%',
        minHeight: 220,
        fontFamily: 'inherit',
        fontSize: 12,
        marginTop: 10,
        padding: 8,
        boxSizing: 'border-box',
    },
};

const STATUS_COLORS = { ok: '#0a7d28', FAIL: '#b00020', skip: '#777' };

function formatMs(ms) {
    if (ms === null || ms === undefined) return '—';
    if (ms >= 1000) return `${(ms / 1000).toFixed(2)} s`;
    return `${ms.toFixed(1)} ms`;
}

function formatHeap(bytes) {
    if (bytes === null || bytes === undefined) return null;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Main-thread heap. Chrome gives performance.memory here even when the worker
 * does not get it, but the two run in separate V8 isolates, so this number does
 * NOT include the worker's pixel buffers. It is reported as a separate, clearly
 * labelled line rather than merged with the worker figures.
 */
function mainHeapUsed() {
    const memory = typeof performance === 'undefined' ? null : performance.memory;
    return memory && typeof memory.usedJSHeapSize === 'number' ? memory.usedJSHeapSize : null;
}

function heapLine(row) {
    const parts = [];
    if (row.heapBefore !== null && row.heapBefore !== undefined) {
        parts.push(`worker heap ${formatHeap(row.heapBefore)} -> ${formatHeap(row.heapAfter)}`);
    }
    if (row.mainHeapBefore !== null && row.mainHeapBefore !== undefined) {
        parts.push(
            `main-thread heap (separate isolate) ${formatHeap(row.mainHeapBefore)} -> ${formatHeap(row.mainHeapAfter)}`,
        );
    }
    return parts.length ? parts.join(' | ') : null;
}

function readDeviceInfo() {
    const nav = typeof navigator === 'undefined' ? {} : navigator;
    const memory = typeof performance !== 'undefined' ? performance.memory : null;
    return {
        userAgent: nav.userAgent || 'unknown',
        deviceMemoryGB: typeof nav.deviceMemory === 'number' ? nav.deviceMemory : null,
        hardwareConcurrency:
            typeof nav.hardwareConcurrency === 'number' ? nav.hardwareConcurrency : null,
        screen:
            typeof screen === 'undefined'
                ? 'unknown'
                : `${screen.width}x${screen.height} (avail ${screen.availWidth}x${screen.availHeight})`,
        devicePixelRatio: typeof window === 'undefined' ? null : window.devicePixelRatio,
        crossOriginIsolated:
            typeof globalThis.crossOriginIsolated === 'boolean'
                ? globalThis.crossOriginIsolated
                : null,
        jsHeapLimitMB: memory
            ? (memory.jsHeapSizeLimit / (1024 * 1024)).toFixed(0)
            : null,
        performanceMemory: Boolean(memory),
        offscreenCanvas: typeof OffscreenCanvas !== 'undefined',
        createImageBitmap: typeof createImageBitmap !== 'undefined',
        workers: typeof Worker !== 'undefined',
        wasm: typeof WebAssembly !== 'undefined',
    };
}

function readDeadRun() {
    try {
        const raw = window.localStorage.getItem(BREADCRUMB_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        return parsed && !parsed.complete ? parsed : null;
    } catch {
        // localStorage is unavailable in some private modes; forensics are best-effort.
        return null;
    }
}

/**
 * navigator/screen/localStorage are external systems, not React state, and they
 * do not exist during the server render. useSyncExternalStore is the sanctioned
 * way to read them without a hydration mismatch and without a setState-in-effect.
 * The snapshot is cached because getSnapshot must be referentially stable.
 */
const SERVER_SNAPSHOT = { device: null, deadRun: null };
let clientSnapshot = null;
const environmentListeners = new Set();

function getEnvironmentSnapshot() {
    if (!clientSnapshot) {
        clientSnapshot = { device: readDeviceInfo(), deadRun: readDeadRun() };
    }
    return clientSnapshot;
}

function getServerEnvironmentSnapshot() {
    return SERVER_SNAPSHOT;
}

function subscribeEnvironment(onChange) {
    environmentListeners.add(onChange);
    return () => environmentListeners.delete(onChange);
}

function forgetDeadRun() {
    try {
        window.localStorage.removeItem(BREADCRUMB_KEY);
    } catch {
        // ignore
    }
    clientSnapshot = { ...getEnvironmentSnapshot(), deadRun: null };
    environmentListeners.forEach((listener) => listener());
}

function buildReport(device, rows, deadRun, fileLabel) {
    const lines = [];
    lines.push('RESIZO PHASE 0 ON-DEVICE SPIKE');
    lines.push(`generated: ${new Date().toISOString()}`);
    lines.push('');
    lines.push('--- DEVICE ---');
    if (device) {
        lines.push(`userAgent: ${device.userAgent}`);
        lines.push(`deviceMemory: ${device.deviceMemoryGB === null ? 'not reported' : `${device.deviceMemoryGB} GB`}`);
        lines.push(`hardwareConcurrency: ${device.hardwareConcurrency === null ? 'not reported' : device.hardwareConcurrency}`);
        lines.push(`screen: ${device.screen}`);
        lines.push(`devicePixelRatio: ${device.devicePixelRatio}`);
        lines.push(`crossOriginIsolated: ${device.crossOriginIsolated}`);
        lines.push(`performance.memory (main thread): ${device.performanceMemory ? `available, heap limit ${device.jsHeapLimitMB} MB` : 'NOT AVAILABLE (Safari)'}`);
        lines.push(`OffscreenCanvas: ${device.offscreenCanvas} | createImageBitmap: ${device.createImageBitmap} | Worker: ${device.workers} | WebAssembly: ${device.wasm}`);
    } else {
        lines.push('(not read yet)');
    }
    lines.push('');
    lines.push('--- CRASH BREADCRUMB ---');
    lines.push(
        deadRun
            ? `PREVIOUS RUN DIED AT: ${deadRun.step} | at ${deadRun.at} | file ${deadRun.file || 'unknown'}`
            : 'none (no unfinished previous run)',
    );
    lines.push('');
    lines.push(`--- RUN: ${fileLabel || 'no file yet'} ---`);
    if (rows.length === 0) lines.push('(no steps run)');
    rows.forEach((row) => {
        lines.push(`${row.step} — ${row.status} — ${formatMs(row.ms)}`);
        if (row.detail) lines.push(`    ${row.detail}`);
        const heap = heapLine(row);
        if (heap) lines.push(`    ${heap}`);
    });
    lines.push('');
    return lines.join('\n');
}

export default function SpikeClient() {
    const environment = useSyncExternalStore(
        subscribeEnvironment,
        getEnvironmentSnapshot,
        getServerEnvironmentSnapshot,
    );
    const { device, deadRun } = environment;
    const [rows, setRows] = useState([]);
    const [running, setRunning] = useState(false);
    const [fileLabel, setFileLabel] = useState('');
    const [currentStep, setCurrentStep] = useState('');
    const [copied, setCopied] = useState('');
    const workerRef = useRef(null);
    // Single slot: steps are strictly sequential, so the sample taken at
    // 'begin' always belongs to the next 'row' that arrives.
    const mainHeapAtBeginRef = useRef(null);

    useEffect(
        () => () => {
            if (workerRef.current) workerRef.current.terminate();
        },
        [],
    );

    const writeBreadcrumb = useCallback((step, label, complete) => {
        try {
            window.localStorage.setItem(
                BREADCRUMB_KEY,
                JSON.stringify({
                    step,
                    at: new Date().toISOString(),
                    file: label,
                    complete: Boolean(complete),
                }),
            );
        } catch {
            // ignore
        }
    }, []);

    const pushRow = useCallback((row) => {
        setRows((previous) => [...previous, row]);
    }, []);

    const run = useCallback(
        (file) => {
            if (!file) return;
            const label = `${file.name} (${(file.size / (1024 * 1024)).toFixed(2)} MB, ${file.type || 'no type'})`;
            setFileLabel(label);
            setRows([]);
            setCopied('');
            setRunning(true);
            setCurrentStep('starting worker');
            writeBreadcrumb('00 worker startup', label, false);

            if (workerRef.current) workerRef.current.terminate();

            let worker;
            try {
                worker = new Worker(new URL('./spike.worker.js', import.meta.url));
            } catch (error) {
                pushRow({
                    step: '00 worker startup',
                    status: 'FAIL',
                    ms: null,
                    detail: `Worker could not be created: ${String(error)}`,
                });
                setRunning(false);
                setCurrentStep('');
                return;
            }
            workerRef.current = worker;

            worker.onmessage = (event) => {
                const message = event.data || {};
                if (message.type === 'begin') {
                    setCurrentStep(message.step);
                    writeBreadcrumb(message.step, label, false);
                    mainHeapAtBeginRef.current = mainHeapUsed();
                    worker.postMessage({ type: 'ack', seq: message.seq });
                    return;
                }
                if (message.type === 'row') {
                    const mainHeapBefore = mainHeapAtBeginRef.current;
                    mainHeapAtBeginRef.current = null;
                    pushRow({
                        ...message.row,
                        mainHeapBefore,
                        mainHeapAfter: mainHeapBefore === null ? null : mainHeapUsed(),
                    });
                    return;
                }
                if (message.type === 'fatal') {
                    pushRow({
                        step: 'battery aborted',
                        status: 'FAIL',
                        ms: null,
                        detail: message.message,
                    });
                    writeBreadcrumb('battery aborted', label, true);
                    setRunning(false);
                    setCurrentStep('');
                    return;
                }
                if (message.type === 'done') {
                    writeBreadcrumb('all steps finished', label, true);
                    setRunning(false);
                    setCurrentStep('');
                    worker.terminate();
                    if (workerRef.current === worker) workerRef.current = null;
                }
            };

            worker.onerror = (event) => {
                pushRow({
                    step: 'worker error',
                    status: 'FAIL',
                    ms: null,
                    detail: event.message || 'worker failed to load or threw',
                });
                setRunning(false);
                setCurrentStep('');
            };

            worker.postMessage({ type: 'run', file });
        },
        [pushRow, writeBreadcrumb],
    );

    const onFileChange = useCallback(
        (event) => {
            const file = event.target.files && event.target.files[0];
            if (file) run(file);
        },
        [run],
    );

    const onDrop = useCallback(
        (event) => {
            event.preventDefault();
            const file = event.dataTransfer.files && event.dataTransfer.files[0];
            if (file) run(file);
        },
        [run],
    );

    const report = buildReport(device, rows, deadRun, fileLabel);

    const copyReport = useCallback(async () => {
        try {
            await navigator.clipboard.writeText(report);
            setCopied('Copied to clipboard.');
        } catch {
            setCopied('Clipboard blocked — select the text box below and copy manually.');
        }
    }, [report]);

    const clearBreadcrumb = useCallback(() => {
        forgetDeadRun();
    }, []);

    return (
        <main style={styles.page}>
            <h1 style={styles.h1}>Phase 0 device spike</h1>
            <p style={styles.note}>
                Throwaway benchmark. Pick a photo (a big one — straight from the camera roll) and
                the page will decode, resize and re-encode it entirely on this device, timing each
                step. If the tab dies, reload: it will tell you which step killed it.
            </p>

            {deadRun ? (
                <div style={styles.banner}>
                    LAST RUN DIED AT: {deadRun.step}
                    <div style={{ fontWeight: 400, fontSize: 13, marginTop: 6 }}>
                        {deadRun.at} — {deadRun.file || 'unknown file'}
                    </div>
                    <button type="button" style={styles.bannerButton} onClick={clearBreadcrumb}>
                        Clear
                    </button>
                </div>
            ) : null}

            <h2 style={styles.h2}>Device</h2>
            {device ? (
                <div>
                    <div style={styles.kv}>userAgent: {device.userAgent}</div>
                    <div style={styles.kv}>
                        deviceMemory:{' '}
                        {device.deviceMemoryGB === null
                            ? 'not reported'
                            : `${device.deviceMemoryGB} GB`}
                    </div>
                    <div style={styles.kv}>
                        hardwareConcurrency:{' '}
                        {device.hardwareConcurrency === null
                            ? 'not reported'
                            : device.hardwareConcurrency}
                    </div>
                    <div style={styles.kv}>screen: {device.screen}</div>
                    <div style={styles.kv}>devicePixelRatio: {String(device.devicePixelRatio)}</div>
                    <div style={styles.kv}>
                        crossOriginIsolated: {String(device.crossOriginIsolated)}
                    </div>
                    <div style={styles.kv}>
                        performance.memory (main thread):{' '}
                        {device.performanceMemory
                            ? `available (heap limit ${device.jsHeapLimitMB} MB)`
                            : 'NOT AVAILABLE on this browser (Safari) — memory columns will be blank'}
                    </div>
                    <div style={styles.kv}>
                        OffscreenCanvas {String(device.offscreenCanvas)} | createImageBitmap{' '}
                        {String(device.createImageBitmap)} | Worker {String(device.workers)} |
                        WebAssembly {String(device.wasm)}
                    </div>
                </div>
            ) : (
                <div style={styles.kv}>reading…</div>
            )}

            <h2 style={styles.h2}>Pick an image</h2>
            <div
                style={styles.dropZone}
                onDrop={onDrop}
                onDragOver={(event) => event.preventDefault()}
            >
                <input
                    type="file"
                    accept="image/*,.heic,.heif"
                    onChange={onFileChange}
                    disabled={running}
                    style={styles.input}
                />
                <div style={{ fontSize: 13, color: '#555', marginTop: 8 }}>
                    or drag a file here. HEIC/HEIF welcome.
                </div>
            </div>

            <h2 style={styles.h2}>
                Results {running ? `— RUNNING: ${currentStep}` : rows.length ? '— finished' : ''}
            </h2>
            {fileLabel ? <div style={styles.kv}>file: {fileLabel}</div> : null}
            {rows.length === 0 ? (
                <div style={styles.kv}>no steps yet</div>
            ) : (
                rows.map((row, index) => (
                    <div key={`${row.step}-${index}`} style={styles.row}>
                        <div style={styles.rowHead}>
                            <span style={styles.step}>{row.step}</span>
                            <span style={{ color: STATUS_COLORS[row.status] || '#111', fontWeight: 700 }}>
                                {row.status}
                            </span>
                            <span>{formatMs(row.ms)}</span>
                        </div>
                        {row.detail ? <div style={styles.detail}>{row.detail}</div> : null}
                        {heapLine(row) ? <div style={styles.heap}>{heapLine(row)}</div> : null}
                    </div>
                ))
            )}

            <h2 style={styles.h2}>Report</h2>
            <button type="button" style={styles.bigButton} onClick={copyReport}>
                COPY RESULTS
            </button>
            {copied ? <div style={styles.kv}>{copied}</div> : null}
            <textarea style={styles.report} readOnly value={report} />
        </main>
    );
}
