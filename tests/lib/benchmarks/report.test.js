/**
 * The markdown the README shows.
 *
 * This module exists so the table in benchmarks/README.md is rendered from the
 * results file rather than typed next to it. A hand-typed table is a claim
 * about numbers nobody re-checks, and it is wrong the first time a run changes
 * a figure and nobody remembers to edit the prose.
 *
 * The two rules that matter here and are asserted below:
 *
 *   1. A CASE THAT FAILED IS STILL A ROW. Dropping it would turn "WebP could
 *      not reach 50 KB on this sample" into "we only measured the ones that
 *      worked", which is the exact shape of a dishonest benchmark.
 *   2. NOTHING IS INVENTED FOR A MISSING NUMBER. An unmeasurable SSIM prints
 *      as a dash, and an infinite PSNR prints as ∞ rather than as a ceiling
 *      like 99 dB that a reader would take for a measurement.
 */
import { describe, expect, it } from 'vitest';

import {
    escapeCell,
    formatBytes,
    formatMs,
    formatPsnr,
    formatRatio,
    formatSsim,
    renderReport,
    renderScenario,
} from '@/benchmarks/lib/report';

const caseOf = (overrides = {}) => ({
    sample: 'photo-1600x1067.jpg',
    tool: 'compress',
    route: '/compress',
    ok: true,
    settings: { targetKb: 100, policy: 'keep', outputFormat: 'jpeg' },
    input: { bytes: 393_421, width: 1600, height: 1067, format: 'jpeg' },
    output: { bytes: 99_814, width: 1600, height: 1067, format: 'jpeg', quality: 62 },
    wallMs: 2450,
    ratio: 0.2537,
    psnr: 34.2109,
    ssim: 0.912345,
    ...overrides,
});

const resultsOf = (scenarios) => ({
    schema: 1,
    generatedAt: '2026-09-09T12:00:00.000Z',
    environment: {
        commit: '7a9bf1e0c0ffee0000000000000000000000dead',
        branch: 'feat/seo-growth-system',
        baseUrl: 'http://127.0.0.1:3910',
        chromium: '141.0.7390.37',
        node: 'v22.14.0',
        os: 'darwin 25.5.0',
        arch: 'arm64',
        cpu: 'Apple M3 Pro',
    },
    scenarios,
});

describe('the cell formatters', () => {
    it('prints bytes as kilobytes to one decimal', () => {
        expect(formatBytes(1024)).toBe('1.0 KB');
        expect(formatBytes(99_814)).toBe('97.5 KB');
        expect(formatBytes(0)).toBe('0.0 KB');
    });

    it('dashes a byte count that was never measured', () => {
        expect(formatBytes(null)).toBe('—');
        expect(formatBytes(undefined)).toBe('—');
        expect(formatBytes(Number.NaN)).toBe('—');
    });

    it('prints a size ratio as a percentage of the original', () => {
        expect(formatRatio(0.2537)).toBe('25.4%');
        expect(formatRatio(1)).toBe('100.0%');
        expect(formatRatio(null)).toBe('—');
    });

    it('prints an unbounded PSNR as ∞ rather than inventing a ceiling', () => {
        expect(formatPsnr(Infinity)).toBe('∞');
        expect(formatPsnr(34.2109)).toBe('34.21');
        expect(formatPsnr(null)).toBe('—');
    });

    it('prints SSIM to four places, because the interesting range is narrow', () => {
        expect(formatSsim(0.912345)).toBe('0.9123');
        expect(formatSsim(1)).toBe('1.0000');
        expect(formatSsim(-0.5)).toBe('-0.5000');
        expect(formatSsim(null)).toBe('—');
    });

    it('prints milliseconds whole, and seconds past a thousand', () => {
        expect(formatMs(450)).toBe('450 ms');
        expect(formatMs(2450)).toBe('2.45 s');
        expect(formatMs(null)).toBe('—');
    });

    it('keeps a pipe inside a cell from becoming a column', () => {
        expect(escapeCell('a | b')).toBe('a \\| b');
        expect(escapeCell('line\nbreak')).toBe('line break');
        expect(escapeCell(null)).toBe('—');
    });
});

describe('renderScenario', () => {
    it('renders a heading, a table, and one row per case', () => {
        const markdown = renderScenario({
            id: 'jpeg-vs-webp',
            title: 'JPEG against WebP at a fixed byte target',
            cases: [caseOf(), caseOf({ output: { ...caseOf().output, format: 'webp' } })],
        });

        const lines = markdown.trim().split('\n');
        expect(lines[0]).toBe('### JPEG against WebP at a fixed byte target');

        const rows = lines.filter((line) => line.startsWith('|'));
        // header, separator, two cases.
        expect(rows).toHaveLength(4);
    });

    it('keeps every row the same width as its header', () => {
        const markdown = renderScenario({
            id: 'jpeg-vs-webp',
            title: 'A',
            cases: [caseOf(), caseOf({ ok: false, error: 'target-unreachable', output: null, psnr: null, ssim: null })],
        });

        const rows = markdown.split('\n').filter((line) => line.startsWith('|'));
        const widths = new Set(rows.map((row) => row.split('|').length));
        expect(widths.size).toBe(1);
    });

    it('renders a case that failed as a row that says so', () => {
        const markdown = renderScenario({
            id: 'jpeg-vs-webp',
            title: 'A',
            cases: [caseOf({
                ok: false,
                error: 'Cannot reach 50 KB for this image. Smallest achievable is 61 KB.',
                output: null,
                wallMs: null,
                ratio: null,
                psnr: null,
                ssim: null,
            })],
        });

        expect(markdown).toContain('Smallest achievable is 61 KB');
        expect(markdown).toMatch(/FAILED|not measured/i);
    });

    it('prints the scenario note under the table, where a caveat belongs', () => {
        const markdown = renderScenario({
            id: 'jpeg-vs-webp',
            title: 'A',
            note: 'A target is a ceiling, not a goal.',
            cases: [caseOf()],
        });

        const lines = markdown.trim().split('\n');
        const lastRow = lines.findLastIndex((line) => line.startsWith('|'));

        expect(lines[lines.length - 1]).toBe('A target is a ceiling, not a goal.');
        expect(lastRow).toBeLessThan(lines.length - 1);
    });

    it('prints the note even when the scenario ran nothing', () => {
        const markdown = renderScenario({ id: 'x', title: 'X', note: 'Why it ran nothing.', cases: [] });
        expect(markdown).toContain('Why it ran nothing.');
    });

    it('says so plainly when a scenario ran no cases', () => {
        const markdown = renderScenario({ id: 'dpi', title: 'DPI', cases: [] });
        expect(markdown).toMatch(/no cases/i);
        expect(markdown.split('\n').filter((line) => line.startsWith('|'))).toHaveLength(0);
    });

    it('falls back to a generic table for a scenario it has no columns for', () => {
        const markdown = renderScenario({
            id: 'something-new',
            title: 'Something new',
            cases: [caseOf()],
        });

        expect(markdown).toContain('### Something new');
        expect(markdown).toContain('photo-1600x1067.jpg');
        expect(markdown.split('\n').filter((line) => line.startsWith('|')).length).toBeGreaterThanOrEqual(3);
    });

    it('renders exactly this markdown for a known scenario', () => {
        const markdown = renderScenario({
            id: 'dpi',
            title: 'DPI, header only',
            cases: [{
                sample: 'photo-1600x1067.jpg',
                tool: 'change-image-dpi',
                route: '/change-image-dpi',
                ok: true,
                settings: { dpi: 300 },
                input: { bytes: 393_421, width: 1600, height: 1067, format: 'jpeg', density: 72 },
                output: { bytes: 393_512, width: 1600, height: 1067, format: 'jpeg', density: 300 },
                wallMs: 380,
            }],
        });

        expect(markdown).toBe([
            '### DPI, header only',
            '',
            '| Sample | Asked | Read back | In | Out | Pixels in | Pixels out | Time |',
            '| --- | --- | --- | --- | --- | --- | --- | --- |',
            '| photo-1600x1067.jpg | 300 DPI | 300 DPI | 384.2 KB | 384.3 KB | 1600×1067 | 1600×1067 | 380 ms |',
            '',
        ].join('\n'));
    });
});

describe('renderReport', () => {
    const results = resultsOf([
        { id: 'jpeg-vs-webp', title: 'A', cases: [caseOf()] },
        { id: 'fit-20kb', title: 'B', cases: [] },
    ]);

    it('names the commit, the machine and the browser the numbers came from', () => {
        const markdown = renderReport(results);

        expect(markdown).toContain('7a9bf1e');
        expect(markdown).toContain('Apple M3 Pro');
        expect(markdown).toContain('141.0.7390.37');
        expect(markdown).toContain('2026-09-09');
    });

    it('renders every scenario, including the empty one', () => {
        const markdown = renderReport(results);
        expect(markdown).toContain('### A');
        expect(markdown).toContain('### B');
    });

    it('is deterministic', () => {
        expect(renderReport(results)).toBe(renderReport(results));
    });

    it('refuses a results object it does not understand', () => {
        expect(() => renderReport(null)).toThrow(/results/i);
        expect(() => renderReport({ scenarios: 'nope' })).toThrow(/scenarios/i);
        expect(() => renderReport({ schema: 99, scenarios: [] })).toThrow(/schema/i);
    });
});
