const { test, expect } = require('../fixtures/resizo');
const { transparent } = require('../fixtures/files');
const { inspect } = require('../helpers/output');

/**
 * What a phone has to keep: the fold, the tap targets, one small real job, and
 * the semantics a screen reader needs.
 *
 * These run on the Pixel 7 and iPhone 14 profiles, and in chromium-full at
 * desktop width, where every assertion below still has to hold — a rule that
 * is only true at 390px is a rule the desktop build can quietly break.
 *
 * THE FOLD IS THE PRODUCT DECISION BEING GUARDED. DESIGN.md makes the tool the
 * hero and puts the drop zone above the fold on a phone, and the pressure
 * against that is constant: every intent page wants its direct answer, its
 * intro and its breadcrumb above the panel, and each of those costs 70-ish
 * pixels of a 640px screen. So two tests measure it rather than trusting it —
 * one on the plain tools, one on the intent pages that carry the extra copy.
 *
 * WHY NO 1600×1067 SAMPLE HERE. A phone profile is where an over-large
 * allocation gets the tab killed, and on iOS it is killed silently: no
 * exception, no error event, the photo is just gone (CLAUDE.md > Gotchas). The
 * one processing test here uses the 320×240 WebP. The bigger jobs live in
 * compat.spec.js, tagged for the browsers that can afford them.
 *
 * None of these carry @smoke: Firefox and WebKit desktop run the compatibility
 * set, not the phone layout.
 */

/** Route, and the label its own drop zone puts on the picker button. */
const FOLD_ROUTES = [
    { route: '/compress-image-to-20kb', browse: 'Browse files' },
    { route: '/resize', browse: 'Choose an image' },
];

/**
 * Tailwind's `md`. Below it the resize platform-size chips collapse behind a
 * toggle and the drop zone rises; at and above it they are always painted,
 * because DESIGN.md also requires settings above the drop zone so a file lands
 * already configured. The two rules only compete on a short wide window, and
 * the design resolves it by width — so this test judges by width too.
 *
 * Measured drop-zone tops, first paint, no scrolling:
 *
 *   iPhone 14   390×664   /resize 436   /compress-image-to-20kb 387
 *   Pixel 7     412×839   /resize 451   /compress-image-to-20kb 387
 *   Desktop    1280×720   /resize 744   /compress-image-to-20kb 619
 *
 * The phone promise holds with room to spare. The 744 is the desktop settings
 * panel, and DESIGN.md's fold sentence is written about "a mid-tier Android
 * phone" — so asserting it at 1280×720 would be asserting a rule the design
 * never made. What every width does owe is the panel itself.
 */
const MD = 768;

/** The intent pages: a tool plus a direct answer, an intro and a breadcrumb. */
const INTENT_ROUTES = ['/compress-image-to-20kb', '/resize-jpg'];

/** The drop zone. It is the first `.checkerboard` on a page that has no result yet. */
const dropzone = (page) => page.locator('.checkerboard').first();

/** The tool panel ToolShell wraps every control in. */
const panel = (page) => page.locator('section[aria-label$="tool"]');

/** The direct answer: the paragraph that follows the panel's own wrapper. */
const directAnswer = (page) => page.locator('div:has(> section[aria-label$="tool"]) + p');

/**
 * Presses a control the way the profile's own hardware would. `.tap()` throws
 * outright on a context without touch, so the desktop run clicks instead —
 * which is the real difference between the two profiles, not a workaround.
 */
async function press(page, locator) {
    const touch = await page.evaluate(() => navigator.maxTouchPoints > 0);
    if (touch) await locator.tap();
    else await locator.click();
}

/** Viewport height and the widths that decide whether the page scrolls sideways. */
function metrics(page) {
    return page.evaluate(() => ({
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
        scrollWidth: document.documentElement.scrollWidth,
    }));
}

/**
 * "The tool is the hero": the working panel is the first thing painted at every
 * width, and on a phone the drop zone inside it is on screen too, with nothing
 * scrolled. boundingBox does not scroll, so these are first-paint coordinates
 * rather than a position the assertion arranged for itself.
 */
async function expectToolAboveTheFold(page) {
    const zone = dropzone(page);
    await expect(zone).toBeVisible();

    const zoneBox = await zone.boundingBox();
    const panelBox = await panel(page).boundingBox();
    const { innerWidth, innerHeight } = await metrics(page);

    expect(zoneBox, 'the drop zone has no box to measure').not.toBeNull();
    expect(panelBox, 'the tool panel has no box to measure').not.toBeNull();

    expect(panelBox.y, `the tool panel starts ${Math.round(panelBox.y)}px down a ${innerHeight}px screen`)
        .toBeLessThan(innerHeight);

    if (innerWidth < MD) {
        expect(zoneBox.y, `at ${innerWidth}px wide the drop zone starts ${Math.round(zoneBox.y)}px down a ${innerHeight}px screen`)
            .toBeLessThan(innerHeight);
    }
}

for (const { route, browse } of FOLD_ROUTES) {
    test(`the drop zone on ${route} is on screen and reachable before anything is scrolled`, {
        tag: ['@mobile'],
    }, async ({ tool, page }) => {
        await tool.open(route);
        await expectToolAboveTheFold(page);

        const { innerWidth, scrollWidth } = await metrics(page);

        // Three intake paths, and the two a phone can use have to be there:
        // the input the picker opens, and the visible button that opens it.
        expect(await page.locator('input[type="file"]').count()).toBeGreaterThanOrEqual(1);
        const browseButton = page.getByRole('button', { name: browse });
        await expect(browseButton).toBeVisible();
        await expect(browseButton).toBeEnabled();

        // A phone has no horizontal scrollbar to warn you, so an overflowing
        // element just cuts the page off at the right edge.
        expect(scrollWidth, 'the document is wider than the screen').toBeLessThanOrEqual(innerWidth);
    });
}

test('the compress controls answer a tap, and the button wakes up once a file is in', {
    tag: ['@mobile'],
}, async ({ tool, page }) => {
    const fixture = await transparent();

    await tool.open('/compress', { h1: 'Compress Images Online' });

    const targetMode = page.getByRole('radio', { name: 'To a target size' });
    await press(page, targetMode);
    await expect(targetMode).toBeChecked();

    // The target field only exists in target mode, so its appearance is the
    // proof the tap changed the settings rather than only the radio's own dot.
    const target = page.getByLabel('Target size', { exact: true });
    await expect(target).toBeVisible();
    await target.fill('40');
    await expect(target).toHaveValue('40');
    await expect(page.getByLabel('Target size unit')).toHaveValue('KB');

    // Nothing to compress yet, so the action is inert on arrival and live once
    // there is a file — the affordance a phone visitor reads as "your turn".
    const compress = page.getByRole('button', { name: 'Compress image' });
    await expect(compress).toBeDisabled();
    await tool.pick(fixture);
    await expect(compress).toBeEnabled();
});

test('a small conversion runs to a real downloaded file on a phone', {
    tag: ['@mobile'],
}, async ({ tool }) => {
    const fixture = await transparent();

    const saved = await tool.process({
        route: '/webp-to-png',
        h1: 'Convert WebP to PNG',
        file: fixture,
        button: 'Convert to PNG',
        download: 'Download PNG',
    });

    const out = await inspect(saved.file);
    expect(out.format).toBe('png');
    expect(out.hasAlpha).toBe(true);
    expect(out.width).toBe(320);
    expect(out.height).toBe(240);
});

for (const route of INTENT_ROUTES) {
    test(`the direct answer on ${route} sits under the panel instead of pushing it down`, {
        tag: ['@mobile'],
    }, async ({ tool, page }) => {
        await tool.open(route);

        // The extra copy an intent page carries — a breadcrumb, an intro, a
        // formats line — is exactly what would push the tool down, so the same
        // fold rule is measured here as on the plain tool routes.
        await expectToolAboveTheFold(page);

        // The answer is the page's SEO body, and it is real: an intent page
        // without one would make the position assertion below vacuous.
        const answer = directAnswer(page);
        await expect(answer).toHaveCount(1);
        expect((await answer.textContent()).trim().length).toBeGreaterThan(200);

        const panelBox = await panel(page).boundingBox();
        const answerBox = await answer.boundingBox();
        expect(answerBox.y, 'the direct answer is not below the tool panel')
            .toBeGreaterThanOrEqual(panelBox.y + panelBox.height);
    });
}

for (const { route } of FOLD_ROUTES) {
    test(`${route} keeps the landmarks and the names a screen reader needs`, {
        tag: ['@mobile'],
    }, async ({ tool, page }) => {
        await tool.open(route);

        await expect(page.locator('h1')).toHaveCount(1);
        await expect(page.getByRole('main')).toHaveCount(1);

        // Every control a person can reach has to say what it is. Read from the
        // DOM rather than from a locator list because the question is about
        // each element's own labelling, and `page.accessibility` is deprecated.
        const controls = await page.evaluate(() => {
            const named = (el) => Boolean(
                el.labels?.length || el.getAttribute('aria-label') || el.getAttribute('aria-labelledby'),
            );
            const onScreen = (el) => {
                const style = getComputedStyle(el);
                if (style.display === 'none' || style.visibility === 'hidden') return false;
                const rect = el.getBoundingClientRect();
                return rect.width > 0 && rect.height > 0;
            };
            const all = Array.from(document.querySelectorAll('input, select, textarea')).filter(onScreen);
            return {
                total: all.length,
                unnamed: all.filter((el) => !named(el)).map((el) => `${el.tagName.toLowerCase()}#${el.id || '(no id)'}[type=${el.getAttribute('type') || 'text'}]`),
            };
        });

        // The self-check. An empty control list has no unnamed control in it,
        // so without this line the assertion below passes on a blank page.
        expect(controls.total, 'no form controls were found to check').toBeGreaterThan(0);
        expect(controls.unnamed, 'controls with no accessible name').toEqual([]);

        // The drop zone's input is visually hidden and named by a <label>, not
        // by text beside it — the one control whose name is easiest to lose.
        const zoneInputNamed = await page.locator('.checkerboard input[type="file"]').first()
            .evaluate((el) => Boolean(el.labels?.length || el.getAttribute('aria-label')));
        expect(zoneInputNamed, 'the drop zone file input has no accessible name').toBe(true);

        // A CSS locator, not a role one: the header's menu button is display:none
        // from md up, and it has to carry its state at every width regardless.
        await expect(page.locator('button[aria-controls="mobile-nav-panel"]'))
            .toHaveAttribute('aria-expanded', 'false');
    });
}
