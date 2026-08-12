# Resizo

Free online image tools (resize, bulk resize, compress, convert, crop, HEIC→JPG) at
https://www.resizo.net. Next.js 16 App Router, **plain JavaScript (never TypeScript)**,
Tailwind 4 (CSS-first `@theme`), React 19. Sharp does all image work **server-side**;
Supabase for auth + resize history + reviews; Upstash Redis for rate limiting.
Production deploys via Vercel; Docker for self-hosting.

## Commands

- `npm run dev` / `npm run build` / `npm start`
- `npm run lint` — must pass with zero warnings
- `npm test` (vitest; `test:watch`, `test:coverage`) — must stay green
- `npm run generate:og` / `generate:favicon` — regenerate brand assets (sharp-based)

Local env: `cp .env.example .env.local` and fill the five vars. `next build` needs at
least dummy values — module scope must never read env vars (see gotchas).

## Layering rules

- `app/api/*/route.js` handlers stay thin: rate-limit → parse → validate → process →
  respond, all through `lib/`. Pure logic never lives inline in a route or component.
- `lib/image/pipeline.js` is the **only** file that may import sharp.
  `lib/http/responses.js` is the only lib file that may import `next/server`.
- Client and server import the same `lib/constants.js` and `lib/image/magic-bytes.js` —
  never re-type a limit, format list, or magic-byte check.
- Pages: server `page.js` exports metadata via `lib/seo.js buildMetadata` (own canonical!)
  + renders JSON-LD (`lib/schema.js`) + one client tool component composed from
  `components/tools/ToolShell.js`. Route groups `(marketing)`/`(tools)` carry the shared
  header/footer in their layouts.
- `DESIGN.md` is binding for anything visual — including its rejection clause. Tokens
  only; no raw Tailwind palette utilities, no hex outside `app/globals.css`.

## Gotchas (learned the hard way — do not relearn)

- **`sharp.withMetadata(false)` KEEPS metadata.** It calls `keepMetadata()` regardless of
  its argument. Sharp strips EXIF/GPS **by default**; the fix is the *absence* of the
  call. A vitest integration test guards this — never add any `withMetadata` call.
- **`png({ quality })` is inert** in our shipped libvips (no libimagequant). PNG size is
  controlled via `palette: true` + `colours:` (`pngPaletteColours(q)` in
  `lib/image/quality.js`). Quantisation only turns on when a quality is supplied, so
  `/convert` output stays full-colour.
- **Never construct Redis/Ratelimit clients or read env vars at module scope** — it
  crashes builds and tests without env. Use `lib/http/rate-limit.js` (`checkRateLimit`/
  `enforceRateLimit`, lazy + memoized, per-route `rl:<name>` prefixes). The old code had
  all five tools sharing one bucket via the default prefix.
- **`new Image()` inside a component that imports `next/image` resolves to the React
  component and throws.** Always `new window.Image()` — dimension reads live in
  `lib/hooks/useImageUpload.js` for exactly this reason (it once broke /crop entirely).
- **Bulk format sentinel is `'original'`** (client) — the server accepts `'original'`
  and `'same'`. Mismatch here once silently converted every bulk PNG to JPEG.
- Magic-byte checks are strict and centralized: WebP needs RIFF@0–3 **and** WEBP@8–11;
  GIF the full 6 bytes; HEIC/AVIF need the ftyp brand at 8–11. Partial checks let an
  SVG polyglot reach libvips (past security bug).
- `x-real-ip` is only trustworthy behind Vercel. On the Docker path it is spoofable —
  rate limiting there is best-effort until a TRUST_PROXY_HEADERS flag exists.
- Vercel Functions accept 100MB bodies; our 20MB `MAX_FILE_SIZE` is a product choice,
  not a platform limit.
- **Supabase migration required:** `supabase/migrations/0001_add_user_id_to_reviews.sql`
  must be applied in the Supabase dashboard before account delete/export fully cover
  reviews. The routes tolerate its absence with a logged warning.
- Metadata inherits shallowly from `app/layout.js` — a page without its own
  `alternates.canonical` inherits whatever the layout sets. The layout therefore sets
  none; every page must use `buildMetadata`. (Site-wide canonical-to-homepage was the
  bug that deindexed the whole site.)
- New indexable page checklist: `buildMetadata` + JSON-LD + entry in the registry that
  drives `app/sitemap.js` + internal links. `robots.js` disallows only `/api/` and
  `/auth/`; `/dashboard` is noindex via metadata, deliberately NOT robots-disallowed.

## Agent team (`.claude/agents/`)

Specialist agents with strict file ownership; the session lead routes all work.
Any behavior change flows implementer → **test-engineer** (names the covering test) →
**reviewer** (fresh context, adversarial, SHIP/BLOCK on real lint/test/build output).
Review is never done by the author.

| Agent | Owns |
|---|---|
| architect | structure, layering, duplication; keeps this file's repo map honest |
| api-engineer | `app/api`, `app/auth`, `lib` server modules, security |
| frontend-engineer | `components`, page clients, accessibility |
| seo-specialist | metadata, JSON-LD, sitemap/robots, content depth, truthful copy |
| test-engineer | vitest suite, CI test job |
| reviewer | nothing — independent final gate |
| release-engineer | CI, Docker, package.json (sole dependency gatekeeper), README |

## Verification bar

Lint + full vitest suite + `next build` before any work is called done — real output,
not claims. Copy must stay truthful: processing is server-side, in-memory, never stored;
the words "in your browser" / "never leave your device" are banned (they were false).
