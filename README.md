<div align="center">

![Next.js](https://img.shields.io/badge/Next.js%2016-black?style=flat-square&logo=next.js&logoColor=white)
![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?style=flat-square&logo=javascript&logoColor=black)
![WebAssembly](https://img.shields.io/badge/WebAssembly-654FF0?style=flat-square&logo=webassembly&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-2496ED?style=flat-square&logo=docker&logoColor=white)
![Vercel](https://img.shields.io/badge/Vercel-000000?style=flat-square&logo=vercel&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-blue?style=flat-square)
[![CI](https://github.com/sucheet2000/resizo/actions/workflows/ci.yml/badge.svg)](https://github.com/sucheet2000/resizo/actions/workflows/ci.yml)

# Resizo

**Resize, compress, convert, crop, and convert HEIC images — free, no account, and nothing is
ever uploaded.**

[Live Demo](https://www.resizo.net)

</div>

---

## How it works

Every image is decoded, processed and re-encoded **in the visitor's own browser**. The file is
opened by the page it was dropped on and never leaves the device — there is no upload, no image
API route, no database, no cache, no rate limiter and no object storage. The server's entire job
is to send HTML, CSS, JavaScript and the WebAssembly codecs; after that it is not involved.

The engine lives in [`lib/image-client/`](./lib/image-client). It prefers the browser's own
decoders and encoders where they exist (`createImageBitmap`, `OffscreenCanvas`) and falls back to
WebAssembly builds of the reference codecs — `@jsquash/jpeg`, `@jsquash/png`, `@jsquash/webp`,
`@jsquash/resize`, and `libheif-js` for HEIC/HEIF. Work runs in a Web Worker so the tab stays
responsive.

Because the device does the work, the device is also the limit. A browser tab that asks for more
memory than the phone can spare is killed — silently, on iOS — so every job is costed *before* a
pixel buffer is allocated by `lib/image-client/capability.js`, against what the device actually
reports. A job that does not fit is refused with a sentence the visitor can act on. **There is no
fallback lane:** nothing is sent anywhere when the browser cannot do the job.

EXIF and GPS metadata are absent from every output — the engine decodes to raw pixels and writes
a new file, so there is nothing to strip and nothing to leak.

## Tools

Core tools, each a real route with its own settings, content, and FAQ:

| Route | What it does |
| :--- | :--- |
| **[/](https://www.resizo.net)** | Homepage — a quick drop-to-resize entry point that hands off to the resize tool, plus the tool index |
| **[/resize](https://www.resizo.net/resize)** | Resize by exact pixel dimensions or percentage, with aspect ratio lock, plus social-media presets (Instagram, YouTube thumbnail, LinkedIn, etc.) |
| **[/compress](https://www.resizo.net/compress)** | Quality slider, or target an exact output size in KB/MB |
| **[/convert](https://www.resizo.net/convert)** | Convert between JPEG, PNG, and WebP |
| **[/crop](https://www.resizo.net/crop)** | Pixel-precise cropping, validated against the real source dimensions |
| **[/heic](https://www.resizo.net/heic)** | Convert iPhone HEIC/HEIF photos to JPEG |

Bulk resize (up to 20 images, zipped in the browser with JSZip) is a mode of `/resize` rather
than its own URL.

Pre-configured, single-purpose pages for a specific conversion or target — same tools, a
narrower starting point:

`/heic-to-jpg` · `/png-to-jpg` · `/jpg-to-png` · `/webp-to-jpg` · `/jpg-to-webp` ·
`/png-to-webp` · `/resize-jpg` · `/resize-png` · `/compress-image-to-100kb` ·
`/compress-image-to-200kb`

Every page carries its own canonical, metadata and JSON-LD, and the whole set is driven by
one registry so `sitemap.xml` and `robots.txt` cannot drift from the routes that exist.

Other pages: `/about`.

## Technology Stack

| Layer | Technology |
| :--- | :--- |
| **Frontend** | Next.js 16 App Router, React 19, Tailwind CSS 4 |
| **Image processing** | In the browser: native `createImageBitmap` / `OffscreenCanvas` where available, otherwise `@jsquash/{jpeg,png,webp,resize}` WebAssembly |
| **HEIC decoding** | `libheif-js` (WebAssembly), in the browser |
| **Batching** | JSZip — the ZIP for a bulk resize is assembled on the device |
| **Server** | Static pages, assets and the WASM codecs. One route, `/api/health`, which touches nothing external |
| **Storage / state** | None. No database, no cache, no object store, no accounts, no cookies |
| **Deployment** | Vercel (production), Docker multi-stage (self-hosted) |
| **CI** | GitHub Actions — lint → test → build |

`sharp` is a **devDependency**: it generates the brand assets and acts as the independent libvips
reference the browser engine's output is measured against in the test suite. It never runs in
production.

## Architecture

```text
   [ Your device — the browser tab ]
                │
                ▼
   lib/image-client/  (Web Worker)
   decode → orientation → operation → encode
   native codecs, else WebAssembly
                │
                ▼
       [ blob: URL = your download ]

   ─────────── network boundary ───────────
   Nothing above this line crosses it.

   [ Next.js server ]
   HTML · CSS · JS · /wasm/*.wasm · /api/health
   (no image work, no state, no credentials)
```

## Security

* **File Validation:** magic-bytes validation on the device before decoding — files must be
  genuinely JPEG, PNG, WebP, or HEIC/HEIF regardless of what the name claims. The sniffer also
  recognises GIF and AVIF, which no tool accepts, so those are refused for what they actually
  are instead of slipping through as something else.
* **Strict Limits:** 20 MB per file, maximum output dimensions of 8000×8000 pixels, plus a
  device-memory budget that refuses a job this hardware cannot hold.
* **Bounds Validation:** every resize, crop, and compress parameter is validated against the
  real source dimensions before any buffer is allocated.
* **Secure Headers:** Content-Security-Policy, HSTS, X-Frame-Options, and
  X-Content-Type-Options are set on every response. `connect-src 'self'` is the mechanical
  guarantee behind the no-upload promise: a page that tried to post an image to another host
  would be blocked by the browser, not merely trusted not to. `script-src` carries
  `'wasm-unsafe-eval'`, which is what permits WebAssembly compilation and nothing else.
* **No metadata to leak:** output files are written from raw pixels, so EXIF, GPS and camera
  data never reach the download. Covered by a test.
* **Nothing to breach:** there are no accounts, no stored files and no credentials in the
  deployment, because there is no server-side component that could need one.

## Privacy

* **Nothing is uploaded.** The image is opened, processed and saved by your own browser. It is
  never sent to Resizo or anyone else, so there is nothing to retain, log or hand over.
* **No metadata in the output.** EXIF and GPS data are absent from every file the tools produce.
* **No accounts, no stored data.** There is no sign-up, no history, and no personal data at rest.
* **No cookies, no analytics.** No sign-in cookie, no advertising cookies, and no analytics
  script of any kind.

## Local Development

1. Clone the repository:
   ```bash
   git clone https://github.com/sucheet2000/resizo.git
   cd resizo
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
   The codec `.wasm` binaries are committed under `public/wasm/` so a clean checkout builds
   without extra steps; `postinstall` runs `scripts/copy-wasm.js` to refresh them whenever a
   codec dependency moves.
3. Start the dev server:
   ```bash
   npm run dev
   ```

There is no environment file to fill in. A clean clone runs.

## Environment Variables

**None are required, and that is the point.** No image work happens on the server, so the
deployment holds no credentials at all. `next build`, `next dev` and `docker compose up` all
work with nothing set — see [`.env.example`](./.env.example), which is checked in mostly to say
so.

| Variable | Used by |
| :--- | :--- |
| `VERCEL_GIT_COMMIT_SHA` | Optional. Set by Vercel automatically; only labels the running build in `GET /api/health`. Falls back to `dev` |

The `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` and `BLOB_READ_WRITE_TOKEN` variables
went with the image routes. If a deployment still has them set, they are unread and can be
deleted.

## Vercel Deployment

Production config lives in [`vercel.json`](./vercel.json) at the repo root, checked in so
region, framework, and duration ceilings are visible in code review instead of only in
dashboard state.

* **Region:** pinned to `iad1`. With the image work gone this matters far less than it did —
  pages are static and Vercel terminates TCP at an edge PoP near the visitor regardless — but a
  pin is still preferable to leaving it unspecified.
* **Duration ceilings:** the `functions` block is a safety net for the one remaining route and
  for page rendering. Under Fluid Compute, Provisioned Memory bills for the whole in-flight
  window, so a bounded ceiling is a cost control rather than only a latency one.
* **Function memory / CPU tier — intentionally *not* set:** Vercel does not allow per-function
  memory configuration in project config while Fluid Compute is enabled. Nothing the server does
  is CPU-bound now, so the default Standard tier is more than the app can use.
* **Headers stay in `next.config.js`**, per Vercel's own guidance for Next.js projects — they
  are not duplicated into `vercel.json`. The CSP that permits WebAssembly and forbids
  cross-origin connections lives there.

## Docker (Self-Hosted)

Resizo ships a multi-stage Dockerfile and a `docker-compose.yml`:

```bash
docker compose up --build
```

That is the whole setup. There is no `env_file` and no `.env` to create, because the container
needs no credentials — it serves static output, the WASM codecs and the liveness route. Pass
`VERCEL_GIT_COMMIT_SHA` through `environment:` if you want `GET /api/health` to name the build.

The image is built from Next's `standalone` output and runs as a non-root user. It ships no
native module: `sharp` is a devDependency and is not traced into the runtime layer.

## npm scripts

| Script | What it does |
| :--- | :--- |
| `npm run dev` | Start the Next.js dev server |
| `npm run build` | Production build |
| `npm start` | Run the production build |
| `npm run lint` | ESLint, zero warnings allowed |
| `npm test` | Run the vitest suite once |
| `npm run test:watch` | vitest in watch mode |
| `npm run test:coverage` | vitest with a coverage report |
| `npm run e2e` | Playwright end-to-end suite |
| `npm run wasm:copy` | Copy the codec `.wasm` binaries into `public/wasm/` (also runs on `postinstall`) |
| `npm run generate:og` | Regenerate `public/og-*.jpg` (sharp-based, see [scripts/generate-og.js](./scripts/generate-og.js)) |
| `npm run generate:favicon` | Regenerate `app/favicon.ico`, `app/icon.png` and `app/apple-icon.png` from the brand mark (sharp-based, see [scripts/generate-favicon.js](./scripts/generate-favicon.js)) |

## CI

GitHub Actions runs **Lint → Test → Build → E2E** on every push/PR to `main`, each job gating
the next:

1. **Lint** — `npm run lint` (ESLint, zero warnings allowed).
2. **Test** — `npm test` (vitest).
3. **Build** — `npm run build`, to confirm the app actually compiles.
4. **E2E** — `npm run e2e` (Playwright, chromium).

See [`.github/workflows/ci.yml`](./.github/workflows/ci.yml). This pipeline does not deploy
anything — production deploys are handled separately by Vercel's Git integration on pushes
to `main`.

## License

[MIT](./LICENSE) © 2026 Sucheet Boppana

---

<div align="center">
Built by Sucheet Boppana · Live at <a href="https://www.resizo.net">resizo.net</a>
</div>
