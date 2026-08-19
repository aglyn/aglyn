---
sidebar_position: 1
title: Datasets & records
description: Create, read, update, and delete datasets and their records over the REST API.
---

# Datasets & records

[Datasets](/content-and-data/datasets/overview) are typed collections of records
shared across your organization. The API fully manages both the dataset and the
records inside it, so an integration can provision a workspace from nothing — no
console visit required before your first call.

## The dataset object

```json
{
  "id": "ds_team",
  "object": "dataset",
  "name": "Team",
  "fields": ["name", "role", "photo"],
  "created": "2026-07-20T18:23:23.927Z"
}
```

| Field | Type | Notes |
| --- | --- | --- |
| `id` | string | Dataset id. |
| `object` | string | Always `"dataset"`. |
| `name` | string | Display name; `""` if unset. |
| `fields` | string[] | Field ids in the dataset's model. |
| `created` | string \| null | ISO 8601. |

The full field model (types, limits, required flags) isn't returned by the API — read
it in the console's model builder. You *can* send one on write (see
[`model`](#the-model-argument)); the API just doesn't echo it back.

### Where a new dataset is visible {#dataset-visibility}

A dataset created over the API is shared with **the whole organization**, so every
site can bind to it. That is not configurable here, and it isn't the console's
behavior either: the console offers a site picker because a site is on screen, and an
API key is an organization credential with no site in context. If you need a dataset
scoped to one site, create it in the console — or create it here and narrow it there.

This matters more than it looks. A dataset stored with no scope at all is visible to
**no** site, so it would render nowhere while the API cheerfully answered `201`.
Organization-wide is the only answer that is always readable.

## The record object

```json
{
  "id": "k3f9a1c7be",
  "object": "record",
  "values": { "name": "Avery Quinn", "role": "Head Baker" },
  "created": "2026-07-20T18:23:23.930Z",
  "updated": "2026-07-20T18:23:23.930Z"
}
```

Record ids are opaque 10-character strings with no prefix — don't pattern-match them.

### Values and types

`values` is a map of field id → value, holding only fields defined in the dataset's
model. A few behaviors matter when writing:

- **Unknown fields are silently dropped, not rejected.** A typo in a field id means
  that value never lands, and you get a `201`. Verify against `fields` on the dataset
  if you're generating payloads.
- **Strings are coerced to the field's type.** `"42"` into an integer field works,
  `"true"` into a boolean works, and a date string into a timestamp field is parsed.
- **Timestamps come back as epoch milliseconds** inside `values`, not ISO strings.
  The top-level `created`/`updated` are ISO — the two differ, deliberately.
- **Coordinates** accept `"lat,lng"` strings or `{lat, lng}` objects, bounded to
  ±90 / ±180.

## Endpoints

### List datasets

`GET /v1/datasets` — scope `datasets:read`. [Paginated](../conventions.md#pagination).

```bash
curl "https://app.aglyn.com/api/v1/datasets" \
  -H "Authorization: Bearer aglyn_sk_…"
```

### Retrieve a dataset

`GET /v1/datasets/{datasetId}` — scope `datasets:read`.

Returns a dataset object, or `404 not_found` (`"No such dataset"`).

### Create a dataset

`POST /v1/datasets` — scope `datasets:write`. Accepts an
[`Idempotency-Key`](../conventions.md#idempotency).

**Body**

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `name` | string | **yes** | Display name. Trimmed, truncated to 120 characters. |
| `fields` | string[] | **yes** | Field ids. Blanks are dropped; at most 100 are kept. An empty result is a validation error, not an empty dataset. |
| `model` | object | no | The typed field model. See [below](#the-model-argument). |

```bash
curl -X POST "https://app.aglyn.com/api/v1/datasets" \
  -H "Authorization: Bearer aglyn_sk_…" \
  -H "Idempotency-Key: 9a41f0c2-…" \
  -H "Content-Type: application/json" \
  -d '{"name":"Team","fields":["name","role","photo"]}'
```

Returns **`201`** with the created dataset — or **`200`** with the original dataset
when an `Idempotency-Key` replays. Same rule as records: the status is how you tell
a fresh create from a replay.

#### The `model` argument {#the-model-argument}

`fields` gives you a dataset whose values are untyped. `model` is the optional typed
schema behind them — the thing the console's model builder edits — and it's what
turns on validation, coercion, and reference resolution for
[record writes](#create-a-record).

It is passed through as sent, and only two things are checked: that it is an object,
and that it serializes to under **64 KB** (a real model is far smaller; hundreds of
typed fields fit). The API does not validate its internal shape and does not return
it. Build one in the console first and copy it, rather than composing one blind.

#### Plan gates

Two different `403 plan_required` answers, told apart by `code`:

| `code` | Means |
| --- | --- |
| `data_store` | The organization's plan doesn't include datasets at all. |
| `dataset_quota` | The plan includes datasets, but every included slot is used. The message names the limit and, when extra datasets are purchasable on this plan, their monthly price. |

**Neither consumes an `Idempotency-Key`.** Both refusals clear when someone buys an
add-on or upgrades, and a retry with the same key has to be able to succeed then —
so the key is released, exactly as a validation `400` releases it.

### Update a dataset

`PATCH /v1/datasets/{datasetId}` — scope `datasets:write`. Takes no
`Idempotency-Key` and doesn't need one: the same body twice lands the same state
*and* returns the same `200`.

Send only what changes. `name`, `fields`, and `model` are each independent:

```bash
curl -X PATCH "https://app.aglyn.com/api/v1/datasets/ds_team" \
  -H "Authorization: Bearer aglyn_sk_…" \
  -H "Content-Type: application/json" \
  -d '{"name":"Bakery team"}'
```

- **An omitted key is left alone, never cleared.** A body of `{}` is a no-op that
  returns the current dataset. This is deliberate: treating "absent" as "empty" would
  let a typo'd request body take a dataset's schema away and answer `200`.
- **`fields` is replaced wholesale**, not merged — send the full list.
- An explicitly empty `fields: []` is a `400`, not a way to clear the schema.
- `404 not_found` (`"No such dataset"`) if it isn't there.

### Delete a dataset

`DELETE /v1/datasets/{datasetId}` — scope `datasets:write`. Accepts an
[`Idempotency-Key`](../conventions.md#deletes).

```json
{ "id": "ds_team", "object": "dataset", "deleted": true }
```

**A dataset holding records is refused, not emptied.** You get `409 conflict` with
`code: "dataset_not_empty"` and the count in the message; delete the records first.
One mistyped id should not be able to take a customer's content with it, and a
cascade behind a single REST call gives you no receipt naming what went.

That refusal **releases the key** — it clears once the records are gone, and the
retry that should then succeed must not replay the refusal instead. A genuinely
missing dataset still answers `404`, key or no key, for the reason
[deletes](../conventions.md#deletes) gives: a success for a typo'd id takes away the
only signal that you're pointed at the wrong thing.

### List records

`GET /v1/datasets/{datasetId}/records` — scope `datasets:read`.
[Paginated](../conventions.md#pagination), ordered by record id — see
[ordering](../conventions.md#ordering), because it is *not* newest-first.

```bash
curl "https://app.aglyn.com/api/v1/datasets/ds_team/records?limit=50" \
  -H "Authorization: Bearer aglyn_sk_…"
```

There are no filter parameters — no querying by field value. Filter client-side, or
model the distinction as a separate dataset.

### Retrieve a record

`GET /v1/datasets/{datasetId}/records/{recordId}` — scope `datasets:read`.

Returns a record object, or `404 not_found` (`"No such record"`).

### Create a record

`POST /v1/datasets/{datasetId}/records` — scope `datasets:write`. Accepts an
[`Idempotency-Key`](../conventions.md#idempotency).

**Body**

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `values` | object | no | Field id → value. Omitted or `{}` creates an empty record, subject to the model's `required` fields. |

```bash
curl -X POST "https://app.aglyn.com/api/v1/datasets/ds_team/records" \
  -H "Authorization: Bearer aglyn_sk_…" \
  -H "Content-Type: application/json" \
  -d '{"values":{"name":"Sam Rivera","role":"Pastry Chef"}}'
```

Returns **`201`** with the created record — or **`200`** with the original record when
an `Idempotency-Key` replays.

:::warning A malformed body doesn't fail loudly
Invalid JSON is treated as an empty body rather than returning `400`, so a broken
payload produces either an empty record or a confusing "required field" error. Send
valid JSON with `Content-Type: application/json`.
:::

### Update a record

`PATCH /v1/datasets/{datasetId}/records/{recordId}` — scope `datasets:write`. Merges
the supplied `values` over the stored ones, so send only what changes.

```bash
curl -X PATCH "https://app.aglyn.com/api/v1/datasets/ds_team/records/k3f9a1c7be" \
  -H "Authorization: Bearer aglyn_sk_…" \
  -H "Content-Type: application/json" \
  -d '{"values":{"role":"Lead Baker"}}'
```

Returns `200` with the updated record. Two limits to know:

- The merge is **shallow**. A `map` field is replaced wholesale, not deep-merged.
- There is currently **no way to clear a field** — sending `null` or `""` drops the
  key rather than unsetting the stored value.

### Delete a record

`DELETE /v1/datasets/{datasetId}/records/{recordId}` — scope `datasets:write`. Accepts
an [`Idempotency-Key`](../conventions.md#deletes).

Returns `200` (not `204`):

```json
{ "id": "k3f9a1c7be", "object": "record", "deleted": true }
```

Deleting a record that isn't there returns `404 not_found` (`"No such record"`) —
**unless** the call carries the `Idempotency-Key` of the delete that removed it, in
which case the original `200` receipt is replayed. Send a key whenever you retry, so
a response lost to a timeout doesn't come back as a `404` you'd read as a failure.

## Validation

Writes are validated against the dataset's model: required fields, text length and
pattern, numeric ranges, enum options, and reference targets. Any failure returns a
single `400`:

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

`fields` maps each failing field id to its reason — see
[validation errors](../conventions.md#validation-errors).

Plan quotas — records per dataset, dataset storage — are **not** enforced on this
path, so a bulk import through the API can carry an organization past its included
storage and into [metered overage](../rate-limits.md#monthly-quota--overage).

## Errors

| Status | `type` | When |
| --- | --- | --- |
| `400` | `bad_request` | `code: "validation_failed"` — the record doesn't satisfy the model, or the dataset body is missing `name`/`fields` or carries an oversized `model`. |
| `403` | `plan_required` | `code: "data_store"` — the plan doesn't include datasets. `code: "dataset_quota"` — every included dataset slot is used. |
| `403` | `insufficient_scope` | Key lacks `datasets:read` / `datasets:write`. |
| `404` | `not_found` | `"No such dataset"` or `"No such record"`. |
| `405` | `method_not_allowed` | Method not supported on that path. The `Allow` header lists what is: `GET, POST` on `/v1/datasets`, `GET, PATCH, DELETE` on one dataset. |
| `409` | `conflict` | `code: "idempotency_in_progress"` — an earlier write with the same key is still running. `code: "dataset_not_empty"` — the dataset still holds records. |

See [Conventions → Errors](../conventions.md#errors) for the shared envelope.
