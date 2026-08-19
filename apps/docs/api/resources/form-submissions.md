---
sidebar_position: 4
title: Form submissions
description: Read a site's form submissions, mark them read as you process them, and delete them after export.
---

# Form submissions

Every submission your site's [forms](/content-and-data/forms/overview) collect lands in
a site's inbox, and this resource is that inbox over the API: read submissions, record
which ones you've processed, and delete them once they're safely somewhere else.

Submissions live **under a site**, not under your organization — the paths all start
`/v1/sites/{siteId}/`. Listing your sites is [its own resource](sites.md).

## The form submission object

```json
{
  "id": "sub_1",
  "object": "form_submission",
  "form": "contact",
  "path": "/contact",
  "fields": { "email": "hi@example.com", "message": "Hello!" },
  "read": false,
  "created": "2026-07-20T18:23:23.950Z"
}
```

| Field | Type | Notes |
| --- | --- | --- |
| `id` | string | Submission id. Unique **within a site**, not across your organization. |
| `object` | string | Always `"form_submission"`. |
| `form` | string \| null | The form's name, as set in the Besigner. `null` on a submission that predates named forms. |
| `path` | string \| null | The page path the visitor submitted from. |
| `fields` | object | Exactly what the visitor typed, field name → value. **Not writable** — see [below](#read-is-the-only-writable-field). |
| `read` | boolean | Your processing flag. The console inbox toggles the same field. |
| `created` | string \| null | ISO 8601. |

## `read` is the only writable field {#read-is-the-only-writable-field}

A submission is a record of what a person typed on your site. If an integration could
edit `fields`, nothing in the inbox would be attributable to the visitor any more —
so `fields`, `form`, `path` and `created` are immutable over the API, and a `PATCH`
that names any of them is **rejected** rather than silently ignored.

`read` is different: it's not the visitor's data, it's yours. It's the flag the
console's inbox already toggles, and it's the one piece of state an integration needs
to be able to write.

## Why you want `read` {#why-read-matters}

Lists are [ordered by id, not by date](../conventions.md#ordering). That single fact
decides how you should write a sync:

- **Without `read`**, "which submissions are new?" has no answer from the API. You'd
  page the whole list every run and keep your own record of every id you'd handled —
  forever, since ids never age out of the list.
- **With `read`**, the state lives next to the submission. Page the list, handle
  anything with `read: false`, mark it, done. Two integrations can share one site
  without each keeping its own ledger.

```js
// Process everything unhandled, exactly once.
let cursor = null
do {
  const page = await get(`/v1/sites/${siteId}/form-submissions`, { cursor })
  for (const submission of page.data) {
    if (submission.read) continue
    await pushToCrm(submission)
    await patch(
      `/v1/sites/${siteId}/form-submissions/${submission.id}`,
      { read: true },
    )
  }
  cursor = page.next_cursor
} while (cursor)
```

Mark **after** the downstream write succeeds, not before. `PATCH` is safe to repeat
(see below), so a crash between the two means one duplicate downstream at worst — the
other order means a lead you never sent and never will.

## Endpoints

### List form submissions

`GET /v1/sites/{siteId}/form-submissions` — scope `forms:read` (**not** `sites:read`).
[Paginated](../conventions.md#pagination).

| Param | Notes |
| --- | --- |
| `form` | Filter to one form by exact name. Omit for every form on the site. |
| `limit`, `cursor` | [Standard pagination](../conventions.md#pagination). |

```bash
curl "https://app.aglyn.com/api/v1/sites/host_demo/form-submissions?form=contact" \
  -H "Authorization: Bearer aglyn_sk_…"
```

```json
{
  "object": "list",
  "data": [ /* form submission objects */ ],
  "next_cursor": null,
  "has_more": false
}
```

There is no `?read=` filter — filter the page yourself, as the loop above does.

### Retrieve a form submission

`GET /v1/sites/{siteId}/form-submissions/{submissionId}` — scope `forms:read`.

Returns a submission object, or `404 not_found` (`"No such form submission"`).

### Mark a submission read or unread

`PATCH /v1/sites/{siteId}/form-submissions/{submissionId}` — scope `forms:write`.

**Body**

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `read` | boolean | **yes** | `true` or `false`. A string like `"true"` is rejected, not coerced. |

```bash
curl -X PATCH \
  "https://app.aglyn.com/api/v1/sites/host_demo/form-submissions/sub_1" \
  -H "Authorization: Bearer aglyn_sk_…" \
  -H "Content-Type: application/json" \
  -d '{"read":true}'
```

Returns `200` with the updated submission.

**No `Idempotency-Key`, and none needed.** The same body twice lands the same state
*and* returns the same `200`, so retrying is free — which is exactly why it's safe to
mark *after* the downstream write.

Any other key in the body is a `400`:

```json
{
  "error": {
    "type": "bad_request",
    "message": "Only `read` can be changed on a form submission",
    "code": "validation_failed",
    "fields": { "fields": "Not writable on a form submission" }
  }
}
```

### Delete a form submission

`DELETE /v1/sites/{siteId}/form-submissions/{submissionId}` — scope `forms:write`.
Accepts an [`Idempotency-Key`](../conventions.md#deletes).

```json
{ "id": "sub_1", "object": "form_submission", "deleted": true }
```

This is the endpoint for a **purge after export**: archive the submissions somewhere
you control, then delete them here so the inbox reflects only live work.

Send a key whenever you retry. Without one, deleting a submission that's already gone
returns `404`, which is correct for a wrong id and misleading for a retry — and a
scheduled purge is the operation most likely to have its response lost to a timeout.
With a key, the retry replays the original receipt instead.

Keys are scoped **to the site**. Submission ids are unique within a site, not across
your organization, so one key can't carry a success from one site's purge onto
another's.

A submission that was never there still returns `404`, key or no key, and that `404`
**releases** the key so you can correct the id and retry with the same one.

:::note Deleting is permanent
There is no restore. The console inbox's own delete behaves the same way. If you need
the submission later, export it before you call this.
:::

## Errors

| Status | `type` | When |
| --- | --- | --- |
| `400` | `bad_request` | `code: "validation_failed"` — `read` missing or not a boolean, or the body names a field that isn't writable. |
| `403` | `insufficient_scope` | Key lacks `forms:read` (reads) or `forms:write` (mark/delete). |
| `404` | `not_found` | `"No such site"` — unknown or unowned site. `"No such form submission"` — unknown submission id. |
| `405` | `method_not_allowed` | The `Allow` header lists what is supported: `GET` on the collection, `GET, PATCH, DELETE` on one submission. |
| `409` | `conflict` | `code: "idempotency_in_progress"` — an earlier delete with the same key is still running. |

See [Conventions → Errors](../conventions.md#errors) for the shared envelope.

## Related

- [Forms & lead capture](/content-and-data/forms/overview) — building the form, the
  inbox, spam protection, and per-plan submission allowances.
- [Sites](sites.md) — listing the sites these submissions belong to.
- [Conventions](../conventions.md) — pagination, ordering, idempotency, errors.
