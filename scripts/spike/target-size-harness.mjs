#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * PHASE 0 SPIKE — THROWAWAY. Never merged to main.
 *
 * Question this answers
 * ---------------------
 * /compress can hit an exact output size ("make this 100 KB"). Today the SERVER
 * does that with a bounded binary search over JPEG quality: up to
 * TARGET_SEARCH_ITERATIONS (8) FULL-RESOLUTION encodes (lib/image/target-size.js).
 * Moved into the browser, 8 full-res encodes of a 12MP photo is an estimated
 * 17-25 seconds on a mid-range phone. Unacceptable.
 *
 * The proposed cheaper answer: run the search on a small proxy (1/4 linear =
 * 1/16 the pixels, ~16x cheaper per encode), map the proxy's chosen quality onto
 * the full-resolution file with a calibration ratio measured from real full-res
 * probes, and refine at full resolution.
 *
 * The known weakness (prior research): the proxy-to-full byte ratio DRIFTS with
 * quality — ~146% at low quality vs ~182% at high quality. A single-point
 * calibration missed, and it missed hardest at 100 KB, the target behind
 * /compress-image-to-100kb, a top landing page. So this harness implements
 * TWO-POINT calibration and measures whether it actually fixes 100 KB.
 *
 * Three calibration strategies are measured head to head, all on the SAME
 * full-res encode budget, so the comparison isolates the MODEL rather than the
 * budget:
 *
 *   flat-1pt   one probe, ratio held constant  (the approach that failed)
 *   fixed-2pt  two probes at fixed q=35 and q=75, interpolate between them
 *   adaptive   probes placed where the search says the answer is, interpolate
 *   bracketed  adaptive, plus every real probe narrows a known-good bracket the
 *              model is not allowed to leave — so the calibration is a WARM
 *              START for a binary search rather than a replacement for one
 *
 * Everything encodes through @jsquash/jpeg (MozJPEG wasm) — the exact codec a
 * browser build would use. sharp appears ONLY to synthesise fixtures; it is not
 * part of the measured path.
 *
 * Usage:  node scripts/spike/target-size-harness.mjs
 *         npm run spike:target
 *         --quick        2 images, 3 targets
 *         --proxy=2      proxy at 1/2 linear (1/4 pixels) instead of 1/4
 *         --ratios       also dump the raw proxy/full ratio curve per image
 */

import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const FIXTURE_DIR = path.join(tmpdir(), 'resizo-spike-fixtures');

const QUICK = process.argv.includes('--quick');
const SHOW_RATIOS = process.argv.includes('--ratios');
const PROXY_DIVISOR = Number(
    (process.argv.find((arg) => arg.startsWith('--proxy=')) ?? '--proxy=4').split('=')[1],
);

// ---------------------------------------------------------------------------
// Repo constants
//
// lib/constants.js is ESM but the repo package.json has no "type":"module", so
// a plain `import '../../lib/constants.js'` is parsed as CommonJS and throws.
// The file has no imports of its own, so evaluating its source as a module is
// exact — and beats re-typing a limit here.
// ---------------------------------------------------------------------------
const constantsSource = await readFile(path.join(REPO, 'lib', 'constants.js'), 'utf8');
const { TARGET_SEARCH_ITERATIONS, MIN_TARGET_BYTES, MAX_TARGET_BYTES } = await import(
    `data:text/javascript;base64,${Buffer.from(constantsSource).toString('base64')}`
);

// ---------------------------------------------------------------------------
// Codec bootstrap
//
// The @jsquash wasm modules fetch their .wasm by URL, which Node's fetch cannot
// do for file:. Both packages accept a pre-compiled module / raw bytes instead.
// ---------------------------------------------------------------------------
const jpegEncode = await import('@jsquash/jpeg/encode.js');
const jpegDecode = await import('@jsquash/jpeg/decode.js');
const { default: resize, initResize } = await import('@jsquash/resize');

await jpegEncode.init(
    new WebAssembly.Module(await readFile(require.resolve('@jsquash/jpeg/codec/enc/mozjpeg_enc.wasm'))),
);
await jpegDecode.init(
    new WebAssembly.Module(await readFile(require.resolve('@jsquash/jpeg/codec/dec/mozjpeg_dec.wasm'))),
);
await initResize(await readFile(require.resolve('@jsquash/resize/lib/resize/pkg/squoosh_resize_bg.wasm')));

const sharp = require('sharp');

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

/** Full-res encodes any proxy strategy may spend. Half the exhaustive budget. */
const PROXY_FULL_ENCODE_BUDGET = 4;

/** Where the fixed-probe strategy takes its two calibration samples. */
const FIXED_Q_LOW = 35;
const FIXED_Q_HIGH = 75;

/** Where the single-point strategy takes its one calibration sample. */
const FLAT_Q = 60;

/**
 * A case PASSES when the result (a) does not exceed the target, and (b) is no
 * more than this fraction of the target smaller than what the exhaustive search
 * achieved. (b) is the quality test — undershooting by a wide margin means a
 * needlessly uglier file than the user could have had.
 */
const TOLERANCE_FRACTION = 0.05;

/** Rough per-encode cost on a mid-range phone, from the brief's 17-25s for 8. */
const PHONE_SECONDS_PER_FULL_ENCODE = 2.6;

const KB = 1024;
const MB = 1024 * 1024;

const TARGETS = QUICK
    ? [100 * KB, 300 * KB, 1 * MB]
    : [50 * KB, 100 * KB, 200 * KB, 300 * KB, 500 * KB, 1 * MB, 2 * MB];

for (const target of TARGETS) {
    if (target < MIN_TARGET_BYTES || target > MAX_TARGET_BYTES) {
        throw new Error(`Target ${target} is outside MIN_TARGET_BYTES..MAX_TARGET_BYTES`);
    }
}

const STRATEGIES = ['flat-1pt', 'fixed-2pt', 'adaptive', 'bracketed'];
const HEADLINE = 'bracketed';

/** Budgets the sweep table reports the headline strategy at. */
const BUDGET_SWEEP = [2, 3, 4, 5, 6];

// ---------------------------------------------------------------------------
// Fixtures
//
// The repo carries no real photograph (public/samples/*.jpg are themselves
// generated and are the closest thing available), so the 12MP and 4MP cases are
// synthesised with sharp at native resolution across three complexity classes.
// Cached in the OS temp dir so a rerun is fast.
// ---------------------------------------------------------------------------

function mulberry32(seed) {
    let state = seed >>> 0;
    return function next() {
        state = (state + 0x6d2b79f5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function gradientSvg(width, height) {
    return Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">`
        + '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">'
        + '<stop offset="0%" stop-color="#0b2b4a"/><stop offset="45%" stop-color="#3f7fa6"/>'
        + '<stop offset="100%" stop-color="#f2d9a8"/></linearGradient></defs>'
        + `<rect width="${width}" height="${height}" fill="url(#g)"/></svg>`,
    );
}

/** Smooth ground plus a thousand small shapes: compresses like a real photo. */
function photoSvg(width, height) {
    const random = mulberry32(20260812);
    const horizon = Math.round(height * 0.44);
    const parts = [
        '<defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">'
        + '<stop offset="0%" stop-color="#1d4a72"/><stop offset="100%" stop-color="#d8e4ea"/></linearGradient>'
        + '<linearGradient id="ground" x1="0" y1="0" x2="0" y2="1">'
        + '<stop offset="0%" stop-color="#5c6a52"/><stop offset="100%" stop-color="#2b2f26"/></linearGradient></defs>',
        `<rect width="${width}" height="${horizon}" fill="url(#sky)"/>`,
        `<rect y="${horizon}" width="${width}" height="${height - horizon}" fill="url(#ground)"/>`,
        `<circle cx="${Math.round(width * 0.72)}" cy="${Math.round(horizon * 0.35)}" r="${Math.round(height * 0.09)}" fill="#ffe9b0" opacity="0.85"/>`,
    ];

    for (let i = 0; i < 900; i += 1) {
        const x = Math.round(random() * width);
        const y = horizon + Math.round(random() * (height - horizon));
        const r = 2 + Math.round(random() * (height / 260));
        const shade = 40 + Math.round(random() * 120);
        parts.push(`<ellipse cx="${x}" cy="${y}" rx="${r * 2}" ry="${r}" fill="rgb(${shade},${shade - 8},${Math.round(shade * 0.8)})" opacity="0.7"/>`);
    }

    for (let i = 0; i < 120; i += 1) {
        const x = Math.round(random() * width);
        const h = Math.round((height - horizon) * (0.1 + random() * 0.5));
        parts.push(`<rect x="${x}" y="${horizon - h}" width="${2 + Math.round(random() * 5)}" height="${h}" fill="rgba(28,34,26,0.75)"/>`);
    }

    return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${parts.join('')}</svg>`);
}

function grainLayer(width, height, sigma) {
    return sharp({
        create: {
            width, height, channels: 3, background: '#808080',
            noise: { type: 'gaussian', mean: 128, sigma },
        },
    }).png().toBuffer();
}

async function buildFixture(spec) {
    const { width, height, kind } = spec;

    if (kind === 'gradient') {
        return sharp(gradientSvg(width, height)).jpeg({ quality: 94, mozjpeg: true }).toBuffer();
    }

    if (kind === 'noise') {
        return sharp(await grainLayer(width, height, 62)).jpeg({ quality: 94, mozjpeg: true }).toBuffer();
    }

    const base = await sharp(photoSvg(width, height)).png().toBuffer();
    return sharp(base)
        .composite([{ input: await grainLayer(width, height, 14), blend: 'overlay' }])
        .jpeg({ quality: 94, mozjpeg: true })
        .toBuffer();
}

async function loadFixture(spec) {
    if (spec.file) return readFile(path.join(REPO, spec.file));

    await mkdir(FIXTURE_DIR, { recursive: true });
    const cached = path.join(FIXTURE_DIR, `${spec.name}.jpg`);
    if (existsSync(cached)) return readFile(cached);

    const buffer = await buildFixture(spec);
    await writeFile(cached, buffer);
    return buffer;
}

const FIXTURE_SPECS = QUICK
    ? [
        { name: 'photo-12mp', kind: 'photo', width: 4000, height: 3000 },
        { name: 'noise-12mp', kind: 'noise', width: 4000, height: 3000 },
    ]
    : [
        { name: 'photo-12mp', kind: 'photo', width: 4000, height: 3000 },
        { name: 'photo-4mp', kind: 'photo', width: 2400, height: 1600 },
        { name: 'gradient-12mp', kind: 'gradient', width: 4000, height: 3000 },
        { name: 'noise-12mp', kind: 'noise', width: 4000, height: 3000 },
        { name: 'sample-landscape', kind: 'file', file: 'public/samples/landscape-1600x1067.jpg' },
    ];

// ---------------------------------------------------------------------------
// Encode plumbing
//
// Two layers of memoisation, for two different reasons:
//
//  * a PROCESS cache keyed by (image, scale, quality) so the harness finishes in
//    minutes instead of an hour. It never affects the numbers.
//  * a RUN cache, cleared before every search, which is what the COUNTERS see: a
//    quality is counted once per search run. Any real implementation would keep
//    the same map inside one job, so counting a repeat would overstate the cost.
//    The exhaustive binary search never repeats a quality anyway.
// ---------------------------------------------------------------------------

function makeSubject(name, fullImage, proxyImage) {
    return {
        name,
        full: fullImage,
        proxy: proxyImage,
        cache: { full: new Map(), proxy: new Map() },
        seen: { full: new Set(), proxy: new Set() },
        counters: { full: 0, proxy: 0 },
    };
}

function startRun(subject) {
    subject.seen.full.clear();
    subject.seen.proxy.clear();
    subject.counters.full = 0;
    subject.counters.proxy = 0;
}

async function encodeAt(subject, scale, quality) {
    if (!subject.seen[scale].has(quality)) {
        subject.seen[scale].add(quality);
        subject.counters[scale] += 1;
    }

    const cache = subject.cache[scale];
    if (cache.has(quality)) return cache.get(quality);

    const image = scale === 'full' ? subject.full : subject.proxy;
    const bytes = (await jpegEncode.default(image, { quality })).byteLength;
    cache.set(quality, bytes);
    return bytes;
}

const encodeFull = (subject, quality) => encodeAt(subject, 'full', quality);
const encodeProxy = (subject, quality) => encodeAt(subject, 'proxy', quality);

// ---------------------------------------------------------------------------
// A. EXHAUSTIVE SEARCH — the ground truth
//
// A faithful port of searchQuality() in lib/image/target-size.js: binary search
// over 1..100, capped at TARGET_SEARCH_ITERATIONS, keeping the largest output
// that still fits and the smallest output seen.
// ---------------------------------------------------------------------------
async function exhaustiveSearch(subject, targetBytes) {
    startRun(subject);

    let low = 1;
    let high = 100;
    let fitBytes = null;
    let fitQuality = null;
    let floorBytes = null;
    let iterations = 0;

    while (low <= high && iterations < TARGET_SEARCH_ITERATIONS) {
        const quality = Math.floor((low + high) / 2);
        const bytes = await encodeFull(subject, quality);
        iterations += 1;

        if (floorBytes === null || bytes < floorBytes) floorBytes = bytes;

        if (bytes <= targetBytes) {
            if (fitBytes === null || bytes > fitBytes) {
                fitBytes = bytes;
                fitQuality = quality;
            }
            low = quality + 1;
        } else {
            high = quality - 1;
        }
    }

    return {
        ok: fitBytes !== null,
        quality: fitQuality,
        bytes: fitBytes,
        floorBytes,
        fullEncodes: subject.counters.full,
        proxyEncodes: 0,
    };
}

// ---------------------------------------------------------------------------
// B. CALIBRATED PROXY SEARCH
//
// The estimator is  fullBytes(q) ~= proxyBytes(q) * ratio(q).  Everything below
// is about how ratio(q) is modelled from a handful of real full-res probes.
//
//  * with no probe yet, ratio is the naive pixel-count ratio (16 at 1/4 linear)
//  * flat-1pt holds ratio at whatever the newest probe measured
//  * the interpolating models take log-linear interpolation BETWEEN probes and
//    hold the endpoint value outside them. Extrapolating the slope is unsafe:
//    the measured ratio curve is U-shaped in quality, so a slope fitted at
//    q=35..75 points the wrong way once you leave that window.
// ---------------------------------------------------------------------------

function clampQuality(q) {
    return Math.min(100, Math.max(1, q));
}

function interpolatingModel(anchors, naiveRatio) {
    if (anchors.length === 0) return () => naiveRatio;
    if (anchors.length === 1) return () => anchors[0].ratio;

    const pts = [...anchors].sort((a, b) => a.q - b.q);

    return (q) => {
        if (q <= pts[0].q) return pts[0].ratio;
        if (q >= pts[pts.length - 1].q) return pts[pts.length - 1].ratio;

        for (let i = 0; i < pts.length - 1; i += 1) {
            const a = pts[i];
            const b = pts[i + 1];
            if (q >= a.q && q <= b.q) {
                const t = (q - a.q) / (b.q - a.q);
                return Math.exp(Math.log(a.ratio) * (1 - t) + Math.log(b.ratio) * t);
            }
        }

        return pts[pts.length - 1].ratio;
    };
}

/** Highest quality in 1..100 whose ESTIMATED full bytes still fit. Proxy only. */
async function searchOnProxy(subject, targetBytes, ratioAt) {
    let low = 1;
    let high = 100;
    let best = null;

    while (low <= high) {
        const quality = Math.floor((low + high) / 2);
        const estimate = (await encodeProxy(subject, quality)) * ratioAt(quality);

        if (estimate <= targetBytes) {
            best = quality;
            low = quality + 1;
        } else {
            high = quality - 1;
        }
    }

    return best;
}

async function calibratedProxySearch(subject, targetBytes, strategy, budget = PROXY_FULL_ENCODE_BUDGET) {
    startRun(subject);

    const naiveRatio = (subject.full.width * subject.full.height)
        / (subject.proxy.width * subject.proxy.height);

    const measured = new Map();
    const anchors = [];
    let best = null;

    // Bounds proven by real full-res measurements: every quality below `low` is
    // known to fit and every quality above `high` is known to overshoot. Only
    // the `bracketed` strategy enforces them.
    let low = 1;
    let high = 100;

    function modelFor() {
        if (strategy === 'flat-1pt') {
            return anchors.length === 0 ? () => naiveRatio : () => anchors[anchors.length - 1].ratio;
        }
        return interpolatingModel(anchors, naiveRatio);
    }

    /** Where to take the very first full-res probe. */
    let candidate = strategy === 'fixed-2pt'
        ? FIXED_Q_LOW
        : strategy === 'flat-1pt'
            ? FLAT_Q
            : (await searchOnProxy(subject, targetBytes, () => naiveRatio)) ?? 1;

    while (measured.size < budget) {
        candidate = clampQuality(candidate);

        if (strategy === 'bracketed') {
            if (low > high) break; // the answer is already pinned exactly
            // The model is only ever a hint. A hint that contradicts a real
            // measurement, or repeats one, loses to bisecting what is left.
            if (candidate < low || candidate > high || measured.has(candidate)) {
                candidate = Math.floor((low + high) / 2);
            }
        } else if (measured.has(candidate)) {
            // The model converged on a quality already paid for. Spend what is
            // left probing one step in the useful direction.
            const step = measured.get(candidate) <= targetBytes ? 1 : -1;
            const next = clampQuality(candidate + step);
            if (next === candidate || measured.has(next)) break;
            candidate = next;
        }

        const fullBytes = await encodeFull(subject, candidate);
        const proxyBytes = await encodeProxy(subject, candidate);
        measured.set(candidate, fullBytes);
        anchors.push({ q: candidate, ratio: fullBytes / proxyBytes });

        if (fullBytes <= targetBytes) {
            if (best === null || fullBytes > best.bytes) best = { quality: candidate, bytes: fullBytes };
            low = candidate + 1;
        } else {
            high = candidate - 1;
        }

        if (strategy === 'fixed-2pt' && anchors.length === 1) {
            candidate = FIXED_Q_HIGH;
            continue;
        }

        const next = await searchOnProxy(subject, targetBytes, modelFor());
        candidate = next === null ? 1 : next;
    }

    return {
        ok: best !== null,
        quality: best?.quality ?? null,
        bytes: best?.bytes ?? null,
        floorBytes: measured.size ? Math.min(...measured.values()) : null,
        probes: [...measured.keys()],
        fullEncodes: subject.counters.full,
        proxyEncodes: subject.counters.proxy,
    };
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

function kb(bytes) {
    if (bytes === null || bytes === undefined) return '—';
    return `${(bytes / KB).toFixed(1)}KB`;
}

function pad(value, width, align = 'left') {
    const text = String(value);
    if (text.length >= width) return text.slice(0, width);
    const fill = ' '.repeat(width - text.length);
    return align === 'right' ? fill + text : text + fill;
}

function row(cells, widths, aligns) {
    return cells.map((cell, i) => pad(cell, widths[i], aligns[i] ?? 'left')).join('  ');
}

function rule(widths) {
    return '-'.repeat(widths.reduce((a, b) => a + b + 2, -2));
}

function classify(result, truth, targetBytes) {
    if (!truth.ok && !result.ok) return 'BOTH-IMPOSSIBLE';
    if (!truth.ok) return 'PROXY-FOUND';
    if (!result.ok) return 'MISS-none';
    if (result.bytes > targetBytes) return 'OVER-TARGET';
    const shortfall = (truth.bytes - result.bytes) / targetBytes;
    return shortfall <= TOLERANCE_FRACTION ? 'PASS' : 'MISS-quality';
}

const PASSING = new Set(['PASS', 'BOTH-IMPOSSIBLE', 'PROXY-FOUND']);

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

async function buildSubjects() {
    const subjects = [];

    for (const spec of FIXTURE_SPECS) {
        const source = await loadFixture(spec);
        const full = await jpegDecode.default(new Uint8Array(source));
        const proxy = await resize(full, {
            width: Math.max(1, Math.round(full.width / PROXY_DIVISOR)),
            height: Math.max(1, Math.round(full.height / PROXY_DIVISOR)),
            method: 'lanczos3',
        });

        const megapixels = (full.width * full.height) / 1e6;
        subjects.push(makeSubject(`${spec.name} ${megapixels.toFixed(1)}MP`, full, proxy));
        console.log(`  ${pad(spec.name, 18)} ${full.width}x${full.height}  -> proxy `
            + `${proxy.width}x${proxy.height}   source ${kb(source.length)}`);
    }

    return subjects;
}

async function dumpRatios(subjects) {
    console.log('');
    console.log('Raw calibration ratio  full(q) / proxy(q)   (naive pixel ratio is '
        + `${PROXY_DIVISOR ** 2}; anything else is drift)`);
    const qualities = [1, 5, 10, 20, 35, 50, 60, 75, 85, 95];
    const widths = [24, ...qualities.map(() => 7)];
    console.log(row(['image', ...qualities.map((q) => `q${q}`)], widths, ['left', ...qualities.map(() => 'right')]));
    console.log(rule(widths));

    for (const subject of subjects) {
        startRun(subject);
        const cells = [];
        for (const q of qualities) {
            const ratio = (await encodeFull(subject, q)) / (await encodeProxy(subject, q));
            cells.push(ratio.toFixed(1));
        }
        console.log(row([subject.name, ...cells], widths, ['left', ...qualities.map(() => 'right')]));
    }
}

async function main() {
    const started = Date.now();

    console.log('');
    console.log('RESIZO PHASE 0 SPIKE — exact-size targeting: exhaustive vs calibrated proxy');
    console.log(`codec @jsquash/jpeg (MozJPEG wasm, the browser codec)   proxy 1/${PROXY_DIVISOR} linear `
        + `= 1/${PROXY_DIVISOR ** 2} pixels`);
    console.log(`exhaustive budget ${TARGET_SEARCH_ITERATIONS} full encodes   proxy budget `
        + `${PROXY_FULL_ENCODE_BUDGET} full encodes + unlimited proxy encodes`);
    console.log('');
    console.log('Fixtures');
    const subjects = await buildSubjects();

    if (SHOW_RATIOS) await dumpRatios(subjects);

    console.log('');
    console.log(`MAIN TABLE — proxy column is the "${HEADLINE}" strategy (two-point, adaptive placement)`);
    const widths = [20, 8, 24, 24, 10, 9, 13, 6];
    const aligns = ['left', 'right', 'left', 'left', 'right', 'right', 'left', 'right'];
    console.log(row(['image', 'target', 'exhaustive q/bytes/enc', 'proxy q/bytes/enc', 'delta B', 'delta %', 'tolerance', 'saved'], widths, aligns));
    console.log(rule(widths));

    const records = [];

    for (const subject of subjects) {
        for (const target of TARGETS) {
            const truth = await exhaustiveSearch(subject, target);

            const runs = {};
            for (const strategy of STRATEGIES) {
                runs[strategy] = await calibratedProxySearch(subject, target, strategy);
            }

            const head = runs[HEADLINE];
            const deltaBytes = truth.ok && head.ok ? head.bytes - truth.bytes : null;
            const deltaPct = deltaBytes === null ? null : (deltaBytes / target) * 100;
            const verdict = classify(head, truth, target);
            const saved = truth.fullEncodes - head.fullEncodes;

            records.push({ subject: subject.name, target, truth, runs, head, deltaBytes, deltaPct, verdict, saved });

            console.log(row([
                subject.name,
                kb(target),
                `q${truth.quality ?? '-'} ${kb(truth.bytes)} ${truth.fullEncodes}e`,
                `q${head.quality ?? '-'} ${kb(head.bytes)} ${head.fullEncodes}e`,
                deltaBytes === null ? '—' : String(deltaBytes),
                deltaPct === null ? '—' : `${deltaPct.toFixed(2)}%`,
                verdict,
                `${saved}`,
            ], widths, aligns));
        }
    }

    // ---- strategy comparison ---------------------------------------------
    console.log('');
    console.log('CALIBRATION STRATEGIES — same 4 full-encode budget, different ratio model');
    const sWidths = [16, 10, 10, 12, 14, 12];
    const sAligns = ['left', 'right', 'right', 'right', 'right', 'right'];
    console.log(row(['strategy', 'pass', 'over tgt', 'no answer', 'worst short', 'avg full enc'], sWidths, sAligns));
    console.log(rule(sWidths));

    for (const strategy of STRATEGIES) {
        const results = records.map((r) => ({ r, v: classify(r.runs[strategy], r.truth, r.target) }));
        const pass = results.filter((x) => PASSING.has(x.v)).length;
        const over = results.filter((x) => x.v === 'OVER-TARGET').length;
        const none = results.filter((x) => x.v === 'MISS-none').length;
        const shortfalls = records
            .filter((r) => r.truth.ok && r.runs[strategy].ok)
            .map((r) => ((r.truth.bytes - r.runs[strategy].bytes) / r.target) * 100);
        const worst = shortfalls.length ? Math.max(...shortfalls) : 0;
        const avgEnc = records.reduce((sum, r) => sum + r.runs[strategy].fullEncodes, 0) / records.length;

        console.log(row([
            strategy,
            `${pass}/${records.length}`,
            String(over),
            String(none),
            `${worst.toFixed(1)}%`,
            avgEnc.toFixed(2),
        ], sWidths, sAligns));
    }

    // ---- 100 KB head-to-head ---------------------------------------------
    const hundred = records.filter((r) => r.target === 100 * KB);
    console.log('');
    console.log('100 KB HEAD-TO-HEAD — the /compress-image-to-100kb case');
    const hWidths = [20, 16, 22, 22, 22];
    console.log(row(['image', 'exhaustive', 'flat-1pt', 'fixed-2pt', 'adaptive 2pt'], hWidths, []));
    console.log(rule(hWidths));

    for (const r of hundred) {
        const cell = (strategy) => {
            const run = r.runs[strategy];
            return `q${run.quality ?? '-'} ${kb(run.bytes)} ${classify(run, r.truth, r.target)}`;
        };
        console.log(row([
            r.subject,
            `q${r.truth.quality ?? '-'} ${kb(r.truth.bytes)}`,
            cell('flat-1pt'), cell('fixed-2pt'), cell('adaptive'),
        ], hWidths, []));
    }

    // ---- summary ----------------------------------------------------------
    const failures = records.filter((r) => !PASSING.has(r.verdict));
    const overs = records.filter((r) => r.verdict === 'OVER-TARGET');
    const comparable = records.filter((r) => r.deltaPct !== null);
    const worst = comparable.reduce(
        (acc, r) => (Math.abs(r.deltaPct) > Math.abs(acc?.deltaPct ?? 0) ? r : acc),
        null,
    );
    const avgSaved = records.reduce((sum, r) => sum + r.saved, 0) / records.length;
    const avgFullProxy = records.reduce((sum, r) => sum + r.head.fullEncodes, 0) / records.length;
    const avgFullTruth = records.reduce((sum, r) => sum + r.truth.fullEncodes, 0) / records.length;
    const avgProxyEncodes = records.reduce((sum, r) => sum + r.head.proxyEncodes, 0) / records.length;
    const proxyShare = 1 / PROXY_DIVISOR ** 2;
    const equivalent = avgFullProxy + avgProxyEncodes * proxyShare;

    const perStrategy100 = Object.fromEntries(STRATEGIES.map((strategy) => [
        strategy,
        hundred.filter((r) => PASSING.has(classify(r.runs[strategy], r.truth, r.target))).length,
    ]));

    console.log('');
    console.log('='.repeat(100));
    console.log('SUMMARY');
    console.log('='.repeat(100));
    console.log(`cases                       ${records.length}  (${subjects.length} images x ${TARGETS.length} targets)`);
    console.log(`tolerance                   output <= target AND within ${(TOLERANCE_FRACTION * 100).toFixed(0)}% of target of the exhaustive result`);
    console.log(`missed tolerance            ${failures.length} / ${records.length}`);
    console.log(`exceeded the target         ${overs.length} / ${records.length}   (hard failure: a file over the limit is a wrong answer)`);
    console.log(`worst-case error            ${worst ? `${worst.deltaPct.toFixed(2)}% of target (${worst.deltaBytes} B) — ${worst.subject} @ ${kb(worst.target)}` : 'n/a'}`);
    console.log(`avg full-res encodes        exhaustive ${avgFullTruth.toFixed(2)}  ->  proxy ${avgFullProxy.toFixed(2)}`);
    console.log(`avg full-res encodes saved  ${avgSaved.toFixed(2)}`);
    console.log(`avg proxy encodes           ${avgProxyEncodes.toFixed(2)} at 1/${PROXY_DIVISOR ** 2} cost = ${(avgProxyEncodes * proxyShare).toFixed(2)} full-encode equivalents`);
    console.log(`total cost, full-equivalent exhaustive ${avgFullTruth.toFixed(2)}  ->  proxy ${equivalent.toFixed(2)}   (${(avgFullTruth / equivalent).toFixed(2)}x cheaper)`);
    console.log(`est. mid-range phone, 12MP  exhaustive ~${(avgFullTruth * PHONE_SECONDS_PER_FULL_ENCODE).toFixed(0)}s  ->  proxy ~${(equivalent * PHONE_SECONDS_PER_FULL_ENCODE).toFixed(0)}s`
        + `   (at ${PHONE_SECONDS_PER_FULL_ENCODE}s per full encode)`);
    console.log('');
    for (const strategy of STRATEGIES) {
        console.log(`100 KB pass rate, ${pad(strategy, 10)}${perStrategy100[strategy]}/${hundred.length}`);
    }

    const adaptiveFail100 = hundred.filter((r) => !PASSING.has(classify(r.runs.adaptive, r.truth, r.target)));
    const flatPass = perStrategy100['flat-1pt'];
    const fixedPass = perStrategy100['fixed-2pt'];
    const adaptivePass = perStrategy100.adaptive;

    console.log('');
    if (adaptiveFail100.length === 0) {
        console.log('VERDICT 100KB: PASS — two-point calibration with adaptive probe placement hits 100 KB on '
            + `all ${hundred.length} test images, never over target `
            + `(single-point managed ${flatPass}/${hundred.length}, fixed two-point ${fixedPass}/${hundred.length}).`);
    } else {
        console.log(`VERDICT 100KB: FAIL — the adaptive two-point model still misses on ${adaptiveFail100.length}/${hundred.length} image(s): `
            + adaptiveFail100.map((r) => `${r.subject} [${classify(r.runs.adaptive, r.truth, r.target)}]`).join('; '));
    }

    if (overs.length > 0) {
        console.log(`VERDICT OVERALL: FAIL — ${overs.length} case(s) produced a file LARGER than the target. Not shippable.`);
    } else if (failures.length === 0) {
        console.log(`VERDICT OVERALL: PASS — every case landed within tolerance on ${avgFullProxy.toFixed(2)} full encodes `
            + `instead of ${avgFullTruth.toFixed(2)}, ${(avgFullTruth / equivalent).toFixed(2)}x cheaper overall. `
            + 'The proxy search is a viable replacement for the exhaustive one in the browser.');
    } else {
        console.log(`VERDICT OVERALL: PARTIAL — ${failures.length}/${records.length} case(s) undershot the target by more than `
            + `${(TOLERANCE_FRACTION * 100).toFixed(0)}%. Never over target, so always a correct answer, but a worse-looking `
            + 'file than the user could have had. See the miss list below for which content types.');
    }

    console.log(`(fixed-2pt scored ${fixedPass}/${hundred.length} at 100 KB and adaptive ${adaptivePass}/${hundred.length} — probe PLACEMENT `
        + 'matters at least as much as having two points.)');

    if (failures.length > 0) {
        console.log('');
        console.log('cases that missed tolerance (adaptive):');
        for (const r of failures) {
            console.log(`  ${pad(r.subject, 20)} ${pad(kb(r.target), 9, 'right')}   `
                + `truth q${r.truth.quality ?? '-'} ${kb(r.truth.bytes)}   proxy q${r.head.quality ?? '-'} ${kb(r.head.bytes)}   `
                + `probes ${r.head.probes.join(',')}   ${r.verdict}`);
        }
    }

    console.log('');
    console.log(`elapsed ${((Date.now() - started) / 1000).toFixed(1)}s   `
        + '(encodes are memoised across runs so the harness is fast; the counters still charge every '
        + 'distinct quality once per search, which is what a real implementation would pay)');
}

await main();
