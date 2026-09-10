# The release feedback loop

How a tool goes from a merge to a decision about the next tool. Nothing in this loop runs on
the site: Search Console is read by a person, on a schedule, and the site carries no analytics,
no tracker and no runtime measurement of visitors. That is a product decision, not a gap.

```
tool launch → indexing → Search Console queries and impressions
           → generative-AI visibility → adjacent real intent
           → decide: a new PRODUCT, a new CONTENT page, or nothing
```

## 1. Launch

A route is launched when the PR that adds it is merged and the deploy is live. The PR has
already proved: own canonical, one H1, the direct answer server-rendered, the registry entry
(sitemap) and at least one inbound link from a hub or core page (`tests/app/hub-pages.test.js`,
`tests/lib/catalog/relations.test.js`, the `/tools` directory test).

After deploy, by hand:

1. Open the live URL and view source: the canonical is the live host, the `<title>` and the
   description are the ones in the branch.
2. `https://www.resizo.net/sitemap.xml` lists the URL exactly once.
3. Search Console → URL Inspection → *Request indexing* for each new URL. One request per URL;
   re-requesting does not speed anything up.

## 2. Indexing (days 1–14)

Search Console → Pages (Indexing report). A new URL should move from *Discovered – currently not
indexed* to *Indexed* within two weeks. If it stays *Crawled – currently not indexed* past that:
the page is being read as thin or duplicate. The fixes, in order: more distinct explanation
(not more words), a second inbound link from a page that already ranks, and — last — check the
doorway guard's similarity number for that page against its siblings.

Do not touch `lastModified` to force a recrawl. It is a content date; a date that moves without
a copy change is discounted.

## 3. Search Console review (every two weeks, then monthly)

Performance → Search results, filtered to the new URL (Page filter), comparing the last 28 days
with the previous 28 days once there are two periods. Read, in this order:

| Metric | What it tells you | Act when |
|---|---|---|
| Impressions | Google is showing the page for something | zero after four weeks of *Indexed* — the page answers nothing anyone types |
| Queries (top 50) | what people actually typed | a query cluster the page does not answer directly appears in the top ten |
| Average position | where it shows | 8–20 with impressions: a copy or link problem; 1–5 with no clicks: a title/description problem |
| CTR | whether the snippet wins the click | below the site's median for that position band |
| Clicks | the only number that pays | flat while impressions rise |
| Landing pages | whether the wrong page ranks for the query | a hub ranks where a spoke should |
| Device | whether phones and desktops see the same page the same way | a phone-only drop in CTR on a tool page — the fold, the drop zone or the controls |
| Country | where the queries come from, which decides which official sources a form page must cite | a country's queries for a form or a portal the site has no sourced page for |
| Indexing state | Pages report per URL | any new URL not *Indexed* two weeks after launch |

Also read Performance → *Search appearance* (rich results, if any) and Experience → Core Web
Vitals for the route group: a new tool must not have made the group slower.

Write the numbers into the review note (`docs/seo/reviews/YYYY-MM-DD.md`, one file per review,
tables only). Never paste them into copy or claims on the site.

## 4. Generative-AI visibility (monthly, manual)

There is no console for this. The check is a fixed set of prompts — the twelve target queries
of the site's pages, phrased as questions — asked in the assistants that show sources, and a
note of whether Resizo is cited, which page, and what the cited sentence was. Record it in the
same review note. The lever is the same as for search: a direct answer near the top of the
page that stands alone, first-party measurements, and copy that says what the tool does and
does not do. There is no crawler-specific page, no `llms.txt`, no hidden text; a bot that
respects robots.txt reads the same HTML a person does.

## 5. Adjacent intent

From the query list, pull the queries the page is shown for but does not answer. Group them.
Each group is one of:

- **A different job** — "compress image to 20 KB for signature" on the 100 KB page was one;
  the answer was a page with its own policy, not a number swap.
- **A different format or platform for the same job** — usually the same page with one more
  sentence, or nothing.
- **A different tool** — "remove background", "convert AVIF": a product question (see the RFCs
  in `docs/rfc/`).

## 6. The decision: improve the page, or build the next tool

The loop closes on one of two moves, and only these two. **Improve the existing page** when
the queries are the page's own job asked in other words, when the position sits below the
fold of results with impressions but no clicks, or when a phone-only CTR gap points at the
layout. **Build the next real tool** when the queries name a job the engine can do locally and
no page does — then it goes through the same launch, and the loop repeats. Neither move is
"add a page for the keyword": a page needs a distinct job and a distinct answer, and the
catalog validator refuses the rest.


A new **product** page needs: a capability the engine has or can add browser-locally; a
distinct user job with evidence in the query list; and a page that would pass the doorway
guard against everything that exists. A new **content** page (a guide) needs a first-party
measurement or a primary source to cite (`docs/seo/guides.md`). Everything else is a
sentence on an existing page, or nothing.

What is never a reason: a keyword variation, a number, a platform name, a country. The catalog
validator refuses more than four numeric slugs in a family and any page whose masked copy
reads as another page's, on purpose.
