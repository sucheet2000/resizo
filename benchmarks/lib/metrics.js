/**
 * The two quality numbers this benchmark publishes.
 *
 * Bytes and milliseconds are easy to measure and easy to game: any encoder can
 * hit 50 KB by throwing the picture away. So every byte figure in the results
 * is paired with a similarity score against the source, and these are the two
 * scores.
 *
 *   psnr(a, b)  peak signal-to-noise ratio in dB, over luma. A single global
 *               error term. It says how far the pixels moved, and nothing at
 *               all about whether a person would notice.
 *   ssim(a, b)  structural similarity, Wang et al. 2004 (IEEE TIP 13(4), eq.
 *               13), over luma, with an 8x8 UNIFORM window, one window per
 *               pixel position that fits, and the mean over those windows.
 *
 * WHAT THIS IS NOT. It is not MS-SSIM: there is no multi-scale pyramid here and
 * no Gaussian weighting, so a number from this file is not comparable with one
 * from a paper that reports MS-SSIM or with the Gaussian-window ssim_index.m
 * default. Call it "luma SSIM, 8x8 uniform window" wherever it is printed.
 *
 * LUMA IS BT.601 and alpha is ignored on purpose. A JPEG cannot carry alpha, so
 * scoring a flattened output against a transparent source through an alpha
 * channel would report a difference that no encoder made and no viewer sees.
 * Both inputs are expected to be RGBA — that is what sharp's `.ensureAlpha()`
 * hands back, and it is the one buffer shape the runner has to think about.
 *
 * Pure, synchronous, no dependencies. Everything in here is covered by
 * tests/lib/benchmarks/metrics.test.js, which checks the SSIM implementation
 * against a brute-force transcription of the formula rather than against a
 * stored number.
 */

/** Side of the square window, in pixels. Uniform weights, so 1/64 each. */
const SSIM_WINDOW = 8;

/** (K1·L)² and (K2·L)² with K1=0.01, K2=0.03, L=255 — the paper's own values. */
const SSIM_C1 = (0.01 * 255) ** 2;
const SSIM_C2 = (0.03 * 255) ** 2;

const MAX_VALUE = 255;

/** BT.601 luma from three 8-bit channels. */
function luma(r, g, b) {
    return 0.299 * r + 0.587 * g + 0.114 * b;
}

/**
 * Rejects everything that is not an RGBA image of positive size, by name, so a
 * failure in a two-hour benchmark run says which side was wrong.
 */
function assertImage(image, role) {
    if (!image || typeof image !== 'object' || !image.data) {
        throw new TypeError(`${role} is not an image: expected { data, width, height }`);
    }

    const { width, height, data } = image;

    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
        throw new RangeError(`${role} has empty or non-integer dimensions (${width}×${height})`);
    }

    if (typeof data.length !== 'number' || data.length !== width * height * 4) {
        throw new RangeError(
            `${role} is not RGBA: ${data.length} bytes for ${width}×${height} (expected ${width * height * 4})`,
        );
    }
}

function assertPair(a, b) {
    assertImage(a, 'the first image');
    assertImage(b, 'the second image');

    if (a.width !== b.width || a.height !== b.height) {
        throw new RangeError(
            `cannot compare images of a different size: ${a.width}×${a.height} against ${b.width}×${b.height}`,
        );
    }
}

/** One float per pixel. Float64 because the SSIM sums below run to ~1e11. */
function lumaPlane(image) {
    const out = new Float64Array(image.width * image.height);
    const { data } = image;

    for (let i = 0; i < out.length; i += 1) {
        const at = i * 4;
        out[i] = luma(data[at], data[at + 1], data[at + 2]);
    }

    return out;
}

/**
 * Peak signal-to-noise ratio in dB, over luma.
 *
 * Infinity for an identical pair. That is the honest answer — the error is
 * zero and the ratio is unbounded — and the report renderer prints it as ∞
 * rather than letting a made-up ceiling like 99 dB into a results file.
 */
function psnr(a, b) {
    assertPair(a, b);

    const A = lumaPlane(a);
    const B = lumaPlane(b);

    let squared = 0;
    for (let i = 0; i < A.length; i += 1) {
        const error = A[i] - B[i];
        squared += error * error;
    }

    const mse = squared / A.length;
    if (mse === 0) return Infinity;

    return 10 * Math.log10((MAX_VALUE * MAX_VALUE) / mse);
}

/**
 * A summed-area table of `plane`, one row and one column bigger than the image
 * so that every window sum is four lookups regardless of position.
 *
 * The alternative is 64 multiply-adds per pixel per moment, which on a
 * 1600×1067 pair is ~340 million operations for one score. This is the same
 * arithmetic in O(pixels), and the equivalence is what the brute-force test
 * checks.
 */
function summedArea(plane, width, height) {
    const stride = width + 1;
    const table = new Float64Array(stride * (height + 1));

    for (let y = 0; y < height; y += 1) {
        let row = 0;
        for (let x = 0; x < width; x += 1) {
            row += plane[y * width + x];
            table[(y + 1) * stride + (x + 1)] = table[y * stride + (x + 1)] + row;
        }
    }

    return table;
}

/** Sum over the `size`×`size` window whose top-left corner is (x, y). */
function windowSum(table, stride, x, y, size) {
    const top = y * stride;
    const bottom = (y + size) * stride;
    return table[bottom + x + size] - table[bottom + x] - table[top + x + size] + table[top + x];
}

/**
 * Mean SSIM over every 8×8 window that fits, luma only.
 *
 * The moments are the population ones (divided by 64, not 63), which is what
 * the reference implementation computes when its window is normalised to sum
 * to 1 — no Bessel correction anywhere in the paper's code.
 */
function ssim(a, b) {
    assertPair(a, b);

    const { width, height } = a;

    if (width < SSIM_WINDOW || height < SSIM_WINDOW) {
        throw new RangeError(
            `SSIM needs at least ${SSIM_WINDOW}×${SSIM_WINDOW} pixels, got ${width}×${height}`,
        );
    }

    const A = lumaPlane(a);
    const B = lumaPlane(b);

    const squaresA = new Float64Array(A.length);
    const squaresB = new Float64Array(A.length);
    const products = new Float64Array(A.length);

    for (let i = 0; i < A.length; i += 1) {
        squaresA[i] = A[i] * A[i];
        squaresB[i] = B[i] * B[i];
        products[i] = A[i] * B[i];
    }

    const sumA = summedArea(A, width, height);
    const sumB = summedArea(B, width, height);
    const sumAA = summedArea(squaresA, width, height);
    const sumBB = summedArea(squaresB, width, height);
    const sumAB = summedArea(products, width, height);

    const stride = width + 1;
    const n = SSIM_WINDOW * SSIM_WINDOW;

    let total = 0;
    let windows = 0;

    for (let y = 0; y + SSIM_WINDOW <= height; y += 1) {
        for (let x = 0; x + SSIM_WINDOW <= width; x += 1) {
            const meanA = windowSum(sumA, stride, x, y, SSIM_WINDOW) / n;
            const meanB = windowSum(sumB, stride, x, y, SSIM_WINDOW) / n;
            const varianceA = windowSum(sumAA, stride, x, y, SSIM_WINDOW) / n - meanA * meanA;
            const varianceB = windowSum(sumBB, stride, x, y, SSIM_WINDOW) / n - meanB * meanB;
            const covariance = windowSum(sumAB, stride, x, y, SSIM_WINDOW) / n - meanA * meanB;

            total += ((2 * meanA * meanB + SSIM_C1) * (2 * covariance + SSIM_C2))
                / ((meanA * meanA + meanB * meanB + SSIM_C1) * (varianceA + varianceB + SSIM_C2));
            windows += 1;
        }
    }

    return total / windows;
}

module.exports = {
    luma,
    psnr,
    ssim,
    SSIM_C1,
    SSIM_C2,
    SSIM_WINDOW,
};
