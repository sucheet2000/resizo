/**
 * The resize target maths, checked against the route that is the reference.
 *
 * /resize now works out its own output size in the browser, from
 * explicitTargetDimensions and scaleDimensions in lib/image/dimensions.js. Both
 * builds are live during the changeover, so a size that comes out one way on
 * the server and another way in the tab is a bug nobody can reproduce — and it
 * would show up as a photo that is silently a different shape than the one the
 * same settings produced last week.
 *
 * The route's resolveExplicitTarget is not exported, so it is checked through
 * the two things it actually decides:
 *
 *  1. THE NUMBERS. For a real image through the real handler, the dimensions
 *     the route returns are the dimensions the shared helper predicts.
 *
 *  2. THE BOUNDARY, which is the sharper of the two. resolveExplicitTarget
 *     exists to apply MAX_DIMENSION and the pixel budget to the side it
 *     DERIVED, not only the side the caller sent. So the exact width at which
 *     the route flips from 200 to 400 is a direct readout of its derived-side
 *     arithmetic: one pixel of drift in the formula moves that flip by one. The
 *     sweeps below walk across each crossing a value at a time and require the
 *     route and the helper to agree on every single one.
 *
 * A NOTE ON THE ONE THING THIS DOES NOT CLAIM
 *
 * libvips does not always land on Math.round for a derived side — it shrinks in
 * stages and the rounding follows the stages. On a sample of 100 single-side
 * requests, 8 came back one pixel off what resolveExplicitTarget itself had
 * calculated. That gap is the SERVER's, it predates this work, and the
 * last test here pins it so nobody later "fixes" the shared helper to chase
 * sharp and quietly moves the caps in the process.
 */
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { POST } from '@/app/api/resize/route';
import { explicitTargetDimensions, scaleDimensions } from '@/lib/image/dimensions';
import { allowLimiter, clearLimiters } from './helpers/limiter';
import { jpegBytes } from './helpers/fixtures';
import { buildFormData, makeFile, postRequest, readBytes } from './helpers/request';

const URL_UNDER_TEST = 'http://localhost:3000/api/resize';

const DIMENSION_ERROR = 'Dimensions exceed maximum allowed values.';

beforeEach(() => {
    clearLimiters();
    allowLimiter('resize');
});

afterEach(() => {
    clearLimiters();
    vi.restoreAllMocks();
});

async function route(source, fields) {
    const body = buildFormData({
        file: makeFile(await jpegBytes(source), { name: 'photo.jpg', type: 'image/jpeg' }),
        fields,
    });
    return POST(postRequest(URL_UNDER_TEST, body));
}

async function routeDimensions(source, fields) {
    const response = await route(source, fields);
    expect(response.status).toBe(200);
    const meta = await sharp(await readBytes(response)).metadata();
    return { width: meta.width, height: meta.height };
}

/** The helper's answer for the same request, in the same shape. */
function predict(source, { width = null, height = null, scale = null }) {
    return scale !== null
        ? scaleDimensions(source.width, source.height, scale)
        : explicitTargetDimensions(source.width, source.height, { width, height });
}

/* ------------------------------------------------------------------ *
 * The numbers
 * ------------------------------------------------------------------ */

describe('explicitTargetDimensions predicts what /api/resize returns', () => {
    it.each([
        ['both sides, exactly as asked', { width: 200, height: 100 }, { width: 40, height: 20 }],
        ['both sides, stretched against the source ratio', { width: 200, height: 100 }, { width: 90, height: 90 }],
        ['a width, height derived', { width: 200, height: 100 }, { width: 50 }],
        ['a height, width derived', { width: 200, height: 100 }, { height: 25 }],
        ['a width on a portrait source', { width: 1080, height: 1440 }, { width: 500 }],
        ['a height on a portrait source', { width: 1080, height: 1440 }, { height: 720 }],
        ['a width on a square source', { width: 1200, height: 1200 }, { width: 333 }],
        ['a width on a phone-shaped source', { width: 4032, height: 3024 }, { width: 1920 }],
        ['a height on a phone-shaped source', { width: 4032, height: 3024 }, { height: 1080 }],
        ['a width on an extreme panorama', { width: 9000, height: 2000 }, { width: 100 }],
        ['a width that rounds the derived side down', { width: 1000, height: 333 }, { width: 100 }],
        ['a width that rounds the derived side up', { width: 1600, height: 1067 }, { width: 800 }],
        ['a width of one on a very tall source', { width: 3, height: 10_000 }, { height: 1 }],
        ['an upscale past the source size', { width: 200, height: 100 }, { width: 800 }],
    ])('%s', async (_label, source, fields) => {
        const predicted = predict(source, fields);
        expect(predicted.ok).toBe(true);

        const actual = await routeDimensions(source, {
            ...(fields.width ? { width: String(fields.width) } : {}),
            ...(fields.height ? { height: String(fields.height) } : {}),
        });

        expect(actual).toEqual({ width: predicted.width, height: predicted.height });
    });
});

describe('scaleDimensions predicts what /api/resize returns for a percentage', () => {
    it.each([
        ['half', { width: 1600, height: 1067 }, 50],
        ['a quarter', { width: 4032, height: 3024 }, 25],
        ['a fractional percentage', { width: 999, height: 501 }, 33.3],
        ['an upscale', { width: 200, height: 100 }, 200],
        ['a percentage so small both sides clamp to one', { width: 200, height: 100 }, 0.01],
    ])('%s', async (_label, source, scale) => {
        const predicted = predict(source, { scale });
        expect(predicted.ok).toBe(true);

        const actual = await routeDimensions(source, { scale: String(scale) });

        expect(actual).toEqual({ width: predicted.width, height: predicted.height });
    });
});

/* ------------------------------------------------------------------ *
 * The boundary
 * ------------------------------------------------------------------ */

/**
 * Each sweep walks the supplied side across the value where the DERIVED side
 * breaks a cap. `from`/`to` are chosen to straddle that crossing, and the test
 * insists a crossing really is inside the range — a sweep that happened to sit
 * entirely on one side of it would pass while proving nothing.
 */
const SWEEPS = [
    {
        label: 'a derived height crossing MAX_DIMENSION',
        source: { width: 200, height: 400 },
        side: 'width',
        from: 3998,
        to: 4003,
    },
    {
        label: 'a derived height crossing MAX_DIMENSION on a ratio that never lands exactly',
        source: { width: 300, height: 701 },
        side: 'width',
        from: 3421,
        to: 3426,
    },
    {
        label: 'a derived width crossing MAX_DIMENSION',
        source: { width: 701, height: 300 },
        side: 'height',
        from: 3421,
        to: 3426,
    },
    {
        label: 'a derived height crossing the pixel budget while both sides stay legal',
        source: { width: 4000, height: 3000 },
        side: 'width',
        from: 7301,
        to: 7306,
    },
];

describe('the caps land on the derived side in exactly the same place', () => {
    it.each(SWEEPS)('$label', async ({ source, side, from, to }) => {
        const seen = [];

        for (let value = from; value <= to; value += 1) {
            const fields = { [side]: String(value) };
            const predicted = predict(source, { [side]: value });
            const response = await route(source, fields);

            expect(
                { value, status: response.status },
                `${side}=${value} on a ${source.width}x${source.height} source`,
            ).toEqual({ value, status: predicted.ok ? 200 : 400 });

            if (!predicted.ok) {
                expect(await response.json()).toEqual({ error: DIMENSION_ERROR });
                expect(predicted.error).toBe(DIMENSION_ERROR);
            }

            seen.push(predicted.ok);
        }

        // The range has to contain the flip, or the sweep proved nothing.
        expect(new Set(seen).size).toBe(2);
    }, 30_000);
});

/* ------------------------------------------------------------------ *
 * The gap that belongs to sharp, not to us
 * ------------------------------------------------------------------ */

describe('a known one-pixel gap between the route’s own maths and libvips', () => {
    /**
     * resolveExplicitTarget derives 133 here and sharp emits 134, because
     * libvips shrinks in stages and rounds per stage. The browser engine is
     * asked for an explicit width and height, so it emits the derived 133.
     *
     * This is recorded rather than chased: the derived side is what the caps
     * are applied to, and re-deriving it from libvips' staged rounding would
     * make the accept/refuse boundary depend on a decode path. One pixel on a
     * thumbnail is the cheaper of the two.
     */
    it('derives the side the route calculated, not the side libvips emitted', async () => {
        const source = { width: 1023, height: 767 };

        const predicted = explicitTargetDimensions(source.width, source.height, { height: 100 });
        expect(predicted).toEqual({ ok: true, width: 133, height: 100 });

        const actual = await routeDimensions(source, { height: '100' });
        expect(actual).toEqual({ width: 134, height: 100 });
    });
});
