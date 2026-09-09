# Guides: the research content type

A guide is a page that exists because Resizo measured something, or because an official
source says something, and a reader with a specific question is better off for having read it.
It is not a tool page with more words, and it is never generated from a template of numbers,
formats, platforms or countries.

## The contract

One module per guide under `lib/catalog/guides/<slug>.js`, imported by `guides/index.js`,
validated by `validateGuide` in `lib/catalog/guides/validate.js` when the route collects its params, rendered by
`components/guide/GuidePage.js` through `app/(marketing)/guides/[slug]/page.js` and listed at
`/guides`. Every field below is required unless marked optional.

| Field | Meaning |
|---|---|
| `slug`, `title`, `h1`, `description` | as for an intent page; unique across the whole site |
| `answer` | the finding in three to five sentences, first on the page, readable on its own |
| `author` | `AUTHOR_NAME` from `lib/seo.js`; there is one author and the byline shows it |
| `published`, `modified` | ISO dates; `modified >= published`; `modified` is the sitemap date and moves only when the content changes |
| `methodology` | optional; `p` / `ul` / `table` blocks describing exactly how the numbers were produced, with the command to reproduce them |
| `sections` | `p` / `ul` / `table` blocks — the same block model as intents |
| `sources` | `[{ label, url, verifiedAt }]`; required and non-empty when `basedOnOfficialRequirements` is true; every `url` absolute, every `verifiedAt` an ISO date |
| `basedOnOfficialRequirements` | boolean; a guide about what an authority requires must cite that authority, never a competitor or a remembered figure |
| `relatedTools` | slugs of tools or intents the reader goes to next; each rendered as a next-job sentence with the guide's own `nextJob` copy |
| `faqs` | optional |
| `indexable` | boolean |

## What the validator refuses

A guide with no `answer`; a `modified` before `published`; an official-requirements guide with
no source or a source without `verifiedAt`; a `relatedTools` entry that does not exist; a slug
that collides with a tool, an intent or a reserved path; a body whose masked copy reads as
another guide's or another intent's (the same doorway guard, same limit); and the generic-intro
and keyword-stuffing rejections of the content-quality contract, with the same caps. A guide's
tables and figures are built in its module from the committed results JSON — the only file
outside `lib/` the catalog boundary lets a guide import — so the prose cannot drift from the
measurement.

## What a guide earns and what it does not

`Article` and `BreadcrumbList` JSON-LD, a byline with the author and both dates, a place in the
sitemap and in `/guides`, and links from the tool pages it measures. No `FAQPage`/`HowTo`
markup is added for its own sake. No rating, no review, no view count.

## The first two

Both are written from `benchmarks/results/` produced by `benchmarks/run.js` against the real
tool UI in Chromium, and both say so in their methodology:

1. What happens when a large photo must reach 20 KB — the fit policy's steps on the
   photograph sample, with the dimensions, bytes, quality and SSIM at each step.
2. JPEG vs WebP at the same size — the four samples compressed to the same byte targets in
   both formats, with bytes, quality and SSIM side by side.

A third, resize-then-compress against compress-only, is written only if the measurement shows
a finding worth a page. A DPI-versus-pixels guide is a figure on the DPI tool page, not a
guide, because the whole finding is one sentence.
