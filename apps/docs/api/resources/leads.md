---
sidebar_position: 13
title: Leads
description: Read a site's work queue over the REST API — every person it has captured, with status, owner and notes — and convert a lead into a contact, a company and a deal.
---

# Leads

Somebody a site has met but you have not yet qualified: a visitor who signed up, booked,
or submitted a form. A lead carries what the capture recorded — the address, the name,
the surfaces it came through, when it was first and last seen, whether it opted in to
marketing — and the working state the team keeps on it: a [status](#status), an owner
and notes. Converting a lead is what turns it into a [contact](contacts.md), and
optionally a [company](companies.md) and a [deal](deals.md).

Scopes are the CRM's — `crm:read` to read, `crm:write` to work and convert — and the
resource needs a plan that includes the CRM suite, like every resource on
[companies → Scopes and sites](companies.md#scopes-and-sites). The site rule is
different, and worth reading once.

## A lead belongs to a site {#site}

Companies, deals and the rest are organization records that a key reads whole. A lead is
not: it lives under the **site** that captured it, private to that site, and its `id`
is only unique within it — the same address captured on two of your sites is two leads,
one per site. So every endpoint here names the site:

- `siteId` is a **query parameter** on every request — `GET /v1/leads?siteId=…`,
  `GET /v1/leads/{leadId}?siteId=…`, and so on. A `PATCH` or `POST` may carry it in the
  body instead.
- A missing `siteId`, or one naming a site your organization does not own, is a
  `400 validation_failed` with `fields.siteId`.

There is no organization-wide list of leads. To read every site's leads, walk your
[sites](sites.md) and list each one's.

## The lead object

```json
{
  "id": "5f3c…e9a1",
  "object": "lead",
  "siteId": "site_a1b2c3",
  "email": "ann@acme.com",
  "name": "Ann Lee",
  "status": "working",
  "ownerUid": "u_9f1c",
  "notes": "Asked for a demo on Thursday",
  "unqualifiedReason": null,
  "sources": ["form:contact-us", "signup"],
  "submissionCount": 2,
  "firstSeen": "2026-08-30T15:02:11.000Z",
  "lastSeen": "2026-09-04T09:41:07.000Z",
  "marketingConsent": true,
  "marketingConsentAt": "2026-08-30T15:02:11.000Z",
  "convertedContactId": null,
  "convertedAt": null,
  "companyId": null,
  "dealId": null,
  "created": "2026-08-30T15:02:11.000Z",
  "updated": "2026-09-04T10:12:40.000Z"
}
```

| Field | Type | Notes |
| --- | --- | --- |
| `id` | string | The lead's id within its site. Stable for the address: a person who submits twice is one lead, seen twice. |
| `object` | string | Always `"lead"`. |
| `siteId` | string | The site that captured the lead. **Read-only.** |
| `email` | string \| null | The captured address. **Read-only.** |
| `name` | string \| null | The name the person typed, when they typed one. **Read-only.** |
| `status` | string | `new`, `working`, `qualified` or `unqualified` — see [Status](#status). Writable, with rules. |
| `ownerUid` | string \| null | The team member working the lead. Must be a member of your organization. Writable — by uid, or as `ownerEmail` (see [Update a lead](#update-a-lead)). |
| `notes` | string \| null | Free text, 5,000 characters. Writable. |
| `unqualifiedReason` | string \| null | Why the lead was closed without converting. Present only while `status` is `unqualified`. Writable, with `status`. |
| `sources` | string[] | Every surface that produced a capture: `signup`, `booking`, `form:{formId}`. **Read-only.** |
| `submissionCount` | number | How many captures this lead represents. **Read-only.** |
| `firstSeen` / `lastSeen` | string \| null | ISO 8601 — the first and the latest capture. **Read-only.** |
| `marketingConsent` | boolean | Whether the person ticked a marketing opt-in on this site; `marketingConsentAt` is when. **Read-only.** |
| `convertedContactId` | string \| null | The [contact](contacts.md) this lead became, once converted; `convertedAt` is when. **Read-only** — set by [converting](#convert-a-lead). |
| `companyId`, `dealId` | string \| null | The company the conversion linked or created, and the deal it opened, when it did. **Read-only.** |
| `created` / `updated` | string \| null | ISO 8601. `updated` is stamped by the team's writes and by the conversion, not by a repeat capture — watch `lastSeen` for those. |

### Status {#status}

| Status | Meaning |
| --- | --- |
| `new` | Captured and untouched. A lead nobody has worked reads as `new` even though nothing has been written on it yet. |
| `working` | Somebody is on it. |
| `unqualified` | Closed without converting, with an `unqualifiedReason`. |
| `qualified` | **Converted.** Reached only through [`POST /v1/leads/{id}/convert`](#convert-a-lead) — never by a `PATCH`, because the status is a claim that a contact exists and the conversion is what makes it true. A converted lead's status is fixed. |

## Endpoints

### List leads

`GET /v1/leads?siteId={siteId}` — scope `crm:read`. [Paginated](../conventions.md#pagination),
**newest `lastSeen` first** — the order a work queue wants, and the order a poll for
"what arrived since I last looked" wants.

| Param | Notes |
| --- | --- |
| `siteId` | Required — see [above](#site). |
| `status` | `new`, `working`, `qualified` or `unqualified`. Anything else is a `400`. |
| `ownerUid` | Leads this member owns. |
| `limit`, `cursor` | [Standard pagination](../conventions.md#pagination). |

```bash
# the site's open work, newest first
curl "https://app.aglyn.com/api/v1/leads?siteId=site_a1b2c3&status=new" \
  -H "Authorization: Bearer aglyn_sk_…"
```

`status` and `ownerUid` are checked **on the page**, not in the query, so a filtered page
can come back [short](../conventions.md#short-pages) — keep following `next_cursor` until
`has_more` is false. That is deliberate: a lead nobody has touched carries no status at
all and reads as `new`, which is exactly the lead a query on the stored field would miss.

### Retrieve a lead

`GET /v1/leads/{leadId}?siteId={siteId}` — scope `crm:read`. Returns a lead, or
`404 not_found` (`"No such lead"`).

### Update a lead

`PATCH /v1/leads/{leadId}?siteId={siteId}` — scope `crm:write`. No `Idempotency-Key`.
An omitted key is left alone, `null` clears an optional field, `{}` is a no-op.

| Key | Notes |
| --- | --- |
| `status` | `new`, `working` or `unqualified`. Not `qualified` — [convert](#convert-a-lead) instead. |
| `unqualifiedReason` | Required when `status` becomes `unqualified`; may be sent alone to reword the reason of a lead already unqualified. Refused with any other status. Setting the status back to `new` or `working` drops it. |
| `ownerUid` | A member's uid, or `null` to clear. |
| `ownerEmail` | A member's address, resolved against your organization's roster — for a spreadsheet or a zap that has the address and not the uid. Not with `ownerUid` in the same request. `null` clears. |
| `notes` | Free text, or `null`. |

```bash
curl -X PATCH "https://app.aglyn.com/api/v1/leads/5f3c…e9a1?siteId=site_a1b2c3" \
  -H "Authorization: Bearer aglyn_sk_…" \
  -H "Content-Type: application/json" \
  -d '{"status":"working","ownerEmail":"rep@yourcompany.com","notes":"Demo Thursday"}'
```

A converted lead answers `409 conflict` with `code: "lead_converted"` to a `status`; its
notes and owner stay writable.

### Convert a lead

`POST /v1/leads/{leadId}/convert?siteId={siteId}` — scope `crm:write`. Accepts an
[`Idempotency-Key`](../conventions.md#idempotency), scoped to the site.

This is the same conversion the console's **Convert** dialog performs, through the same
code: the lead becomes a [contact](contacts.md) at the **Sales qualified** lifecycle
stage — joining the existing contact if the address is already one, so the address book
stays one row per person — then, optionally, a company is linked or created and a deal
opened in your default pipeline; and the lead is stamped `qualified` last, once everything
it names exists. A lead already converted answers `200` with the ids it has and creates
nothing more, so a retry never opens a second deal.

**Body** — every key optional:

| Key | Notes |
| --- | --- |
| `company` | `{ "link": "co_…" }` to link an existing company, `{ "create": { "name": "Acme", "domain": "acme.com" } }` to create one (a company your key can see at that domain is reused rather than duplicated), or `null` for none. |
| `deal` | `{ "title": "…", "amountCents": 12500, "currency": "usd", "stageId": "qualified" }` — `title` required; `amountCents` a whole number; `currency` lowercase ISO 4217, `usd` when omitted; `stageId` a stage of the default pipeline, its first open stage when omitted. `null` for none. An organization with no pipeline yet gets a **Sales** pipeline with the default stages. |
| `ownerUid` / `ownerEmail` | Who owns the contact and the deal. Defaults to the lead's owner; failing that your organization's assignment rules and the site's default owner decide. A key cannot own a record, so a contact nobody names and no rule assigns stays unassigned — where a person converting from the console would have kept it. |
| `siteId` | Instead of the query parameter. |

```bash
curl -X POST "https://app.aglyn.com/api/v1/leads/5f3c…e9a1/convert?siteId=site_a1b2c3" \
  -H "Authorization: Bearer aglyn_sk_…" \
  -H "Idempotency-Key: 9a41f0c2-…" \
  -H "Content-Type: application/json" \
  -d '{"company":{"create":{"name":"Acme","domain":"acme.com"}},"deal":{"title":"Acme — first order","amountCents":12500}}'
```

Returns **`201`** with a receipt, or **`200`** when the lead was already converted (or an
`Idempotency-Key` replays):

```json
{
  "object": "lead_conversion",
  "id": "5f3c…e9a1",
  "siteId": "site_a1b2c3",
  "contactId": "k7d2b9f104",
  "companyId": "co_8b1e",
  "dealId": "d_3c9a",
  "alreadyConverted": false,
  "lead": { "id": "5f3c…e9a1", "object": "lead", "status": "qualified", "…": "…" }
}
```

The conversion creates records against the **CRM records band** — see
[Usage](../usage.md). On a plan that refuses at the band rather than metering it, a
company or a deal that would not fit answers `403 plan_required` with
`code: "crm_records_quota"`, the contact stands, and the lead stays unconverted so a
retry after the upgrade finds it where it was.

A lead whose person the organization has erased at their request — the erasure
pending, or already run and the address captured again since — answers `409 conflict`
with `code: "person_erased"`. The erasure closed the address to capture, and a
conversion creates the contact by capturing it; nothing is changed, and a pending
erasure removes the lead itself when it runs. Do not retry: no plan change lifts it.

The conversion is logged on the site's activity feed in the console, attributed to
your key by its name — *API key Zapier* — the way a conversion from the console is
attributed to the person who made it.

## Errors

| Status | `type` | When |
| --- | --- | --- |
| `400` | `bad_request` | `code: "validation_failed"` — a missing or foreign `siteId`; a `status` outside its list, or `qualified`; a missing `unqualifiedReason` on an unqualify, or one sent with another status; an `ownerUid` who is not a member, an `ownerEmail` no member has, or both at once; on a conversion, a `company` that is not exactly one of `link`/`create`, a `company.link` that does not exist, a `company.create.domain` that is not a domain, a `deal` with no `title`, a fractional `deal.amountCents` or a malformed `deal.currency`. On the list, a `?status=` outside the four. `fields` names each key — nested ones as `deal.title`. |
| `403` | `plan_required` | `code: "crm"` — the plan doesn't include the CRM suite. `code: "crm_records_quota"` — a conversion would create a record past the band on a plan that doesn't meter the overage. |
| `403` | `insufficient_scope` | Key lacks `crm:read` / `crm:write`. |
| `404` | `not_found` | `"No such lead"`. |
| `405` | `method_not_allowed` | `Allow`: `GET` on `/v1/leads`, `GET, PATCH` on one lead, `POST` on `…/convert`. |
| `409` | `conflict` | `code: "lead_converted"` — a `status` on a converted lead. `code: "lead_not_convertible"` — the lead's address cannot become a contact. `code: "contact_not_created"` — the contact could not be created (the site's audience band may be full); nothing was changed. `code: "person_erased"` — the lead's person was erased from the organization at their request, or an erasure is pending; no contact can be created for the address, and nothing was changed. `code: "pipeline_has_no_stages"` — the default pipeline has no stage to open the deal in. `code: "idempotency_in_progress"`. |

See [Conventions → Errors](../conventions.md#errors) for the shared envelope.

## Related

- [Contacts](contacts.md) — what a converted lead becomes; `convertedContactId` is a
  contact id.
- [Companies](companies.md) and [deals](deals.md) — the other two records a conversion
  can open.
- [Webhooks](../integrations/webhooks.md) — the `lead` event fires the moment a site
  captures one, and carries the `leadId` to read it back with.
- [Leads in the console](/content-and-data/contacts/leads) — the same queue and the
  same conversion, by hand.
