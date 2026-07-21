---
sidebar_position: 1
slug: /
title: Aglyn REST API
description: A REST API for your organization's datasets, records, contacts, sites, and form submissions — authenticated with API keys.
---

# Aglyn REST API

The Aglyn REST API gives you programmatic access to your organization's data —
[datasets and records](resources/datasets.md), [contacts](resources/contacts.md),
[sites](resources/sites.md), and form submissions. Use it to sync content from
another system, back up records, or build an integration.

:::info Plan availability
The REST API is included on the **Business** plan. Create keys from
**Organization → Settings → API keys**.
:::

## Base URL

```
https://app.aglyn.io/api/v1
```

All requests are made over HTTPS. Every response is JSON.

## Quick start

```bash
curl https://app.aglyn.io/api/v1/me \
  -H "Authorization: Bearer aglyn_sk_your_key_here"
```

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
| [Sites](resources/sites.md) | List sites and read their form submissions. |

For event-driven integrations, see [Webhooks](integrations/webhooks.md).

## Everything you need to know

- [Authentication](authentication.md) — API keys and scopes.
- [Rate limits](rate-limits.md) — request caps and the `X-RateLimit-*` headers.
- [Conventions](conventions.md) — pagination, errors, and idempotency.
