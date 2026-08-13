/**
 * A size-targeted PDF spends the whole target, not most of it.
 *
 * shareBudgets hands each page a slice of the target in proportion to what its
 * file already weighs. That is only the opening plan: a page that comes in under
 * its share passes the difference to the next one, so the allowance is spent on
 * quality instead of being thrown away. pdf.test.js has a test named for this,
 * but its floor is `> target * 0.5` — loose enough that deleting the carry
 * entirely still passes it. Mutation testing confirmed it: replacing the carry
 * with a constant zero left all 2329 tests green.
 *
 * WHY THE EXISTING FIXTURE CANNOT SEE IT. Two JPEGs, one flat and one noisy: the
 * flat one is tiny, so its proportional share is tiny too, and the difference it
 * hands on is a rounding error. Measured with and without the carry, that
 * document came back at byte-identical sizes.
 *
 * The fixture below is built to make the carry matter, which means making the
 * first page's SHARE large and its SPEND small. A 1000x800 gradient PNG is
 * heavy on disk — so it draws a large share — and re-encodes to a JPEG far under
 * it, because a smooth gradient is exactly what JPEG is best at. Measured on
 * this build:
 *
 *     target = total/4    with carry 95713 bytes (0.993 of target)
 *                         without    84004 bytes (0.872)
 *
 * so the 0.95 bar below has real daylight on both sides. What it protects is
 * quality, not correctness: both documents meet the target, but the one that
 * threw its unspent allowance away is 12% smaller than it had to be, and the
 * pages people put in a passport application look it.
 */
import sharp from 'sharp';
import { beforeAll, describe, expect, it } from 'vitest';

import { installBrowserEnv } from './helpers/browser-env';
import { noiseJpeg } from './helpers/fixtures';

let runOperation;

beforeAll(async () => {
    installBrowserEnv();
    ({ runOperation } = await import('@/lib/image-client/operations'));
});

/** Heavy as a PNG, cheap as a JPEG — which is what opens the gap. */
function gradientPng(width, height) {
    const raw = Buffer.alloc(width * height * 3);
    for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
            const offset = (y * width + x) * 3;
            raw[offset] = Math.floor((x * 255) / width);
            raw[offset + 1] = Math.floor((y * 255) / height);
            raw[offset + 2] = 128;
        }
    }
    return sharp(raw, { raw: { width, height, channels: 3 } }).png().toBuffer();
}

describe('an unspent page budget is carried to the next page', () => {
    it('lands within a few percent of the target, not a tenth under it', async () => {
        const gradient = await gradientPng(1000, 800);
        const noisy = await noiseJpeg({ width: 600, height: 500, seed: 3 });

        const files = [
            new File([gradient], 'gradient.png', { type: 'image/png' }),
            new File([noisy], 'noisy.jpg', { type: 'image/jpeg' }),
        ];

        const total = files.reduce((sum, file) => sum + file.size, 0);
        const targetBytes = Math.round(total / 4);

        const result = await runOperation('pdf', files, {
            targetBytes: String(targetBytes),
            sizes: [null, null],
        });

        expect(result.targetMet).toBe(true);
        expect(result.resultBytes).toBeLessThanOrEqual(targetBytes);
        // The first page spends a fraction of its share; without the carry the
        // second page never sees the rest and the document lands at 0.87.
        expect(result.resultBytes).toBeGreaterThan(targetBytes * 0.95);
    }, 180_000);
});
