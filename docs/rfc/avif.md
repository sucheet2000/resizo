# RFC: Browser-local AVIF support for Resizo

**Status:** research only — no repository file was modified, nothing was installed into the repo, no git command was run.
**Date:** 2026-09-09
**Machine for every measurement below:** Apple M1 Pro, 8 cores, macOS 25.5.0 (Darwin), Node v20.20.2.
**Scratch:** `/private/tmp/claude-501/-Users-sucheetboppana-resizo-1/b99e7ec2-6ba5-4fb0-8165-2325d384d062/scratchpad/bench/`

---

## Summary

**Ship AVIF decode. Do not ship the AVIF encoder.**

Decode is nearly free and the engine already does it. `lib/image-client/decode.js` hands every
non-HEIC format to `createImageBitmap` before it considers a WASM codec, and every browser that
matters decodes AVIF natively — 95.4% of global traffic per caniuse. The magic-byte sniffer in
`lib/image/magic-bytes.js` already returns `'avif'`, and `lib/format/upload-helpers.js` already
carries the label, MIME type and `.avif` extension. Adding AVIF as an *input* costs **zero bytes of
new download** and no new codec. What blocks it today is only the allowlists in `lib/limits.js`.

Encode is a different product. The single-threaded encoder is **842,416 bytes brotli** — twice the
compressed weight of every codec on the site combined (422,181 bytes for all seven). At the default
speed it took **104 seconds** for one 12-megapixel photo on an M1 Pro laptop; a phone is slower
still. Turned up to a speed a phone could tolerate, it produces **larger files at worse SSIM than
the WebP encoder the site already ships**. There is no operating point where a browser AVIF encoder
is both fast enough and better than what is already there.

The repo's existing note in `lib/limits.js` — "823 KB of extra download and 15-30 seconds per image
on a phone" — is **correct**. I measured 842,416 bytes brotli, which is 822.7 KiB. That decision
should stand for the encoder and be reversed only for the decoder.

One safety finding outranks the rest. If a WASM AVIF decoder is ever added as a fallback, the memory
gate is wrong by 4.3×: a 12 MP AVIF decode grows the WASM heap to **449 MB**, where `capability.js`
models a decode as two RGBA surfaces plus a 24 MB baseline — 115.7 MB. The real cost crosses the
iOS budget at about 16 MP, and the engine currently permits sources up to 80 MP. That is the exact
failure `capability.js` exists to prevent.

---

## Context

Resizo processes every image in the visitor's browser. There is no image API route, no fallback
lane, and a job the device cannot do is refused with a sentence rather than sent anywhere. The
engine is `lib/image-client/`, staged decode → orientation → operations → encode, and it runs in a
Web Worker. `tests/architecture/boundaries.test.js` fails the build if a heavy package is imported
statically anywhere in `lib/`.

**AVIF is not new here — it was removed on purpose, and the removal is published copy.** This RFC is
a proposal to reverse half of a prior decision, so the record matters:

| Where | What it says today |
|---|---|
| `lib/limits.js:60-69` | "AVIF and GIF are deliberately absent from all of them… an AVIF *encode* costs 823 KB of extra download and 15-30 seconds per image on a phone." |
| `lib/image-client/encode.js:128` | throws `'AVIF is not supported in the browser build yet.'` |
| `lib/image-client/operations.js:758` | "there is no AVIF decoder and no AVIF encoder available in a browser build" |
| `app/(marketing)/page.js:86` | homepage FAQ: "AVIF and GIF are not accepted: there is no decoder for either one here" |
| `app/(marketing)/about/page.js:139` | "Two formats went with the change — AVIF and GIF are no longer accepted anywhere" |
| `tests/lib/constants.test.js:251-266` | asserts AVIF is on no allowlist, convert included |
| `tests/app/tool-answers.test.js:157` | asserts an answer mentioning "AVIF, which has no codec in this build" |
| `tests/app/convert-formats.test.js` | a suite that exists *because* AVIF drift happened once already |

The claim "there is no decoder for either one here" is the part that is now wrong, and it is wrong
in a way that costs the site real intake. Every browser Resizo supports decodes AVIF natively. The
sentence was true about a WASM codec and was written as if it were true about the browser.

**What an AVIF file does today.** It is sniffed correctly and refused clearly, which is the right
behaviour for an unsupported format:

1. `lib/image/magic-bytes.js` reads the `ftyp` major brand at offset 8-11, matches `avif`/`avis`
   before the HEIC brand set, and returns `'avif'`.
2. `lib/hooks/useImageUpload.js:136-138` compares that against the tool's `accept` list. No list in
   `lib/limits.js` contains `'avif'`, so it returns `rejectWrongType(acceptedFormats)`.
3. The OS file picker never offers it: `acceptAttribute(['jpeg','png','webp'])` emits no
   `image/avif` token. Drag-and-drop still delivers the file, and step 2 refuses it.
4. `assessFile` in `capability.js` would have passed it — `validateUpload` is called with
   `allowedTypes: ['image/*', …]` and `image/avif` matches `image/*`. The format gate, not the file
   gate, is what stops AVIF.

So the plumbing is complete and pointed the wrong way. Nothing needs to be built to recognise AVIF;
something needs to be *permitted*.

---

## Candidates

| Package | Version | Published | Weekly DL | Wrapper licence | Underlying codecs | Encode | Decode | Maintained | Verdict |
|---|---|---|---|---|---|---|---|---|---|
| **`@jsquash/avif`** | 2.1.1 | 2025-05-20 | 82,307 | Apache-2.0 | libavif 1.0.1 + **libaom 3.7.0** (BSD-2 + AOM Patent 1.0) | yes | yes | yes — repo 724★, last push 2026-01-05 | **Only credible option.** Same family as the four installed codecs |
| `wasm-image-optimization` | 2.0.10 | 2026-09-01 | 8,799 | — | libaom **3.11.0** (README claims dav1d; `strings` finds none) | yes | yes | most active | Facade API, not an encode/decode pair. 1,752,432 B brotli — 2× jSquash, drags in Skia/GIF/SVG |
| `@jimp/wasm-avif` | 1.6.1 | 2026-04-07 | 21,516 | — | depends on `@jsquash/avif@^1.3.0` | yes | yes | yes | **Is jSquash**, pinned to an *older* line. No reason to prefer it |
| `@saschazar/wasm-avif` | 2.0.1 | **2021-10-20** | 209 | — | libavif **0.9.2** | yes | yes | **abandoned** (repo last push 2023-01-05) | No |
| `libavif-wasm` | 0.1.13 | **2022-02-09** | 23 | — | forks the 0.9.2 lineage | — | — | **abandoned**, repo 404, README says `# WIP` | No |
| `avif-wasm` | 0.1.5 | **2021-10-21** | **3** | — | unknown | — | — | **abandoned** | No |
| `@stacksjs/ts-avif` | 0.1.4 | 2026-08-19 | 36,316 | — | none — AV1 in TypeScript | yes | — | new | Output 1.45–1.76× larger at matched quality. Needs ES2026 base64 at load |
| `@browser-mc/webcodecs-avif` | 0.4.2 | 2026-06-07 | 140 | **no licence field** | none — browser `VideoEncoder` | yes | — | 1★, created 2026-05-28 | Interesting, far too young. See "Risks" |
| **`libheif-js` (installed)** | 1.23.2 | 2026-09-05 | 1,223,408 | LGPL-3.0 | libde265 only | no | **no** | yes | **Cannot decode AVIF — and fails silently-wrong.** See below |

### libheif-js does not solve this, and checking it naively is dangerous

The installed `libheif-js` build has **no AV1 codec**. libheif *can* be built with libaom or dav1d,
but `build-emscripten.sh` sets `ENABLE_AOM="${ENABLE_AOM:-0}"` and the prebuilt tarball
`libheif-js` downloads never overrides it. A symbol scan of the shipped `libheif.wasm` finds
`libde265` ×3 and **zero** occurrences of `dav1d`, `aom`, `rav1e` or `SVT`.

The trap: **`decode()` succeeds on an AVIF and reports the correct dimensions**, because libheif
parses the ISOBMFF container fine. The failure only appears at `display()`, which returns `null`.
Any capability probe shaped like "did decode() return an image with sane dimensions?" — which is
exactly the shape of the existing HEIC gate in `decode.js:340-345` — would report AVIF as supported
and then hand the visitor a blank canvas. Getting AVIF out of libheif means forking
`libheif-emscripten`, setting `ENABLE_AOM=1`, and self-hosting a build with libaom **3.6.1**, older
than jSquash's 3.7.0, under **LGPL-3.0** rather than Apache-2.0. Not worth it.

### Licensing

Nothing in the AVIF stack is incompatible with this repo's MIT licence. BSD-2-Clause,
BSD-3-Clause-Clear and Apache-2.0 are all permissive and one-way compatible; none asks the project
to relicense, and there is no copyleft anywhere.

There is one duty that is easy to miss and that upstream does not discharge. **The AOM Patent
License 1.0 §1.2.1 requires the licence text to travel with the binary** — "by including this
License in the documentation, legal notices, and/or other written materials provided with the
Implementation." Serving `avif_enc.wasm` from `public/wasm/` is distributing an Implementation in
binary form. The published `@jsquash/avif@2.1.1` tarball ships exactly one licence file, the
Apache-2.0 text, and **no** libaom BSD text and **no** copy of `PATENTS`. Depending on the package
does not discharge the duty.

If the encoder ever ships, a static third-party notices file must go with it, carrying four texts in
full: libavif's BSD-2-Clause, libaom's BSD-2-Clause, the AOM Patent License 1.0, and Apache-2.0.
The patent grant's defensive-termination clause (§1.3) is a non-issue for a free image tool: it
fires only if *you* start AV1-essential patent litigation, and it is the same shape as Apache-2.0
§3, which the project already accepts via jSquash.

**This duty does not arise for the decode-only proposal**, because decode-only ships no AVIF binary
at all.

---

## Measurements

Every number below is from a command I ran. The exact commands are in the code fences.

### Payload sizes

```bash
npm pack @jsquash/avif --pack-destination <scratchpad>/packs   # also @saschazar/wasm-avif, avif-wasm, @browser-mc/webcodecs-avif
tar -xzf jsquash-avif-2.1.1.tgz
node -e "const fs=require('fs'),zlib=require('zlib');const b=fs.readFileSync(f);
  zlib.brotliCompressSync(b,{params:{[zlib.constants.BROTLI_PARAM_QUALITY]:11,
  [zlib.constants.BROTLI_PARAM_SIZE_HINT]:b.length}})"
```

| Binary | Raw bytes | Brotli q11 | Ratio |
|---|---:|---:|---:|
| `@jsquash/avif` `avif_dec.wasm` | 1,170,930 | **267,341** | 0.228 |
| `@jsquash/avif` `avif_enc.wasm` (single-thread) | 3,485,872 | **842,416** | 0.242 |
| `@jsquash/avif` `avif_enc_mt.wasm` (threaded) | 3,534,665 | **852,879** | 0.241 |
| `@saschazar/wasm-avif` `wasm_avif.wasm` | 2,140,011 | 754,409 | 0.353 |

**Context — the whole existing codec payload, measured the same way:**

| Existing binary | Raw | Brotli |
|---|---:|---:|
| `mozjpeg_dec.wasm` | 166,470 | 52,783 |
| `mozjpeg_enc.wasm` | 251,524 | 49,581 |
| `squoosh_png_bg.wasm` | 181,088 | 72,055 |
| `squoosh_resize_bg.wasm` | 34,545 | 14,825 |
| `webp_dec.wasm` | 137,960 | 40,016 |
| `webp_enc.wasm` | 281,261 | 90,860 |
| `webp_enc_simd.wasm` | 345,584 | 102,061 |
| **all seven, total** | **1,398,432** | **422,181** |
| `libheif-bundle.mjs` (base64-inlined, not in `public/wasm`) | 1,461,926 | 388,879 |

**The AVIF encoder alone is 842,416 bytes brotli — 2.0× the compressed size of every codec the site
ships put together.** It is also larger than libheif, which `CLAUDE.md` calls "the largest binary on
the site". The repo's existing "823 KB" figure is 822.7 KiB, and matches exactly.

### Encode time and output size

`@jsquash/avif` selects the **single-threaded** build under Node (`isRunningInNode()` in
`encode.js`), which is also what a browser without cross-origin isolation gets. Source image is the
repo's own `public/samples/landscape-1600x1067.jpg`. Quality 50, `subsample: 1` (4:2:2) — the
package defaults.

```bash
node enc.mjs 2mp 0,4,6,7,8,9,10 50          # 1600x1067, native detail, no resampling
node enc.mjs 12mp-detail 6,8 50             # 4240x2830, the photo tiled at native scale
node enc.mjs 12mp-detail 9 50
```

**1.71 MP (1600×1067), single-thread WASM:**

| speed | ms | output bytes |
|---:|---:|---:|
| 0 | **518,910** | 16,079 |
| 4 | 34,762 | 17,381 |
| **6 (default)** | **20,289** | 18,000 |
| 7 | 7,780 | 17,439 |
| 8 | 981 | 33,739 |
| 9 | 750 | 22,924 |
| 10 | 1,040 | 22,924 |

**12.0 MP (4240×2830), single-thread WASM:**

| speed | ms | output bytes |
|---:|---:|---:|
| **6 (default)** | **103,957** | 53,805 |
| 8 | 3,848 | 170,778 |
| 9 | 1,883 | 120,812 |

Three findings worth carrying:

1. **Speed 8 is strictly dominated by speed 9** — slower *and* larger, at both resolutions
   (981 ms/33,739 B vs 750 ms/22,924 B; 3,848 ms/170,778 B vs 1,883 ms/120,812 B). Reproducible.
   Speeds 9 and 10 produce byte-identical output, consistent with libavif mapping both to libaom
   RealTime `cpu-used` 9.
2. **Speed 0 is pointless.** 518,910 ms — 8.6 minutes for a 1.7 MP image — to save 11% over speed 6.
3. **Content detail dominates encode time, not pixel count.** A 12 MP image *upscaled* from the
   1600 px source encoded at speed 6 in 4,966 ms; the same 12 MP frame carrying real detail took
   103,957 ms. **21× apart at identical dimensions.** Any AVIF benchmark built on an upscaled
   fixture is meaningless, which is very likely why published per-megapixel figures do not exist.

**Anchors on the same 12 MP frame, through the site's own installed codecs:**

```bash
node anchor.mjs 12mp-detail
```

| Codec | ms | bytes |
|---|---:|---:|
| MozJPEG q75 (`@jsquash/jpeg`) | 4,178 | 359,723 |
| libwebp q75 (`@jsquash/webp`) | 10,888 | 151,272 |
| AVIF speed 6 q50 | 103,957 | 53,805 |
| AVIF speed 9 q50 | 1,883 | 120,812 |

### Rate-distortion, matched on quality rather than on a setting number

Comparing q50 against q75 proves nothing, so I scored every output. SSIM is the canonical
Wang et al. formulation — 11×11 Gaussian window, σ=1.5, K1=0.01, K2=0.03, L=255, on the luma plane
— computed against the original RGBA. Each encoded file was decoded back with sharp (native
libvips) so the scorer is codec-independent. 1600×1067, the un-resampled source.

```bash
node rd.mjs      # writes rd-results.json
```

| Codec | setting | bytes | bpp | encode ms | **SSIM** |
|---|---|---:|---:|---:|---:|
| AVIF s6 | q30 | 9,728 | 0.046 | 31,374 | 0.97171 |
| AVIF s6 | q50 | **18,000** | 0.084 | **24,152** | **0.98752** |
| AVIF s6 | q70 | 33,277 | 0.156 | 20,460 | 0.99515 |
| AVIF s9 | q30 | 9,929 | 0.047 | 1,596 | 0.94572 |
| AVIF s9 | q50 | 22,924 | 0.107 | 896 | 0.97406 |
| AVIF s9 | q70 | 47,137 | 0.221 | 1,147 | 0.99029 |
| MozJPEG | q55 | 43,159 | 0.202 | 955 | 0.97872 |
| MozJPEG | q70 | 52,649 | 0.247 | 1,152 | 0.98535 |
| MozJPEG | q82 | 74,068 | 0.347 | 1,681 | 0.99785 |
| WebP | q55 | **22,492** | 0.105 | **849** | **0.98438** |
| WebP | q70 | 25,214 | 0.118 | 457 | 0.98712 |
| WebP | q82 | 34,434 | 0.161 | 490 | 0.99160 |

**Read at matched SSIM ≈ 0.987:** AVIF s6 gives 18,000 B in 24,152 ms; WebP gives 25,214 B in
457 ms. AVIF is **29% smaller and 53× slower.**

**Read at the phone-tolerable speed:** AVIF s9 q50 scores **0.97406 at 22,924 B**. WebP q55 scores
**0.98438 at 22,492 B** — better quality, fewer bytes, and 896 ms → 849 ms. **At any speed setting a
phone could live with, the AVIF encoder is beaten on both axes by the WebP encoder the site already
ships.**

That conclusion is conservative. SSIM is the metric family libaom's `tune=ssim` optimises for, and
CID22's correlation study ranks MS-SSIM 10th of 15 against human opinion (KRCC 0.5596 vs
SSIMULACRA 2's 0.6934). The metric flatters AVIF, and AVIF still loses at speed 9.

### Decode

```bash
node dec.mjs        # 12 MP, sharp-generated AVIF fixture, 128,184 bytes
node mem2.mjs
```

| Path | ms | s/MP |
|---|---:|---:|
| **AVIF WASM decode** (`@jsquash/avif`) | **6,247** | 0.52 |
| JPEG WASM decode (`@jsquash/jpeg`, already shipped) | **186** | 0.02 |
| AVIF native decode (sharp/libvips, reference) | **381** | 0.03 |

The WASM AVIF decoder is **34× slower than the JPEG decoder already in the build** and **16× slower
than a native AVIF decode**. This is the scaled-up version of jSquash issue #43, where the
maintainer wrote: "I am not sure if we can compete with the browser's own decoder."

### Memory — the number nobody has published

`HEAPU8.byteLength` before and after, single-threaded builds, 12 MP:

```bash
node mem.mjs 12mp-detail 9 encode
node mem2.mjs
```

| Stage | heap before | heap after | **per megapixel** |
|---|---:|---:|---:|
| AVIF encode (speed 9) | 16.0 MB | **346.7 MB** | **28.9 MB/MP** |
| AVIF decode | 16.0 MB | **449.0 MB** | **37.4 MB/MP** |

For comparison, one 12 MP RGBA surface is 47,996,800 bytes — 45.8 MB — which is the exact figure
`capability.js` already cites from the Phase 0 spike.

---

## Browser support

### Decode — native, and effectively universal

| Engine | First `<img>` AVIF | Released | Source |
|---|---|---|---|
| Chrome desktop | 85 | 2020-08-25 | chromestatus.com/feature/4905307790639104 |
| Chrome Android / WebView | 89 | 2021-03-02 | Intent to Ship (blink-dev); ⚠️ chromestatus records `android: null` — no Google primary source |
| Edge | 121 | 2024-01-25 | caniuse `avif.json`; 118-120 were `n` |
| Firefox | 93 | 2021-10-05 | firefox.com/en-US/firefox/93.0/releasenotes/ |
| Firefox animated (`avis`) | 113 | 2023-05-09 | firefox.com/en-US/firefox/113.0/releasenotes/ |
| **Safari iOS/iPadOS** | **16.0** | 2022-09-12 | caniuse `ios_saf: 16.0=y` |
| **Safari macOS** | **16.1, Ventura only** | 2022-10-24 | caniuse `safari: 16.0=n`, `16.1=a`, note 3 |
| Safari, unqualified | 16.4 | 2023-03-27 | webkit.org/blog/13966/ |
| Samsung Internet | 14.0 | 2021-04-17 | caniuse; ⚠️ Samsung's own notes never mention it |

**Global usable: 95.35% full + 0.01% partial**, read live from caniuse.com/avif on 2026-09-09.

The common shorthand "Safari 16 / iOS 16 / macOS Ventura" is right for iOS and **wrong for macOS**:
Safari 16.0 has no AVIF at all, because it shipped for Monterey and Big Sur before Ventura existed.
Safari's AVIF tracks the OS rather than the browser — Apple's WebKit ports use system ImageIO
("any support for AVIF depends on underlying OS support", WebKit Bugzilla 207750).

**`createImageBitmap()` on an AVIF Blob works and does not diverge from `<img>` anywhere.** Measured
across Chromium 151, Firefox 153 and a WebKit 26.5 build against six fixtures (4:2:0, 4:4:4, 10-bit,
alpha, film grain, and an 8-frame `avis` sequence): every one resolved at the right dimensions with
pixel checksums identical between the two paths. Animated AVIF returns frame 1, which is what the
spec requires. WebKit and Mozilla Bugzilla quicksearches for "createImageBitmap avif" both return
zero results.

**This is what makes decode free.** `decode.js:397-402` already routes every non-HEIC format through
`createImageBitmap(blob, { imageOrientation: 'from-image' })`. An AVIF added to an accept list takes
that path with no code change and no download.

### Encode — no usable native path

**No browser can encode AVIF through `canvas.toBlob('image/avif')` in a way this site could use.**

The HTML spec makes PNG the only mandatory type and says an unsupported type must **silently yield
PNG** rather than error — so a naive feature test returns a PNG that looks like a success.

- **Chrome:** no. The encode target set is a three-value enum, `kMimeTypePng, kMimeTypeJpeg,
  kMimeTypeWebp`, with no AVIF branch and no flag. crbug 40848792 ("Canvas.toBlob cannot encode
  AVIF") was opened 2022-06-20, marked P3/S4, and has been untouched for four years.
- **Firefox:** no. Registered encoders are bmp, ico, jpeg, png, webp. Bugzilla 1821907 is NEW and
  unassigned since 2023.
- **Safari:** **yes, and it is a trap.** WebKit on Apple platforms asks ImageIO what it can write,
  and `public.avif` is on the list — measured output is genuine AVIF with working alpha. But it has
  **exactly one quality level**: a 600×400 canvas produced 151,358 bytes at quality 0.05, 0.5 and
  1.0 alike, byte-identical, while JPEG spanned 49× across the same range. Useless for any tool
  shaped like a quality slider or a byte target. (Measured on a Playwright WebKit build, not
  shipping Safari — verify before relying on it.)

**WebCodecs `ImageEncoder` does not exist anywhere.** It is not in the spec; the tracking issue
w3c/webcodecs#204 was closed `not_planned` in 2024 with the editor's comment "No progress and no
plans on this issue for 3 years."

**The `VideoEncoder` av01-keyframe trick is real but not ready.** Chrome and Firefox both support
software `av01` encoding with a full 0-255 quantizer range, and `@browser-mc/webcodecs-avif` ships
the muxer. But you write the AVIF container yourself; `description` is normatively empty for AV1 so
`av1C` must be hand-parsed out of the Sequence Header OBU; alpha needs a second encode and auxiliary
-item muxing; Safari refuses av01 entirely; and **there is no codec string both Chrome and Firefox
accept above 8-bit 4:2:0** — Chromium gives 4:4:4 but not 10-bit, Firefox the reverse. Colour
signalling is a live hazard in both (Chromium tags an sRGB canvas `smpte170m`; Firefox hardcodes
`bt709/limited`, Bugzilla 2056028). The package is 140 weekly downloads and one GitHub star.

**Implication:** decode can use the native lane with no WASM at all. Encode is WASM-only, and the
WASM is the 842 KB brotli binary measured above.

---

## Memory & time

For a 12-megapixel photo, using the measurements above rather than estimates:

**Decode, native lane (the proposed path).** Identical to what `/resize` already pays for a JPEG.
`capability.js` charges `DECODE_SURFACE_COPIES = 2` — the codec's own output and the ImageData copy
— for about 91.6 MB, plus the 24 MB WASM baseline. No AVIF-specific change is needed because no
AVIF codec is loaded. Timing is the browser's own decoder; the native reference measured 381 ms.

**Decode, WASM fallback (recommended against).** 6,247 ms, and the WASM heap grows to **449 MB**, or
37.4 MB per megapixel. Adding the ImageData copy handed back to JS gives ~494.8 MB actually
resident. `capability.js` models the same job at **115.7 MB** — `47,996,800 × 2 + 128,184 + 24 MB`.
**The gate is wrong by 4.3×**, and it under-charges, which is the dangerous direction.

Where that bites, computed against the real budgets:

| | value |
|---|---:|
| `deviceBudgetBytes`, 4 GB device, not iOS | 1024.0 MB |
| `deviceBudgetBytes`, 4 GB device, iOS | **614.4 MB** |
| WASM AVIF decode at 12 MP, measured | 494.8 MB |
| Megapixels at which 37.4 MB/MP crosses the iOS budget | **16.4 MP** |
| `HARD_MAX_SOURCE_PIXELS` (80 MP) at 37.4 MB/MP | 2,992 MB — past the 2 GiB WASM heap ceiling |

So a 12 MP photo squeaks through on iOS by accident, not by design. A 16 MP photo — ordinary on
current Android flagships — is approved by a gate that thinks it costs 154 MB and then asks for more
than the tab has, and iOS kills that tab with no exception and no error event. At the top of the
permitted range the job cannot fit in wasm32 at all, and `_emscripten_resize_heap` returns `false`
past 2 GiB rather than throwing, so it surfaces as a malloc failure inside libaom rather than a
catchable error. If a WASM decoder is ever added, a new operation profile costed at ~37.4 MB/MP is
mandatory, not optional.

**Encode (recommended against).** 28.9 MB per megapixel of WASM heap, so ~347 MB at 12 MP, plus the
JS-side ImageData. And the time:

| Setting | 1.71 MP | 12 MP (M1 Pro laptop) | 12 MP, phone at 2-4× slower |
|---|---:|---:|---|
| speed 6 (default) | 20.3 s | **104 s** | **3.5 – 7 minutes** |
| speed 9 (fastest useful) | 0.75 s | 1.9 s | 4 – 8 s |

**Recommended settings if the encoder were shipped anyway.** Speed 9, never speed 8 (dominated),
never speeds 0-4 (minutes for single-digit percentage gains). Quality 50, `subsample: 1`. But this
is the recommendation that defeats the purpose: at speed 9 the output is worse than WebP's on both
size and SSIM, so the honest recommendation is not to ship it.

**Threading does not rescue it.** The MT build needs `SharedArrayBuffer`, which needs cross-origin
isolation — `Cross-Origin-Opener-Policy: same-origin` plus `Cross-Origin-Embedder-Policy:
require-corp` — site-wide. Squoosh's own measurement of adding threads to AVIF was **−29%**
(5,533 ms → 3,932 ms), because "AVIF has some shared state & computations". A 29% cut off 104 s is
74 s. Worse, `COEP: require-corp` requires every cross-origin subresource to carry CORP or CORS,
and jSquash's single-threaded fallback has broken before (`RuntimeError: indirect call to null`,
Squoosh issue #1397). Paying a site-wide header regime for a 29% improvement on a losing operation
is not a trade worth making.

**Why it is this slow, and why it will not improve.** Both Squoosh and jSquash compile libaom with
`-DAOM_TARGET_CPU=generic` and `-DCONFIG_RUNTIME_CPU_DETECT=0`. **The shipped encoder is plain C
with no SIMD whatsoever.** Google's own guidance says so plainly: "WebAssembly doesn't yet have
access to all the performance primitives of CPUs, so if you want to run libavif at its fastest, we
recommend the command line encoder, avifenc." A contributor benchmarking a libavif 1.3.0 + libaom
3.12.1 bump in August 2026 found it **~18% slower** at speed 8 and level at speed 6 — and warned
that libavif ≥1.1 changed its dependency flags such that jSquash's `-DAVIF_CODEC_AOM=1` "silently
disables the codec". There is no upgrade waiting to fix this.

---

## Quality

AVIF's compression advantage is real, large, and **entirely contingent on encoder effort**. The
headline numbers in circulation are not wrong so much as measured against a baseline this site does
not use.

| AVIF vs… | Figure | Metric | Source |
|---|---|---|---|
| JPEG-XT reference, Annex K, 4:2:0 | −41 to −55% | SSIM BD-rate | Netflix 2020 |
| **libjpeg-turbo**, speed 6 | **−49.9%** | SSIMULACRA2 BD-rate | Google AVIF team |
| **MozJPEG**, speed 6, full range | **−30.3%** | SSIMULACRA2 BD-rate | Google AVIF team |
| MozJPEG, web quality band only | ~−15% | SSIMULACRA2 | Sneyers ⚠️ JPEG XL co-creator |
| **MozJPEG, AVIF speed 9** | **+10.6% — AVIF LOSES** | psnr_hvs BD-rate | Google AVIF team |
| **WebP m4**, speed 6 | **−24.1%** | SSIMULACRA2 BD-rate | Google AVIF team |
| Line art (noto-emoji) vs WebP | −59.2% | SSIMULACRA2 | Google AVIF team |
| **Lossless** | **AVIF far worse** (40,454 B vs WebP's 15,788 B) | bytes | Cloudinary |

**The famous "~50% smaller than JPEG" is a libjpeg-turbo number.** Against MozJPEG — which is what
`lib/image-client/encode.js` actually ships — the gap roughly halves, to about 30% over a full
bitrate sweep and closer to 15% in the quality band real web images live in. web.dev's ">50%
savings" claim cites Jake Archibald's personal blog post as its evidence; its own worked example
shows a 6.3% saving.

**The finding that decides this RFC is that the advantage is bought with time.** Google's own data
shows AVIF at speed 9 *losing* to MozJPEG on psnr_hvs (+10.63) and butteraugli (+18.06). My own
measurement reproduces the same shape against WebP: at speed 9, AVIF is worse than the encoder
already installed, on both bytes and SSIM. Speed 0 buys only ~8% MS-SSIM over speed 6 for 25× the
time.

Two honest caveats in AVIF's favour. First, the quality-band disagreement is genuinely unsettled:
Sneyers, the JPEG XL paper and a recomputation of the PCS 2025 data all find AVIF's lead shrinking
or reversing at high quality, while Barman & Martini (QoMEX 2020, peer-reviewed, targeting SSIM
0.92-0.99) found AVIF best on nearly every metric and dataset. Nobody has run the decisive
experiment. Second, **content type moves the answer more than encoder version does**: CID22 found
AVIF wins diagrams and illustration/logo/text and *loses* landscape-nature and materials-clothes.
Screenshots and line art are AVIF's strongest case, not its weakest.

Neither caveat changes the conclusion, because both are about the slow presets.

---

## Detection & intake changes

### Decode-only (the recommendation)

| File | Change | Why |
|---|---|---|
| `lib/image/magic-bytes.js` | **none** | Already sniffs `avif`/`avis` by major brand, before HEIC |
| `lib/format/upload-helpers.js` | **none** | Already carries `avif` in `FORMAT_LABELS`, `FORMAT_MIME`, `FORMAT_EXTENSIONS` |
| `lib/image/filename.js` | **none** | Already has `avif` in `EXTENSIONS` and the MIME map |
| `lib/image-client/decode.js` | **none** | Non-HEIC formats already go to `createImageBitmap`; `WASM_DECODERS` has no `avif` key, so an old browser gets `This browser cannot open AVIF images.` — the correct refusal |
| `lib/image-client/capability.js` | **none** | `assessFile` already passes `image/avif` via `image/*` |
| **`lib/limits.js`** | **add `'avif'` to `CONVERT_INPUT_FORMATS` only** | The single gate that refuses AVIF today |
| `lib/image-client/encode.js` | **none** | Keep the `'AVIF is not supported'` throw exactly as it is |

That is **one array entry**. Everything else already works.

Two follow-on edits are required because they are published claims that would become false:

- `app/(marketing)/page.js:86` — "AVIF and GIF are not accepted: there is no decoder for either one
  here". Must be rewritten: the browser has an AVIF decoder, and after this change AVIF is accepted
  as input. GIF's half of the sentence stays true.
- `app/(marketing)/about/page.js:139` — "Two formats went with the change — AVIF and GIF are no
  longer accepted anywhere". Same problem.

And four test files assert the current state and would need updating with the reasoning changed, not
merely relaxed: `tests/lib/constants.test.js:251-266`, `tests/app/tool-answers.test.js:157`,
`tests/app/convert-formats.test.js`, plus `tests/app/metadata.test.js` if any copy moves.

**Do not add AVIF to `RESIZE_INPUT_FORMATS`, `RASTER_INPUT_FORMATS` or `PDF_INPUT_FORMATS` in the
first phase.** Those tools re-encode, and their output formats stay JPEG/PNG/WebP; widening them is
a separate, larger conversation about what `/resize` promises. `CONVERT_INPUT_FORMATS` is the
narrowest change that delivers the routes.

**Do not add `'avif'` to `ALLOWED_OUTPUT_FORMATS` or `CONVERT_OUTPUT_FORMATS`.** The throw at
`encode.js:128` is the backstop that stops a format being added to an output list and quietly
producing JPEG bytes under an `image/avif` Content-Type — the trap the file's own comment names.

### If the encoder were ever added (not recommended)

- `scripts/copy-wasm.js` — add `@jsquash/avif/codec/enc/avif_enc.wasm` and
  `codec/dec/avif_dec.wasm` to `SOURCES`. Note the MT build also needs `avif_enc_mt.worker.mjs`,
  which is a JS module rather than a `.wasm` and does not fit that script's shape.
- `lib/image-client/codecs.js` — a `loadAvifEncoder()` in the `once()` pattern. `@jsquash/avif` is
  emscripten with a `locateFile` override, so it matches the JPEG/WebP shape exactly.
- `lib/image-client/capability.js` — **a new operation profile costed at 28.9 MB/MP encode and
  37.4 MB/MP WASM decode.** Without this the gate under-charges by ~4× and iOS tabs die silently.
- `next.config.js` — no CSP change. `script-src 'self' 'wasm-unsafe-eval'` already covers it and
  `connect-src 'self'` already permits fetching `/wasm/*.wasm`. **Threading would require adding
  COOP/COEP**, which is a site-wide behavioural change.
- A static third-party notices file carrying the four licence texts named above.

`tests/architecture/boundaries.test.js` needs **no new rule** — its `HEAVY` list already matches any
specifier starting with `@jsquash/`, so a static `import` of `@jsquash/avif` anywhere in `lib/`
fails the build today.

---

## Proposed routes & phases

Four routes were requested. Two are viable and two are not, and I am naming which is which rather
than proposing all four as equals.

| # | Route | Cost | Verdict |
|---|---|---|---|
| 1 | **AVIF → JPG** | zero new bytes | **Ship** |
| 2 | **AVIF → PNG** | zero new bytes | **Ship** |
| 3 | JPG → AVIF | 842 KB brotli, 104 s at 12 MP | **Do not ship** |
| 4 | PNG → AVIF | same, and AVIF's lossless mode is far worse than PNG's | **Do not ship** |

Route 4 deserves its own note: for the flat-colour and screenshot images people convert *from* PNG,
AVIF lossless is not competitive — 40,454 B where WebP lossless takes 15,788 B and PNG takes
30,127 B. Lossy AVIF from a PNG is a different product than "convert my PNG", and it would silently
throw away exactness on images chosen for being exact.

### Phase 1 — decode-only, one line

Add `'avif'` to `CONVERT_INPUT_FORMATS`. `/convert` then accepts AVIF and writes JPEG, PNG or WebP.
Routes 1 and 2 exist immediately. First-load impact is **zero bytes**, because no codec is added and
`createImageBitmap` is already the default lane.

Update the homepage FAQ and About copy so the no-decoder claim stops being false. Update the four
test files with the reasoning rewritten.

Two intent-registry entries under `lib/catalog/intents/` — `avif-to-jpg` and `avif-to-png` — if and
only if they pass `lib/catalog/validate.js` on their own merits. They must clear the doorway
threshold of 0.35 against every existing page, carry unique title, h1 and description, and be
genuinely different copy rather than a `heic-to-jpg` clone with the format name swapped. That
validation is a real gate and this RFC does not assume it passes.

### Phase 2 — refusal quality, no new bytes

The one real gap in Phase 1: a visitor on Safari 15 or an old Android WebView gets
`This browser cannot open AVIF images.` from `decode.js:414` after the file is already accepted,
rather than at intake. Fix it at intake with a capability probe, not a codec:

```js
// approximately 100 bytes of AVIF, decoded once and memoised
await createImageBitmap(new Blob([TINY_AVIF], { type: 'image/avif' }))
```

That belongs behind `capability.js`, which `CLAUDE.md` names as the one front door for "can this
device do this job". It is a real question — 4.6% of global traffic — and answering it costs one
tiny decode rather than 267 KB of WASM.

### Phase 3 — not proposed

No encoder. No WASM decode fallback. Both are measured above and both lose.

If AVIF *output* is ever revisited, the WebCodecs `av01` path is the one to watch, not
`@jsquash/avif` — it ships no codec bytes at all and rides hardware-adjacent software encoders. It
is not ready in 2026 (no shared codec string above 8-bit 4:2:0, hand-rolled muxing, colour-tagging
bugs in both engines, no Safari), but it is the path where the 842 KB problem disappears rather than
being optimised.

---

## Tests & fixtures

**Fixtures are easy — sharp can already do it.** Confirmed on the installed version:

```bash
node -e "const sharp=require('sharp'); console.log(sharp.versions.sharp, sharp.versions.vips)"
# 0.35.3 8.18.3
node -e "... sharp({create:{...}}).avif({quality:50,effort:4}).toBuffer() ..."
# encode ok, 374 bytes, ftyp brand 'ftypavif'; decode ok, heif 640x480
```

libvips 8.18.3 is built with heif support: `sharp.format.heif` reports `fileSuffix: ['.avif']` on
input and `alias: ['avif']` on output. `CLAUDE.md` already designates sharp as "a test tool only"
and "the independent libvips reference the browser engine is measured against", which is exactly
this use. Several suites already generate fixtures with it, so there is precedent and no new
dependency.

**Tests needed for Phase 1:**

| Test | Where | Asserts |
|---|---|---|
| AVIF signature round-trip | `tests/lib/image/magic-bytes.test.js` | a sharp-generated AVIF sniffs as `'avif'`, and an `avis` brand does too |
| AVIF is not mistaken for HEIC | same | an AVIF listing `mif1` among compatible brands still returns `'avif'` — the ordering `magic-bytes.js` already relies on |
| Allowlist pin, rewritten | `tests/lib/constants.test.js` | `CONVERT_INPUT_FORMATS` contains `'avif'`; `ALLOWED_OUTPUT_FORMATS` and `CONVERT_OUTPUT_FORMATS` still **do not** |
| Encode still refuses AVIF | `tests/lib/image-client/` | `encodeImageData({format:'avif'})` throws — the backstop must survive the change |
| Intake accepts AVIF on /convert | `tests/components/tools/` | an AVIF `File` is not rejected by `useImageUpload` with the convert accept list |
| Copy is truthful | `tests/design/contract.test.js` | no page still claims there is no AVIF decoder |
| Metadata uniqueness | `tests/app/metadata.test.js` | any new intent page has a unique title and description, no-upload claim inside 155 chars |

**No `vitest.config.mjs` change is needed.** `NODE_TESTS` already globs `tests/lib/**`,
`tests/app/**`, `tests/architecture/**` and `tests/design/**`, so these land in directories that
already run. A test in a *new* directory would silently never execute — worth stating because
`CLAUDE.md` calls this out as a known trap.

**One test that cannot be written in vitest.** "Does this browser decode AVIF natively" is a real
browser question; jsdom has no `createImageBitmap` that decodes anything. It belongs in the
Playwright suite under `tests/e2e/`, not the unit suite.

---

## Risks

**Reversing published copy.** The homepage and About page both state there is no AVIF decoder. That
is a truthfulness question `tests/design/contract.test.js` exists to police, and `CLAUDE.md` is
explicit that copy must stay truthful. The change is a net *improvement* in truthfulness — the
current sentence is already wrong about the browser — but it must be made deliberately, in the same
PR, or the site contradicts itself.

**The doorway guard may reject the intent pages.** `lib/catalog/validate.js` fails the build on a
page whose body reads as another page's once numbers and format names are masked, at a threshold of
0.35. `avif-to-jpg` sitting beside `heic-to-jpg`, `png-to-jpg` and `webp-to-jpg` is exactly the
shape that guard was built to catch. **Do not loosen the threshold** — `CLAUDE.md` says so directly.
If the copy cannot earn its URL, ship the format support without the intent page.

**Animated AVIF (`avis`) degrades to a still frame, silently.** `createImageBitmap` returns frame 1
by spec. A visitor converting an animated AVIF gets one frame with no warning. `magic-bytes.js`
sniffs `avis` as `'avif'` today, so the two are indistinguishable downstream. Either detect `avis`
separately and refuse it with a sentence, or accept that the tool silently drops animation — and
given the existing standard that "a refusal must reach the panel as text the visitor reads", the
first is the one consistent with the codebase.

**Safari's AVIF is OS-versioned, not browser-versioned.** A visitor on Safari 16.0 on Monterey has
no AVIF and cannot get it by updating Safari. Phase 2's probe handles this; Phase 1 alone gives that
visitor a late refusal.

**Firefox and animated AVIF major brands.** `image.avif.sequence.animate_avif_major_branded_images`
defaults false, so an animated AVIF written with major brand `avif` rather than `avis` shows a still
frame in Firefox. Another reason to treat animation explicitly.

**If the encoder is ever added, four things bite.** The capability gate is wrong by ~4× and iOS dies
silently. The WASM heap ceiling is 2 GiB and `_emscripten_resize_heap` returns `false` past it
rather than throwing, so an over-large job surfaces as a malloc failure inside libaom, not a
catchable JS exception — the engine's `damagedFileRefusal` would mislabel it. jSquash's MT build
uses a nested worker that produces a webpack `Critical dependency` warning under Next (jSquash #92,
maintainer: "unavoidable… you can just ignore the warning"). And the AOM patent licence text must
ship with the binary.

**Prior-decision risk.** Someone already evaluated AVIF and removed it, and the numbers they wrote
down are accurate. This RFC agrees with them about the encoder and disagrees only about the
decoder, on the specific ground that the browser has one and the note conflated the two. That
distinction should be stated in the PR, or this reads as churn.

---

## Recommendation

**Ranked: ship decode-only.**

1. **Ship decode-only (recommended).** Add `'avif'` to `CONVERT_INPUT_FORMATS`, fix the two pages
   that claim there is no decoder, update the four tests, and add the tiny-AVIF capability probe.
   Costs zero download bytes, no new dependency, no CSP change, no memory-gate change. Delivers
   AVIF → JPG and AVIF → PNG, which are the two routes people actually search for, because AVIF is
   the format their phone or a website handed them and JPG is what the form wants.
2. **Do not ship both.** The encoder costs 842 KB brotli — twice every codec on the site combined —
   and 104 seconds for one 12 MP photo at its default setting on a laptop.
3. **Do not ship the encoder alone.** No argument for it exists.

**In plain English.** Adding AVIF *reading* is nearly free, because the browser can already read
AVIF and this engine already asks the browser first. All that stands in the way is a list that says
which formats are allowed, and one entry on that list. A visitor who is handed an AVIF today gets
turned away by a tool that could have helped them.

Adding AVIF *writing* is the opposite. The encoder is a 3.5 MB download — over 800 KB even after
compression, which is more than every other codec on the site put together — and on a laptop it took
a minute and forty-four seconds to convert a single phone photo. Turn it up until it is quick enough
for a phone and it produces bigger, blurrier files than the WebP the site already makes. So there is
no setting where it is worth having: it is either far too slow or worse than what is already there.

The earlier decision to drop AVIF was right about the encoder and its numbers still hold. It was
wrong about the decoder, because it treated "we have no AVIF codec" and "there is no AVIF decoder
here" as the same statement. The browser is the decoder, and the site is currently refusing files it
could open.

---

## Sources

**Repository files read** (none modified): `CLAUDE.md`, `lib/image-client/codecs.js`,
`lib/image-client/decode.js`, `lib/image-client/encode.js`, `lib/image-client/capability.js`,
`lib/image-client/operations.js`, `lib/image/magic-bytes.js`, `lib/image/validate.js`,
`lib/limits.js`, `lib/format/upload-helpers.js`, `lib/hooks/useImageUpload.js`,
`scripts/copy-wasm.js`, `next.config.js`, `vitest.config.mjs`, `package.json`,
`app/(marketing)/page.js`, `app/(marketing)/about/page.js`, `tests/lib/constants.test.js`,
`tests/architecture/boundaries.test.js`.

**Browser support**
- caniuse AVIF — https://caniuse.com/avif (95.35% + 0.01%, read 2026-09-09)
- Chrome 85 — https://chromestatus.com/feature/4905307790639104
- Chrome Android gating — https://groups.google.com/a/chromium.org/g/blink-dev/c/MlTJyKGGtks/m/rTfshC2SBAAJ
- Firefox 93 — https://www.firefox.com/en-US/firefox/93.0/releasenotes/
- Firefox 113 (AVIS) — https://www.firefox.com/en-US/firefox/113.0/releasenotes/
- Safari 16.4 — https://webkit.org/blog/13966/webkit-features-in-safari-16-4/
- Safari AVIF depends on the OS — https://bugs.webkit.org/show_bug.cgi?id=207750
- Firefox animation pref — https://github.com/mozilla/gecko-dev/blob/master/modules/libpref/init/StaticPrefList.yaml

**Canvas / WebCodecs encode**
- HTML spec, serializing bitmaps — https://html.spec.whatwg.org/multipage/canvas.html#serialising-bitmaps-to-a-file
- Chromium encode enum — https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/platform/image-encoders/image_encoder.h
- crbug "Canvas.toBlob cannot encode AVIF" — https://issues.chromium.org/issues/40848792
- Firefox encoders — https://github.com/mozilla/gecko-dev/blob/master/image/build/components.conf
- Firefox AVIF encode bug — https://bugzilla.mozilla.org/show_bug.cgi?id=1821907
- WebKit ImageIO write types — https://github.com/WebKit/WebKit/blob/main/Source/WebCore/platform/graphics/cg/UTIRegistry.mm
- WebCodecs ImageEncoder closed not_planned — https://github.com/w3c/webcodecs/issues/204
- AV1 codec registration ("description is not used") — https://www.w3.org/TR/webcodecs-av1-codec-registration/
- AVIF container spec — https://aomediacodec.github.io/av1-avif/
- `@browser-mc/webcodecs-avif` — https://github.com/tamaina/browser-media-converter/tree/main/packages/webcodecs-avif
- Firefox WebCodecs colour bug — https://bugzilla.mozilla.org/show_bug.cgi?id=2056028

**Quality**
- Netflix AVIF — https://netflixtechblog.com/avif-for-next-generation-image-coding-b1d75675fe4
- Google AVIF team data (the useful one) — https://storage.googleapis.com/avif-comparison/index.html
- Jake Archibald — https://jakearchibald.com/2020/avif-has-landed/
- Cloudinary / Sneyers ⚠️ COI — https://cloudinary.com/blog/contemplating-codec-comparisons
- Daniel Aleksandersen — https://ctrl.blog/entry/webp-avif-comparison.html
- Barman & Martini QoMEX 2020 — https://doi.org/10.1109/QoMEX48832.2020.9123131
- Fukushima et al. PCS 2025 — https://fukushimalab.github.io/spcp/PCS2025_fukushima.pdf
- CID22 metric correlation — https://cloudinary-marketing-res.cloudinary.com/image/upload/v1682076683/CID22.pdf
- SSIMULACRA 2 — https://github.com/cloudinary/ssimulacra2

**Encoder behaviour**
- libaom `cpu-used` range and mode clamping — https://aomedia.googlesource.com/aom/+/refs/heads/main/aom/aomcx.h
- libavif speed → libaom mapping — https://github.com/AOMediaCodec/libavif/blob/main/src/codec_aom.c
- avifenc(1) defaults — https://github.com/AOMediaCodec/libavif/blob/main/doc/avifenc.1.md
- jSquash AVIF Makefile (libavif 1.0.1, libaom 3.7.0, `AOM_TARGET_CPU=generic`) — https://github.com/jamsinclair/jSquash/blob/main/packages/avif/codec/Makefile
- Google: use avifenc, not WASM, for speed — https://web.dev/articles/compress-images-avif
- Squoosh multithreading measurement (−29%) — https://github.com/GoogleChromeLabs/squoosh/pull/829
- jSquash decode slower than native — https://github.com/jamsinclair/jSquash/issues/43
- libavif 1.3.0 bump is not an upgrade — https://github.com/jamsinclair/jSquash/issues/43#issuecomment-5239697662
- Single-thread AVIF encode broken — https://github.com/GoogleChromeLabs/squoosh/issues/1397
- Next.js webpack warning — https://github.com/jamsinclair/jSquash/issues/92
- COOP/COEP — https://web.dev/articles/coop-coep

**Licensing**
- libavif LICENSE — https://github.com/AOMediaCodec/libavif/blob/main/LICENSE
- libaom LICENSE — https://aomedia.googlesource.com/aom/+/refs/heads/main/LICENSE
- **AOM Patent License 1.0** — https://aomedia.googlesource.com/aom/+/refs/heads/main/PATENTS
- dav1d — https://github.com/videolan/dav1d/blob/master/COPYING
- rav1e — https://github.com/xiph/rav1e/blob/master/LICENSE
- SVT-AV1 (BSD-3-Clause-Clear + separate PATENTS.md) — https://gitlab.com/AOMediaCodec/SVT-AV1/-/blob/master/LICENSE.md
- `@jsquash/avif` (Apache-2.0) — https://registry.npmjs.org/@jsquash/avif

**libheif**
- libheif codec table — https://github.com/strukturag/libheif/blob/master/README.md
- `ENABLE_AOM` defaults to 0 — https://github.com/strukturag/libheif/blob/master/build-emscripten.sh
- libheif-js — https://registry.npmjs.org/libheif-js
- Native AVIF encode is slow too (3.5-10 s for 1280×800) — https://github.com/strukturag/libheif/issues/1458

**Caveats on the evidence.** Two research findings were measured on a Playwright WebKit build rather
than shipping Safari and should be re-verified before being relied on: the `toBlob('image/avif')`
result, and the fixed-quality behaviour. Neither changes this RFC's recommendation, because neither
path is proposed. Google's AVIF comparison data is frozen at 2022-12-14; MozJPEG's last release was
2022-08-15; only PCS 2025 uses current encoders. A body of AI-generated SEO content carrying
confident, uncitable AVIF percentages was found and excluded.
