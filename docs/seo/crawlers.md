# Crawler policy

One rule, for every crawler, and a test that keeps it that way.

## robots.txt

`app/robots.js` emits a single `User-agent: *` rule: `Allow: /`, `Disallow: /api/` and
`Disallow: /auth/`, and the sitemap URL on the canonical host. There is no per-bot rule. That is
deliberate: the public tool and content pages are for anyone who will read them and cite them,
and that includes the search crawlers of the assistants — OAI-SearchBot, PerplexityBot,
ClaudeBot and the rest — as much as Googlebot and Bingbot. `tests/app/crawlability.test.js`
fails if a bot-specific rule appears, if either disallow changes, or if any of those user agents
is named anywhere in the file. Blocking a training-only crawler (GPTBot, CCBot, Google-Extended)
is a policy decision the file does not make today; if it is made, it is made there, with the
reason, and the test is updated with it.

## What every public page carries

- its own `<link rel="canonical">` on the canonical host (`lib/seo.js buildMetadata`);
- `robots: index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1`;
- exactly one `<h1>`, the direct answer and every section server-rendered — no content waits
  for JavaScript, and the E2E suite reads pages with a plain HTTP client to prove it;
- JSON-LD that matches the visible content node for node.

## Query strings and state

`/compress?target=73kb` is a UI state, not a page. Every query-string variant of a route
canonicalises to the route (`tests/e2e/crawl.spec.js` fetches such URLs and reads the canonical
back), and the sitemap never contains a `?` or a `#`. Bulk resize lives at `/resize#bulk` and is
not a sitemap entry for the same reason.

## What there is not

- No `llms.txt`. It is not a ranking mechanism, and a page written for a crawler is a page a
  person did not need. The same HTML serves both.
- No crawler-specific rendering, no hidden text, no cloaking.
- No weakening of the CSP or the privacy model to accommodate a crawler; a crawler that needs
  the page to load a third-party script does not get one.
