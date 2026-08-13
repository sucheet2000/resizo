/**
 * The memory gate in front of a HEIC decode.
 *
 * WHY THIS SUITE EXISTS
 *
 * capability.js states the contract the whole engine is built on: "nothing in
 * this engine allocates hopefully… a job that does not fit is refused BEFORE a
 * single pixel buffer is created", and on iOS a tab that oversteps is killed
 * with nothing to catch and nothing to show.
 *
 * /heic is the one tool where that contract could not be honoured. No browser
 * decodes HEIC, so the page has no preview to measure, so `assessFile` comes
 * back `dimensions-unknown` and defers — and the only place the real dimensions
 * exist is inside libheif. The old decodeHeic read them and went straight on to
 * `new ImageData(new Uint8ClampedArray(width * height * 4), …)`. The number
 * being multiplied out comes from the file's own `ispe` box, which is to say
 * from whoever made the file.
 *
 * WHAT IS REAL HERE AND WHAT IS NOT
 *
 * The containers are real ISOBMFF/HEIF files written by libvips and parsed by
 * the real libheif — the `ispe` dimensions these tests turn on are read by
 * `heif_image_handle_get_width`, the same call the engine makes. What libheif-js
 * cannot do in Node is decode their AV1 payload, so the one test that needs
 * PIXELS back stands a faithful fake in for the decoder and says so. Everything
 * about the gate — where it runs, what it refuses, what it allocates — is
 * measured against the real one.
 *
 * HOW "BEFORE A SINGLE PIXEL BUFFER" IS MEASURED
 *
 * By instrumenting the allocation itself. `Uint8ClampedArray` and `ImageData`
 * are wrapped for exactly the duration of the call under test and every length
 * asked of them is recorded, so "nothing was allocated" is an assertion about
 * what the engine did rather than a claim about what it should have done.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { installBrowserEnv } from './helpers/browser-env';
import { heifDeclaring, makeFile } from './helpers/fixtures';

let decodeToImageData;
let runOperation;
let JobError;
let codecs;

beforeAll(async () => {
    installBrowserEnv();
    ({ decodeToImageData } = await import('@/lib/image-client/decode'));
    ({ runOperation, JobError } = await import('@/lib/image-client/operations'));
    codecs = await import('@/lib/image-client/codecs');
});

/* ------------------------------------------------------------------ *
 * Instrumentation
 * ------------------------------------------------------------------ */

/**
 * Runs `body` with every pixel-buffer allocation recorded.
 *
 * Both constructors are wrapped because the HEIC path uses one to feed the
 * other, and a future shape — `new ImageData(width, height)` — would allocate
 * inside the polyfill where the outer wrapper could not see the length.
 */
async function withAllocationsRecorded(body) {
    const RealArray = globalThis.Uint8ClampedArray;
    const RealImageData = globalThis.ImageData;
    const record = { largestBytes: 0, count: 0 };

    const note = (bytes) => {
        if (!Number.isFinite(bytes)) return;
        record.count += 1;
        if (bytes > record.largestBytes) record.largestBytes = bytes;
    };

    globalThis.Uint8ClampedArray = function RecordedArray(...args) {
        if (typeof args[0] === 'number') note(args[0]);
        return new RealArray(...args);
    };

    globalThis.ImageData = function RecordedImageData(...args) {
        if (typeof args[0] === 'number') note(args[0] * args[1] * 4);
        return new RealImageData(...args);
    };

    try {
        record.outcome = await body();
    } catch (error) {
        record.error = error;
    } finally {
        globalThis.Uint8ClampedArray = RealArray;
        globalThis.ImageData = RealImageData;
    }

    return record;
}

/** A device profile the engine will read, for the cases that turn on the budget. */
function pretendDevice(navigatorLike) {
    Object.defineProperty(globalThis, 'navigator', {
        value: navigatorLike,
        configurable: true,
        writable: true,
    });
}

afterEach(() => {
    delete globalThis.navigator;
    vi.restoreAllMocks();
});

const heicFile = (bytes) => makeFile(bytes, { name: 'IMG_0042.heic', type: 'image/heic' });

/** Every phrasing a raw allocation failure comes out as, in any engine. */
const RAW_ALLOCATION_FAILURE = /array buffer allocation failed|invalid typed array length|out of memory|allocation size overflow/i;

/* ------------------------------------------------------------------ *
 * A file that lies about how big it is
 * ------------------------------------------------------------------ */

describe('a HEIC whose header declares an absurd size', () => {
    /**
     * 25000 x 25000 is 625 megapixels, which is 2.5 GB of RGBA. The container
     * carrying that claim is a few hundred bytes: nothing about the FILE is
     * large, which is why the file gate waves it through and why the number has
     * to be caught where it is first read.
     */
    it('is refused before one byte of pixel buffer is allocated', async () => {
        const bytes = await heifDeclaring({ declaredWidth: 25_000, declaredHeight: 25_000 });

        const run = await withAllocationsRecorded(() => decodeToImageData(heicFile(bytes)));

        expect(run.error).toBeDefined();
        expect(run.error.code).toBe('source-too-large');
        expect(run.largestBytes).toBe(0);
    });

    it('is refused in the gate’s own words, not with a raw allocation error', async () => {
        const bytes = await heifDeclaring({ declaredWidth: 25_000, declaredHeight: 25_000 });

        const run = await withAllocationsRecorded(() => decodeToImageData(heicFile(bytes)));

        expect(run.error.message).toBe(
            'This image is 625 megapixels, which is past the 80 megapixel limit for processing in a browser tab.',
        );
        expect(run.error.message).not.toMatch(RAW_ALLOCATION_FAILURE);
        expect(run.error.suggestion).toBe('Scale it down in a desktop app first, then bring it back here.');
    });

    /**
     * The measured half-way case: 144 megapixels allocated 549 MB before the
     * old code refused it — with the right sentence, and far too late. The
     * sentence is not what was wrong; the order was.
     */
    it('allocates nothing for a 12000 x 12000 declaration either', async () => {
        const bytes = await heifDeclaring({ declaredWidth: 12_000, declaredHeight: 12_000 });

        const run = await withAllocationsRecorded(() => decodeToImageData(heicFile(bytes)));

        expect(run.error.code).toBe('source-too-large');
        expect(run.largestBytes).toBe(0);
    });

    /**
     * A dimension inside every pixel limit but past what MAX_DIMENSION allows
     * out. It matters on its own because it takes a different branch of the
     * gate, and because 9000 x 4000 is 144 MB of RGBA — small enough that the
     * old code would have allocated it without complaint.
     */
    it('refuses a declaration past the 8000 pixel side limit, still allocating nothing', async () => {
        const bytes = await heifDeclaring({ declaredWidth: 9000, declaredHeight: 4000 });

        const run = await withAllocationsRecorded(() => decodeToImageData(heicFile(bytes)));

        expect(run.error.code).toBe('output-too-large');
        expect(run.largestBytes).toBe(0);
    });
});

/* ------------------------------------------------------------------ *
 * The ordinary case, which is the one that matters
 * ------------------------------------------------------------------ */

describe('an ordinary phone photo on a device that cannot hold it', () => {
    /**
     * /heic's whole input population is iPhone photos, and this is the case
     * capability.js was written for: a perfectly valid file, no attacker
     * anywhere, and a budget that cannot take it. Silently killing the tab is
     * the failure mode; a sentence is the fix.
     *
     * The profile is a small iOS device — 0.5 GB reported, so the floor budget
     * of 192 MB applies, and iOS takes 40% off it: about 115 MB. A 15.3
     * megapixel photo needs about 147 MB just to decode.
     */
    it('is refused with the memory sentence, before the surface exists', async () => {
        pretendDevice({ deviceMemory: 0.5, hardwareConcurrency: 6, userAgent: 'iPhone', platform: 'iPhone' });

        const bytes = await heifDeclaring({ declaredWidth: 4500, declaredHeight: 3400 });

        const run = await withAllocationsRecorded(() => decodeToImageData(heicFile(bytes)));

        expect(run.error.code).toBe('not-enough-memory');
        expect(run.error.message).toMatch(/needs about \d+ MB of memory to process/);
        expect(run.error.message).not.toMatch(RAW_ALLOCATION_FAILURE);
        expect(run.largestBytes).toBe(0);
    });

    it('is accepted on a device that can, and allocates exactly one surface of the declared size', async () => {
        const bytes = await heifDeclaring({ width: 64, height: 48 });

        const run = await withAllocationsRecorded(() => decodeToImageData(heicFile(bytes)));

        // The AV1 payload cannot be decoded by libheif-js, so the call still
        // fails — but it fails INSIDE the decoder, having been let through the
        // gate and having allocated exactly the 64 x 48 surface it should.
        expect(run.largestBytes).toBe(64 * 48 * 4);
        expect(run.error.code).toBeUndefined();
    });
});

/* ------------------------------------------------------------------ *
 * A small HEIC still decodes
 * ------------------------------------------------------------------ */

/**
 * The one test that needs real pixels back out of libheif, and the one libheif
 * in this repo cannot supply them for: its WASM build has no AV1 decoder and
 * nothing here can write HEVC. So the decoder is faked — and faked against the
 * contract that was read out of libheif-js's own source and confirmed by
 * running it:
 *
 *   decode(bytes)            parses the container, returns image handles, and
 *                            allocates no pixels
 *   handle.get_width()       heif_image_handle_get_width — a box read
 *   handle.display(target)   the only call that decodes, filling `target`
 *
 * That ordering is the entire reason the fix is possible, so it is what the
 * fake reproduces.
 */
describe('a normal small HEIC', () => {
    function fakeLibheif({ width, height, onDisplay = null }) {
        return {
            HeifDecoder: class {
                decode() {
                    return [{
                        get_width: () => width,
                        get_height: () => height,
                        display: (target, callback) => {
                            onDisplay?.(target);
                            for (let index = 0; index < target.data.length; index += 4) {
                                target.data[index] = 12;
                                target.data[index + 1] = 34;
                                target.data[index + 2] = 56;
                                target.data[index + 3] = 255;
                            }
                            setTimeout(() => callback(target), 0);
                        },
                        free: () => {},
                    }];
                }
            },
        };
    }

    it('decodes to its pixels, upright and at its own size', async () => {
        vi.spyOn(codecs, 'loadHeifDecoder').mockResolvedValue(fakeLibheif({ width: 64, height: 48 }));

        const bytes = await heifDeclaring({ width: 64, height: 48 });
        const decoded = await decodeToImageData(heicFile(bytes));

        expect(decoded.width).toBe(64);
        expect(decoded.height).toBe(48);
        expect(decoded.format).toBe('heic');
        expect(decoded.viaNative).toBe(false);
        expect(decoded.data.width).toBe(64);
        expect(Array.from(decoded.data.data.slice(0, 4))).toEqual([12, 34, 56, 255]);
    });

    it('reaches display() with a surface of exactly the declared size and nothing bigger', async () => {
        const seen = [];
        vi.spyOn(codecs, 'loadHeifDecoder').mockResolvedValue(fakeLibheif({
            width: 320,
            height: 240,
            onDisplay: (target) => seen.push([target.width, target.height]),
        }));

        const bytes = await heifDeclaring({ width: 64, height: 48 });
        const run = await withAllocationsRecorded(() => decodeToImageData(heicFile(bytes)));

        expect(run.error).toBeUndefined();
        expect(seen).toEqual([[320, 240]]);
        expect(run.largestBytes).toBe(320 * 240 * 4);
    });
});

/* ------------------------------------------------------------------ *
 * What the person sees
 * ------------------------------------------------------------------ */

describe('the refusal, as it reaches a visitor through /heic', () => {
    /**
     * A gate refusal has to arrive as a gate refusal all the way out: the same
     * JobError shape, the same code the UI branches on, the same reason and
     * suggestion every other refusal carries. Thrown from inside the decoder it
     * would otherwise come out as an anonymous 'failed' with whatever string the
     * allocator happened to produce.
     */
    it('is a JobError with the gate’s code, reason and suggestion', async () => {
        const bytes = await heifDeclaring({ declaredWidth: 25_000, declaredHeight: 25_000 });

        const error = await runOperation('heic', heicFile(bytes), {}).then(
            (result) => { throw new Error(`expected a refusal, got ${result.resultBytes} bytes`); },
            (thrown) => thrown,
        );

        expect(error).toBeInstanceOf(JobError);
        expect(error.code).toBe('source-too-large');
        expect(error.message).toBe(
            'This image is 625 megapixels, which is past the 80 megapixel limit for processing in a browser tab.',
        );
        expect(error.suggestion).toBe('Scale it down in a desktop app first, then bring it back here.');
    });

    it('is the same refusal when the HEIC is a page of a PDF', async () => {
        const bytes = await heifDeclaring({ declaredWidth: 25_000, declaredHeight: 25_000 });

        const error = await runOperation('pdf', [heicFile(bytes)], {}).then(
            (result) => { throw new Error(`expected a refusal, got ${result.pageCount} pages`); },
            (thrown) => thrown,
        );

        expect(error).toBeInstanceOf(JobError);
        expect(error.code).toBe('source-too-large');
        expect(error.message).toMatch(/past the 80 megapixel limit/);
    });
});
