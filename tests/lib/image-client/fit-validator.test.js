/**
 * validateOutput — the reader that checks the file the engine produced.
 *
 * WHY THIS SUITE FEEDS IT FILES THAT ARE WRONG ON PURPOSE
 *
 * A validator that only ever sees correct output proves nothing. It can be a
 * function that returns `{ verified: true }` and every test built out of a real
 * pipeline run will pass, forever, including the day the pipeline breaks. The
 * only test that can tell those two apart is one that hands it a file which is
 * definitely wrong and demands that it says so — and says so about the right
 * row, with the other five still passing, because a validator that fails
 * everything whenever anything is off is no more useful than one that fails
 * nothing.
 *
 * So every case below is built by taking a file that satisfies a requirement
 * and then moving the requirement by exactly one unit: one pixel, one byte, one
 * DPI, one format. Nothing is mocked. The bytes are real files written by
 * libvips, which has no idea what this engine intended.
 *
 * AND IT MUST BE PURE. The panel reads a report on the main thread, the worker
 * builds one on its own thread, and a future caller will run it over the bytes
 * a second time to re-check a file the visitor kept. Two calls on the same
 * buffer have to return the same report and neither may touch the buffer, so
 * both are asserted here rather than assumed from reading the code.
 */
import sharp from 'sharp';
import { beforeAll, describe, expect, it } from 'vitest';

import { installBrowserEnv } from './helpers/browser-env';

let parseRequirements;
let readImageSize;
let validateOutput;

beforeAll(async () => {
    installBrowserEnv();
    ({ parseRequirements, readImageSize, validateOutput } = await import('@/lib/image-client/requirements'));
});

/** A requirement built by the real parser, then bent by exactly one field. */
function requirementOf(options, overrides = {}) {
    const parsed = parseRequirements({ width: '100', height: '80', ...options });
    expect(parsed.ok).toBe(true);
    return { ...parsed.requirement, ...overrides };
}

function rowsOf(report) {
    return Object.fromEntries(report.checks.map((row) => [row.key, row]));
}

/** Every row except the named one passed, and the named one failed. */
function expectOnlyFailure(report, key) {
    const rows = rowsOf(report);

    expect(rows[key].ok).toBe(false);
    expect(report.verified).toBe(false);

    for (const row of report.checks) {
        if (row.key === key) continue;
        expect({ key: row.key, ok: row.ok }).not.toEqual({ key: row.key, ok: false });
    }
}

async function opaqueJpeg({ width = 100, height = 80, density = null } = {}) {
    let pipeline = sharp({
        create: { width, height, channels: 3, background: { r: 40, g: 90, b: 160 } },
    });
    if (density !== null) pipeline = pipeline.withMetadata({ density });
    return new Uint8Array(await pipeline.jpeg().toBuffer());
}

async function opaquePng({ width = 100, height = 80 } = {}) {
    return new Uint8Array(await sharp({
        create: { width, height, channels: 3, background: { r: 40, g: 90, b: 160 } },
    }).png().toBuffer());
}

async function alphaPng({ width = 100, height = 80 } = {}) {
    return new Uint8Array(await sharp({
        create: { width, height, channels: 4, background: { r: 40, g: 90, b: 160, alpha: 0.4 } },
    }).png().toBuffer());
}

/**
 * A PNG with its pHYs chunk cut out.
 *
 * libvips stamps every PNG it writes with a density — 1 pixel per millimetre,
 * which reads back as 25 DPI — so sharp cannot produce a file that states
 * nothing. @jsquash/png, which is what this engine actually writes with, states
 * nothing at all, and "the form wants 300 and the file claims none" is the case
 * that matters. Cutting the chunk out by hand is the only way to build it here,
 * and it is a plain chunk-table walk: length, type, data, CRC, repeat.
 */
async function pngWithoutDensity({ width = 100, height = 80 } = {}) {
    const bytes = await opaquePng({ width, height });
    const pieces = [bytes.subarray(0, 8)];

    let at = 8;
    while (at + 8 <= bytes.length) {
        const length = (bytes[at] << 24 | bytes[at + 1] << 16 | bytes[at + 2] << 8 | bytes[at + 3]) >>> 0;
        const end = at + 12 + length;
        const type = String.fromCharCode(bytes[at + 4], bytes[at + 5], bytes[at + 6], bytes[at + 7]);

        if (type !== 'pHYs') pieces.push(bytes.subarray(at, end));
        at = end;
    }

    const out = new Uint8Array(pieces.reduce((sum, piece) => sum + piece.length, 0));
    let offset = 0;
    for (const piece of pieces) {
        out.set(piece, offset);
        offset += piece.length;
    }
    return out;
}

/* ------------------------------------------------------------------ *
 * The shape of a report
 * ------------------------------------------------------------------ */

describe('the report a panel renders', () => {
    it('carries the same six rows in the same order, whatever was asked for', async () => {
        const bytes = await opaqueJpeg();
        const bare = validateOutput(bytes, requirementOf({}));
        const full = validateOutput(bytes, requirementOf({ targetBytes: '20480', minBytes: '1024', dpi: '300' }));

        const keys = ['dimensions', 'format', 'maxBytes', 'minBytes', 'dpi', 'transparency'];
        expect(bare.checks.map((row) => row.key)).toEqual(keys);
        expect(full.checks.map((row) => row.key)).toEqual(keys);
    });

    /**
     * A row nobody asked for still reports what the file holds. That is the
     * difference between "this form did not ask for a DPI" and "this file has
     * no DPI", and a person deciding whether to upload it needs both.
     */
    it('keeps a row that was not asked for, with no verdict but a real reading', async () => {
        const report = validateOutput(await opaqueJpeg(), requirementOf({}));
        const rows = rowsOf(report);

        expect(rows.maxBytes).toMatchObject({ required: 'Not required', ok: null });
        expect(rows.minBytes).toMatchObject({ required: 'Not required', ok: null });
        expect(rows.dpi).toMatchObject({ required: 'Not required', ok: null });
        expect(rows.maxBytes.actual).toMatch(/KB$/);
        expect(report.verified).toBe(true);
    });

    it('gives every row a label a person can read', async () => {
        const report = validateOutput(await opaqueJpeg(), requirementOf({}));

        for (const row of report.checks) {
            expect(typeof row.label).toBe('string');
            expect(row.label.length).toBeGreaterThan(2);
            expect(row.label).not.toBe(row.key);
        }
    });
});

/* ------------------------------------------------------------------ *
 * One thing wrong at a time
 * ------------------------------------------------------------------ */

describe('a file that is wrong by exactly one requirement', () => {
    it('fails the dimensions row for a picture one pixel short', async () => {
        const bytes = await opaqueJpeg({ width: 100, height: 80 });
        const report = validateOutput(bytes, requirementOf({ width: '100', height: '81' }));

        expectOnlyFailure(report, 'dimensions');
        expect(rowsOf(report).dimensions).toMatchObject({
            required: '100 × 81 px',
            actual: '100 × 80 px',
        });
    });

    it('fails the maximum row for a file one byte over', async () => {
        const bytes = await opaqueJpeg();
        const report = validateOutput(bytes, requirementOf({}, { maxBytes: bytes.byteLength - 1 }));

        expectOnlyFailure(report, 'maxBytes');
    });

    it('passes the maximum row for a file exactly on the limit', async () => {
        const bytes = await opaqueJpeg();
        const report = validateOutput(bytes, requirementOf({}, { maxBytes: bytes.byteLength }));

        expect(rowsOf(report).maxBytes.ok).toBe(true);
        expect(report.verified).toBe(true);
    });

    it('fails the minimum row for a file one byte under', async () => {
        const bytes = await opaqueJpeg();
        const report = validateOutput(bytes, requirementOf({}, { minBytes: bytes.byteLength + 1 }));

        expectOnlyFailure(report, 'minBytes');
    });

    it('passes the minimum row for a file exactly on the floor', async () => {
        const bytes = await opaqueJpeg();
        const report = validateOutput(bytes, requirementOf({}, { minBytes: bytes.byteLength }));

        expect(rowsOf(report).minBytes.ok).toBe(true);
    });

    it('fails the resolution row for a file that states a different DPI', async () => {
        const bytes = await opaqueJpeg({ density: 72 });
        const report = validateOutput(bytes, requirementOf({ dpi: '300' }));

        expectOnlyFailure(report, 'dpi');
        expect(rowsOf(report).dpi).toMatchObject({ required: '300 DPI', actual: '72 DPI' });
    });

    it('fails the resolution row for a file that states no DPI at all', async () => {
        const bytes = await pngWithoutDensity();
        const report = validateOutput(bytes, requirementOf({ format: 'png', dpi: '300' }));

        expectOnlyFailure(report, 'dpi');
        expect(rowsOf(report).dpi.actual).toBe('None recorded');
    });

    /**
     * A WebP has nowhere to put a density, so the reader that walks JPEG and
     * PNG headers refuses it outright. "This container cannot state one" is a
     * perfectly good answer for a report, so the refusal has to come back as a
     * reading rather than taking the whole report down with it.
     */
    it('reports a container that cannot hold a DPI without throwing', async () => {
        const bytes = new Uint8Array(await sharp({
            create: { width: 100, height: 80, channels: 3, background: { r: 40, g: 90, b: 160 } },
        }).webp().toBuffer());

        const report = validateOutput(bytes, requirementOf({ format: 'webp' }, { dpi: 300 }));

        expectOnlyFailure(report, 'dpi');
        expect(rowsOf(report).dpi.actual).toBe('None recorded');
    });

    it('fails the format row for a PNG delivered where a JPEG was required', async () => {
        const bytes = await opaquePng();
        const report = validateOutput(bytes, requirementOf({ format: 'jpeg' }));

        expectOnlyFailure(report, 'format');
        expect(rowsOf(report).format).toMatchObject({ required: 'JPEG', actual: 'PNG' });
    });

    /**
     * The requirement here is hand-bent: parseRequirements derives 'removed'
     * from a format that cannot carry alpha, so this pairing cannot come out of
     * the parser. It can come out of a bug — a JPEG requirement whose encode
     * fell back to PNG would land exactly here — and the validator has to name
     * the transparency row when it does, without dragging the format row down
     * with it.
     */
    it('fails the transparency row for a file that still declares an alpha channel', async () => {
        const bytes = await alphaPng();
        const report = validateOutput(bytes, requirementOf({ format: 'png' }, { transparency: 'removed' }));

        expectOnlyFailure(report, 'transparency');
        expect(rowsOf(report).transparency).toMatchObject({
            required: 'Removed',
            actual: 'Alpha channel present',
        });
    });

    it('passes the transparency row for the same file when transparency is kept', async () => {
        const bytes = await alphaPng();
        const report = validateOutput(bytes, requirementOf({ format: 'png' }));

        expect(rowsOf(report).transparency.ok).toBe(true);
        expect(report.verified).toBe(true);
    });
});

/* ------------------------------------------------------------------ *
 * A file it cannot read at all
 * ------------------------------------------------------------------ */

describe('bytes that are not an image this engine knows', () => {
    it.each([
        ['empty', new Uint8Array(0)],
        ['a stub of a header', new Uint8Array([0xFF, 0xD8])],
        ['plain text', new TextEncoder().encode('not an image at all, just words')],
    ])('reports %s as unreadable rather than throwing', (_label, bytes) => {
        const report = validateOutput(bytes, requirementOf({}));
        const rows = rowsOf(report);

        expect(rows.dimensions.ok).toBe(false);
        expect(rows.format.ok).toBe(false);
        expect(report.verified).toBe(false);
    });

    it('never claims a verdict it could not reach', () => {
        const report = validateOutput(new Uint8Array([1, 2, 3]), requirementOf({}));

        expect(rowsOf(report).dimensions.actual).toBe('Could not be read');
    });
});

/* ------------------------------------------------------------------ *
 * Pure, and provably so
 * ------------------------------------------------------------------ */

describe('running the same check twice', () => {
    it('returns deep-equal reports', async () => {
        const bytes = await opaqueJpeg({ density: 300 });
        const requirement = requirementOf({ targetBytes: '20480', dpi: '300' });

        expect(validateOutput(bytes, requirement)).toEqual(validateOutput(bytes, requirement));
    });

    it('leaves the buffer it was given byte for byte as it found it', async () => {
        const bytes = await opaqueJpeg({ density: 300 });
        const before = Uint8Array.from(bytes);

        validateOutput(bytes, requirementOf({ targetBytes: '20480', dpi: '300' }));
        validateOutput(bytes, requirementOf({ minBytes: '512' }));

        expect(Array.from(bytes)).toEqual(Array.from(before));
    });

    it('does not hand back the same objects twice, so a caller cannot mutate the next report', async () => {
        const bytes = await opaqueJpeg();
        const requirement = requirementOf({});

        const first = validateOutput(bytes, requirement);
        first.checks[0].ok = 'tampered';

        expect(validateOutput(bytes, requirement).checks[0].ok).toBe(true);
    });

    it('reads the same file the same way through an ArrayBuffer and a Uint8Array', async () => {
        const bytes = await opaqueJpeg();
        const requirement = requirementOf({});

        expect(validateOutput(bytes.buffer.slice(0), requirement)).toEqual(validateOutput(bytes, requirement));
    });
});

/* ------------------------------------------------------------------ *
 * The header reader underneath it
 * ------------------------------------------------------------------ */

describe('reading a size out of a header, with no decoder', () => {
    it('reads a JPEG frame header past whatever segments sit in front of it', async () => {
        const withExif = new Uint8Array(await sharp({
            create: { width: 321, height: 123, channels: 3, background: { r: 1, g: 2, b: 3 } },
        }).withExif({ IFD0: { Copyright: 'x'.repeat(400) } }).jpeg().toBuffer());

        expect(readImageSize(withExif)).toEqual({ width: 321, height: 123, hasAlpha: false });
    });

    it('reads a PNG and tells an opaque one from one with an alpha channel', async () => {
        expect(readImageSize(await opaquePng({ width: 64, height: 48 })))
            .toEqual({ width: 64, height: 48, hasAlpha: false });
        expect(readImageSize(await alphaPng({ width: 64, height: 48 })))
            .toEqual({ width: 64, height: 48, hasAlpha: true });
    });

    /** All three WebP chunk types are reachable from real encoders, so all three are read. */
    it('reads a lossy WebP out of its VP8 frame tag', async () => {
        const bytes = new Uint8Array(await sharp({
            create: { width: 70, height: 50, channels: 3, background: { r: 9, g: 9, b: 9 } },
        }).webp().toBuffer());

        expect(readImageSize(bytes)).toMatchObject({ width: 70, height: 50, hasAlpha: false });
    });

    it('reads a lossless WebP out of its VP8L bit field', async () => {
        const bytes = new Uint8Array(await sharp({
            create: { width: 70, height: 50, channels: 3, background: { r: 9, g: 9, b: 9 } },
        }).webp({ lossless: true }).toBuffer());

        expect(readImageSize(bytes)).toMatchObject({ width: 70, height: 50 });
    });

    it('reads an extended WebP out of its VP8X canvas, alpha flag included', async () => {
        const bytes = new Uint8Array(await sharp({
            create: { width: 70, height: 50, channels: 4, background: { r: 9, g: 9, b: 9, alpha: 0.5 } },
        }).webp().toBuffer());

        expect(readImageSize(bytes)).toMatchObject({ width: 70, height: 50, hasAlpha: true });
    });

    it.each([
        ['nothing', new Uint8Array(0)],
        ['a truncated JPEG', new Uint8Array([0xFF, 0xD8, 0xFF])],
        ['a GIF, which this engine does not write', new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 0, 1, 0])],
        ['text', new TextEncoder().encode('%PDF-1.7 not an image')],
    ])('answers null for %s', (_label, bytes) => {
        expect(readImageSize(bytes)).toBeNull();
    });

    it('answers null rather than throwing for a JPEG whose scan starts before any frame', () => {
        expect(readImageSize(new Uint8Array([0xFF, 0xD8, 0xFF, 0xDA, 0x00, 0x02]))).toBeNull();
    });
});
