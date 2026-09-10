# The browser-compatibility set

Every image on Resizo is processed in the visitor's own browser. That makes the browser the
runtime, not the viewer — so a green Chromium run says nothing about the engine most visitors
are actually holding. The two files here are the tests that run somewhere other than Chromium.

| File | What it proves |
|---|---|
| `compat.spec.js` | Six representative processing paths produce the right **bytes** in Firefox, WebKit and both phone profiles. |
| `mobile.spec.js` | The fold, the tap targets, one small real job and the accessibility semantics a phone has to keep. |

Both import the shared `test` from `../fixtures/resizo.js` — never `@playwright/test` directly —
which adds the browser-error guard, the no-upload guard and a browser capability report attached
to any failure.

## Which project runs what

`playwright.config.js` filters this directory by tag. The four compatibility projects run
**only** `**/browser/**/*.spec.js`; `chromium-full` runs everything in `tests/e2e/`.

| Project | Device profile | Runs |
|---|---|---|
| `chromium-full` | Desktop Chrome | every test in `tests/e2e/`, this directory included |
| `firefox-smoke` | Desktop Firefox | `@smoke` |
| `webkit-smoke` | Desktop Safari | `@smoke` |
| `mobile-chromium` | Pixel 7 | `@mobile` |
| `mobile-webkit` | iPhone 14 | `@mobile` |

`compat.spec.js` tags every test `@smoke`, and adds `@mobile` to the four whose job is small
enough for a phone profile — the 96×64 HEIC, the 320×240 WebP, the 800×600 JPEG and the 1.7 MP
sample resize. The two heavy jobs (a target-byte search and a 1600×1067 WebP encode) stay off the
phones on purpose. `mobile.spec.js` is `@mobile` only: desktop Firefox and WebKit have no phone
layout to check.

A test with neither tag runs in Chromium alone. That is silent, so check the per-project counts
in the run output rather than the pass count.

## Every test verifies the downloaded bytes

No test here believes the result panel. The panel and the file behind the Download button are
exactly the two things that can disagree, so each test reopens the download with **sharp** — a
devDependency, the repository's independent libvips reference — and asks it the format, the
dimensions, the alpha channel, the EXIF presence and the byte count. A panel sentence may
accompany a byte assertion; it never replaces one.

The HEIC test is the one that cannot work that way in both directions: no encoder in this
repository writes HEVC, so the source HEIC cannot be re-read here. It is proved from the other
side instead — the converted JPG is compared pixel-for-pixel against the PNG the committed HEIC
was made from (`../fixtures/assets/README.md`), with a mean-absolute-difference ceiling of 12
against a measured 2.24.

## The fold rule is judged by width, not by project

DESIGN.md makes two promises that only compete on a short wide window: the drop zone is above the
fold "on a mid-tier Android phone, zero scrolling", and settings sit above the drop zone so a file
lands already configured. The design resolves it by collapsing the resize platform-size chips
below Tailwind's `md`, so `mobile.spec.js` judges by width too — the tool panel must be above the
fold at every width, and the drop zone itself under 768px. Measured first-paint drop-zone tops:

| Route | iPhone 14 390×664 | Pixel 7 412×839 | Desktop 1280×720 |
|---|---|---|---|
| `/resize` | 436 | 451 | 744 |
| `/compress-image-to-20kb` | 387 | 387 | 619 |

## Running one project locally

A production build must be serving on port 3910. `npm run e2e` builds and starts one; if a build
of the current tree is already up, Playwright reuses it.

```
npx playwright test --project=webkit-smoke
npx playwright test tests/e2e/browser --project=mobile-webkit --reporter=list
npx playwright test tests/e2e/browser --project=chromium-full --project=firefox-smoke --project=webkit-smoke --project=mobile-chromium --project=mobile-webkit
```

A failure attaches `browser-capabilities` — the browser's own answer to what it can do, including
`createImageBitmap`, `OffscreenCanvas`, `WebAssembly`, `deviceMemory` and which types its canvas
will encode. Read that first: it usually turns a bare timeout into "this engine lacks X".

## What these tests do NOT cover, and who does

**Playwright's WebKit is not Safari, and it is not an iPhone.** It is a build of WebKit driven by
Playwright on desktop hardware, using desktop memory, with a phone's viewport and user-agent
string painted on. The `mobile-webkit` project proves the layout and the flow; it does not
reproduce a physical device.

The gap that matters is memory. **iOS kills a tab that asks for too much, and it kills it
silently** — no exception, no `error` event, the photo is simply gone (CLAUDE.md > Gotchas).
`lib/image-client/capability.js` costs every job before a buffer is allocated for exactly this
reason, but whether its budget is right for a real handset is not something a desktop WebKit run
can answer. That stays a manual check.

### Manual device check

Run this on a physical iPhone before any release that touches `lib/image-client/`, and record
what you ran it on.

1. Note the **device model**, the **iOS version** and the **Safari version**.
2. Take a **12 MP photo with the phone's own camera** — a real HEIC from the camera roll, not a
   file copied onto the device.
3. Put it through **`/heic`** → Convert to JPG → save the result. Open the saved file. It should
   be the photograph, right way up, at full size.
4. Put the same photo through **`/compress-image-to-20kb`** → Compress image → save the result.
5. Watch for, and write down, which of these happened:
   - the tab reloaded itself, went blank, or the browser returned to a new tab — that is the
     silent kill, and it is a bug in the capability gate's budget, not in the codec;
   - a **refusal in words** naming the device's memory — that is the gate working, and it is the
     correct outcome for a photo this phone cannot handle;
   - a completed download — check the saved file actually opens and is the right picture.
6. Repeat step 4 with the phone's other apps left open in the background, which is the state a
   real visitor's phone is usually in.

A refusal is a pass. A silent kill is a failure even though nothing on screen said so, and it is
the one outcome no automated project in this repository can catch.
