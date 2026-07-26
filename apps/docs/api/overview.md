---
sidebar_position: 1
slug: /
title: Aglyn REST API
description: A REST API for your organization's datasets, records, contacts, sites, and form submissions — authenticated with API keys.
---

# Aglyn REST API

The Aglyn REST API gives you programmatic access to your organization's data —
[datasets and records](resources/datasets.md), [contacts](resources/contacts.md), and
[sites with their form submissions](resources/sites.md). Use it to sync content from
another system, back up records, or build an integration.

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
  "resources": ["datasets", "contacts", "sites", "forms"]
}
```

:::note
`forms` appears in `resources` but is not a top-level path — form submissions live
under [`/v1/sites/{siteId}/form-submissions`](resources/sites.md#list-form-submissions).
Don't build a client off that list.
:::

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

For event-driven integrations, see [Webhooks](integrations/webhooks.md) — push instead
of poll.

## Everything you need to know

- [Authentication](authentication.md) — API keys and scopes.
- [Rate limits & usage](rate-limits.md) — 120 requests/minute per key, and how the
  monthly quota bills.
- [Conventions](conventions.md) — pagination, ordering, errors, and idempotency.
