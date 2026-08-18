---
sidebar_position: 1
slug: /
title: Aglyn REST API
description: A REST API for your organization's datasets, contacts, sites, form submissions, store orders, products and media — authenticated with API keys.
---

# Aglyn REST API

The Aglyn REST API gives you programmatic access to your organization's data —
[datasets and records](resources/datasets.md), [contacts](resources/contacts.md),
[sites with their form submissions](resources/sites.md), your store's
[orders](resources/orders.md) and [products](resources/products.md), and your
[media library](resources/media.md). Use it to sync content from another system, push
orders into accounting, feed a catalog to a marketplace, back up records, or build an
integration.

:::info Plan availability
The REST API is included on the **Business** and **Advanced** plans. Create keys from
**Organization → Settings → API keys**.
:::

## Base URL

```
https://app.aglyn.com/api/v1
```

All requests are over HTTPS and every response is JSON. The version lives in the path;
there's no version header.

## Quick start

Check your key and see what it can do:

```bash
curl https://app.aglyn.com/api/v1/me \
  -H "Authorization: Bearer aglyn_sk_your_key_here"
```

```json
{
  "object": "api_key",
  "org": "org_abc123",
  "scopes": ["datasets:read", "datasets:write"]
}
```

Then read some data — here, the first page of a dataset's records:

```bash
curl "https://app.aglyn.com/api/v1/datasets" \
  -H "Authorization: Bearer aglyn_sk_your_key_here"

curl "https://app.aglyn.com/api/v1/datasets/ds_team/records?limit=100" \
  -H "Authorization: Bearer aglyn_sk_your_key_here"
```

### In JavaScript

```js
const res = await fetch('https://app.aglyn.com/api/v1/datasets/ds_team/records', {
  headers: { Authorization: `Bearer ${process.env.AGLYN_API_KEY}` },
})
if (!res.ok) {
  const { error } = await res.json()
  throw new Error(`${error.type}: ${error.message}`)
}
const { data, next_cursor, has_more } = await res.json()
```

### Paging through everything

Lists are ordered by id and paged with an opaque cursor, so a full sync is a loop:

```js
let cursor = null
const all = []
do {
  const url = new URL('https://app.aglyn.com/api/v1/datasets/ds_team/records')
  url.searchParams.set('limit', '100')
  if (cursor) url.searchParams.set('cursor', cursor)
  const page = await fetch(url, {
    headers: { Authorization: `Bearer ${process.env.AGLYN_API_KEY}` },
  }).then((r) => r.json())
  all.push(...page.data)
  cursor = page.next_cursor
} while (cursor)
```

Read [ordering](conventions.md#ordering) before you assume page 1 holds the newest
records — it doesn't.

## Service endpoints

Two endpoints need no scope; any valid key can call them.

### `GET /v1`

What this API is and what it serves.

```json
{
  "object": "api",
  "name": "Aglyn REST API",
  "version": "v1",
  "documentation": "https://docs.aglyn.com/api",
  "resources": ["datasets", "contacts", "sites", "media"]
}
```

This lists only **top-level** resources. Form submissions, [orders](resources/orders.md)
and [products](resources/products.md) all live under a site
(`/v1/sites/{siteId}/…`) and are deliberately absent, so a client that walks this list
never builds a path that 404s. `media` is here because
[`/v1/media`](resources/media.md) — the *organization* library — really is a top-level
path; each site's own files are additionally at `/v1/sites/{siteId}/media`.

### `GET /v1/me`

Introspect the key you're calling with — useful for verifying a key after rotation, or
for failing fast at startup with a clear message.

```json
{
  "object": "api_key",
  "org": "org_abc123",
  "scopes": ["datasets:read", "datasets:write"]
}
```

## Resources

| Resource | Description |
| --- | --- |
| [Datasets & records](resources/datasets.md) | List datasets and create, read, update, and delete their records. |
| [Contacts](resources/contacts.md) | Read your organization's contacts. |
| [Sites & form submissions](resources/sites.md) | List sites and read their form submissions. |
| [Orders](resources/orders.md) | Read a site's store orders — line items, totals, refunds, disputes. |
| [Products](resources/products.md) | Read a site's catalog — variants, prices, stock levels. |
| [Media](resources/media.md) | List files in the organization library and in each site's media. |

Orders and products need a plan that includes **commerce**, in addition to their
scope — see each page's plan note.

For event-driven integrations, see [Webhooks](integrations/webhooks.md) — push instead
of poll.

## Everything you need to know

- [Authentication](authentication.md) — API keys and scopes.
- [Rate limits & usage](rate-limits.md) — 120 requests/minute per key, and how the
  monthly quota bills.
- [Conventions](conventions.md) — pagination, ordering, errors, and idempotency.
