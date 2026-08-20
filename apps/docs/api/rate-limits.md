---
sidebar_position: 3
title: Rate limits & usage
description: The per-key request limit, the X-RateLimit headers, and how the monthly quota bills.
---

# Rate limits & usage

Two separate things share this page, and they behave very differently:

- The **rate limit** is a short-term burst cap. Exceed it and the request is refused.
- The **monthly quota** is a billing meter. Exceed it and the request still succeeds —
  the overage lands on your invoice.

## Rate limit

**120 requests per minute, per API key**, in a fixed one-minute window.

The limit is per key, so splitting an integration across two keys gives it two
budgets — and one runaway script can't starve your others.

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
| `X-RateLimit-Limit` | Requests allowed per window (`120`). |
| `X-RateLimit-Remaining` | Requests left in the current window. |
| `X-RateLimit-Reset` | When the window resets, as a Unix timestamp in **seconds**. |

The one exception is a `401` for a key we can't identify (missing or invalid) — there's
no budget to report when we don't know whose it is.

:::caution Repeatedly sending a key we don't recognise
Looking up a key costs us work even when it turns out not to exist, so an IP address
that sends a large number of **unrecognised** keys in a short time starts getting `429`
instead of `401`. Wait `Retry-After` seconds and it clears.

This is separate from the per-key limit above and does not consume it: a key that
resolves never counts towards it, so normal traffic — however heavy — can't trigger
it. In practice you only meet this if a client is looping on a key that was revoked or
mistyped. Fix the key rather than retrying, and note that while an IP is in this state
a *valid* key sent from the same address is refused too, because identifying it is the
work we're declining to do.

When you exceed the limit, the request returns `429` with a `Retry-After` header
(seconds to wait):

```json
{ "error": { "type": "rate_limited", "message": "Too many requests" } }
```

### Staying under the limit

- Read `X-RateLimit-Remaining` and slow down as it approaches zero.
- On a `429`, wait `Retry-After` seconds. Requests made while limited still count, so
  hammering the endpoint keeps the window pinned — back off rather than retrying
  immediately.
- Prefer a larger `?limit=` over more requests when reading collections: one call for
  100 records costs one request, a hundred calls cost a hundred.

### Publishing has its own, separate budget {#publish-budget}

[`POST /v1/sites/{siteId}/publish`](resources/sites.md#publish) is limited to **10 per
site per hour**, on top of — not instead of — the per-key limit above.

It is counted differently on purpose. Every other call does work proportional to
itself; one publish drops up to 250 cached pages, each of which then costs real work to
rebuild. So the budget is sized to the work and attached to the **site**, which means
minting extra keys does not raise it.

Two practical consequences:

- **`X-RateLimit-*` does not describe it.** Those headers report your key's 120/min
  budget. A publish `429` carries `Retry-After`, and that is the number to obey.
- **Publish once per batch.** A sync that writes 500 records and publishes once stays
  well inside the budget; publishing per record is refused after ten and gains nothing,
  because the pages would have refreshed on their own anyway.

## Monthly quota & overage

Separate from the rate limit, each **organization** has a monthly request quota tied
to its plan:

| Plan | Included requests / month | Overage |
| --- | --- | --- |
| Business | 100,000 | $0.50 per additional 1,000 |
| Advanced | 1,000,000 | $0.20 per additional 1,000 |

Requests beyond the included quota **keep working** and bill as metered overage on the
monthly invoice — the quota is a meter, not a wall, so it can never break a live
integration mid-run. Read where you stand from the API itself with
[`GET /v1/usage`](usage.md), or on the **Billing** page's API-requests meter. See
[Billing & Plans → API access](/workspace-and-billing/billing-and-plans/overview#api-access).

The month is calendar-based in **UTC**, which may not match your billing timezone at
the boundary.

### What counts

Metering happens once a request is authenticated and past the rate limit, so:

**Billed** — every authenticated request that reaches a handler, *including* ones that
then fail: `404` not-found, `405` wrong-method, `400` validation errors, and `403
insufficient_scope` (the scope is checked after metering).

**Not billed** — `401 unauthorized`, `403 plan_required`, and `429 rate_limited`.

In practice: a buggy client looping on a 404 costs you quota, but an unauthenticated
or rate-limited one doesn't.
