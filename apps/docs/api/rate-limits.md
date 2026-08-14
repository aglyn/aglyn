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

## Monthly quota & overage

Separate from the rate limit, each **organization** has a monthly request quota tied
to its plan:

| Plan | Included requests / month | Overage |
| --- | --- | --- |
| Business | 100,000 | $0.50 per additional 1,000 |
| Advanced | 1,000,000 | $0.20 per additional 1,000 |

Requests beyond the included quota **keep working** and bill as metered overage on the
monthly invoice — the quota is a meter, not a wall, so it can never break a live
integration mid-run. Track usage on the **Billing** page's API-requests meter. See
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
