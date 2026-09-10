const path = require('node:path');

const { test, expect } = require('../fixtures/resizo');
const { inspect } = require('../helpers/output');

/**
 * The two compress policies, through the two ceiling pages that default to
 * them. The panel's sentence is read as part of the flow; the file is what
 * proves the size.
 */
const SAMPLE = path.join(__dirname, '..', '..', '..', 'public', 'samples', 'landscape-1600x1067.jpg');

/** A compress-to-target search runs up to eight full encodes, plus a WASM fetch. */
const HEAVY = 120_000;

test('the 20 KB page opens on the policy that may shrink, and the file lands under the ceiling', async ({ tool, page }) => {
    test.setTimeout(HEAVY);

    await tool.open('/compress-image-to-20kb', { h1: 'Compress an Image to 20 KB' });

    // The whole point of this page against its 100 KB sibling: at 20 KB the
    // pixels are allowed to move, and the visitor is told that before they
    // drop anything rather than after.
    await expect(page.getByRole('radio', { name: 'Shrink to fit' })).toBeChecked();
    await expect(page.getByRole('radio', { name: 'Keep the dimensions' })).not.toBeChecked();

    await tool.pick(SAMPLE);
    await tool.run('Compress image', { download: 'Download compressed image', timeout: 60_000 });
    await expect(page.getByText('Asked for 20 KB')).toBeVisible();

    const saved = await tool.download('Download compressed image');
    const out = await inspect(saved.file);

    expect(out.format).toBe('jpeg');
    expect(out.bytes).toBeLessThanOrEqual(20 * 1024);
    // The fit policy is allowed to shrink, and a 1.7-megapixel scene cannot
    // reach 20 KB at full size, so the download is smaller than the source.
    expect(out.width).toBeLessThan(1600);
});

test('the 100 KB page opens on the policy that never touches the pixels, and keeps them', async ({ tool, page }) => {
    test.setTimeout(HEAVY);

    await tool.open('/compress-image-to-100kb', { h1: 'Compress an Image to 100 KB' });
    await expect(page.getByRole('radio', { name: 'Keep the dimensions' })).toBeChecked();
    await expect(page.getByRole('radio', { name: 'Shrink to fit' })).not.toBeChecked();

    await tool.pick(SAMPLE);
    await tool.run('Compress image', { download: 'Download compressed image', timeout: 60_000 });

    const saved = await tool.download('Download compressed image');
    const out = await inspect(saved.file);

    expect(out.format).toBe('jpeg');
    expect(out.bytes).toBeLessThanOrEqual(100 * 1024);
    expect(out.width).toBe(1600);
    expect(out.height).toBe(1067);
});
