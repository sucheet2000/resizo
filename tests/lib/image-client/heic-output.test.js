/**
 * What /heic is allowed to write.
 *
 * The tool has always answered in JPEG, because /heic-to-jpg is what people
 * search for and a camera HEIC has no transparency to lose. /heic-to-png is the
 * other half of the same intent, and it is not the same job: PNG carries alpha,
 * so the flatten that JPEG needs would be destroying information for nothing,
 * and PNG has no quality dial for the 90 the JPEG lane uses.
 *
 * WHY THE DECODER IS FAKED HERE AND NOWHERE ELSE
 *
 * libheif-js ships no AV1 decoder, and sharp's prebuilt libvips can only WRITE
 * HEIF with AV1 payloads — there is no HEVC encoder to build a fixture with. So
 * no decodable HEIC fixture can exist in this repo. The container below is
 * real: written by libvips, sniffed by the real magic-byte reader, and its
 * dimensions read out of a real `ispe` box by the real libheif. Only the
 * pixel-producing call is stood in for, exactly as heic-gate.test.js does it,
 * and everything downstream of it — the flatten decision, the encoder, the
 * bytes — is the real engine.
 */
import sharp from 'sharp';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { HEIC_OUTPUT_FORMATS } from '@/lib/limits';
import { installBrowserEnv } from './helpers/browser-env';
import { heifDeclaring, makeFile } from './helpers/fixtures';

let runOperation;
let JobError;
let HEIC_JPEG_QUALITY;
let codecs;

beforeAll(async () => {
    installBrowserEnv();
    ({ runOperation, JobError, HEIC_JPEG_QUALITY } = await import('@/lib/image-client/operations'));
    codecs = await import('@/lib/image-client/codecs');
});

const WIDTH = 64;
const HEIGHT = 48;

/**
 * A libheif stand-in that hands back a KNOWN picture: a fully transparent
 * 16x16 top-left corner on an opaque crimson field. The transparent corner is
 * the whole point — it is what tells the two output lanes apart.
 *
 * A CORNER RATHER THAN A PIXEL, because JPEG transforms 8x8 blocks: a single
 * transparent pixel surrounded by crimson comes back smeared toward crimson
 * (measured: 231 where the fill was 255), and a test written on one pixel would
 * be measuring the DCT rather than the flatten.
 */
const CLEAR_CORNER = 16;

function fakeLibheif() {
    return {
        HeifDecoder: class {
            decode() {
                return [{
                    get_width: () => WIDTH,
                    get_height: () => HEIGHT,
                    display: (target, callback) => {
                        for (let y = 0; y < HEIGHT; y += 1) {
                            for (let x = 0; x < WIDTH; x += 1) {
                                const offset = (y * WIDTH + x) * 4;
                                target.data[offset] = 220;
                                target.data[offset + 1] = 20;
                                target.data[offset + 2] = 60;
                                target.data[offset + 3] = (x < CLEAR_CORNER && y < CLEAR_CORNER) ? 0 : 255;
                            }
                        }
                        setTimeout(() => callback(target), 0);
                    },
                    free: () => {},
                }];
            }
        },
    };
}

async function convertHeic(options) {
    vi.spyOn(codecs, 'loadHeifDecoder').mockResolvedValue(fakeLibheif());
    const bytes = await heifDeclaring({ width: WIDTH, height: HEIGHT });
    return runOperation('heic', makeFile(bytes, { name: 'IMG_0042.heic', type: 'image/heic' }), options);
}

/** The top-left pixel of an output, as sharp reads it back. */
async function cornerOf(blob) {
    const buffer = Buffer.from(await blob.arrayBuffer());
    const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    return { pixel: Array.from(data.slice(0, 4)), channels: info.channels, format: (await sharp(buffer).metadata()).format };
}

describe('the default lane is unchanged', () => {
    it('writes a JPEG at the quality heic-convert used, with no format asked for', async () => {
        const result = await convertHeic({});

        expect(result.format).toBe('jpeg');
        expect(result.type).toBe('image/jpeg');
        expect(result.quality).toBe(HEIC_JPEG_QUALITY);
        expect(result.qualityApplied).toBe(true);
        expect({ width: result.width, height: result.height }).toEqual({ width: WIDTH, height: HEIGHT });
    });

    it('flattens the transparent pixel onto the background rather than ignoring the alpha byte', async () => {
        const result = await convertHeic({});
        const { pixel, format } = await cornerOf(result.blob);

        expect(format).toBe('jpeg');
        // White, the engine's default — /heic sends no background of its own,
        // so this is the fallback in flatten.js reaching the pixels. The clear
        // corner hides crimson under its alpha byte, so MozJPEG left alone
        // would have written 220,20,60 here and not this.
        expect(pixel[0]).toBeGreaterThan(235);
        expect(pixel[1]).toBeGreaterThan(235);
        expect(pixel[2]).toBeGreaterThan(235);
    });

    it('still honours an explicitly chosen background', async () => {
        const result = await convertHeic({ background: 'black' });
        const { pixel } = await cornerOf(result.blob);

        expect(pixel[0]).toBeLessThan(20);
        expect(pixel[1]).toBeLessThan(20);
        expect(pixel[2]).toBeLessThan(20);
    });

    it('accepts the format spelled out', async () => {
        expect((await convertHeic({ format: 'jpeg' })).format).toBe('jpeg');
        expect((await convertHeic({ format: 'jpg' })).format).toBe('jpeg');
    });

    // A select the visitor never touched posts an empty string, and that is
    // "not supplied" everywhere else in this engine. Refusing it would break a
    // page for a field nobody filled in.
    it('treats a blank field as no choice at all', async () => {
        expect((await convertHeic({ format: '' })).format).toBe('jpeg');
        expect((await convertHeic({ format: '  ' })).format).toBe('jpeg');
    });
});

describe('the PNG lane', () => {
    it('writes a PNG and keeps the transparency instead of filling it in', async () => {
        const result = await convertHeic({ format: 'png' });

        expect(result.format).toBe('png');
        expect(result.type).toBe('image/png');
        expect({ width: result.width, height: result.height }).toEqual({ width: WIDTH, height: HEIGHT });

        const { pixel, format } = await cornerOf(result.blob);
        expect(format).toBe('png');
        expect(pixel[3]).toBe(0);
    });

    it('reports that no quality dial was turned, because this encoder has none', async () => {
        const result = await convertHeic({ format: 'png' });

        expect(result.qualityApplied).toBe(false);
    });

    it('ignores a background it was given, since nothing is being filled in', async () => {
        const result = await convertHeic({ format: 'png', background: 'white' });
        const { pixel } = await cornerOf(result.blob);

        expect(pixel[3]).toBe(0);
    });
});

describe('a format /heic cannot write', () => {
    it.each([['webp'], ['avif'], ['gif'], ['pdf'], ['jpeg png']])('refuses %o by name', async (format) => {
        const error = await convertHeic({ format }).then(
            (result) => { throw new Error(`expected a refusal, got ${result.format}`); },
            (thrown) => thrown,
        );

        expect(error).toBeInstanceOf(JobError);
        expect(error.code).toBe('invalid-format');
        // Naming the two it CAN write is the difference between a dead end and
        // a next step.
        for (const allowed of HEIC_OUTPUT_FORMATS) {
            expect(error.message).toContain(allowed);
        }
    });
});
