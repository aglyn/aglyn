---
sidebar_position: 11
title: Tasks
description: Read, add, complete and delete CRM tasks — calls, emails, meetings and to-dos — over the REST API.
---

# Tasks

What the team owes a person: a call, an email, a meeting or a to-do, with a due date,
pointing at the [contact](contacts.md), [company](companies.md) or [deal](deals.md)
it is for. A task may point at nothing — a plain to-do is still a task — which is the
one way it differs from an [activity](activities.md).

Scopes and the site rule are shared with every CRM resource — see
[companies](companies.md#scopes-and-sites).

## The task object

```json
{
  "id": "t_5e0d",
  "object": "task",
  "title": "Call back about the proposal",
  "notes": null,
  "kind": "call",
  "priority": "high",
  "status": "open",
  "dueAt": "2026-09-10T15:00:00.000Z",
  "completedAt": null,
  "assigneeUid": "u_9f1c",
  "contactId": "k7d2b9f104",
  "companyId": null,
  "dealId": "d_3c9a",
  "siteId": "site_a1b2c3",
  "created": "2026-09-05T18:23:23.941Z",
  "updated": "2026-09-05T18:23:23.941Z"
}
```

| Field | Type | Notes |
| --- | --- | --- |
| `id` | string | Opaque task id. |
| `object` | string | Always `"task"`. |
| `title` | string | Required. Trimmed, truncated to 200 characters. Writable. |
| `notes` | string \| null | Free text, 5,000 characters. Writable. |
| `kind` | string | `call`, `email`, `meeting` or `todo`. `todo` when never set. Writable. |
| `priority` | string | `low`, `normal` or `high`. `normal` when never set. Writable. |
| `status` | string | `open` or `done`. `open` when never set. Writable — marking a task `done` stamps `completedAt`; marking it `open` again clears it, so a reopened task never reads as completed on the day it was first closed. |
| `dueAt` | string \| null | ISO 8601 instant. Writable. |
| `completedAt` | string \| null | When the task was marked done. **Read-only.** |
| `assigneeUid` | string \| null | Who owes it. Must be a member of your organization. Writable. |
| `contactId`, `companyId`, `dealId` | string \| null | What the task is for. Each must exist. All optional. Writable. |
| `siteId` | string \| null | The site the task was created from, or `null` for an **organization task** — one filed from the organization's console with no site, owed by the organization itself rather than by any of its sites. **Read-only.** A task created over the API always names a site. |
| `created` / `updated` | string \| null | ISO 8601. |

## Endpoints

### List tasks

`GET /v1/tasks` — scope `crm:read`. [Paginated](../conventions.md#pagination),
ordered by task id unless `updatedAfter` is given.

| Param | Notes |
| --- | --- |
| `dealId`, `contactId`, `companyId` | Tasks for that record. |
| `assigneeUid` | Tasks owed by this member. |
| `status` | `open` or `done`. Anything else is a `400`. |
| `updatedAfter` | Tasks updated after this instant, oldest first — the [sync filter](../conventions.md#updated-after). |
| `limit`, `cursor` | [Standard pagination](../conventions.md#pagination). |

```bash
# one person's open work
curl "https://app.aglyn.com/api/v1/tasks?assigneeUid=u_9f1c&status=open" \
  -H "Authorization: Bearer aglyn_sk_…"
```

One filter narrows the query — in the order listed, so `dealId` before `status` — and
the rest are checked on the page, which can come back
[short](../conventions.md#short-pages).

### Retrieve a task

`GET /v1/tasks/{taskId}` — scope `crm:read`. Returns a task, or `404 not_found`
(`"No such task"`).

### Add a task

`POST /v1/tasks` — scope `crm:write`. Accepts an
[`Idempotency-Key`](../conventions.md#idempotency), scoped to the organization.
`title` and `consentSiteId` are required.

```bash
curl -X POST "https://app.aglyn.com/api/v1/tasks" \
  -H "Authorization: Bearer aglyn_sk_…" \
  -H "Idempotency-Key: 9a41f0c2-…" \
  -H "Content-Type: application/json" \
  -d '{"title":"Call back about the proposal","kind":"call","dueAt":"2026-09-10T15:00:00Z","assigneeUid":"u_9f1c","dealId":"d_3c9a","consentSiteId":"site_a1b2c3"}'
```

Returns **`201`**, or **`200`** with the original when an `Idempotency-Key` replays.
A task created with `status: "done"` is completed the instant it is created.

### Update a task

`PATCH /v1/tasks/{taskId}` — scope `crm:write`. No `Idempotency-Key`. An omitted key
is left alone, `null` clears an optional field, `{}` is a no-op.

```bash
curl -X PATCH "https://app.aglyn.com/api/v1/tasks/t_5e0d" \
  -H "Authorization: Bearer aglyn_sk_…" \
  -H "Content-Type: application/json" \
  -d '{"status":"done"}'
```

### Delete a task

`DELETE /v1/tasks/{taskId}` — scope `crm:write`. Accepts an
[`Idempotency-Key`](../conventions.md#deletes), scoped to the organization.

```json
{ "id": "t_5e0d", "object": "task", "deleted": true }
```

## Errors

| Status | `type` | When |
| --- | --- | --- |
| `400` | `bad_request` | `code: "validation_failed"` — a missing `title` or `consentSiteId`, a `kind`, `priority` or `status` outside its list, a `dueAt` that is not an ISO 8601 instant, an `assigneeUid` who is not a member, or a `contactId`, `companyId` or `dealId` that does not exist. On the list, a `?status=` outside `open`/`done` or a malformed `?updatedAfter=`. `fields` names each key. |
| `403` | `insufficient_scope` | Key lacks `crm:read` / `crm:write`. |
| `404` | `not_found` | `"No such task"`. |
| `405` | `method_not_allowed` | `Allow`: `GET, POST` on `/v1/tasks`, `GET, PATCH, DELETE` on one task. |
| `409` | `conflict` | `code: "idempotency_in_progress"`. |

See [Conventions → Errors](../conventions.md#errors) for the shared envelope.

## Related

- [Activities](activities.md) — what happened, as opposed to what is owed.
