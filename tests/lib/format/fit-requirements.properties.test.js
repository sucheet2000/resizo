/**
 * The requirement contract's invariants, over two hundred generated requests.
 *
 * The example tests next door pin the cases somebody thought of — a 35 × 45 mm
 * photo, a minimum equal to its maximum, a WebP that asked for a DPI. These
 * pin the ones nobody did: every unit against every format, sizes that round
 * away to nothing and sizes that blow past the ceiling, byte limits in either
 * order, fields left blank and fields filled with nonsense, in random
 * combinations — and then the same statements are checked about whatever came
 * back.
 *
 * The statements are about the RESULT, never about the input, which is what
 * makes them safe to run against a generator that does not know which of its
 * own requests were valid: a refusal satisfies them by refusing, and an
 * acceptance has to satisfy every one of them at once.
 *
 * No new dependency. The generator is a seeded mulberry32 below, so a failure
 * here reproduces exactly — the case index is printed with it.
 */
import { describe, expect, it } from 'vitest';

import {
    FORMATS,
    GEOMETRIES,
    UNITS,
    centeredCoverRect,
    enlargementFor,
    resolveRequirements,
} from '@/lib/format/fit-requirements';
import { pixelsFor } from '@/lib/format/physical';
import { MAX_DIMENSION, MAX_TARGET_BYTES } from '@/lib/limits';

const RUNS = 200;

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
 * One request. Roughly a third of the fields are deliberately unusable — blank
 * sides, fractional pixel counts, a unit that does not exist, a format the
 * engine cannot write — because the invariants have to hold over refusals just
 * as strictly as over acceptances.
 */
function generateRequest(rand) {
    const unit = rand() < 0.07 ? 'ft' : pick(rand, UNITS);
    const isPhysical = unit !== 'px';

    // Physical ranges are per unit, so that a plausible photo size at a
    // plausible resolution mostly lands inside the pixel ceiling — the
    // interesting refusals are the typed ones, not 600 inches at 1200 DPI.
    const PHYSICAL = { mm: [10, 2500], cm: [1, 250], in: [5, 100] };

    const side = () => {
        const roll = rand();
        if (roll < 0.07) return '';
        if (roll < 0.12) return 'abc';
        if (isPhysical) {
            const [low, high] = PHYSICAL[unit] ?? PHYSICAL.mm;
            return String(between(rand, low, high) / 10);
        }
        if (roll < 0.18) return String(between(rand, 1, 9500) + 0.5);
        return String(between(rand, 1, 9500));
    };

    const kilobytes = () => {
        const roll = rand();
        if (roll < 0.42) return '';
        if (roll < 0.47) return '0';
        return String(between(rand, 1, 24000));
    };

    const dpi = () => {
        const roll = rand();
        if (roll < 0.35) return '';
        if (roll < 0.41) return '0';
        if (roll < 0.46) return String(between(rand, 10001, 20000));
        return String(between(rand, 72, 600));
    };

    const maxKb = kilobytes();
    let minKb = kilobytes();
    // Two random integers never collide, so the pair the engine refuses —
    // a floor sitting exactly on its own ceiling — has to be dealt in
    // deliberately or the statement about it is vacuous.
    if (maxKb !== '' && maxKb !== '0' && rand() < 0.12) minKb = maxKb;

    return {
        width: side(),
        height: side(),
        unit,
        dpi: dpi(),
        format: rand() < 0.06 ? 'gif' : pick(rand, FORMATS),
        maxKb,
        minKb,
        geometry: pick(rand, GEOMETRIES),
        background: pick(rand, ['white', 'black', '#2f6fed']),
        allowLowerQuality: rand() < 0.3,
    };
}

const CASES = (() => {
    const rand = mulberry32(0x5eed_f17);
    return Array.from({ length: RUNS }, (_, index) => ({ index, request: generateRequest(rand) }));
})();

function forEachCase(check) {
    for (const { index, request } of CASES) {
        const result = resolveRequirements(request);
        try {
            check(result, request);
        } catch (failure) {
            failure.message = `case ${index} — ${JSON.stringify(request)}\n${failure.message}`;
            throw failure;
        }
    }
}

describe('resolveRequirements, over 200 generated requests', () => {
    it('generates both acceptances and refusals, so neither statement is vacuous', () => {
        const accepted = CASES.filter(({ request }) => resolveRequirements(request).ok);
        expect(accepted.length).toBeGreaterThan(20);
        expect(CASES.length - accepted.length).toBeGreaterThan(20);
    });

    it('never reports an error alongside an acceptance, and never accepts without fields', () => {
        forEachCase((result) => {
            expect(typeof result.ok).toBe('boolean');

            if (result.ok) {
                expect(Object.keys(result.errors)).toEqual([]);
                expect(result.fields).not.toBeNull();
                expect(result.pixels).not.toBeNull();
            } else {
                expect(Object.keys(result.errors).length).toBeGreaterThan(0);
                expect(result.fields).toBeNull();
                expect(result.pixels).toBeNull();
            }
        });
    });

    it('answers every refusal in a sentence a person can act on', () => {
        forEachCase((result) => {
            for (const message of Object.values(result.errors)) {
                expect(typeof message).toBe('string');
                expect(message.length).toBeGreaterThan(10);
                expect(message[0]).toBe(message[0].toUpperCase());
                expect(message.endsWith('.')).toBe(true);
                expect(message).not.toMatch(/undefined|NaN|null|\[object/);
            }
        });
    });

    it('accepts only whole pixel counts inside the engine’s dimension ceiling', () => {
        forEachCase((result) => {
            if (!result.ok) return;

            for (const value of [result.pixels.width, result.pixels.height]) {
                expect(Number.isInteger(value)).toBe(true);
                expect(value).toBeGreaterThanOrEqual(1);
                expect(value).toBeLessThanOrEqual(MAX_DIMENSION);
            }

            expect(result.fields.width).toBe(result.pixels.width);
            expect(result.fields.height).toBe(result.pixels.height);
        });
    });

    it('converts a physical size exactly as lib/format/physical.js does', () => {
        forEachCase((result, request) => {
            if (!result.ok || request.unit === 'px') return;

            expect(result.dpi).not.toBeNull();
            expect(result.fields.width).toBe(pixelsFor(Number(request.width), request.unit, result.dpi));
            expect(result.fields.height).toBe(pixelsFor(Number(request.height), request.unit, result.dpi));
        });
    });

    it('never sends a DPI to WebP, and says so whenever one applied', () => {
        forEachCase((result, request) => {
            const isWebp = request.format === 'webp';

            expect(result.dpiDropped).toBe(isWebp && result.dpi !== null);

            if (result.ok && isWebp) {
                expect(result.fields).not.toHaveProperty('dpi');
            }
            if (result.ok && !isWebp && result.dpi !== null) {
                expect(result.fields.dpi).toBe(result.dpi);
            }
        });
    });

    it('never accepts a floor that meets or passes its own ceiling', () => {
        forEachCase((result) => {
            if (!result.ok) return;

            const { targetBytes, minBytes } = result.fields;

            if (targetBytes !== undefined) {
                expect(targetBytes).toBeGreaterThan(0);
                expect(targetBytes).toBeLessThanOrEqual(MAX_TARGET_BYTES);
            }
            if (minBytes !== undefined) {
                expect(minBytes).toBeGreaterThan(0);
                expect(minBytes).toBeLessThanOrEqual(MAX_TARGET_BYTES);
            }
            if (targetBytes !== undefined && minBytes !== undefined) {
                expect(minBytes).toBeLessThan(targetBytes);
            }
        });
    });

    it('sends the fill behaviour, format and background the engine knows', () => {
        forEachCase((result, request) => {
            if (!result.ok) return;

            expect(GEOMETRIES).toContain(result.fields.geometry);
            expect(FORMATS).toContain(result.fields.format);
            expect(result.fields.background).toBe(request.background);
            expect(result.fields.minQuality).toBe(request.allowLowerQuality ? 1 : undefined);
        });
    });
});

describe('enlargementFor, over 200 generated framings', () => {
    const framings = (() => {
        const rand = mulberry32(0xc0ffee);
        return Array.from({ length: RUNS }, (_, index) => {
            const sourceWidth = between(rand, 40, 6000);
            const sourceHeight = between(rand, 40, 6000);
            const useRect = rand() < 0.5;

            return {
                index,
                input: {
                    sourceWidth,
                    sourceHeight,
                    keptRect: useRect
                        ? { x: 0, y: 0, width: between(rand, 20, sourceWidth), height: between(rand, 20, sourceHeight) }
                        : null,
                    pixels: { width: between(rand, 20, 8000), height: between(rand, 20, 8000) },
                },
            };
        });
    })();

    it('reports an enlargement exactly when the kept area is smaller on a side', () => {
        for (const { index, input } of framings) {
            const kept = input.keptRect ?? { width: input.sourceWidth, height: input.sourceHeight };
            const covers = input.pixels.width <= kept.width && input.pixels.height <= kept.height;
            const report = enlargementFor(input);

            try {
                if (covers) {
                    expect(report).toBeNull();
                } else {
                    expect(report).toEqual({
                        from: { width: kept.width, height: kept.height },
                        to: { width: input.pixels.width, height: input.pixels.height },
                    });
                }
            } catch (failure) {
                failure.message = `framing ${index} — ${JSON.stringify(input)}\n${failure.message}`;
                throw failure;
            }
        }
    });
});

describe('centeredCoverRect, over 200 generated sources', () => {
    it('stays inside the source and lands on the shape it was asked for', () => {
        const rand = mulberry32(0xbeef);

        for (let index = 0; index < RUNS; index += 1) {
            const sourceWidth = between(rand, 40, 6000);
            const sourceHeight = between(rand, 40, 6000);
            const aspect = between(rand, 20, 4000) / between(rand, 20, 4000);
            const rect = centeredCoverRect(sourceWidth, sourceHeight, aspect);

            try {
                expect(rect).not.toBeNull();
                expect(rect.x).toBeGreaterThanOrEqual(0);
                expect(rect.y).toBeGreaterThanOrEqual(0);
                expect(rect.x + rect.width).toBeLessThanOrEqual(sourceWidth);
                expect(rect.y + rect.height).toBeLessThanOrEqual(sourceHeight);
                expect(rect.width).toBeGreaterThanOrEqual(1);
                expect(rect.height).toBeGreaterThanOrEqual(1);
                // One of the two sides is always the source's own, because the
                // rectangle is the largest of its shape that fits.
                expect(rect.width === sourceWidth || rect.height === sourceHeight).toBe(true);
            } catch (failure) {
                failure.message = `source ${index} — ${sourceWidth}×${sourceHeight} at ${aspect}\n${failure.message}`;
                throw failure;
            }
        }
    });
});
