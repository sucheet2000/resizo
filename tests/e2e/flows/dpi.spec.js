const { test, expect } = require('../fixtures/resizo');
const { exifGpsJpeg } = require('../fixtures/files');
const { inspect } = require('../helpers/output');

test('the DPI tool reads what a file claims and writes what was asked for', async ({ tool, page }) => {
    test.setTimeout(120_000);

    await tool.open('/change-image-dpi');
    await tool.pick(await exifGpsJpeg());

    // The checker opens on intake, before any control is touched: the visitor
    // arrived holding somebody else's sentence about their file. The live
    // region is named by the readout heading and holds only the file-derived
    // rows, so the row that follows the DPI field does not re-announce on
    // every keystroke.
    const readout = page.getByRole('status', { name: 'What this file says' });
    await expect(readout).toBeVisible();
    // sharp records a JPEG's density in the EXIF block and writes no JFIF APP0,
    // so the source named here is the EXIF one.
    await expect(readout).toContainText('72 × 72 DPI, from the EXIF block');
    await expect(readout).toContainText('800 × 600 px');

    await page.getByRole('button', { name: 'Print 300' }).click();
    await expect(page.getByLabel('New DPI')).toHaveValue('300');

    await tool.run('Set DPI', { download: 'Download image' });
    await expect(page.getByText('It now says 300 × 300 DPI')).toBeVisible();

    const saved = await tool.download('Download image');
    const out = await inspect(saved.file);

    expect(out.density).toBe(300);
    // A DPI change adds or removes no pixels. This is the assertion that would
    // catch a "set DPI" that quietly resampled.
    expect(out.width).toBe(800);
    expect(out.height).toBe(600);
});
