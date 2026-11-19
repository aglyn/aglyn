---
sidebar_position: 3
title: Rate limits & usage
description: The per-key and per-workspace request limits, the RateLimit and X-RateLimit headers, and how the monthly quota bills.
---

# Rate limits & usage

Two separate things share this page, and they behave very differently:

- The **rate limits** are short-term burst caps, one per key and one for the whole
  workspace. Exceed either and the request is refused.
- The **monthly quota** is a billing meter. Exceed it and the request still succeeds —
  the overage lands on your invoice — up to your plan's monthly ceiling, if it has one.

## Rate limits

Two per-minute limits apply to every request, in fixed one-minute windows:

| Limit | Starter | Pro | Custom |
| --- | --- | --- | --- |
| Per API key | 120 | 120 | 120 |
| Per workspace, all keys and connections together | 120 | 600 | Set by your agreement; none by default |

**The workspace limit is the ceiling.** Splitting an integration across several keys
gives each key its own 120, so one runaway script can't starve the others — but
together they never go past the workspace's limit. On Starter one key can use the
whole workspace budget; on Pro five busy keys can.

Everything that authenticates with a key counts towards the workspace limit: REST
calls, and an AI agent calling through the
[MCP server](/guides/your-first-api-call#mcp) with one of your keys.

:::note Counted globally, not per server
The counter is shared across every server that answers your requests, so 120/min is
the ceiling for the key no matter which of our instances a request lands on — and it
doesn't reset when one of them restarts.

If the shared counter is briefly unreachable we fall back to a per-server count rather
than refusing traffic. That can only ever let *more* than 120/min through, never
fewer, so a degradation on our side never costs you requests you were entitled to.
:::

Every response carries the current budget:

| Header | Meaning |
| --- | --- |
| `X-RateLimit-Scope` | Which budget the six headers below describe: `key`, or `workspace` on a refusal by the workspace limit. |
| `RateLimit-Limit` | Requests allowed per window (`120` for a key). |
| `RateLimit-Remaining` | Requests left in the current window. |
| `RateLimit-Reset` | **Seconds until** the window resets. |
| `X-RateLimit-Limit` | Same number as `RateLimit-Limit`. |
| `X-RateLimit-Remaining` | Same number as `RateLimit-Remaining`. |
| `X-RateLimit-Reset` | When the window resets, as a Unix timestamp in **seconds**. |

Both spellings carry the same budget and are computed from the same reading, so they
can never disagree. `RateLimit-*` is [RFC 9331][rfc9331]; reach for it if you are
writing a general HTTP client, and note that its `Reset` is a **duration** while
`X-RateLimit-Reset` is a **timestamp** — the two are not interchangeable.

`X-RateLimit-*` is the older set this API has always sent. It is not deprecated and
has no removal date; if you are already reading it, keep reading it.

The workspace's own budget comes on every authenticated response too, wherever the
plan sets one:

| Header | Meaning |
| --- | --- |
| `X-Workspace-RateLimit-Limit` | Requests the whole workspace may make per minute. |
| `X-Workspace-RateLimit-Remaining` | Requests the workspace has left in the current window. |
| `X-Workspace-RateLimit-Reset` | When the workspace window resets, as a Unix timestamp in **seconds**. |

Pace a single integration against the key headers; pace several against the
workspace ones.

[rfc9331]: https://www.rfc-editor.org/rfc/rfc9331

A `401` for a key we can't identify (missing or invalid) reports a **different**
budget — the per-address lookup budget below, not your key's. We can't report a key's
budget when we don't know whose it is, but you are still being metered, so the numbers
you get back are the ones that apply to you at that moment.

:::caution The `401` and the `429` before it describe the lookup budget
`RateLimit-Limit` is **60** there, not 120. Once a call authenticates, the same headers
switch to your key's 120/min. If you are pacing against these, read them per response
rather than caching the first one you saw.
:::

:::caution Repeatedly sending a key we don't recognize
Looking up a key costs us work even when it turns out not to exist, so an IP address
that sends a large number of **unrecognised** keys in a short time starts getting `429`
instead of `401`. Wait `Retry-After` seconds and it clears.

This is separate from the per-key limit above and does not consume it: a key that
resolves never counts towards it, so normal traffic — however heavy — can't trigger
it. In practice you only meet this if a client is looping on a key that was revoked or
mistyped. Fix the key rather than retrying, and note that while an IP is in this state
a *valid* key sent from the same address is refused too, because identifying it is the
work we're declining to do.
:::

When you exceed a limit, the request returns `429` with a `Retry-After` header
(seconds to wait), and `error.code` says which limit it was:

```json
{ "error": { "type": "rate_limited", "code": "workspace_rate_limit", "message": "This workspace has made 120 API requests in the last minute across all of its keys, the most its plan allows." } }
```

| `code` | Limit | `Retry-After` |
| --- | --- | --- |
| `key_rate_limit` | The key's 120 a minute | Seconds to the next minute |
| `workspace_rate_limit` | The workspace's per-minute limit | Seconds to the next minute |
| `monthly_request_ceiling` | The plan's monthly ceiling (Starter) — see [below](#monthly-quota--overage) | Seconds to the next month, UTC |
| `monthly_request_quota` | The included requests, on a plan that bills nothing past them | Seconds to the next month, UTC |

### Staying under the limit

- Read `RateLimit-Remaining` (or `X-RateLimit-Remaining`) and slow down as it approaches zero.
  If you run several keys, watch `X-Workspace-RateLimit-Remaining` as well.
- On a `429`, wait `Retry-After` seconds. Requests made while limited still count, so
  hammering the endpoint keeps the window pinned — back off rather than retrying
  immediately.
- Prefer a larger `?limit=` over more requests when reading collections: one call for
  100 records costs one call against the rate limits and is billed by its size (below),
  while a hundred calls cost a hundred.

### Creating a site has its own budget too {#site-create-budget}

[`POST /v1/sites`](resources/sites.md#create) is limited to **10 per hour**, and that
budget belongs to the **organization** rather than to the key.

Subdomains are one global namespace shared by every customer, so a name someone takes
is gone for everyone — which makes an unbounded create endpoint a name-grab, not just
a cost problem. Keying the budget to the organization means minting extra keys does
not multiply the rate.

Two things follow:

- **It is separate from your request budget.** A create spends one of these ten and
  one request; exhausting it doesn't touch anything else, and a `429` here carries
  `Retry-After`.
- **Your plan's site limit is a different thing.** This bounds how fast you may try;
  the site allowance bounds how many you may hold, and that refusal is a `403`
  (`site_quota`), not a `429`.

### Publishing has its own, separate budget {#publish-budget}

[`POST /v1/sites/{siteId}/publish`](resources/sites.md#publish) is limited to **10 per
site per hour**, on top of — not instead of — the per-key limit above.

It is counted differently on purpose. Every other call does work proportional to
itself; one publish drops up to 250 cached pages, each of which then costs real work to
rebuild. So the budget is sized to the work and attached to the **site**, which means
minting extra keys does not raise it.

Two practical consequences:

- **Neither `RateLimit-*` nor `X-RateLimit-*` describes it.** Those headers report your key's 120/min
  budget. A publish `429` carries `Retry-After`, and that is the number to obey.
- **Publish once per batch.** A sync that writes 500 records and publishes once stays
  well inside the budget; publishing per record is refused after ten and gains nothing,
  because the pages would have refreshed on their own anyway.

## Monthly quota & overage

Separate from the rate limits, each **organization** has a monthly request quota tied
to its plan:

| Plan | Included requests / month | Overage | Monthly ceiling |
| --- | --- | --- | --- |
| Starter | 500 | Metered per additional 1,000, at the rate on [aglyn.com/pricing](https://aglyn.com/pricing) | 20,000 requests, then refused until the month turns |
| Pro | 1,500 | Metered per additional 1,000, at the rate on [aglyn.com/pricing](https://aglyn.com/pricing) | None |
| Custom | Set by your agreement | — | Set by your agreement |

Requests beyond the included quota **keep working** and bill as metered overage on the
monthly invoice, so a bulk import doesn't stop when the included requests run out.

**Starter has a monthly ceiling; Pro has none.** On Starter, once the workspace has
made 20,000 requests in a calendar month (UTC) — the included 500 and the overage
together — every further request is refused with `429` and code
`monthly_request_ceiling` until the month turns, with `Retry-After` counting down to
it. Move to Pro for an integration that needs more: its overage keeps billing with no
ceiling. `GET /v1/usage` reports the ceiling as `apiRequests.ceiling` (`null` where
there is none).

A workspace that can't be billed for overage — one with no active subscription, or
whose whole bill is covered by a 100% discount — stops at its included requests
instead, with code `monthly_request_quota`.

Read where you stand from the API itself with [`GET /v1/usage`](usage.md), or on the
**Billing** page's API-requests meter. See
[Billing & Plans → API access](/workspace-and-billing/billing-and-plans/overview#api-access).

The month is calendar-based in **UTC**, which may not match your billing timezone at
the boundary.

### What counts

Metering happens once a request is authenticated and past the rate limit, so:

**Billed** — every authenticated request that reaches a handler, *including* ones that
then fail: `404` not-found, `405` wrong-method, `400` validation errors, and `403
insufficient_scope` (the scope is checked after metering).

**Not billed** — `401 unauthorized`, `403 plan_required`, and every `429 rate_limited`,
whichever limit refused it.

In practice: a buggy client looping on a 404 costs you quota, but an unauthenticated
or rate-limited one doesn't.

### Billed units: requests are counted by size {#billed-units}

The monthly quota, the overage and Starter's ceiling count **billed units**, not calls.
A request is **one unit per started 256 KB** (262,144 bytes) of the larger of its
request body and its response body, and never less than one:

| Request | Units |
| --- | --- |
| A default page of 25 records (tens of KB) | 1 |
| A page of 100 records of about 3 KB each (about 300 KB) | 2 |
| A 1 MB request body (a file of about 750 KB, base64-encoded) | 4 |
| A body at the 4.5 MB limit | 18 |

Every response says what it was charged in `X-Api-Billing-Units`, and
[`GET /v1/usage`](usage.md) reports the month in units (`apiRequests.used`) with the
unit's size (`apiRequests.unitBytes`). The per-minute rate limits are different: they
count **calls**, whatever their size.

Over the [MCP server](/guides/your-first-api-call#mcp), protocol messages —
`initialize`, `tools/list`, `ping` and notifications — are never weighed. A tool call
is weighed like the REST call it makes: its request and its response.
