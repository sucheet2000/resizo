# Docs

Internal documents that are not code and not marketing. Everything here is checked in so a
decision can be read later with the reasons that produced it.

- `seo/release-loop.md` — the feedback loop after a tool launches: indexing, Search Console
  review, generative-AI visibility, adjacent intent, and when a new product or content page is
  warranted. Read before proposing a page.
- `seo/crawlers.md` — the one-rule robots policy, what every public page carries, query strings
  and canonicals, and what is deliberately absent.
- `seo/structured-data.md` — every JSON-LD type emitted, its status and the reason.
- `seo/guides.md` — the guide/research content type: contract, validator, what it earns.
- `rfc/avif.md` — browser-local AVIF: licences, sizes, browser support, a phased proposal, and
  a dated "Decision — 2026-09-11" addendum recording what was actually built.
- `rfc/avif-codec-review-2026-09-11.md` — the candidate-by-candidate review that settled it,
  with every licence and version re-read from its primary source and a three-engine
  native-decode probe. AVIF **decode is the browser's own** (`createImageBitmap`, no decoder
  binary in the tree); AVIF **encode is WebAssembly** (`@jsquash/avif`, fetched only once a job
  writes one) and reaches `/convert` and `/resize` only. Where it and `rfc/avif.md` disagree on
  a number, this one is the later measurement.
- `rfc/background-removal.md` — browser-local background removal: model licences, sizes,
  memory, a ranked recommendation. It ships no code and recommends measuring on real devices
  before anything does.

The benchmark methodology and its committed results live beside the runner in `benchmarks/`.
