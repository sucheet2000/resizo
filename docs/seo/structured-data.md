# Structured data: what is emitted, and why each type is there

Every node comes from `lib/schema.js`, is rendered by `components/seo/JsonLd.js`, and must
describe something visible on the same page. `tests/app/schema-visibility.test.js` compares
each node with the rendered content; `tests/app/howto-schema.test.js` and
`tests/pages/page-facts.test.jsx` hold the rest.

| Type | Where | Status | Why |
|---|---|---|---|
| `Organization` | every page | keep | names Resizo, its logo, `sameAs` the public repository, `founder` the builder — all visible on `/about` |
| `WebSite` | homepage | keep | site name and the `author` Person, both visible |
| `BreadcrumbList` | every tool, intent and guide page | keep | the one live rich result these pages earn; items equal the visible crumb |
| `SoftwareApplication` | tool and intent pages | keep, deliberately ineligible | no `aggregateRating`, no `review`; Google requires one of them for the rich result and inventing one is a manual action against every node on the page |
| `HowTo` | tool and intent pages | inert | Google removed the rich result on 2023-09-14; the markup mirrors the visible steps and costs 174 bytes brotli a page, so it stays but is never extended for its own sake |
| `FAQPage` | tool and intent pages | inert | rich result removed 2026-05-07; same reasoning; the visible FAQ is what matters |
| `Article` | guide pages | keep | headline, `author` Person, `datePublished`, `dateModified`, `publisher` Organization — every one visible in the guide's byline |
| `Person` | inside the above | keep | `name` and `url` (the GitHub profile confirmed by the repository) only; no social profiles are invented |

Never added: `aggregateRating`, `review`, `Product`, `Offer` with a price, `VideoObject`,
`ImageObject` for stock imagery, `Event`, or any node whose facts do not appear on the page.
