---
sidebar_position: 10
title: Deals
description: Read, add, move and close deals — the opportunities in your sales pipeline — over the REST API.
---

# Deals

An opportunity — a titled, valued thing a [contact](contacts.md) or a
[company](companies.md) might buy — moving through the stages of a
[pipeline](pipelines.md) until it is won or lost.

Scopes and the site rule are shared with every CRM resource — see
[companies](companies.md#scopes-and-sites).

## The deal object

```json
{
  "id": "d_3c9a",
  "object": "deal",
  "title": "Wholesale beans — Q4",
  "pipelineId": "p_7b2e",
  "stageId": "proposal-sent",
  "status": "open",
  "amountCents": 250000,
  "currency": "usd",
  "expectedCloseAt": "2026-12-31T00:00:00.000Z",
  "closedAt": null,
  "stageChangedAt": "2026-09-05T18:23:23.941Z",
  "ownerUid": "u_9f1c",
  "contactId": "k7d2b9f104",
  "companyId": "c_1a2b",
  "lostReason": null,
  "notes": null,
  "siteId": "site_a1b2c3",
  "created": "2026-09-01T09:00:00.000Z",
  "updated": "2026-09-05T18:23:23.941Z"
}
```

| Field | Type | Notes |
| --- | --- | --- |
| `id` | string | Opaque deal id. |
| `object` | string | Always `"deal"`. |
| `title` | string | Required. Trimmed, truncated to 200 characters. Writable. |
| `pipelineId` | string | The [pipeline](pipelines.md) the deal is in. Writable **on create only**: a deal's stages are its pipeline's, and moving one between pipelines is a new deal in the other pipeline, not an edit. Omit it to use the default pipeline — [seeding one](pipelines.md#seeding) if the organization has none. |
| `stageId` | string | The stage the deal is in, one of its pipeline's `stages[].id`. Writable — see [moving a deal](#moving). |
| `status` | string | `open`, `won` or `lost`. Follows the stage's `kind`, so the two can never disagree on a stored deal. Writable — see [moving a deal](#moving). |
| `amountCents` | integer \| null | The value, in the currency's minor unit. A whole number, `0` or more. Writable. |
| `currency` | string | Three-letter ISO 4217 code, lowercase. `usd` when never set. Writable; `USD` is stored as `usd`. |
| `expectedCloseAt` | string \| null | ISO 8601 instant. Writable. |
| `closedAt` | string \| null | When the deal was won or lost. Set by a move into a closed stage and cleared by a move back to an open one. **Read-only.** |
| `stageChangedAt` | string \| null | When the deal last moved — what "stuck in stage" reports read. **Read-only.** |
| `ownerUid` | string \| null | The member responsible. Must be a member of your organization. Writable. |
| `contactId` | string \| null | The [contact](contacts.md) the deal is with. Must exist. Writable. |
| `companyId` | string \| null | The [company](companies.md) the deal is with. Must exist. Writable. |
| `lostReason` | string \| null | Free text, 5,000 characters. Writable. |
| `notes` | string \| null | Free text, 5,000 characters. Writable. |
| `siteId` | string | The site the deal was created from. **Read-only.** |
| `created` / `updated` | string \| null | ISO 8601. |

## Endpoints

### List deals

`GET /v1/deals` — scope `crm:read`. [Paginated](../conventions.md#pagination),
ordered by deal id unless `updatedAfter` is given.

| Param | Notes |
| --- | --- |
| `contactId` | Deals with this contact. |
| `companyId` | Deals with this company. |
| `pipelineId` | Deals in this pipeline. |
| `ownerUid` | Deals owned by this member. |
| `status` | `open`, `won` or `lost`. Anything else is a `400` — `?status=closed` matching nothing would be a plausible page, and a plausible page is the one you don't check. |
| `updatedAfter` | Deals updated after this instant, oldest change first — the [sync filter](../conventions.md#updated-after). |
| `limit`, `cursor` | [Standard pagination](../conventions.md#pagination). |

```bash
# everything open for one account
curl "https://app.aglyn.com/api/v1/deals?companyId=c_1a2b&status=open" \
  -H "Authorization: Bearer aglyn_sk_…"
```

Only **one** filter narrows the query itself — in the order listed, so an id before a
status — and the rest are checked on the page. A combined filter can therefore
return a [short page](../conventions.md#short-pages).

### Retrieve a deal

`GET /v1/deals/{dealId}` — scope `crm:read`. Returns a deal, or `404 not_found`
(`"No such deal"`).

### Add a deal

`POST /v1/deals` — scope `crm:write`. Accepts an
[`Idempotency-Key`](../conventions.md#idempotency), scoped to the organization.

**Body** — `title` and `consentSiteId` are required. `pipelineId` picks the pipeline;
`stageId` and/or `status` place the deal in it (see [below](#moving)); neither means
the first open stage of the pipeline.

```bash
curl -X POST "https://app.aglyn.com/api/v1/deals" \
  -H "Authorization: Bearer aglyn_sk_…" \
  -H "Idempotency-Key: 9a41f0c2-…" \
  -H "Content-Type: application/json" \
  -d '{"title":"Wholesale beans — Q4","amountCents":250000,"currency":"usd","contactId":"k7d2b9f104","companyId":"c_1a2b","ownerUid":"u_9f1c","consentSiteId":"site_a1b2c3"}'
```

Returns **`201`** with the created deal, or **`200`** with the original when an
`Idempotency-Key` replays.

### Update a deal

`PATCH /v1/deals/{dealId}` — scope `crm:write`. Takes no `Idempotency-Key`. Send only
what changes; an omitted key is left alone, an explicit `null` clears an optional
field, and `{}` is a no-op.

#### Moving a deal {#moving}

A deal moves by `stageId`, by `status`, or by both:

- **`stageId`** picks a stage, and `status` follows the stage's `kind`. Moving to the
  pipeline's `won` stage marks the deal won.
- **`status`** alone picks the pipeline's one `won` or `lost` stage — or, for `open`,
  its **first** open stage. A reopened deal has to land somewhere, and the top of the
  pipeline is the only somewhere that needs no second field.
- **Both together must agree.** `{"stageId":"won","status":"open"}` is a `400` naming
  `status` (`"Must match the stage, which is won"`) rather than a guess in favor of
  either, because whichever one we picked would be the one you did not mean.

Every move stamps `stageChangedAt`. A move into a `won` or `lost` stage sets
`closedAt`; a move back to an open stage clears it.

```bash
curl -X PATCH "https://app.aglyn.com/api/v1/deals/d_3c9a" \
  -H "Authorization: Bearer aglyn_sk_…" \
  -H "Content-Type: application/json" \
  -d '{"status":"won","amountCents":262500}'
```

### Delete a deal

`DELETE /v1/deals/{dealId}` — scope `crm:write`. Accepts an
[`Idempotency-Key`](../conventions.md#deletes), scoped to the organization.

```json
{ "id": "d_3c9a", "object": "deal", "deleted": true }
```

The deal alone is removed; its tasks and activities keep their `dealId`. A missing
deal is `404 not_found`, unless the call carries the key of the delete that removed
it.

## Errors

| Status | `type` | When |
| --- | --- | --- |
| `400` | `bad_request` | `code: "validation_failed"` — a missing `title` or `consentSiteId`, a `pipelineId` or `stageId` that does not exist, a `status` that disagrees with the `stageId`, an `amountCents` that is not a whole number `0` or more, a `currency` that is not a three-letter code, an `expectedCloseAt` that is not an ISO 8601 instant, a `contactId` or `companyId` that does not exist, an `ownerUid` who is not a member, or `pipelineId` on a `PATCH`. On the list, a `?status=` outside the three values or a malformed `?updatedAfter=`. `fields` names each key. |
| `403` | `insufficient_scope` | Key lacks `crm:read` / `crm:write`. |
| `404` | `not_found` | `"No such deal"`. |
| `405` | `method_not_allowed` | `Allow`: `GET, POST` on `/v1/deals`, `GET, PATCH, DELETE` on one deal. |
| `409` | `conflict` | `code: "idempotency_in_progress"`. |

See [Conventions → Errors](../conventions.md#errors) for the shared envelope.

## Related

- [Pipelines](pipelines.md) — the stages a deal's `stageId` names.
- [Tasks](tasks.md) and [activities](activities.md) — the work and the history
  against a deal, each filterable by `dealId`.
