---
sidebar_position: 13
title: Leads
description: Create and work a site's leads over the REST API — a record of its own, with the person and their company as text — and convert one into a contact, a company and a deal.
---

# Leads

Somebody you have heard of and not yet qualified: a visitor who booked or wrote in
through a lead-routed form, or a person from a list your team sourced elsewhere. A lead
is a record of its own, the way it is in Salesforce: it carries the person and their
company **as text** — name, company, title, phone, website, address, tags, where they
came from — beside what a capture recorded (the surfaces, first and last seen, marketing
consent) and the working state the team keeps: a [status](#status), an owner and notes.
Nothing else exists until it converts: converting is what makes the
[contact](contacts.md), and optionally the [company](companies.md) and a
[deal](deals.md), from what the lead holds.

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
  "company": "Acme Brands",
  "jobTitle": "VP Marketing",
  "phone": "+15125550107",
  "website": "https://acme.com/",
  "address": { "city": "Austin", "state": "TX", "country": "US" },
  "tags": ["icp2", "a-list"],
  "leadSource": "Trade show",
  "sources": ["form:contact-us", "api"],
  "submissionCount": 2,
  "firstSeen": "2026-08-30T15:02:11.000Z",
  "lastSeen": "2026-09-04T09:41:07.000Z",
  "marketingConsent": true,
  "marketingConsentAt": "2026-08-30T15:02:11.000Z",
  "convertedContactId": null,
  "convertedAt": null,
  "companyId": null,
  "dealId": null,
  "custom": { "budget": 25000, "territory": "west" },
  "created": "2026-08-30T15:02:11.000Z",
  "updated": "2026-09-04T10:12:40.000Z"
}
```

| Field | Type | Notes |
| --- | --- | --- |
| `id` | string | The lead's id within its site. Stable for the address: a person who submits twice is one lead, seen twice. |
| `object` | string | Always `"lead"`. |
| `siteId` | string | The site that captured the lead. **Read-only.** |
| `email` | string \| null | The address — the lead's identity within its site. Set on [create](#create-a-lead); **read-only** after. |
| `name` | string \| null | The person's name. Set on create or by a capture; **read-only** on a `PATCH`. |
| `status` | string | `new`, `working`, `qualified` or `unqualified` — see [Status](#status). Writable, with rules. |
| `ownerUid` | string \| null | The team member working the lead. Must be a member of your organization. Writable — by uid, or as `ownerEmail` (see [Update a lead](#update-a-lead)). |
| `notes` | string \| null | Free text, 5,000 characters. Writable. |
| `unqualifiedReason` | string \| null | Why the lead was closed without converting. Present only while `status` is `unqualified`. Writable, with `status`. |
| `company` | string \| null | The company's name, **as text**. A lead names its company the way a business card does; converting is what links or creates the company record, by this name or by the address's domain. Writable. |
| `jobTitle` | string \| null | Writable. |
| `phone` | string \| null | E.164 (`+15125550107`). A number with no country code is read as North American; anything unreadable is a `400` under the field. Writable. |
| `website` | string \| null | An http(s) URL; `acme.com` is stored as `https://acme.com/`. Writable. |
| `address` | object \| null | `line1`, `line2`, `city`, `state`, `postalCode`, `country` (two-letter code). Writable; a blank address clears. |
| `tags` | string[] | Lower-cased, deduplicated, at most 20. Writable — as an array, or a comma-separated string. |
| `leadSource` | string \| null | Where the lead came from — what Salesforce calls Lead Source: one of the organization's [lead source values](/content-and-data/crm/custom-fields#lead-source-values). Writable, and restricted to the list's **active** values, matched without regard to case and stored as the list spells it; any other value is refused with `400 validation_failed`, the allowed values named under `fields.leadSource`. The value a lead already holds is kept even after it is deactivated. A create that names none starts from the list's default, when it has one. Distinct from `sources`, which the site records. |
| `sources` | string[] | Every surface that produced a capture: `signup`, `booking`, `form:{formId}`, `import`, `manual` (the console's New lead), `api` (this resource). **Read-only.** |
| `submissionCount` | number | How many captures this lead represents. **Read-only.** |
| `firstSeen` / `lastSeen` | string \| null | ISO 8601 — the first and the latest capture. **Read-only.** |
| `marketingConsent` | boolean | Whether the person ticked a marketing opt-in on this site; `marketingConsentAt` is when. **Read-only.** |
| `convertedContactId` | string \| null | The [contact](contacts.md) this lead became, once converted; `convertedAt` is when. **Read-only** — set by [converting](#convert-a-lead). |
| `companyId`, `dealId` | string \| null | The company the conversion linked or created, and the deal it opened, when it did. **Read-only.** |
| `custom` | object | The organization's [lead custom fields](/content-and-data/crm/custom-fields#over-the-api), keyed by field key; `{}` when the lead has none. Judged against the **lead** definitions: a key that is not one, a retired field, or a value the type cannot hold is a `400` naming `custom.<key>`. A `PATCH` merges the keys it sends; `null` clears one. These values stay on the lead — [converting](#convert-a-lead) does not copy them onto the contact, whose fields are its own. Writable. |
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

### Create a lead

`POST /v1/leads?siteId={siteId}` — scope `crm:write`. Accepts an
[`Idempotency-Key`](../conventions.md#idempotency), scoped to the site.

A lead sourced outside the site — a list, an event, a referral — entered before anyone
has qualified it. It creates a lead and **nothing else**: no contact, no company. Those
come from [converting](#convert-a-lead) it, from what the lead holds by then.

| Key | Notes |
| --- | --- |
| `email` | **Required.** The lead's identity within its site — one address is one lead per site. |
| `name` | The person's name. |
| `company`, `jobTitle`, `phone`, `website`, `address`, `tags`, `leadSource` | The lead's own profile, as [above](#the-lead-object). |
| `status` | `new` (the default) or `working`. |
| `ownerUid` / `ownerEmail` | Who works the lead. |
| `notes` | Free text. |
| `custom` | The organization's lead fields, keyed by field key, as [above](#the-lead-object). |
| `siteId` | Instead of the query parameter. |

```bash
curl -X POST "https://app.aglyn.com/api/v1/leads?siteId=site_a1b2c3" \
  -H "Authorization: Bearer aglyn_sk_…" \
  -H "Idempotency-Key: 7c2e…" \
  -H "Content-Type: application/json" \
  -d '{"email":"ann@acme.com","name":"Ann Lee","company":"Acme Brands","jobTitle":"VP Marketing","leadSource":"Trade show","tags":["icp2"]}'
```

Returns **`201`** with the lead. A site that **already holds a lead for the address**
answers **`200`** with that lead, updated: the fields you sent are written onto it, its
`sources` gain `api`, and its `lastSeen` moves — a second create never mints a second
row. A blank field in the body is left alone on an update, `null` clears it.

**No marketing consent is recorded.** A create over the API is not a box the person
ticked; the lead can be included in a campaign audience only if the site already holds a
consent for the address.

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
| `company`, `jobTitle`, `phone`, `website`, `address`, `tags`, `leadSource` | The lead's own profile, as [above](#the-lead-object); `null` clears any of them. Writable on a converted lead too — the contact is the record then, but the lead keeps what it knew. |
| `custom` | The organization's lead fields, as [above](#the-lead-object). The keys sent are merged into the map; `null` under a key clears it and leaves the rest alone. |

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
stage, carrying the lead's phone, job title, address, tags, notes, company name and
marketing consent — but not its `custom` map, whose fields are the lead's own — joining the existing contact if the address is already one, so the
address book stays one row per person — then, optionally, a company is linked or created
and a deal opened in your default pipeline; the lead is stamped `qualified` once
everything it names exists; and what was filed on the lead follows it: its
[activities](activities.md) and [tasks](tasks.md) gain the contact, and a sequence
enrollment naming the lead re-points itself to the contact. A lead already converted
answers `200` with the ids it has and creates nothing more, so a retry never opens a
second deal.

**Body** — every key optional:

| Key | Notes |
| --- | --- |
| `company` | `{ "link": "co_…" }` to link an existing company, `{ "create": { "name": "Acme", "domain": "acme.com" } }` to create one (a company your key can see under that name, or at that domain, is reused rather than duplicated), or `null` for none. The lead's own `company` text is the name to send. |
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
| `400` | `bad_request` | `code: "validation_failed"` — a missing or foreign `siteId`; on a create, a missing or unreadable `email`, a `status` other than `new` or `working`, or an `unqualifiedReason`; a `phone` or `website` that cannot be read; a `status` outside its list, or `qualified`; a missing `unqualifiedReason` on an unqualify, or one sent with another status; an `ownerUid` who is not a member, an `ownerEmail` no member has, or both at once; a `custom` entry that is not a lead field, is retired, or does not fit its type (named as `custom.<key>`); on a conversion, a `company` that is not exactly one of `link`/`create`, a `company.link` that does not exist, a `company.create.domain` that is not a domain, a `deal` with no `title`, a fractional `deal.amountCents` or a malformed `deal.currency`. On the list, a `?status=` outside the four. `fields` names each key — nested ones as `deal.title`. |
| `403` | `plan_required` | `code: "crm"` — the plan doesn't include the CRM suite. `code: "crm_records_quota"` — a conversion would create a record past the band on a plan that doesn't meter the overage. |
| `403` | `insufficient_scope` | Key lacks `crm:read` / `crm:write`. |
| `404` | `not_found` | `"No such lead"`. |
| `405` | `method_not_allowed` | `Allow`: `GET, POST` on `/v1/leads`, `GET, PATCH` on one lead, `POST` on `…/convert`. |
| `409` | `conflict` | `code: "lead_ceiling"` — the site is at the platform lead limit; the lead was not created. `code: "lead_converted"` — a `status` on a converted lead. `code: "lead_not_convertible"` — the lead's address cannot become a contact. `code: "contact_not_created"` — the contact could not be created (the site's audience band may be full); nothing was changed. `code: "person_erased"` — the lead's person was erased from the organization at their request, or an erasure is pending; no contact can be created for the address, and nothing was changed. `code: "pipeline_has_no_stages"` — the default pipeline has no stage to open the deal in. `code: "idempotency_in_progress"`. |

See [Conventions → Errors](../conventions.md#errors) for the shared envelope.

## Related

- [Contacts](contacts.md) — what a converted lead becomes; `convertedContactId` is a
  contact id.
- [Companies](companies.md) and [deals](deals.md) — the other two records a conversion
  can open.
- [Webhooks](../integrations/webhooks.md) — the `lead` event fires the moment a site
  captures one, and carries the `leadId` to read it back with.
- [Leads in the console](/content-and-data/crm/leads) — the same queue and the
  same conversion, by hand.
