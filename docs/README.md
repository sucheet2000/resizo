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
- `rfc/avif.md` — browser-local AVIF: licences, sizes, browser support, a phased proposal.
- `rfc/background-removal.md` — browser-local background removal: model licences, sizes,
  memory, a ranked recommendation. Neither RFC ships code. The AVIF one recommends a
  decode-only phase (AVIF → JPG and AVIF → PNG, no encoder); the background-removal one
  recommends measuring on devices before anything ships.

The benchmark methodology and its committed results live beside the runner in `benchmarks/`.
