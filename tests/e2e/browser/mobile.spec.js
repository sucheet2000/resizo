const fs = require('node:fs');

const { test, expect } = require('../fixtures/resizo');
const {
    bulkPhoto, portrait, transparent, transparentPng,
} = require('../fixtures/files');
const { inspect, transparentShare } = require('../helpers/output');
const { readZip } = require('../helpers/zip');

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
 * plain processing test here uses the 320×240 WebP. The bigger jobs live in
 * compat.spec.js, tagged for the browsers that can afford them.
 *
 * The passport flow is the one exception, and it is a deliberate one: its
 * subject is a control that only exists on this site at a phone width — a
 * frame you drag a face around inside — and a frame cannot be dragged in a
 * 320×240 test that has no frame. It runs on the 1200×1600 portrait, 1.9 MP,
 * which is the same order as the 1.7 MP sample the resize test above already
 * carries on these profiles. That is the ceiling, not a new licence: anything
 * larger belongs in compat.spec.js.
 *
 * The bulk batches are the second exception, and they are bounded the same way.
 * Their subject is a workflow a phone meets differently from a laptop — several
 * files chosen at once, a queue of results that has to stay on screen at 390px,
 * and a download that is an archive rather than a picture — so it cannot be
 * proved on one small file. Each runs TWO: the 1.7 MP batch photo and the
 * 480×320 transparent PNG. A batch is worked one file at a time, so the peak
 * allocation is a single 1.7 MP job rather than the sum of the queue, which is
 * what keeps these at the same ceiling the passport flow sits at instead of
 * above it. The three-photo batches are tagged @smoke in compat.spec.js, for
 * the desktop engines that can afford them.
 *
 * There are two of them because they are two products on one platform, and the
 * half a phone can break independently is the second one: converting runs this
 * browser's own WebP encoder once per file, and a phone's encoder is the piece
 * least like a laptop's.
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

test('the passport frame can be dragged with a finger and the photo still downloads', {
    tag: ['@mobile'],
}, async ({ tool, page }) => {
    test.setTimeout(150_000);

    await tool.open('/passport-photo', { h1: 'Make a Passport or ID Photo to Exact Size' });

    // The preset carries every number, which is the point of it on a phone:
    // four fields typed on a 390px keyboard is the flow this chip replaces.
    await press(page, page.getByRole('button', { name: 'United States Printed' }));
    await tool.pick(await portrait());

    const frame = page.locator('#passport-frame');
    await expect(frame).toBeVisible();
    await frame.scrollIntoViewIfNeeded();

    // The frame is a fixed-aspect box up to 420px wide on a 390px screen, so
    // it is the newest thing on this site that could push the document wider
    // than the window — and a phone has no horizontal scrollbar to warn you.
    const { innerWidth, scrollWidth } = await metrics(page);
    expect(scrollWidth, 'the passport page is wider than the screen').toBeLessThanOrEqual(innerWidth);

    const position = page.getByText(/^Keeping \d+×\d+ pixels from/);
    const before = await position.textContent();

    const box = await frame.boundingBox();
    expect(box, 'the frame has no box to drag').not.toBeNull();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.15, { steps: 10 });
    await page.mouse.up();

    // The self-check. A drag that never reached the element leaves the
    // rectangle where it was, and every assertion after it would then be
    // describing the default crop while claiming to describe a dragged one.
    expect(await position.textContent(), 'the frame did not move under the drag').not.toBe(before);

    await tool.run('Make photo', { download: 'Download photo', timeout: 90_000 });
    const saved = await tool.download('Download photo');

    const out = await inspect(saved.file);
    expect(out.format).toBe('jpeg');
    expect(out.width).toBe(600);
    expect(out.height).toBe(600);
    expect(out.density).toBe(300);
});

test('a batch of two runs on a phone, keeps the page inside the screen, and saves an archive', {
    tag: ['@mobile'],
}, async ({ tool, page }) => {
    // One 1.7 MP target search, one trivial one, a ZIP, and a phone profile's
    // slower everything. The passport test above budgets 150 s for a single
    // 1.9 MP job; this is that plus an archive.
    test.setTimeout(180_000);

    const files = [await bulkPhoto(1), await transparentPng()];

    await tool.open('/bulk-image-compressor', { h1: 'Compress Many Images to a Maximum File Size' });

    const before = await metrics(page);
    expect(before.scrollWidth, 'the page is wider than the screen before anything is chosen')
        .toBeLessThanOrEqual(before.innerWidth);

    // Confirmed rather than tapped: PresetChips reads a press on the active
    // chip as "unselect", and 200 KB is this page's default.
    const ceiling = page.getByRole('button', { name: '200 KB' });
    if ((await ceiling.getAttribute('aria-pressed')) !== 'true') await press(page, ceiling);
    await expect(ceiling).toHaveAttribute('aria-pressed', 'true');

    // Two files through the one input, and the network guard flagged the way
    // tool.pick flags it — the no-upload promise is proved from the request
    // log on every flow, and a batch is where the most bytes are in play.
    tool.network.processed = true;
    await page.locator('input[type="file"]').first().setInputFiles(files);

    const compress = page.getByRole('button', { name: 'Compress 2 images' });
    await expect(compress).toBeEnabled({ timeout: 20_000 });
    await press(page, compress);

    const zipButton = page.getByRole('button', { name: /Download all as ZIP \(2\)/ });
    await expect(zipButton).toBeVisible({ timeout: 120_000 });

    // The result rows carry the widest content on this page — a file name, a
    // byte pair, a dimensions pair and a button — and a phone has no horizontal
    // scrollbar to warn anyone that they have run off the right edge.
    const after = await metrics(page);
    expect(after.scrollWidth, 'the results push the page wider than the screen')
        .toBeLessThanOrEqual(after.innerWidth);

    // One file saved on its own, the way somebody who wanted only that one
    // would save it.
    const photoRow = page.locator('ul[aria-label="Results"] > li[data-name="bulk-photo-1.jpg"]');
    await expect(photoRow).toHaveAttribute('data-status', 'success');

    const [saved] = await Promise.all([
        page.waitForEvent('download'),
        press(page, photoRow.getByRole('button', { name: /^Download .+-compressed\./ })),
    ]);
    const savedFile = await saved.path();
    expect(savedFile, 'the row download produced no file').toBeTruthy();

    const out = await inspect(savedFile);
    expect(out.format).toBe('jpeg');
    expect(out.width).toBe(1600);
    expect(out.height).toBe(1067);
    expect(out.bytes).toBeLessThanOrEqual(200 * 1024);

    // And then the archive, which on a phone is the only practical way to keep
    // a batch. It is opened rather than counted from the button's own label.
    const [archive] = await Promise.all([page.waitForEvent('download'), press(page, zipButton)]);
    const archiveFile = await archive.path();
    expect(archiveFile, 'the ZIP button produced no file').toBeTruthy();
    expect(archive.suggestedFilename()).toBe('resizo-compressed-images.zip');

    const entries = await readZip(archiveFile);
    expect(entries.map((entry) => entry.name)).toEqual([
        'bulk-photo-1-compressed.jpg',
        'transparent-480x320-compressed.png',
    ]);
});

test('a batch converted to one format runs on a phone and saves an archive that kept its transparency', {
    tag: ['@mobile'],
}, async ({ tool, page }, testInfo) => {
    // One 1.7 MP WebP encode, one trivial one, a ZIP, and a phone profile's
    // slower everything. Cheaper than the compressing batch above — a
    // conversion is one encode per file rather than a byte search — so the
    // budget is the passport flow's rather than that test's.
    test.setTimeout(150_000);

    const files = [await bulkPhoto(1), await transparentPng()];

    await tool.open('/bulk-image-converter', { h1: 'Convert Many Images to One Format' });

    const before = await metrics(page);
    expect(before.scrollWidth, 'the page is wider than the screen before anything is chosen')
        .toBeLessThanOrEqual(before.innerWidth);

    // Confirmed rather than tapped: PresetChips reads a press on the active
    // chip as "unselect", and WebP is this page's default. Looked up inside
    // its own group, because "WebP" is a word this page's prose also uses.
    const webp = page.getByRole('group', { name: 'Output format' }).getByRole('button', { name: 'WebP' });
    if ((await webp.getAttribute('aria-pressed')) !== 'true') await press(page, webp);
    await expect(webp).toHaveAttribute('aria-pressed', 'true');

    // Two files through the one input, and the network guard flagged the way
    // tool.pick flags it — the no-upload promise is proved from the request
    // log on every flow, and a batch is where the most bytes are in play.
    tool.network.processed = true;
    await page.locator('input[type="file"]').first().setInputFiles(files);

    const convert = page.getByRole('button', { name: 'Convert 2 images' });
    await expect(convert).toBeEnabled({ timeout: 20_000 });
    await press(page, convert);

    const zipButton = page.getByRole('button', { name: /Download all as ZIP \(2\)/ });
    await expect(zipButton).toBeVisible({ timeout: 90_000 });

    // The result rows carry the widest content on this page — a file name, two
    // format-and-byte lines, a dimensions pair and a button whose label is the
    // file name again — and a phone has no horizontal scrollbar to warn anyone
    // that they have run off the right edge.
    const after = await metrics(page);
    expect(after.scrollWidth, 'the results push the page wider than the screen')
        .toBeLessThanOrEqual(after.innerWidth);

    // One file saved on its own, the way somebody who wanted only that one
    // would save it.
    const photoRow = page.locator('ul[aria-label="Results"] > li[data-name="bulk-photo-1.jpg"]');
    await expect(photoRow).toHaveAttribute('data-status', 'success');

    const [saved] = await Promise.all([
        page.waitForEvent('download'),
        press(page, photoRow.getByRole('button', { name: /^Download \S+\.webp$/ })),
    ]);
    const savedFile = await saved.path();
    expect(savedFile, 'the row download produced no file').toBeTruthy();
    expect(saved.suggestedFilename()).toBe('bulk-photo-1.webp');

    const out = await inspect(savedFile);
    expect(out.format).toBe('webp');
    // Converting is not resizing: the picture comes back at the size it went
    // in at, whatever the container around it now is.
    expect(out.width).toBe(1600);
    expect(out.height).toBe(1067);

    // And then the archive, which on a phone is the only practical way to keep
    // a batch. It is opened rather than counted from the button's own label.
    const [archive] = await Promise.all([page.waitForEvent('download'), press(page, zipButton)]);
    const archiveFile = await archive.path();
    expect(archiveFile, 'the ZIP button produced no file').toBeTruthy();
    expect(archive.suggestedFilename()).toBe('resizo-converted-images.zip');

    const entries = await readZip(archiveFile);
    expect(entries.map((entry) => entry.name)).toEqual([
        'bulk-photo-1.webp',
        'transparent-480x320.webp',
    ]);

    // The alpha channel is the half of this a phone can lose on its own: the
    // encoder is the browser's, and one that dropped the transparency would
    // hand back a black or white box that still weighs the right amount.
    const unpacked = testInfo.outputPath('transparent-480x320.webp');
    fs.writeFileSync(unpacked, entries[1].buffer);

    const alpha = await inspect(unpacked);
    expect(alpha.format).toBe('webp');
    expect(alpha.hasAlpha).toBe(true);
    // hasAlpha alone passes on a channel that is fully opaque, which is what a
    // flatten leaves behind. The fixture is a 240×160 shape on a 480×320 frame.
    expect(await transparentShare(unpacked), 'the converted PNG came back with nothing see-through in it')
        .toBeGreaterThan(0.1);
});
