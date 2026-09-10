# Resizo benchmarks

A first-party, reproducible measurement of what the tools on this site actually
do to a file: how small it gets, how long it takes, and what it costs in image
quality.

Every number here is produced by driving the **real pages in a real browser**.
Chromium loads `/compress`, picks a file through the real file input, presses
the real button and catches the real download — the same selectors
`tests/e2e/expansion.spec.js` uses. Nothing in this directory imports
`lib/image-client/` and calls it directly, because a figure produced that way
would be a claim about a module rather than about the product a visitor uses.

```
benchmarks/
  README.md          this file
  run.js             the runner: drives the UI, measures, writes results
  lib/metrics.js     PSNR and SSIM, pure and unit-tested
  lib/report.js      results JSON → the markdown table below, pure and unit-tested
  lib/samples.js     the four inputs, drawn from a seeded PRNG, plus one demo input
  samples/           those five files, committed
  results/           <YYYY-MM-DD>.json and latest.json
  outputs/           every processed file the run produced (gitignored)
```

Tests: `npx vitest run tests/lib/benchmarks` — 61 cases over the metrics, the
sample generator and the report renderer.

## Reproducing a run

The runner **does not build and does not start a server**. A runner that builds
silently measures whatever it happened to build; this one measures what is
already running and refuses with instructions if nothing is.

```bash
# terminal one — a production build, because that is what ships
npm run build
npx next start -p 3910

# terminal two
npm run bench
```

**Do not rebuild while a run is in flight.** `next start` serves out of `.next`,
so a build landing there mid-run swaps the chunks under a live page: routes
half-render and hydration never finishes. The runner records `.next/BUILD_ID`
before and after, sets `buildStable: false` and exits non-zero when they differ,
because that run's numbers describe two different builds.

`BENCH_URL` points the run somewhere else (default `http://127.0.0.1:3910`).
`BENCH_SCENARIOS=dpi,fit-20kb` runs a subset while iterating; a subset run
writes **no** results file, because a partial `results.json` that looks like a
full one is exactly the artefact that gets committed and quoted later.

Regenerating the inputs:

```bash
npm run generate:bench-samples
```

## The four inputs

Generated, never sourced: no third-party photograph, no licence question, and
no stock imagery. Each one is a deterministic composition of shapes drawn by a
seeded PRNG (Mulberry32) and rasterised by sharp. **No text anywhere** — librsvg
would pick a font from the machine it is running on, and one `<text>` element
would make the samples differ between two laptops while the file names stayed
the same. `tests/lib/benchmarks/samples.test.js` holds both halves of that: the
files are byte-identical on a rerun, and no draw function may emit text or name
a font.

| File | Pixels | What it is |
| --- | --- | --- |
| `photo-1600x1067.jpg` | 1600×1067 | A **synthetic photograph-like scene** — sky gradient, a low sun, ridge lines, broken water highlights, a shingle foreground, and fine grain over the whole frame. Nobody took this picture; it is not a photograph and is never described as one. JPEG, quality 95. |
| `screenshot-1440x900.png` | 1440×900 | An application window: chrome, sidebar, cards, hairline rules, and rows of small grey bars where text would be. Hard edges and large flat areas. |
| `graphic-800x800.png` | 800×800 | A logo-like mark on a fully transparent field. Flat fills, one fully opaque shape, curved anti-aliased edges. |
| `illustration-1200x900.png` | 1200×900 | Broad flat colour areas, hard boundaries, no gradients and no grain. |

Four rather than one because an encoder is not one number: JPEG is built for
grain and falls apart on a hard edge, PNG is the reverse, and WebP's lead over
JPEG depends entirely on which of those it is handed.

### And one more that is not one of the four

`transparent-480x320.png` — 480×320, a blue rounded rectangle and an orange
disc, both fully opaque, on a field that is fully transparent right out to all
four corners. Fixed geometry rather than a seed: there is nothing random in it.

It is in `DEMO_SAMPLES` rather than `SAMPLES`, and that distinction is
load-bearing. Scenario A loops over `SAMPLES` and produces four cases per
entry, so an input in the wrong list is sixteen more encodes on every run and
four more rows in a comparison it was never meant to be part of. This one
exists to be **looked at**: it is the before half of the figure on
`/png-to-jpg`, where the whole question is what a format with no alpha channel
does with the see-through part of a PNG. Nothing is ranked against it.

That case records one extra field the others do not: `corner`, the top-left
pixel as RGBA on both sides. `hasAlpha: false` only proves the alpha channel is
gone and says nothing about what took its place, and the figure's caption is a
claim about the colour. A corner is used because the shapes never reach one, so
it is transparent in the source by construction rather than by luck. PSNR and
SSIM are `null` here on purpose — scoring a transparent source against its
flattened output measures the fill colour, which is the thing being
demonstrated rather than a defect to quantify.

## What is measured

Per case: the input file (bytes, pixels, format), the output file (bytes,
pixels, format, and the quality the panel reported when it reported one), the
wall time, the size ratio, and two quality scores against the source.

**Wall time** is the span from clicking the tool's button to the download
affordance appearing on screen — the wait a person actually experiences. It
excludes the page load and the file pick, which are not what a tool is being
measured on. Where a case runs two tools, the per-step times are in the JSON and
the table shows their sum.

**Ratio** is output bytes over **original sample** bytes, not over the
intermediate file a chain may have produced. The intermediate is recorded in
`steps`.

### What "quality" means here

Two numbers, both computed over **BT.601 luma** with the alpha channel ignored:

- **PSNR**, peak signal-to-noise ratio in dB. One global error term. It says how
  far the pixels moved and nothing at all about whether a person would notice.
  An identical pair prints as `∞` rather than as a made-up ceiling.
- **SSIM**, structural similarity — Wang et al. 2004, IEEE TIP 13(4), eq. 13 —
  over an **8×8 uniform window**, one window per pixel position that fits, mean
  over windows. Call it "luma SSIM, 8×8 uniform window" wherever it is quoted.

**This is not MS-SSIM.** There is no multi-scale pyramid and no Gaussian
weighting, so a number from here is not comparable with a paper reporting
MS-SSIM, nor with the Gaussian-window default of the reference `ssim_index.m`.

Both sides are decoded with **sharp (libvips)** before comparison, including the
downloaded file that a browser codec produced. Decoding both sides with one
decoder is the point: the browser's decoder and libvips may round a
chroma-upsampled pixel differently, and that difference would otherwise be
reported as a quality score rather than as what it is — two decoders
disagreeing.

**Transparency is composited away before either side is measured.** RGB
underneath a fully transparent pixel is undefined, every encoder writes
something different there, and a luma metric will happily count pixels no viewer
will ever see. Measured: scoring the logo sample without compositing put its
WebP lane at 20 dB against the JPEG lane's 43 — not because the WebP was worse,
but because the metric was reading the invisible half of the image. So when the
source carries alpha, **both** sides are flattened onto the same black the
convert tool uses, and the score describes what is actually displayed.

Where a comparison is impossible — different pixel dimensions, no reference —
the field is `null` and the reason is written beside it. Nothing is estimated.

### The scenarios

| Id | What it asks |
| --- | --- |
| `jpeg-vs-webp` | The same picture pushed to 100 KB and to 50 KB, as JPEG and as WebP. 16 cases. |
| `fit-20kb` | The photo through `/compress-image-to-20kb` on the shrink-to-fit policy — what does 20 KB cost in pixels? |
| `resize-then-compress` | Downscale to 1200 px then compress to 100 KB, against compressing at full size. Both scored at 1200 px. |
| `dpi` | The photo through `/change-image-dpi` at 300 DPI. The picture must come back untouched. |
| `demo-outputs` | One pass each through `/crop`, `/signature-resizer`, `/png-to-jpg` and `/remove-image-metadata`. Assets to look at, not numbers to rank. |

**`jpeg-vs-webp` converts first, in every case, including JPEG to JPEG.**
`/compress` cannot choose an output format on its own — it writes the format it
was given, and only offers WebP when a lossless PNG cannot reach a target at
all — so the format has to come from `/convert`. Letting the already-JPEG sample
skip that step would hand JPEG one fewer generation of loss than WebP and
quietly rig the comparison. The pipeline is therefore identical in all sixteen
cases and both formats pay the same extra encode. **It measures the tool chain,
not a bare encoder**, and the `/convert` step runs at the tool's own default
quality.

**A byte target is a ceiling, not a goal.** The search returns the best quality
that still fits under the number asked for. Where a source is already smaller
than the target, that means the file comes back **bigger** — asking a 24 KB
screenshot for 100 KB produces a 94 KB JPEG at quality 98 — and the ratio column
goes above 100%. That is the tool working as designed, and the rows are printed
rather than filtered out.

**`resize-then-compress` scores both lanes against one reference:** the source
downscaled to 1200 px by sharp. The full-size lane's output is downscaled to
that same geometry *after* the tool is finished, which is what a reader who
displays the image at 1200 px would see.

## What these numbers must never be used for

- **No "X% better" claims beyond what the table shows.** A row is one encoder,
  on one synthetic input, at one target, on one machine. It is not a general
  statement about JPEG, about WebP, or about any other product.
- **No comparison with another site's benchmark.** Different inputs, different
  window, different decoder. The only honest comparison is one re-run here.
- **No quality claim from bytes alone.** Any byte figure quoted without its SSIM
  is half a sentence: every encoder can hit 50 KB by throwing the picture away.
- **Times are machine-dependent and are not a product claim.** They come from
  one laptop, one Chromium build and one thermal state; the environment block in
  every results file exists so a time is never quoted without it. Bytes and
  quality scores are deterministic for a given build; times are not.
  `loadAtStart` is recorded for exactly this reason — a run started on a busy
  machine reports honest sizes and inflated times, and the runner says so on
  stderr when the one-minute load exceeds the core count. Check it before
  quoting a millisecond.
- **The samples are synthetic.** They are designed to span four content types,
  not to represent the distribution of files real visitors upload — and no file
  a visitor opens is ever seen by this repo, because nothing is uploaded.

## The results schema

`results/latest.json` and `results/<YYYY-MM-DD>.json` hold the same content.

```jsonc
{
  "schema": 1,
  "generatedAt": "2026-09-09T21:00:00.000Z",
  "durationMs": 214000,
  "environment": {
    "commit": "…",        // read out of .git/HEAD by file, no git process
    "branch": "…",
    "buildId": "…",       // .next/BUILD_ID when the build is local, else null
    "buildStable": true,  // false if something rebuilt .next mid-run
    "baseUrl": "http://127.0.0.1:3910",
    "chromium": "151.0.7922.34",
    "node": "v20.20.2",
    "os": "darwin 25.5.0",
    "arch": "arm64",
    "cpu": "Apple M1 Pro",
    "cores": 10,
    "memoryGb": 16,
    "loadAtStart": [2.1, 2.4, 2.2],   // 1/5/15-minute load average
    "loadAtEnd": [3.0, 2.6, 2.3]
  },
  "scenarios": [
    {
      "id": "jpeg-vs-webp",
      "title": "…",
      "cases": [
        {
          "id": "photo-1600x1067-jpg-webp-100kb",
          "sample": "photo-1600x1067.jpg",
          "label": "…",
          "tool": "compress",
          "route": "/compress",
          "ok": true,                 // false records a failure; it is never dropped
          "error": null,              // the tool's own message when ok is false
          "settings": { "targetKb": 100, "policy": "keep", "outputFormat": "webp" },
          "input":  { "bytes": 0, "width": 0, "height": 0, "format": "jpeg", "density": 72, "hasAlpha": false },
          "output": { "bytes": 0, "width": 0, "height": 0, "format": "webp", "quality": 62 },
          "steps":  [ { "route": "/convert", "wallMs": 0, "bytes": 0 } ],
          "wallMs": 0,
          "ratio": 0.25,
          "psnr": 34.2,               // null when it could not be measured
          "ssim": 0.91,               // null when it could not be measured
          "note": null,               // why a null is null, or what to know about the row
          "panel": "…",               // what the result panel said, verbatim
          "file": "benchmarks/outputs/…",
          "requests": 34
        }
      ]
    }
  ]
}
```

A case that failed is **still a row**, with its measurements dashed and its last
cell reading `FAILED` with the tool's own message. An *interrupted* run is the
one exception, and it is not an exception to that rule: Ctrl-C or a kill makes
the runner exit without writing anything at all, so a stopped run can never
overwrite good results with failures that describe the interruption rather than
the product. Silently dropping it would
turn "WebP could not reach 50 KB on this sample" into "every case we printed
worked", which is how a benchmark lies without stating a single false number.

Every case also asserts the promise the whole product rests on: the run records
every request the page made, and a case fails if any of them was not a
same-origin `GET`. No image is uploaded, and the request log is the mechanical
proof rather than the prose.

## Results

Rendered from `results/latest.json` by `lib/report.js`. Re-render after a run:

```bash
node -e "console.log(require('./benchmarks/lib/report').renderReport(require('./benchmarks/results/latest.json')))"
```

<!-- RESULTS -->

Measured 2026-09-10T01:57:07.964Z on commit ef4907b (feat/discovery-ux).

- Machine: Apple M1 Pro — darwin 25.5.0 arm64
- Node: v20.20.2
- Chromium: 151.0.7922.34
- Served from: http://127.0.0.1:3911

### A — JPEG against WebP at a fixed byte target

| Sample | To | Target | In | Out | Ratio | Quality | PSNR (dB) | SSIM | Time |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| photo-1600x1067.jpg | JPEG | 100 KB | 384.2 KB | 97.0 KB | 25.2% | 66 | 36.98 | 0.9568 | 1.31 s |
| photo-1600x1067.jpg | JPEG | 50 KB | 384.2 KB | 48.3 KB | 12.6% | 26 | 33.93 | 0.9222 | 1.32 s |
| photo-1600x1067.jpg | WEBP | 100 KB | 384.2 KB | 99.0 KB | 25.8% | — | 41.22 | 0.9797 | 812 ms |
| photo-1600x1067.jpg | WEBP | 50 KB | 384.2 KB | 49.2 KB | 12.8% | — | 36.92 | 0.9566 | 804 ms |
| screenshot-1440x900.png | JPEG | 100 KB | 24.0 KB | 94.4 KB | 393.4% | 98 | 47.89 | 0.9974 | 1.31 s |
| screenshot-1440x900.png | JPEG | 50 KB | 24.0 KB | 49.8 KB | 207.6% | 89 | 46.65 | 0.9956 | 1.30 s |
| screenshot-1440x900.png | WEBP | 100 KB | 24.0 KB | 24.0 KB | 99.9% | — | 49.84 | 0.9980 | 812 ms |
| screenshot-1440x900.png | WEBP | 50 KB | 24.0 KB | 24.0 KB | 99.9% | — | 49.84 | 0.9980 | 901 ms |
| graphic-800x800.png | JPEG | 100 KB | 51.7 KB | 96.5 KB | 186.8% | 96 | 2.60 | 0.3321 | 809 ms |
| graphic-800x800.png | JPEG | 50 KB | 51.7 KB | 49.3 KB | 95.5% | 86 | 2.61 | 0.3322 | 817 ms |
| graphic-800x800.png | WEBP | 100 KB | 51.7 KB | 62.0 KB | 120.0% | — | 51.56 | 0.9989 | 307 ms |
| graphic-800x800.png | WEBP | 50 KB | 51.7 KB | 48.9 KB | 94.8% | 95 | 51.40 | 0.9989 | 805 ms |
| illustration-1200x900.png | JPEG | 100 KB | 25.0 KB | 48.4 KB | 193.6% | 100 | 47.44 | 0.9965 | 803 ms |
| illustration-1200x900.png | JPEG | 50 KB | 25.0 KB | 48.4 KB | 193.6% | 100 | 47.44 | 0.9965 | 804 ms |
| illustration-1200x900.png | WEBP | 100 KB | 25.0 KB | 16.5 KB | 65.9% | — | 51.08 | 0.9985 | 303 ms |
| illustration-1200x900.png | WEBP | 50 KB | 25.0 KB | 16.5 KB | 65.9% | — | 51.08 | 0.9985 | 804 ms |

A target is a CEILING, not a goal: the search returns the best quality that still fits. Where a source is already smaller than the target the ratio therefore goes above 100% — asking a 24 KB screenshot for 100 KB makes it bigger, at higher quality. Every case converts through /convert first, including JPEG to JPEG, so neither format gets one fewer generation of loss than the other. The two samples with transparency are flattened onto black on both sides before scoring.

### B — /compress-image-to-20kb, the shrink-to-fit policy

| Sample | Target | Out | Ratio | Pixels in | Pixels out | Quality | Time | What the panel said |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| photo-1600x1067.jpg | 20 KB | 19.6 KB | 5.1% | 1600×1067 | 524×350 | 68 | 1.83 s | Asked for 20 KB — landed on 19.64 KB at quality 68 after shrinking the picture from 1600×1067 to 524×350. Nothing was resized silently: this is the Shrink to fit policy you chose. |

### C — downscale first, or compress at full size? (both scored at 1200 px)

| Lane | Out | Pixels out | Quality | PSNR (dB) | SSIM | Time |
| --- | --- | --- | --- | --- | --- | --- |
| Resize to 1200 px, then compress to 100 KB | 98.0 KB | 1200×800 | 85 | 37.88 | 0.9694 | 1.13 s |
| Compress to 100 KB at the full 1600 px | 99.8 KB | 1600×1067 | 66 | 40.95 | 0.9794 | 1.31 s |

Both lanes are scored against one reference: the source downscaled to 1200 px by sharp. The full-size lane's output is downscaled to that same geometry AFTER the tool is finished, which is what a reader displaying the image at that width would see.

### D — /change-image-dpi at 300 DPI

| Sample | Asked | Read back | In | Out | Pixels in | Pixels out | Time |
| --- | --- | --- | --- | --- | --- | --- | --- |
| photo-1600x1067.jpg | 300 DPI | 300 DPI | 384.2 KB | 384.2 KB | 1600×1067 | 1600×1067 | 77 ms |

### E — one pass through crop, signature resizer, PNG to JPG and metadata removal

| Case | Route | In | Out | Pixels out | Time | Saved as |
| --- | --- | --- | --- | --- | --- | --- |
| Crop a 900×600 rectangle out of the photo | /crop | 384.2 KB | 37.9 KB | 900×600 | 245 ms | benchmarks/outputs/demo-outputs/photo-crop-900x600.jpg |
| Signature scan into a 300×80 box, JPG under 15 KB | /signature-resizer | 7.9 KB | 4.7 KB | 240×80 | 215 ms | benchmarks/outputs/demo-outputs/signature-300x80.jpg |
| A transparent PNG through /png-to-jpg, filled with white | /png-to-jpg | 4.4 KB | 4.9 KB | 480×320 | 110 ms | benchmarks/outputs/demo-outputs/transparent-on-white-480x320.jpg |
| Strip EXIF and GPS from a camera-shaped JPEG | /remove-image-metadata | 274.7 KB | 274.4 KB | 800×600 | 171 ms | benchmarks/outputs/demo-outputs/metadata-stripped.jpg |

