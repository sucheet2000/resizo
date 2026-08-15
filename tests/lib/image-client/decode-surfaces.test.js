/**
 * HOW MANY FULL RGBA SURFACES THE NATIVE DECODE HOLDS AT ONCE.
 *
 * capability.js charges DECODE_SURFACE_COPIES = 2, documented as "the codec's
 * own output (an ImageBitmap on the native path) and the ImageData copy handed
 * back to JS". On the native path there was a THIRD it never counted:
 *
 *   1. the ImageBitmap
 *   2. the OffscreenCanvas backing store — `willReadFrequently: true`
 *      explicitly forces a CPU-side one
 *   3. the ImageData that getImageData returns
 *
 * All three were live simultaneously, because the callers close the bitmap in a
 * `finally` — that is, after imageDataFromBitmap has already returned. On a
 * 24 MP photo a surface is 96 MB, so the gate was told 192 MB and the tab
 * really wanted 288 MB. This is the DEFAULT path for every image tool on every
 * browser with createImageBitmap and OffscreenCanvas.
 *
 * The fix closes the bitmap between drawImage and getImageData, which makes the
 * documented count of 2 TRUE rather than optimistic. That is strictly better
 * than raising the estimate to 3: it lowers what the tab actually allocates
 * instead of refusing more jobs.
 *
 * The trap, and the reason this test watches ordering rather than just reading
 * the output: per spec `ImageBitmap.close()` sets width and height to ZERO, and
 * the original code read `bitmap.width`/`bitmap.height` on the getImageData
 * line. Closing without capturing the dimensions first produces a 0x0 image and
 * every test that only checks pixels would still pass on a black hole.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { installBrowserEnv } from './helpers/browser-env';

let decodeToImageData;

beforeAll(async () => {
    installBrowserEnv();
    ({ decodeToImageData } = await import('@/lib/image-client/decode'));
});

const WIDTH = 64;
const HEIGHT = 48;

/**
 * Records the order of the calls that matter, and models close() faithfully:
 * it zeroes the dimensions and is idempotent, both of which the fix relies on.
 */
function installRecordingDecoder() {
    const order = [];

    globalThis.createImageBitmap = async () => {
        const bitmap = {
            width: WIDTH,
            height: HEIGHT,
            closed: false,
            close() {
                this.closed = true;
                this.width = 0;
                this.height = 0;
                order.push('close');
            },
        };
        return bitmap;
    };

    globalThis.OffscreenCanvas = class {
        constructor(width, height) {
            this.width = width;
            this.height = height;
            order.push(`canvas:${width}x${height}`);
        }

        getContext() {
            return {
                drawImage: () => order.push('drawImage'),
                getImageData: (x, y, width, height) => {
                    order.push(`getImageData:${width}x${height}`);
                    return new ImageData(new Uint8ClampedArray(width * height * 4).fill(180), width, height);
                },
            };
        }
    };

    return order;
}

function jpegFile() {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]);
    return new File([bytes], 'photo.jpg', { type: 'image/jpeg' });
}

afterEach(() => {
    delete globalThis.createImageBitmap;
    delete globalThis.OffscreenCanvas;
});

describe('the native decode', () => {
    it('releases the bitmap before reading the pixels back', async () => {
        const order = installRecordingDecoder();

        await decodeToImageData(jpegFile(), { mimeOrSniff: 'jpeg' });

        expect(order).toContain('close');
        expect(
            order.indexOf('close'),
            'the bitmap, the canvas backing store and the ImageData were all live at once',
        ).toBeLessThan(order.findIndex((step) => step.startsWith('getImageData')));
    });

    it('still reads the full picture, not a zero-sized one', async () => {
        const order = installRecordingDecoder();

        const decoded = await decodeToImageData(jpegFile(), { mimeOrSniff: 'jpeg' });

        // close() zeroes the dimensions, so reading them off the bitmap after
        // closing would silently produce a 0x0 image.
        expect(order).toContain(`getImageData:${WIDTH}x${HEIGHT}`);
        expect([decoded.width, decoded.height]).toEqual([WIDTH, HEIGHT]);
        expect(decoded.data.data).toHaveLength(WIDTH * HEIGHT * 4);
    });

    it('survives the callers closing it a second time in their finally block', async () => {
        installRecordingDecoder();

        // decodeToImageData's own `finally` calls bitmap?.close() again. If that
        // were not idempotent the whole decode would throw.
        await expect(decodeToImageData(jpegFile(), { mimeOrSniff: 'jpeg' })).resolves.toBeTruthy();
    });
});
