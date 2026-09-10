const { test, expect } = require('../fixtures/resizo');

/**
 * Pages that load and link as promised. The browser-error guard in the shared
 * fixture is what turns "the headline is visible" into "and nothing threw on
 * the way" — the crop page once rendered its headline over a dead panel
 * because `new Image()` resolved to the React component.
 */
test('the crop tool loads without the old new Image() crash', async ({ page }) => {
    await page.goto('/crop');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
});

test('the hubs link every expansion page they own', async ({ page }) => {
    await page.goto('/tools');
    const directory = page.getByRole('main');
    for (const href of ['/signature-resizer', '/change-image-dpi', '/remove-image-metadata']) {
        await expect(directory.locator(`a[href="${href}"]`), `/tools → ${href}`).toHaveCount(1);
    }

    await page.goto('/compress');
    const compress = page.getByRole('main');
    for (const href of ['/compress-image-to-20kb', '/compress-image-to-50kb']) {
        await expect(compress.locator(`a[href="${href}"]`), `/compress → ${href}`).toHaveCount(1);
    }

    await page.goto('/heic');
    await expect(page.getByRole('main').locator('a[href="/heic-to-png"]'), '/heic → /heic-to-png').toHaveCount(1);
});
