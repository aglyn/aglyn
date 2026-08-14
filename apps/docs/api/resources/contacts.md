---
sidebar_position: 2
title: Contacts
description: Read your organization's contacts over the REST API.
---

# Contacts

Your organization's [contacts](/content-and-data/contacts/overview) — the unified list
built from form submissions, member sign-ups, orders, and bookings. Contacts are
**read-only** over the API; they're created by the capture points on your sites.

:::note The API is ahead of the console
These endpoints are live. The console **Contacts page** is still
[rolling out](/content-and-data/contacts/overview), so until it opens this API is the
way to read the contacts your sites have already captured.
:::

## The contact object

```json
{
  "id": "k7d2b9f104",
  "object": "contact",
  "email": "wholesale@example.com",
  "name": "Robin Wholesale",
  "tags": ["b2b"],
  "sources": ["form", "order"],
  "created": "2026-07-20T18:23:23.941Z",
  "updated": "2026-07-20T18:23:23.941Z"
}
```

| Field | Type | Notes |
| --- | --- | --- |
| `id` | string | Opaque contact id. |
| `object` | string | Always `"contact"`. |
| `email` | string \| null | The identity a contact is unified on. |
| `name` | string \| null | Display name, when known. |
| `tags` | string[] | Tags applied in the console. |
| `sources` | string[] | Where this person came from — `form`, `member`, `order`, `booking`, `newsletter`. Multiple entries mean one person did several things. |
| `created` / `updated` | string \| null | ISO 8601. |

The interaction timeline shown in the console isn't exposed over the API.

## Endpoints

### List contacts

`GET /v1/contacts` — scope `contacts:read`. [Paginated](../conventions.md#pagination),
ordered by contact id (see [ordering](../conventions.md#ordering) — not newest-first).

```bash
curl "https://app.aglyn.com/api/v1/contacts?limit=50" \
  -H "Authorization: Bearer aglyn_sk_…"
```

There's no filter by email, tag, or source — page and filter client-side.

### Retrieve a contact

`GET /v1/contacts/{contactId}` — scope `contacts:read`.

Returns a contact object, or `404 not_found` (`"No such contact"`).

## Errors

| Status | `type` | When |
| --- | --- | --- |
| `403` | `insufficient_scope` | Key lacks `contacts:read`. Checked before the method, so a write attempt with a read-only key returns `403`, not `405`. |
| `404` | `not_found` | `"No such contact"`. |
| `405` | `method_not_allowed` | Anything other than `GET`. |

## Related

- [Contacts CRM](/content-and-data/contacts/overview) — how contacts are captured, and
  what the audience band means for your plan.
