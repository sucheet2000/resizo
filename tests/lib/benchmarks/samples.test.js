/**
 * The benchmark's four inputs.
 *
 * A benchmark whose inputs cannot be reproduced is an anecdote, so these are
 * generated rather than sourced: no third-party photograph, no licence
 * question, and — the part this file exists to hold — the same bytes on every
 * run. Two things could take that away and both are asserted below:
 *
 *   1. An unseeded Math.random anywhere in a draw function.
 *   2. Text. librsvg picks a font from the machine it is running on, so one
 *      `<text>` element would make the samples differ between two laptops
 *      while the file names stayed the same. Shapes only, and the rule is a
 *      test rather than a comment.
 *
 * "Byte-identical on the same machine" is the promise, not "byte-identical
 * everywhere" — sharp bundles libvips and librsvg, so a different sharp build
 * may rasterise differently. That is why the samples are committed.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';
import sharp from 'sharp';

import { ALL_SAMPLES, DEMO_SAMPLES, rng, SAMPLES, SAMPLES_DIR, writeSamples } from '@/benchmarks/lib/samples';

/** Four rasterisations twice over, plus a PNG encode of a 1440×900 panel. */
const SLOW = 180_000;

const temporary = [];

function scratch(name) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), `resizo-bench-${name}-`));
    temporary.push(dir);
    return dir;
}

afterAll(() => {
    for (const dir of temporary) fs.rmSync(dir, { recursive: true, force: true });
});

describe('rng', () => {
    it('gives the same sequence for the same seed', () => {
        const a = rng(20260909);
        const b = rng(20260909);
        const first = Array.from({ length: 32 }, () => a());
        const second = Array.from({ length: 32 }, () => b());

        expect(first).toEqual(second);
    });

    it('gives a different sequence for a different seed', () => {
        const a = rng(1);
        const b = rng(2);
        expect(Array.from({ length: 8 }, () => a())).not.toEqual(Array.from({ length: 8 }, () => b()));
    });

    it('stays inside [0, 1)', () => {
        const next = rng(99);
        for (let i = 0; i < 5000; i += 1) {
            const value = next();
            expect(value).toBeGreaterThanOrEqual(0);
            expect(value).toBeLessThan(1);
        }
    });

    it('does not repeat itself immediately', () => {
        const next = rng(7);
        const values = new Set(Array.from({ length: 1000 }, () => next()));
        expect(values.size).toBe(1000);
    });
});

describe('the sample set', () => {
    it('is the four content types the report is organised around', () => {
        expect(SAMPLES.map((sample) => sample.file)).toEqual([
            'photo-1600x1067.jpg',
            'screenshot-1440x900.png',
            'graphic-800x800.png',
            'illustration-1200x900.png',
        ]);
    });

    /**
     * The split is load-bearing rather than tidy. benchmarks/run.js scenario A
     * loops over SAMPLES and produces four cases per entry, so an input added
     * to the wrong list is sixteen more encodes on every run and four more
     * rows in a comparison table it was never meant to be in.
     */
    it('keeps the inputs that exist to be looked at out of the scored four', () => {
        expect(DEMO_SAMPLES.map((sample) => sample.file))
            .toEqual(['transparent-480x320.png', 'portrait-1200x1600.jpg']);

        const scored = new Set(SAMPLES.map((sample) => sample.file));
        for (const sample of DEMO_SAMPLES) {
            expect(scored.has(sample.file), `${sample.file} is in both lists`).toBe(false);
        }

        expect(ALL_SAMPLES).toHaveLength(SAMPLES.length + DEMO_SAMPLES.length);
        expect(new Set(ALL_SAMPLES.map((sample) => sample.file)).size).toBe(ALL_SAMPLES.length);
    });

    it('names its own dimensions, and means them', () => {
        for (const sample of ALL_SAMPLES) {
            const [, width, height] = sample.file.match(/-(\d+)x(\d+)\./);
            expect(Number(width), `${sample.file} width`).toBe(sample.width);
            expect(Number(height), `${sample.file} height`).toBe(sample.height);
        }
    });

    it('carries a description for the README, and never calls the photo a photograph', () => {
        for (const sample of ALL_SAMPLES) {
            expect(sample.description.length).toBeGreaterThan(10);
        }

        const photo = SAMPLES.find((sample) => sample.file.startsWith('photo-'));
        expect(photo.description).toMatch(/synthetic/i);
    });

    it('draws with shapes only — no text, no font, nothing machine-dependent', () => {
        for (const sample of ALL_SAMPLES) {
            const body = sample.draw(sample.width, sample.height).toString('utf8');

            expect(body, `${sample.file} contains text`).not.toMatch(/<text[\s>]/i);
            expect(body, `${sample.file} names a font`).not.toMatch(/font-family|font-size/i);
            expect(body, `${sample.file} loads something external`).not.toMatch(/xlink:href|<image[\s>]/i);
        }
    });

    /**
     * A floor on the four, and only on the four. Each of them is a composition
     * of hundreds of shapes, so a body that came back short means a draw
     * function returned early. The demo input is two shapes on purpose and has
     * its own assertions below — checking its length against this number would
     * be checking the wrong property of a different kind of file.
     */
    it('draws a real composition for each of the four scored inputs', () => {
        for (const sample of SAMPLES) {
            const body = sample.draw(sample.width, sample.height).toString('utf8');
            expect(body.length, `${sample.file} drew almost nothing`).toBeGreaterThan(500);
        }
    });

    it('redraws identically, because nothing in a draw function is unseeded', () => {
        for (const sample of ALL_SAMPLES) {
            const first = sample.draw(sample.width, sample.height).toString('utf8');
            const second = sample.draw(sample.width, sample.height).toString('utf8');
            expect(second, `${sample.file} drew differently the second time`).toBe(first);
        }
    });

    it('points at the directory the runner reads', () => {
        expect(SAMPLES_DIR.split(path.sep).slice(-2)).toEqual(['benchmarks', 'samples']);
    });
});

describe('writeSamples', () => {
    it('writes byte-identical files on a second run', { timeout: SLOW }, async () => {
        const first = scratch('first');
        const second = scratch('second');

        const written = await writeSamples(first);
        await writeSamples(second);

        expect(written).toHaveLength(ALL_SAMPLES.length);

        for (const sample of ALL_SAMPLES) {
            const a = fs.readFileSync(path.join(first, sample.file));
            const b = fs.readFileSync(path.join(second, sample.file));

            expect(a.length, `${sample.file} changed size between runs`).toBe(b.length);
            expect(a.equals(b), `${sample.file} is not byte-identical between runs`).toBe(true);
        }
    });

    it('creates the directory it is pointed at', { timeout: SLOW }, async () => {
        const parent = scratch('nested');
        const target = path.join(parent, 'does', 'not', 'exist');

        await writeSamples(target);

        expect(fs.existsSync(path.join(target, SAMPLES[0].file))).toBe(true);
    });

    it('produces exactly the pixels and formats it advertises', { timeout: SLOW }, async () => {
        const dir = scratch('metadata');
        const written = await writeSamples(dir);

        for (const record of written) {
            const sample = ALL_SAMPLES.find((entry) => entry.file === record.file);
            const meta = await sharp(path.join(dir, record.file)).metadata();

            expect(meta.width, `${record.file} width`).toBe(sample.width);
            expect(meta.height, `${record.file} height`).toBe(sample.height);
            expect(meta.format, `${record.file} format`).toBe(sample.format);
            expect(record.bytes, `${record.file} bytes`).toBe(fs.statSync(path.join(dir, record.file)).size);
            expect(record.bytes).toBeGreaterThan(1000);
        }
    });

    it('gives the logo-like sample real transparency and leaves the others opaque', { timeout: SLOW }, async () => {
        const dir = scratch('alpha');
        await writeSamples(dir);

        const graphic = await sharp(path.join(dir, 'graphic-800x800.png')).metadata();
        expect(graphic.hasAlpha).toBe(true);

        // A transparent field, not a token corner pixel: the point of this
        // sample is that a JPEG conversion has something to flatten.
        const stats = await sharp(path.join(dir, 'graphic-800x800.png')).stats();
        const alpha = stats.channels[3];
        expect(alpha.min).toBe(0);
        expect(alpha.max).toBe(255);

        const photo = await sharp(path.join(dir, 'photo-1600x1067.jpg')).metadata();
        expect(photo.hasAlpha).toBe(false);
    });

    /**
     * The transparent demo input is the before half of the figure on
     * /png-to-jpg, and that figure makes one claim: the see-through part of a
     * PNG comes back filled, because JPEG has no alpha channel to put it in.
     * The claim is only legible if the source is unambiguously transparent
     * where the page points — the corners — so that is asserted on the
     * rasterised pixels rather than on the SVG that drew them.
     */
    it('gives the demo input four transparent corners and two opaque flat colours', { timeout: SLOW }, async () => {
        const dir = scratch('transparent');
        await writeSamples(dir);

        const file = path.join(dir, 'transparent-480x320.png');
        const meta = await sharp(file).metadata();

        expect(meta.hasAlpha).toBe(true);
        expect(meta.width).toBe(480);
        expect(meta.height).toBe(320);

        const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
        const at = (x, y) => {
            const start = (y * info.width + x) * 4;
            return [...data.subarray(start, start + 4)];
        };

        for (const [x, y] of [[0, 0], [info.width - 1, 0], [0, info.height - 1], [info.width - 1, info.height - 1]]) {
            expect(at(x, y), `the pixel at ${x},${y} is not transparent`).toEqual([0, 0, 0, 0]);
        }

        // #1f6feb and #f05a3c, both from the palette the logo-like sample uses.
        expect(at(150, 200)).toEqual([31, 111, 235, 255]);
        expect(at(372, 104)).toEqual([240, 90, 60, 255]);

        // Curves, so the edge between the two states is anti-aliased rather
        // than a hard cut — that blend is what a flatten actually has to do.
        let partial = 0;
        for (let index = 3; index < data.length; index += 4) {
            if (data[index] !== 0 && data[index] !== 255) partial += 1;
        }
        expect(partial, 'no partially transparent pixels — the edges are not anti-aliased').toBeGreaterThan(100);
    });

    /**
     * It ships to a page. 12 KB is not a guess: tests/app/demo-assets.test.js
     * holds the whole of public/demos under 600 KB, and this file is copied
     * there verbatim.
     */
    it('keeps the demo input small enough to ship on a page', { timeout: SLOW }, async () => {
        const dir = scratch('demo-size');
        const written = await writeSamples(dir);
        const demo = written.find((record) => record.file === 'transparent-480x320.png');

        expect(demo.bytes).toBeLessThan(12 * 1024);
    });

    it('makes a photo-like sample that is genuinely detailed and an illustration that is not', { timeout: SLOW }, async () => {
        const dir = scratch('detail');
        await writeSamples(dir);

        // The whole reason there are four content types: an encoder behaves
        // differently on grain than on flat colour, and a benchmark whose
        // "photo" compressed like a logo would be measuring nothing. Entropy
        // stands in for detail — sharp reports it per image.
        const photo = await sharp(path.join(dir, 'photo-1600x1067.jpg')).stats();
        const illustration = await sharp(path.join(dir, 'illustration-1200x900.png')).stats();

        expect(photo.entropy).toBeGreaterThan(illustration.entropy);
    });
});
