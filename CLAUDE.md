# Resizo

Free online image tools (resize, bulk resize, compress, convert, crop, HEIC→JPG) at
https://www.resizo.net. Next.js 16 App Router, **plain JavaScript (never TypeScript)**,
Tailwind 4 (CSS-first `@theme`), React 19.

**Every image is processed in the visitor's own browser and nothing is ever uploaded.**
`lib/image-client/` is the whole engine — native browser codecs where they exist,
`@jsquash/*` WebAssembly where they do not, `libheif-js` for HEIC. There is no image
API route, no sharp at runtime, no database, no cache, no rate limiter and no object
store, so the server holds no credentials and there is no fallback lane: a job this
device cannot do is refused with a reason instead of being sent anywhere.
Production deploys via Vercel; Docker for self-hosting. Both serve static pages plus the
WASM codecs — nothing else.

## Commands

- `npm run dev` / `npm run build` / `npm start`
- `npm run lint` — must pass with zero warnings
- `npm test` (vitest; `test:watch`, `test:coverage`) — must stay green
- `npm run generate:og` / `generate:favicon` — regenerate brand assets (sharp-based)

Local env: nothing is required. `.env.example` is checked in and empty apart from one
optional build label, because no runtime secret exists any more; `npm run dev` and
`next build` work on a clean clone.

## Layering rules

- **No image work on the server.** `app/api/` holds exactly one route, `health`, and it
  touches nothing external. Adding an image route re-introduces uploads and is wrong.
- `lib/image-client/` is the engine and the only place pixels are touched: `decode` →
  `orientation` → `operations` (resize / crop / flatten / compress-target) → `encode`,
  behind `lib/image-client/client.js` and its worker. `capability.js` is the one front
  door for "can this device do this job" (`assessJob` / `refusalMessage`) and every tool
  asks it *before* a buffer is allocated.
- `lib/hooks/useLocalProcess.js` is the one submit path for the single-file tools;
  `lib/upload/process-file.js` + `lib/upload/bulk-batch.js` sequence the batch. None of
  them may fall back to a network call — there is nothing to fall back to.
- Every limit, format list and magic-byte check comes from `lib/limits.js` and
  `lib/image/magic-bytes.js`. Never re-type one in a route, hook or component. The site
  catalogue — `TOOLS`, `LONGTAIL_PAGES`, `SOCIAL_PRESETS` and their lookups — is
  `lib/catalog.js`, and the two must stay apart: the engine and the worker read the
  limits, and must never pull page copy into their chunk.
- `lib/hooks/` is React only — every file there starts with `'use client'`. Pure
  formatting and validation helpers live in `lib/format/`, because the worker imports
  them and a `useState` added to a file under `lib/hooks/` would drag React in.
- Pages: server `page.js` exports metadata via `lib/seo.js buildMetadata` (own canonical!)
  + renders JSON-LD (`lib/schema.js`) + one client tool component composed from
  `components/tools/ToolShell.js`. Route groups `(marketing)`/`(tools)` carry the shared
  header/footer in their layouts.
- `DESIGN.md` is binding for anything visual — including its rejection clause. Tokens
  only; no raw Tailwind palette utilities, no hex outside `app/globals.css`.

## Architecture boundaries (enforced, not aspirational)

`tests/architecture/boundaries.test.js` fails the suite on every rule below. It reads the
import graph itself — no new dependency, no config — and each failure names the offending
file and prints the import chain that reaches it. Prose does not hold these rules:
`tests/design/contract.test.js` caught an agent writing banned copy months after
`DESIGN.md` forbade it, which is the whole argument for this file having a test behind it.

1. **Nothing in the worker's import graph imports `react`/`react-dom` or carries
   `'use client'`.** The worker thread has no DOM; React there is a second copy of React
   in a chunk that can never render anything. Until today the guarantee was a naming
   convention: two pure helpers sat in `lib/hooks/` beside four `'use client'` files, one
   `useState` away from dragging React across. They are `lib/format/` now.
2. **`lib/` imports nothing from `app/` or `components/`.** `lib/` is the bottom layer. An
   edge upward makes the engine untestable without a React renderer and makes every page a
   dependency of every tool.
3. **No module under `lib/image-client/` reaches `lib/catalog.js`,** directly or
   transitively. The engine reads `lib/limits.js` (numbers the codecs enforce); pages read
   `lib/catalog.js` (titles, descriptions, routes). They were one file with a fan-in of 38,
   so editing a marketing sentence touched a module the worker downloads. If the engine
   seems to need a tool's title, it does not — return a code and let the page word it.
4. **`jszip`, `@cantoo/pdf-lib`, `@jsquash/*` and `libheif-js` appear only inside
   `import()`, anywhere in `lib/`.** One top-level `import JSZip from 'jszip'` in
   `lib/upload/bulk-batch.js` put 153 KB of archiver into the **first load** of `/resize`,
   `/resize-jpg` and `/resize-png` — the busiest routes on the site — paid by everyone who
   resizes one image and never opens the bulk tab. Memoise the `await import(...)` at the
   point of use, as `codecs.js` and `pdf.js` do.
5. **No static import cycle inside `lib/`.** Every edge in a cycle is evaluated eagerly, so
   one module sees `undefined` where it expects a function, and which one depends on the
   entry route. Break it with a shared module, not by hiding one edge behind `import()`.

There are no exception lists and adding one is not the fix. If a rule is genuinely wrong,
delete the rule and the reason with it.

**Deliberately NOT rules here.** File length is not a metric we chase — `lib/catalog.js` is
a long flat registry and that is the right shape for it. Abstraction is not added before a
second caller exists. And anything that cannot be stated as a check a test could run stays
out of this section entirely; vague advice is the kind that gets ignored.

## Gotchas (learned the hard way — do not relearn)

- **A tab that asks for too much memory is killed, and on iOS it is killed silently** —
  no exception, no error event, the photo is just gone. Nothing in the engine allocates
  hopefully: `lib/image-client/capability.js` costs every job first and refuses it with a
  sentence a person can act on. Over-refusing costs one apology; under-refusing costs the
  user their file.
- **A refusal is the end of the story.** There is no server to post the job to, so a
  refusal must reach the panel as text the visitor reads — never a silent no-op and never
  a retry against a network.
- **CSP must keep `'wasm-unsafe-eval'` in `script-src`.** Without it the browser blocks
  every codec in `lib/image-client/` before instantiation and all five tools are dead.
  `connect-src 'self'` is the mechanical proof of the no-upload promise: a page that tried
  to post a photo elsewhere would be blocked, not merely trusted.
- **`new Image()` inside a component that imports `next/image` resolves to the React
  component and throws.** Always `new window.Image()` — dimension reads live in
  `lib/hooks/useImageUpload.js` for exactly this reason (it once broke /crop entirely).
- **Bulk format sentinel is `'original'`.** Mismatching it once silently converted every
  bulk PNG to JPEG.
- Magic-byte checks are strict and centralized: WebP needs RIFF@0–3 **and** WEBP@8–11;
  GIF the full 6 bytes; HEIC/AVIF need the ftyp brand at 8–11. Partial checks let an
  SVG polyglot reach a decoder (past security bug).
- **sharp is a devDependency and a test tool only.** It generates fixtures and acts as the
  independent libvips reference the browser engine is measured against. Importing it from
  `app/`, `lib/` or `components/` puts image work back on the server.
- **A new `tests/<dir>/` is not run until it is listed in `NODE_TESTS` in
  `vitest.config.mjs`.** The node project includes explicit globs, not `tests/**`, so a
  suite in an unlisted directory passes CI by never executing.
- Metadata inherits shallowly from `app/layout.js` — a page without its own
  `alternates.canonical` inherits whatever the layout sets. The layout therefore sets
  none; every page must use `buildMetadata`. (Site-wide canonical-to-homepage was the
  bug that deindexed the whole site.)
- New indexable page checklist: `buildMetadata` + JSON-LD + entry in the registry that
  drives `app/sitemap.js` + internal links. `robots.js` disallows only `/api/` and
  `/auth/`. There are no noindex pages now that the dashboard and accounts are gone.

## Agent team (`.claude/agents/`)

Specialist agents with strict file ownership; the session lead routes all work.
Any behavior change flows implementer → **test-engineer** (names the covering test) →
**reviewer** (fresh context, adversarial, SHIP/BLOCK on real lint/test/build output).
Review is never done by the author.

| Agent | Owns |
|---|---|
| architect | structure, layering, duplication; keeps this file's repo map honest |
| api-engineer | `lib/image-client` (the browser engine), `app/api/health`, security |
| frontend-engineer | `components`, page clients, accessibility |
| seo-specialist | metadata, JSON-LD, sitemap/robots, content depth, truthful copy |
| test-engineer | vitest suite, CI test job |
| reviewer | nothing — independent final gate |
| release-engineer | CI, Docker, package.json (sole dependency gatekeeper), README |

## Verification bar

Lint + full vitest suite + `next build` before any work is called done — real output,
not claims.

Copy must stay truthful, and the truth inverted with the server. Every image is processed
on the visitor's own device and nothing is uploaded, so "in your browser", "never leaves
your device" and "no upload" are now accurate and are the strongest thing the product can
say. **Banned instead: any claim that a file is uploaded, sent, stored, received or
deleted afterwards** — "processed on our server", "sent over HTTPS", "never kept",
"deleted the moment your download starts", "rate limited". `tests/design/contract.test.js`
enforces the list and also requires the tool panel, the footer and the homepage to state
where the work happens. Never imply Resizo is a native app or that a browser can do
something it cannot, and where a limit is the device's (memory, a very large photo), say
that it is the device's.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
