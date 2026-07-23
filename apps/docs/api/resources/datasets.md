---
sidebar_position: 1
title: Datasets & records
description: List datasets and create, read, update, and delete their records over the REST API.
---

# Datasets & records

[Datasets](/content-and-data/datasets/overview) are typed collections of
records shared across your organization. The API lets you read datasets and
fully manage their records.

Record `values` are validated against the dataset's model — an unknown or
wrong-typed field returns `400` with `code: "validation_failed"`.

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

## The record object

```json
{
  "id": "rec_abc123",
  "object": "record",
  "values": { "name": "Avery Quinn", "role": "Head Baker" },
  "created": "2026-07-20T18:23:23.930Z",
  "updated": "2026-07-20T18:23:23.930Z"
}
```

## Endpoints

### List datasets

`GET /v1/datasets` — scope `datasets:read`. [Paginated](../conventions.md#pagination).

```bash
curl "https://app.aglyn.com/api/v1/datasets" \
  -H "Authorization: Bearer aglyn_sk_…"
```

### Retrieve a dataset

`GET /v1/datasets/{id}` — scope `datasets:read`.

### List records

`GET /v1/datasets/{id}/records` — scope `datasets:read`. [Paginated](../conventions.md#pagination).

```bash
curl "https://app.aglyn.com/api/v1/datasets/ds_team/records?limit=50" \
  -H "Authorization: Bearer aglyn_sk_…"
```

### Retrieve a record

`GET /v1/datasets/{id}/records/{recordId}` — scope `datasets:read`.

### Create a record

`POST /v1/datasets/{id}/records` — scope `datasets:write`. Accepts an
[`Idempotency-Key`](../conventions.md#idempotency). Returns `201`.

```bash
curl -X POST "https://app.aglyn.com/api/v1/datasets/ds_team/records" \
  -H "Authorization: Bearer aglyn_sk_…" \
  -H "Content-Type: application/json" \
  -d '{"values":{"name":"Sam Rivera","role":"Pastry Chef"}}'
```

### Update a record

`PATCH /v1/datasets/{id}/records/{recordId}` — scope `datasets:write`. Merges
the supplied `values` over the stored ones (send only what changes).

```bash
curl -X PATCH "https://app.aglyn.com/api/v1/datasets/ds_team/records/rec_abc123" \
  -H "Authorization: Bearer aglyn_sk_…" \
  -H "Content-Type: application/json" \
  -d '{"values":{"role":"Lead Baker"}}'
```

### Delete a record

`DELETE /v1/datasets/{id}/records/{recordId}` — scope `datasets:write`.

```json
{ "id": "rec_abc123", "object": "record", "deleted": true }
```
