const { test, expect } = require('../fixtures/resizo');
const { signature } = require('../fixtures/files');
const { inspect } = require('../helpers/output');

test('the signature resizer meets a pixel box and a byte ceiling in one pass', async ({ tool, page }) => {
    test.setTimeout(120_000);

    const saved = await tool.process({
        route: '/signature-resizer',
        h1: 'Signature Resizer for Online Forms',
        file: await signature(),
        // Every number a form gives you is knowable before there is a file, and
        // the page puts the size above the drop zone for exactly that reason.
        before: async () => {
            await page.getByLabel('Width (px)', { exact: true }).fill('300');
            await page.getByLabel('Height (px)', { exact: true }).fill('80');
        },
        // The byte ceiling sits in the Output group under the preview.
        after: () => page.getByLabel('Maximum file size (KB)').fill('15'),
        button: 'Make signature',
        download: 'Download signature',
    });

    await expect(page.getByText('saved as JPG')).toBeVisible();
    await expect(page.getByText('It fits the 15 KB limit you set')).toBeVisible();

    const out = await inspect(saved.file);
    expect(out.format).toBe('jpeg');
    expect(out.width).toBeLessThanOrEqual(300);
    expect(out.height).toBeLessThanOrEqual(80);
    expect(out.bytes).toBeLessThan(15 * 1024);
    expect(saved.filename).toMatch(/\.jpe?g$/);
});
