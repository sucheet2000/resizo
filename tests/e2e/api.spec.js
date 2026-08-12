const { readFileSync } = require('node:fs');
const path = require('node:path');

const { expect, test } = require('@playwright/test');

/**
 * The image routes as a client sees them: a real JPEG in, real bytes out, with
 * the security gates (magic bytes, formats) enforced. The rate limiter fails
 * open here because Upstash is unconfigured, so nothing is throttled.
 */
const FIXTURE = path.join(__dirname, '..', '..', 'public', 'samples', 'square-1200x1200.jpg');
const jpeg = () => ({ name: 'square.jpg', mimeType: 'image/jpeg', buffer: readFileSync(FIXTURE) });

test('health endpoint reports liveness', async ({ request }) => {
    const res = await request.get('/api/health');
    expect(res.status()).toBe(200);
    expect((await res.json()).status).toBe('ok');
});

test('resize returns an image at the requested width', async ({ request }) => {
    const res = await request.post('/api/resize', { multipart: { file: jpeg(), width: '400' } });
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('image/');
    expect((await res.body()).length).toBeGreaterThan(0);
});

test('compress hits a target file size', async ({ request }) => {
    const res = await request.post('/api/compress', { multipart: { file: jpeg(), targetBytes: String(60 * 1024) } });
    expect(res.status()).toBe(200);
    const output = Number(res.headers()['x-output-size']);
    expect(output).toBeGreaterThan(0);
    expect(output).toBeLessThanOrEqual(60 * 1024);
});

test('convert produces WebP and AVIF', async ({ request }) => {
    const webp = await request.post('/api/convert', { multipart: { file: jpeg(), target_format: 'webp' } });
    expect(webp.status()).toBe(200);
    expect(webp.headers()['content-type']).toContain('image/webp');

    const avif = await request.post('/api/convert', { multipart: { file: jpeg(), target_format: 'avif' } });
    expect(avif.status()).toBe(200);
    expect(avif.headers()['content-type']).toContain('image/avif');
});

test('a non-image body is rejected with 400, not a 500', async ({ request }) => {
    const res = await request.post('/api/compress', {
        multipart: { file: { name: 'notreally.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('this is plain text, not a jpeg') } },
    });
    expect(res.status()).toBe(400);
});

test('convert rejects an unsupported target format', async ({ request }) => {
    const res = await request.post('/api/convert', { multipart: { file: jpeg(), target_format: 'tiff' } });
    expect(res.status()).toBe(400);
});
