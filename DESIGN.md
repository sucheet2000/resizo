# Resizo Design System

The binding visual contract for every page and component. Values outside this file are
findings, not choices — if a hex, radius, font, or duration isn't defined here, it doesn't ship.

## Thesis

Resizo is an **instrument, not a landing page**. A visitor typed "resize image online" and has
already decided to convert; the design's job is to put a working tool in front of them at first
paint and prove, with real numbers, that it worked. Identity comes from what only an image tool
owns: pixel dimensions, byte counts, format tokens, the transparency checkerboard. Structure
stays plain and familiar (snap judgments favor low complexity + prototypicality); the
distinctiveness lives in typography, numerals, and micro-detail — never in layout novelty.

**The signature:** numbers as the interface. Every dimension, file size, percentage, and format
token is set in mono with tabular figures. The payoff moment after processing is one oversized
numeral (`−87%`) with the real before/after bytes beside it. Tool identity marks are typographic
operation tokens (`W×H`, `−%`, `→WEBP`, `⤢`, `HEIC→JPG`) — never icon tiles.

## Color tokens

Light is the default theme. Dark ships day one via the same tokens (no retrofit).

| Token | Light | Dark | Role |
|---|---|---|---|
| `--surface` | `#F8F7F5` | `#131110` | page ground (barely-warm off-white / warm near-black — never pure #FFF/#000, never cream) |
| `--surface-raised` | `#FFFFFF` | `#1C1917` | panels, cards, the tool surface |
| `--surface-sunken` | `#F1EFEC` | `#0D0C0B` | wells, ad placeholders, code-ish strips |
| `--ink` | `#201D1B` | `#F1EEEA` | primary text |
| `--ink-muted` | `#6E6862` | `#A8A29B` | secondary text (must measure ≥4.5:1 on `--surface`) |
| `--line` | `#E4E1DC` | `#38322E` | hairline borders |
| `--accent` | `#C7431F` | `#E85D3F` | THE accent: persimmon. Buttons, links, focus, the payoff numeral |
| `--accent-ink` | `#FFFFFF` | `#131110` | text on accent (measure ≥4.5:1; darken accent, never lighten text) |

Rules: exactly one accent; no second color may be introduced. No gradients anywhere. No glow,
no glass, no backdrop-blur. Dark-mode elevation = stepped surface lightness + hairline, never
shadows. Every text/surface pair ships with a measured contrast ratio.

## Typography

Three faces, all via `next/font/google` (build-time self-hosted, no runtime Google request):

- **Display — Bricolage Grotesque**: h1/h2, the wordmark. Weight 600–800. Roman only, never italic.
- **Body/UI — Inclusive Sans**: everything else. Its accessibility provenance is a true thing we
  can say about a free public utility.
- **Data — JetBrains Mono**: every number, dimension, byte count, format token, operation mark.
  `font-variant-numeric: tabular-nums` so values never jitter while updating.

Scale: 5 steps, ratio ≥1.25 (12.5 / 16 / 20 / 25 / 31.5 / display clamp(2.5rem, 5vw, 4rem)).
Body 16px/1.6, max 72ch. UI labels 14px/500. Nothing functional below 12px. Mono numerals may be
oversized as graphic elements — that is the one permitted display flourish.

## Layout

- 8px base unit. Content max-width 1200px, 24px side padding. Section gaps `clamp(4rem, 8vw, 7rem)`.
- **The tool is the hero.** On every tool route and the homepage, the working dropzone/panel is
  the first thing painted, above the fold on a mid-tier Android phone, zero scrolling. Headline
  is one explanatory line above it — no CTA button that scrolls to the tool, ever.
- **Settings sit above the drop zone** so a file lands already configured — no
  upload→configure→reprocess loop. On resize, presets render as intent chips ("Instagram post",
  "1920px wide", "Email under 5 MB") above the target.
- **One repeated primitive:** the file panel (dropzone → working → result states). All six tools
  are the same panel with different controls. It IS the brand.
- **The batch result view is a designed moment** (no competitor has one): per-file rows of
  `old size → new size  −N%` in mono, a total line ("You saved 14.2 MB — 78% smaller") set
  large, one Download All. Single-file results show the processed image big with the payoff
  numeral — never a bare download button.
- Two or three bundled sample images ("try one of these") let a skeptical visitor see output
  quality without committing a personal photo.
- Below the fold: asymmetric tool index driven by real content weight (resize/compress large
  cells, heic/crop compact) — never equal-column card rows. Then server-rendered reviews, then
  SEO content sections and FAQ.
- Ads: fixed-height reserved slots (`--surface-sunken` placeholder when unfilled). Binding
  placement rule: no ad in the vertical path between the headline and the drop zone, none
  beside the tool louder than the tool, none before the user's first result is delivered.
  Below results / bottom of first viewport / footer-adjacent only. Never
  sticky/anchor/interstitial formats.
- Radius scale: 4px (inputs) / 8px (buttons) / 12px (panels, cards — the cap). Pill only for tags.
- Depth: shadow-as-border (`0 0 0 1px` at 8% ink) + one soft ambient layer, shadows tinted toward
  the surface hue, vertical offset 2× horizontal. Choose edge OR elevation per element, never both heavy.
- The transparency checkerboard (alpha pattern, ≤3% contrast) is the brand texture: dropzone
  empty state, image preview backing. A measurement grid may appear only on surfaces that
  measure (crop canvas) — never decoratively.

## Motion

CSS only — zero animation libraries. Durations 120/180/240/520ms, easing
`cubic-bezier(0.16, 1, 0.3, 1)`. Animate only state that actually changes: dropzone state shifts
(~100ms snap on file accept), progress (the engine's real decode → resize → encode stages, never
a decorative timer), the CTA morph
(Resize → progress → ✓ Download in place), the result numeral counting. Content is visible at
rest — no opacity-0-until-scroll, no scroll-triggered fade-ins, no hover transforms on images.
Global `prefers-reduced-motion` reset. View Transitions API for tool-to-tool navigation is the
only page-level motion.

## Voice

- Every headline names a literal operation and object: "Resize a JPEG to exact pixel dimensions."
- Constraints live inside the control: "JPEG, PNG, WebP · up to 20 MB" inside the dropzone.
- The privacy line is concrete, truthful, and sits at the point of drop: "Your image never leaves
  your device — the work happens in this browser tab." "In your browser", "never leaves your
  device" and "no upload" were banned while the work ran on a server, because they were false.
  The server is gone; every tool decodes and encodes in the visitor's own tab, so those are now
  the most accurate words available and the ban is inverted. **Banned instead: any claim that a
  file is uploaded, sent, received, stored or deleted afterwards** — including the reassuring
  form ("deleted the moment your download starts", "never kept", "processed on our server",
  "rate limited"), which only makes sense if the file went somewhere. Never imply this is a
  native app or that a browser can do something it cannot. Where a limit comes from the visitor's
  own hardware — memory, a very large image — say that plainly; it is a device limit, not a
  policy. `tests/design/contract.test.js` enforces both halves: the banned list, and the
  requirement that the tool panel, the footer and the homepage each state where the work happens.
- Errors are specific and non-blaming, inline in the panel (never toasts), state the fix, clear
  the instant it's corrected, and carry an sr-only "Error: " prefix.
- One line of text per control. Banned vocabulary: Elevate, Seamless, Unleash, Next-Gen,
  Supercharge, world-class, professional-grade, zero friction, Lightning Fast. No emoji in UI.

## Focus & accessibility floor

2px `--accent` outline with 2px offset on `:focus-visible` — the ring is a brand element, not a
browser default. Every input labeled (`htmlFor`/`id`), modals trap and restore focus + Escape,
every interactive element keyboard-reachable, WCAG AA contrast measured not eyeballed.

## Rejection clause (the anti-slop gate)

Never ship: indigo/violet/purple (hue 240–280°), gradients (background, text, or border), glass /
backdrop-blur, glows and colored shadows, cream/beige surfaces, italic serif display, Inter /
Geist / Space Grotesk / Instrument Serif, icon-tile-above-heading feature cards, three-equal-column
feature rows, eyebrow/kicker chips above headings, side-tab accent borders, radius >12px on cards,
decorative grid-line backgrounds, stat-banner rows, numbered section labels, uppercase label
sprinkling, emoji bullets, scroll-triggered reveals, marquees, pulsing status dots, WebGL/3D/
parallax/kinetic type, toasts for form errors, hover-scale on images, `h-screen` (use
`min-h-[100dvh]`), pure #000 or #FFF surfaces.

Any PR that reintroduces one of these is wrong even if it looks good in isolation.
