/**
 * Route behaviour that only a fault-injecting sharp can reach: metadata sharp
 * cannot resolve, an encoder that rejects, and the exact encoder options each
 * tool asks for. Real images cannot produce these states, so sharp itself is
 * replaced here and lib/image/pipeline.js runs for real on top of it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_QUALITY, MAX_DECODE_PIXELS, MAX_PIXELS } from '@/lib/constants';
import { pngPaletteColours } from '@/lib/image/quality';
import { allowLimiter, clearLimiters } from './helpers/limiter';
import { buildFormData, makeFile, postRequest } from './helpers/request';

const harness = vi.hoisted(() => {
    const state = {
        metadata: { width: 100, height: 80, format: 'jpeg' },
        metadataError: null,
        toBufferError: null,
        output: Buffer.from('ENCODED-OUTPUT'),
        info: { width: 100, height: 80 },
    };

    const calls = [];
    const instance = {};

    const chainable = (name) => vi.fn((...args) => {
        calls.push({ name, args });
        return instance;
    });

    Object.assign(instance, {
        metadata: vi.fn(async () => {
            calls.push({ name: 'metadata', args: [] });
            if (state.metadataError) throw state.metadataError;
            return state.metadata;
        }),
        rotate: chainable('rotate'),
        resize: chainable('resize'),
        extract: chainable('extract'),
        jpeg: chainable('jpeg'),
        png: chainable('png'),
        webp: chainable('webp'),
        avif: chainable('avif'),
        withMetadata: chainable('withMetadata'),
        keepMetadata: chainable('keepMetadata'),
        toBuffer: vi.fn(async (options) => {
            calls.push({ name: 'toBuffer', args: options ? [options] : [] });
            if (state.toBufferError) throw state.toBufferError;
            return options?.resolveWithObject
                ? { data: state.output, info: state.info }
                : state.output;
        }),
    });

    const sharpMock = vi.fn(() => instance);

    return { state, calls, instance, sharpMock };
});

vi.mock('sharp', () => ({ default: harness.sharpMock }));

const { POST: resizePost } = await import('@/app/api/resize/route');
const { POST: compressPost } = await import('@/app/api/compress/route');
const { POST: convertPost } = await import('@/app/api/convert/route');
const { POST: cropPost } = await import('@/app/api/crop/route');
const { POST: bulkPost } = await import('@/app/api/resize-bulk/route');

// Only the signature is read before sharp takes over, so a header is enough.
const JPEG_HEADER = Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]), Buffer.alloc(16)]);
const PNG_HEADER = Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), Buffer.alloc(16)]);

function callWith(handler, path, { bytes = JPEG_HEADER, name = 'photo.jpg', type = 'image/jpeg', fields = {} } = {}) {
    const body = buildFormData({ file: makeFile(bytes, { name, type }), fields });
    return handler(postRequest(`http://localhost:3000/api/${path}`, body));
}

function callsNamed(name) {
    return harness.calls.filter((entry) => entry.name === name);
}

beforeEach(() => {
    harness.calls.length = 0;
    harness.state.metadata = { width: 100, height: 80, format: 'jpeg' };
    harness.state.metadataError = null;
    harness.state.toBufferError = null;
    harness.state.output = Buffer.from('ENCODED-OUTPUT');
    harness.state.info = { width: 100, height: 80 };
    harness.sharpMock.mockImplementation(() => harness.instance);

    clearLimiters();
    for (const bucket of ['resize', 'compress', 'convert', 'crop', 'bulk']) allowLimiter(bucket);
});

afterEach(() => {
    clearLimiters();
    vi.restoreAllMocks();
});

describe('the decode is always capped', () => {
    it('constructs every pipeline with the decode ceiling applied', async () => {
        await callWith(resizePost, 'resize', { fields: { width: '50' } });

        expect(harness.sharpMock).toHaveBeenCalledWith(expect.any(Buffer), { limitInputPixels: MAX_DECODE_PIXELS });
    });

    // The regression this pins: the decode used to be capped at the OUTPUT
    // budget, which turned every 48MP phone photo into a 400.
    it('never caps the decode at the output budget', async () => {
        await callWith(resizePost, 'resize', { fields: { width: '50' } });

        expect(harness.sharpMock).not.toHaveBeenCalledWith(expect.any(Buffer), { limitInputPixels: MAX_PIXELS });
    });

    it.each([
        ['compress', compressPost, 'compress', { quality: '50' }],
        ['convert', convertPost, 'convert', { target_format: 'png' }],
        ['crop', cropPost, 'crop', { crop_x: '0', crop_y: '0', crop_width: '10', crop_height: '10' }],
    ])('applies the same ceiling in /%s', async (_label, handler, path, fields) => {
        await callWith(handler, path, { fields });

        expect(harness.sharpMock).toHaveBeenCalledWith(expect.any(Buffer), { limitInputPixels: MAX_DECODE_PIXELS });
    });
});

describe('metadata stripping is the absence of a call', () => {
    it.each([
        ['resize', resizePost, 'resize', { width: '50' }],
        ['compress', compressPost, 'compress', { quality: '50' }],
        ['convert', convertPost, 'convert', { target_format: 'png' }],
        ['crop', cropPost, 'crop', { crop_x: '0', crop_y: '0', crop_width: '10', crop_height: '10' }],
    ])('%s never calls withMetadata or keepMetadata', async (_label, handler, path, fields) => {
        const response = await callWith(handler, path, { fields });

        expect(response.status).toBe(200);
        expect(harness.instance.withMetadata).not.toHaveBeenCalled();
        expect(harness.instance.keepMetadata).not.toHaveBeenCalled();
    });

    it('bulk never calls withMetadata either', async () => {
        const form = new FormData();
        form.append('file_0', makeFile(JPEG_HEADER, { name: 'a.jpg', type: 'image/jpeg' }));

        await bulkPost(postRequest('http://localhost:3000/api/resize-bulk', form));

        expect(harness.instance.withMetadata).not.toHaveBeenCalled();
        expect(harness.instance.keepMetadata).not.toHaveBeenCalled();
    });
});

describe('encoder options per tool', () => {
    it('compress quantises a PNG, because that is the only lever that shrinks one', async () => {
        await callWith(compressPost, 'compress', { bytes: PNG_HEADER, name: 'a.png', type: 'image/png', fields: { quality: '20' } });

        expect(harness.instance.png).toHaveBeenCalledWith({
            compressionLevel: 9,
            palette: true,
            quality: 20,
            colours: pngPaletteColours(20),
        });
    });

    it('convert leaves a PNG full-colour', async () => {
        await callWith(convertPost, 'convert', { fields: { target_format: 'png' } });

        expect(harness.instance.png).toHaveBeenCalledWith({ compressionLevel: 9 });
    });

    it('resize leaves a PNG full-colour too', async () => {
        await callWith(resizePost, 'resize', { fields: { width: '50', format: 'png' } });

        expect(harness.instance.png).toHaveBeenCalledWith({ compressionLevel: 9 });
    });

    it('convert asks for the AVIF encoder at the default quality', async () => {
        await callWith(convertPost, 'convert', { fields: { target_format: 'avif' } });

        expect(harness.instance.avif).toHaveBeenCalledWith({ quality: DEFAULT_QUALITY });
        expect(harness.instance.jpeg).not.toHaveBeenCalled();
    });

    // The encoder switch has a jpeg default branch, so an unrecognised format
    // must never fall through to it while the response still claims image/avif.
    it.each([
        ['compress', compressPost, 'compress', { quality: '50' }],
        ['crop', cropPost, 'crop', { crop_x: '0', crop_y: '0', crop_width: '10', crop_height: '10' }],
        ['resize', resizePost, 'resize', { width: '50', format: 'avif' }],
    ])('%s never reaches the AVIF encoder', async (_label, handler, path, fields) => {
        await callWith(handler, path, { fields });

        expect(harness.instance.avif).not.toHaveBeenCalled();
    });

    it('compress passes the requested JPEG quality through', async () => {
        await callWith(compressPost, 'compress', { fields: { quality: '37' } });

        expect(harness.instance.jpeg).toHaveBeenCalledWith({ quality: 37 });
    });

    it('compress falls back to quality 80', async () => {
        await callWith(compressPost, 'compress');

        expect(harness.instance.jpeg).toHaveBeenCalledWith({ quality: 80 });
    });

    it('resize asks for both sides when both are supplied', async () => {
        await callWith(resizePost, 'resize', { fields: { width: '40', height: '20' } });

        expect(harness.instance.resize).toHaveBeenCalledWith({ width: 40, height: 20 });
    });

    it('resize asks for one side only when only one is supplied', async () => {
        await callWith(resizePost, 'resize', { fields: { width: '40' } });

        expect(harness.instance.resize).toHaveBeenCalledWith({ width: 40 });
    });

    it('resize skips the resize call entirely when nothing was requested', async () => {
        await callWith(resizePost, 'resize');

        expect(harness.instance.resize).not.toHaveBeenCalled();
    });

    it('crop asks sharp to extract the parsed rectangle', async () => {
        await callWith(cropPost, 'crop', { fields: { crop_x: '5', crop_y: '6', crop_width: '10', crop_height: '11' } });

        expect(harness.instance.extract).toHaveBeenCalledWith({ left: 5, top: 6, width: 10, height: 11 });
    });

    it('bulk reads the output dimensions from the encode instead of decoding twice', async () => {
        const form = new FormData();
        form.append('file_0', makeFile(JPEG_HEADER, { name: 'a.jpg', type: 'image/jpeg' }));

        await bulkPost(postRequest('http://localhost:3000/api/resize-bulk', form));

        expect(harness.instance.toBuffer).toHaveBeenCalledWith({ resolveWithObject: true });
        expect(callsNamed('metadata')).toHaveLength(1);
    });
});

describe('metadata sharp cannot resolve', () => {
    it.each([
        ['an empty metadata object', {}],
        ['null dimensions', { width: null, height: null }],
        ['a zero width', { width: 0, height: 80 }],
        ['a NaN height', { width: 100, height: Number.NaN }],
    ])('turns %s into a 400 from crop, not a 500 from extract', async (_label, metadata) => {
        harness.state.metadata = metadata;

        const response = await callWith(cropPost, 'crop', {
            fields: { crop_x: '0', crop_y: '0', crop_width: '10', crop_height: '10' },
        });

        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({
            error: 'Crop parameters are out of bounds of the original image dimensions.',
        });
        expect(harness.instance.extract).not.toHaveBeenCalled();
    });

    // resize no longer inspects the source for its own sake, so this lands on
    // the derived-side check instead: without a source height there is no
    // aspect ratio, so the height sharp would derive cannot be bounded.
    it('turns unresolvable metadata into a 400 from resize', async () => {
        harness.state.metadata = {};

        const response = await callWith(resizePost, 'resize', { fields: { width: '50' } });

        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({
            error: 'Dimensions exceed maximum allowed values.',
        });
        expect(harness.instance.resize).not.toHaveBeenCalled();
    });

    it('turns unresolvable metadata into a 400 from a scaled resize', async () => {
        harness.state.metadata = {};

        const response = await callWith(resizePost, 'resize', { fields: { scale: '50' } });

        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({
            error: 'Unable to determine the source image dimensions.',
        });
        expect(harness.instance.resize).not.toHaveBeenCalled();
    });
});

describe('failures inside sharp', () => {
    it('masks an encoder failure as a generic 500 with no internals', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        harness.state.toBufferError = new Error('vips_jpegsave: /var/task/tmp/x.jpg permission denied');

        const response = await callWith(resizePost, 'resize', { fields: { width: '50' } });
        const body = await response.text();

        expect(response.status).toBe(500);
        expect(JSON.parse(body)).toEqual({
            error: 'An internal server error occurred while processing the image.',
        });
        expect(body).not.toContain('/var/task');
        expect(body).not.toContain('vips_jpegsave');
        expect(body).not.toContain('stack');
    });

    // resize and crop read metadata() up front; compress and convert go
    // straight to the encoder, so the same throw reaches them from toBuffer().
    it.each([
        ['metadata', 'resize', resizePost, 'resize', { width: '50' }],
        ['metadata', 'crop', cropPost, 'crop', { crop_x: '0', crop_y: '0', crop_width: '10', crop_height: '10' }],
        ['toBuffer', 'compress', compressPost, 'compress', { quality: '50' }],
        ['toBuffer', 'convert', convertPost, 'convert', { target_format: 'png' }],
    ])('turns the pixel-limit throw from %s into a 400 in /%s', async (source, _label, handler, path, fields) => {
        const error = new Error('Input image exceeds pixel limit');
        if (source === 'metadata') harness.state.metadataError = error;
        else harness.state.toBufferError = error;

        const response = await callWith(handler, path, { fields });

        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({ error: 'This image has too many pixels to process.' });
    });

    it('still returns 500 for a failure that is not the pixel limit', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        harness.state.toBufferError = new Error('unsupported image format');

        const response = await callWith(convertPost, 'convert', { fields: { target_format: 'png' } });

        expect(response.status).toBe(500);
        expect(await response.json()).toEqual({
            error: 'An internal server error occurred while converting the image.',
        });
    });

    it('logs the real failure server-side even though the caller sees a generic message', async () => {
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        harness.state.toBufferError = new Error('vips: out of memory');

        await callWith(compressPost, 'compress', { fields: { quality: '50' } });

        // One structured JSON line carrying the route and the real error.
        const logged = errorSpy.mock.calls
            .map(([line]) => line)
            .filter((line) => typeof line === 'string');
        expect(logged.some((line) => line.includes('"route":"compress"') && line.includes('vips: out of memory')))
            .toBe(true);
    });
});
