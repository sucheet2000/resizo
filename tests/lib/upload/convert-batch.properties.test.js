/**
 * The converter's invariants, over two hundred generated batches.
 *
 * The example tests next door pin the cases somebody thought of. These pin the
 * ones nobody did: a random engine is wired up that returns files in the wrong
 * container, files quietly reshaped, files whose transparency was dropped,
 * files that throw, files with no blob at all and files the memory gate
 * refuses — in random combinations, in batches of one to twenty, to every one
 * of the three output formats — and then the same statements are checked about
 * whatever came out.
 *
 * Every statement is one-directional on purpose: they say what a SUCCESS row
 * must be, never what a failure must be. That is what makes them safe to run
 * against a generator that does not know which of its own answers were valid.
 *
 * The bytes are real container headers and the verifier is the shipped one, so
 * "this row says WebP" is checked by opening the blob, not by reading a field
 * the engine wrote.
 *
 * No new dependency. The generator is a seeded mulberry32 below, so a failure
 * here reproduces exactly — the case index is printed with it.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { sniffImageType } from '@/lib/image/magic-bytes';
import { readImageSize } from '@/lib/image-client/requirements';
import { runBatch, zipEntries } from '@/lib/upload/batch';
import { createConvertProcessor, summarizeConversion } from '@/lib/upload/convert-batch';

const RUNS = 200;
const FORMATS = ['jpeg', 'png', 'webp'];
const BACKGROUNDS = ['white', 'black', '#2f6fed'];

/** A seeded PRNG, so every case in this file is reproducible from its index. */
function mulberry32(seed) {
    let a = seed >>> 0;
    return function next() {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function pick(rand, list) {
    return list[Math.floor(rand() * list.length)];
}

function between(rand, low, high) {
    return low + Math.floor(rand() * (high - low + 1));
}

/* ---------------------------------------------------------- real headers */

function jpegBytes(width, height) {
    const bytes = new Uint8Array(20);
    bytes.set([0xFF, 0xD8, 0xFF, 0xC0, 0x00, 0x11, 0x08], 0);
    const view = new DataView(bytes.buffer);
    view.setUint16(7, height);
    view.setUint16(9, width);
    return bytes;
}

function pngBytes(width, height, alpha) {
    const bytes = new Uint8Array(33);
    bytes.set([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A], 0);
    bytes.set([0, 0, 0, 13], 8);
    bytes.set([0x49, 0x48, 0x44, 0x52], 12);
    const view = new DataView(bytes.buffer);
    view.setUint32(16, width);
    view.setUint32(20, height);
    bytes[24] = 8;
    bytes[25] = alpha ? 6 : 2;
    return bytes;
}

function webpBytes(width, height, alpha) {
    const bytes = new Uint8Array(30);
    const view = new DataView(bytes.buffer);
    bytes.set([0x52, 0x49, 0x46, 0x46], 0);
    view.setUint32(4, bytes.length - 8, true);
    bytes.set([0x57, 0x45, 0x42, 0x50], 8);

    if (alpha) {
        bytes.set([0x56, 0x50, 0x38, 0x58], 12);
        view.setUint32(16, 10, true);
        bytes[20] = 0x10;
        const canvas = (at, value) => {
            bytes[at] = (value - 1) & 0xFF;
            bytes[at + 1] = ((value - 1) >> 8) & 0xFF;
            bytes[at + 2] = ((value - 1) >> 16) & 0xFF;
        };
        canvas(24, width);
        canvas(27, height);
        return bytes;
    }

    bytes.set([0x56, 0x50, 0x38, 0x20], 12);
    view.setUint32(16, 10, true);
    bytes.set([0x9D, 0x01, 0x2A], 23);
    view.setUint16(26, width, true);
    view.setUint16(28, height, true);
    return bytes;
}

/** A header in the container asked for, padded out to a plausible file size. */
function headerFor(format, width, height, alpha) {
    if (format === 'jpeg') return jpegBytes(width, height);
    if (format === 'png') return pngBytes(width, height, alpha);
    return webpBytes(width, height, alpha);
}

function blobFor(format, width, height, alpha, padding = 0) {
    const parts = [headerFor(format, width, height, alpha)];
    if (padding > 0) parts.push(new Uint8Array(padding));
    return new Blob(parts, { type: `image/${format}` });
}

/* -------------------------------------------------------- the generator */

const KINDS = ['good', 'wrong-format', 'wrong-dimensions', 'alpha-dropped', 'throws', 'refused', 'no-blob'];

/** One file, plus the answer the fake engine will give for it. */
function makeItem(rand, index, outputFormat) {
    const format = pick(rand, FORMATS);
    // Only PNG and WebP can carry transparency in, which is what makes the
    // alpha rules reachable at all.
    const alpha = format !== 'jpeg' && rand() < 0.5;
    const width = between(rand, 64, 4000);
    const height = between(rand, 64, 4000);
    const kind = pick(rand, KINDS);

    let answer;
    if (kind === 'wrong-format') {
        answer = { format: pick(rand, FORMATS.filter((other) => other !== outputFormat)), width, height, alpha };
    } else if (kind === 'wrong-dimensions') {
        answer = { format: outputFormat, width: Math.max(1, width - between(rand, 1, 60)), height, alpha };
    } else if (kind === 'alpha-dropped') {
        answer = { format: outputFormat, width, height, alpha: false };
    } else if (kind === 'good') {
        // A correct conversion keeps the transparency the source had, unless
        // the output format cannot carry it at all.
        answer = { format: outputFormat, width, height, alpha: outputFormat !== 'jpeg' && alpha };
    } else {
        answer = null;
    }

    return {
        id: `f${index}`,
        name: `photo-${index}.${format === 'jpeg' ? 'jpg' : format}`,
        file: new File([blobFor(format, width, height, alpha)], `photo-${index}`, { type: `image/${format}` }),
        folder: rand() < 0.25 ? `Trip/${between(rand, 1, 3)}` : null,
        sourceWidth: width,
        sourceHeight: height,
        format,
        alpha,
        kind,
        answer,
    };
}

async function runCase(index) {
    const rand = mulberry32(index * 2654435761 + 12345);
    const count = between(rand, 1, 20);
    const outputFormat = pick(rand, FORMATS);
    const quality = between(rand, 1, 100);
    const background = pick(rand, BACKGROUNDS);
    const items = Array.from({ length: count }, (_, at) => makeItem(rand, at, outputFormat));
    const byId = new Map(items.map((one) => [one.id, one]));

    const processFile = createConvertProcessor({
        assess: (file) => {
            const one = items.find((candidate) => candidate.file === file);
            return one?.kind === 'refused'
                ? { ok: false, reason: 'This device cannot hold that photo.', suggestion: 'Try fewer at a time.' }
                : { ok: true };
        },
        process: vi.fn(async (operation, file) => {
            const one = items.find((candidate) => candidate.file === file);
            if (one.kind === 'throws') throw new Error('engine blew up');
            if (one.kind === 'no-blob') return { blob: null, format: outputFormat };

            const { format, width, height, alpha } = one.answer;
            return {
                // The outcome CLAIMS the requested format whatever the bytes
                // actually are, which is exactly the lie the verification exists
                // to catch.
                blob: blobFor(format, width, height, alpha, between(rand, 0, 2000)),
                format: outputFormat,
                width: one.sourceWidth,
                height: one.sourceHeight,
                // What a real decode would report for this source: the fixture
                // has see-through pixels exactly when its container has alpha.
                transparent: one.alpha,
            };
        }),
    });

    // Snapshotted the moment each row settles, so a later file changing an
    // earlier row is visible as a difference rather than being invisible.
    const settled = new Map();
    const onProgress = (id, patch) => {
        if (patch.status === 'processing') return;
        settled.set(id, { ...patch });
    };

    const { rows } = await runBatch({
        items,
        settings: { outputFormat, quality, background },
        processFile,
        onProgress,
    });

    return { index, rows, outputFormat, byId, settled };
}

let cases = [];

beforeAll(async () => {
    cases = [];
    for (let index = 0; index < RUNS; index += 1) cases.push(await runCase(index));
});

describe('over 200 generated conversion batches', () => {
    it('generates batches worth checking — every outcome kind, and both paths taken', () => {
        const kinds = new Set();
        let kept = 0;
        let converted = 0;
        let failed = 0;

        for (const one of cases) {
            for (const generated of one.byId.values()) kinds.add(generated.kind);
            for (const row of one.rows) {
                if (row.status === 'success') {
                    if (row.kept) kept += 1;
                    else converted += 1;
                } else {
                    failed += 1;
                }
            }
        }

        expect([...kinds].sort()).toEqual([...KINDS].sort());
        expect(kept, 'no file took the kept path').toBeGreaterThan(50);
        expect(converted, 'no file was actually converted').toBeGreaterThan(100);
        expect(failed, 'nothing ever failed').toBeGreaterThan(100);
        expect(cases).toHaveLength(RUNS);
    });

    it('never calls a file a success unless its bytes really are the format asked for', async () => {
        for (const { index, rows, outputFormat } of cases) {
            for (const row of rows) {
                if (row.status !== 'success') continue;

                const bytes = new Uint8Array(await row.blob.arrayBuffer());
                expect(sniffImageType(bytes), `case ${index}: ${row.name} is not a ${outputFormat}`)
                    .toBe(outputFormat);
                expect(row.outputFormat).toBe(outputFormat);
            }
        }
    });

    it('never changes the picture’s dimensions', async () => {
        for (const { index, rows } of cases) {
            for (const row of rows) {
                if (row.status !== 'success') continue;

                const size = readImageSize(new Uint8Array(await row.blob.arrayBuffer()));
                expect(
                    [size.width, size.height],
                    `case ${index}: ${row.name} came back a different size`,
                ).toEqual([row.sourceWidth, row.sourceHeight]);
                expect([row.width, row.height]).toEqual([row.sourceWidth, row.sourceHeight]);
                expect(row.resized).toBe(false);
            }
        }
    });

    it('never drops transparency into a format that could have kept it', async () => {
        for (const { index, rows, outputFormat, byId } of cases) {
            if (outputFormat === 'jpeg') continue;
            for (const row of rows) {
                if (row.status !== 'success' || !byId.get(row.id).alpha) continue;

                const size = readImageSize(new Uint8Array(await row.blob.arrayBuffer()));
                expect(size.hasAlpha, `case ${index}: ${row.name} lost its transparency`).toBe(true);
            }
        }
    });

    it('says where the transparency went whenever it had nowhere to go', () => {
        for (const { index, rows, outputFormat, byId } of cases) {
            for (const row of rows) {
                if (row.status !== 'success' || row.kept) continue;

                const shouldFlatten = outputFormat === 'jpeg' && byId.get(row.id).alpha;
                expect(row.flattened, `case ${index}: ${row.name} was silent about its background`)
                    .toBe(shouldFlatten);
                expect(row.note === null).toBe(!shouldFlatten);
            }
        }
    });

    it('hands back the original file, byte for byte, when nothing needed doing', () => {
        for (const { index, rows, outputFormat, byId } of cases) {
            for (const row of rows) {
                if (row.status !== 'success' || !row.kept) continue;

                const generated = byId.get(row.id);
                expect(generated.format, `case ${index}: ${row.name} was kept but was not already the target`)
                    .toBe(outputFormat);
                expect(row.blob).toBe(generated.file);
                expect(row.resultBytes).toBe(generated.file.size);
                expect(row.note).toContain('kept unchanged');
            }
        }
    });

    it('keeps the rows in the order they were chosen', () => {
        for (const { index, rows, byId } of cases) {
            expect(rows.map((row) => row.id), `case ${index}: the rows were re-ordered`)
                .toEqual([...byId.keys()]);
        }
    });

    it('puts exactly the successful files in the archive, under distinct names', () => {
        for (const { index, rows } of cases) {
            const wins = rows.filter((row) => row.status === 'success');
            const entries = zipEntries(rows);

            expect(entries, `case ${index}: the archive lost or gained a file`).toHaveLength(wins.length);
            expect(new Set(entries.map((entry) => entry.name)).size).toBe(entries.length);
            expect(entries.map((entry) => entry.id)).toEqual(wins.map((row) => row.id));
        }
    });

    it('gives every finished file a download name nobody else in the batch has', () => {
        for (const { index, rows } of cases) {
            const names = rows.filter((row) => row.status === 'success').map((row) => row.filename);

            expect(new Set(names).size, `case ${index}: two rows offered the same download`)
                .toBe(names.length);
        }
    });

    it('leaves a settled row exactly as it was, however the rest of the batch went', () => {
        for (const { index, rows, settled } of cases) {
            for (const row of rows) {
                const snapshot = settled.get(row.id);
                if (!snapshot || snapshot.status !== 'success') continue;

                expect(row.blob, `case ${index}: ${row.name} lost its blob`).toBe(snapshot.blob);
                expect(
                    {
                        status: row.status,
                        resultBytes: row.resultBytes,
                        width: row.width,
                        height: row.height,
                        filename: row.filename,
                        note: row.note,
                    },
                    `case ${index}: ${row.name} was edited after it finished`,
                ).toEqual({
                    status: snapshot.status,
                    resultBytes: snapshot.resultBytes,
                    width: snapshot.width,
                    height: snapshot.height,
                    filename: snapshot.filename,
                    note: snapshot.note,
                });
            }
        }
    });

    it('summarises the same rows the same way, every time', () => {
        for (const { index, rows } of cases) {
            const summary = summarizeConversion(rows);
            const wins = rows.filter((row) => row.status === 'success');

            expect(summarizeConversion(rows)).toEqual(summary);
            expect(summarizeConversion([...rows])).toEqual(summary);
            expect(summary.selected, `case ${index}`).toBe(rows.length);
            expect(summary.successful).toBe(wins.length);
            expect(summary.converted).toBe(wins.filter((row) => !row.kept).length);
            expect(summary.kept).toBe(wins.filter((row) => row.kept).length);
            expect(summary.inputBytes).toBe(wins.reduce((sum, row) => sum + row.originalBytes, 0));
            expect(summary.outputBytes).toBe(wins.reduce((sum, row) => sum + row.resultBytes, 0));
            expect(summary.differenceBytes).toBe(summary.outputBytes - summary.inputBytes);
        }
    });
});
