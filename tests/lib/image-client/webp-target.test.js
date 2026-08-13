/**
 * libwebp's rate controller, measured against real bytes.
 *
 * `WebPConfig.target_size` is what lets /compress answer "make this 20 KB" for a
 * WebP in ONE encode instead of an eight-probe search. It has a companion
 * setting that is not optional and is very easy to lose: `pass`, the number of
 * entropy-analysis passes the internal dichotomy is allowed. @jsquash defaults
 * it to 1, and AT 1 THE CONTROLLER DOES NOTHING AT ALL — the encoder returns
 * byte-for-byte what it would have returned with no target set.
 *
 * That is the regression this file exists for, and it is invisible to every
 * other test in the suite: compressToTargetBytes MEASURES the native encode and
 * falls through to the bounded quality search when it overshoots, so a broken
 * rate controller still produces a correct-sized file. It just costs eight more
 * encodes to get there, and on the two lanes below it hands back a file 8x and
 * 32x the size that was asked for before anything notices. Mutation testing
 * confirmed it: setting WEBP_TARGET_PASSES back to 1, and removing target_size
 * from the encoder call entirely, both left all 2329 other tests green.
 *
 * The numbers below were measured on this build's libwebp:
 *
 *     800x600   asked 20 KB   pass=1 → 163.3 KB (8.2x)    pass=6 → 17.1 KB
 *     1600x1200 asked 20 KB   pass=1 → 650.0 KB (32.5x)   pass=6 → 17.6 KB
 *
 * so the 1.5x bar asserted here has two orders of magnitude of daylight on
 * either side of it. It is deliberately NOT `<= target`: target_size is a goal
 * and not a guarantee — 16 of 84 measured pairs came back above the number
 * asked for, the worst by 31% — and asserting the guarantee here would pin a
 * promise libwebp does not make. The guarantee is compress-target.test.js's job,
 * and it is kept by the fallback search, not by this encode.
 *
 * The pixels are real noise, because flat colour compresses to nothing at every
 * setting and would make the whole comparison vacuous.
 */
import sharp from 'sharp';
import { beforeAll, describe, expect, it } from 'vitest';

import { installBrowserEnv } from './helpers/browser-env';

const KB = 1024;

let decodeToImageData;
let encodeImageData;
let WEBP_TARGET_PASSES;

beforeAll(async () => {
    installBrowserEnv();
    ({ decodeToImageData } = await import('@/lib/image-client/decode'));
    ({ encodeImageData, WEBP_TARGET_PASSES } = await import('@/lib/image-client/encode'));
});

/** Deterministic noise over a gradient: real entropy, so size responds. */
function noisyPixels(width, height, seed = 7) {
    let state = seed;
    const random = () => {
        state = (state * 1103515245 + 12345) % 2147483648;
        return state / 2147483648;
    };

    const raw = Buffer.alloc(width * height * 3);
    for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
            const offset = (y * width + x) * 3;
            raw[offset] = Math.min(255, Math.floor((x * 255) / width) + Math.floor(random() * 120));
            raw[offset + 1] = Math.min(255, Math.floor((y * 255) / height) + Math.floor(random() * 120));
            raw[offset + 2] = Math.min(255, ((x * y) % 255) + Math.floor(random() * 120));
        }
    }

    return sharp(raw, { raw: { width, height, channels: 3 } });
}

const cache = new Map();

async function noisyImageData(width, height) {
    const key = `${width}x${height}`;
    if (!cache.has(key)) {
        cache.set(key, (async () => {
            const bytes = await noisyPixels(width, height).webp({ quality: 95 }).toBuffer();
            const decoded = await decodeToImageData(new Blob([bytes], { type: 'image/webp' }), {
                mimeOrSniff: 'webp',
            });
            return decoded.data;
        })());
    }
    return cache.get(key);
}

describe('asking libwebp for a size actually steers the encoder', () => {
    it.each([
        [800, 600, 20 * KB],
        [1600, 1200, 20 * KB],
        [1600, 1200, 40 * KB],
    ])('a %dx%d frame asked for %d bytes lands near it, not multiples over', async (width, height, targetBytes) => {
        const pixels = await noisyImageData(width, height);
        const encoded = await encodeImageData(pixels, { format: 'webp', targetBytes });

        expect(encoded.targetRequested).toBe(targetBytes);
        // 8x at 800x600 and 32x at 1600x1200 is what an unengaged rate
        // controller returns. 1.5x is unreachable without a working one.
        expect(encoded.bytes).toBeLessThan(targetBytes * 1.5);
    }, 180_000);

    /**
     * The other half of the same failure. If `target_size` never reaches the
     * encoder, the output is exactly what a plain quality encode produces — so
     * the two being DIFFERENT is the proof that the target was honoured, and it
     * holds even if somebody changes the default quality.
     */
    it('produces something other than a plain quality encode of the same pixels', async () => {
        const pixels = await noisyImageData(800, 600);

        const targeted = await encodeImageData(pixels, { format: 'webp', targetBytes: 20 * KB });
        const plain = await encodeImageData(pixels, { format: 'webp' });

        expect(targeted.bytes).not.toBe(plain.bytes);
        expect(targeted.bytes).toBeLessThan(plain.bytes / 2);
    }, 180_000);

    /**
     * cwebp itself substitutes 6 passes whenever -size is given. 10 measured
     * identical output to 6 and cost more time; 1 is the @jsquash default and
     * is the bug. Anything below 6 is the regression, so the floor is asserted
     * rather than the exact number.
     */
    it('allows the encoder enough entropy passes for the dichotomy to converge', () => {
        expect(WEBP_TARGET_PASSES).toBeGreaterThanOrEqual(6);
    });
});
