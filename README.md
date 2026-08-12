<div align="center">

![Next.js](https://img.shields.io/badge/Next.js%2016-black?style=flat-square&logo=next.js&logoColor=white)
![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?style=flat-square&logo=javascript&logoColor=black)
![Docker](https://img.shields.io/badge/Docker-2496ED?style=flat-square&logo=docker&logoColor=white)
![Vercel](https://img.shields.io/badge/Vercel-000000?style=flat-square&logo=vercel&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-blue?style=flat-square)
[![CI](https://github.com/sucheet2000/resizo/actions/workflows/ci.yml/badge.svg)](https://github.com/sucheet2000/resizo/actions/workflows/ci.yml)

# Resizo

**Resize, compress, convert, crop, and convert HEIC images — free, no account, nothing kept.**

[Live Demo](https://www.resizo.net)

</div>

---

## How it works

Resizo is a stateless tool: no accounts, no database, no retained files, no ads. Every tool
sends the file to a Next.js API route, where [Sharp](https://sharp.pixelplumbing.com/)
processes it on the server and streams the result back. Files up to ~4.5 MB stay in memory;
larger ones pass through Vercel Blob (temporary object storage) and are deleted right after.
Nothing about the file is kept. EXIF and GPS metadata are stripped from every output.

## Tools

Core tools, each a real route with its own settings, content, and FAQ:

| Route | What it does |
| :--- | :--- |
| **[/](https://www.resizo.net)** | Homepage — a quick drop-to-resize entry point that hands off to the resize tool, plus the tool index |
| **[/resize](https://www.resizo.net/resize)** | Resize by exact pixel dimensions or percentage, with aspect ratio lock, plus social-media presets (Instagram, YouTube thumbnail, LinkedIn, etc.) |
| **[/compress](https://www.resizo.net/compress)** | Quality slider, or target an exact output size in KB/MB |
| **[/convert](https://www.resizo.net/convert)** | Convert between JPEG, PNG, WebP, and AVIF |
| **[/crop](https://www.resizo.net/crop)** | Pixel-precise cropping with server-side bounds validation |
| **[/heic](https://www.resizo.net/heic)** | Convert iPhone HEIC/HEIF photos to JPEG |

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
| **Image Processing** | Sharp, server-side, inside Next.js API routes |
| **Large uploads** | Vercel Blob — files over the platform's 4.5 MB request-body limit upload straight to Blob, then the route fetches by URL (optional; falls back to direct multipart) |
| **Rate Limiting** | Upstash Redis — sliding window, per endpoint, per IP |
| **Deployment** | Vercel (production), Docker multi-stage (self-hosted) |
| **CI** | GitHub Actions — lint → test → build |

## Architecture

```text
       [ Browser / Client ]
                │
                ▼ (Upload — direct, or via Vercel Blob for large files)
[ Next.js 16 API Routes (App Router) ] ◄════╗ (Rate limiting via Upstash Redis)
                │                           ║
                ▼                           ║
      [ Sharp Processing ]                  ║
  (In-memory, server-side, never persisted) ║
                │                           ║
                ▼                           ║
       [ HTTP response = your download ]  ══╝
  (Nothing kept; no database)
```

## Security

* **File Validation:** Server-side magic-bytes validation — files must be genuinely JPEG,
  PNG, WebP, GIF, or HEIC/HEIF before processing, regardless of what the upload claims to be.
* **Strict Limits:** 20 MB per file, maximum output dimensions of 8000×8000 pixels.
* **Bounds Validation:** Server-side bounds validation on every resize, crop, and compress
  parameter, to prevent memory exhaustion or out-of-bounds access.
* **Rate Limiting:** Every public API route enforces an Upstash Redis sliding-window limit
  keyed on `x-real-ip` (not the spoofable `x-forwarded-for`).
* **Secure Headers:** Content-Security-Policy, HSTS, X-Frame-Options, and
  X-Content-Type-Options are set on every response.
* **Metadata Stripping:** EXIF and GPS metadata are stripped from every processed output —
  Sharp strips them by default, and no route re-adds them. Covered by a test.

## Privacy

* **Ephemeral Processing:** Images are processed on our server and never kept between requests —
  small files stay in memory, larger ones pass through temporary Vercel Blob storage and are
  deleted right after processing.
* **Metadata Removal:** EXIF and GPS metadata are stripped from every output.
* **No accounts, no stored data:** There is no sign-up, no history, and no personal data at
  rest — IP addresses are used only for transient rate limiting.
* **No cookies, no analytics:** No sign-in cookie, no advertising cookies, and no analytics script of any kind.

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
3. Copy the environment template and fill in real values:
   ```bash
   cp .env.example .env.local
   ```
   See [Environment Variables](#environment-variables) below.
4. Start the dev server:
   ```bash
   npm run dev
   ```

## Environment Variables

Only the Upstash pair is required — see [`.env.example`](./.env.example) for the checked-in
template. `next build`/`next dev` will start without any of them, but the image tools
rate-limit per request and fail at request time without Upstash. Vercel Blob is optional
and degrades cleanly when unset.

| Variable | Used by |
| :--- | :--- |
| `UPSTASH_REDIS_REST_URL` | Server-only — rate limiting on every tool route |
| `UPSTASH_REDIS_REST_TOKEN` | Server-only — rate limiting on every tool route |
| `BLOB_READ_WRITE_TOKEN` | Optional — direct-to-Blob uploads for large files |

## Vercel Deployment

Production config lives in [`vercel.json`](./vercel.json) at the repo root, checked in so
region, framework, and duration ceilings are visible in code review instead of only in
dashboard state.

* **Region:** pinned to `iad1` (Washington, D.C.) rather than left to spread across
  regions. The work here is CPU inside Sharp — an image resize has no data locality — and
  Vercel terminates TCP at one of 126 edge PoPs near the visitor regardless of which region
  the function runs in, carrying bytes the rest of the way over its private backbone. The one
  stateful dependency on the request thread is Upstash (rate limiting); pin `iad1` to sit near
  the Upstash instance's region, and re-pin if you provision it elsewhere.
* **Duration ceilings:** the `functions` block in `vercel.json` is a safety net, not the
  source of truth — every image route (`resize`, `resize-bulk`, `compress`, `convert`,
  `crop`, `heic`) already exports its own `maxDuration`, and that route-segment value always
  wins over `vercel.json`. The net exists so that a route which ever loses its own export
  falls back to a 60s (API) or 20s (page) ceiling instead of the platform's 300s default —
  under Fluid, Provisioned Memory bills for the whole in-flight window, so an unbounded render
  is a real cost risk, not just a latency one.
* **Function memory / CPU tier — intentionally *not* set in `vercel.json`:** Vercel does
  not allow per-function memory configuration in project config while Fluid Compute is
  enabled (Fluid is the default for new projects); the only lever is the dashboard-only
  Function CPU tier (Project Settings → Functions → Advanced Settings), a Pro+ feature with
  two options — Standard (2 GB / 1 vCPU) and Performance (4 GB / 2 vCPU). This project stays
  on **Standard**. Sharp on Vercel's glibc runtime defaults libvips to a single thread, so a
  single resize can never occupy more than one vCPU — upgrading to Performance would double
  the Provisioned Memory bill with no latency improvement for any individual request. Revisit
  only if sampled `sharp.counters().queue` shows genuine in-instance queueing under real
  traffic, and raise `sharp.concurrency()` in step with the upgrade.
* **Headers stay in `next.config.js`**, per Vercel's own guidance for Next.js projects — they
  are not duplicated into `vercel.json`.
* **Vercel Blob** (direct-to-Blob uploads, see `BLOB_READ_WRITE_TOKEN` above) is provisioned
  per-project from the dashboard's Storage tab, not from `vercel.json`.

## Docker (Self-Hosted)

Resizo ships a multi-stage Dockerfile and a `docker-compose.yml`. Copy the same template to
a plain `.env` (Compose's default env file — this is a separate file from `.env.local`,
which only Next.js reads):

```bash
cp .env.example .env
# fill in .env with real values, then:
docker-compose up --build
```

`docker-compose.yml` loads the full `.env` file into the running container via `env_file`.
Vercel Blob has no self-hosted equivalent, so a Docker deployment always uses the
direct-multipart upload path.

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
| `npm run generate:og` | Regenerate `public/og-*.jpg` (sharp-based, see [scripts/generate-og.js](./scripts/generate-og.js)) |
| `npm run generate:favicon` | Regenerate `app/favicon.ico`, `app/icon.png` and `app/apple-icon.png` from the brand mark (sharp-based, see [scripts/generate-favicon.js](./scripts/generate-favicon.js)) |

## CI

GitHub Actions runs three jobs in sequence on every push/PR to `main`, each gating the
next — **Lint → Test → Build**:

1. **Lint** — `npm run lint` (ESLint, zero warnings allowed).
2. **Test** — `npm test` (vitest).
3. **Build** — `npm run build`, to confirm the app actually compiles.

See [`.github/workflows/ci.yml`](./.github/workflows/ci.yml). This pipeline does not deploy
anything — production deploys are handled separately by Vercel's Git integration on pushes
to `main`.

## License

[MIT](./LICENSE) © 2026 Sucheet Boppana

---

<div align="center">
Built by Sucheet Boppana · Live at <a href="https://www.resizo.net">resizo.net</a>
</div>
