---
sidebar_position: 14
title: Email templates
description: Read, add, edit and delete the CRM's email templates and snippets — the letters a team sends from a record, with merge fields — over the REST API.
---

# Email templates

The letters your team sends from a record with **Send email** — see
[Email templates & snippets](/docs/content-and-data/crm/email-templates) in the
manual. A **template** is a subject and a message under a name; a **snippet** is a
paragraph under a name, inserted where the cursor is. Both may carry merge fields
such as `{{contact.firstName}}` and `{{deal.amount}}`, which the send fills in from
the record; the API stores them as written and fills in nothing.

Scopes and the site rule are shared with every CRM resource — see
[companies](companies.md#scopes-and-sites).

## The email template object

```json
{
  "id": "et_7b2f",
  "object": "email_template",
  "name": "Follow-up",
  "kind": "template",
  "visibility": "shared",
  "ownerUid": null,
  "subject": "Following up, {{contact.firstName}}",
  "body": "Hi {{contact.firstName}},\n\nStill keen on {{deal.name}}?\n\n{{sender.firstName}}",
  "siteId": "site_a1b2c3",
  "created": "2026-09-08T09:12:44.120Z",
  "updated": "2026-09-08T09:12:44.120Z"
}
```

| Field | Type | Notes |
| --- | --- | --- |
| `id` | string | Opaque template id. |
| `object` | string | Always `"email_template"`. |
| `name` | string | Required. Trimmed, truncated to 80 characters. Writable. |
| `kind` | string | `template` or `snippet`. `template` when never set. Writable. A snippet stores no subject. |
| `visibility` | string | `shared` — every CRM editor's — or `personal`, listed for `ownerUid` alone. `shared` when never set. Writable. |
| `ownerUid` | string \| null | The member a personal template is listed for. Must be a member of your organization. Required when `visibility` is `personal`, refused when it is `shared`; flipping a template to `shared` drops it. Writable. |
| `subject` | string | The subject line a template fills in, 200 characters, merge fields allowed. `""` when none — an email keeps its own subject. `null` clears it. Writable. |
| `body` | string | Required. Plain text, 10,000 characters, merge fields allowed; line endings are normalized to `\n`. Writable. |
| `siteId` | string \| null | The site the template was created from, or `null` for one written from the organization's own console. **Read-only.** A template created over the API always names a site. |
| `created` / `updated` | string \| null | ISO 8601. |

## Endpoints

### List email templates

`GET /v1/email-templates` — scope `crm:read`. [Paginated](../conventions.md#pagination),
ordered by template id unless `updatedAfter` is given. Every template the organization
holds, personal ones included: an API key is an organization credential.

| Param | Notes |
| --- | --- |
| `ownerUid` | Personal templates listed for this member. |
| `kind` | `template` or `snippet`. Anything else is a `400`. |
| `visibility` | `shared` or `personal`. Anything else is a `400`. |
| `updatedAfter` | Templates updated after this instant, oldest first — the [sync filter](../conventions.md#updated-after). |
| `limit`, `cursor` | [Standard pagination](../conventions.md#pagination). |

```bash
# every shared snippet
curl "https://app.aglyn.com/api/v1/email-templates?kind=snippet&visibility=shared" \
  -H "Authorization: Bearer aglyn_sk_…"
```

One filter narrows the query — in the order listed, so `ownerUid` before `kind` — and
the rest are checked on the page, which can come back
[short](../conventions.md#short-pages).

### Retrieve an email template

`GET /v1/email-templates/{templateId}` — scope `crm:read`. Returns a template, or
`404 not_found` (`"No such email template"`).

### Add an email template

`POST /v1/email-templates` — scope `crm:write`. Accepts an
[`Idempotency-Key`](../conventions.md#idempotency), scoped to the organization.
`name`, `body` and `consentSiteId` are required.

```bash
curl -X POST "https://app.aglyn.com/api/v1/email-templates" \
  -H "Authorization: Bearer aglyn_sk_…" \
  -H "Idempotency-Key: 4c1e9a77-…" \
  -H "Content-Type: application/json" \
  -d '{"name":"Follow-up","subject":"Following up, {{contact.firstName}}","body":"Hi {{contact.firstName}},\n\nStill keen?","consentSiteId":"site_a1b2c3"}'
```

Returns **`201`**, or **`200`** with the original when an `Idempotency-Key` replays.

### Update an email template

`PATCH /v1/email-templates/{templateId}` — scope `crm:write`. No `Idempotency-Key`. An
omitted key is left alone, `subject: null` clears the subject, `{}` is a no-op.

```bash
curl -X PATCH "https://app.aglyn.com/api/v1/email-templates/et_7b2f" \
  -H "Authorization: Bearer aglyn_sk_…" \
  -H "Content-Type: application/json" \
  -d '{"visibility":"personal","ownerUid":"u_9f1c"}'
```

### Delete an email template

`DELETE /v1/email-templates/{templateId}` — scope `crm:write`. Accepts an
[`Idempotency-Key`](../conventions.md#deletes), scoped to the organization. Emails
already sent from the template are not changed.

```json
{ "id": "et_7b2f", "object": "email_template", "deleted": true }
```

## Errors

| Status | `type` | When |
| --- | --- | --- |
| `400` | `bad_request` | `code: "validation_failed"` — a missing `name`, `body` or `consentSiteId`, a `kind` or `visibility` outside its list, a personal template with no `ownerUid` or a shared one with one, an `ownerUid` who is not a member, or a `subject`/`body` that is not a string. On the list, a `?kind=` or `?visibility=` outside its list or a malformed `?updatedAfter=`. `fields` names each key. |
| `403` | `insufficient_scope` | Key lacks `crm:read` / `crm:write`. |
| `403` | `plan_required` | `code: "crm"` — the plan carries no CRM suite. |
| `404` | `not_found` | `"No such email template"`. |
| `405` | `method_not_allowed` | `Allow`: `GET, POST` on `/v1/email-templates`, `GET, PATCH, DELETE` on one template. |
| `409` | `conflict` | `code: "idempotency_in_progress"`. |

See [Conventions → Errors](../conventions.md#errors) for the shared envelope.

## Related

- [Activities](activities.md) — where a sent email is logged, subject and delivery state included.
