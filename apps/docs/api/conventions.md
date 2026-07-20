---
sidebar_position: 4
title: Conventions
description: Pagination, error envelopes, and idempotency — shared behavior across every endpoint.
---

# Conventions

## Pagination

List endpoints return a consistent envelope and page with an opaque cursor:

```json
{
  "object": "list",
  "data": [ /* … */ ],
  "next_cursor": "c2VlZC0x",
  "has_more": true
}
```

Pass `?limit=` (1–100, default 25) and `?cursor=` to page:

```bash
# first page
curl "https://app.aglyn.io/api/v1/datasets/ds_1/records?limit=50" \
  -H "Authorization: Bearer aglyn_sk_…"

# next page — pass the previous response's next_cursor
curl "https://app.aglyn.io/api/v1/datasets/ds_1/records?limit=50&cursor=c2VlZC0x" \
  -H "Authorization: Bearer aglyn_sk_…"
```

When `has_more` is `false`, `next_cursor` is `null` and you've reached the end.
Cursors are opaque — don't construct or parse them.

## Errors

Errors use a consistent envelope and standard HTTP status codes:

```json
{ "error": { "type": "not_found", "message": "No such dataset" } }
```

| Status | `type` | When |
| --- | --- | --- |
| `400` | `bad_request` | Malformed request or failed validation (`code: "validation_failed"`). |
| `401` | `unauthorized` | Missing, invalid, revoked, or expired key. |
| `403` | `plan_required` | The plan doesn't include API access. |
| `403` | `insufficient_scope` | The key lacks the required scope (`code` is the scope). |
| `404` | `not_found` | No such resource. |
| `405` | `method_not_allowed` | Method not supported on that path. |
| `429` | `rate_limited` | [Rate limit](rate-limits.md) exceeded. |
| `500` | `internal_error` | Something went wrong on our side. |

## Idempotency

`POST` requests that create a resource accept an **`Idempotency-Key`** header.
Send the same key to retry a request safely — if the original succeeded, the
same resource is returned instead of creating a duplicate:

```bash
curl -X POST https://app.aglyn.io/api/v1/datasets/ds_1/records \
  -H "Authorization: Bearer aglyn_sk_…" \
  -H "Idempotency-Key: 2b9f1c4e-…" \
  -H "Content-Type: application/json" \
  -d '{"values":{"name":"Avery"}}'
```

Use a unique key per logical operation (a UUID is a good choice).
