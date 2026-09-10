/**
 * The batch layer's invariants, over two hundred generated batches.
 *
 * The example tests next door pin the cases somebody thought of. These pin the
 * ones nobody did: a random engine is wired up that returns files over the
 * limit, files quietly reshaped, files converted to another format, files that
 * throw, and files the memory gate refuses — in random combinations, at random
 * sizes, in batches of one to twenty — and then the same seven statements are
 * checked about whatever came out.
 *
 * Every statement is one-directional on purpose: they say what a SUCCESS row
 * must be, never what a failure must be. That is what makes them safe to run
 * against a generator that does not know which of its own answers were valid.
 *
 * No new dependency. The generator is a seeded mulberry32 below, so a failure
 * here reproduces exactly — the case index is printed with it.
 */
import { beforeAll, describe, expect, it } from 'vitest';

import {
    KB,
    createCompressProcessor,
    runCompressBatch,
    summarize,
    zipEntries,
} from '@/lib/upload/compress-batch';

const RUNS = 200;
const FORMATS = ['jpeg', 'png', 'webp'];

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

/**
 * Stand-ins for File and Blob. Nothing here reads a byte — the header parser is
 * injected — so allocating four thousand real buffers would only make the suite
 * slow enough that nobody runs it.
 */
function fakeFile(name, size) {
    return { name, size };
}

function fakeBlob(size) {
    return { size };
}

const KINDS = ['fits', 'over', 'shrunk', 'reshaped', 'converted', 'throws', 'refused'];

/** One file, plus the answer the fake engine will give for it. */
function makeItem(rand, index, targetBytes) {
    const format = pick(rand, FORMATS);
    const sourceWidth = between(rand, 200, 4000);
    const sourceHeight = between(rand, 200, 4000);
    const kind = pick(rand, KINDS);

    let answer;
    if (kind === 'over') {
        answer = { bytes: targetBytes + between(rand, 1, 5000), width: sourceWidth, height: sourceHeight, format };
    } else if (kind === 'shrunk') {
        const scale = 0.1 + rand() * 0.85;
        answer = {
            bytes: between(rand, 1, targetBytes),
            width: Math.round(sourceWidth * scale),
            height: Math.round(sourceHeight * scale),
            format,
        };
    } else if (kind === 'reshaped') {
        answer = {
            bytes: between(rand, 1, targetBytes),
            width: between(rand, 50, sourceWidth),
            height: between(rand, 50, sourceHeight),
            format,
        };
    } else if (kind === 'converted') {
        answer = {
            bytes: between(rand, 1, targetBytes),
            width: sourceWidth,
            height: sourceHeight,
            format: pick(rand, FORMATS.filter((other) => other !== format)),
        };
    } else if (kind === 'fits') {
        answer = { bytes: between(rand, 1, targetBytes), width: sourceWidth, height: sourceHeight, format };
    } else {
        answer = null;
    }

    return {
        id: `f${index}`,
        name: `photo-${index}.${format === 'jpeg' ? 'jpg' : format}`,
        file: fakeFile(`photo-${index}`, between(rand, 20 * KB, 8 * KB * KB)),
        folder: rand() < 0.25 ? `Trip/${between(rand, 1, 3)}` : null,
        sourceWidth,
        sourceHeight,
        format,
        kind,
        answer,
    };
}

async function runCase(index) {
    const rand = mulberry32(index * 2654435761 + 12345);
    const count = between(rand, 1, 20);
    const targetBytes = between(rand, 10, 400) * KB;
    const mode = rand() < 0.5 ? 'preserve' : 'fit';
    const items = Array.from({ length: count }, (_, at) => makeItem(rand, at, targetBytes));
    const byId = new Map(items.map((item) => [item.id, item]));

    const processFile = createCompressProcessor({
        assess: (file) => {
            const item = items.find((candidate) => candidate.file === file);
            return item?.kind === 'refused'
                ? { ok: false, reason: 'This device cannot hold that photo.', suggestion: 'Try fewer at a time.' }
                : { ok: true };
        },
        process: async (_operation, file) => {
            const item = items.find((candidate) => candidate.file === file);
            if (item.kind === 'throws') throw new Error('engine blew up');
            return {
                blob: fakeBlob(item.answer.bytes),
                format: item.answer.format,
                width: item.answer.width,
                height: item.answer.height,
                targetMet: true,
                resized: false,
            };
        },
        // The independent reader, standing in for the header parse. It reports
        // what the fake engine actually produced, which is the only way a
        // reshaped or converted file can be caught.
        readSize: async (blob) => {
            const item = items.find((candidate) => candidate.answer && candidate.answer.bytes === blob.size);
            return item ? { width: item.answer.width, height: item.answer.height } : null;
        },
    });

    // Snapshotted the moment each row settles, so a later file changing an
    // earlier row is visible as a difference rather than being invisible.
    const settled = new Map();
    const onProgress = (id, patch) => {
        if (patch.status === 'processing') return;
        settled.set(id, { ...patch });
    };

    const { rows } = await runCompressBatch({ items, targetBytes, mode, processFile, onProgress });

    return { index, rows, targetBytes, mode, byId, settled };
}

let cases = [];

beforeAll(async () => {
    cases = [];
    for (let index = 0; index < RUNS; index += 1) cases.push(await runCase(index));
});

describe('over 200 generated batches', () => {
    it('generates batches worth checking — every outcome kind, and successes among them', () => {
        const kinds = new Set();
        let successes = 0;

        for (const one of cases) {
            for (const item of one.byId.values()) kinds.add(item.kind);
            successes += one.rows.filter((row) => row.status === 'success').length;
        }

        expect([...kinds].sort()).toEqual([...KINDS].sort());
        expect(successes).toBeGreaterThan(100);
        expect(cases).toHaveLength(RUNS);
    });

    it('never calls a file a success unless its real bytes are within the limit', () => {
        for (const { index, rows, targetBytes } of cases) {
            for (const row of rows) {
                if (row.status !== 'success') continue;
                expect(row.resultBytes, `case ${index}: ${row.name} shipped over its limit`)
                    .toBeLessThanOrEqual(targetBytes);
            }
        }
    });

    it('never changes the dimensions of a file compressed under preserve', () => {
        for (const { index, rows, mode } of cases) {
            if (mode !== 'preserve') continue;
            for (const row of rows) {
                if (row.status !== 'success') continue;
                expect(
                    [row.width, row.height],
                    `case ${index}: ${row.name} was resized under preserve`,
                ).toEqual([row.sourceWidth, row.sourceHeight]);
                expect(row.resized).toBe(false);
            }
        }
    });

    it('never changes the shape of a file compressed under fit', () => {
        for (const { index, rows, mode } of cases) {
            if (mode !== 'fit') continue;
            for (const row of rows) {
                if (row.status !== 'success') continue;
                const skew = Math.abs(row.width * row.sourceHeight - row.height * row.sourceWidth);
                expect(skew, `case ${index}: ${row.name} came back a different shape`)
                    .toBeLessThanOrEqual(Math.max(row.sourceWidth, row.sourceHeight));
                expect(row.width).toBeLessThanOrEqual(row.sourceWidth);
                expect(row.height).toBeLessThanOrEqual(row.sourceHeight);
            }
        }
    });

    it('never changes the format a file arrived in', () => {
        for (const { index, rows, byId } of cases) {
            for (const row of rows) {
                if (row.status !== 'success') continue;
                expect(row.format, `case ${index}: ${row.name} was silently converted`)
                    .toBe(byId.get(row.id).format);
            }
        }
    });

    it('totals only what succeeded, and reports a reduction only when something did', () => {
        for (const { index, rows } of cases) {
            const wins = rows.filter((row) => row.status === 'success');
            const summary = summarize(rows);

            expect(summary.selected).toBe(rows.length);
            expect(summary.successful).toBe(wins.length);
            expect(summary.inputBytes, `case ${index}`).toBe(wins.reduce((sum, row) => sum + row.originalBytes, 0));
            expect(summary.outputBytes).toBe(wins.reduce((sum, row) => sum + row.resultBytes, 0));
            expect(summary.savedBytes).toBe(summary.inputBytes - summary.outputBytes);

            if (wins.length === 0) expect(summary.reductionPercent).toBeNull();
            else expect(summary.reductionPercent).toBe(Math.round((summary.savedBytes / summary.inputBytes) * 100));
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
                    },
                    `case ${index}: ${row.name} was edited after it finished`,
                ).toEqual({
                    status: snapshot.status,
                    resultBytes: snapshot.resultBytes,
                    width: snapshot.width,
                    height: snapshot.height,
                    filename: snapshot.filename,
                });
            }
        }
    });

    it('summarises the same rows the same way, every time', () => {
        for (const { rows } of cases) {
            expect(summarize(rows)).toEqual(summarize(rows));
            expect(summarize([...rows])).toEqual(summarize(rows));
        }
    });
});
