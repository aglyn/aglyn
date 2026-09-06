---
sidebar_position: 9
title: Pipelines
description: Read the stages a deal moves through over the REST API.
---

# Pipelines

The stages a [deal](deals.md) moves through, in order, each with the probability a
forecast weights an open deal by. Read-only: a pipeline is how one business sells,
and its stages are named by the people who sell that way in the console. The API
reads them so a deal can be created in the right one and moved to the right stage;
it never edits them.

Scopes and the site rule are shared with every CRM resource — see
[companies](companies.md#scopes-and-sites).

## The pipeline object

```json
{
  "id": "p_7b2e",
  "object": "pipeline",
  "name": "Sales",
  "isDefault": true,
  "archived": false,
  "archivedAt": null,
  "stages": [
    { "id": "qualified", "name": "Qualified", "order": 0, "probability": 10, "kind": "open" },
    { "id": "contact-made", "name": "Contact made", "order": 1, "probability": 20, "kind": "open" },
    { "id": "proposal-sent", "name": "Proposal sent", "order": 2, "probability": 40, "kind": "open" },
    { "id": "negotiation", "name": "Negotiation", "order": 3, "probability": 60, "kind": "open" },
    { "id": "won", "name": "Won", "order": 4, "probability": 100, "kind": "won" },
    { "id": "lost", "name": "Lost", "order": 5, "probability": 0, "kind": "lost" }
  ],
  "siteId": "site_a1b2c3",
  "created": "2026-09-05T18:23:23.941Z",
  "updated": "2026-09-05T18:23:23.941Z"
}
```

| Field | Type | Notes |
| --- | --- | --- |
| `id` | string | Opaque pipeline id. Pass it as a deal's `pipelineId`. |
| `object` | string | Always `"pipeline"`. |
| `name` | string | As named in the console. |
| `isDefault` | boolean | The pipeline a new deal lands in when its create names none. Only an active pipeline is ever the default. |
| `archived` | boolean | Whether the pipeline has been retired in the console — see [below](#archived). |
| `archivedAt` | string \| null | ISO 8601, when it was; `null` while active. |
| `stages` | array | In pipeline order. Each has `id` (pass it as a deal's `stageId`), `name`, `order`, `probability` (0–100, the odds of an **open** deal closing from here) and `kind` — `open`, `won` or `lost`. A pipeline has one `won` and one `lost` stage; `open` is everything between. |
| `siteId` | string | The site the pipeline was created from. |
| `created` / `updated` | string \| null | ISO 8601. |

### A pipeline is seeded by the first deal {#seeding}

An organization that has never opened the CRM has no pipeline, and a deal cannot exist
without a stage. So the first [`POST /v1/deals`](deals.md#add-a-deal) that names no
`pipelineId` creates one — named **Sales**, with the six stages above, marked as the
default, and stored for the site the deal names. Every later deal from a site that can
see it lands in it. You never have to create a pipeline before creating a deal, and
`GET /v1/pipelines` on a fresh organization legitimately returns an empty list.

### An archived pipeline takes no new deal {#archived}

A pipeline the console has **archived** is still listed and still retrievable:
the deals it closed name it, and a client resolving their `stageId` needs its
`stages`. But a [`POST /v1/deals`](deals.md#add-a-deal) that names it is a
`400` naming `pipelineId`, and a create that names no pipeline lands in the
default among the **active** ones. A deal already in an archived pipeline can
still be [moved](deals.md#moving) — reopened, won, lost — because its stages
resolve.

## Endpoints

### List pipelines

`GET /v1/pipelines` — scope `crm:read`. [Paginated](../conventions.md#pagination),
ordered by id; `?updatedAfter=` works as on every [CRM list](../conventions.md#updated-after).

```bash
curl "https://app.aglyn.com/api/v1/pipelines" \
  -H "Authorization: Bearer aglyn_sk_…"
```

Read this once and cache it: stage ids are stable, and a deal's `stageId` is only
meaningful against its pipeline's `stages`.

### Retrieve a pipeline

`GET /v1/pipelines/{pipelineId}` — scope `crm:read`. Returns a pipeline, or
`404 not_found` (`"No such pipeline"`).

## Errors

| Status | `type` | When |
| --- | --- | --- |
| `403` | `insufficient_scope` | Key lacks `crm:read`. Checked before the method, so a `POST` with a read-less key is a `403`, not a `405`. |
| `404` | `not_found` | `"No such pipeline"`. |
| `405` | `method_not_allowed` | Anything other than `GET`. The `Allow` header says `GET` — there is deliberately no write scope for a pipeline's stages, which are edited in the console where the people who sell can see what a rename does to their reports. |

See [Conventions → Errors](../conventions.md#errors) for the shared envelope.

## Related

- [Deals](deals.md) — created in a pipeline and moved through its stages.
