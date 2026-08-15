/**
 * WHICH RESAMPLER RUNS, AND WHY IT USED TO DEPEND ON ROUNDING.
 *
 * The engine's stated default for any downscale is the native lane:
 * `createImageBitmap(blob, { resizeWidth, resizeHeight })`, which decodes and
 * scales in ONE pass — 110 ms on a 12 MP photo, against roughly 1.5 s for the
 * @jsquash/resize lanczos3 fallback on the same job.
 *
 * `decodePixels` used to gate that lane on `fitWithin(...)` reproducing the
 * target box EXACTLY. But the two sides are derived differently: the target
 * rounds each side independently (`scaleDimensions`), while `fitWithin`
 * re-derives both from one shared `Math.min` ratio. They disagree by a pixel
 * whenever the target's rounding is not exactly proportional — and on that
 * disagreement the whole job silently fell back to the slow resampler.
 *
 * A 4032x3024 iPhone photo at 30% is the canonical case:
 *
 *   target   = round(1209.6) x round(907.2) = 1210x907
 *   fitWithin ratio = min(1210/4032, 907/3024) = 0.299934 -> 1209x907
 *   1209 != 1210, so the native lane was skipped
 *
 * 25% took the fast lane and 30% did not, on the same photo. A sweep over 49
 * real camera, phone and screenshot sizes put this at ~21% of scale-percent
 * resizes.
 *
 * The condition that actually matters is the one `canUseNativeDownscale`
 * already expresses — the box fits inside the source and is not the source —
 * so the box is now handed to the decoder verbatim instead of being recomputed
 * there.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { installBrowserEnv } from './helpers/browser-env';

let runOperation;

beforeAll(async () => {
    installBrowserEnv();
    ({ runOperation } = await import('@/lib/image-client/operations'));
});

const SOURCE_WIDTH = 4032;
const SOURCE_HEIGHT = 3024;

/**
 * Stands in for the browser's own decoder. It records what it was asked for and
 * fills the box, which is all these assertions need: the SIZE of the request is
 * what says which lane ran.
 */
function installFakeDecoder() {
    const calls = [];

    globalThis.createImageBitmap = async (source, options = {}) => {
        const width = options.resizeWidth ?? SOURCE_WIDTH;
        const height = options.resizeHeight ?? SOURCE_HEIGHT;
        calls.push({ width, height, resized: options.resizeWidth != null });
        return {
            width,
            height,
            data: new Uint8ClampedArray(width * height * 4).fill(200),
            close() {},
        };
    };

    globalThis.OffscreenCanvas = class {
        constructor(width, height) {
            this.width = width;
            this.height = height;
            this.bitmap = null;
        }

        getContext() {
            return {
                drawImage: (bitmap) => { this.bitmap = bitmap; },
                getImageData: (x, y, width, height) => new ImageData(
                    new Uint8ClampedArray(this.bitmap.data),
                    width,
                    height,
                ),
            };
        }
    };

    return calls;
}

/** A JPEG the fake decoder never actually parses — only its bytes are needed. */
function sourceFile() {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]);
    return new File([bytes], 'photo.jpg', { type: 'image/jpeg' });
}

afterEach(() => {
    delete globalThis.createImageBitmap;
    delete globalThis.OffscreenCanvas;
});

describe('a percentage resize on a 12 MP photo', () => {
    /**
     * 25% rounds proportionally (1008x756) and always took the fast lane. It is
     * here as the control: if this one ever stops taking it, the gate is broken
     * in a different way and the 30% case below would be misleading.
     */
    it('asks the browser for the target directly at 25%', async () => {
        const calls = installFakeDecoder();

        await runOperation('resize', sourceFile(), {
            scale: 25,
            format: 'jpeg',
            sourceWidth: SOURCE_WIDTH,
            sourceHeight: SOURCE_HEIGHT,
        });

        expect(calls).toHaveLength(1);
        expect(calls[0].resized, 'the native decode-and-downscale lane was skipped').toBe(true);
        expect([calls[0].width, calls[0].height]).toEqual([1008, 756]);
    });

    it('asks the browser for the target directly at 30% too, instead of decoding full size', async () => {
        const calls = installFakeDecoder();

        await runOperation('resize', sourceFile(), {
            scale: 30,
            format: 'jpeg',
            sourceWidth: SOURCE_WIDTH,
            sourceHeight: SOURCE_HEIGHT,
        });

        expect(calls).toHaveLength(1);
        expect(
            calls[0].resized,
            'fell back to a full-resolution decode plus the WASM resizer over a one-pixel rounding difference',
        ).toBe(true);
        expect(
            [calls[0].width, calls[0].height],
            'the browser was handed a recomputed box rather than the target',
        ).toEqual([1210, 907]);
    });

    /**
     * The engine must never ask the browser for something LARGER than the
     * source — that is an upscale, which createImageBitmap would happily do and
     * which the native lane is not for.
     */
    it('never asks for more pixels than the source has', async () => {
        const calls = installFakeDecoder();

        await runOperation('resize', sourceFile(), {
            scale: 30,
            format: 'jpeg',
            sourceWidth: SOURCE_WIDTH,
            sourceHeight: SOURCE_HEIGHT,
        });

        for (const call of calls) {
            expect(call.width).toBeLessThanOrEqual(SOURCE_WIDTH);
            expect(call.height).toBeLessThanOrEqual(SOURCE_HEIGHT);
        }
    });
});
