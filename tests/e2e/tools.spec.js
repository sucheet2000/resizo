const path = require('node:path');

const { expect, test } = require('@playwright/test');

/**
 * The tool as a person uses it: drop a file, run it, get a result. This is the
 * flow no unit test exercises — the hook, the fetch, the download affordance.
 */
const FIXTURE = path.join(__dirname, '..', '..', 'public', 'samples', 'landscape-1600x1067.jpg');

test('resize processes a real upload end to end', async ({ page }) => {
    await page.goto('/resize');

    await page.getByLabel('Width (px)').fill('800');
    await page.locator('input[type="file"]').first().setInputFiles(FIXTURE);

    await page.getByRole('button', { name: /resize image/i }).click();

    // A Download affordance replaces the submit button on success.
    await expect(
        page.getByRole('link', { name: /download/i }).or(page.getByRole('button', { name: /download/i })),
    ).toBeVisible({ timeout: 30_000 });
});

test('the resize tool is above the fold on a mid-tier phone', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto('/resize');
    const top = await page.locator('.checkerboard').first().evaluate((el) => el.getBoundingClientRect().top);
    expect(top).toBeLessThan(800);
});

test('the crop tool loads without the old new Image() crash', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await page.goto('/crop');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    expect(errors.join('\n')).not.toMatch(/Image is not a constructor/);
});
