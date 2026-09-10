/**
 * The `fit` op — one image made to satisfy several output requirements at once.
 *
 * WHY A NEW OP RATHER THAN A PRESET ON /resize OR /signature-resizer
 *
 * A passport portal does not ask for a size. It asks for a size AND a format
 * AND a byte ceiling AND, often, a byte FLOOR and a DPI record, and it refuses
 * the upload if any one of them is off. Every existing op answers one of those
 * and quietly gives away another: /resize will hand back 600x600 in whatever
 * bytes it lands on, /compress will hand back the bytes and shrink the picture
 * to get there. This op is the one that may not trade: the dimensions are
 * exact, always, and a byte ceiling that cannot be met at those dimensions is a
 * refusal rather than a smaller picture.
 *
 * WHAT IS ASSERTED HERE AND WHAT IS NOT
 *
 * Every number below is arithmetic on the fixture, not a measurement of the
 * codecs — 800x400 covered into 200x200 resamples to 400x200 and trims 100 off
 * each side, and that is true whatever lanczos3 does to the pixels in between.
 * The byte numbers ARE measurements, taken against the binaries this repo
 * serves and written down beside the assertion that rests on them.
 *
 * sharp is the independent reference. Nothing here trusts the result object
 * about what came out: the blob is reopened by libvips and asked its size, its
 * format, its density and its pixels.
 */
import sharp from 'sharp';
import { beforeAll, describe, expect, it } from 'vitest';

import { DEFAULT_QUALITY, MAX_DIMENSION } from '@/lib/limits';
import { installBrowserEnv } from './helpers/browser-env';
import { halfAlphaPng, makeFile, noiseJpeg } from './helpers/fixtures';

const KB = 1024;

const SOURCE_WIDTH = 800;
const SOURCE_HEIGHT = 400;

/**
 * Four vertical bands, a quarter of the width each, in colours far enough
 * apart that a lossy encoder cannot turn one into another.
 *
 * The shape is the point. The source is 2:1 and every target below is 1:1, so
 * the three geometries land on visibly different pictures: a cover keeps the
 * middle two bands, a contain keeps all four and pads above and below, and a
 * stretch keeps all four with no padding at all. A test that only checked
 * width and height would pass on all three.
 */
const BANDS = [
    { name: 'red', rgb: [220, 30, 40] },
    { name: 'green', rgb: [30, 170, 60] },
    { name: 'blue', rgb: [40, 60, 200] },
    { name: 'yellow', rgb: [235, 200, 40] },
];

const WHITE = [255, 255, 255];

let runOperation;
let JobError;

beforeAll(async () => {
    installBrowserEnv();
    ({ runOperation, JobError } = await import('@/lib/image-client/operations'));
});

function bandsPng({ width = SOURCE_WIDTH, height = SOURCE_HEIGHT } = {}) {
    const bandWidth = Math.round(width / BANDS.length);

    return sharp({
        create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } },
    })
        .composite(BANDS.map((band, index) => ({
            input: {
                create: {
                    width: bandWidth,
                    height,
                    channels: 4,
                    background: { r: band.rgb[0], g: band.rgb[1], b: band.rgb[2], alpha: 1 },
                },
            },
            left: index * bandWidth,
            top: 0,
        })))
        .png()
        .toBuffer();
}

async function bandsFile(size) {
    return makeFile(await bandsPng(size), { name: 'photo.png', type: 'image/png' });
}

function fit(file, options, hooks) {
    return runOperation('fit', file, options, hooks);
}

async function fitBands(options, size) {
    return fit(await bandsFile(size), options);
}

/** The output reopened by libvips, with a pixel accessor in image space. */
async function readBack(blob) {
    const buffer = Buffer.from(await blob.arrayBuffer());
    const meta = await sharp(buffer).metadata();
    const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });

    return {
        format: meta.format,
        density: meta.density,
        width: info.width,
        height: info.height,
        at(x, y) {
            const offset = (y * info.width + x) * 4;
            return Array.from(data.slice(offset, offset + 4));
        },
    };
}

function distance(pixel, rgb) {
    return Math.abs(pixel[0] - rgb[0]) + Math.abs(pixel[1] - rgb[1]) + Math.abs(pixel[2] - rgb[2]);
}

/**
 * Which of the four bands (or the white fill) a pixel is, by nearest colour.
 *
 * Nearest rather than equal because the pixel has been through a gamma-correct
 * resample and, in the JPEG cases, a lossy encoder. The bands are hundreds of
 * units apart, so "nearest" is not a loose assertion — a wrong band would have
 * to move a channel by more than a hundred to pass.
 */
function bandAt(output, x, y) {
    const pixel = output.at(x, y);
    const candidates = [...BANDS, { name: 'white', rgb: WHITE }];
    return candidates.reduce((best, band) => (
        distance(pixel, band.rgb) < distance(pixel, best.rgb) ? band : best
    )).name;
}

/** The band each output row or column reads as, sampled down the middle. */
function columnBands(output, y) {
    return [0.125, 0.375, 0.625, 0.875].map((share) => bandAt(output, Math.floor(output.width * share), y));
}

async function expectJobError(promise, { code, message, suggestion } = {}) {
    const error = await promise.then(
        () => { throw new Error('expected a JobError, but the job succeeded'); },
        (thrown) => thrown,
    );

    expect(error).toBeInstanceOf(JobError);
    if (code !== undefined) expect(error.code).toBe(code);
    if (message !== undefined) expect(error.message).toBe(message);
    if (suggestion !== undefined) expect(error.suggestion).toBe(suggestion);

    return error;
}

/* ------------------------------------------------------------------ *
 * 1. Exact dimensions, whichever geometry was asked for
 * ------------------------------------------------------------------ */

describe('the dimensions are exact for all three geometries', () => {
    it.each(['cover', 'contain', 'stretch'])('%s lands on exactly the box that was asked for', async (geometry) => {
        const result = await fitBands({ width: '200', height: '200', geometry, format: 'png' });

        expect({ width: result.width, height: result.height }).toEqual({ width: 200, height: 200 });
        expect(result.requestedWidth).toBe(200);
        expect(result.requestedHeight).toBe(200);
        expect(result.fit).toBe(geometry);

        const output = await readBack(result.blob);
        expect({ width: output.width, height: output.height }).toEqual({ width: 200, height: 200 });
    }, 60_000);

    it('holds for a box that is taller than it is wide', async () => {
        const result = await fitBands({ width: '413', height: '531', format: 'png' });

        expect({ width: result.width, height: result.height }).toEqual({ width: 413, height: 531 });

        const output = await readBack(result.blob);
        expect({ width: output.width, height: output.height }).toEqual({ width: 413, height: 531 });
    }, 60_000);
});

/* ------------------------------------------------------------------ *
 * 2. What each geometry does to the picture
 * ------------------------------------------------------------------ */

describe('cover fills the box and trims the overflow off the centre', () => {
    /**
     * 800x400 covered into 200x200 resamples to 400x200 (the scale is 0.5, the
     * larger of 200/800 and 200/400) and centre-crops 200 wide out of 400,
     * which takes x from 100 to 300. In that window the four 100-wide
     * resampled bands leave exactly the middle two: green then blue.
     */
    it('keeps the middle of a 2:1 source and drops the outer quarters', async () => {
        const result = await fitBands({ width: '200', height: '200', geometry: 'cover', format: 'png' });
        const output = await readBack(result.blob);

        expect(bandAt(output, 50, 100)).toBe('green');
        expect(bandAt(output, 150, 100)).toBe('blue');
        expect(columnBands(output, 100)).toEqual(['green', 'green', 'blue', 'blue']);
    }, 60_000);

    it('is what a request with no geometry gets, because it loses the least of what is left', async () => {
        const result = await fitBands({ width: '200', height: '200', format: 'png' });

        expect(result.fit).toBe('cover');
        expect(columnBands(await readBack(result.blob), 100)).toEqual(['green', 'green', 'blue', 'blue']);
    }, 60_000);
});

describe('contain puts the whole picture inside the box and pads the rest', () => {
    /**
     * 800x400 inside 200x200 binds on width: 200x100, centred, so rows 0-49
     * and 150-199 are background and rows 50-149 carry all four bands.
     */
    it('pads above and below with the background and keeps every band', async () => {
        const result = await fitBands({
            width: '200', height: '200', geometry: 'contain', format: 'png', background: 'white',
        });
        const output = await readBack(result.blob);

        expect(columnBands(output, 100)).toEqual(['red', 'green', 'blue', 'yellow']);
        expect(bandAt(output, 100, 10)).toBe('white');
        expect(bandAt(output, 100, 190)).toBe('white');
    }, 60_000);

    it('pads with the colour that was chosen, not with the default', async () => {
        const result = await fitBands({
            width: '200', height: '200', geometry: 'contain', format: 'png', background: '#c81e28',
        });
        const output = await readBack(result.blob);

        expect(output.at(100, 10).slice(0, 3)).toEqual([200, 30, 40]);
        expect(output.at(100, 190).slice(0, 3)).toEqual([200, 30, 40]);
    }, 60_000);

    /**
     * The padded region is the picture, and its shape is the source's. Measured
     * by walking down the centre column and counting the rows that are not the
     * fill: 100 of them, on a 200-wide box, is 2:1 — exactly the source.
     */
    it('does not change the shape of the picture it padded', async () => {
        const result = await fitBands({
            width: '200', height: '200', geometry: 'contain', format: 'png', background: 'white',
        });
        const output = await readBack(result.blob);

        let pictureRows = 0;
        for (let y = 0; y < output.height; y += 1) {
            if (bandAt(output, 20, y) !== 'white') pictureRows += 1;
        }

        expect(pictureRows).toBe(100);
        expect(output.width / pictureRows).toBeCloseTo(SOURCE_WIDTH / SOURCE_HEIGHT, 5);
    }, 60_000);
});

describe('stretch resamples straight to the box', () => {
    it('keeps every band and pads nothing, which is the distortion being asked for', async () => {
        const result = await fitBands({
            width: '200', height: '200', geometry: 'stretch', format: 'png', background: 'white',
        });
        const output = await readBack(result.blob);

        expect(columnBands(output, 100)).toEqual(['red', 'green', 'blue', 'yellow']);
        expect(bandAt(output, 100, 10)).not.toBe('white');
        expect(bandAt(output, 100, 190)).not.toBe('white');
    }, 60_000);

    it('is never what a request without a geometry gets', async () => {
        const result = await fitBands({ width: '200', height: '200', format: 'png' });
        expect(result.fit).not.toBe('stretch');
    }, 60_000);
});

/* ------------------------------------------------------------------ *
 * 3. The crop rectangle
 * ------------------------------------------------------------------ */

describe('a supplied crop rectangle decides which pixels survive', () => {
    /**
     * The left half of the source is red and green, and it is already square,
     * so a cover into 200x200 trims nothing: the output is red then green,
     * where the same request without a rectangle is green then blue.
     */
    it('changes the picture, and comes back echoed exactly as it was given', async () => {
        const result = await fitBands({
            width: '200', height: '200', geometry: 'cover', format: 'png',
            x: '0', y: '0', cropWidth: '400', cropHeight: '400',
        });

        expect(result.crop).toEqual({ x: 0, y: 0, width: 400, height: 400 });
        expect(columnBands(await readBack(result.blob), 100)).toEqual(['red', 'red', 'green', 'green']);
    }, 60_000);

    it('reports the whole image as the rectangle when none was supplied', async () => {
        const result = await fitBands({ width: '200', height: '200', format: 'png' });

        expect(result.crop).toEqual({ x: 0, y: 0, width: SOURCE_WIDTH, height: SOURCE_HEIGHT });
    }, 60_000);
});

/* ------------------------------------------------------------------ *
 * 4. Transparency and the background
 * ------------------------------------------------------------------ */

describe('what happens to a transparent source', () => {
    async function alphaFile() {
        return makeFile(await halfAlphaPng({ width: 40, height: 30 }), { name: 'logo.png', type: 'image/png' });
    }

    /** The source composited onto a colour, by the straight-alpha formula. */
    async function expectedComposite(background) {
        const { data } = await sharp(await halfAlphaPng({ width: 40, height: 30 }))
            .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
        const [r, g, b, a] = Array.from(data.slice(0, 4));
        const inverse = 255 - a;

        return [
            Math.round((r * a + background[0] * inverse) / 255),
            Math.round((g * a + background[1] * inverse) / 255),
            Math.round((b * a + background[2] * inverse) / 255),
        ];
    }

    it('a JPEG lands on white when no background was chosen', async () => {
        const result = await fit(await alphaFile(), { width: '20', height: '15', format: 'jpeg' });
        const output = await readBack(result.blob);
        const expected = await expectedComposite(WHITE);

        expect(output.format).toBe('jpeg');
        expect(distance(output.at(10, 7), expected)).toBeLessThanOrEqual(12);
    }, 60_000);

    it('a JPEG lands on the hex that was chosen', async () => {
        const result = await fit(await alphaFile(), {
            width: '20', height: '15', format: 'jpeg', background: '#ff0000',
        });
        const output = await readBack(result.blob);
        const expected = await expectedComposite([255, 0, 0]);

        expect(distance(output.at(10, 7), expected)).toBeLessThanOrEqual(12);
    }, 60_000);

    it('a PNG keeps the transparency instead of filling it', async () => {
        const result = await fit(await alphaFile(), { width: '20', height: '15', format: 'png' });
        const output = await readBack(result.blob);

        expect(output.format).toBe('png');
        expect(output.at(10, 7)[3]).toBeLessThan(200);
    }, 60_000);
});

/* ------------------------------------------------------------------ *
 * 5. The output format
 * ------------------------------------------------------------------ */

describe('the output format is exactly the one that was asked for', () => {
    it.each([
        ['jpeg', 'jpeg'],
        ['png', 'png'],
        ['webp', 'webp'],
    ])('%s comes back as %s, read from the bytes', async (requested, expected) => {
        const result = await fitBands({ width: '120', height: '120', format: requested });

        expect(result.format).toBe(expected);
        expect((await readBack(result.blob)).format).toBe(expected);
    }, 60_000);

    it('is JPEG when the field was left empty, which is what a form usually wants', async () => {
        const result = await fitBands({ width: '120', height: '120' });

        expect(result.format).toBe('jpeg');
        expect((await readBack(result.blob)).format).toBe('jpeg');
    }, 60_000);
});

/* ------------------------------------------------------------------ *
 * 6. The DPI record
 * ------------------------------------------------------------------ */

describe('the DPI record', () => {
    it.each(['jpeg', 'png'])('is written into a %s and read back by libvips', async (format) => {
        const result = await fitBands({ width: '120', height: '120', format, dpi: '300' });

        expect(result.dpi.after.dpi).toEqual({ x: 300, y: 300 });
        expect((await readBack(result.blob)).density).toBe(300);
    }, 60_000);

    it('is null when none was asked for, rather than a made-up 72', async () => {
        const result = await fitBands({ width: '120', height: '120', format: 'jpeg' });

        expect(result.dpi).toBeNull();
    }, 60_000);

    /** WebP carries no density field at all, so this is refused before a pixel is touched. */
    it('is refused for WebP, because the container has nowhere to put it', async () => {
        await expectJobError(
            fitBands({ width: '120', height: '120', format: 'webp', dpi: '300' }),
            { code: 'invalid-requirements' },
        ).then((error) => {
            expect(error.message).toMatch(/WebP/);
        });
    }, 60_000);
});

/* ------------------------------------------------------------------ *
 * 7. The byte ceiling — and the pixels it may never spend
 * ------------------------------------------------------------------ */

describe('a maximum file size', () => {
    async function noiseFile({ width = 800, height = 800 } = {}) {
        return makeFile(await noiseJpeg({ width, height, quality: 95 }), { name: 'photo.jpg', type: 'image/jpeg' });
    }

    /**
     * MEASURED, against the binaries this repo serves: 400x400 of this noise
     * encodes to 22.2 KB at quality 50 and 66.8 KB at quality 80, so a 30 KB
     * ceiling is reachable inside the default quality floor and the search has
     * a real range to walk.
     */
    it('is met without giving away a single pixel', async () => {
        const result = await fit(await noiseFile(), {
            width: '400', height: '400', format: 'jpeg', targetBytes: String(30 * KB),
        });

        expect(result.resultBytes).toBeLessThanOrEqual(30 * KB);
        expect({ width: result.width, height: result.height }).toEqual({ width: 400, height: 400 });
        expect(result.resized).toBe(false);
        expect(result.targetBytes).toBe(30 * KB);

        const output = await readBack(result.blob);
        expect({ width: output.width, height: output.height }).toEqual({ width: 400, height: 400 });
    }, 120_000);

    /**
     * MEASURED: 600x600 of this noise is 49.3 KB at quality 50, which is the
     * default floor, and 1.5 KB at quality 1. So 10 KB is out of reach until
     * the floor is lowered — which is exactly what the suggestion offers.
     */
    it('refuses in the requirement’s own words when the ceiling cannot be met at those pixels', async () => {
        const error = await expectJobError(
            fit(await noiseFile({ width: 1200, height: 1200 }), {
                width: '600', height: '600', format: 'jpeg', targetBytes: String(10 * KB),
            }),
            {
                code: 'target-unreachable',
                message: 'Resizo couldn’t produce a JPEG under 10 KB at 600 × 600 pixels.',
                suggestion: 'Allow a lower quality, choose WebP if the form accepts it, or raise the limit. '
                    + 'The dimensions were kept as you asked.',
            },
        );

        expect(error.message).not.toMatch(/quality \d/);
    }, 120_000);

    it('meets the same ceiling once the quality floor is lowered, which is what the suggestion says to do', async () => {
        const result = await fit(await noiseFile({ width: 1200, height: 1200 }), {
            width: '600', height: '600', format: 'jpeg', targetBytes: String(10 * KB), minQuality: '1',
        });

        expect(result.resultBytes).toBeLessThanOrEqual(10 * KB);
        expect({ width: result.width, height: result.height }).toEqual({ width: 600, height: 600 });
    }, 120_000);

    /** PNG has no quality axis in this build, so no floor exists to lower. */
    it('refuses for a PNG, which has no lever to pull at all', async () => {
        await expectJobError(
            fit(await noiseFile({ width: 1200, height: 1200 }), {
                width: '600', height: '600', format: 'png', targetBytes: String(10 * KB), minQuality: '1',
            }),
            {
                code: 'target-unreachable',
                message: 'Resizo couldn’t produce a PNG under 10 KB at 600 × 600 pixels.',
            },
        );
    }, 120_000);
});

/* ------------------------------------------------------------------ *
 * 8. The byte floor
 * ------------------------------------------------------------------ */

describe('a minimum file size', () => {
    /**
     * MEASURED: 300x300 of this noise is 39.0 KB at the default quality of 80
     * and 47.2 KB at 85, so a 45 KB floor is reached on the first rung of the
     * ladder and the quality it reports is the one that got there.
     */
    it('is reached by raising the quality rather than by padding the file', async () => {
        const source = makeFile(await noiseJpeg({ width: 600, height: 600, quality: 95 }), {
            name: 'photo.jpg', type: 'image/jpeg',
        });
        const result = await fit(source, {
            width: '300', height: '300', format: 'jpeg', minBytes: String(45 * KB),
        });

        expect(result.resultBytes).toBeGreaterThanOrEqual(45 * KB);
        expect(result.quality).toBeGreaterThan(DEFAULT_QUALITY);
        expect({ width: result.width, height: result.height }).toEqual({ width: 300, height: 300 });
    }, 120_000);

    /** A flat colour is a few hundred bytes at every quality there is. */
    async function flatFile() {
        const flat = await sharp({
            create: { width: 600, height: 600, channels: 3, background: { r: 30, g: 90, b: 160 } },
        }).jpeg().toBuffer();
        return makeFile(flat, { name: 'flat.jpg', type: 'image/jpeg' });
    }

    it('refuses when the highest quality still cannot reach it', async () => {
        await expectJobError(
            fit(await flatFile(), {
                width: '300', height: '300', format: 'jpeg', minBytes: String(20 * KB),
            }),
            {
                code: 'minimum-unreachable',
                message: 'Resizo couldn’t reach the 20 KB minimum at 300 × 300 pixels even at the highest quality.',
                suggestion: 'Ask for larger dimensions, or PNG, which is bigger.',
            },
        );
    }, 120_000);

    /**
     * PNG has no quality axis in this build, so the ladder is not climbed at
     * all — and offering PNG to somebody who already asked for PNG is advice
     * they cannot act on.
     */
    it('does not offer PNG to a request that is already PNG', async () => {
        const error = await expectJobError(
            fit(await flatFile(), {
                width: '300', height: '300', format: 'png', minBytes: String(2000 * KB),
            }),
            { code: 'minimum-unreachable' },
        );

        expect(error.suggestion).not.toMatch(/or PNG/);
        expect(error.suggestion).toMatch(/larger dimensions/);
    }, 120_000);

    /**
     * The shape HM Passport Office actually states — "at least 50KB and no more
     * than 10MB" — is a floor AND a ceiling at once, and it is the case where a
     * naive implementation breaks one while satisfying the other: the ladder
     * that climbs to the floor can walk straight through the ceiling.
     */
    it('holds a floor and a ceiling at the same time, at the exact dimensions', async () => {
        const source = makeFile(await noiseJpeg({ width: 800, height: 800, quality: 95 }), {
            name: 'photo.jpg', type: 'image/jpeg',
        });
        const result = await fit(source, {
            width: '400', height: '400', format: 'jpeg',
            minBytes: String(40 * KB), targetBytes: String(60 * KB),
        });

        expect(result.resultBytes).toBeGreaterThanOrEqual(40 * KB);
        expect(result.resultBytes).toBeLessThanOrEqual(60 * KB);
        expect({ width: result.width, height: result.height }).toEqual({ width: 400, height: 400 });
        expect(result.verified).toBe(true);
    }, 120_000);

    it('refuses a floor that is not below the ceiling, before anything is decoded', async () => {
        await expectJobError(
            fitBands({ width: '200', height: '200', targetBytes: String(20 * KB), minBytes: String(20 * KB) }),
            { code: 'invalid-requirements' },
        );
    }, 60_000);
});

/* ------------------------------------------------------------------ *
 * 9. Malformed requirements, each named
 * ------------------------------------------------------------------ */

describe('a requirement that cannot be read is named rather than guessed at', () => {
    it.each([
        ['a missing height', { width: '600' }, 'invalid-dimensions'],
        ['a missing width', { height: '600' }, 'invalid-dimensions'],
        ['a negative width', { width: '-40', height: '600' }, 'invalid-dimensions'],
        ['a width that is not a number', { width: 'abc', height: '600' }, 'invalid-dimensions'],
        ['a decimal height', { width: '600', height: '600.5' }, 'invalid-dimensions'],
        ['a width past the per-side cap', { width: String(MAX_DIMENSION + 1), height: '600' }, 'invalid-dimensions'],
        ['a box past the total-pixel budget', { width: '8000', height: '8000' }, 'invalid-dimensions'],
        ['a geometry nobody offers', { width: '200', height: '200', geometry: 'squish' }, 'invalid-requirements'],
        ['an output format this build cannot write', { width: '200', height: '200', format: 'avif' }, 'invalid-format'],
        ['a DPI outside what a container can store', { width: '200', height: '200', dpi: '0' }, 'invalid-requirements'],
        ['a DPI that is not a number', { width: '200', height: '200', dpi: 'lots' }, 'invalid-requirements'],
        ['a quality floor above 100', { width: '200', height: '200', minQuality: '101' }, 'invalid-requirements'],
        ['a ceiling below the smallest one this engine takes', { width: '200', height: '200', targetBytes: '5' }, 'invalid-requirements'],
    ])('refuses %s', async (_label, options, code) => {
        const error = await expectJobError(fitBands(options), { code });
        expect(error.message.length).toBeGreaterThan(10);
    }, 60_000);

    /**
     * parseCropParams' own rule: any of the four means all four. A half-filled
     * rectangle is a bug in the caller, not an invitation to guess the rest.
     */
    it('refuses a crop rectangle with only some of its four values', async () => {
        await expectJobError(
            fitBands({ width: '200', height: '200', x: '10', y: '10', cropWidth: '100' }),
            { code: 'invalid-crop' },
        );
    }, 60_000);

    it('refuses a crop rectangle that leaves the image', async () => {
        await expectJobError(
            fitBands({
                width: '200', height: '200',
                x: '700', y: '0', cropWidth: '400', cropHeight: '400',
            }),
            { code: 'invalid-crop' },
        );
    }, 60_000);
});

/* ------------------------------------------------------------------ *
 * 10. The memory gate
 * ------------------------------------------------------------------ */

describe('the memory gate runs before anything is allocated for the box', () => {
    const smallDevice = {
        memoryGb: 0.5,
        memoryReported: true,
        cores: 2,
        ios: false,
        nativeDownscale: false,
        wasm: true,
    };

    it('refuses a box this device cannot hold, with the reason and a suggestion', async () => {
        const error = await expectJobError(
            fit(await bandsFile(), { width: '8000', height: '5000', format: 'jpeg' }, { device: smallDevice }),
            { code: 'not-enough-memory' },
        );

        expect(error.suggestion).toBeTruthy();
        expect(error.message).toMatch(/MB/);
    }, 60_000);

    it('allows the same box on a device that has the memory for it', async () => {
        const roomy = { ...smallDevice, memoryGb: 16 };
        const result = await fit(await bandsFile(), { width: '2000', height: '2000', format: 'jpeg' }, { device: roomy });

        expect({ width: result.width, height: result.height }).toEqual({ width: 2000, height: 2000 });
    }, 120_000);
});

/* ------------------------------------------------------------------ *
 * 11. The op reports its own verification
 * ------------------------------------------------------------------ */

describe('every run carries an independent reading of what it produced', () => {
    it('reports the requirement, the six checks and a verdict', async () => {
        const result = await fitBands({
            width: '200', height: '200', format: 'jpeg', targetBytes: String(50 * KB), dpi: '300',
        });

        expect(result.verified).toBe(true);
        expect(result.checks.map((check) => check.key)).toEqual([
            'dimensions', 'format', 'maxBytes', 'minBytes', 'dpi', 'transparency',
        ]);
        expect(result.requirements).toMatchObject({
            width: 200, height: 200, geometry: 'cover', format: 'jpeg', dpi: 300, transparency: 'removed',
        });
    }, 60_000);

    it('leaves the three fields null on an op that has no requirements', async () => {
        const result = await runOperation('convert', await bandsFile({ width: 40, height: 30 }), { format: 'png' });

        expect(result.requirements).toBeNull();
        expect(result.checks).toBeNull();
        expect(result.verified).toBeNull();
    }, 60_000);
});
