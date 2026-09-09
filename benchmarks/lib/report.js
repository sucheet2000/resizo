/**
 * Results file in, markdown out.
 *
 * The table in benchmarks/README.md is rendered from benchmarks/results/, never
 * typed beside it. A hand-typed table is a claim about numbers that nobody
 * re-derives, and it goes stale the first time a run moves a figure and the
 * prose is not edited to match.
 *
 * TWO RULES THIS FILE ENFORCES, BOTH ABOUT NOT FLATTERING THE PRODUCT
 *
 *  1. A case that failed is still a row. Silently dropping it turns "WebP could
 *     not reach 50 KB on this sample" into "every case we printed worked",
 *     which is how a benchmark lies without stating a single false number. A
 *     failed row keeps its identity, dashes every measurement, and its last
 *     cell reads FAILED with the engine's own message.
 *
 *  2. Nothing is invented for a missing number. An SSIM that could not be
 *     computed prints as an em dash, and an unbounded PSNR prints as ∞ — never
 *     as a plausible-looking ceiling like 99 dB, which a reader would take for
 *     a measurement.
 *
 * Pure and synchronous: it reads no files and calls no clock, so the same
 * results object renders the same markdown forever.
 */

const MISSING = '—';

const SCHEMA = 1;

const isNumber = (value) => typeof value === 'number' && Number.isFinite(value);

/** Kilobytes to one decimal — the unit every form on the internet asks for. */
function formatBytes(bytes) {
    if (!isNumber(bytes)) return MISSING;
    return `${(bytes / 1024).toFixed(1)} KB`;
}

/** Output as a percentage of the input. 25.4% means "a quarter of the size". */
function formatRatio(ratio) {
    if (!isNumber(ratio)) return MISSING;
    return `${(ratio * 100).toFixed(1)}%`;
}

function formatPsnr(value) {
    if (value === Infinity) return '∞';
    if (!isNumber(value)) return MISSING;
    return value.toFixed(2);
}

/** Four places: everything interesting happens between 0.90 and 1.00. */
function formatSsim(value) {
    if (!isNumber(value)) return MISSING;
    return value.toFixed(4);
}

function formatMs(value) {
    if (!isNumber(value)) return MISSING;
    return value >= 1000 ? `${(value / 1000).toFixed(2)} s` : `${Math.round(value)} ms`;
}

/** A cell can hold a panel sentence, and a panel sentence can hold anything. */
function escapeCell(value) {
    if (value === null || value === undefined || value === '') return MISSING;
    return String(value).replace(/\r?\n/g, ' ').replace(/\|/g, '\\|');
}

const pixels = (box) => (box && isNumber(box.width) && isNumber(box.height)
    ? `${box.width}×${box.height}`
    : MISSING);

const dpi = (value) => (isNumber(value) ? `${value} DPI` : MISSING);

const kb = (value) => (isNumber(value) ? `${value} KB` : MISSING);

const upper = (value) => (value ? String(value).toUpperCase() : MISSING);

/**
 * One column layout per scenario, because the scenarios measure genuinely
 * different things and a single shared table would be three quarters dashes.
 * An unknown id falls through to `default` rather than throwing: a new scenario
 * should show up in the report the day it is written, not the day someone
 * remembers to add it here.
 */
const COLUMNS = {
    'jpeg-vs-webp': [
        ['Sample', (item) => escapeCell(item.sample)],
        ['To', (item) => upper(item.output?.format ?? item.settings?.outputFormat)],
        ['Target', (item) => kb(item.settings?.targetKb)],
        ['In', (item) => formatBytes(item.input?.bytes)],
        ['Out', (item) => formatBytes(item.output?.bytes)],
        ['Ratio', (item) => formatRatio(item.ratio)],
        ['Quality', (item) => (isNumber(item.output?.quality) ? String(item.output.quality) : MISSING)],
        ['PSNR (dB)', (item) => formatPsnr(item.psnr)],
        ['SSIM', (item) => formatSsim(item.ssim)],
        ['Time', (item) => formatMs(item.wallMs)],
    ],
    'fit-20kb': [
        ['Sample', (item) => escapeCell(item.sample)],
        ['Target', (item) => kb(item.settings?.targetKb)],
        ['Out', (item) => formatBytes(item.output?.bytes)],
        ['Ratio', (item) => formatRatio(item.ratio)],
        ['Pixels in', (item) => pixels(item.input)],
        ['Pixels out', (item) => pixels(item.output)],
        ['Quality', (item) => (isNumber(item.output?.quality) ? String(item.output.quality) : MISSING)],
        ['Time', (item) => formatMs(item.wallMs)],
        ['What the panel said', (item) => escapeCell(item.panel)],
    ],
    'resize-then-compress': [
        ['Lane', (item) => escapeCell(item.label ?? item.sample)],
        ['Out', (item) => formatBytes(item.output?.bytes)],
        ['Pixels out', (item) => pixels(item.output)],
        ['Quality', (item) => (isNumber(item.output?.quality) ? String(item.output.quality) : MISSING)],
        ['PSNR (dB)', (item) => formatPsnr(item.psnr)],
        ['SSIM', (item) => formatSsim(item.ssim)],
        ['Time', (item) => formatMs(item.wallMs)],
    ],
    dpi: [
        ['Sample', (item) => escapeCell(item.sample)],
        ['Asked', (item) => dpi(item.settings?.dpi)],
        ['Read back', (item) => dpi(item.output?.density)],
        ['In', (item) => formatBytes(item.input?.bytes)],
        ['Out', (item) => formatBytes(item.output?.bytes)],
        ['Pixels in', (item) => pixels(item.input)],
        ['Pixels out', (item) => pixels(item.output)],
        ['Time', (item) => formatMs(item.wallMs)],
    ],
    'demo-outputs': [
        ['Case', (item) => escapeCell(item.label ?? item.sample)],
        ['Route', (item) => escapeCell(item.route)],
        ['In', (item) => formatBytes(item.input?.bytes)],
        ['Out', (item) => formatBytes(item.output?.bytes)],
        ['Pixels out', (item) => pixels(item.output)],
        ['Time', (item) => formatMs(item.wallMs)],
        ['Saved as', (item) => escapeCell(item.file)],
    ],
    default: [
        ['Sample', (item) => escapeCell(item.label ?? item.sample)],
        ['Route', (item) => escapeCell(item.route)],
        ['In', (item) => formatBytes(item.input?.bytes)],
        ['Out', (item) => formatBytes(item.output?.bytes)],
        ['Ratio', (item) => formatRatio(item.ratio)],
        ['PSNR (dB)', (item) => formatPsnr(item.psnr)],
        ['SSIM', (item) => formatSsim(item.ssim)],
        ['Time', (item) => formatMs(item.wallMs)],
    ],
};

const row = (cells) => `| ${cells.join(' | ')} |`;

/**
 * One scenario: a heading and its table.
 *
 * A failed case keeps its first cell — you can still see which input it was —
 * dashes every measurement, and says FAILED in the last cell with whatever the
 * tool actually said. Same column count as every other row, so the table still
 * parses and the failure is impossible to miss.
 */
function renderScenario(scenario) {
    const columns = COLUMNS[scenario.id] ?? COLUMNS.default;
    const cases = scenario.cases ?? [];
    const lines = [`### ${scenario.title ?? scenario.id}`, ''];

    // A caveat goes UNDER the table it qualifies, not into a footnote nobody
    // scrolls to. The rows that look wrong at a glance — a ratio above 100% —
    // are explained on the same screen as the number.
    const note = scenario.note ? ['', scenario.note, ''] : [''];

    if (cases.length === 0) {
        lines.push('No cases ran for this scenario.', ...note);
        return lines.join('\n');
    }

    lines.push(row(columns.map(([header]) => header)));
    lines.push(row(columns.map(() => '---')));

    for (const item of cases) {
        const cells = columns.map(([, value]) => value(item));

        if (item.ok === false) {
            for (let i = 1; i < cells.length; i += 1) cells[i] = MISSING;
            cells[cells.length - 1] = `FAILED — ${escapeCell(item.error ?? 'no output')}`;
        }

        lines.push(row(cells));
    }

    lines.push(...note);
    return lines.join('\n');
}

function renderEnvironment(environment = {}) {
    const machine = [environment.cpu, [environment.os, environment.arch].filter(Boolean).join(' ')]
        .filter(Boolean)
        .join(' — ');

    return [
        `- Machine: ${machine || MISSING}`,
        `- Node: ${environment.node ?? MISSING}`,
        `- Chromium: ${environment.chromium ?? MISSING}`,
        `- Served from: ${environment.baseUrl ?? MISSING}`,
    ];
}

/** The whole file: where the numbers came from, then every scenario in order. */
function renderReport(results) {
    if (!results || typeof results !== 'object') {
        throw new TypeError('renderReport needs a results object');
    }
    if (!Array.isArray(results.scenarios)) {
        throw new TypeError('results.scenarios must be an array');
    }
    if (results.schema !== SCHEMA) {
        throw new RangeError(`unsupported results schema ${results.schema} (this renderer reads ${SCHEMA})`);
    }

    const environment = results.environment ?? {};
    const commit = environment.commit ? environment.commit.slice(0, 7) : 'an unknown commit';
    const branch = environment.branch ? ` (${environment.branch})` : '';

    const lines = [
        '## Results',
        '',
        `Measured ${results.generatedAt ?? 'at an unrecorded time'} on commit ${commit}${branch}.`,
        '',
        ...renderEnvironment(environment),
        '',
    ];

    for (const scenario of results.scenarios) lines.push(renderScenario(scenario));

    return lines.join('\n');
}

module.exports = {
    escapeCell,
    formatBytes,
    formatMs,
    formatPsnr,
    formatRatio,
    formatSsim,
    renderReport,
    renderScenario,
    SCHEMA,
};
