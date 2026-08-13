/**
 * Metamorphic Relations
 *
 * Every other suite in this directory asks the same kind of question: given
 * THIS input, is THAT the output? That question can only be asked where the
 * right answer is already known, which is why the example tests, the hostile
 * corpus and the mutation pass all stop at the edge of the codecs. Nobody knows
 * what the correct 4127th byte of a lanczos3 downscale is.
 *
 * This file asks a different kind of question, one that needs no known answer:
 * given two DIFFERENT runs of the engine, must their outputs be related? Turn
 * an image by nothing and it must come back untouched. Turn it one way and then
 * back and it must be the original, to the byte. Crop a crop and it must equal
 * the one combined crop. Ask for a lower quality and the file must not grow.
 * None of those need an oracle — the outputs check each other.
 *
 * WHY THIS IS WORTH A FILE OF ITS OWN
 *
 * Pillow, with a vastly larger example suite than this one, shipped a
 * half-pixel coordinate error for years: rotating by ZERO degrees with bilinear
 * resampling visibly blurred the picture. No example test caught it, because
 * nobody had a blurred reference image to compare against and the output was
 * plausible at every size. It was found and fixed by exactly the relations
 * below — exact equality where a transform is lossless, a measured pixel
 * tolerance where it is not.
 *
 * We have the same shape of bug available to us, and one of these tests
 * demonstrates that we are one line away from it: @jsquash/resize's lanczos3
 * asked to resample 64x48 TO 64x48 does not return the input. Measured, on the
 * binary this repo serves: 0.349 mean absolute error per channel, peak 1. The
 * only reason a resize-to-the-same-size is lossless here is the early return in
 * resizeImageData, and the test below is what stops that line being deleted as
 * a redundant micro-optimisation.
 *
 * WHERE A RELATION IS EXACT AND WHERE IT IS NOT
 *
 * Orientation and crop move whole pixels: those relations are asserted as BYTE
 * EQUALITY, with no tolerance at all. Resampling and lossy encoding do not:
 * those carry a tolerance taken from measurement, written down next to the
 * number it came from, along with what a real regression would have measured
 * so a future reader can see the tolerance is not merely "whatever passed".
 *
 * TWO RELATIONS DO NOT HOLD, AND ARE PINNED AS THE DEFECTS THEY ARE
 *
 * MozJPEG in this build makes a SMALLER file at quality 70 than at quality 69,
 * on every photograph-like picture tried. lib/image-client/target-bytes.js
 * states monotonicity as the assumption its binary search rests on, and the
 * search does measurably return a worse answer because of it. Both are recorded
 * here in the style hostile-inputs.test.js already uses for a known hole:
 * asserted as they are, so the day they change, a test says so.
 */
import { beforeAll, describe, expect, it } from 'vitest';

import { installBrowserEnv } from './helpers/browser-env';
import { gradientImageData, makeImageData, splitRedBluePng } from './helpers/fixtures';

let applyOrientation;
let cropImageData;
let decodeToImageData;
let encodeImageData;
let resizeImageData;
let searchQuality;
let searchScale;

beforeAll(async () => {
    installBrowserEnv();
    ({ applyOrientation } = await import('@/lib/image-client/orientation'));
    ({ cropImageData } = await import('@/lib/image-client/crop'));
    ({ decodeToImageData } = await import('@/lib/image-client/decode'));
    ({ encodeImageData } = await import('@/lib/image-client/encode'));
    ({ resizeImageData } = await import('@/lib/image-client/resize'));
    ({ searchQuality, searchScale } = await import('@/lib/image-client/target-bytes'));
});

/* ------------------------------------------------------------------ *
 * Comparing two images
 * ------------------------------------------------------------------ */

/**
 * Byte equality, with a failure message that names the first pixel that differs
 * rather than printing two arrays of a hundred thousand numbers at the reader.
 */
function expectIdenticalPixels(actual, expected) {
    expect([actual.width, actual.height]).toEqual([expected.width, expected.height]);

    for (let index = 0; index < expected.data.length; index += 1) {
        if (actual.data[index] !== expected.data[index]) {
            const pixel = Math.floor(index / 4);
            const channel = 'rgba'[index % 4];
            throw new Error(
                `pixels differ at (${pixel % expected.width}, ${Math.floor(pixel / expected.width)}) `
                + `channel ${channel}: got ${actual.data[index]}, expected ${expected.data[index]}`,
            );
        }
    }
}

/** Mean absolute difference per channel, on the 0-255 scale. */
function meanAbsoluteError(a, b) {
    let total = 0;
    for (let index = 0; index < a.data.length; index += 1) {
        total += Math.abs(a.data[index] - b.data[index]);
    }
    return total / a.data.length;
}

/* ------------------------------------------------------------------ *
 * Fixtures
 * ------------------------------------------------------------------ */

/**
 * A picture with structure in both axes and in all three channels, at a
 * frequency a camera actually produces. Flat colour and pure noise are both
 * useless here: flat colour survives any transform, and noise survives none.
 */
function photoish(width, height) {
    return makeImageData(width, height, (x, y) => [
        Math.round(128 + 100 * Math.sin((x / width) * Math.PI * 2)),
        Math.round(128 + 100 * Math.sin((y / height) * Math.PI * 3)),
        Math.round(128 + 100 * Math.cos(((x + y) / (width + height)) * Math.PI * 4)),
        255,
    ]);
}

/** Lower-frequency, more like a real photograph's smooth regions. */
function blobs(width, height) {
    return makeImageData(width, height, (x, y) => {
        const u = x / width;
        const v = y / height;
        return [
            Math.round(128 + 90 * Math.sin(6 * u + 2 * v) * Math.cos(3 * v)),
            Math.round(128 + 90 * Math.sin(4 * v - u) * Math.cos(5 * u)),
            Math.round(128 + 90 * Math.cos(3 * u + 4 * v)),
            255,
        ];
    });
}

/** Every pixel distinct, so a transform that loses or duplicates one shows. */
function countedPixels(width, height) {
    return makeImageData(width, height, (x, y) => {
        const index = y * width + x;
        return [(index * 7) % 256, (index * 13) % 256, (index * 29) % 256, 255];
    });
}

/**
 * The same picture shifted half a pixel to the right, by the cheapest filter
 * there is. This is not an input to the engine — it is the YARDSTICK for the
 * resampling tolerances below: it is roughly what the Pillow bug did to an
 * image, so a tolerance worth having must sit under what this measures.
 */
function shiftedHalfAPixel(image) {
    return makeImageData(image.width, image.height, (x, y) => {
        const right = Math.min(image.width - 1, x + 1);
        const here = (y * image.width + x) * 4;
        const there = (y * image.width + right) * 4;
        return [0, 1, 2, 3].map((channel) => Math.round(
            (image.data[here + channel] + image.data[there + channel]) / 2,
        ));
    });
}

/* ------------------------------------------------------------------ *
 * Orientation: the identity, and the group it belongs to
 * ------------------------------------------------------------------ */

describe('applying an EXIF orientation that asks for no turn', () => {
    /**
     * THE PILLOW BUG, IN OUR OWN SHAPE. `rotate(0)` blurred the image because
     * the identity was implemented as a resample rather than as nothing at all.
     * Orientation 1 is on the overwhelming majority of files this site ever
     * sees, so a turn that costs anything here costs it almost every time.
     *
     * Byte equality, and identity of the object as well: applyOrientation
     * documents that it hands the same ImageData straight back, which is what
     * makes the common case allocate nothing, and an implementation that
     * quietly started copying would still pass a pixel comparison.
     */
    it('returns the very same pixels, not a copy of them', () => {
        const source = countedPixels(9, 7);
        const turned = applyOrientation(source, 1);

        expect(turned).toBe(source);
        expectIdenticalPixels(turned, source);
    });

    /**
     * A file whose Orientation tag is missing, out of range or unreadable is
     * treated as 1 by readExifOrientation. That decision is only safe if 1
     * really does nothing, so the same equality is asserted for every value
     * that normalises to it.
     */
    it.each([
        ['zero', 0],
        ['nine', 9],
        ['a fraction', 6.5],
        ['null', null],
        ['a string', '6'],
    ])('does nothing for %s either, which is what makes it safe to default to', (_label, tag) => {
        const source = countedPixels(9, 7);

        expect(applyOrientation(source, tag)).toBe(source);
    });
});

describe('the eight EXIF orientations compose the way the square says they do', () => {
    /**
     * The eight tags are the eight symmetries of a rectangle — four rotations
     * and four reflections, the dihedral group of order eight. That is not a
     * decoration: it means every pair of them composes to a THIRD one, and the
     * whole 8x8 table is fixed by the definitions in the EXIF specification
     * before a line of this engine is written.
     *
     * The table below is written out from those definitions, not read back out
     * of lib/image-client/orientation.js, which is what makes it an oracle
     * rather than a mirror. Row = the tag applied first, column = the tag
     * applied to the result, cell = the single tag that does both.
     *
     *   1 identity   2 mirror L-R   3 half turn        4 mirror T-B
     *   5 transpose  6 quarter CW   7 anti-transpose   8 quarter CCW
     *
     * Every entry is checked in pixels against a real double application, so a
     * single wrong destination in DESTINATION cannot survive: it would have to
     * be wrong consistently across sixty-four compositions AND still land on
     * one of the other seven transforms exactly.
     */
    const COMPOSITION = {
        1: { 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7, 8: 8 },
        2: { 1: 2, 2: 1, 3: 4, 4: 3, 5: 8, 6: 7, 7: 6, 8: 5 },
        3: { 1: 3, 2: 4, 3: 1, 4: 2, 5: 7, 6: 8, 7: 5, 8: 6 },
        4: { 1: 4, 2: 3, 3: 2, 4: 1, 5: 6, 6: 5, 7: 8, 8: 7 },
        5: { 1: 5, 2: 6, 3: 7, 4: 8, 5: 1, 6: 2, 7: 3, 8: 4 },
        6: { 1: 6, 2: 5, 3: 8, 4: 7, 5: 4, 6: 3, 7: 2, 8: 1 },
        7: { 1: 7, 2: 8, 3: 5, 4: 6, 5: 3, 6: 4, 7: 1, 8: 2 },
        8: { 1: 8, 2: 7, 3: 6, 4: 5, 5: 2, 6: 1, 7: 4, 8: 3 },
    };

    /** Non-square and both sides odd, so an axis swap cannot hide in the shape. */
    const source = () => countedPixels(7, 5);

    const TAGS = [1, 2, 3, 4, 5, 6, 7, 8];

    it.each(TAGS)('composes orientation %i with each of the eight into a single tag', (first) => {
        const start = source();

        for (const second of TAGS) {
            const composed = applyOrientation(applyOrientation(start, first), second);
            const single = applyOrientation(start, COMPOSITION[first][second]);

            expectIdenticalPixels(composed, single);
        }
    });

    /**
     * The diagonal of the table above, stated on its own because it is the
     * relation a person can check without the table: every turn has an undo,
     * and the undo returns the original file to the byte. 6 and 8 are each
     * other's; the other six are their own.
     */
    const INVERSE = { 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 8, 7: 7, 8: 6 };

    it.each(TAGS)('undoes orientation %i exactly, with no drift at all', (tag) => {
        const start = source();
        const there = applyOrientation(start, tag);
        const back = applyOrientation(there, INVERSE[tag]);

        expectIdenticalPixels(back, start);
    });

    /** The shape has to come back too, not only the pixel values. */
    it.each(TAGS)('swaps the axes back as well for orientation %i', (tag) => {
        const start = source();
        const there = applyOrientation(start, tag);

        if (tag >= 5) {
            expect([there.width, there.height]).toEqual([start.height, start.width]);
        } else {
            expect([there.width, there.height]).toEqual([start.width, start.height]);
        }
    });
});

/* ------------------------------------------------------------------ *
 * Resampling
 * ------------------------------------------------------------------ */

describe('resampling an image to the size it already is', () => {
    /**
     * THE OTHER HALF OF THE PILLOW BUG, AND IT IS LIVE.
     *
     * @jsquash/resize's lanczos3 is NOT the identity at a 1:1 ratio. Measured
     * against the binary in public/wasm, asking it for 64x48 from a 64x48
     * photoish fixture: mean absolute error 0.349 per channel, peak deviation
     * 1. That is the sRGB-to-linear round trip rounding, and it is exactly the
     * kind of invisible-per-pixel, visible-in-aggregate softening that took
     * Pillow years to notice.
     *
     * The engine never pays it, because resizeImageData returns early when the
     * dimensions already match. This test is that early return's only guard: it
     * looks like a redundant micro-optimisation and it is not one.
     */
    it('returns the input untouched rather than putting it through the resampler', async () => {
        const source = photoish(64, 48);
        const result = await resizeImageData(source, { width: 64, height: 48 });

        expect(result.data).toBe(source);
        expectIdenticalPixels(result.data, source);
    });
});

describe('a resize and its opposite', () => {
    /**
     * WHERE THESE NUMBERS COME FROM, AND WHY THEY ARE NOT LOOSER.
     *
     * A round trip through lanczos3 cannot be exact — the pixels are quantised
     * to eight bits twice and converted through linear light twice — so this is
     * the one place a tolerance is right. Measured on the fixtures below, at
     * factors 2 and 3, on the binaries this repo serves:
     *
     *   up then back down     0.745 - 0.752 mean absolute error per channel
     *   down then back up     0.689 - 0.790
     *
     * The floor is the same 0.35-per-pass gamma rounding the 1:1 test above
     * measures, paid twice; the rest is the detail a downscale genuinely throws
     * away. The spread across three different pictures and two different
     * factors is under a tenth of a unit, so this is a stable number and not a
     * lucky one.
     *
     * THE TOLERANCE IS 0.85, and it is chosen against a regression rather than
     * against the measurement. Shifting this same fixture half a pixel — which
     * is what the Pillow bug did — measures 0.888. So a tolerance of 0.85 sits
     * above every measured round trip and below the smallest geometric error
     * worth catching. Raising it past 0.888 would make this test unable to see
     * the exact bug it exists for. Do not raise it.
     */
    const ROUND_TRIP_TOLERANCE = 0.85;

    it('is a yardstick, not a guess: half a pixel of shift costs more than the tolerance', () => {
        const source = photoish(120, 90);

        expect(meanAbsoluteError(source, shiftedHalfAPixel(source))).toBeGreaterThan(ROUND_TRIP_TOLERANCE);
    });

    it.each([2, 3])('comes back within tolerance after going up %ix and back down', async (factor) => {
        const source = photoish(120, 90);

        const up = await resizeImageData(source, {
            width: source.width * factor,
            height: source.height * factor,
        });
        const back = await resizeImageData(up.data, { width: source.width, height: source.height });

        expect([back.width, back.height]).toEqual([source.width, source.height]);
        expect(meanAbsoluteError(source, back.data)).toBeLessThan(ROUND_TRIP_TOLERANCE);
    });

    it.each([2, 3])('comes back within tolerance after going down %ix and back up', async (factor) => {
        const source = photoish(120, 90);

        const down = await resizeImageData(source, {
            width: source.width / factor,
            height: source.height / factor,
        });
        const back = await resizeImageData(down.data, { width: source.width, height: source.height });

        expect([back.width, back.height]).toEqual([source.width, source.height]);
        expect(meanAbsoluteError(source, back.data)).toBeLessThan(ROUND_TRIP_TOLERANCE);
    });

    /**
     * The same relation on a picture whose three channels disagree everywhere —
     * a gradient that runs left-to-right in red, top-to-bottom in green and
     * diagonally in blue. A resampler that reads the buffer as BGRA or gets the
     * row stride wrong produces a plausible image of the right size, and this
     * is where that stops being invisible. Measured 0.745 at factor 2.
     */
    it('holds for a gradient whose three channels run in different directions', async () => {
        const source = gradientImageData(120, 90);

        const up = await resizeImageData(source, { width: 240, height: 180 });
        const back = await resizeImageData(up.data, { width: 120, height: 90 });

        expect(meanAbsoluteError(source, back.data)).toBeLessThan(ROUND_TRIP_TOLERANCE);
    });

    /**
     * A hard seam gets its own, LOOSER number, and the reason is worth writing
     * down rather than hiding in a shared constant.
     *
     * The red/blue split fixture is two flat blocks with one abrupt edge, and
     * lanczos3 rings at an edge — it overshoots on both sides, on purpose, which
     * is what makes it a good photographic kernel. Measured on that fixture at
     * 120x90:
     *
     *   up then back down     0.833 (x2)   0.804 (x3)
     *   down then back up     1.275 (x2)   1.817 (x3)
     *
     * So only the upscale-first direction is asserted, at 0.95. The
     * downscale-first direction genuinely destroys the edge and reconstructing
     * it costs more than any tolerance worth having would allow; asserting it
     * at 2.0 would be a number that no longer means anything.
     */
    it('holds for a hard two-colour seam when the upscale comes first', async () => {
        const decoded = await decodeToImageData(new Uint8Array(await splitRedBluePng({ width: 120, height: 90 })));

        const up = await resizeImageData(decoded.data, { width: 240, height: 180 });
        const back = await resizeImageData(up.data, { width: 120, height: 90 });

        expect(meanAbsoluteError(decoded.data, back.data)).toBeLessThan(0.95);
    });
});

/* ------------------------------------------------------------------ *
 * Cropping
 * ------------------------------------------------------------------ */

describe('cropping a crop', () => {
    /**
     * Exact, with no tolerance, because a crop is a copy of whole pixels and
     * nothing else. cropImageData says so in its own comment — it copies rows
     * rather than going through a canvas precisely so the source bytes come
     * back unchanged — and this is the relation that proves it: two nested
     * crops must be indistinguishable from the one crop they add up to.
     *
     * The offsets are what this catches. A row-stride error, an off-by-one in
     * the origin, or a subarray taken from the destination's stride instead of
     * the source's all produce a plausible picture of the right size, which is
     * everything an example test can check.
     */
    it.each([
        ['from the origin', { x: 0, y: 0, width: 30, height: 20 }, { x: 0, y: 0, width: 10, height: 8 }],
        ['from an odd offset', { x: 7, y: 3, width: 25, height: 17 }, { x: 5, y: 4, width: 9, height: 6 }],
        ['a single row', { x: 2, y: 9, width: 40, height: 1 }, { x: 11, y: 0, width: 12, height: 1 }],
        ['a single column', { x: 13, y: 0, width: 1, height: 30 }, { x: 0, y: 6, width: 1, height: 14 }],
        ['down to one pixel', { x: 4, y: 4, width: 20, height: 20 }, { x: 19, y: 19, width: 1, height: 1 }],
        ['the whole image', { x: 0, y: 0, width: 48, height: 32 }, { x: 6, y: 5, width: 20, height: 12 }],
    ])('equals the one combined crop, %s', (_label, outer, inner) => {
        const source = countedPixels(48, 32);

        const nested = cropImageData(cropImageData(source, outer), inner);
        const combined = cropImageData(source, {
            x: outer.x + inner.x,
            y: outer.y + inner.y,
            width: inner.width,
            height: inner.height,
        });

        expectIdenticalPixels(nested, combined);
    });

    /** Cropping to the whole image is the identity, and returns the same object. */
    it('is free when the rectangle is the whole image', () => {
        const source = countedPixels(48, 32);
        const cropped = cropImageData(source, { x: 0, y: 0, width: 48, height: 32 });

        expect(cropped).toBe(source);
    });

    /**
     * A crop and the four quadrants it can be cut into must add back up to the
     * whole picture. Written the other way round from the test above — it
     * partitions rather than nests — so an error that happened to cancel in one
     * direction has nowhere to hide in the other.
     */
    it('loses nothing when an image is cut into quadrants', () => {
        const source = countedPixels(48, 32);
        const half = { width: 24, height: 16 };

        for (const [ox, oy] of [[0, 0], [24, 0], [0, 16], [24, 16]]) {
            const quadrant = cropImageData(source, { x: ox, y: oy, ...half });

            for (let y = 0; y < half.height; y += 1) {
                for (let x = 0; x < half.width; x += 1) {
                    const from = ((oy + y) * source.width + (ox + x)) * 4;
                    const to = (y * half.width + x) * 4;
                    expect(quadrant.data.subarray(to, to + 4)).toEqual(source.data.subarray(from, from + 4));
                }
            }
        }
    });
});

/* ------------------------------------------------------------------ *
 * Quality against file size
 * ------------------------------------------------------------------ */

/** Encodes a fixture at every integer quality once and hands back the sizes. */
async function sweepQuality(imageData, format) {
    const sizes = [];
    for (let quality = 1; quality <= 100; quality += 1) {
        const encoded = await encodeImageData(imageData, { format, quality });
        sizes.push(encoded.bytes);
    }
    return sizes;
}

describe('lowering the quality must never make the file bigger', () => {
    /**
     * MEASURED VIOLATION — MozJPEG BREAKS THIS, REPRODUCIBLY, AT ONE STEP.
     *
     * lib/image-client/target-bytes.js states the assumption in as many words:
     * "Monotonicity is the assumption that makes this valid: output size rises
     * with quality for JPEG and WebP." For this build's MozJPEG it does not.
     * Somewhere between quality 69 and quality 70 the encoder changes its mind
     * about something and the file gets SMALLER as the quality goes UP.
     *
     * Measured, quality 69 then quality 70, on the fixtures below plus two more
     * that are not worth a second encode here:
     *
     *   a JPEG decoded from a real sharp encode   741 -> 613 bytes   -17%
     *   the red/blue split PNG, decoded           533 -> 405         -24%
     *   an 8x8 crop of the wave fixture           511 -> 384         -25%
     *   the low-frequency blob fixture           2681 -> 2553         -5%
     *   pure random noise                        7252 -> 7265         none
     *
     * So it is not a fixture artefact and it is not a rounding wobble: every
     * picture with structure in it shows the cliff, and only white noise does
     * not. It is pinned rather than corrected because the fix is inside a
     * codec we do not own, and because what it costs us — see the search tests
     * below — is a decision about the search, not about this test.
     *
     * WHEN THIS TEST FAILS, THAT IS GOOD NEWS. It means the codec was upgraded
     * or the encode options changed and the cliff is gone. Delete it, and
     * delete the two tests downstream that exist only to measure its cost.
     */
    it('MEASURED VIOLATION — MozJPEG makes a smaller file at quality 70 than at 69', async () => {
        const split = await decodeToImageData(new Uint8Array(await splitRedBluePng({ width: 80, height: 40 })));

        const pictures = [
            ['the red/blue split', split.data],
            ['low-frequency blobs', blobs(320, 240)],
            ['a small wave crop', photoish(8, 8)],
        ];

        for (const [label, picture] of pictures) {
            const at69 = await encodeImageData(picture, { format: 'jpeg', quality: 69 });
            const at70 = await encodeImageData(picture, { format: 'jpeg', quality: 70 });

            expect(
                at70.bytes,
                `${label}: quality 70 produced ${at70.bytes} bytes and quality 69 produced ${at69.bytes}`,
            ).toBeLessThan(at69.bytes);
        }
    });

    /**
     * The relation as it actually holds for MozJPEG, once that one step is set
     * aside: every other rise in quality either grows the file or leaves it
     * alone, to within 1.5%.
     *
     * Measured worst case over the whole 1-100 sweep excluding the 69-to-70
     * step, across the three fixtures below: 1.226% (a smooth gradient, going
     * from quality 54 to 55). The next worst is 0.06%. 1.5% is that measurement
     * with a little headroom and nothing more — a real regression in the
     * quality mapping moves file sizes by tens of percent, as the cliff above
     * does at 17-25%.
     */
    it('is otherwise monotone for JPEG, to within 1.5% at every step', async () => {
        const pictures = [
            ['waves', photoish(96, 96)],
            ['a gradient', gradientImageData(200, 150)],
            ['blobs', blobs(200, 150)],
        ];

        for (const [label, picture] of pictures) {
            const sizes = await sweepQuality(picture, 'jpeg');

            for (let quality = 2; quality <= 100; quality += 1) {
                if (quality === 70) continue; // the measured violation above

                const previous = sizes[quality - 2];
                expect(
                    sizes[quality - 1],
                    `${label}: quality ${quality} produced ${sizes[quality - 1]} bytes, `
                    + `quality ${quality - 1} produced ${previous}`,
                ).toBeGreaterThanOrEqual(previous * 0.985);
            }
        }
    });

    /**
     * libwebp wobbles too, but only by a few bytes at a time: its entropy coder
     * genuinely does better on some quantiser settings than the next one up.
     * Measured worst single-step fall across the three fixtures: 3.61% (waves,
     * quality 36 to 37, 498 bytes to 480). Bounded at 5%.
     *
     * There is no cliff. That difference matters: it is why the exact-size
     * search behaves itself for WebP and does not for JPEG.
     */
    it('is monotone for WebP, to within 5% at every step', async () => {
        const pictures = [
            ['waves', photoish(96, 96)],
            ['blobs', blobs(200, 150)],
        ];

        for (const [label, picture] of pictures) {
            const sizes = await sweepQuality(picture, 'webp');

            for (let quality = 2; quality <= 100; quality += 1) {
                const previous = sizes[quality - 2];
                expect(
                    sizes[quality - 1],
                    `${label}: quality ${quality} produced ${sizes[quality - 1]} bytes, `
                    + `quality ${quality - 1} produced ${previous}`,
                ).toBeGreaterThanOrEqual(previous * 0.95);
            }
        }
    });

    /**
     * And the relation at the granularity a person actually moves the slider
     * at. Nobody drags from 36 to 37; they drag from 50 to 60. At ten-point
     * steps WebP is strictly monotone with no exceptions at all — measured on
     * both fixtures, every step.
     */
    it('is strictly monotone for WebP at the ten-point steps a slider moves in', async () => {
        for (const picture of [photoish(96, 96), blobs(200, 150)]) {
            const sizes = await sweepQuality(picture, 'webp');
            const coarse = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100].map((quality) => sizes[quality - 1]);

            for (let step = 1; step < coarse.length; step += 1) {
                expect(coarse[step]).toBeGreaterThan(coarse[step - 1]);
            }
        }
    });
});

/* ------------------------------------------------------------------ *
 * Re-encoding the same file over and over
 * ------------------------------------------------------------------ */

describe('re-encoding a JPEG at the same quality, again and again', () => {
    /**
     * WHAT RELATION ACTUALLY HOLDS HERE, SINCE IT IS NOT IDEMPOTENCE.
     *
     * A JPEG re-encoded at quality 100 does NOT come back byte-identical, and
     * it never will: the decode is to 8-bit RGB, the encode is from 8-bit RGB
     * through a different colour transform, and the two do not cancel. Measured
     * across three fixtures, byte lengths over four generations were
     * 5389/5444/5445/5448 for one of them — never the same twice.
     *
     * What DOES hold is convergence. Each pass changes the pixels less than the
     * pass before it, by roughly a factor of four, and the picture settles
     * instead of degrading without bound. Measured mean absolute error per
     * generation, on three different pictures:
     *
     *   0.289  0.050  0.019  0.008     waves
     *   0.302  0.051  0.021  0.007     blobs
     *   0.355  0.068  0.035  0.018     noise
     *
     * That is the property a person cares about — "did editing this twice ruin
     * it?" — and it is the one asserted. The 0.03 bound on the fourth
     * generation is the worst of those measurements (0.018) with headroom; the
     * strictly-decreasing assertion needs no constant at all and is the
     * stronger half.
     */
    async function reencode(imageData, quality) {
        const encoded = await encodeImageData(imageData, { format: 'jpeg', quality });
        const bytes = new Uint8Array(await encoded.blob.arrayBuffer());
        const decoded = await decodeToImageData(bytes);
        return { pixels: decoded.data, bytes: bytes.byteLength };
    }

    it('drifts less each time rather than compounding', async () => {
        let current = photoish(96, 96);
        const drifts = [];

        for (let generation = 0; generation < 4; generation += 1) {
            const next = await reencode(current, 100);
            drifts.push(meanAbsoluteError(current, next.pixels));
            current = next.pixels;
        }

        for (let generation = 1; generation < drifts.length; generation += 1) {
            expect(
                drifts[generation],
                `generation ${generation + 1} drifted ${drifts[generation]}, `
                + `generation ${generation} drifted ${drifts[generation - 1]}`,
            ).toBeLessThan(drifts[generation - 1]);
        }

        expect(drifts[drifts.length - 1]).toBeLessThan(0.03);
    });

    /**
     * The file does not run away either. Measured growth from the first encode
     * to the fourth: +1.1% on waves, +4.7% on blobs, -0.03% on noise. Bounded
     * at 8%, which is the worst of those with room, and far under the doubling
     * a genuinely broken re-encode would show.
     */
    it('does not grow the file without bound', async () => {
        let current = blobs(200, 150);
        const sizes = [];

        for (let generation = 0; generation < 4; generation += 1) {
            const next = await reencode(current, 100);
            sizes.push(next.bytes);
            current = next.pixels;
        }

        expect(sizes[sizes.length - 1]).toBeLessThan(sizes[0] * 1.08);
        expect(sizes[sizes.length - 1]).toBeGreaterThan(sizes[0] * 0.9);
    });
});

/* ------------------------------------------------------------------ *
 * The exact-size search
 * ------------------------------------------------------------------ */

describe('the byte-target search finds the same answer whichever order it probes in', () => {
    /**
     * The search is a binary search over quality, so it visits seven of the
     * hundred values and never the same seven twice for two different targets.
     * Its answer must nevertheless be a property of the encoder's size curve
     * and not of the path it walked — which is exactly a metamorphic relation,
     * and exactly what an example test cannot express.
     *
     * The oracle is an exhaustive scan of all hundred qualities. It is not an
     * independent implementation of the search; it is the DEFINITION the search
     * is an optimisation of, which is the point.
     */
    const monotoneBytes = (quality) => 1000 + quality * quality * 3;
    const monotoneProbe = async (quality) => ({ bytes: monotoneBytes(quality), payload: quality });

    const largestFitting = (low, high, targetBytes) => {
        let best = null;
        for (let quality = low; quality <= high; quality += 1) {
            if (monotoneBytes(quality) <= targetBytes) best = quality;
        }
        return best;
    };

    it('agrees with an exhaustive scan at every target, on a monotone curve', async () => {
        for (let targetBytes = 900; targetBytes <= 32_000; targetBytes += 61) {
            const found = await searchQuality({
                probe: monotoneProbe,
                targetBytes,
                maxIterations: 8,
                deadline: Infinity,
                now: () => 0,
            });

            expect(found.fitValue, `target ${targetBytes}`).toBe(largestFitting(1, 100, targetBytes));
        }
    });

    /**
     * The order-invariance itself, stated as directly as this module allows.
     *
     * searchQuality brackets 1-100 and searchScale brackets 10-99, so on the
     * same curve they probe genuinely different sequences — measured, for a
     * target of 12000: 50, 75, 62, 56, 59, 60, 61 against 54, 77, 65, 59, 62,
     * 60, 61. Different first probe, different second, different midpoints all
     * the way down. Wherever the answer lies inside both brackets, the two must
     * still land on the same value.
     */
    it('lands on the same value from a different bracket and a different probe order', async () => {
        for (let targetBytes = 1400; targetBytes <= 30_000; targetBytes += 53) {
            const byQuality = await searchQuality({
                probe: monotoneProbe,
                targetBytes,
                maxIterations: 8,
                deadline: Infinity,
                now: () => 0,
            });
            const byScale = await searchScale({
                probe: monotoneProbe,
                targetBytes,
                maxIterations: 8,
                deadline: Infinity,
                now: () => 0,
            });

            expect(byScale.fitValue, `target ${targetBytes}`).toBe(byQuality.fitValue);
            expect(byScale.fitBytes, `target ${targetBytes}`).toBe(byQuality.fitBytes);
        }
    });

    it('probes a different sequence in each of those two brackets, so that was a real test', async () => {
        const byQuality = [];
        const byScale = [];

        await searchQuality({
            probe: async (quality) => { byQuality.push(quality); return monotoneProbe(quality); },
            targetBytes: 12_000,
            maxIterations: 8,
            deadline: Infinity,
            now: () => 0,
        });
        await searchScale({
            probe: async (quality) => { byScale.push(quality); return monotoneProbe(quality); },
            targetBytes: 12_000,
            maxIterations: 8,
            deadline: Infinity,
            now: () => 0,
        });

        expect(byQuality).not.toEqual(byScale);
        expect(byQuality[byQuality.length - 1]).toBe(byScale[byScale.length - 1]);
    });

    /**
     * MEASURED COST OF THE CLIFF ABOVE.
     *
     * Everything in this describe block holds because the curve is monotone.
     * MozJPEG's is not, and this is what that costs: with the real encoder the
     * search returns a WORSE answer than the exhaustive scan — fewer bytes than
     * the largest that would have fitted, which is a smaller, softer picture
     * than the person asked for.
     *
     * Measured on the waves fixture at 96x96, sweeping every reachable target:
     * the search misses the best fitting encode on 26 of 300 targets, worst case
     * leaving 3.1% of the byte budget unused (target 1171: quality 64 encodes to
     * exactly 1171 bytes, the search returns quality 75 at 1135).
     *
     * The other framing is worse to read: at a target of 1180 bytes on the blob
     * fixture, quality 70 fits in 1172 bytes and the search ships quality 50.
     * Twenty points of quality thrown away, silently, on the exact page —
     * /compress-image-to-100kb — that most of this site's visitors land on.
     *
     * PINNED, NOT FIXED. Making the search robust to a non-monotone curve means
     * probing more of it, which costs real seconds on a phone, and that is a
     * product decision. When the codec stops doing this, this test fails and
     * should be deleted along with the cliff test above.
     */
    it('MEASURED COST — with the real JPEG encoder it does not, because the curve is not monotone', async () => {
        const sizes = await sweepQuality(photoish(96, 96), 'jpeg');
        const probe = async (quality) => ({ bytes: sizes[quality - 1], payload: quality });

        const smallest = Math.min(...sizes);
        const largest = Math.max(...sizes);
        const step = Math.max(1, Math.round((largest - smallest) / 300));

        let misses = 0;
        let worstShortfall = 0;

        for (let targetBytes = smallest; targetBytes <= largest; targetBytes += step) {
            let bestBytes = null;
            for (let quality = 1; quality <= 100; quality += 1) {
                if (sizes[quality - 1] <= targetBytes && (bestBytes === null || sizes[quality - 1] > bestBytes)) {
                    bestBytes = sizes[quality - 1];
                }
            }

            const found = await searchQuality({
                probe, targetBytes, maxIterations: 8, deadline: Infinity, now: () => 0,
            });

            if (found.fitBytes !== bestBytes) {
                misses += 1;
                worstShortfall = Math.max(worstShortfall, (bestBytes - found.fitBytes) / bestBytes);
            }
        }

        expect(misses).toBeGreaterThan(0);
        expect(worstShortfall).toBeGreaterThan(0.01);
    });
});
