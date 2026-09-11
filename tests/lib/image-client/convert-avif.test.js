/**
 * AVIF through the whole engine — intake, decode, encode, verification — with
 * sharp reading every file back.
 *
 * WHY THE BROWSER'S DECODER IS SIMULATED HERE. AVIF decoding is native and
 * nothing else: no WASM decoder is shipped, because every engine in the test
 * matrix reads AVIF itself and the package's decoder measured 3.4-4.9x slower
 * than libvips for 267 KB brotli. Node has no `createImageBitmap`, so these
 * tests install one backed by sharp — the same libheif and libaom the browsers
 * use, through a different binding. What is NOT simulated is anything under
 * test: the guard, the encoder, the header reader and the output validation are
 * all the real modules, and the AVIF files are real bytes.
 *
 * The Playwright suite runs the same flows on Chromium, Firefox, WebKit and two
 * phone profiles, where the decoder is the browser's own.
 */
import sharp from 'sharp';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { sniffImageType } from '@/lib/image/magic-bytes';
import { readAvifHeader } from '@/lib/image-client/avif';
import { installBrowserEnv } from './helpers/browser-env';

let runOperation;
let JobError;

beforeAll(async () => {
    installBrowserEnv();
    ({ runOperation, JobError } = await import('@/lib/image-client/operations'));
});

/* ------------------------------------------------------------------ *
 * The browser's decoder, as sharp
 * ------------------------------------------------------------------ */

async function rawFrom(pipeline) {
    return pipeline.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
}

/**
 * `createImageBitmap` and `OffscreenCanvas`, backed by libvips.
 *
 * `formats` is what this pretend browser can open. Leaving 'avif' out of it is
 * how a Safari 16.0 — `createImageBitmap` present, AVIF absent — is reproduced.
 */
function installNativeDecoder({ formats = ['jpeg', 'png', 'webp', 'avif'] } = {}) {
    globalThis.createImageBitmap = async (source, options = {}) => {
        let pipeline;

        if (source && source.data instanceof Uint8ClampedArray) {
            // Resampling an existing bitmap: the second native call in
            // decodeAndDownscale's measure-then-scale branch.
            pipeline = sharp(Buffer.from(source.data), {
                raw: { width: source.width, height: source.height, channels: 4 },
            });
        } else {
            const bytes = Buffer.from(await source.arrayBuffer());
            const sniffed = sniffImageType(bytes);
            if (!formats.includes(sniffed)) {
                throw new Error(`this pretend browser cannot decode ${sniffed}`);
            }
            // `.rotate()` with no argument bakes in EXIF Orientation, which is
            // what `imageOrientation: 'from-image'` asks the browser for.
            pipeline = sharp(bytes).rotate();
        }

        if (options.resizeWidth) {
            pipeline = pipeline.resize(options.resizeWidth, options.resizeHeight, { fit: 'fill' });
        }

        const { data, info } = await rawFrom(pipeline);
        return {
            width: info.width,
            height: info.height,
            data: new Uint8ClampedArray(data),
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
}

afterEach(async () => {
    delete globalThis.createImageBitmap;
    delete globalThis.OffscreenCanvas;
    const { resetAvifDecodeProbe } = await import('@/lib/image-client/capability');
    resetAvifDecodeProbe();
});

/* ------------------------------------------------------------------ *
 * Fixtures
 * ------------------------------------------------------------------ */

const WIDTH = 90;
const HEIGHT = 60;

/** Something with structure, so a lossy encode has work to do. */
function pixels({ alpha = false } = {}) {
    const raw = Buffer.alloc(WIDTH * HEIGHT * 4);

    for (let y = 0; y < HEIGHT; y += 1) {
        for (let x = 0; x < WIDTH; x += 1) {
            const at = (y * WIDTH + x) * 4;
            raw[at] = x < WIDTH / 2 ? 220 : 30;
            raw[at + 1] = (y * 4) % 256;
            raw[at + 2] = (x * 2 + y) % 256;
            raw[at + 3] = alpha && x < WIDTH / 3 ? 0 : 255;
        }
    }

    return raw;
}

function source(format, options = {}) {
    const pipeline = sharp(pixels(options), { raw: { width: WIDTH, height: HEIGHT, channels: 4 } });

    if (format === 'avif') return pipeline.avif({ quality: 60 }).toBuffer();
    if (format === 'png') return pipeline.png().toBuffer();
    if (format === 'webp') return pipeline.webp({ quality: 80 }).toBuffer();
    return pipeline.removeAlpha().jpeg({ quality: 90 }).toBuffer();
}

function fileOf(bytes, name, type) {
    return new File([bytes], name, { type });
}

async function inspect(blob) {
    const buffer = Buffer.from(await blob.arrayBuffer());
    const meta = await sharp(buffer).metadata();
    const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });

    return {
        buffer,
        sniffed: sniffImageType(buffer),
        width: meta.width,
        height: meta.height,
        hasAlpha: Boolean(meta.hasAlpha),
        pixelAt: (x, y) => [...data.subarray((y * info.width + x) * 4, (y * info.width + x) * 4 + 4)],
    };
}

async function expectJobError(promise, { code }) {
    const error = await promise.then(
        (result) => { throw new Error(`expected a refusal, got ${result.format}`); },
        (thrown) => thrown,
    );

    expect(error).toBeInstanceOf(JobError);
    expect(error.code).toBe(code);
    return error;
}

/* ------------------------------------------------------------------ *
 * 1. Writing an AVIF
 * ------------------------------------------------------------------ */

describe('/convert to AVIF', () => {
    it('turns a JPEG into a file libvips reads back at the same size', async () => {
        installNativeDecoder();

        const result = await runOperation('convert', fileOf(await source('jpeg'), 'photo.jpg', 'image/jpeg'), {
            format: 'avif',
            sourceWidth: WIDTH,
            sourceHeight: HEIGHT,
        });

        const output = await inspect(result.blob);

        expect(result.format).toBe('avif');
        expect(result.type).toBe('image/avif');
        expect(result.filename.endsWith('.avif')).toBe(true);
        expect(output.sniffed).toBe('avif');
        expect([output.width, output.height]).toEqual([WIDTH, HEIGHT]);
        expect(output.hasAlpha).toBe(false);
    }, 60_000);

    it('keeps the picture, not just the size', async () => {
        installNativeDecoder();

        const result = await runOperation('convert', fileOf(await source('jpeg'), 'photo.jpg', 'image/jpeg'), {
            format: 'avif',
            quality: 90,
            sourceWidth: WIDTH,
            sourceHeight: HEIGHT,
        });

        const output = await inspect(result.blob);
        const [leftR] = output.pixelAt(4, 30);
        const [rightR] = output.pixelAt(WIDTH - 5, 30);

        // The source is bright on the left half and dark on the right. A
        // conversion that lost the picture would not keep that apart.
        expect(leftR).toBeGreaterThan(150);
        expect(rightR).toBeLessThan(100);
    }, 60_000);

    it('carries a transparent PNG’s alpha into the AVIF', async () => {
        installNativeDecoder();

        const result = await runOperation('convert', fileOf(await source('png', { alpha: true }), 'logo.png', 'image/png'), {
            format: 'avif',
            sourceWidth: WIDTH,
            sourceHeight: HEIGHT,
        });

        const output = await inspect(result.blob);

        expect(result.transparent).toBe(true);
        expect(output.hasAlpha).toBe(true);
        expect(readAvifHeader(output.buffer).alpha).toBe(true);
        expect(output.pixelAt(2, 30)[3]).toBe(0);
        expect(output.pixelAt(WIDTH - 3, 30)[3]).toBe(255);
    }, 60_000);

    /**
     * The engine's own answer is not evidence for itself. After an AVIF encode
     * the finished bytes are parsed by a reader that shares no code with the
     * encoder AND decoded back by the browser, and both have to agree before
     * the job reports success.
     */
    it('reports the four checks it made on the finished file', async () => {
        installNativeDecoder();

        const result = await runOperation('convert', fileOf(await source('jpeg'), 'photo.jpg', 'image/jpeg'), {
            format: 'avif',
            sourceWidth: WIDTH,
            sourceHeight: HEIGHT,
        });

        expect(result.verified).toBe(true);
        expect(result.checks.map((check) => check.key)).toEqual(['format', 'dimensions', 'alpha', 'decodes']);
        for (const check of result.checks) expect(check.ok).not.toBe(false);
    }, 60_000);

    it('makes no such claim about a JPEG output', async () => {
        installNativeDecoder();

        const result = await runOperation('convert', fileOf(await source('png'), 'photo.png', 'image/png'), {
            format: 'jpeg',
            sourceWidth: WIDTH,
            sourceHeight: HEIGHT,
        });

        expect(result.checks).toBeNull();
        expect(result.verified).toBeNull();
    }, 60_000);
});

/* ------------------------------------------------------------------ *
 * 2. Reading an AVIF
 * ------------------------------------------------------------------ */

describe('/convert from AVIF', () => {
    it.each(['jpeg', 'png', 'webp'])('turns an AVIF into a %s at the same size', async (format) => {
        installNativeDecoder();

        const result = await runOperation('convert', fileOf(await source('avif'), 'photo.avif', 'image/avif'), {
            format,
            sourceWidth: WIDTH,
            sourceHeight: HEIGHT,
        });

        const output = await inspect(result.blob);

        expect(result.sourceFormat).toBe('avif');
        expect(result.format).toBe(format);
        expect(output.sniffed).toBe(format);
        expect([output.width, output.height]).toEqual([WIDTH, HEIGHT]);
    }, 60_000);

    it('flattens a transparent AVIF onto white when the target has no alpha', async () => {
        installNativeDecoder();

        const result = await runOperation('convert', fileOf(await source('avif', { alpha: true }), 'logo.avif', 'image/avif'), {
            format: 'jpeg',
            sourceWidth: WIDTH,
            sourceHeight: HEIGHT,
        });

        const output = await inspect(result.blob);
        const [r, g, b] = output.pixelAt(2, 30);

        expect(result.transparent).toBe(true);
        expect(output.hasAlpha).toBe(false);
        expect(Math.min(r, g, b)).toBeGreaterThan(235);
    }, 60_000);

    it('keeps the transparency when the target carries it', async () => {
        installNativeDecoder();

        const result = await runOperation('convert', fileOf(await source('avif', { alpha: true }), 'logo.avif', 'image/avif'), {
            format: 'png',
            sourceWidth: WIDTH,
            sourceHeight: HEIGHT,
        });

        const output = await inspect(result.blob);

        expect(output.hasAlpha).toBe(true);
        expect(output.pixelAt(2, 30)[3]).toBe(0);
    }, 60_000);
});

/* ------------------------------------------------------------------ *
 * 3. /resize
 * ------------------------------------------------------------------ */

describe('/resize with AVIF', () => {
    it('accepts an AVIF and writes one back at the size asked for', async () => {
        installNativeDecoder();

        const result = await runOperation('resize', fileOf(await source('avif'), 'photo.avif', 'image/avif'), {
            width: 45,
            format: 'avif',
            sourceWidth: WIDTH,
            sourceHeight: HEIGHT,
        });

        const output = await inspect(result.blob);

        expect(output.sniffed).toBe('avif');
        expect([output.width, output.height]).toEqual([45, 30]);
        expect(result.verified).toBe(true);
    }, 60_000);

    it('verifies an AVIF it wrote from a JPEG source too', async () => {
        installNativeDecoder();

        const result = await runOperation('resize', fileOf(await source('jpeg'), 'photo.jpg', 'image/jpeg'), {
            scale: 50,
            format: 'avif',
            sourceWidth: WIDTH,
            sourceHeight: HEIGHT,
        });

        const output = await inspect(result.blob);

        expect([output.width, output.height]).toEqual([45, 30]);
        expect(result.checks.find((check) => check.key === 'dimensions').ok).toBe(true);
    }, 60_000);
});

/* ------------------------------------------------------------------ *
 * 4. What a 10-bit source becomes, and what the panel is told
 * ------------------------------------------------------------------ */

describe('a 10-bit AVIF', () => {
    /**
     * Every browser's decoder hands back 8-bit RGBA — measured in Chromium,
     * Firefox and WebKit on the same file — and so does the package's own
     * decoder. The depth is therefore not preserved and the result says so
     * rather than letting a person assume it was.
     */
    it('decodes to 8 bits, and the source depth is reported so the page can say so', async () => {
        installNativeDecoder();

        const tenBit = await sharp(pixels(), { raw: { width: WIDTH, height: HEIGHT, channels: 4 } })
            .avif({ quality: 60, bitdepth: 10 })
            .toBuffer();

        const result = await runOperation('convert', fileOf(tenBit, 'photo.avif', 'image/avif'), {
            format: 'jpeg',
            sourceWidth: WIDTH,
            sourceHeight: HEIGHT,
        });

        expect(result.sourceBitDepth).toBe(10);
        expect((await inspect(result.blob)).width).toBe(WIDTH);
    }, 60_000);

    it('reports 8 for an ordinary AVIF and nothing at all for a JPEG', async () => {
        installNativeDecoder();

        const fromAvif = await runOperation('convert', fileOf(await source('avif'), 'a.avif', 'image/avif'), {
            format: 'png', sourceWidth: WIDTH, sourceHeight: HEIGHT,
        });
        const fromJpeg = await runOperation('convert', fileOf(await source('jpeg'), 'a.jpg', 'image/jpeg'), {
            format: 'png', sourceWidth: WIDTH, sourceHeight: HEIGHT,
        });

        expect(fromAvif.sourceBitDepth).toBe(8);
        expect(fromJpeg.sourceBitDepth).toBeNull();
    }, 60_000);
});

/* ------------------------------------------------------------------ *
 * 5. The refusals
 * ------------------------------------------------------------------ */

describe('AVIF files this build will not process', () => {
    /**
     * Every engine decodes an animated AVIF's FIRST FRAME through
     * createImageBitmap and reports success, so a clip would come back as a
     * still and nobody would be told. The refusal reads the brand instead, and
     * happens before a decoder is asked for anything.
     */
    it('refuses an animated AVIF before it is decoded at all', async () => {
        let decodes = 0;
        installNativeDecoder();
        const real = globalThis.createImageBitmap;
        globalThis.createImageBitmap = async (...args) => { decodes += 1; return real(...args); };

        const still = await source('avif');
        const animated = Buffer.from(still);
        animated.write('avis', 8, 4, 'latin1');

        const error = await expectJobError(
            runOperation('convert', fileOf(animated, 'clip.avif', 'image/avif'), {
                format: 'jpeg', sourceWidth: WIDTH, sourceHeight: HEIGHT,
            }),
            { code: 'avif-animated' },
        );

        expect(error.message).toBe('Animated AVIF is not supported yet.');
        expect(decodes, 'the file reached a decoder before it was refused').toBe(0);
    }, 60_000);

    it('refuses an AVIF cut off partway through', async () => {
        installNativeDecoder();

        const truncated = (await source('avif')).subarray(0, 120);
        const error = await expectJobError(
            runOperation('convert', fileOf(truncated, 'half.avif', 'image/avif'), {
                format: 'jpeg', sourceWidth: WIDTH, sourceHeight: HEIGHT,
            }),
            { code: 'avif-damaged' },
        );

        expect(error.message).toBe('This AVIF file is damaged or incomplete and could not be read.');
    }, 60_000);

    /**
     * A browser with no AVIF decoder is told which versions have one. There is
     * no WASM fallback behind this on purpose: shipping 267 KB to decode 4x
     * slower than the platform would is a worse answer than a sentence.
     */
    it('names the browsers that can open one, when this one cannot', async () => {
        installNativeDecoder({ formats: ['jpeg', 'png', 'webp'] });

        const error = await expectJobError(
            runOperation('convert', fileOf(await source('avif'), 'photo.avif', 'image/avif'), {
                format: 'jpeg', sourceWidth: WIDTH, sourceHeight: HEIGHT,
            }),
            { code: 'avif-unsupported-browser' },
        );

        // The versions are in the MESSAGE rather than the suggestion, because
        // the tool panels render the message and only /passport-photo renders a
        // suggestion — so a version list left there would never be read on the
        // two pages an AVIF can actually reach.
        expect(error.message).toBe(
            'This browser cannot open AVIF images. '
            + 'Chrome 85, Firefox 93, and Safari 16 on iOS 16 or macOS Ventura and later can.',
        );
    }, 60_000);

    it('refuses an AVIF target on /compress, which has no way to hit a byte count', async () => {
        installNativeDecoder();

        const error = await expectJobError(
            runOperation('compress', fileOf(await source('jpeg'), 'photo.jpg', 'image/jpeg'), {
                format: 'avif', quality: 80, sourceWidth: WIDTH, sourceHeight: HEIGHT,
            }),
            { code: 'invalid-format' },
        );

        expect(error.message).not.toContain('avif');
    }, 60_000);

    it('refuses an AVIF on the tools that end at a form or a printer', async () => {
        installNativeDecoder();
        const file = fileOf(await source('avif'), 'photo.avif', 'image/avif');

        for (const operation of ['crop', 'signature', 'fit']) {
            await expectJobError(
                runOperation(operation, file, {
                    width: 40, height: 40, x: 0, y: 0, sourceWidth: WIDTH, sourceHeight: HEIGHT,
                }),
                { code: 'invalid-type' },
            );
        }
    }, 60_000);
});

/* ------------------------------------------------------------------ *
 * 6. An encoder that lied
 * ------------------------------------------------------------------ */

describe('output verification', () => {
    /**
     * The whole point of the check is the case nobody can construct by
     * accident: an encoder that hands back something other than what it was
     * asked for. Here the decode-back is made to fail, and the job refuses
     * rather than handing over a file it could not confirm.
     */
    it('refuses to report success on an AVIF the browser will not read back', async () => {
        installNativeDecoder();
        const real = globalThis.createImageBitmap;
        let decodes = 0;

        globalThis.createImageBitmap = async (...args) => {
            decodes += 1;
            // The source decode is the first call; the verification decode is
            // the one after the encode.
            if (decodes > 1) throw new Error('the bytes will not open');
            return real(...args);
        };

        const error = await expectJobError(
            runOperation('convert', fileOf(await source('jpeg'), 'photo.jpg', 'image/jpeg'), {
                format: 'avif', sourceWidth: WIDTH, sourceHeight: HEIGHT,
            }),
            { code: 'avif-encode-failed' },
        );

        expect(error.message).toBe('Resizo couldn’t encode this image as AVIF.');
    }, 60_000);

    /**
     * Where the browser cannot decode-back at all, the two header rows still
     * stand and the missing one is reported as unchecked rather than as a pass.
     */
    it('still verifies the header when there is no decoder to check the bytes with', async () => {
        const result = await runOperation('convert', fileOf(await source('png'), 'photo.png', 'image/png'), {
            format: 'avif',
            sourceWidth: WIDTH,
            sourceHeight: HEIGHT,
        });

        const decodes = result.checks.find((check) => check.key === 'decodes');

        expect(result.verified).toBe(true);
        expect(decodes.ok).toBeNull();
        expect(result.checks.find((check) => check.key === 'dimensions').ok).toBe(true);
    }, 60_000);
});

/* ------------------------------------------------------------------ *
 * 7. The gate, where it actually runs
 * ------------------------------------------------------------------ */

/**
 * The memory model knowing what an AVIF encode costs buys nothing unless the
 * number reaches the gate the job is actually refused by — which is the intake
 * one, before a single pixel buffer exists. On iOS an over-committed tab is
 * killed silently, so "refused with a sentence" and "the photo is gone" are the
 * two outcomes this is choosing between.
 */
describe('the memory gate, for a job that writes an AVIF', () => {
    const phone = { memoryGb: 2, cores: 4, ios: true, wasm: true, nativeDownscale: true };

    async function convertLargePhoto(format) {
        installNativeDecoder();
        const file = fileOf(await source('jpeg'), 'photo.jpg', 'image/jpeg');
        // A 12 MP photograph, measured at intake by the page as every tool does.
        return runOperation('convert', file, {
            format,
            sourceWidth: 4000,
            sourceHeight: 3000,
        }, { device: phone });
    }

    it('refuses a 12 MP AVIF on a phone, in words, before anything is allocated', async () => {
        const error = await expectJobError(convertLargePhoto('avif'), { code: 'not-enough-memory' });

        expect(error.message).toContain('megapixel');
        expect(error.suggestion).toBeTruthy();
    }, 60_000);

    it('lets the same photo through as a JPEG, which costs a fraction of it', async () => {
        await expect(convertLargePhoto('jpeg')).resolves.toMatchObject({ format: 'jpeg' });
    }, 60_000);
});
