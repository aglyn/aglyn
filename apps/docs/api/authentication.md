---
sidebar_position: 2
title: Authentication
description: Authenticate REST API requests with an organization API key, scoped to exactly what it needs.
---

# Authentication

Every request authenticates with an **API key** — a secret that identifies your
organization. Keys look like `aglyn_sk_…`.

A key carries the organization's access, not a person's: it keeps working after the
teammate who created it leaves, and it isn't limited by their role.

## Create a key

1. In the console, go to **Organization → Settings → API keys**.
2. Choose **Create API key**, give it a name, and select its **scopes**.
3. Copy the key **when it's shown** — it is displayed only once. Aglyn stores only a
   hash and can never show it again. If you lose it, revoke it and create a new one.

Only organization **owners and admins** can create or revoke keys; any member can see
the list. The list shows each key's name, scopes, a truncated prefix
(`aglyn_sk_ab12cd…`) to identify it, and roughly when it was last used — that
timestamp updates at most once a minute, so it's for spotting unused keys, not for
auditing individual calls.

Keys **don't expire**. A key stays valid until you revoke it, so rotate deliberately.

## Send the key

Pass the key as a bearer token:

```bash
curl https://app.aglyn.com/api/v1/datasets \
  -H "Authorization: Bearer aglyn_sk_your_key_here"
```

The header `X-Api-Key: aglyn_sk_…` is also accepted. If both are present,
`Authorization: Bearer` wins.

Check a key at any time with [`GET /v1/me`](overview.md#get-v1me), which tells you
which organization it belongs to and what it can do.

A missing, malformed, revoked, or expired key returns `401`:

```json
{ "error": { "type": "unauthorized", "message": "Invalid or missing API key" } }
```

If the organization's plan doesn't include API access, requests return `403`
`plan_required` — the API is a [Business and Advanced feature](overview.md). A key
whose organization has been downgraded stops working without being revoked.

## Scopes

A key is granted only the scopes you select, and a request that needs a scope the key
lacks returns `403` `insufficient_scope`. Grant the least a key needs.

| Scope | Grants |
| --- | --- |
| `datasets:read` | List datasets, read records. |
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

Scopes are independent — there's no hierarchy. `datasets:write` does **not** imply
`datasets:read`; a key that both writes and reads back needs both.

Two endpoints need no scope at all: [`GET /v1`](overview.md#get-v1) and
[`GET /v1/me`](overview.md#get-v1me). Any valid key can call them.

## Keep keys safe

- Treat a key like a password. Never commit it to source control or expose it in
  client-side code — it carries your organization's access.
- Use a separate key per integration so you can revoke one without affecting the
  others, and so the "last used" column tells you something.
- Revoke a key the moment it's no longer needed, from the same settings page. Revoking
  takes effect immediately.
