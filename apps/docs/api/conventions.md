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

### A page can be shorter than `limit` {#short-pages}

**`data.length < limit` never means you've reached the end.** Only
`has_more === false` means that.

Some endpoints filter rows out after reading a page — deleted
[products](resources/products.md) and [media](resources/media.md) are dropped that
way, and so is `?channel=online` on [orders](resources/orders.md), which has to match
older rows that carry no channel field at all. A page of 100 can therefore come back
with 60 rows and `has_more: true`.

The loop that gets this right is the one that stops on the cursor, not on the count:

```js
let cursor = null
do {
  const page = await fetchPage(cursor)
  handle(page.data)          // may be short, may even be empty
  cursor = page.next_cursor  // the ONLY termination signal
} while (cursor)
```

A loop written as `while (page.data.length === limit)` will silently stop early on
these endpoints, and it will look like it worked.

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
| `403` | `plan_required` | The organization's plan doesn't include API access — or, on a commerce resource, doesn't include commerce (`code: "commerce"`). |
| `403` | `insufficient_scope` | The key lacks the required scope (`code` is the scope). |
| `404` | `not_found` | No such resource — or no such endpoint. |
| `405` | `method_not_allowed` | Method not supported on that path; the `Allow` header lists what is. |
| `409` | `conflict` | An earlier request with the same [`Idempotency-Key`](#idempotency) is still running (`code: "idempotency_in_progress"`). |
| `429` | `rate_limited` | [Rate limit](rate-limits.md) exceeded. |
| `500` | `internal_error` | Something went wrong on our side. Safe to retry. |

### Validation errors

A `validation_failed` response names the fields that failed, so you don't have to
bisect a payload:

```json
{
  "error": {
    "type": "bad_request",
    "message": "Record failed validation",
    "code": "validation_failed",
    "fields": {
      "email": "Required",
      "headcount": "Must be a whole number"
    }
  }
}
```

`fields` is present only on validation failures — treat it as optional.

### Two different `plan_required` failures {#plan-required}

`plan_required` answers two distinct questions, and `code` is what tells them apart:

| `code` | Means | What fixes it |
| --- | --- | --- |
| *absent* | The organization's plan doesn't include **API access** at all. Every endpoint answers this. | Move to a plan with the API. |
| `"commerce"` | The API works, but the plan no longer includes **commerce**, so [orders](resources/orders.md) and [products](resources/products.md) are closed. Every other resource keeps working. | Restore a plan with commerce. |

Branch on `code`, not on the message. An integration that retries a plan failure
forever is the failure mode here — neither is transient, so back off and alert
a human instead.

We answer `plan_required` rather than `404` for the commerce case on purpose. Hiding a
store that plainly exists behind a "no such thing" sends an integrator hunting a wrong
site id for an hour; naming the plan is the answer they can act on.

## Idempotency

`POST` and `DELETE` on `/v1/datasets/{datasetId}/records` accept an
**`Idempotency-Key`** header. Send the same key to retry safely — if the original
succeeded, the same response comes back instead of a duplicate or a `404`:

```bash
curl -X POST https://app.aglyn.com/api/v1/datasets/ds_1/records \
  -H "Authorization: Bearer aglyn_sk_…" \
  -H "Idempotency-Key: 2b9f1c4e-…" \
  -H "Content-Type: application/json" \
  -d '{"values":{"name":"Avery"}}'
```

- A fresh create returns **`201`**; a replay of a key we've already seen returns
  **`200`** with the original record. Use the status to tell them apart.
- Keys are scoped to the **dataset you post to** and to the **operation**, and
  **never expire** — a key really is single-use forever. Use a UUID per logical
  operation, and don't reuse one key across datasets: the second dataset treats it as
  a separate operation and creates its own record. Reusing one key for a create *and*
  a delete is likewise two separate operations, so a delete never replays a create's
  record.
- The replay is the **original response**, replayed verbatim. It keeps working after
  the record has been edited or deleted — a retry never re-creates a record you have
  since removed.
- If a request with the same key is **still in flight**, the second one is refused
  with a `409 conflict` (`code: "idempotency_in_progress"`) rather than served. That
  refusal is deliberate: letting it through is exactly the duplicate the key exists
  to prevent. Retry once the first request has answered.
- A request that **fails** releases its key, so you can fix the cause and retry with
  the same one. A `400` never consumes a key at all.

### Deletes

`DELETE` changes the same state twice over, but it doesn't answer the same way twice.
Without a key, deleting a record that's already gone returns `404 not_found` — which
is correct for a wrong id and misleading for a retry, because you can't tell the two
apart. Send a key and the retry replays the original receipt instead:

```bash
curl -X DELETE https://app.aglyn.com/api/v1/datasets/ds_1/records/k3f9a1c7be \
  -H "Authorization: Bearer aglyn_sk_…" \
  -H "Idempotency-Key: 7c1e0a92-…"
```

```json
{ "id": "k3f9a1c7be", "object": "record", "deleted": true }
```

- The **first** call deletes and returns `200`. A retry **with the same key** returns
  the same `200` body, whether or not the record still exists — so a response lost to
  a timeout is safe to re-send.
- A record that was **never there** still returns `404 not_found`, even with a key.
  That's deliberate: a `204`-for-everything would hand you a success for a typo'd id
  and take away the only signal that you're asking about the wrong record.
- A `404` **releases** the key, so you can correct the id and retry with the same one.

`PATCH` doesn't take the header and doesn't need it. It merges the supplied `values`
over the stored ones, so the same body twice lands the same state *and* returns the
same `200` record — idempotent in the response as well as the state. It answers `404`
for a missing record, and that stays the right answer.
