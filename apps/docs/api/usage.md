---
sidebar_position: 4
title: Usage
description: Read your organization's current usage against every plan band — API requests, contacts, datasets, and dataset storage.
---

# Usage

`GET /v1/usage` reports your organization's usage for the **current billing month**,
against the bands your plan includes.

The API is the surface you're metered on, so this is the one endpoint that tells you
what the enforcement path is about to do. Without it, the first signal that a band is
full is the refusal itself — a `429` with a `Retry-After` pointing at the month
boundary, which is a wall with no approach.

Reach for it before a bulk import, and on a slow schedule while an integration runs.

```bash
curl "https://app.aglyn.com/api/v1/usage" \
  -H "Authorization: Bearer aglyn_sk_…"
```

**No scope is required.** Like [`/v1/me`](authentication.md), an API key is an
organization credential and this is that organization's own meter — a key scoped only
to contacts still needs to see the request quota that would refuse it.

## The usage object

```json
{
  "object": "usage",
  "month": "2026-08",
  "apiRequests":   { "used": 18422, "included": 100000, "remaining": 81578, "metered": true },
  "contacts":      { "used": 3120,  "included": 100000, "remaining": 96880, "metered": true },
  "datasets":      { "used": 4,     "included": 25,     "remaining": 21,    "metered": false },
  "dataStorageMb": { "used": 412,   "included": 10240,  "remaining": 9828,  "metered": true }
}
```

| Field | Type | Notes |
| --- | --- | --- |
| `object` | string | Always `"usage"`. |
| `month` | string | The billing month these figures cover, `YYYY-MM`, UTC. |
| `apiRequests` | band | Requests to `/v1` this month. |
| `contacts` | band | [Contacts](resources/contacts.md) in the organization — the audience band. Not monthly: it's the current size of the list. |
| `datasets` | band | [Datasets](resources/datasets.md) in the organization. Also not monthly. |
| `dataStorageMb` | band | Stored dataset bytes, in MB. |

Every band has the same four fields:

| Field | Type | Notes |
| --- | --- | --- |
| `used` | number | What you've used. |
| `included` | number \| null | What the plan includes. **`null` means unlimited** — see [below](#unlimited). |
| `remaining` | number \| null | `included - used`, floored at `0`. `null` when `included` is. |
| `metered` | boolean | What happens when you cross the band: `true` bills the excess, `false` refuses the next write. |

### `metered` is the field that matters {#metered}

`used` and `remaining` tell you where you are. `metered` tells you what happens next,
and the two answers are completely different:

- **`metered: true`** — crossing the band **doesn't fail anything**. The excess bills
  as [overage](rate-limits.md#monthly-quota--overage) at your plan's rate. A bulk
  import runs to completion; a busy month costs more. This is the case on every plan
  that includes the API, for requests, contacts and storage.
- **`metered: false`** — crossing the band is a **refusal**. Once `remaining` hits `0`
  the next write answers `403 plan_required` with the matching
  [`code`](conventions.md#plan-required).

`datasets` is always `metered: false`: extra dataset slots are an add-on you buy, not
usage that bills. Its `included` is the **effective** limit — the plan's allowance plus
any add-on slots purchased — because that is the number a create is actually compared
against.

### Unlimited bands {#unlimited}

`included: null` and `remaining: null` mean the band is unlimited on this plan. Treat
`null` as "no ceiling", not as zero and not as missing — a `?? 0` here turns an
unlimited plan into an exhausted one.

## Freshness

The figures are not all measured the same way, and the difference is worth knowing
before you alert on them.

- **`apiRequests` is live.** It's read from the same counter that refuses a request
  over quota, so what this endpoint reports and what enforcement acts on can't drift.
  This call is itself metered, so the count it returns includes it.
- **`contacts` and `datasets` are live.** Both are counted at read time.
- **`dataStorageMb` is swept, not live.** Stored bytes are measured by a background
  job, so the number here is the one **billing prices from** rather than an
  up-to-the-second figure. Records you wrote minutes ago may not be in it yet. That is
  the honest field to publish: a freshly-derived number would disagree with the
  invoice.
- **Live is not the same as billed, for `contacts` and `dataStorageMb`.** Both are
  levels rather than monthly totals, and a level has to be charged on one moment in the
  month: the **last daily reading before the month closes**. So during a month these
  fields track your current position against the band — which is what you want to alert
  on, because that is what enforcement acts on — while the invoice for a *finished*
  month is fixed at where you ended it. Deleting contacts in March cannot change the
  February invoice, and the March figure you see here is not final until March is.

## Errors

| Status | `type` | When |
| --- | --- | --- |
| `403` | `plan_required` | The organization's plan doesn't include API access. Same as every other endpoint — this one isn't exempt. |
| `405` | `method_not_allowed` | Anything other than `GET`. The `Allow` header says `GET`. |

There is no `insufficient_scope` on this path, because no scope is required.

## Related

- [Rate limits](rate-limits.md) — the per-minute limit, and how monthly overage is
  billed.
- [Conventions → plan_required](conventions.md#plan-required) — the refusal codes each
  band produces when it isn't metered.
