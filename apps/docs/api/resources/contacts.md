---
sidebar_position: 2
title: Contacts
description: Read your organization's contacts over the REST API.
---

# Contacts

Your organization's [contacts](/content-and-data/contacts/overview) — the
unified list built from form submissions, members, orders, and bookings. The
API exposes read access.

## The contact object

```json
{
  "id": "contact_1",
  "object": "contact",
  "email": "wholesale@example.com",
  "name": "Robin Wholesale",
  "tags": ["b2b"],
  "sources": ["form"],
  "created": "2026-07-20T18:23:23.941Z",
  "updated": "2026-07-20T18:23:23.941Z"
}
```

## Endpoints

### List contacts

`GET /v1/contacts` — scope `contacts:read`. [Paginated](../conventions.md#pagination).

```bash
curl "https://app.aglyn.io/api/v1/contacts?limit=50" \
  -H "Authorization: Bearer aglyn_sk_…"
```

### Retrieve a contact

`GET /v1/contacts/{id}` — scope `contacts:read`.
