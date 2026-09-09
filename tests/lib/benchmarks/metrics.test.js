/**
 * The two quality numbers the benchmark publishes.
 *
 * These are the only figures in benchmarks/results that a reader cannot check
 * with `ls -l`, so they get held to their definitions rather than to a golden
 * file: PSNR against the closed form, SSIM against a brute-force transcription
 * of Wang et al. 2004 eq. 13 written out again in this file. If the fast
 * implementation and the definition ever disagree, the definition wins.
 *
 * "Luma" here is BT.601 (0.299 R + 0.587 G + 0.114 B) over RGBA bytes, and the
 * alpha channel is deliberately not part of either number — a transparent PNG
 * and the same picture flattened must not score differently because of a
 * channel no encoder in this repo puts in a JPEG.
 */
import { describe, expect, it } from 'vitest';

import { luma, psnr, ssim, SSIM_C1, SSIM_C2, SSIM_WINDOW } from '@/benchmarks/lib/metrics';

/** Mulberry32, so every image in this file is the same image on every run. */
function rng(seed) {
    let state = seed >>> 0;
    return function next() {
        state = (state + 0x6D2B79F5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** An RGBA image whose every pixel is produced by `pixel(x, y)`. */
function image(width, height, pixel) {
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
            const [r, g, b, a = 255] = pixel(x, y);
            const at = (y * width + x) * 4;
            data[at] = r;
            data[at + 1] = g;
            data[at + 2] = b;
            data[at + 3] = a;
        }
    }
    return { data, width, height };
}

const grey = (width, height, value) => image(width, height, () => [value, value, value]);

const noise = (width, height, seed) => {
    const next = rng(seed);
    return image(width, height, () => {
        const value = Math.round(next() * 255);
        return [value, value, value];
    });
};

const inverted = (source) => image(source.width, source.height, (x, y) => {
    const at = (y * source.width + x) * 4;
    return [255 - source.data[at], 255 - source.data[at + 1], 255 - source.data[at + 2]];
});

/** A box blur of `radius`, the "known small blur" SSIM has to notice. */
function blur(source, radius) {
    const { width, height, data } = source;
    return image(width, height, (x, y) => {
        const channels = [0, 0, 0];
        let count = 0;
        for (let dy = -radius; dy <= radius; dy += 1) {
            for (let dx = -radius; dx <= radius; dx += 1) {
                const sx = Math.min(width - 1, Math.max(0, x + dx));
                const sy = Math.min(height - 1, Math.max(0, y + dy));
                const at = (sy * width + sx) * 4;
                channels[0] += data[at];
                channels[1] += data[at + 1];
                channels[2] += data[at + 2];
                count += 1;
            }
        }
        return channels.map((total) => Math.round(total / count));
    });
}

/**
 * SSIM written out the slow, literal way: every 8x8 window that fits, the
 * population moments inside it, eq. 13, and the mean over windows. Nothing
 * here is shared with the implementation under test, which is the point.
 */
function referenceSsim(a, b) {
    const plane = (source) => {
        const out = new Float64Array(source.width * source.height);
        for (let i = 0; i < out.length; i += 1) {
            const at = i * 4;
            out[i] = 0.299 * source.data[at] + 0.587 * source.data[at + 1] + 0.114 * source.data[at + 2];
        }
        return out;
    };

    const A = plane(a);
    const B = plane(b);
    const { width, height } = a;
    const n = SSIM_WINDOW * SSIM_WINDOW;

    let total = 0;
    let windows = 0;

    for (let y = 0; y + SSIM_WINDOW <= height; y += 1) {
        for (let x = 0; x + SSIM_WINDOW <= width; x += 1) {
            let sa = 0;
            let sb = 0;
            let saa = 0;
            let sbb = 0;
            let sab = 0;

            for (let wy = 0; wy < SSIM_WINDOW; wy += 1) {
                for (let wx = 0; wx < SSIM_WINDOW; wx += 1) {
                    const va = A[(y + wy) * width + (x + wx)];
                    const vb = B[(y + wy) * width + (x + wx)];
                    sa += va;
                    sb += vb;
                    saa += va * va;
                    sbb += vb * vb;
                    sab += va * vb;
                }
            }

            const ma = sa / n;
            const mb = sb / n;
            const va = saa / n - ma * ma;
            const vb = sbb / n - mb * mb;
            const cov = sab / n - ma * mb;

            total += ((2 * ma * mb + SSIM_C1) * (2 * cov + SSIM_C2))
                / ((ma * ma + mb * mb + SSIM_C1) * (va + vb + SSIM_C2));
            windows += 1;
        }
    }

    return total / windows;
}

describe('luma', () => {
    it('weights the channels the way BT.601 does', () => {
        expect(luma(255, 0, 0)).toBeCloseTo(76.245, 6);
        expect(luma(0, 255, 0)).toBeCloseTo(149.685, 6);
        expect(luma(0, 0, 255)).toBeCloseTo(29.07, 6);
    });

    it('sums to full white and full black at the ends', () => {
        expect(luma(255, 255, 255)).toBeCloseTo(255, 9);
        expect(luma(0, 0, 0)).toBe(0);
    });
});

describe('psnr', () => {
    it('is Infinity for two identical images', () => {
        const a = noise(16, 16, 1);
        const b = noise(16, 16, 1);
        expect(psnr(a, b)).toBe(Infinity);
    });

    it('is 10·log10(255²/MSE) for a known error', () => {
        // Every pixel one luma step apart, so the MSE is exactly 1.
        const a = grey(8, 8, 100);
        const b = grey(8, 8, 101);
        expect(psnr(a, b)).toBeCloseTo(10 * Math.log10(65025), 9);
        expect(psnr(a, b)).toBeCloseTo(48.1308, 4);
    });

    it('is 0 dB for black against white — the worst an 8-bit pair can do', () => {
        expect(psnr(grey(8, 8, 0), grey(8, 8, 255))).toBeCloseTo(0, 9);
    });

    it('is symmetric', () => {
        const a = noise(24, 16, 7);
        const b = blur(a, 1);
        expect(psnr(a, b)).toBeCloseTo(psnr(b, a), 12);
    });

    it('falls as the error grows', () => {
        const a = noise(24, 24, 11);
        expect(psnr(a, blur(a, 1))).toBeGreaterThan(psnr(a, blur(a, 3)));
    });

    it('ignores the alpha channel', () => {
        const opaque = image(8, 8, () => [10, 20, 30, 255]);
        const ghost = image(8, 8, () => [10, 20, 30, 0]);
        expect(psnr(opaque, ghost)).toBe(Infinity);
    });
});

describe('ssim', () => {
    it('is 1 for two identical images', () => {
        const a = noise(32, 24, 3);
        const b = noise(32, 24, 3);
        expect(ssim(a, b)).toBeCloseTo(1, 12);
    });

    it('is near −1 for an inverted image of the same noise', () => {
        const a = noise(32, 32, 5);
        const score = ssim(a, inverted(a));
        expect(score).toBeLessThan(-0.9);
        expect(score).toBeGreaterThanOrEqual(-1.0000001);
    });

    it('is at or below 0 for an inverted image with flat regions in it', () => {
        const a = image(32, 32, (x, y) => {
            const value = ((x >> 3) + (y >> 3)) % 2 === 0 ? 30 : 220;
            return [value, value, value];
        });
        expect(ssim(a, inverted(a))).toBeLessThanOrEqual(0);
    });

    it('drops below 1 for a small blur, and further for a bigger one', () => {
        const a = noise(48, 32, 13);
        const soft = ssim(a, blur(a, 1));
        const softer = ssim(a, blur(a, 3));

        expect(soft).toBeLessThan(1);
        expect(soft).toBeGreaterThan(softer);
        expect(softer).toBeGreaterThan(-1);
    });

    it('matches a brute-force transcription of the definition', () => {
        const a = noise(41, 29, 17);
        const b = blur(noise(41, 29, 23), 2);

        expect(ssim(a, b)).toBeCloseTo(referenceSsim(a, b), 10);
        expect(ssim(a, a)).toBeCloseTo(referenceSsim(a, a), 10);
    });

    it('is symmetric', () => {
        const a = noise(24, 24, 29);
        const b = blur(a, 2);
        expect(ssim(a, b)).toBeCloseTo(ssim(b, a), 12);
    });

    it('ignores the alpha channel', () => {
        const opaque = image(16, 16, (x, y) => [(x * 7) % 256, (y * 11) % 256, 40, 255]);
        const ghost = image(16, 16, (x, y) => [(x * 7) % 256, (y * 11) % 256, 40, 0]);
        expect(ssim(opaque, ghost)).toBeCloseTo(1, 12);
    });

    it('uses an 8×8 window and the standard stabilising constants', () => {
        expect(SSIM_WINDOW).toBe(8);
        expect(SSIM_C1).toBeCloseTo((0.01 * 255) ** 2, 12);
        expect(SSIM_C2).toBeCloseTo((0.03 * 255) ** 2, 12);
    });

    it('scores an image exactly one window wide', () => {
        const a = noise(8, 8, 31);
        expect(ssim(a, a)).toBeCloseTo(1, 12);
    });

    it('refuses an image smaller than one window', () => {
        const small = noise(7, 8, 37);
        expect(() => ssim(small, small)).toThrow(/8/);
    });
});

describe('both metrics refuse a pair they cannot compare', () => {
    const cases = [
        ['a different width', noise(16, 16, 41), noise(17, 16, 41)],
        ['a different height', noise(16, 16, 43), noise(16, 15, 43)],
    ];

    for (const [what, a, b] of cases) {
        it(`throws on ${what}`, () => {
            expect(() => psnr(a, b)).toThrow(/size/i);
            expect(() => ssim(a, b)).toThrow(/size/i);
        });
    }

    it('throws when the buffer is not width × height × 4 bytes', () => {
        const truncated = { data: new Uint8ClampedArray(16 * 16 * 4 - 4), width: 16, height: 16 };
        const whole = noise(16, 16, 47);

        expect(() => psnr(truncated, whole)).toThrow(/RGBA/i);
        expect(() => ssim(truncated, whole)).toThrow(/RGBA/i);
    });

    it('throws on an empty image', () => {
        const empty = { data: new Uint8ClampedArray(0), width: 0, height: 0 };
        expect(() => psnr(empty, empty)).toThrow(/empty|dimension/i);
        expect(() => ssim(empty, empty)).toThrow(/empty|dimension/i);
    });

    it('throws when handed something that is not an image', () => {
        const whole = noise(16, 16, 53);
        for (const bad of [null, undefined, 'image.png', 42, {}]) {
            expect(() => psnr(bad, whole)).toThrow();
            expect(() => ssim(whole, bad)).toThrow();
        }
    });
});
