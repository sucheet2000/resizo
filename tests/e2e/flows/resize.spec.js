const path = require('node:path');

const { test, expect } = require('../fixtures/resizo');
const { inspect } = require('../helpers/output');

/**
 * The tool as a person uses it: drop a file, run it, get a result. This is the
 * flow no unit test exercises — the hook, the worker, the download affordance.
 */
const SAMPLE = path.join(__dirname, '..', '..', '..', 'public', 'samples', 'landscape-1600x1067.jpg');

test('resize processes a real file end to end and the download is the size asked for', async ({ tool, page }) => {
    const saved = await tool.process({
        route: '/resize',
        file: SAMPLE,
        // The panel adopts the source size on intake, so the width goes in after the file.
        after: () => page.getByLabel('Width (px)', { exact: true }).fill('800'),
        button: /resize image/i,
    });
    const out = await inspect(saved.file);

    expect(out.format).toBe('jpeg');
    expect(out.width).toBe(800);
    expect(out.height).toBeGreaterThanOrEqual(533);
    expect(out.height).toBeLessThanOrEqual(534);
    expect(saved.filename).toMatch(/^resizo-.*\.jpe?g$/);
});

test('the resize tool is above the fold on a mid-tier phone', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto('/resize');
    const top = await page.locator('.checkerboard').first().evaluate((el) => el.getBoundingClientRect().top);
    expect(top).toBeLessThan(800);
});
