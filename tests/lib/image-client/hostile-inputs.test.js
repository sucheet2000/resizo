/**
 * Hostile and degenerate inputs, driven end to end through the real engine.
 *
 * Every other engine suite feeds runOperation a well-formed picture and checks
 * the picture that comes back. This one feeds it the files a public tool
 * actually receives — a zero-byte placeholder from a failed AirDrop, a photo
 * cut off mid-download, a format that was dropped from every allowlist, a
 * header that lies about how big the image is — and checks that the REFUSAL is
 * as correct as the success: the right code, and a sentence a person can act on.
 *
 * Nothing is mocked. The codecs, the pixels and the encoded bytes are all real,
 * which is the only way a claim about what a decoder does with a broken file
 * means anything.
 *
 * WHAT IS DELIBERATELY NOT HERE
 *
 *  - A 20 MB buffer. The file gate reads `size` and never the bytes, so the cap
 *    is proved with an overridden `size` and a few hundred real bytes behind it.
 *    Allocating 20 MB per case would buy nothing but a slower suite.
 *  - An animated-GIF frame table, or a real AVIF. Both formats are refused on
 *    their magic bytes, before a decoder is ever asked, so a valid container is
 *    no stronger a fixture than a valid signature — and lib/image/magic-bytes.js
 *    already has the byte-level suite for the signatures themselves.
 */
import sharp from 'sharp';
import { beforeAll, describe, expect, it } from 'vitest';

import {
    MAX_FILE_SIZE,
    MAX_TARGET_BYTES,
    MIN_TARGET_BYTES,
} from '@/lib/constants';

import { installBrowserEnv } from './helpers/browser-env';
import { makeFile } from './helpers/fixtures';

let runOperation;
let JobError;

beforeAll(async () => {
    installBrowserEnv();
    ({ runOperation, JobError } = await import('@/lib/image-client/operations'));
});

/* ------------------------------------------------------------------ *
 * Fixtures
 * ------------------------------------------------------------------ */

const flat = (width, height, format = 'png') => sharp({
    create: { width, height, channels: 3, background: { r: 30, g: 140, b: 90 } },
})[format]().toBuffer();

function file(bytes, name, type, size) {
    return makeFile(bytes, { name, type, size });
}

/** The refusal, or a loud failure if the job unexpectedly succeeded. */
async function refusal(promise) {
    try {
        const result = await promise;
        throw new Error(`expected a refusal, got a ${result.format} of ${result.resultBytes} bytes`);
    } catch (error) {
        return error;
    }
}

/* ------------------------------------------------------------------ *
 * Nothing at all
 * ------------------------------------------------------------------ */

describe('a zero-byte file', () => {
    const empty = () => file(new Uint8Array(0), 'photo.jpg', 'image/jpeg');

    /**
     * A failed AirDrop and an interrupted download both leave one of these
     * behind, and it is the single most common broken upload a public tool
     * sees. Every op has to name it as empty rather than as "not an image":
     * the fix is different.
     */
    it.each([
        ['resize', { width: '100' }],
        ['crop', { x: '0', y: '0', width: '10', height: '10' }],
        ['compress', { quality: '80' }],
        ['convert', { format: 'png' }],
        ['heic', {}],
    ])('is refused by /%s as empty, in words that name the problem', async (op, options) => {
        const error = await refusal(runOperation(op, empty(), options));

        expect(error).toBeInstanceOf(JobError);
        expect(error.code).toBe('invalid-file');
        expect(error.message).toBe('The uploaded file is empty.');
        expect(error.suggestion).toBe('Images up to 20 MB are supported.');
    });

    it('is refused the same way when it is one page of a PDF', async () => {
        const error = await refusal(runOperation('pdf', [empty()], {}));

        expect(error.code).toBe('invalid-file');
        expect(error.message).toBe('The uploaded file is empty.');
    });

    it('refuses a PDF built from no images at all', async () => {
        const error = await refusal(runOperation('pdf', [], {}));

        expect(error.code).toBe('invalid-file');
        expect(error.message).toBe('No images were provided.');
    });
});

/* ------------------------------------------------------------------ *
 * The published size cap, walked
 * ------------------------------------------------------------------ */

describe('the 20 MB cap, at the value and one byte over', () => {
    it('accepts a file of exactly MAX_FILE_SIZE', async () => {
        const bytes = await flat(8, 8);
        const result = await runOperation(
            'convert',
            file(bytes, 'big.png', 'image/png', MAX_FILE_SIZE),
            { format: 'jpeg' },
        );

        expect(result.format).toBe('jpeg');
    });

    it('refuses one byte over it, and quotes the limit back', async () => {
        const bytes = await flat(8, 8);
        const error = await refusal(runOperation(
            'convert',
            file(bytes, 'big.png', 'image/png', MAX_FILE_SIZE + 1),
            { format: 'jpeg' },
        ));

        expect(error.code).toBe('invalid-file');
        expect(error.message).toMatch(/20MB/);
        expect(error.suggestion).toBe('Images up to 20 MB are supported.');
    });
});

/* ------------------------------------------------------------------ *
 * Degenerate geometry
 * ------------------------------------------------------------------ */

describe('images at the edges of what a picture can be', () => {
    it('converts a 1x1 image rather than treating it as broken', async () => {
        const result = await runOperation(
            'convert',
            file(await flat(1, 1), 'dot.png', 'image/png'),
            { format: 'jpeg' },
        );

        expect(result).toMatchObject({ format: 'jpeg', width: 1, height: 1 });
        expect(result.resultBytes).toBeGreaterThan(0);
    });

    it('crops a 1x1 image to itself', async () => {
        const result = await runOperation(
            'crop',
            file(await flat(1, 1), 'dot.png', 'image/png'),
            { x: '0', y: '0', width: '1', height: '1' },
        );

        expect(result).toMatchObject({ width: 1, height: 1 });
    });

    it('compresses a 1x1 image', async () => {
        const result = await runOperation(
            'compress',
            file(await flat(1, 1), 'dot.png', 'image/png'),
            { quality: '50' },
        );

        expect(result).toMatchObject({ width: 1, height: 1 });
    });

    /**
     * The `Math.max(1, …)` in deriveHeight, proved through the whole engine
     * rather than at the arithmetic. An 8000x1 panorama asked for width 4000
     * rounds its height to 0.5, and asking any resampler for a zero-height
     * surface is an error — so the floor has to hold all the way down.
     */
    it('keeps a 8000x1 panorama one pixel tall when it is halved', async () => {
        const result = await runOperation(
            'resize',
            file(await flat(8000, 1), 'pano.png', 'image/png'),
            { width: '4000', sourceWidth: 8000, sourceHeight: 1 },
        );

        expect(result).toMatchObject({ width: 4000, height: 1 });
    });

    it('keeps it one pixel tall at a 1 percent scale, where the maths rounds to zero', async () => {
        const result = await runOperation(
            'resize',
            file(await flat(8000, 1), 'pano.png', 'image/png'),
            { scale: '1', sourceWidth: 8000, sourceHeight: 1 },
        );

        expect(result).toMatchObject({ width: 80, height: 1 });
    });

    it('survives being shrunk to a single pixel', async () => {
        const result = await runOperation(
            'resize',
            file(await flat(8000, 1), 'pano.png', 'image/png'),
            { width: '1', sourceWidth: 8000, sourceHeight: 1 },
        );

        expect(result).toMatchObject({ width: 1, height: 1 });
    });

    /**
     * A source wider than MAX_DIMENSION cannot be re-encoded at its own size,
     * because the cap is on the OUTPUT and a plain conversion's output is the
     * source. The refusal has to say so before anything is decoded.
     */
    it('refuses to convert a source wider than the 8000 pixel output cap', async () => {
        const error = await refusal(runOperation(
            'convert',
            file(await flat(8, 8), 'wide.png', 'image/png'),
            { format: 'jpeg', sourceWidth: 10_000, sourceHeight: 1 },
        ));

        expect(error.code).toBe('output-too-large');
        expect(error.message).toBe('The output cannot be wider or taller than 8000 pixels.');
        expect(error.suggestion).toBe('Pick a size at or under 8000 pixels on the long side.');
    });
});

/* ------------------------------------------------------------------ *
 * Files that are not what they say they are
 * ------------------------------------------------------------------ */

describe('a file whose declared type contradicts its bytes', () => {
    /**
     * The declared MIME type is attacker-controlled and the signature is not,
     * so the signature decides — which is the order the server used too. A PNG
     * mislabelled as a JPEG is an ordinary Windows rename, and it must convert.
     */
    it('believes the magic bytes, not the label', async () => {
        const result = await runOperation(
            'convert',
            file(await flat(20, 10), 'lie.jpg', 'image/jpeg'),
            { format: 'webp' },
        );

        expect(result.sourceFormat).toBe('png');
        expect(result.format).toBe('webp');
        expect(result.width).toBe(20);
    });

    /**
     * The direction that matters for safety. A polyglot dressed as a JPEG got
     * an SVG to libvips once; here the signature is checked against the op's
     * own allowlist and nothing reaches a decoder.
     */
    it('refuses markup wearing a .jpg name and an image/jpeg type', async () => {
        const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
        const error = await refusal(runOperation(
            'convert',
            file(svg, 'polyglot.jpg', 'image/jpeg'),
            { format: 'png' },
        ));

        expect(error.code).toBe('invalid-type');
        expect(error.message).toBe(
            'File failed validation. Please upload a valid JPEG, PNG, or WebP image.',
        );
    });
});

/* ------------------------------------------------------------------ *
 * The two formats this build dropped
 * ------------------------------------------------------------------ */

describe('formats that left every allowlist', () => {
    /** GIF87a/GIF89a, the full six bytes lib/image/magic-bytes.js insists on. */
    const gif = () => {
        const bytes = new Uint8Array(64);
        bytes.set([0x47, 0x49, 0x46, 0x38, 0x39, 0x61], 0);
        return bytes;
    };

    /** An ftyp box with the `avif` brand at 8-11, which is the whole check. */
    const avif = () => {
        const bytes = new Uint8Array(64);
        bytes.set([0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66], 0);
        return bytes;
    };

    it('refuses an animated GIF cleanly, on the signature, before any decoder', async () => {
        const error = await refusal(runOperation(
            'resize',
            file(gif(), 'animation.gif', 'image/gif'),
            { width: '100', sourceWidth: 200, sourceHeight: 200 },
        ));

        expect(error).toBeInstanceOf(JobError);
        expect(error.code).toBe('invalid-type');
        expect(error.message).toBe('File failed validation. Please upload a valid image.');
    });

    it('refuses an AVIF with the sentence that lists what /convert does take', async () => {
        const error = await refusal(runOperation(
            'convert',
            file(avif(), 'photo.avif', 'image/avif'),
            { format: 'jpeg' },
        ));

        expect(error.code).toBe('invalid-type');
        expect(error.message).toBe(
            'File failed validation. Please upload a valid JPEG, PNG, or WebP image.',
        );
    });

    it('refuses an AVIF page of a PDF, in that tool’s own longer list', async () => {
        const error = await refusal(runOperation('pdf', [file(avif(), 'photo.avif', 'image/avif')], {}));

        expect(error.code).toBe('invalid-type');
        expect(error.message).toBe(
            'File failed validation. Please add a valid JPEG, PNG, WebP, or HEIC image.',
        );
    });
});

/* ------------------------------------------------------------------ *
 * Broken pixel data behind a valid header
 * ------------------------------------------------------------------ */

describe('a JPEG cut off mid-scan', () => {
    /** Noise, so the entropy-coded scan is long enough to be cut in the middle. */
    async function truncatedNoise(fraction) {
        const pixels = Buffer.alloc(200 * 200 * 3);
        let state = 7;
        for (let index = 0; index < pixels.length; index += 1) {
            state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
            pixels[index] = (state >>> 16) & 0xFF;
        }
        const full = await sharp(pixels, { raw: { width: 200, height: 200, channels: 3 } })
            .jpeg({ quality: 90 })
            .toBuffer();
        return full.subarray(0, Math.floor(full.length * fraction));
    }

    /**
     * MozJPEG is error-resilient by design: a scan that stops early leaves the
     * rest of the frame grey rather than failing. That is the RIGHT outcome for
     * a photo the user half-downloaded — a picture with a grey bottom is
     * recoverable, an error is not — and what matters is that the header's
     * dimensions are still honoured and no raw codec error escapes.
     */
    it('returns the partial picture at its declared size rather than failing', async () => {
        const result = await runOperation(
            'convert',
            file(await truncatedNoise(0.5), 'cut.jpg', 'image/jpeg'),
            { format: 'png' },
        );

        expect(result).toMatchObject({ format: 'png', width: 200, height: 200 });
        expect(result.resultBytes).toBeGreaterThan(0);
    });

    it('still decodes at one percent of the file, which is why the grey-fill case is the normal one', async () => {
        const result = await runOperation(
            'convert',
            file(await truncatedNoise(0.01), 'cut.jpg', 'image/jpeg'),
            { format: 'png' },
        );

        expect(result).toMatchObject({ width: 200, height: 200 });
    });

    /**
     * KNOWN HOLE, PINNED DELIBERATELY.
     *
     * Cut to the first few hundred bytes there is no frame header left, and
     * MozJPEG calls emscripten's `exit()`. What comes out is an `ExitStatus` —
     * a PLAIN OBJECT, not an Error — carrying `message: 'Program terminated
     * with exit(1)'`. It is 30 characters on one line, so the worker's
     * sanitiser judges it readable and shows it to the visitor verbatim
     * (see worker-protocol.test.js), and lib/upload/process-file.js writes the
     * same string into a bulk failure row.
     *
     * A half-downloaded photo is the second most common broken upload there is,
     * after a zero-byte one. Recorded here rather than corrected, because the
     * fix is a decision about what sentence to show instead.
     */
    it('KNOWN HOLE — throws an emscripten ExitStatus that is not even an Error', async () => {
        const error = await refusal(runOperation(
            'convert',
            file(await truncatedNoise(0.002), 'stub.jpg', 'image/jpeg'),
            { format: 'png' },
        ));

        expect(error).not.toBeInstanceOf(JobError);
        expect(error).not.toBeInstanceOf(Error);
        expect(error.name).toBe('ExitStatus');
        expect(error.code).toBeUndefined();
        // The string the worker's sanitiser would hand a visitor unchanged:
        // short, single-line, and meaningless to anybody outside emscripten.
        expect(error.message).toBe('Program terminated with exit(1)');
    });

    /**
     * The reassuring half of the same finding, and worth pinning on its own:
     * the codec loader memoises the decoder for the whole session, so an
     * emscripten exit inside it could plausibly have left every later job in
     * the tab broken. It does not.
     */
    it('leaves the memoised decoder usable for the next file', async () => {
        await refusal(runOperation(
            'convert',
            file(await truncatedNoise(0.002), 'stub.jpg', 'image/jpeg'),
            { format: 'png' },
        ));

        const result = await runOperation(
            'convert',
            file(await truncatedNoise(1), 'whole.jpg', 'image/jpeg'),
            { format: 'png' },
        );

        expect(result).toMatchObject({ width: 200, height: 200 });
    });
});

describe('a PNG whose header claims far more pixels than it carries', () => {
    /** IHDR width and height live at bytes 16-23; the image data does not change. */
    async function bomb() {
        const png = Buffer.from(await flat(4, 4));
        png.writeUInt32BE(30_000, 16);
        png.writeUInt32BE(30_000, 20);
        return png;
    }

    /**
     * 30000x30000 is 900 megapixels — 3.6 GB of RGBA. When the page has
     * measured the image (which it has for every tool but /heic), the gate
     * refuses it before a single buffer is allocated, and says the real number.
     */
    it('is refused on the pixel count when the dimensions reached the gate', async () => {
        const error = await refusal(runOperation(
            'convert',
            file(await bomb(), 'bomb.png', 'image/png'),
            { format: 'jpeg', sourceWidth: 30_000, sourceHeight: 30_000 },
        ));

        expect(error).toBeInstanceOf(JobError);
        expect(error.code).toBe('source-too-large');
        expect(error.message).toBe(
            'This image is 900 megapixels, which is past the 80 megapixel limit for processing in a browser tab.',
        );
        expect(error.suggestion).toBe('Scale it down in a desktop app first, then bring it back here.');
    });

    /**
     * KNOWN HOLE, PINNED DELIBERATELY.
     *
     * With no measured dimensions the gate can only check the file, so the
     * decoder is reached first — and @jsquash/png traps inside WebAssembly
     * rather than returning an error. What escapes is a bare `RuntimeError:
     * unreachable`, which is NOT a JobError, so it carries no code and no
     * suggestion, and the worker's sanitiser passes its one short line straight
     * to the visitor (see worker-protocol.test.js).
     *
     * This is recorded rather than asserted-as-correct. The engine's own
     * contract says nothing allocates before the gate has spoken; here the
     * decode is the allocation and it speaks first. Closing it is a decision
     * about where to read a declared size from, which is not a change to make
     * inside a test pass.
     */
    it('KNOWN HOLE — traps in the decoder when no dimensions reached the gate', async () => {
        const error = await refusal(runOperation(
            'convert',
            file(await bomb(), 'bomb.png', 'image/png'),
            { format: 'jpeg' },
        ));

        expect(error).not.toBeInstanceOf(JobError);
        expect(error.code).toBeUndefined();
        expect(error.message).toBe('unreachable');
    });
});

/* ------------------------------------------------------------------ *
 * The byte target, walked at its bounds
 * ------------------------------------------------------------------ */

describe('the exact-size target, at the value and one outside it', () => {
    const RANGE_ERROR = 'Target size must be a whole number of bytes between 10 KB and 20 MB.';

    async function compressTo(targetBytes) {
        return runOperation(
            'compress',
            file(await flat(120, 120, 'jpeg'), 'photo.jpg', 'image/jpeg'),
            { targetBytes },
        );
    }

    it('accepts a target of exactly MIN_TARGET_BYTES', async () => {
        const result = await compressTo(String(MIN_TARGET_BYTES));

        expect(result.targetBytes).toBe(MIN_TARGET_BYTES);
        expect(result.resultBytes).toBeLessThanOrEqual(MIN_TARGET_BYTES);
    });

    it('refuses one byte under it, quoting the range in kilobytes and megabytes', async () => {
        const error = await refusal(compressTo(String(MIN_TARGET_BYTES - 1)));

        expect(error.code).toBe('invalid-target');
        expect(error.message).toBe(RANGE_ERROR);
    });

    it('accepts a target of exactly MAX_TARGET_BYTES', async () => {
        const result = await compressTo(String(MAX_TARGET_BYTES));

        expect(result.targetBytes).toBe(MAX_TARGET_BYTES);
    });

    it('refuses one byte over it', async () => {
        const error = await refusal(compressTo(String(MAX_TARGET_BYTES + 1)));

        expect(error.code).toBe('invalid-target');
        expect(error.message).toBe(RANGE_ERROR);
    });

    it.each([
        ['a decimal', '10240.5'],
        ['scientific notation', '1e5'],
        ['a negative', '-20000'],
        ['words', 'about 100 KB'],
        ['an empty string', ''],
    ])('refuses %s rather than coercing it', async (_label, raw) => {
        const error = await refusal(compressTo(raw));

        expect(error.code).toBe('invalid-target');
        expect(error.message).toBe(RANGE_ERROR);
    });
});

/* ------------------------------------------------------------------ *
 * A rectangle that is not a rectangle
 * ------------------------------------------------------------------ */

describe('crop parameters that cannot be honoured', () => {
    const square = async () => file(await flat(40, 40), 'square.png', 'image/png');

    it('refuses a rectangle that hangs off the edge, against the measured size', async () => {
        const error = await refusal(runOperation('crop', await square(), {
            x: '0', y: '0', width: '99', height: '99', sourceWidth: 40, sourceHeight: 40,
        }));

        expect(error.code).toBe('invalid-crop');
        expect(error.message).toBe(
            'Crop parameters are out of bounds of the original image dimensions.',
        );
    });

    /**
     * The second check, against the size the DECODER produced. `n > undefined`
     * is false, so a page that measured nothing used to let an unbounded slice
     * through — this is the branch that catches it after the decode instead.
     */
    it('refuses it again against the decoded size when the page measured nothing', async () => {
        const error = await refusal(runOperation('crop', await square(), {
            x: '0', y: '0', width: '99', height: '99',
        }));

        expect(error.code).toBe('invalid-crop');
        expect(error.message).toBe(
            'Crop parameters are out of bounds of the original image dimensions.',
        );
    });

    it.each([
        ['a zero-width rectangle', { x: '0', y: '0', width: '0', height: '10' }],
        ['a zero-height rectangle', { x: '0', y: '0', width: '10', height: '0' }],
        ['a negative origin', { x: '-5', y: '0', width: '10', height: '10' }],
        ['a fractional side', { x: '0', y: '0', width: '10.5', height: '10' }],
    ])('refuses %s as malformed, which is a different complaint from out of bounds', async (_label, options) => {
        const error = await refusal(runOperation('crop', await square(), options));

        expect(error.code).toBe('invalid-crop');
        expect(error.message).toBe('Invalid crop parameters provided.');
    });

    /**
     * A third complaint, and the parser is right to keep it separate: a field
     * that never arrived is a different fix from one that arrived wrong, and
     * the sentence names the four fields so a caller can see which is missing.
     */
    it('names the fields when one of the four never arrived', async () => {
        const error = await refusal(runOperation('crop', await square(), { x: '0', y: '0', width: '10' }));

        expect(error.code).toBe('invalid-crop');
        expect(error.message).toBe(
            'Missing crop parameters (crop_x, crop_y, crop_width, crop_height).',
        );
    });
});

/* ------------------------------------------------------------------ *
 * An op that does not exist
 * ------------------------------------------------------------------ */

describe('an operation the registry has never heard of', () => {
    it('is named in the refusal rather than falling through to a default', async () => {
        const error = await refusal(runOperation(
            'rotate',
            file(await flat(4, 4), 'a.png', 'image/png'),
            {},
        ));

        expect(error).toBeInstanceOf(JobError);
        expect(error.code).toBe('unknown-operation');
        expect(error.message).toBe('Unknown operation: rotate.');
    });

    it('refuses before it reads a single byte of the file', async () => {
        const error = await refusal(runOperation('rotate', file(new Uint8Array(0), 'a.png', 'image/png'), {}));

        expect(error.code).toBe('unknown-operation');
    });
});
