---
sidebar_position: 12
title: Activities
description: Log and read what happened with a contact, company or deal — calls, emails, meetings and notes — over the REST API.
---

# Activities

One thing that happened, logged by a person or by an integration: a call made, a
meeting held, a note taken. An activity hangs off a [contact](contacts.md), a
[company](companies.md) or a [deal](deals.md) — at least one — because an activity
attached to nothing is a sentence nobody can find from anywhere.

An activity is a **log entry, and a log is written once.** There is no `PATCH`: an
entry that turns out to be wrong is deleted and logged again, which keeps every row's
`at` and `byUid` the record of what was logged rather than what somebody later wished
had been.

Scopes and the site rule are shared with every CRM resource — see
[companies](companies.md#scopes-and-sites).

## The activity object

```json
{
  "id": "a_8f21",
  "object": "activity",
  "kind": "call",
  "body": "Walked through the proposal. They want the Q4 volume tier.",
  "at": "2026-09-05T16:30:00.000Z",
  "byUid": "u_9f1c",
  "contactId": "k7d2b9f104",
  "companyId": null,
  "dealId": "d_3c9a",
  "outcome": "Interested",
  "durationMinutes": 25,
  "siteId": "site_a1b2c3",
  "created": "2026-09-05T18:23:23.941Z",
  "updated": "2026-09-05T18:23:23.941Z"
}
```

| Field | Type | Notes |
| --- | --- | --- |
| `id` | string | Opaque activity id. |
| `object` | string | Always `"activity"`. |
| `kind` | string | `call`, `email`, `meeting`, `note` or `other`. `note` when not sent. |
| `body` | string | Required. What happened, 5,000 characters. |
| `at` | string | When it happened — which is not when it was logged. ISO 8601 instant; defaults to the moment of the request, for the integration logging a call as it ends. |
| `byUid` | string | Who did it. Must be a member of your organization; `"api"` when not sent. |
| `contactId`, `companyId`, `dealId` | string \| null | What it is about. **At least one is required**, and each must exist. |
| `outcome` | string \| null | A short label, 120 characters. |
| `durationMinutes` | integer \| null | A whole number, `0` or more. |
| `siteId` | string | The site the activity was logged from. **Read-only.** |
| `created` / `updated` | string \| null | ISO 8601. |

## Endpoints

### List activities

`GET /v1/activities` — scope `crm:read`. [Paginated](../conventions.md#pagination),
ordered by activity id unless `updatedAfter` is given.

| Param | Notes |
| --- | --- |
| `dealId`, `contactId`, `companyId` | Activities about that record. |
| `kind` | One of the five kinds. Anything else is a `400`. |
| `updatedAfter` | Activities updated after this instant — the [sync filter](../conventions.md#updated-after). An activity is written once, so this is when it was logged. |
| `limit`, `cursor` | [Standard pagination](../conventions.md#pagination). |

```bash
# the history of one deal
curl "https://app.aglyn.com/api/v1/activities?dealId=d_3c9a" \
  -H "Authorization: Bearer aglyn_sk_…"
```

One filter narrows the query — `dealId`, then `contactId`, `companyId`, `kind` — and
the rest are checked on the page, which can come back
[short](../conventions.md#short-pages).

### Retrieve an activity

`GET /v1/activities/{activityId}` — scope `crm:read`. Returns an activity, or
`404 not_found` (`"No such activity"`).

### Log an activity

`POST /v1/activities` — scope `crm:write`. Accepts an
[`Idempotency-Key`](../conventions.md#idempotency), scoped to the organization —
send one from a dialer or a mail integration, where a retry after a lost response
would otherwise log the call twice. `body`, `consentSiteId` and at least one of
`contactId`, `companyId`, `dealId` are required.

```bash
curl -X POST "https://app.aglyn.com/api/v1/activities" \
  -H "Authorization: Bearer aglyn_sk_…" \
  -H "Idempotency-Key: 9a41f0c2-…" \
  -H "Content-Type: application/json" \
  -d '{"kind":"call","body":"Walked through the proposal.","at":"2026-09-05T16:30:00Z","byUid":"u_9f1c","dealId":"d_3c9a","durationMinutes":25,"consentSiteId":"site_a1b2c3"}'
```

Returns **`201`**, or **`200`** with the original when an `Idempotency-Key` replays.

### Delete an activity

`DELETE /v1/activities/{activityId}` — scope `crm:write`. Accepts an
[`Idempotency-Key`](../conventions.md#deletes), scoped to the organization.

```json
{ "id": "a_8f21", "object": "activity", "deleted": true }
```

## Errors

| Status | `type` | When |
| --- | --- | --- |
| `400` | `bad_request` | `code: "validation_failed"` — a missing `body` or `consentSiteId`, no `contactId`, `companyId` or `dealId` at all (`fields.contactId` explains), a `kind` outside its list, an `at` that is not an ISO 8601 instant, a `byUid` who is not a member, a reference that does not exist, or a `durationMinutes` that is not a whole number `0` or more. On the list, a `?kind=` outside the list or a malformed `?updatedAfter=`. |
| `403` | `insufficient_scope` | Key lacks `crm:read` / `crm:write`. |
| `404` | `not_found` | `"No such activity"`. |
| `405` | `method_not_allowed` | `Allow`: `GET, POST` on `/v1/activities`, `GET, DELETE` on one activity — a `PATCH` is refused here rather than with a `404` that would read as "no such activity". |
| `409` | `conflict` | `code: "idempotency_in_progress"`. |

See [Conventions → Errors](../conventions.md#errors) for the shared envelope.

## Related

- [Tasks](tasks.md) — what is owed, as opposed to what happened.
- [Contacts](contacts.md) — the platform's own record of what a person did (a form,
  an order, a booking) lives on the contact's timeline in the console, not here.
