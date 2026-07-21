---
sidebar_position: 3
title: Rate limits
description: Per-key request limits and the X-RateLimit headers on every response.
---

# Rate limits

Requests are rate limited **per API key**. Every response carries the current
budget as headers:

| Header | Meaning |
| --- | --- |
| `X-RateLimit-Limit` | Requests allowed per window. |
| `X-RateLimit-Remaining` | Requests left in the current window. |
| `X-RateLimit-Reset` | When the window resets, as a Unix timestamp (seconds). |

When you exceed the limit, the request returns `429` with a `Retry-After`
header (seconds to wait):

```json
{ "error": { "type": "rate_limited", "message": "Too many requests" } }
```

## Staying under the limit

- Read `X-RateLimit-Remaining` and back off as it approaches zero.
- On a `429`, wait for the number of seconds in `Retry-After` before retrying.
- Prefer [pagination](conventions.md#pagination) over many small requests when
  reading large collections.

## Monthly quota & overage

Separate from the per-key rate limit, each **organization** has a monthly
request quota tied to its plan:

| Plan | Included requests / month | Overage |
| --- | --- | --- |
| Business | 100,000 | $0.50 per additional 1,000 |
| Advanced | 1,000,000 | $0.20 per additional 1,000 |

Requests beyond the included quota **keep working** and bill as metered overage
on the monthly invoice — the quota never hard-blocks a live integration.
Only requests that pass authentication and the rate limit count toward it;
rejected calls (`401`/`403`/`429`) are never billed. Track usage on the
**Billing** page's API-requests meter. See
[Billing & Plans → API access](/workspace-and-billing/billing-and-plans/overview#api-access).
