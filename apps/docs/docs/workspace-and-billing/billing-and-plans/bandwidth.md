---
sidebar_position: 4
title: Bandwidth
description: How much traffic each plan includes, what happens when a site goes past it, and why a Free site can be paused until the start of next month.
---

# Bandwidth

**Bandwidth** is how much traffic your published sites serve in a calendar month. Every
plan includes an amount. What happens when you pass it is the part worth reading, because
it is **not the same on Free as it is on a paid plan**.

:::info Plan availability
Every plan has a bandwidth allowance. On a **paid** plan going past it is metered and
billed, and your sites keep serving. On **Free** it is a hard stop: the site is paused
until the start of the next month.
:::

## What each plan includes

| Plan | Included bandwidth per month | Past the allowance |
|---|---|---|
| Free | 2 GB | Sites are **paused** until the start of next month |
| Starter | 50 GB | Keeps serving; the extra is billed |
| Pro | 250 GB | Keeps serving; the extra is billed |
| Business | 400 GB | Keeps serving; the extra is billed |
| Scale | 700 GB | Keeps serving; the extra is billed |
| Advanced | 1,000 GB | Keeps serving; the extra is billed |
| Agency | 3,000 GB | Keeps serving; the extra is billed |
| Enterprise | Unlimited | Nothing to pass |

The allowance is per **organization**, across every site in it — not per site. If you run
four sites on one Business plan, they share the 400 GB.

## Where to see your usage {#where-to-see-it}

1. In the console, open **Billing** from the organization menu.
2. Find the **Usage** card.
3. Read the row labeled **Bandwidth (this month, organization)**.

The meter resets on the first of each month, in UTC.

You do not have to be watching it. Organization admins get an in-app notification **and**
an email at 80% of the allowance and again at 100%, once per threshold per month. What
those messages say depends on your plan, and the difference is the point:

- **On a paid plan** the 100% message reads *"You're past your included monthly bandwidth
  — extra usage is now billed"*, and tells you the overage appears on your monthly
  invoice.
- **On Free** it reads *"You've reached your monthly bandwidth limit"*, and points you at
  Billing to upgrade — because on Free there is no overage to bill, only a stop.

## What a paused Free site looks like {#paused}

When a Free organization passes its band, its published sites stop serving pages and
answer with a plain notice instead:

> **Over the monthly traffic limit**
>
> This site has used all of the traffic included with it this month, so its pages are
> paused until the start of next month. Nothing is wrong with your connection, and
> nothing here has been removed.

Three things are true about that page and are worth knowing before you see it:

- **Nothing is deleted.** Your screens, media, datasets and settings are untouched. The
  console keeps working normally — only the *public* site is paused.
- **It clears itself.** The pause is stamped with the month it belongs to. When the month
  turns over it stops applying, with no action from you and nothing to un-set.
- **Upgrading lifts it within about a minute.** The check re-reads your plan every time,
  so a plan change releases the pause without waiting for the next month or for any sweep
  to run.

Search engines are told not to index the notice, so a pause does not cost you your
rankings.

## Why a site can go over before it is paused {#timing}

Usage is totalled where page views are already counted — the analytics beacon, on a
sampled cadence — so a Free site can pass its band and keep serving for a few hundred
more views before the pause takes hold. That is deliberate: the alternative is metering
every single request, which would put a database read on every page of every site on the
platform to answer a question only Free organizations can ever fail. The allowance is a
monthly budget, not a per-second valve.

A daily job re-checks the same thing organization-wide, so an organization running more
than one site is still totalled across all of them.

The reverse is much faster still: an upgrade releases within roughly a minute.

## Reducing bandwidth

Most bandwidth on a content site is images.

- Turn on **CDN delivery** — it is on every plan — so images are served in WebP at
  the size the visitor's screen asks for. See
  [Media library & CDN](../../content-and-data/media/overview.md#deliver-over-cdn).
- Replace oversized hero images. A 4 MB photograph scaled down in the browser still costs
  4 MB of bandwidth every time someone loads the page.
- Check **Analytics → Traffic** for a page that is unexpectedly popular; a single embedded
  video or a hotlinked asset can dominate a month.

---

## Reference {#reference}

For developers and operators. None of this is needed to use the feature.

### How usage is counted

Bandwidth is derived from page views rather than measured byte-for-byte at the edge. The
platform uses a fixed accounting figure of **600 KB per page view** and converts in both
directions, so the meter you read in GB and the counters the analytics pipeline writes are
the same number expressed differently. On Free, 2 GB works out to roughly **3,500 page
views** a month; on Starter, 50 GB is roughly **87,000**, and the same division gives every
other band.

That 600 KB is a **billing convention, not a measurement of your pages**, and the
difference currently runs in your favor. A real page load measured against our own site
comes in nearer **1 MB**, so the 3,500 views a Free plan converts to move closer to 3.5 GB
of actual traffic than to 2 GB. Your allowance is charged at the convention, so the extra is
not billed to you and not deducted from your band.

Two things follow. Pages heavier than 600 KB do **not** consume your allowance faster —
the counter moves per view, whatever the page weighs. And a page you make lighter does not
stretch the allowance further, for the same reason: if you want more views, the lever is the
plan's band, not the page.

Page views are read from the per-host `analytics/{YYYY-MM-DD}` documents that already
exist for the Analytics screens — evaluating a cap adds no Firestore reads to the serving
path.

### The two mechanisms

There are **two** independent protections, and they behave differently. A description that
mentions only one of them is incomplete.

| | Bandwidth cap | Abuse ceiling |
|---|---|---|
| Applies to | Free organizations only | Any plan |
| Trips at | 1× the plan's band | 10× the plan's band (minimum 100,000 page views) |
| Decided by | The analytics beacon, sampled — plus the daily usage job organization-wide | The analytics beacon, sampled |
| Recorded on | `orgs/{orgId}.bandwidthCap` | `hosts/{hostId}.bandwidthCeiling` |
| Enforced at | Edge middleware **and** the page loader | The page loader |
| Latency | Minutes | Minutes |
| Visitor sees | The "Over the monthly traffic limit" notice | The "This site is temporarily unavailable" notice, **on Free only** |

The abuse ceiling exists for runaway traffic — a scraper, a hotlinked asset, a loop. On a
plan that meters overage it **flags the site and pages staff but changes nothing a visitor
sees**, because that traffic is billed rather than refused. Only on a plan that cannot
meter (Free) does it degrade what is served.

The cap is evaluated **before** the ceiling, so a Free site over its band reads the
plan-limit wording rather than an abuse notice.

### What a visitor's browser gets

The cap is enforced in edge middleware, **ahead of the ISR cache** — a cached page cannot
outlive the pause. Every matched path is rewritten to a handler that answers:

- `503 Service Unavailable`
- `Retry-After: 3600`
- `Cache-Control: no-store`
- `<meta name="robots" content="noindex">` in a self-contained HTML body with no scripts

A staff **lockdown outranks a cap** — a suspended site serves the lockdown notice, not
this one.

The page loader repeats the check as defense in depth and renders the same wording as a
200 with `robots: { index: false }`; that path exists for anything the middleware matcher
does not cover.

### Fail-open, on purpose

Every layer of this check fails **open**. A thrown organization read, an unreachable
verdict route, a non-200, unparseable JSON, or an older deployment that does not return
the field at all — all of them keep serving. Refusing to serve a customer's site because
an internal check could not be completed is the worse failure of the two.

Note that *attribution* on the same response fails **closed**; the two are deliberately
opposite.

### Self-hosting

The cap is engaged by the analytics beacon at `/api/analytics/collect`, which needs no
scheduled job and no secret — a deployment that serves pages caps them. The daily usage
job at `/api/billing/usage-alerts` (gated on `CRON_SECRET`) engages the same cap
organization-wide and sends the usage emails; a deployment that never invokes it still
caps, but loses the alerts and the multi-site total — see
[Self-hosting](../../developers/self-hosting.md).

`USAGE_ALERT_APPROACH_PCT` sets the first alert threshold (default `80`; a value outside
1–99 falls back to 80).

## Related

- [Billing & plans](overview.md)
- [Storage overage](overview.md#storage-overage)
- [Analytics](../../marketing-and-automation/analytics/overview.md)
- [Media library & CDN](../../content-and-data/media/overview.md)
