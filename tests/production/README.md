# Production smoke

A deployment check, not part of the local suite. Everything else in `tests/` tests the
code; this tests the **site** — whatever is answering at `PRODUCTION_URL`, already serving
people, built somewhere else.

## It starts no server

`playwright.production.config.js` has **no `webServer` block**. There is no build, no port,
no `next start`. That is the point: the subject is the deployment, and the run has no way to
pass by accidentally testing a local build instead. If the site is down, these fail.

The two Playwright configs cannot collide. `playwright.config.js` has `testDir:
'./tests/e2e'`, so `npm run e2e` never picks these up; this config's `testDir` is
`./tests/production`, so it never picks up the E2E suite. Neither directory is inside the
other. This is also why `npm test` (vitest) does not run it — `NODE_TESTS` in
`vitest.config.mjs` lists node suites, and this one is Playwright's.

## What it checks

| # | Check |
|---|---|
| 1 | `/api/health` answers 200 JSON with `status: 'ok'` and a `commit`, which is printed and annotated |
| 2 | `/`, `/tools`, `/compress`, `/compress-image-to-100kb`, `/change-image-dpi` each serve 200 with one canonical, an indexable robots meta, one `h1`, parseable JSON-LD |
| 3 | `/sitemap.xml` lists unique, query-free URLs on the deployment's own origin, including `/tools`, `/guides` and `/change-image-dpi` |
| 4 | `/robots.txt` names one wildcard group, allows `/`, disallows `/api/`, and points at the sitemap |
| 5 | An unregistered route 404s with a `noindex` robots meta |
| 6 | One real PNG goes through `/resize` on the live site and comes back 48 px wide, verified with sharp |

The five pages are five different failure modes: the homepage, the directory, a core tool,
an intent page served from the registry by the `[slug]` route, and one of the September
tools — the last of which is how "the deploy is older than you think" shows up as a 404
rather than as a green run.

Test 6 uses the shared fixture from `tests/e2e/fixtures/resizo.js`, so the no-upload guard
and the browser-error guard come along automatically. Because `baseURL` is the production
origin, that guard proves something it cannot prove locally: the live site makes no request
off its own origin while a real image is being processed.

## The two variables

| Variable | Default | Meaning |
|---|---|---|
| `PRODUCTION_URL` | `https://www.resizo.net` | The deployment under test. Point it at a preview or a self-hosted instance. |
| `EXPECTED_PRODUCTION_SHA` | unset | When set, `/api/health`'s `commit` must start with it. A short SHA is allowed. |

**The deployed SHA is never assumed to be the checkout's SHA.** A deploy is asynchronous, a
rollback moves it backwards, and a self-hosted build reports `dev`. So the check is opt-in:
unset, the run reports the commit it found and asserts only that the endpoint answered; set,
it is a promotion gate. Never infer the deployed commit from `git rev-parse HEAD`.

## Running it

```
npm run e2e:production
```

which is `playwright test --config=playwright.production.config.js`. Against another
deployment, and gated on a commit:

```
PRODUCTION_URL=https://staging.example.com \
EXPECTED_PRODUCTION_SHA=1faceaf \
npx playwright test --config=playwright.production.config.js
```

Test 6 is tagged `@browser`. On a runner with no browser installed, exclude it and keep
every HTTP check:

```
npx playwright test --config=playwright.production.config.js --grep-invert @browser
```

## The red proof

The commit gate was proved to fail before it was trusted. With a SHA the deployment is not
running:

```
$ EXPECTED_PRODUCTION_SHA=deadbeef npx playwright test --config=playwright.production.config.js --grep health
production commit: 1faceaf23365b270391575c91b6acf179b2a4448
  ✘  1 [production-chromium] › tests/production/smoke.spec.js:70:1 › the deployment answers /api/health...

    Error: the deployment is running commit 1faceaf23365b270391575c91b6acf179b2a4448,
    but EXPECTED_PRODUCTION_SHA asked for deadbeef
```

The message names both SHAs, so the failure is readable without opening the trace. Unset,
the same test passes and prints the commit:

```
$ npx playwright test --config=playwright.production.config.js
production commit: 1faceaf23365b270391575c91b6acf179b2a4448
  10 passed (3.4s)
```

## Retries are off on purpose

A retry would hide the flake that matters. A page that answers on the second request is a
production symptom, not test noise. `workers: 2` keeps the load on a live site polite — this
run is somebody else's traffic.

## Failures are not reproducible later

A deployment moves on, so `trace: 'retain-on-failure'` and `screenshot: 'only-on-failure'`
are the only record of what production was serving at that moment. Open a trace with
`npx playwright show-trace test-results/<dir>/trace.zip`.
