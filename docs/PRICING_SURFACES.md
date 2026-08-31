# Changing a price

Every place a charged price has to reach, and the order to reach them in.

A price lives in nine places. Six are in this repo, one is at Stripe, and one
is a page somebody edits by hand — and the last of those is the one that has
been missed, twice. This file exists because the failure is not forgetting to
change a price; it is changing it in five places and believing that was all of
them.

## Why the order matters

Two of these surfaces face customers and they fail in opposite directions:

- **Stripe ahead of the page** — checkout takes more than `/pricing` quotes.
  This is the urgent one. A page quoting less than checkout is a price a
  customer can point at, and it is a refund conversation at best.
- **The page ahead of Stripe** — the page promises a price checkout does not
  honor. Less dangerous, still wrong.

So the page and Stripe move as close together as a human can manage, and
everything else can follow.

## The surfaces

| #   | Surface                                                              | What it is                                        | How it changes                                                                |
| --- | -------------------------------------------------------------------- | ------------------------------------------------- | ----------------------------------------------------------------------------- |
| 1   | `libs/aglyn/src/lib/app-utils/plan-entitlements.ts` → `PLAN_PRICING` | The number the product computes from              | edit                                                                          |
| 2   | Stripe price objects                                                 | What a card is actually charged                   | **new objects** — a Stripe price is immutable; create and archive, never edit |
| 3   | `STRIPE_PRICE_*` env vars                                            | Which price id checkout uses                      | Vercel env, console project, then **redeploy** — env is injected at build     |
| 4   | `tools/scripts/check-pricing-drift.mjs` → `LOCKED`                   | The independent pin the lock is enforced against  | edit, **only with #5**                                                        |
| 5   | `docs/DECISION_LOG.md`                                               | The record of who decided and on what evidence    | append an entry, newest first                                                 |
| 6   | `tools/marketing/pricing-copy/tables.json`                           | The generated source the site is transcribed from | regenerate, do not hand-edit                                                  |
| 7   | **`/pricing` on the marketing site**                                 | What a visitor reads                              | **by hand in the besigner** — see below                                       |
| 8   | Figma pricing frames                                                 | The design of record                              | by hand; the reconciler reports the gap but cannot close it                   |
| 9   | **`/pricing`'s SEO description**                                     | The price quoted in search results and link cards | **by hand in the besigner**, a separate field from the body — see below       |

Plus the Drive source-of-truth doc (Pricing & Packaging → 00-Pricing-Source-of-Truth),
which is the non-engineering record and is not checked by anything here.

## The two that get missed

**#7 is not generated.** `tables.json` holding the new figure is not the page
holding it. The marketing site is built by clicking in the besigner, so
regenerating #6 changes a file the page was transcribed from and nothing that
a visitor sees. Nothing in CI can tell you the page is stale, because the page
is not in this repo.

`apps/console/specs/published-pricing-table-parity.spec.ts` carries the
`PUBLISHED` rows as literals for exactly this reason: they are what the page
says, maintained by hand, so a difference between them and `PLAN_PRICING` is
the gap made visible. **When you republish the page, update those literals in
the same commit** — otherwise the spec goes on describing a gap that no longer
exists, and the next reader believes it.

**#9 quotes the price in prose and nothing reads it.** `/pricing`'s
description is a plain-text field on the screen's detail page, separate from
the body, and it propagates into `<meta name="description">`,
`og:description` and `twitter:description`. It is not generated and no guard
can see it, so the body of the page can be entirely correct while search
results and every shared link still advertise the old price. Fix it in the
same pass as the body; it is a different field and it will not follow.

## Republishing is not saving

A saved edit to an already-published version **never reaches the live page**.
On-demand revalidation fires only when a publish MOVES the version pointer,
and only a pointer move busts the `tenant-data:{hostId}` document cache the
render reads through — so a saved edit regenerates the page on schedule and
re-reads the same cached document, forever. The symptom is a page whose
`x-vercel-cache` age climbs past its window while the content never changes.

**Unpublish, then publish.** The version's own `PUBLISH NOW` is disabled while
it is live, which is why this is not obvious.

## Checking the live page

**One request cannot tell you whether a publish worked.** The tenant render is
`revalidate = 600` with stale-while-revalidate, so the first request after the
window has passed is served the OLD copy _and_ starts the regeneration behind
it. Request, then request again: only the second answer describes what is
published. Reading the first response as the verdict makes a publish that
worked look like a publish that failed, and invites re-publishing something
that was already correct.

To read the published content without waiting on the cache at all, request the
path with a query string it has never been asked with — that is a different
cache key, so it renders fresh. Useful for deciding whether a difference is
stale HTML or stale data, which are two different problems with two different
fixes.

`curl` needs the probe header for either check. Bot protection answers an
unheadered request with a `429` and `x-vercel-mitigated: challenge`, and the
challenge page contains enough digits to make a naive grep for a price report
matches that are not there — a false positive that reads exactly like a stale
price. Send `x-aglyn-probe: $AGLYN_PROBE_TOKEN` (the token is in the repo-root
`.env`; `set -a && . ./.env && set +a`). ⛔ Do not turn bot protection off to
make a check work.

## Checking the code

```bash
npm run check:pricing-drift     # code ↔ pin ↔ Stripe, every charged price
npm run check:pricing-tables    # code ↔ the generated tables
npm run check:decision-log      # a watched value moved without a log entry
```

`check:pricing-drift` exits 2 rather than 0 when it could compare nothing — a
run that checked nothing is not a run that found nothing.

## ⚑ The pin is not a formality

`LOCKED` in `check-pricing-drift.mjs` is an independent record of what was
decided, not a mirror of the code. Editing it to make a red check go green
turns the one control that can catch a silent price change into a value that
agrees with whatever the code says.

Move it **with** the Decision Log entry, in the same commit, or not at all.
