---
sidebar_position: 2
title: Authentication
description: Authenticate REST API requests with an organization API key, scoped to exactly what it needs.
---

# Authentication

Every request authenticates with an **API key** — a secret that identifies your
organization. Keys look like `aglyn_sk_…`.

## Create a key

1. In the console, go to **Organization → Settings → API keys**.
2. Choose **Create API key**, give it a name, and select its **scopes**.
3. Copy the key **when it's shown** — it is displayed only once. Aglyn stores
   only a hash and can never show it again. If you lose it, revoke it and
   create a new one.

Only organization **owners and admins** can create or revoke keys.

## Send the key

Pass the key as a bearer token:

```bash
curl https://app.aglyn.io/api/v1/datasets \
  -H "Authorization: Bearer aglyn_sk_your_key_here"
```

The header `X-Api-Key: aglyn_sk_…` is also accepted.

A missing, malformed, revoked, or expired key returns `401`:

```json
{ "error": { "type": "unauthorized", "message": "Invalid or missing API key" } }
```

If your plan doesn't include API access, requests return `403`
`plan_required`.

## Scopes

A key is granted only the scopes you select, and a request that needs a scope
the key lacks returns `403` `insufficient_scope`. Grant the least a key needs.

| Scope | Grants |
| --- | --- |
| `datasets:read` | List datasets and read records. |
| `datasets:write` | Create, update, and delete records. |
| `contacts:read` | List and read contacts. |
| `sites:read` | List sites and read their details. |
| `forms:read` | Read a site's form submissions. |

```json
{
  "error": {
    "type": "insufficient_scope",
    "message": "Missing the \"datasets:write\" scope",
    "code": "datasets:write"
  }
}
```

## Keep keys safe

- Treat a key like a password. Never commit it to source control or expose it
  in client-side code — it carries your organization's access.
- Use a separate key per integration so you can revoke one without affecting
  the others.
- Revoke a key the moment it's no longer needed, from the same settings page.
