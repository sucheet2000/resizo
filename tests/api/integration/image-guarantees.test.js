/**
 * Real-sharp integration.
 *
 * These are the promises no mock can keep: that EXIF really is gone from the
 * bytes we hand back, that a transparent PNG really survives a bulk job, and
 * that the compression slider really changes the file. Nothing is stubbed here
 * except the rate limiter.
 */
import JSZip from 'jszip';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { POST as compressPost } from '@/app/api/compress/route';
import { POST as convertPost } from '@/app/api/convert/route';
import { POST as cropPost } from '@/app/api/crop/route';
import { POST as resizePost } from '@/app/api/resize/route';
import { POST as bulkPost } from '@/app/api/resize-bulk/route';
import { allowLimiter, clearLimiters } from '../helpers/limiter';
import { gradientJpegBytes, gradientPngBytes, jpegBytes, jpegWithExif, pngBytes } from '../helpers/fixtures';
import { buildFormData, makeFile, postRequest, readBytes } from '../helpers/request';

const EXIF_MARKER = 'RESIZO-EXIF-MARKER';

function call(handler, path, { bytes, name = 'photo.jpg', type = 'image/jpeg', fields = {} }) {
    const body = buildFormData({ file: makeFile(bytes, { name, type }), fields });
    return handler(postRequest(`http://localhost:3000/api/${path}`, body));
}

async function uniqueColours(buffer) {
    const { data, info } = await sharp(buffer).raw().toBuffer({ resolveWithObject: true });
    const seen = new Set();
    for (let i = 0; i < data.length; i += info.channels) {
        seen.add((data[i] << 16) | (data[i + 1] << 8) | data[i + 2]);
    }
    return seen.size;
}

beforeEach(() => {
    clearLimiters();
    for (const bucket of ['resize', 'compress', 'convert', 'crop', 'bulk']) allowLimiter(bucket);
});

afterEach(() => {
    clearLimiters();
});

describe('EXIF and GPS never survive a round trip', () => {
    it('the fixture really carries EXIF going in', async () => {
        const source = await jpegWithExif();

        expect((await sharp(source).metadata()).exif).toBeDefined();
        expect(source.includes(EXIF_MARKER)).toBe(true);
    });

    it.each([
        ['resize', resizePost, 'resize', { width: '30' }],
        ['compress', compressPost, 'compress', { quality: '70' }],
        ['convert', convertPost, 'convert', { target_format: 'jpeg' }],
        ['crop', cropPost, 'crop', { crop_x: '0', crop_y: '0', crop_width: '20', crop_height: '20' }],
    ])('/api/%s returns an image with no EXIF block', async (_label, handler, path, fields) => {
        const response = await call(handler, path, { bytes: await jpegWithExif(), fields });
        const output = await readBytes(response);

        expect(response.status).toBe(200);
        expect((await sharp(output).metadata()).exif).toBeUndefined();
        expect(output.includes(EXIF_MARKER)).toBe(false);
    });

    it('converting to PNG carries nothing over either', async () => {
        const response = await call(convertPost, 'convert', {
            bytes: await jpegWithExif(),
            fields: { target_format: 'png' },
        });
        const output = await readBytes(response);

        expect((await sharp(output).metadata()).exif).toBeUndefined();
        expect(output.includes(EXIF_MARKER)).toBe(false);
    });

    it('bulk resize strips it too', async () => {
        const form = new FormData();
        form.append('file_0', makeFile(await jpegWithExif(), { name: 'holiday.jpg', type: 'image/jpeg' }));

        const response = await bulkPost(postRequest('http://localhost:3000/api/resize-bulk', form));
        const zip = await JSZip.loadAsync(await readBytes(response));
        const [entry] = Object.keys(zip.files);
        const output = await zip.file(entry).async('nodebuffer');

        expect((await sharp(output).metadata()).exif).toBeUndefined();
        expect(output.includes(EXIF_MARKER)).toBe(false);
    });
});

describe('pixels come back the size that was asked for', () => {
    it('resizes a 100x100 JPEG to a width of 50', async () => {
        const source = await sharp({ create: { width: 100, height: 100, channels: 3, background: '#336699' } })
            .jpeg()
            .toBuffer();

        const response = await call(resizePost, 'resize', { bytes: source, fields: { width: '50' } });

        expect(await sharp(await readBytes(response)).metadata()).toMatchObject({ width: 50, height: 50 });
    });

    it('crops a 20x20 window out of a 50x50 JPEG', async () => {
        const source = await sharp({ create: { width: 50, height: 50, channels: 3, background: '#336699' } })
            .jpeg()
            .toBuffer();

        const response = await call(cropPost, 'crop', {
            bytes: source,
            fields: { crop_x: '10', crop_y: '10', crop_width: '20', crop_height: '20' },
        });

        expect(await sharp(await readBytes(response)).metadata()).toMatchObject({ width: 20, height: 20 });
    });
});

/**
 * One 48MP buffer — an ordinary 8000x6000 phone photo — through two tools. The
 * decode used to be capped at the 40MP output budget, so sharp threw before
 * either handler saw a pixel and the caller got 'too many pixels to process'
 * for the most common photo on earth.
 */
describe('an ordinary 48MP phone photo goes through the tools', () => {
    it('resizes it to 4000x3000 at scale 50', async () => {
        const response = await call(resizePost, 'resize', {
            bytes: await jpegBytes({ width: 8000, height: 6000 }),
            fields: { scale: '50' },
        });

        expect(response.status).toBe(200);
        expect(await sharp(await readBytes(response)).metadata()).toMatchObject({ width: 4000, height: 3000 });
    });

    it('compresses it at quality 70 with no resize step', async () => {
        const response = await call(compressPost, 'compress', {
            bytes: await jpegBytes({ width: 8000, height: 6000 }),
            fields: { quality: '70' },
        });

        expect(response.status).toBe(200);
        expect(await sharp(await readBytes(response)).metadata()).toMatchObject({ width: 8000, height: 6000 });
    });
});

describe('a transparent PNG survives a bulk job', () => {
    it('keeps the alpha channel when the config asks for the original format', async () => {
        const form = new FormData();
        form.append('file_0', makeFile(await pngBytes({ width: 40, height: 30, alpha: true }), {
            name: 'transparent.png',
            type: 'image/png',
        }));
        form.append('config_0', JSON.stringify({ format: 'original' }));

        const response = await bulkPost(postRequest('http://localhost:3000/api/resize-bulk', form));
        const zip = await JSZip.loadAsync(await readBytes(response));
        const [entry] = Object.keys(zip.files);
        const output = await zip.file(entry).async('nodebuffer');
        const meta = await sharp(output).metadata();

        expect(entry).toBe('resizo-transparent-40x30.png');
        expect(meta.format).toBe('png');
        expect(meta.hasAlpha).toBe(true);
    });

    it('flattens to JPEG only when the caller explicitly asks for JPEG', async () => {
        const form = new FormData();
        form.append('file_0', makeFile(await pngBytes({ width: 40, height: 30, alpha: true }), {
            name: 'transparent.png',
            type: 'image/png',
        }));
        form.append('config_0', JSON.stringify({ format: 'jpeg' }));

        const response = await bulkPost(postRequest('http://localhost:3000/api/resize-bulk', form));
        const zip = await JSZip.loadAsync(await readBytes(response));
        const [entry] = Object.keys(zip.files);

        expect(entry).toBe('resizo-transparent-40x30.jpg');
        expect((await sharp(await zip.file(entry).async('nodebuffer')).metadata()).format).toBe('jpeg');
    });
});

describe('the compression slider actually changes the file', () => {
    it('shrinks a PNG at quality 20 relative to quality 90', async () => {
        const source = await gradientPngBytes();

        const low = await readBytes(await call(compressPost, 'compress', {
            bytes: source, name: 'gradient.png', type: 'image/png', fields: { quality: '20' },
        }));
        const high = await readBytes(await call(compressPost, 'compress', {
            bytes: source, name: 'gradient.png', type: 'image/png', fields: { quality: '90' },
        }));

        expect(low.length).toBeLessThan(high.length);
    });

    it('shrinks a JPEG at quality 20 relative to quality 90', async () => {
        const source = await gradientJpegBytes();

        const low = await readBytes(await call(compressPost, 'compress', { bytes: source, fields: { quality: '20' } }));
        const high = await readBytes(await call(compressPost, 'compress', { bytes: source, fields: { quality: '90' } }));

        expect(low.length).toBeLessThan(high.length);
    });

    it('leaves /api/convert full-colour while /api/compress quantises', async () => {
        const source = await gradientPngBytes();

        const converted = await readBytes(await call(convertPost, 'convert', {
            bytes: source, name: 'gradient.png', type: 'image/png', fields: { target_format: 'png' },
        }));
        const compressed = await readBytes(await call(compressPost, 'compress', {
            bytes: source, name: 'gradient.png', type: 'image/png', fields: { quality: '20' },
        }));

        expect(await uniqueColours(compressed)).toBeLessThanOrEqual(64);
        expect(await uniqueColours(converted)).toBeGreaterThan(1000);
    });
});
