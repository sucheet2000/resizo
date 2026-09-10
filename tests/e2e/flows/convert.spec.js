const path = require('node:path');

const { test, expect } = require('../fixtures/resizo');
const { transparent } = require('../fixtures/files');
const { inspect, transparentShare } = require('../helpers/output');

const SAMPLE = path.join(__dirname, '..', '..', '..', 'public', 'samples', 'landscape-1600x1067.jpg');

test('WebP to PNG keeps the transparency the JPG route would have filled in', async ({ tool }) => {
    test.setTimeout(120_000);

    const saved = await tool.process({
        route: '/webp-to-png',
        h1: 'Convert WebP to PNG',
        file: await transparent(),
        button: 'Convert to PNG',
    });
    const out = await inspect(saved.file);

    expect(out.format).toBe('png');
    // The one thing this page exists for. A JPEG route would have made this false.
    expect(out.hasAlpha).toBe(true);
    expect(await transparentShare(saved.file)).toBeGreaterThan(0.5);
    expect(out.width).toBe(320);
    expect(out.height).toBe(240);
});

test('resizing a WebP gives back a WebP at the width that was asked for', async ({ tool, page }) => {
    test.setTimeout(120_000);

    const saved = await tool.process({
        route: '/resize-webp',
        h1: 'Resize a WebP',
        file: await transparent(),
        // The file goes first: an unconfigured panel adopts the source
        // dimensions on intake, so a width typed before the drop is the one it
        // overwrites.
        after: () => page.getByLabel('Width (px)', { exact: true }).fill('400'),
        button: 'Resize image',
    });
    const out = await inspect(saved.file);

    // No preset on this page, so the format select stays on "Same as the
    // original" — a WebP in has to be a WebP out.
    expect(out.format).toBe('webp');
    expect(out.width).toBe(400);
});

test('the lazily loaded tool hydrates on an intent page and converts with the preset', async ({ tool }) => {
    test.setTimeout(120_000);

    const saved = await tool.process({
        route: '/jpg-to-webp',
        h1: 'Convert JPG to WebP',
        file: SAMPLE,
        button: /convert to webp/i,
    });
    const out = await inspect(saved.file);

    expect(out.format).toBe('webp');
    expect(out.width).toBe(1600);
    expect(out.height).toBe(1067);
});
