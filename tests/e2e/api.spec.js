const { readFileSync } = require('node:fs');
const path = require('node:path');

const { expect, test } = require('@playwright/test');

/**
 * The HTTP surface, as a client sees it.
 *
 * This file used to POST a real JPEG at six image routes and check the bytes
 * that came back. Those routes are gone: every tool runs in the visitor's
 * browser and nothing is uploaded, ever. So the assertions have inverted — what
 * is proved here now is the ABSENCE of an upload surface, against a real
 * production build rather than against a grep.
 *
 * This is worth an end-to-end test rather than a unit one precisely because it
 * is a claim about deployment. A route file re-added by a merge, or a rewrite
 * left in a config, would be invisible to every unit test in the repo and would
 * show up here as a 200 where a 404 belongs.
 */
const FIXTURE = path.join(__dirname, '..', '..', 'public', 'samples', 'square-1200x1200.jpg');
const jpeg = () => ({ name: 'square.jpg', mimeType: 'image/jpeg', buffer: readFileSync(FIXTURE) });

/** Every route that ever accepted an image, plus the token endpoint behind them. */
const REMOVED_ROUTES = [
    '/api/resize',
    '/api/resize-bulk',
    '/api/compress',
    '/api/convert',
    '/api/crop',
    '/api/heic',
    '/api/blob/upload',
];

test('health endpoint reports liveness', async ({ request }) => {
    const res = await request.get('/api/health');
    expect(res.status()).toBe(200);

    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(typeof body.time).toBe('string');
});

test('health does no dependency probing, whatever the query string asks for', async ({ request }) => {
    const res = await request.get('/api/health?deep=1');
    expect(res.status()).toBe(200);
    expect((await res.json()).checks).toBeUndefined();
});

for (const route of REMOVED_ROUTES) {
    test(`${route} does not exist to upload an image to`, async ({ request }) => {
        const res = await request.post(route, { multipart: { file: jpeg(), width: '400' } });
        expect(res.status()).toBe(404);
    });
}

test('a JSON body reaches no upload handler either', async ({ request }) => {
    // The blob path took its work as JSON rather than multipart, so a 404 on
    // the multipart form alone would not have covered it.
    const res = await request.post('/api/compress', {
        data: { blobUrl: 'https://example.invalid/photo.jpg', filename: 'photo.jpg', quality: '70' },
    });
    expect(res.status()).toBe(404);
});
