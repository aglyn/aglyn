---
sidebar_position: 4
title: Conventions
description: Pagination, ordering, error envelopes, and idempotency — shared behavior across every endpoint.
---

# Conventions

Behavior that's the same everywhere, so the resource pages don't have to repeat it.

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

Pass `?limit=` and `?cursor=`:

| Param | Default | Range | Notes |
| --- | --- | --- | --- |
| `limit` | `25` | `1`–`100` | Values outside the range are **clamped, not rejected** — `limit=5000` gives 100, `limit=0` or `limit=abc` gives 25. |
| `cursor` | — | — | Opaque. Pass back the previous response's `next_cursor` verbatim. |

```bash
# first page
curl "https://app.aglyn.com/api/v1/datasets/ds_1/records?limit=50" \
  -H "Authorization: Bearer aglyn_sk_…"

# next page — pass the previous response's next_cursor
curl "https://app.aglyn.com/api/v1/datasets/ds_1/records?limit=50&cursor=c2VlZC0x" \
  -H "Authorization: Bearer aglyn_sk_…"
```

When `has_more` is `false`, `next_cursor` is `null` and you've reached the end.

Cursors are opaque — don't construct or parse them. A cursor we can't decode isn't an
error either: you'll get an empty or arbitrary page rather than a `400`, so check
`has_more` rather than assuming a non-empty page means you're paging correctly.

### Ordering

**Every list is ordered by record id, ascending — not by creation or update time.**

This is the single most surprising thing about the API, so plan for it:

- Paging start-to-finish gives you every item exactly once. That's what cursors
  guarantee, and it's what a full sync needs.
- Page 1 is **not** "the 25 newest". There is no `sort` or `order` param, and no
  filter on `created`/`updated`.
- To find recent changes, page everything and compare `updated` yourself. To keep a
  copy in sync, store the ids you've seen.

## Errors

Errors use a consistent envelope and standard HTTP status codes:

```json
{ "error": { "type": "not_found", "message": "No such dataset" } }
```

`type` is the stable, machine-readable field — branch on it, not on `message`. Some
errors add a `code` with the specific detail.

| Status | `type` | When |
| --- | --- | --- |
| `400` | `bad_request` | Failed validation (`code: "validation_failed"`). |
| `401` | `unauthorized` | Missing, malformed, revoked, or expired key. |
| `403` | `plan_required` | The organization's plan doesn't include API access. |
| `403` | `insufficient_scope` | The key lacks the required scope (`code` is the scope). |
| `404` | `not_found` | No such resource — or no such endpoint. |
| `405` | `method_not_allowed` | Method not supported on that path. |
| `429` | `rate_limited` | [Rate limit](rate-limits.md) exceeded. |

Two rough edges worth coding defensively around today:

- **A server-side failure is not guaranteed to use this envelope.** An unexpected
  error can surface as a plain `500` without the JSON body, so treat any `5xx` as
  retryable regardless of what it contains.
- **Some 404s are really "wrong method".** `POST /v1` and `POST /v1/me` return `404`
  rather than `405`, and methods outside GET/POST/PATCH/DELETE are rejected by the
  framework without a JSON body.

## Idempotency

`POST /v1/datasets/{datasetId}/records` accepts an **`Idempotency-Key`** header. Send
the same key to retry safely — if the original succeeded, the same record comes back
instead of a duplicate:

```bash
curl -X POST https://app.aglyn.com/api/v1/datasets/ds_1/records \
  -H "Authorization: Bearer aglyn_sk_…" \
  -H "Idempotency-Key: 2b9f1c4e-…" \
  -H "Content-Type: application/json" \
  -d '{"values":{"name":"Avery"}}'
```

- A fresh create returns **`201`**; a replay of a key we've already seen returns
  **`200`** with the original record. Use the status to tell them apart.
- Keys are scoped to your organization and **never expire**, so a key really is
  single-use forever. Use a UUID per logical operation.
- Replay is looked up **within the dataset you're posting to**. Reusing one key
  against a *different* dataset creates a second record rather than returning the
  first — so don't reuse keys across datasets.

Other methods don't take the header: `PATCH` and `DELETE` are already idempotent by
nature.
