<div align="center">

![Next.js](https://img.shields.io/badge/Next.js%2016-black?style=flat-square&logo=next.js&logoColor=white)
![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?style=flat-square&logo=javascript&logoColor=black)
![Supabase](https://img.shields.io/badge/Supabase-3ECF8E?style=flat-square&logo=supabase&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-2496ED?style=flat-square&logo=docker&logoColor=white)
![Vercel](https://img.shields.io/badge/Vercel-000000?style=flat-square&logo=vercel&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-blue?style=flat-square)
[![CI](https://github.com/sucheet2000/resizo/actions/workflows/ci.yml/badge.svg)](https://github.com/sucheet2000/resizo/actions/workflows/ci.yml)

# Resizo

**Resize, compress, convert, crop, and convert HEIC images — free, no account required.**

[Live Demo](https://www.resizo.net)

</div>

---

## How it works

Resizo does not process anything in the browser. Every tool uploads the file to a Next.js
API route, where [Sharp](https://sharp.pixelplumbing.com/) processes it in memory on the
server and streams the result back. The file is never written to disk and is discarded the
moment the response is sent — nothing is stored unless you're signed in and choose to keep
a history entry (dimensions/format/byte counts only, never the image itself).

## Tools

Core tools, each a real route with its own settings, content, and FAQ:

| Route | What it does |
| :--- | :--- |
| **[/](https://www.resizo.net)** | Homepage — a quick drop-to-resize entry point that hands off to the resize tool, plus the tool index and reviews |
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

Other pages: `/about`, `/privacy`, `/terms`, and `/dashboard` (resize history, reviews,
account deletion/export for signed-in users — excluded from search indexing).

## Technology Stack

| Layer | Technology |
| :--- | :--- |
| **Frontend** | Next.js 16 App Router, React 19, Tailwind CSS 4 |
| **Image Processing** | Sharp, server-side, inside Next.js API routes |
| **Authentication** | Supabase Auth — Google OAuth (PKCE) + email/password |
| **Database** | Supabase PostgreSQL with Row Level Security |
| **Rate Limiting** | Upstash Redis — sliding window, per endpoint, per IP |
| **Deployment** | Vercel (production), Docker multi-stage (self-hosted) |
| **CI** | GitHub Actions — lint → test → build |

## Architecture

```text
       [ Browser / Client ]
                │
                ▼ (Upload)
[ Next.js 16 API Routes (App Router) ] ◄════╗ (Rate limiting via Upstash Redis)
                │                           ║
                ▼                           ║
      [ Sharp Processing ]                  ║
  (In-memory, server-side, never persisted) ║
                │                           ║
                ▼                           ║
     [ Supabase PostgreSQL ] ◄══════════════╝ (Auth & user verification)
  (Optional history & reviews + RLS)
```

## Security

* **File Validation:** Server-side magic-bytes validation — files must be genuinely JPEG,
  PNG, WebP, GIF, or HEIC/HEIF before processing, regardless of what the upload claims to be.
* **Strict Limits:** 20 MB per file, maximum output dimensions of 8000×8000 pixels.
* **Bounds Validation:** Server-side bounds validation on every resize, crop, and compress
  parameter, to prevent memory exhaustion or out-of-bounds access.
* **Rate Limiting:** Every public API route enforces an Upstash Redis sliding-window limit
  keyed on `x-real-ip` (not the spoofable `x-forwarded-for`).
* **Brute Force Protection:** Authentication endpoints are separately rate-limited.
* **Secure Headers:** Content-Security-Policy, HSTS, X-Frame-Options, and
  X-Content-Type-Options are set on every response.
* **Database Security:** Row Level Security is enforced on every Supabase table.
* **Authentication Security:** PKCE OAuth flow, so no authorization token is ever exposed in
  browser history. The Supabase service-role key is used only in server-side route handlers,
  never sent to the client.
* **Metadata Stripping:** EXIF and GPS metadata are stripped from every processed output —
  Sharp strips them by default, and no route re-adds them. Covered by a test.

## GDPR & Privacy

* **Ephemeral Processing:** Images are processed in memory on our server and never written to
  disk or stored between requests.
* **Metadata Removal:** EXIF and GPS metadata are stripped from every output.
* **Right to Erasure:** Full account and history deletion from the dashboard.
* **Data Portability:** Export your resize history as CSV from the dashboard.
* Read the [Privacy Policy](https://www.resizo.net/privacy) and
  [Terms of Service](https://www.resizo.net/terms).

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
   See [Environment Variables](#environment-variables) below for what each of the five keys
   is for.
4. Start the dev server:
   ```bash
   npm run dev
   ```

## Environment Variables

All five variables are required — see [`.env.example`](./.env.example) for the checked-in
template. `next build`/`next dev` will start with dummy values, but any route that touches
Redis or the Supabase service-role client (every image tool, and account deletion) fails at
request time without the real ones.

| Variable | Used by |
| :--- | :--- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase client (browser + server) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase client (browser + server) |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only — `/api/account/delete`'s admin client |
| `UPSTASH_REDIS_REST_URL` | Server-only — rate limiting on every tool + auth route |
| `UPSTASH_REDIS_REST_TOKEN` | Server-only — rate limiting on every tool + auth route |

Optional, both no-op when unset (see [`.env.example`](./.env.example) for details):
`SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN` (error tracking) and `BLOB_READ_WRITE_TOKEN`
(direct-to-Blob uploads for files over the platform's request-body limit — falls back to
the direct-upload path when unset).

## Vercel Deployment

Production config lives in [`vercel.json`](./vercel.json) at the repo root, checked in so
region, framework, and duration ceilings are visible in code review instead of only in
dashboard state.

* **Region:** pinned to `iad1` (Washington, D.C.) rather than left to spread across
  regions. The work here is CPU inside Sharp — an image resize has no data locality — and
  Vercel terminates TCP at one of 126 edge PoPs near the visitor regardless of which region
  the function runs in, carrying bytes the rest of the way over its private backbone. What
  *does* have locality is Supabase (auth + reviews + history) and Upstash (rate limiting),
  both hit on the same request thread. `iad1` should match the Supabase project's region —
  confirm that in the Supabase dashboard and re-pin if it's not `us-east-1`.
* **Duration ceilings:** the `functions` block in `vercel.json` is a safety net, not the
  source of truth — every image route (`resize`, `resize-bulk`, `compress`, `convert`,
  `crop`, `heic`) and the auth routes already export their own `maxDuration`, and that
  route-segment value always wins over `vercel.json`. The net exists so that a route which
  ever loses its own export falls back to a 60s (API) or 20s (page) ceiling instead of the
  platform's 300s default — under Fluid, Provisioned Memory bills for the whole in-flight
  window, so an unbounded render is a real cost risk, not just a latency one.
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
* Commercial/ad-monetized sites are out of scope for the Hobby plan's fair-use terms — this
  project requires **Pro**.

## Docker (Self-Hosted)

Resizo ships a multi-stage Dockerfile and a `docker-compose.yml`. Copy the same template to
a plain `.env` (Compose's default env file — this is a separate file from `.env.local`,
which only Next.js reads):

```bash
cp .env.example .env
# fill in .env with real values, then:
docker-compose up --build
```

`docker-compose.yml` passes the two `NEXT_PUBLIC_*` values in as build args (they're baked
into the client bundle at build time) and loads the full `.env` file into the running
container via `env_file`, so all five variables reach both the build and the running app.

## Database Schema

Resizo runs on Supabase PostgreSQL.

```sql
-- Resize History Table
CREATE TABLE resize_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    original_format TEXT NOT NULL,
    output_format TEXT NOT NULL,
    original_size_bytes BIGINT NOT NULL,
    output_size_bytes BIGINT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE resize_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own resize history"
    ON resize_history FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own resize history"
    ON resize_history FOR INSERT
    WITH CHECK (auth.uid() = user_id);

-- Reviews Table
CREATE TABLE reviews (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    rating INTEGER CHECK (rating >= 1 AND rating <= 5),
    comment TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE reviews ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Reviews are viewable by everyone"
    ON reviews FOR SELECT
    USING (true);

CREATE POLICY "Users can insert own reviews"
    ON reviews FOR INSERT
    WITH CHECK (auth.uid() = user_id);
```

### Migrations

[`supabase/migrations/`](./supabase/migrations) holds schema changes made after the tables
above were first created. **`0001_add_user_id_to_reviews.sql` must be applied to any
existing database** — it adds the `user_id` column shown in the `reviews` table above,
which `/api/account/delete` and `/api/account/export` both depend on to find and act on a
user's reviews. A brand-new database created from the schema above already has the column
and does not need it. Apply it via the Supabase SQL editor or the Supabase CLI
(`supabase db push`). It's written to be a safe no-op against a database where
`public.reviews` doesn't exist yet, which is what lets CI validate it against an empty
database.

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
3. **Build** — `npm run build`, using dummy Supabase values from repository secrets, to
   confirm the app actually compiles.

See [`.github/workflows/ci.yml`](./.github/workflows/ci.yml). This pipeline does not deploy
anything — production deploys are handled separately by Vercel's Git integration on pushes
to `main`.

## License

[MIT](./LICENSE) © 2026 Sucheet Boppana

---

<div align="center">
Built by Sucheet Boppana · Live at <a href="https://www.resizo.net">resizo.net</a>
</div>
