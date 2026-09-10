<div align="center">

# Resizo

Free image tools that run entirely in your browser — resize, compress to a target size, convert (HEIC, WebP, PNG, JPG), crop, signature resizer, DPI, metadata removal, JPG to PDF. Nothing is uploaded: the codecs run as WebAssembly on your own device. Next.js 16, React 19, plain JavaScript, MIT.

[**resizo.net**](https://www.resizo.net)

[![CI](https://github.com/sucheet2000/resizo/actions/workflows/ci.yml/badge.svg?event=pull_request)](https://github.com/sucheet2000/resizo/actions/workflows/ci.yml)
![Next.js](https://img.shields.io/badge/Next.js%2016-black?style=flat-square&logo=next.js&logoColor=white)
![React](https://img.shields.io/badge/React%2019-61DAFB?style=flat-square&logo=react&logoColor=black)
![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?style=flat-square&logo=javascript&logoColor=black)
![WebAssembly](https://img.shields.io/badge/WebAssembly-654FF0?style=flat-square&logo=webassembly&logoColor=white)
![Tailwind](https://img.shields.io/badge/Tailwind%204-06B6D4?style=flat-square&logo=tailwindcss&logoColor=white)
![Vercel](https://img.shields.io/badge/Vercel-000000?style=flat-square&logo=vercel&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-blue?style=flat-square)

</div>

---

## The one thing worth knowing

There is **no upload**. Not "uploaded and deleted quickly" — never sent at all.

Every image is decoded, transformed and re-encoded by the visitor's own browser, in a Web
Worker, using native codecs where the browser has them and WebAssembly where it does not.
The server's entire job is to hand over HTML, CSS, JavaScript and a few `.wasm` binaries.
After that it is not involved and cannot be.

This is not a policy. It is the architecture, and it is checked mechanically:

- There is **no image API route.** `app/api/` contains exactly one file, `health`, and it
  touches nothing external.
- The Content-Security-Policy sets **`connect-src 'self'`**, so a page that tried to POST a
  photo to another host would be blocked by the browser — not merely trusted not to.
- There is **no database, no cache, no object store, no rate limiter and no queue**, so the
  deployment holds no credentials that a breach could expose.
- **There is no fallback lane.** A job this device cannot do is refused with a reason. It is
  never quietly sent somewhere that can.

The honest cost of that design: the device is the limit. See
[Limits](#limits-and-why-they-exist).

---

## Tools

10 tools, each a real route with its own settings, copy and FAQ.

| Route | What it does | Takes |
| :--- | :--- | :--- |
| [`/resize`](https://www.resizo.net/resize) | Exact pixel dimensions or a percentage, aspect-ratio lock, and social presets (Instagram, YouTube thumbnail, LinkedIn…) | JPEG · PNG · WebP |
| [`/compress`](https://www.resizo.net/compress) | A quality slider, **or** name a target size in KB/MB and let it search for the quality that lands there | JPEG · PNG · WebP |
| [`/convert`](https://www.resizo.net/convert) | Between JPEG, PNG and WebP | JPEG · PNG · WebP |
| [`/crop`](https://www.resizo.net/crop) | Pixel-precise, validated against the real source dimensions | JPEG · PNG · WebP |
| [`/heic`](https://www.resizo.net/heic) | iPhone HEIC/HEIF photos → JPEG or PNG | HEIC · HEIF |
| [`/signature-resizer`](https://www.resizo.net/signature-resizer) | Crop a scanned signature to the ink, size it to the pixels a form names, and hold it under a byte ceiling — one pass, writing JPEG or PNG | JPEG · PNG · WebP |
| [`/change-image-dpi`](https://www.resizo.net/change-image-dpi) | Rewrite the print resolution a file claims (1–10000), leaving the compressed image data byte for byte where it was | JPEG · PNG |
| [`/remove-image-metadata`](https://www.resizo.net/remove-image-metadata) | Strip EXIF, GPS and XMP by rewriting the container — no decode, so the picture is unchanged | JPEG · PNG · WebP |
| [`/jpg-to-pdf`](https://www.resizo.net/jpg-to-pdf) | Photos → one PDF, page size and orientation per image | JPEG · PNG · WebP · HEIC |
| [`/merge-pdf`](https://www.resizo.net/merge-pdf) | Combine PDFs into one, reorderable | PDF |

`/change-image-dpi` and `/remove-image-metadata` never touch a pixel. They parse the
container, rewrite the blocks a camera or an editor left in it, and hand back the same
compressed scan — which is why "lossless" is accurate for those two and for nothing else
here. Neither loads a codec, so neither is affected by what WebAssembly can do on the
device.

**Bulk resize** — up to 20 images / 80 MB per batch, zipped on the device — is a mode of
`/resize` (`/resize#bulk`) rather than a URL of its own. Whole folders can be selected at once.

15 intent pages wrap the same engine around one narrower job each:

`/resize-jpg` · `/resize-png` · `/resize-webp` · `/compress-image-to-20kb` ·
`/compress-image-to-50kb` · `/compress-image-to-100kb` · `/compress-image-to-200kb` ·
`/png-to-jpg` · `/jpg-to-png` · `/jpg-to-webp` · `/png-to-webp` · `/webp-to-jpg` ·
`/webp-to-png` · `/heic-to-jpg` · `/heic-to-png`

An intent page is not a page file. It is one entry in `lib/catalog/intents/` — the parent
tool it preconfigures, the headline, the metadata, the direct answer, the procedure, the
sections, the FAQ and the links — rendered by `components/intent/IntentPage.js` through the
single route `app/(tools)/[slug]/page.js` (`generateStaticParams` is the registry,
`dynamicParams` is off, never a catch-all). The entry has to earn its URL:
`lib/catalog/validate.js` fails the build on a duplicate title or path, a preset the tool
cannot honour, and — the doorway move — a page whose body still reads as another page's once
numbers and format names are masked. A page that changes "100 KB" to "50 KB" does not ship.

A third content type sits at `/guides`, and there are 2 guides there today. A guide is not
a tool page with more words and it is never generated from a template: it exists because a
benchmark under `benchmarks/` was run against the real tool, or because an official source
says something, and the finding comes first with the method that produced it on the page.
`lib/catalog/guides/validate.js` fails the build on a guide whose numbers cite no run, and
the registry is allowed to be empty — a guide follows its measurement rather than leading it.

Plus `/`, `/about` and `/tools`, the directory that groups every tool and intent by the need a
visitor arrived with. Every indexable page carries its own canonical, metadata and JSON-LD,
and the whole set is driven by the `lib/catalog/` package so `sitemap.xml`, the navigation,
the hub blocks and the directory cannot drift from the routes that actually exist.

---

## How a job runs

```text
   ┌─────────────────────── your device ───────────────────────┐
   │                                                           │
   │   drop a file                                             │
   │        │                                                  │
   │        ▼                                                  │
   │   magic-byte sniff ── is this really a JPEG?              │
   │        │                                                  │
   │        ▼                                                  │
   │   capability.js ──── will this fit in this tab's memory?  │
   │        │                    │                             │
   │        │                    └──▶ no ──▶ refuse, in words  │
   │        ▼                                                  │
   │   ╔═══════════ Web Worker ═══════════╗                    │
   │   ║  decode → orientation → operate  ║                    │
   │   ║           → encode               ║                    │
   │   ║  native codecs, else WebAssembly ║                    │
   │   ╚══════════════════════════════════╝                    │
   │        │                                                  │
   │        ▼                                                  │
   │   blob: URL ──▶ your download                             │
   │                                                           │
   └───────────────────────────────────────────────────────────┘

   ══════════════════ network boundary ══════════════════
              nothing above this line crosses it

   ┌────────────────────── Next.js server ─────────────────────┐
   │  static HTML · CSS · JS · /wasm/*.wasm · /api/health      │
   │  no image work · no state · no credentials                │
   └───────────────────────────────────────────────────────────┘
```

**Refuse before allocating.** A browser tab that asks for more memory than the phone can
spare is killed — and on iOS it is killed *silently*: no exception, no error event, the photo
is simply gone. So `lib/image-client/capability.js` costs every job against what the device
actually reports *before* a single pixel buffer exists, and refuses what will not fit with a
sentence a person can act on. Over-refusing costs one apology. Under-refusing costs the user
their file.

**Metadata cannot leak, because it is never carried.** The engine decodes to raw pixels and
writes a new file, so EXIF, GPS and camera data never reach the output. There is nothing to
strip. (This one bit us once: JPEG *trailers* — Apple Motion Photo and MPF secondary images —
were being copied verbatim into PDFs, GPS and all. Fixed, and pinned by a test.)

---

## Architecture boundaries — enforced, not aspirational

Prose does not hold a rule. `tests/design/contract.test.js` caught an agent writing banned
marketing copy months after `DESIGN.md` forbade it, and that is the whole argument for this
section existing as **executable tests** instead of a style guide.

Nine rules. Every one was a *measured* problem in this repo before it became a test, and
every one regresses through somebody doing something entirely reasonable.

**`tests/architecture/boundaries.test.js`** — reads the import graph itself, no new
dependency, no config. Each failure names the file and prints the import chain that reaches it.

| # | Rule | What it cost when it broke |
| :--- | :--- | :--- |
| 1 | Nothing in the worker's import graph imports React or carries `'use client'` | The worker thread has no DOM. React there is a second copy of React in a chunk that can never render anything. |
| 2 | `lib/` imports nothing from `app/` or `components/` | An upward edge makes the engine untestable without a React renderer and turns every page into a dependency of every tool. |
| 3 | No module under `lib/image-client/` reaches `lib/catalog/` | They were one file with a fan-in of 38, so editing a marketing sentence invalidated a chunk **the worker downloads**. |
| 4 | `jszip`, `@cantoo/pdf-lib`, `@jsquash/*` and `libheif-js` appear only inside `import()` | One top-level `import JSZip` put **153 KB** of archiver into the first load of `/resize`, `/resize-jpg` and `/resize-png` — paid by everyone who resizes a single image. |
| 5 | No static import cycle inside `lib/` | Every edge in a cycle evaluates eagerly, so one module sees `undefined` where it expects a function — and which one depends on the entry route. |
| 6 | No `'use client'` module reaches `lib/catalog/index.js`, `lib/catalog/intents/` or `lib/catalog/guides/` | The barrel re-exports the copy of every intent page and every guide. `app/error.js` and `RelatedTools` importing one array from it put **76 KB raw / 19 KB brotli** of page copy into the first load of every route, `/about` included. Client code imports the leaf it needs. |

**`tests/architecture/no-dead-code.test.js`** — about what *survives* in the tree rather than
what imports what.

| # | Rule | What it cost when it broke |
| :--- | :--- | :--- |
| 7 | Every module in `lib/` and `components/` is reachable from an entry point | Four were not, totalling 416 lines. **Each had a passing test** — which is exactly why coverage cannot catch this. A test importing a dead module makes it look alive. |
| 8 | The repo root holds only the files named in `ALLOWED_AT_ROOT` | 217 KB of research scratch — three vendor doc pages and a competitor screenshot — was committed to the root and survived four later PRs. Nothing imports a stray root file, so no other rule could see it. |
| 9 | No file in `lib/` is named after a directory beside it | `lib/format-bytes.js` sat next to `lib/format/`, so `@/lib/format…` could mean either — and the worker imports out of `lib/format/`, which made the ambiguity load-bearing. |

There are **no exception lists**, and adding one is not the fix. If a rule is genuinely wrong,
the rule gets deleted along with the reason for it.

**Deliberately not rules.** File length is not a metric chased here — `lib/catalog/tools.js` is a
long flat registry and that is the right shape for it. Abstraction is not introduced before a
second caller exists. And anything that cannot be stated as a check a test could run stays out
of that file entirely, because vague advice is the kind that gets ignored.

---

## Repo map

```text
app/
  (marketing)/          homepage, /about, /tools — shared header/footer via the group layout
    guides/             the guides index and [slug], one route for every guide entry
  (tools)/              the 10 tool routes + [slug], the one route for every intent entry
  api/health/           the only route on the server
  sitemap.js            driven by the registries, never a hand-kept list of URLs
  robots.js             manifest.js error.js not-found.js layout.js globals.css

lib/
  image-client/         THE ENGINE — the only place pixels are touched
    capability.js       can this device do this job? (asked before every allocation)
    decode.js           orientation.js operations.js encode.js
    resize.js           crop.js flatten.js compress-target.js target-bytes.js
    dpi.js              metadata-strip.js — container rewrites, no codec, no decode
    pdf.js              pdf-merge.js codecs.js
    client.js           the front door
    image.worker.js     the thread it all runs on
  image/                pure rules — parsing, bounds, filenames, magic bytes. No pixels.
  format/               pure formatting helpers. NO REACT — the worker imports these.
  hooks/                React only. Every file starts with 'use client'.
  upload/               batch sequencing, folder select, per-file orchestration
  limits.js             every size, dimension and format allowlist. One source.
  catalog/              page copy, kept away from the engine
    tools.js            categories.js presets.js formats.js
    intents/            one module per intent page, plus index.js
    guides/             one module per guide, plus index.js and its own validate.js
    quality.js          the content contract every intent page has to meet
    relations.js        validate.js similarity.js copy.js inline.js
    index.js            the only import path — server code only (rule 6)
  seo.js                schema.js theme.js pending-files.js

components/
  tools/                ToolShell and the shared result panel every tool composes from
  intent/               IntentPage — the one renderer for every intent entry
  guide/                GuidePage and the byline that carries a guide's method
  ui/                   layout/ content/ marketing/ seo/

tests/
  lib/                  components/ app/ api/ — unit + render
  pages/                whole pages rendered to static markup and snapshotted
  architecture/         the 9 boundaries above
  design/               banned copy, design tokens, and these two documents
  helpers/              the import-graph reader and the registry fixtures
  e2e/                  Playwright — see below
    fixtures/           resizo.js, the shared test carrying the automatic guards; files.js
    fixtures/assets/    the one committed binary fixture (a HEIC), with a README saying why
    helpers/            output.js — the download reopened and judged by sharp
    contracts/          SEO, crawl, API, routing, lazy loading, guard proofs — Chromium only
    flows/              every product flow, a real file through the real UI
    browser/            the compatibility set the four non-Chromium projects run
  production/           the smoke `npm run e2e:production` runs against the live site

benchmarks/             the measured runs a guide is written from — run.js, samples, results
docs/                   RFCs and the SEO notes that are not rules
scripts/                sharp-based asset generation, and copy-wasm.js
```

Two splits in there are load-bearing and easy to undo by accident:

- **`lib/limits.js` vs `lib/catalog/`** — numbers the codecs enforce, versus titles and
  descriptions the pages render. They must stay apart (rule 3). If the engine seems to need a
  tool's title, it doesn't: return a code and let the page word it.
- **`lib/format/` vs `lib/hooks/`** — the worker imports out of `lib/format/`. A single
  `useState` added to a file there would drag React across the boundary (rule 1).

---

## Stack

| Layer | Choice |
| :--- | :--- |
| Framework | Next.js 16 (App Router), React 19 — **plain JavaScript, never TypeScript** |
| Styling | Tailwind CSS 4, CSS-first `@theme`. Tokens only; no raw palette utilities, no hex outside `globals.css` |
| Image engine | Native `createImageBitmap` / `OffscreenCanvas` where available, else `@jsquash/{jpeg,png,webp,resize}` (mozjpeg, libwebp, squoosh) via WebAssembly |
| HEIC | `libheif-js` (WebAssembly) |
| PDF | `@cantoo/pdf-lib`, lazily imported |
| Batching | `jszip` — the archive is assembled on the device, lazily imported |
| Server | Static pages, assets, `.wasm` binaries, and `/api/health` |
| State | **None.** No database, cache, object store, accounts or cookies |
| Deploy | Vercel (production) · Docker multi-stage (self-hosting) |
| CI | GitHub Actions — lint → test → build, then the full Chromium E2E and the Firefox/WebKit/mobile compatibility job in parallel |

10 runtime dependencies, 13 dev. Node ≥ 20.

> **`sharp` is a devDependency and a test tool only.** It generates the brand assets, and it
> acts as the independent libvips reference that the browser engine's output is measured
> against in the suite. Importing it from `app/`, `lib/` or `components/` would put image work
> back on the server, which is the one thing this project is not.

---

## Testing

```bash
npm test              # the whole vitest suite, once
npm run test:watch
npm run test:coverage
npm run e2e           # Playwright, all five projects
npm run e2e:chromium  # the authoritative full run, on its own
npm run e2e:browsers  # the four compatibility projects
```

**122 files, 4,753 tests** at the time of writing, across ten kinds:

- **Unit** — every exported function in `lib/`, including the ugly edges: truncated buffers,
  0 / 1 / max / max+1, `NaN`, `Infinity`, unicode and path-traversal filenames, GIF87a vs
  GIF89a, WebP with a corrupt RIFF header.
- **Metamorphic** — *relational* assertions that need no known-good output: resizing to
  50% twice must equal resizing to 25% once; a crop of a resize must equal a resize of a crop
  within tolerance; re-encoding at quality 90 must never exceed the original bytes.
- **Reference** — the browser engine's output compared against `sharp`/libvips as an
  independent implementation.
- **Architecture** — the nine boundaries above.
- **Design contract** — banned copy and design tokens. This one has already caught a real
  regression in the wild.
- **Snapshot** — what each intent page renders (metadata, every heading, paragraph, link,
  table, preconfigured control and JSON-LD node), captured from the original page files
  before they became registry entries. A diff is content the move lost.
- **SEO guards** — the doorway-page checks: masked-copy similarity between pages, duplicate
  presets, pasted paragraphs, numeric slug families, orphaned intents, site-wide title and
  description uniqueness, and copy that claims a data flow the build does not have.
- **Docs** — these two documents, read as text and held to the registries: the tool, intent
  and guide counts, every path in the repo map above, every script named below, and the nine
  rule numbers. Nothing imports a sentence, which is why the sentences rotted for months.
- **Component** — Testing Library, including keyboard and screen-reader behaviour.
- **E2E** — Playwright, across five projects on one server. `chromium-full` runs every spec;
  `firefox-smoke`, `webkit-smoke`, `mobile-chromium` (Pixel 7) and `mobile-webkit` (iPhone 14)
  run the compatibility set in `tests/e2e/browser/**`, filtered by the `@smoke` and `@mobile`
  tags. The image work happens in the visitor's browser, so Chromium agreeing with itself
  proves nothing about the browsers most visitors hold.

Every browser test imports the shared test from `tests/e2e/fixtures/resizo.js` instead of
`@playwright/test`, and gets three guards for free. An uncaught `pageerror` or `console.error`
fails the test, so a tool that throws during hydration cannot pass on its static HTML. Every
request the page makes is recorded and must be a same-origin `GET` or `HEAD` — **the no-upload
promise is proved from the request log on every flow**, not trusted — and a test that processed
a file asserts the log is non-empty, so the guard cannot pass vacuously. And a failure attaches
the browser's own capability report, so a compatibility break reads as "this browser lacks X"
rather than as a bare timeout. Downloads are judged by reopening the bytes with sharp in
`tests/e2e/helpers/output.js`, never by believing the result panel.

Two habits the suite is built on:

1. **Every guard proves it read something before it asserts what it didn't find.** An empty
   import graph violates no boundary; an empty file list contains no stray. A guard that
   silently stopped walking would pass vacuously, so each one first asserts the walk reached
   real modules.
2. **A new architecture assertion is proven RED** by introducing the violation, then reverting.
   A rule nobody has watched fail is a rule nobody knows works.

---

## Limits, and why they exist

| Limit | Value | Why |
| :--- | :--- | :--- |
| File size | 20 MB | Comfortably above a full-frame RAW export; below what a mid-range phone tab can decode |
| Output dimensions | 8000 × 8000 | Beyond this the encode buffer alone outgrows a mobile tab |
| Bulk batch | 20 files / 80 MB | Sequential, so peak memory is one image — the cap is about total time and the ZIP |
| Device memory | Measured per job | The real limit. `capability.js` costs each job against what the device reports |

The device budget is the honest one: **this is the trade for not uploading.** A desktop with
32 GB will do things a five-year-old phone will refuse, and Resizo says so in the refusal
rather than pretending otherwise or shipping the file somewhere else.

---

## Local development

```bash
git clone https://github.com/sucheet2000/resizo.git
cd resizo
npm install
npm run dev
```

**There is nothing to configure.** No `.env` to fill in, no service to sign up for, no key to
paste. `.env.example` is checked in essentially empty, because no runtime secret exists.

The codec `.wasm` binaries are committed under `public/wasm/`, so a clean checkout builds
offline; `postinstall` runs `scripts/copy-wasm.js` to refresh them whenever a codec dependency
moves.

### Environment variables

| Variable | Used by |
| :--- | :--- |
| `VERCEL_GIT_COMMIT_SHA` | Optional, set by Vercel automatically. Only labels the running build in `GET /api/health`. Falls back to `dev` |

That is the complete list. `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` and
`BLOB_READ_WRITE_TOKEN` went with the image routes — if a deployment still has them set, they
are unread and can be deleted.

### Scripts

| Script | What it does |
| :--- | :--- |
| `npm run dev` | Dev server |
| `npm run build` / `npm start` | Production build / serve it |
| `npm run lint` | ESLint — **zero warnings allowed** |
| `npm test` · `test:watch` · `test:coverage` | vitest |
| `npm run e2e` | Playwright, all five projects |
| `npm run e2e:chromium` | The `chromium-full` project alone — every spec, one browser |
| `npm run e2e:browsers` | The four compatibility projects: Firefox, WebKit, Pixel 7, iPhone 14 |
| `npm run e2e:ui` | The interactive Playwright runner |
| `npm run e2e:production` | A smoke against the live site. Starts no server |
| `npm run bench` | The measured runs under `benchmarks/`, where a guide's numbers come from |
| `npm run wasm:copy` | Refresh `public/wasm/` (also runs on `postinstall`) |
| `npm run generate:og` | Rebuild `public/og-*.jpg` |
| `npm run generate:favicon` | Rebuild the favicon, `icon.png` and `apple-icon.png` from the brand mark |
| `npm run generate:samples` | Rebuild the sample images offered on `/resize` |
| `npm run generate:demos` | Rebuild the before/after figures the tool pages carry |
| `npm run generate:bench-samples` | Rebuild the source images `npm run bench` measures against |

The `generate:*` scripts are the only place `sharp` runs, and they are run by hand — the
assets they produce are committed, so a clean checkout never needs them.

---

## Deployment

### Vercel

Production config is checked in at [`vercel.json`](./vercel.json), so region, framework and
duration ceilings are visible in code review instead of living only in dashboard state.

- **Region** pinned to `iad1`. With the image work gone this matters far less than it did —
  pages are static and Vercel terminates TCP at an edge PoP near the visitor either way — but
  a pin still beats leaving it unspecified.
- **Duration ceilings** are a safety net for the one remaining route and for page rendering.
  Under Fluid Compute, provisioned memory bills for the whole in-flight window, so a bounded
  ceiling is cost control as much as latency control.
- **Function memory / CPU tier is deliberately unset** — Vercel does not allow per-function
  memory config while Fluid Compute is enabled, and nothing the server does is CPU-bound.
- **Headers live in `next.config.js`**, per Vercel's own guidance for Next.js projects, and are
  not duplicated into `vercel.json`.

### Docker

```bash
docker compose up --build
```

That is the whole setup. No `env_file`, no `.env`, because the container needs no credentials —
it serves static output, the WASM codecs and the liveness route. Pass `VERCEL_GIT_COMMIT_SHA`
through `environment:` if you want `/api/health` to name the build.

Built from Next's `standalone` output, running as a non-root user, and shipping no native
module: `sharp` is a devDependency and is never traced into the runtime layer.

---

## Security

| | |
| :--- | :--- |
| **Magic bytes, strictly** | Files must genuinely be JPEG, PNG, WebP, HEIC/HEIF or PDF regardless of what the name or MIME type claims. Container checks are done in **full** — WebP needs `RIFF` at 0–3 *and* `WEBP` at 8–11; GIF needs all six bytes; HEIC/AVIF need a real HEIF brand in the `ftyp` box at 8–11. Partial checks once let an SVG polyglot reach a decoder. |
| **Bounds before buffers** | Every resize, crop and compress parameter is validated against the real source dimensions before anything is allocated. |
| **CSP** | `connect-src 'self'` is the mechanical proof of the no-upload promise. `script-src` carries `'wasm-unsafe-eval'` — required for WebAssembly compilation, and nothing else. Remove it and every codec dies before instantiation, taking every tool that decodes a pixel with it — all of them bar `/change-image-dpi` and `/remove-image-metadata`, which load no codec at all. |
| **Headers** | HSTS, `X-Frame-Options`, `X-Content-Type-Options`, Referrer-Policy and Permissions-Policy on every response. |
| **No metadata to leak** | Output is written from raw pixels. EXIF and GPS never reach the download. Covered by a test. |
| **Nothing to breach** | No accounts, no stored files, no credentials in the deployment — because there is no server-side component that could need one. |

## Privacy

- **Nothing is uploaded.** The image is opened, processed and saved by your own browser. It is
  never sent to Resizo or to anyone else, so there is nothing to retain, log, or hand over.
- **No metadata in the output.** EXIF and GPS are absent from every file the tools produce.
- **No accounts, no stored data.** No sign-up, no history, nothing personal at rest.
- **No cookies, no analytics.** No sign-in cookie, no ad cookie, no analytics script of any kind.

---

## Contributing

Read [`CLAUDE.md`](./CLAUDE.md) first — it holds the layering rules, the enforced boundaries
and the gotchas that were learned the hard way. [`DESIGN.md`](./DESIGN.md) is binding for
anything visual, including its rejection clause.

The bar for any change: **lint clean, full suite green, `next build` succeeds** — with real
output, not claims.

One copy rule matters more than the rest. The truth inverted when the server went away, so the
strongest thing this product can say is now also the accurate thing: *in your browser*, *never
leaves your device*, *no upload*. What is **banned** is any claim that a file is uploaded,
sent, stored, received or deleted afterwards — "processed on our server", "sent over HTTPS",
"never kept", "deleted the moment your download starts". `tests/design/contract.test.js`
enforces that list. Where a limit is the device's, say that it is the device's.

---

## License

[MIT](./LICENSE) © 2026 Sucheet Boppana

<div align="center">
<br>
Built by <b>Sucheet Boppana</b> · Live at <a href="https://www.resizo.net">resizo.net</a>
</div>
