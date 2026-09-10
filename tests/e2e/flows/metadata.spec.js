const fs = require('node:fs');

const { test, expect } = require('../fixtures/resizo');
const { exifGpsJpeg } = require('../fixtures/files');
const { inspect } = require('../helpers/output');

test('the metadata tool names the camera and the coordinates, then removes them', async ({ tool, page }) => {
    test.setTimeout(120_000);

    const fixture = await exifGpsJpeg();
    const sourceBytes = fs.statSync(fixture).size;

    await tool.open('/remove-image-metadata');
    await tool.pick(fixture);

    const readout = page.getByRole('status').filter({ hasText: 'What this file carries' });
    await expect(readout).toBeVisible();
    await expect(readout).toContainText('Camera and capture data (EXIF)');
    await expect(readout).toContainText('Location (GPS coordinates)');

    await tool.run('Remove metadata', { download: 'Download clean image' });
    const saved = await tool.download('Download clean image');
    const out = await inspect(saved.file);

    expect(out.hasExif).toBe(false);
    // The picture is copied through byte for byte; only the blocks around it go.
    expect(out.width).toBe(800);
    expect(out.height).toBe(600);
    expect(out.bytes).toBeLessThan(sourceBytes);
});
