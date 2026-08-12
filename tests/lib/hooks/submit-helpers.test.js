import { describe, expect, it } from 'vitest';

import {
    batchTotals,
    formatSavings,
    formatTransition,
    messageForStatus,
    parseHeaders,
    progressFromUpload,
    readErrorMessage,
    resultStats,
    savingsPercent,
} from '@/lib/hooks/submit-helpers';

describe('messageForStatus', () => {
    it('explains a 413 in terms the visitor can act on', () => {
        expect(messageForStatus(413)).toContain('larger than the server will accept');
    });

    it('has a sentence for every status the tools can produce', () => {
        for (const status of [0, 400, 401, 403, 404, 408, 413, 415, 429, 500, 502, 503, 504]) {
            expect(messageForStatus(status).length).toBeGreaterThan(10);
        }
    });

    it('folds an unlisted 5xx into the generic server message', () => {
        expect(messageForStatus(507)).toBe(messageForStatus(500));
    });

    it('never returns an empty string', () => {
        expect(messageForStatus(undefined)).not.toBe('');
        expect(messageForStatus('nonsense')).not.toBe('');
    });
});

describe('readErrorMessage', () => {
    it('uses the API error field when the body is our JSON', () => {
        expect(readErrorMessage('{"error":"Quality must be between 1 and 100."}', 400))
            .toBe('Quality must be between 1 and 100.');
    });

    it('accepts a message field as well', () => {
        expect(readErrorMessage('{"message":"Nope."}', 400)).toBe('Nope.');
    });

    it('falls back to the status sentence for an HTML 413 body', () => {
        const html = '<!DOCTYPE html><html><body>Request Entity Too Large</body></html>';
        expect(readErrorMessage(html, 413)).toBe(messageForStatus(413));
    });

    it('falls back for an empty body', () => {
        expect(readErrorMessage('', 502)).toBe(messageForStatus(502));
        expect(readErrorMessage('   ', 502)).toBe(messageForStatus(502));
        expect(readErrorMessage(null, 502)).toBe(messageForStatus(502));
    });

    it('falls back when a body claims to be JSON and is not', () => {
        expect(readErrorMessage('{not json', 500)).toBe(messageForStatus(500));
    });

    it('falls back when the JSON carries no message', () => {
        expect(readErrorMessage('{"ok":false}', 500)).toBe(messageForStatus(500));
    });

    it('never prints a stack trace at the visitor', () => {
        const trace = `Error: boom\n${'    at Object.<anonymous> (/var/task/index.js:1:1)\n'.repeat(10)}`;
        expect(readErrorMessage(trace, 500)).toBe(messageForStatus(500));
    });

    it('passes a short plain-text message straight through', () => {
        expect(readErrorMessage('Rate limit exceeded.', 429)).toBe('Rate limit exceeded.');
    });
});

describe('parseHeaders', () => {
    it('lower-cases names so callers never guess the casing', () => {
        const headers = parseHeaders('X-Output-Size: 4096\r\nContent-Type: image/webp\r\n');
        expect(headers['x-output-size']).toBe('4096');
        expect(headers['content-type']).toBe('image/webp');
    });

    it('keeps colons inside a value intact', () => {
        expect(parseHeaders('Link: https://example.com/a')['link']).toBe('https://example.com/a');
    });

    it.each([[''], [null], [undefined], ['garbage']])('returns an empty object for %o', (input) => {
        expect(parseHeaders(input)).toEqual({});
    });
});

describe('savingsPercent', () => {
    it.each([
        [1000, 130, 87],
        [1000, 1000, 0],
        [1000, 1040, -4],
    ])('reports %i -> %i as %i%%', (before, after, expected) => {
        expect(savingsPercent(before, after)).toBe(expected);
    });

    it.each([
        [0, 100],
        [-1, 100],
        [null, 100],
        [100, null],
        [NaN, NaN],
    ])('returns null for %o -> %o', (before, after) => {
        expect(savingsPercent(before, after)).toBeNull();
    });
});

describe('formatSavings', () => {
    it('uses a real minus sign for a reduction', () => {
        expect(formatSavings(87)).toBe('−87%');
    });

    it('shows growth honestly rather than hiding it', () => {
        expect(formatSavings(-4)).toBe('+4%');
    });

    it('renders no change as 0%', () => {
        expect(formatSavings(0)).toBe('0%');
    });

    it('returns null when there is nothing to report', () => {
        expect(formatSavings(null)).toBeNull();
        expect(formatSavings(NaN)).toBeNull();
    });
});

describe('formatTransition', () => {
    it('reads old to new', () => {
        expect(formatTransition(1024, 512)).toBe('1 KB → 512 Bytes');
    });
});

describe('resultStats', () => {
    it('prefers the server-reported sizes', () => {
        const stats = resultStats({
            headers: { 'x-original-size': '4000', 'x-output-size': '1000' },
            originalBytes: 9999,
            blobBytes: 8888,
        });

        expect(stats.originalBytes).toBe(4000);
        expect(stats.resultBytes).toBe(1000);
        expect(stats.savedPercent).toBe(75);
    });

    it('falls back to the local numbers when the route reports none', () => {
        const stats = resultStats({ headers: {}, originalBytes: 2000, blobBytes: 500 });
        expect(stats).toMatchObject({ originalBytes: 2000, resultBytes: 500, savedPercent: 75 });
    });

    it('reads the compress target and the rate-limit remainder', () => {
        const stats = resultStats({
            headers: { 'x-target-size': '102400', 'x-ratelimit-remaining': '9' },
        });
        expect(stats.targetBytes).toBe(102400);
        expect(stats.remaining).toBe(9);
    });

    it('reports nulls rather than NaN when nothing is measurable', () => {
        expect(resultStats()).toEqual({
            originalBytes: null,
            resultBytes: null,
            savedPercent: null,
            targetBytes: null,
            remaining: null,
        });
    });

    it('ignores a header that is not a number', () => {
        const stats = resultStats({ headers: { 'x-output-size': 'unknown' }, blobBytes: 42 });
        expect(stats.resultBytes).toBe(42);
    });
});

describe('progressFromUpload', () => {
    it('maps the upload onto the first three quarters of the bar', () => {
        expect(progressFromUpload(0, 100)).toBe(0);
        expect(progressFromUpload(50, 100)).toBe(38);
        expect(progressFromUpload(100, 100)).toBe(75);
    });

    it('never exceeds 75, so the bar does not sit full while the server works', () => {
        expect(progressFromUpload(200, 100)).toBe(75);
    });

    it.each([[10, 0], [NaN, 100], [10, NaN]])('is 0 for %o of %o', (loaded, total) => {
        expect(progressFromUpload(loaded, total)).toBe(0);
    });
});

describe('batchTotals', () => {
    it('sums a batch and reports one saving', () => {
        expect(batchTotals([
            { originalBytes: 1000, resultBytes: 400 },
            { originalBytes: 3000, resultBytes: 600 },
        ])).toEqual({
            count: 2,
            originalBytes: 4000,
            resultBytes: 1000,
            savedBytes: 3000,
            savedPercent: 75,
        });
    });

    it('skips rows that carry no measurable sizes', () => {
        const totals = batchTotals([
            { originalBytes: 1000, resultBytes: 400 },
            { name: 'failed.png' },
        ]);
        expect(totals.count).toBe(1);
    });

    it.each([[[]], [null], [[{ name: 'only-a-name' }]]])('returns null for %o', (input) => {
        expect(batchTotals(input)).toBeNull();
    });
});
