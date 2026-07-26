---
sidebar_position: 1
title: Datasets & records
description: List datasets and create, read, update, and delete their records over the REST API.
---

# Datasets & records

[Datasets](/content-and-data/datasets/overview) are typed collections of records
shared across your organization. The API lets you read datasets and fully manage
their records.

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

The full field model (types, limits, required flags) isn't exposed over the API — read
it in the console's model builder.

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

`DELETE /v1/datasets/{datasetId}/records/{recordId}` — scope `datasets:write`.

Returns `200` (not `204`):

```json
{ "id": "k3f9a1c7be", "object": "record", "deleted": true }
```

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
| `400` | `bad_request` | `code: "validation_failed"` — the record doesn't satisfy the model. |
| `403` | `insufficient_scope` | Key lacks `datasets:read` / `datasets:write`. |
| `404` | `not_found` | `"No such dataset"` or `"No such record"`. |
| `405` | `method_not_allowed` | Method not supported on that path. |

See [Conventions → Errors](../conventions.md#errors) for the shared envelope.
