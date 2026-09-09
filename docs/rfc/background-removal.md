# RFC: Browser-local background removal for Resizo

**Status:** research only. No repository file was touched, nothing was installed into the repo, no git command was run.
**Date:** 2026-09-09
**Scope:** decide *whether* and *with what* Resizo could add a background-removal tool that keeps the no-upload promise. This RFC recommends shipping nothing yet.

---

## Summary

1. **`@imgly/background-removal` is AGPL-3.0 and must not be shipped.** Confirmed from the package's own `LICENSE.md`, which is the verbatim AGPL v3 text. It also fetches its model from `staticimgly.com` by default, which `connect-src 'self'` blocks outright. Self-hosting is supported and would fix the CSP problem, but not the licence problem.
2. **Both BRIA RMBG models are excluded**, not for technical reasons but because the weights forbid commercial use without a paid agreement. RMBG-2.0's licence link points at CC BY-NC 4.0.
3. **The licence-clean options are real but they force a choice.** MODNet (Apache-2.0, and the only licence in this whole space that explicitly names the *models*) is portrait-only at 6.6 MB. BiRefNet-lite (MIT) is general-purpose at 114 MB fp16 and has **no successful browser timing published by anyone**, on any device.
4. **The site is not cross-origin isolated, so ONNX Runtime Web would run on one thread.** Verified against production headers. The one published apples-to-apples measurement puts an ISNet-class model at roughly 2 seconds on 16 threads on an M3 Max, and roughly 12.6 seconds on a single fast core. WebGPU is 15 to 40 times faster but ONNX Runtime's own compatibility matrix marks WebGPU **unsupported on Safari and on iOS**, which is a large share of this site's traffic.
5. **The gate this site is built on cannot be written yet.** `lib/image-client/capability.js` costs every job before allocating. Nobody has published the activation working set for any of these models in a WASM heap, so a `segment` profile would have to invent its central number. Measuring it is the first task, not the last.

**Recommendation: do not ship in this phase.** If the feature is pursued, rank order is MODNet int8 (portrait) first, BiRefNet-lite fp16 (general) second, and `@imgly/background-removal` never.

---

## Context and constraints

Read before writing this: `CLAUDE.md`, `lib/image-client/capability.js`, `lib/image-client/codecs.js`, `next.config.js`, `LICENSE`, `package.json`, `scripts/copy-wasm.js`, `tests/architecture/boundaries.test.js`, `tests/architecture/no-dead-code.test.js`.

What the repository forces on any answer:

| Constraint | Where it lives | What it rules out |
|---|---|---|
| `connect-src 'self'` | `next.config.js:57` | Any runtime fetch of weights or WASM from a CDN. Every byte must be same-origin. |
| `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'` | `next.config.js:33` | Already permits WebAssembly compilation, so ONNX Runtime's WASM will instantiate. No change needed. |
| No `worker-src`, so it falls back to `default-src 'self'` | `next.config.js:22` | A `blob:` Worker is blocked. ONNX Runtime's proxy worker uses `Blob` and must stay off. Its pthread workers must resolve to a same-origin script URL. |
| Heavy packages appear only inside `import()` | `tests/architecture/boundaries.test.js:197-200` | `onnxruntime-web` would need a new entry in that list and a lazy load in `lib/image-client/`. A static import fails the build. |
| Every job is costed before a buffer exists | `lib/image-client/capability.js` (`assessJob`, `estimatePeakBytes`) | A `segment` operation needs a memory profile grounded in a measurement. There is no fallback lane to absorb a wrong guess. |
| WASM binaries are copied to `public/wasm/` from an explicit list | `scripts/copy-wasm.js:36-42` | ONNX Runtime's binaries would join that list. Model weights need a separate home. |
| MIT repository, commercial future | `LICENSE` | Copyleft libraries and non-commercial weights are both disqualifying. |

Two measured facts about the live site, taken today:

```
$ curl -s -o /dev/null -D - -H "Accept-Encoding: br, gzip" https://www.resizo.net/wasm/squoosh_resize_bg.wasm
HTTP/2 200
content-encoding: br
content-type: application/wasm
```
Vercel already brotli-compresses `application/wasm`, so the compressed runtime figures below are what a visitor really pays.

```
$ curl -s -o /dev/null -D - https://www.resizo.net/resize | grep -i cross-origin
(no output)
```
No `Cross-Origin-Opener-Policy` and no `Cross-Origin-Embedder-Policy`. The site is **not** cross-origin isolated, which decides the thread count in the timing section.

---

## Candidates

Sizes are exact byte counts read from the Hugging Face file API, not estimates. Commands are in the Sources section.

| Model | Code licence | **Weights licence** | Commercial? | ONNX bytes fp32 / fp16 / int8 | Input | Quality (named benchmark) | Scope |
|---|---|---|---|---|---|---|---|
| **MODNet** (`Xenova/modnet`) | Apache-2.0 | **Apache-2.0, explicitly covering "models"** | **Yes** | 25,888,640 / 12,984,781 / **6,632,188** | 512 short edge, dynamic | PPM-100 MSE 0.0044, MAD 0.0086 (paper) | **Portrait only** |
| **BiRefNet_lite** (`onnx-community/BiRefNet_lite-ONNX`) | MIT | MIT | Yes, with the DIS5K caveat below | 224,005,088 / **114,538,221** / none | 1024x1024 | DIS-VD S 0.882, wF 0.830, HCE 1175 | General |
| **BiRefNet** full | MIT | MIT | Same caveat | 972,666,916 / 489,666,272 / none | 1024x1024 | DIS-VD S 0.898, maxF 0.889, MAE 0.038 | General |
| **MVANet** (`onnx-community/MVANet-ONNX`) | MIT | MIT | Same caveat | 422,038,472 / 211,405,738 / 141,076,192; q4f16 **85,027,081** | 1024x1024 | DIS-TE(1-4) maxF 0.916, S 0.905, MAE 0.035 | General |
| **MediaPipe Selfie Segmentation** (`onnx-community/mediapipe_selfie_segmentation`) | Apache-2.0 on the framework | Apache-2.0 tag on the ONNX re-export; **Google never stamps the `.tflite` itself** | Yes, in practice | 462,352 / 251,097 / **223,977** | 256x256 | Not published | **Person only** |
| **ISNet / DIS** | Apache-2.0, scoped to "code and evaluation metric" | **Never stated.** `isnet-general-use.pth` is a bare Google Drive file | **Contested** | 178,648,008 / not found / not found | 1024x1024 | DIS-TE1 S 0.787, maxF 0.740, MAE 0.074 | General |
| **ormbg** (`schirrmacher/ormbg`) | Apache-2.0 | Apache-2.0 | Yes, with a dataset caveat of its own | 176,182,050 / not found / not found | 1024x1024 | Author's own validation set only, F1 0.9932 | Human-optimised |
| **BEN2 Base** (`PramaLLC/BEN2`) | MIT | MIT (Base only; the good model is API-only) | Yes, same DIS5K caveat | 222,932,053 / not found / not found | 1024 | No numeric table published | General |
| **U-2-Net / u2netp** | Apache-2.0 | Apache-2.0 | Yes | 175,997,641 / **4,574,861** (u2netp) / not found | 320x320 | DIS-TE1 S 0.762, maxF 0.701, MAE 0.085 | General |
| **InSPyReNet** | MIT | No separate statement on the checkpoints | Yes, no non-commercial clause found | Not found | 384 or 1024 | Published only as PNG figures | General |
| **RMBG-1.4** | n/a | `license: other`, `bria-rmbg-1.4`, non-commercial | **NO** | 176,153,355 / 88,217,533 / 44,403,226 | 1024x1024 | Not published | General |
| **RMBG-2.0** | n/a | `license: other`, link is **CC BY-NC 4.0** | **NO** | 1,024,331,469 / 513,576,499 / 366,087,445 | 1024x1024 | Not published | General |
| **FlowDIS** (Picsart, 2026) | Picsart licence | **Explicitly non-commercial** | **NO** | none | 1024x1024 | DIS-VD wF 0.938 (current SOTA claim) | General |

Two corrections to assumptions in the brief, both worth recording because they change the shortlist:

- **MODNet is not non-commercial.** Its README says, verbatim, *"The code, models, and demos in this repository (excluding GIF files under the folder `doc/gif`) are released under the Apache License 2.0 license."* It is the only entry in this table whose licence sentence names the **models**.
- **InSPyReNet is not non-commercial either.** Its `LICENSE` is plain MIT, © 2021 Taehun Kim. No restriction found.

---

## Licensing analysis

### `@imgly/background-removal` is AGPL-3.0. Confirmed, not inferred.

```
$ npm view @imgly/background-removal version license
1.7.0
SEE LICENSE IN LICENSE.md
$ npm pack @imgly/background-removal@1.7.0 --pack-destination <scratch>
$ head -3 package/LICENSE.md
# GNU Affero General Public License
_Version 3, 19 November 2007_
```

The `LICENSE.md` shipped in the tarball is 34,363 bytes of verbatim AGPL v3 text. The README says, verbatim: *"The software is free for use under the AGPL License. Please contact support@img.ly for questions about other licensing options."* There is no price list; licensing is a direct-contact arrangement.

### What AGPL means for an MIT repository that ships the library to browsers

The trigger here is **not** section 13. Section 13 covers a *modified* version that users interact with remotely. Resizo would use the library unmodified, and section 13 is often mistakenly assumed to be the only AGPL hook. It is not the relevant one.

The relevant hook is ordinary GPL conveying, because **serving JavaScript to a browser is distributing a copy of the software**. AGPL section 0 defines it:

> "'Convey' means any kind of propagation that enables other parties to make or receive copies. **Mere interaction with a user through a computer network, with no transfer of a copy, is not conveying.**"

A visitor opening `/remove-background` receives the library's actual bytes. That is a transfer of a copy, so it is conveying, and section 5(c) then applies:

> "You must license the entire work, as a whole, under this License to anyone who comes into possession of a copy."

"The entire work, as a whole" is the question, and the FSF answers it directly:

> "**If a library is released under the GPL (not the LGPL), does that mean that any software which uses it has to be under the GPL or a GPL-compatible license?** Yes, because the program actually links to the library. As such, the terms of the GPL apply to the entire combination."
> — https://www.gnu.org/licenses/gpl-faq.html#IfLibraryIsGPL

> "**Does the GPL have different requirements for statically vs dynamically linked modules with a covered work?** No. Linking a GPL covered work statically or dynamically with other modules is making a combined work based on the GPL covered work."
> — https://www.gnu.org/licenses/gpl-faq.html#GPLStaticVsDynamic

And on where the line falls between an aggregate and one program:

> "If the modules are included in the same executable file, they are definitely combined in one program. **If modules are designed to run linked together in a shared address space, that almost surely means combining them into one program.**"
> — https://www.gnu.org/licenses/gpl-faq.html#MereAggregation

**In plain English.** Resizo would `import` the library, call its function, and hand it a buffer, all inside one JavaScript heap. That is linking in a shared address space by the FSF's own test, not two programs talking over a pipe. Bundling the library into a Next.js chunk and serving that chunk to visitors would therefore oblige Resizo to license the tool page, the engine it calls, and everything else in that combined work under AGPL-3.0, and to offer the corresponding source to every visitor. That is incompatible with the stated commercial future, and MIT cannot absorb it: AGPL is a one-way ratchet, so an MIT file that becomes part of an AGPL combined work is distributed under AGPL terms.

Buying a commercial licence from IMG.LY removes the problem entirely and is a legitimate path. It is a business decision, not a technical one, and there is no published price.

### The model IMG.LY ships is a separate question, and it is cleaner than the library

`ThirdPartyLicenses.json` in the tarball declares:

```json
"ISNET": { "source": "https://github.com/xuebinqin/DIS", "type": "model", "license": "MIT" }
```

That is IMG.LY's characterisation. The DIS repository itself is narrower. Its README section 7 says, verbatim:

> "Our code and evaluation metric use Apache License 2.0. The Terms of use for our DIS5K dataset is provided as DIS5K-Dataset-Terms-of-Use.pdf."

That sentence covers the *code and evaluation metric*. It never names the weights, and the repository has **no `LICENSE` file** (the path 404s). So IMG.LY's "MIT" tag on the model is not traceable to a statement by the DIS authors, and the fp32 model IMG.LY serves is 176,149,806 bytes against RMBG-1.4's 176,153,355 bytes, which is close enough to be worth noting but is not by itself proof of provenance.

### The DIS5K dataset problem, which touches nearly every general-purpose model

The DIS5K Terms of Use PDF states:

> "**2. Intended use** — The Dataset is available for non-commercial use in research or educational purpose... **Without permission from the original authors, commercial use of this dataset is prohibited even after copying, editing, processing or any operations of this database.**"

BiRefNet, ISNet, MVANet, PDFNet, BEN2 and RMBG-1.4's lineage are all trained on DIS5K. Their *weights* carry MIT or Apache tags from their authors, but the dataset authors drew a fence and it is unsettled law whether trained weights are a derivative work of their training data. No party has stated a position.

**This is a lawyer question, not an engineering one.** The honest framing for a decision: the weights licences are permissive and defensible on their face; the residual risk is a dataset-terms argument that nobody has yet tested, and it applies to essentially every good general-purpose cutout model, including the one IMG.LY sells access to. MODNet and MediaPipe are the two candidates that sidestep it entirely, and both are person-only.

ormbg avoids DIS5K but is trained on P3M-10K, AIM-500 and PPM-100, which carry their own academic terms. It swaps one dataset question for another.

### Weights that forbid commercial use must not be used

Stated explicitly, as the brief asks. **RMBG-1.4, RMBG-2.0 and FlowDIS are excluded.** RMBG-1.4's model card says, verbatim: *"The model is released under a Creative Commons license for non-commercial use. Commercial use is subject to a commercial agreement with BRIA."* RMBG-2.0's `license_link` is `https://creativecommons.org/licenses/by-nc/4.0/deed.en`. Shipping either on a site with a commercial future is a licence breach unless the business buys a BRIA agreement and accepts that cost. There is no public price.

One correction to the brief: RMBG-1.4's identifier is **not** `cc-by-nc-4.0`. It is `license: other` with `license_name: bria-rmbg-1.4`, and the binding document is BRIA's own agreement, not a Creative Commons licence. The practical conclusion is unchanged.

---

## Runtime and bundle sizes

All figures measured locally from the published tarball, brotli quality 11, on 2026-09-09.

```
$ npm view onnxruntime-web version license      # 1.29.0, MIT
$ npm pack onnxruntime-web@1.29.0 --pack-destination <scratch>
$ tar xzf onnxruntime-web-1.29.0.tgz
$ node measure.mjs package/dist                 # node:zlib brotliCompressSync, quality 11
```

### What a WASM-only deployment costs

| File | Raw | Brotli |
|---|---:|---:|
| `ort.wasm.bundle.min.mjs` | 72,894 | 21,685 |
| `ort-wasm-simd-threaded.mjs` | 24,218 | 7,960 |
| `ort-wasm-simd-threaded.wasm` | 13,961,845 | 2,296,916 |
| **Total** | **14,058,957 (13.41 MiB)** | **2,326,561 (2.22 MiB)** |

### What a WebGPU deployment costs

| File | Raw | Brotli |
|---|---:|---:|
| `ort.webgpu.bundle.min.mjs` | 116,102 | 33,329 |
| `ort-wasm-simd-threaded.asyncify.mjs` | 51,407 | 16,071 |
| `ort-wasm-simd-threaded.asyncify.wasm` | 25,749,873 | 3,810,014 |
| **Total** | **25,917,382 (24.72 MiB)** | **3,859,414 (3.68 MiB)** |

Supporting both means both sets sit in `public/`, but a visitor downloads only one.

Three facts about the package worth recording:

- **There is no non-SIMD build any more.** Every `.wasm` shipped in 1.29.0 is `simd-threaded`. The SIMD check *throws* (`"WebAssembly SIMD is not supported in the current environment."`) where the threading check merely warns.
- **The subpath table in the README is stale.** The real `exports` map in 1.29.0 has only `.`, `./all`, `./wasm`, `./webgl`, `./webgpu`, `./jspi`. Import `onnxruntime-web/wasm` for the small build.
- **The WebGPU entry now pulls `asyncify`, not `jsep`.** The published deploy docs still describe the older `jsep` layout.

### Threading, and why it decides the timing

ONNX Runtime Web's multi-threaded WASM needs `SharedArrayBuffer`, which needs cross-origin isolation. The shipped code makes it unambiguous:

```js
isMultiThreadSupported = () => {
  if (typeof SharedArrayBuffer === "undefined") { return false; }
```

It does **not** throw when isolation is missing. It warns twice and silently drops to one thread. And the auto-resolution of `numThreads` already checks:

```js
if (typeof self !== "undefined" && !self.crossOriginIsolated) { env2.wasm.numThreads = 1; }
```

**Resizo is not cross-origin isolated today, so the effective thread count is 1.** IMG.LY's own README tells its users to fix that with `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`.

**The good news, and it is genuinely good:** Resizo can turn cross-origin isolation on almost for free. `require-corp` blocks cross-origin subresources without a `Cross-Origin-Resource-Policy` header, but same-origin subresources load unchanged, and this site's own CSP proves it loads nothing cross-origin: `img-src 'self' data: blob:`, `font-src 'self'`, `style-src 'self'`, `script-src 'self'`, and `next/font` bakes the three faces in at build time. There is no popup, no embed, no third-party script. The two headers can be scoped to the one route in `next.config.js` `headers()` alongside the existing block.

**One risk to verify before relying on this:** enabling threads makes Emscripten spawn pthread workers. If that build creates them from a `blob:` URL, the site's CSP blocks it, because there is no `worker-src` and `default-src 'self'` does not permit `blob:`. This must be tested, not assumed.

### Architecture-rule impact

| Rule | Effect |
|---|---|
| Rule 4, heavy deps only inside `import()` | Add an `onnxruntime-web` entry to the `LAZY` list in `tests/architecture/boundaries.test.js:197-200`, and load it with `await import('onnxruntime-web/wasm')` memoised the way `lib/image-client/codecs.js` memoises its codecs. |
| `scripts/copy-wasm.js` | Add `onnxruntime-web/dist/ort-wasm-simd-threaded.{wasm,mjs}` to the explicit list at lines 36-42, then point `ort.env.wasm.wasmPaths` at the existing `/wasm/` base from `codecs.js:43`. |
| Model weights | A new `public/models/` directory. **Do not commit a 114 MB `.onnx` to git.** Fetch it at build time the way `copy-wasm.js` copies from `node_modules`. A build-time fetch from Hugging Face does not touch the no-upload promise, which is about runtime. Vercel's static-asset and deployment-size limits need checking against a 114 MB file before this is a plan. |
| Rules 1, 2, 3, 5 | Unaffected. ONNX Runtime is not React, lives under `lib/image-client/`, and reads no catalogue. |

### Transformers.js as an alternative wrapper

`@huggingface/transformers` 4.2.0 is Apache-2.0 and has a first-class `background-removal` pipeline whose **default model is `Xenova/modnet`**. It can be pinned to the site's own origin, but there are two traps and only one is documented:

```js
env.allowRemoteModels = false;
env.allowLocalModels  = true;   // defaults to FALSE in a browser; setting only the line above throws
env.localModelPath    = '/models/';
env.backends.onnx.wasm.wasmPaths = '/wasm/';   // it otherwise points at jsDelivr at import time
```

The second trap matters here specifically: on import it sets `wasmPaths` to `https://cdn.jsdelivr.net/npm/onnxruntime-web@.../dist/`, which `connect-src 'self'` would block. It fails loudly rather than leaking, which is the right failure, but it must be overridden.

Two reasons to prefer raw `onnxruntime-web` over Transformers.js for this repo: it pins `onnxruntime-web` to a **dev build** (`1.26.0-dev.20260416-b7804b056c`), and its browser entry does `import * as ONNX_WEB from 'onnxruntime-web/webgpu'` unconditionally, which resolves to the 116 KB WebGPU bundle and the 25.7 MB asyncify binary with no way to reach the 73 KB wasm-only bundle without patching.

---

## Browser and device support

| Browser | WebGPU shipped | Date | Source |
|---|---|---|---|
| Chrome / Edge desktop | 113 | 2 May 2023 | https://developer.chrome.com/blog/webgpu-release |
| Chrome on Android | 121 | 17 Jan 2024 | https://web.dev/blog/webgpu-supported-major-browsers |
| Firefox desktop | 141, **Windows only** | 22 Jul 2025 | https://developer.mozilla.org/en-US/docs/Mozilla/Firefox/Releases/141 |
| Firefox desktop | 145, plus macOS Tahoe on Apple Silicon | 11 Nov 2025 | https://web.dev/blog/webgpu-supported-major-browsers |
| Safari macOS | 26.0, **only on macOS Tahoe 26+** (caniuse marks this *partial*) | 15 Sep 2025 | https://webkit.org/blog/17333/webkit-features-in-safari-26-0/ |
| **Safari iOS / iPadOS** | **26.0, enabled by default** | **15 Sep 2025** | https://webkit.org/blog/17333/webkit-features-in-safari-26-0/ |
| Firefox for Android | not supported | — | caniuse `n d` as of 153 |

Global: **85.72% supported plus 1.63% partial** on caniuse, read 2026-09-09.

WebGPU works inside a dedicated Worker. The spec's IDL includes `WorkerNavigator includes NavigatorGPU`, and MDN confirms `WorkerNavigator.gpu`. A secure context is required, which Resizo has.

### The finding that undercuts the whole WebGPU story

**Browser-level WebGPU availability is not the same as ONNX Runtime Web WebGPU support.** ONNX Runtime Web 1.29.0's own README compatibility matrix marks WebGPU:

| EP / Browser | Chrome/Edge (Win) | Chrome/Edge (Android) | Chrome/Edge (macOS) | Chrome/Edge (iOS) | Safari (macOS) | Safari (iOS) | Firefox (Win) |
|---|---|---|---|---|---|---|---|
| WebAssembly (CPU) | yes | yes | yes | yes | yes | yes | yes |
| **WebGPU** | yes | yes | yes | **no** | **no** | **no** | **no** |

Corroborated by https://github.com/microsoft/onnxruntime/issues/22776: *"onnxruntime-web (WebGPU) is not supported in iOS devices regardless of browser type."*

So iOS Safari, which is the platform `capability.js` already treats as the hardest case and which supplies a large share of a photo-tool's traffic, gets the **WASM path only**. The 15-to-40x WebGPU speedup is a desktop-Chrome benefit. It does not rescue the phone.

There is also a documented, WebGPU-specific memory bug on Safari: PaddleOCR in JSEP mode grew from "1GB+" to "14GB+" and crashed the process on iOS, reproducing on ONNX Runtime Web 1.20.0 through 1.23.2 and **not** on the plain WASM backend (https://github.com/microsoft/onnxruntime/issues/26827).

---

## Memory and time

### Time

There is no published browser measurement of any of these models on a named phone. That is a real absence, not a search failure, and it is the single largest evidence gap for a mobile-heavy site.

What does exist:

| Source | Device | Model | WASM | WebGPU |
|---|---|---|---|---|
| IMG.LY blog, 11 Jun 2024 | MacBook Pro 13" M3 Max, 16 cores | ISNet fp32, 1024x1024 | ~53,000 ms (1 thread, no SIMD); **~2,000 ms (16 threads + SIMD)** | ~120 ms |
| Same | Same | ISNet fp16 | ~2,300 ms (16 threads + SIMD) | ~100 ms |
| Transformers.js leaderboard | headless Chromium, 32 vCPU, A10G | ISNet-ONNX fp32 | **12,636.6 ms p50** | 301.7 ms p50 |
| Same | Same | `Xenova/modnet` fp32 | **1,987.5 ms p50** | 148.9 ms p50 |
| Community export | device not named | BiRefNet-lite fp16 WebGPU | — | 512 px 0.85 s; 1024 px 3.4 s |

Two readings that matter:

- **fp16 is slower than fp32 on the WASM CPU path** in IMG.LY's own numbers (2,300 vs 2,000 ms). The CPU execution provider has thin fp16 kernel coverage, so an fp16 model is cast up at runtime. **On a WASM-only site, fp16 buys download size and costs both speed and heap.** It is a bandwidth optimisation, not a memory one.
- **The 12.6 s leaderboard figure is probably the single-threaded SIMD number.** A plain headless Chromium page is not cross-origin isolated unless the harness sets the headers, and the harness does not publish its thread count. If that reading is right, it is the closest thing that exists to what a non-isolated Resizo visitor on a fast desktop core would see for an ISNet-class model, and it is far worse than the 2 s headline.

Nobody has published a successful browser timing for **full** BiRefNet at 1024x1024. An ONNX Runtime maintainer reported it *"using close to 7GB gpu memory"* on WebGPU and running out of memory on wasm32 (https://github.com/microsoft/onnxruntime/issues/21968), and BiRefNet_T fails WebGPU outright on a shader binding limit. The `onnx-community/BiRefNet_lite-ONNX` leaderboard record returns `"status":"completed"` with **no metrics key at all**: the run produced no numbers.

### Memory, and why `capability.js` cannot be extended yet

WebAssembly's hard ceiling is 4 GB, and ONNX Runtime says so plainly: *"Currently, there is no way for ONNX Runtime Web to run models larger than 4GB."* In practice it breaks well below that.

What a `segment` profile would have to know, and what is actually known:

| Term | Value | Source |
|---|---|---|
| Weights resident in the WASM heap | **Not published for any candidate.** For fp16 on the CPU EP, assume the fp32 expansion, so BiRefNet_lite fp16 (114 MB on disk) is nearer 224 MB resident | Inferred from the fp16-slower-than-fp32 result above. Must be measured. |
| Input tensor, 1x3x1024x1024 fp32 | 12,582,912 bytes | Arithmetic, from RMBG-1.4's documented `(1, 3, 1024, 1024)` input |
| Input tensor, MODNet at 512 | 3,145,728 bytes | Arithmetic |
| **Peak activation working set** | **Not published for any candidate, on any backend** | The one number that decides whether a phone survives, and it does not exist in any source found |
| Matte upscaled to source resolution | W x H x 1, or x 4 as `ImageData` | Arithmetic |
| Composite stage | source RGBA + matte + output RGBA, all live at once | The same modelling `estimatePeakBytes` already does |
| iOS per-tab ceiling | **No authoritative figure exists.** Independent estimates disagree by an order of magnitude, roughly 100-250 MB on older iPhones up to "1GB+" on recent ones | Apple documents jetsam but publishes no number |

Put against this repository's own budget: a 4 GB iPhone gets `4 GB x 0.25 = 1 GB`, capped at `MAX_TAB_BUDGET_BYTES`, then `x 0.6` for iOS, so **about 614 MB**. BiRefNet_lite's weights alone, if they expand to fp32, are roughly 224 MB, or 36% of the entire budget before one activation buffer, before the photo, and before the composite. MODNet int8 at 6.6 MB on disk is in a different class entirely.

The honest conclusion: **a `segment` entry in `OPERATION_PROFILES` cannot be written from published data.** Every other profile in that file has a stated provenance, and the file's own header says *"If a number here has no stated source, that is a bug."* Filling in an activation figure by guess would break the rule the file exists to enforce, on the one operation where the tab is most likely to die.

Independent corroboration of the approach, from a developer who shipped exactly this: **"Safari on iOS silently kills the tab instead of crashing"**, and *"on a 4 GB Android, you OOM before the model even starts."* Their mitigation was probing dimensions and refusing oversized inputs **before** running the model, which is `capability.js` arrived at from scratch by someone else.

---

## Initial-load strategy

Nothing may enter the first-load bundle. The shape that satisfies that:

1. **A dedicated chunk.** `lib/image-client/segment.js`, loaded by `await import()` and memoised with the same `once()` pattern as `codecs.js:68`. `onnxruntime-web` joins the `LAZY` list so a static import fails the build.
2. **Weights self-hosted under `public/models/`,** fetched at build time, never committed. `Cache-Control: public, max-age=31536000, immutable` on a content-hashed path, so the download is paid once per device rather than once per visit.
3. **Runtime binaries in the existing `public/wasm/`,** via `scripts/copy-wasm.js`, addressed through `WASM_BASE_PATH` from `codecs.js:43`.
4. **Cross-origin isolation scoped to the one route**, if threading is pursued.

### What the visitor actually downloads on first use

Runtime plus model. WASM-only runtime is 14,058,957 raw / 2,326,561 brotli. Model brotli figures below were measured locally; models compress poorly, as weights do.

| Option | Raw total | Brotli total |
|---|---:|---:|
| MediaPipe selfie int8 | 14,282,934 (13.62 MiB) | ~2.4 MiB (model not separately measured) |
| **MODNet int8** | **20,691,145 (19.73 MiB)** | **7,465,416 (7.12 MiB)** |
| MODNet fp16 | 27,043,738 (25.79 MiB) | 13,631,307 (13.00 MiB) |
| MODNet fp32 | 39,947,597 (38.10 MiB) | not measured |
| imgly isnet_quint8 | 58,407,897 (55.70 MiB) | not measured |
| MVANet q4f16 | 99,086,038 (94.50 MiB) | not measured |
| **BiRefNet_lite fp16** | **128,597,178 (122.64 MiB)** | **80,150,114 (76.44 MiB)** |
| BiRefNet_lite fp32 | 238,064,045 (227.04 MiB) | not measured |
| ormbg fp32 | 190,241,007 (181.43 MiB) | not measured |

One caveat on the brotli column: Vercel is confirmed to compress `application/wasm`, but whether it compresses `application/octet-stream` (which is what a `.onnx` would be served as) has not been verified. Until it is, **quote the raw number**.

### Is a 40 to 170 MB download acceptable for a "free, instant" tool?

**For 7 MB, yes.** MODNet int8 over the wire is smaller than one of this site's own 20 MB input files. It needs no apology and barely needs a progress bar.

**For 76 MB, it needs to be asked for, not sprung.** That is a real cost on a phone plan and a long wait on a slow connection, and it happens *before* the first result appears. It should never begin on page load. It should begin when the visitor picks a file and confirms.

**Above 170 MB, no.** The site's own bulk cap is 80 MB of input files. Downloading twice that to process one photo inverts the deal.

The honest UI, in the site's existing register. Before the download:

> Removing a background needs a one-time 76 MB download of the model that does the work. It stays on your device after that, so this only happens once. Your photo is not part of it and still never leaves this device.

During:

> Downloading the model, 31 of 76 MB.

While running, with the number filled in from a real measurement:

> Working. This takes about N seconds on this device.

And a refusal, which `capability.js` already knows how to phrase, when the device cannot hold the job.

Two things that copy must never say, given `tests/design/contract.test.js`: nothing implying the photo is uploaded, and nothing implying the model download is the photo going somewhere. The download is code arriving, not an image leaving, and the sentence should say so.

---

## Output quality

**What comes out of the model is a matte, not a cutout.** All of these emit a single-channel confidence or alpha map at the model's own input resolution, which then has to be scaled to the photo's resolution and multiplied into the alpha channel.

- **MODNet is a true matting model.** It is trained to produce soft alpha, so it resolves hair and fur reasonably. That is the point of a matting model as against a saliency model.
- **BiRefNet, ISNet and MVANet emit a saliency map.** Softer than a binary mask, harder than a real matte. Good on well-separated objects, less good on wispy edges.
- **MediaPipe emits a 256x256 mask.** Scaled to a 12 MP photo that is a 13x upsample per axis. Edges will be visibly soft and stepped. It is right for a video-call blur and wrong for a cutout someone puts on a marketplace listing.

**Refinement is cheap and worth doing.** A guided or joint-bilateral upsample of the matte against the source luminance recovers most of the edge detail lost to the upscale, and it is a plain pixel loop with no new dependency. A hard threshold should not be the default: it produces the jagged halo that makes free background removers look free.

**A background-colour fill is the more useful default output, not an afterthought.** Compositing the matte over a solid colour lets the result stay JPEG. A transparent PNG of a 12 MP photo is enormous: this repository's own measured expansion table puts JPEG to PNG at **8.69x** on a 1200x1200 sample. A 3 MB JPEG in, a 26 MB PNG out, is a bad experience even when the cutout is perfect. WebP with alpha is the middle path, and `loadWebpEncoder` in `codecs.js:150` already exists.

So the output panel wants three choices: transparent PNG, transparent WebP, and a solid colour with a JPEG result. The memory gate has to cost each, because they differ.

---

## Legal summary for Resizo

MIT repository, commercial future. Three buckets.

**Safe to use.**
- `onnxruntime-web` — MIT, verified from `package.json`.
- `@huggingface/transformers` — Apache-2.0, verified from npm.
- **MODNet weights** — Apache-2.0, and the only licence here that explicitly names the models. Trained on self-collected Flickr images, with the restricted datasets used for validation only. The cleanest option on the table by a wide margin.
- MediaPipe Selfie Segmentation, in practice. The ONNX re-export carries an Apache-2.0 tag, but note that Google never stamps the `.tflite` files themselves and the model-card PDFs are scans with no text layer, so this rests on the framework licence rather than on a per-file statement.
- U-2-Net and u2netp — Apache-2.0, trained on DUTS-TR, no DIS5K entanglement. Two generations behind on quality.

**Usable, with a dataset risk that a lawyer should price.**
- BiRefNet and BiRefNet_lite — MIT weights, MIT code. Trained on DIS5K, whose terms forbid commercial use of the dataset. The weights licences are permissive and defensible on their face; the residual risk is untested.
- MVANet, BEN2 Base, ISNet, ormbg — same shape of risk. ISNet is worse than the others because its weights were never licensed at all.

**Excluded.**
- `@imgly/background-removal` — AGPL-3.0. Would make the combined work AGPL. Only a paid IMG.LY licence changes this.
- **RMBG-1.4 and RMBG-2.0** — the weights forbid commercial use. **Stated explicitly, as asked: a model whose weights prohibit commercial use must not be used unless the business decides to buy the licence and accepts that cost.** There is no public price for either BRIA's or IMG.LY's commercial terms.
- FlowDIS — explicitly non-commercial, and a 24 GB model regardless.

---

## Ranked recommendation

**Nothing ships in this phase.** This is a decision document. The ranking is what to build *if* it is pursued.

### 1st: MODNet int8, self-hosted, via `onnxruntime-web/wasm`. Portrait only.

- **Licence:** Apache-2.0 on code *and* models, no dataset entanglement. The only genuinely clean answer.
- **Bytes:** 20,691,145 raw / 7,465,416 brotli on first use, then cached.
- **Time:** the only measured figure is 1,987.5 ms p50 on WASM on a CI box, and 148.9 ms on WebGPU. A phone will be several times the WASM figure. Must be measured on device.
- **Quality the visitor gets, honestly:** good soft-alpha cutouts of **people**, including reasonable hair. It will produce nonsense on a product photo, a pet, a car or a logo, because it was never trained for them. A tool built on it must say "people" in its name and its copy, or it will generate complaints that read as bugs.
- **Why first:** it is the only option where the licence question is closed, the download is unapologetic, and the memory profile is plausibly within an iPhone's budget. It also happens to be the Transformers.js `background-removal` default, so it is the best-trodden path.

### 2nd: BiRefNet_lite fp16, self-hosted, via `onnxruntime-web/wasm`. General purpose.

- **Licence:** MIT weights and code, with the unresolved DIS5K dataset question.
- **Bytes:** 128,597,178 raw / 80,150,114 brotli on first use. This needs consent before it starts.
- **Time:** **unknown.** No successful browser benchmark exists for it, on any backend, from any source. The nearest data points are a community WebGPU export at 3.4 s for 1024 px on an unnamed device, and a leaderboard run that produced no metrics at all.
- **Memory:** roughly 224 MB of resident weights if fp16 casts up, against a 614 MB iOS budget. Plausibly fatal on a 4 GB phone.
- **Quality the visitor gets:** genuinely good general cutouts. DIS-VD S-measure 0.882, which is the same class as the paid tools.
- **Why second and not first:** it is the only option that does what people mean by "remove background", and every one of its costs is unmeasured. That is a research task, not a shipping decision.

### 3rd: MediaPipe Selfie Segmentation int8. Person only, tiny.

- 223,977 bytes. Effectively free. Person-only, and a 256x256 mask on a 12 MP photo has visibly soft edges. Worth a look as a **preview**: run it instantly for an on-screen proof that the feature works while the real model downloads.

### Do not ship

- **`@imgly/background-removal`** — AGPL-3.0, and it fetches from `staticimgly.com` by default, which the CSP blocks. Self-hosting fixes the second problem and not the first.
- **RMBG-1.4 and RMBG-2.0** — non-commercial weights.
- **Full BiRefNet, MVANet fp32, ormbg fp32, BEN2** — 176 MB to 972 MB of weights. Past what a browser tab or a phone plan should be asked for, and full BiRefNet is reported to OOM on wasm32 anyway.
- **MVANet q4f16 (85 MB)** — tempting on paper, better published numbers than BiRefNet_lite at three quarters the size, but int4 block quantisation has thin CPU-EP kernel coverage and its quality loss is unmeasured. Revisit only if BiRefNet_lite is measured and found wanting.

---

## Phased plan

**Phase 0 — measure, decide nothing.** No feature branch. A scratch harness that loads `onnxruntime-web/wasm` in a worker and reports, per model and per device: peak `WebAssembly.Memory` growth, wall time, and whether an iPhone survives. Devices: one 4 GB iPhone, one mid-tier Android, one laptop. Models: MODNet int8, MODNet fp16, BiRefNet_lite fp16. **This produces the activation number that does not exist in any published source, and without it `capability.js` cannot be extended honestly.** Also settle the two open runtime questions: whether Emscripten pthread workers survive the CSP, and whether Vercel compresses `application/octet-stream`.

**Phase 1 — portrait only, if Phase 0 says yes.** `/remove-background-from-photo` or similar, MODNet int8, explicitly and visibly about people. A `segment` entry in `OPERATION_PROFILES` with every constant carrying its measured provenance. Output as transparent PNG, transparent WebP, or a solid-colour JPEG. A refusal path for devices that cannot hold the job, reusing `refusalMessage`. Ship the model download behind an explicit confirmation.

**Phase 2 — general purpose, only if Phase 1 ships and BiRefNet_lite measures acceptably.** A second model behind the same tool, chosen by the visitor or by what the device can hold, with the 76 MB download confirmed separately. Get a lawyer's read on the DIS5K question before this phase, not after.

**Phase 3 — cross-origin isolation and WebGPU, if the timings justify it.** COOP and COEP on the one route, which this site can afford because it loads nothing cross-origin. WebGPU as a desktop-Chrome accelerator only, never as the assumed path, because ONNX Runtime marks it unsupported on Safari and iOS.

**Never:** an AGPL library, non-commercial weights, or a fallback that posts the image anywhere.

---

## Sources

**Commands run (all in the scratchpad, nothing installed into the repo):**
```
npm view @imgly/background-removal version license dist.unpackedSize --json     # 1.7.0, "SEE LICENSE IN LICENSE.md", 1,113,610
npm view @imgly/background-removal-data version license dist.unpackedSize --json # 1.4.5, 221,510,773
npm view onnxruntime-web version license dist.unpackedSize --json               # 1.29.0, MIT, 142,027,824
npm view @huggingface/transformers version license dependencies --json          # 4.2.0, Apache-2.0
npm pack @imgly/background-removal@1.7.0 --pack-destination <scratch>
npm pack onnxruntime-web@1.29.0 --pack-destination <scratch>
node measure.mjs package/dist          # node:zlib brotliCompressSync, BROTLI_PARAM_QUALITY 11
curl -sL https://staticimgly.com/@imgly/background-removal-data/1.7.0/dist/resources.json
curl -sL https://huggingface.co/api/models/<repo>/tree/main/onnx
curl -s -o /dev/null -D - https://www.resizo.net/wasm/squoosh_resize_bg.wasm
curl -s -o /dev/null -D - https://www.resizo.net/resize
```

**IMG.LY model manifest** (`resources.json`, fetched 2026-09-09): `/models/isnet` 176,149,806; `/models/isnet_fp16` 88,152,708; `/models/isnet_quint8` 44,348,940; `/onnxruntime-web/ort-wasm-simd-threaded.jsep.wasm` 23,013,109; `/onnxruntime-web/ort-wasm-simd-threaded.wasm` 11,819,815.

**Licences and law**
- AGPL v3 text: https://www.gnu.org/licenses/agpl-3.0.en.html
- FSF GPL FAQ, linking: https://www.gnu.org/licenses/gpl-faq.html#IfLibraryIsGPL
- FSF GPL FAQ, static vs dynamic: https://www.gnu.org/licenses/gpl-faq.html#GPLStaticVsDynamic
- FSF GPL FAQ, aggregation: https://www.gnu.org/licenses/gpl-faq.html#MereAggregation
- IMG.LY repo and README: https://github.com/imgly/background-removal-js
- BRIA licence agreement: https://bria.ai/bria-huggingface-model-license-agreement/
- RMBG-1.4 card: https://huggingface.co/briaai/RMBG-1.4
- RMBG-2.0 card: https://huggingface.co/briaai/RMBG-2.0
- BiRefNet: https://github.com/ZhengPeng7/BiRefNet and https://github.com/ZhengPeng7/BiRefNet/blob/main/LICENSE
- MODNet licence sentence: https://github.com/ZHKKKe/MODNet
- DIS / IS-Net: https://github.com/xuebinqin/DIS, terms at `DIS5K-Dataset-Terms-of-Use.pdf` in that repo
- U-2-Net: https://github.com/xuebinqin/U-2-Net/blob/master/LICENSE
- InSPyReNet: https://github.com/plemeri/InSPyReNet/blob/main/LICENSE
- BEN2: https://github.com/PramaLLC/BEN2/blob/main/LICENSE
- ormbg: https://huggingface.co/schirrmacher/ormbg

**Runtime**
- ONNX Runtime env flags and threading rule: https://onnxruntime.ai/docs/tutorials/web/env-flags-and-session-options.html
- ONNX Runtime web deploy and file layout: https://onnxruntime.ai/docs/tutorials/web/deploy.html
- ONNX Runtime 4 GB limit: https://onnxruntime.ai/docs/tutorials/web/large-models.html
- ONNX Runtime Web compatibility matrix: https://github.com/microsoft/onnxruntime/blob/main/js/web/README.md
- WebGPU unsupported on iOS: https://github.com/microsoft/onnxruntime/issues/22776
- BiRefNet 7 GB / wasm32 OOM: https://github.com/microsoft/onnxruntime/issues/21968
- Safari JSEP memory growth: https://github.com/microsoft/onnxruntime/issues/26827
- Transformers.js local models: https://huggingface.co/docs/transformers.js/en/custom_usage
- Cross-origin isolation guide: https://web.dev/cross-origin-isolation-guide/
- COEP require-corp and same-origin subresources: https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Cross-Origin-Embedder-Policy

**Browser support**
- https://caniuse.com/webgpu
- https://web.dev/blog/webgpu-supported-major-browsers
- https://webkit.org/blog/17333/webkit-features-in-safari-26-0/
- https://developer.chrome.com/blog/webgpu-release
- https://developer.mozilla.org/en-US/docs/Mozilla/Firefox/Releases/141
- https://developer.mozilla.org/en-US/docs/Web/API/WorkerNavigator/gpu

**Timings**
- IMG.LY WebGPU benchmark, 11 Jun 2024: https://img.ly/blog/browser-background-removal-using-onnx-runtime-webgpu/
- Transformers.js performance leaderboard: https://huggingface.co/datasets/whitphx/transformersjs-performance-leaderboard-results
- Practitioner notes on iOS silent tab death: https://dev.to/allplix/client-side-background-removal-with-onnx-runtime-web-a-few-things-that-tripped-me-up-350g

**Not found, stated as absences rather than filled in**
- Any browser inference timing on a named phone, for any of these models.
- Peak activation memory for any candidate on the WASM backend.
- A successful browser benchmark for BiRefNet_lite on any backend.
- Published quality numbers for RMBG-1.4, RMBG-2.0, BEN2 or InSPyReNet.
- A public price for either IMG.LY's or BRIA's commercial licence.
- An authoritative iOS per-tab memory ceiling from Apple.
- Whether Vercel brotli-compresses `application/octet-stream`.
