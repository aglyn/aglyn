---
sidebar_position: 2
title: Contacts
description: Read, add, edit, and delete your organization's contacts — and their CRM profile — over the REST API.
---

# Contacts

Your organization's [contacts](/content-and-data/contacts/overview) — the unified list
built from form submissions, member sign-ups, orders, and bookings, plus anyone your
own systems add through this API.

A contact is unified on its **email address**. Everything else about the resource
follows from that: the email is the identity, so the API will not let you change it,
and a second create for an address already present is a conflict rather than a second
row.

:::note The API is ahead of the console
These endpoints are live. The console's **CRM** is still
[rolling out](/content-and-data/contacts/overview), so until it opens this API is the
way to work with the contacts your sites have already captured.
:::

## The contact object

```json
{
  "id": "k7d2b9f104",
  "object": "contact",
  "email": "wholesale@example.com",
  "name": "Robin Wholesale",
  "tags": ["b2b"],
  "notes": "Renews in March.",
  "marketingConsent": true,
  "consentSites": ["site_a1b2c3"],
  "sources": ["form", "order"],
  "phone": "+15125550123",
  "jobTitle": "Head of Purchasing",
  "companyId": "c_1a2b",
  "address": { "line1": "1 Main St", "city": "Austin", "state": "TX", "postalCode": "78701", "country": "US" },
  "ownerUid": "u_9f1c",
  "lifecycleStage": "customer",
  "companyIds": ["c_1a2b"],
  "created": "2026-07-20T18:23:23.941Z",
  "updated": "2026-07-20T18:23:23.941Z"
}
```

| Field | Type | Notes |
| --- | --- | --- |
| `id` | string | Opaque contact id. |
| `object` | string | Always `"contact"`. |
| `email` | string \| null | The identity a contact is unified on. **Read-only.** |
| `name` | string \| null | Display name, when known. Writable. |
| `tags` | string[] | Tags, the same ones the console's tag editor writes. Writable. |
| `notes` | string \| null | Free-text notes, the same field the console's contact record writes. Writable. |
| `marketingConsent` | boolean | Whether **any** site may market to this person. `false` means a recorded refusal, which stands against every site. Writable — see `consentSiteId`. |
| `consentSites` | string[] | The sites this person has opted in to. Consent runs to a brand, not to your organization, so a person who signed up on one of your sites is not reachable from another unless they opted in there too. **Read-only** — write through `consentSiteId`. |
| `sources` | string[] | Where this person came from — `form`, `member`, `order`, `booking`, `newsletter`, or `api` for one added through this API. Multiple entries mean one person did several things. **Read-only.** |
| `phone` | string \| null | E.164 (`+15125550123`). Normalized before storing; a number that cannot be normalized confidently is a `400`. Writable — see [the CRM profile](#crm-profile). |
| `jobTitle` | string \| null | 120 characters. Writable. |
| `companyId` | string \| null | The [company](companies.md) this person works for, as this site knows it. Must exist. Writable. |
| `address` | object \| null | `line1`, `line2`, `city`, `state`, `postalCode`, `country` (two-letter ISO code). Blank parts dropped; an empty address is stored as `null`. Writable. |
| `ownerUid` | string \| null | The team member responsible for the relationship. Must be a member of your organization. Writable. |
| `lifecycleStage` | string \| null | `subscriber`, `lead`, `marketing-qualified`, `sales-qualified`, `opportunity`, `customer`, `evangelist` or `other`. Writable. |
| `companyIds` | string[] | Every company any of your sites has filed this person under — the set of the per-site `companyId`s. What `?companyId=` queries. **Read-only.** |
| `created` / `updated` | string \| null | ISO 8601. |

Every writable field in that table is also returned, so you can read back what you
wrote. The interaction timeline shown in the console isn't exposed over the API.

### The CRM profile is per site {#crm-profile}

`phone`, `jobTitle`, `companyId`, `address`, `ownerUid` and `lifecycleStage` are one
**site's** knowledge of a person, not the person's own facts. A contact is one record
shared by every site that has captured them, and an agency's two brands that both know
somebody must not read each other's notes on them — so the console stores these six
per site (strictly, per [consent group](#add-a-contact)), and the API does the same.
Two consequences:

- **Writing any of them names the site**, through `consentSiteId` — the same parameter
  an opt-in takes, because it is the same question: which of your sites is this write
  made on behalf of. Sending a profile field with no `consentSiteId` is a `400`.
- **Reading them is organization-wide by default.** A key is an organization
  credential and every site's profile is the organization's own, so without a site
  named the object carries the **union** — each field from the first site, in stable
  order, that has set it. Pass `?consentSiteId=` on a `GET` to read one site's profile
  alone, which is what a per-brand sync wants; a `PATCH` reads back through the site it
  wrote.

`tags`, `notes` and `marketingConsent` predate this and keep their existing
behavior.

### What you can't write, and why {#read-only-fields}

`email` and `sources` are refused rather than ignored — sending either is a
`400 validation_failed` naming the key, not a silent drop.

- **`email`** is the dedupe key the whole CRM unifies on. Changing it through this API
  would merge or split people's records as a side effect of an edit. To move a
  contact to a different address, delete it and create the new one.
- **`sources`** is provenance. It records where a person actually came from, which
  stops being true the moment an integration can write it.

## Endpoints

### List contacts

`GET /v1/contacts` — scope `contacts:read`. [Paginated](../conventions.md#pagination),
ordered by contact id (see [ordering](../conventions.md#ordering) — not newest-first).

| Param | Notes |
| --- | --- |
| `email` | Exact lookup. Normalized the same way a stored address is, so case and surrounding spaces don't matter. Returns 0 or 1 contact. |
| `tag` | Contacts carrying this tag. Exact match on one entry of the `tags` array — not a prefix or a substring. |
| `companyId` | The people at one [company](companies.md) — anyone any of your sites has filed under it. See [CRM filters](#crm-filters). |
| `lifecycleStage` | Contacts at this stage. One of the eight values; anything else is a `400`. Checked on the page — see [CRM filters](#crm-filters). |
| `ownerUid` | Contacts this member owns. Checked on the page — see [CRM filters](#crm-filters). |
| `consentSiteId` | Read the [CRM profile](#crm-profile) of this site alone, and evaluate `lifecycleStage` and `ownerUid` against it. Changes what the rows say, not which rows match `email`, `tag` or `companyId`. |
| `limit`, `cursor` | [Standard pagination](../conventions.md#pagination). |

```bash
# the whole audience, a page at a time
curl "https://app.aglyn.com/api/v1/contacts?limit=50" \
  -H "Authorization: Bearer aglyn_sk_…"

# one person
curl "https://app.aglyn.com/api/v1/contacts?email=robin%40example.com" \
  -H "Authorization: Bearer aglyn_sk_…"

# one segment
curl "https://app.aglyn.com/api/v1/contacts?tag=newsletter" \
  -H "Authorization: Bearer aglyn_sk_…"
```

#### Look a contact up before you create it {#lookup}

`?email=` is the call a sync should start with. Contacts are **organization-wide**, so
without it "do I already have this person?" means paging your entire audience — and
every page is a [billed request](../usage.md) against your
[per-minute limit](../rate-limits.md). On a 50,000-contact audience that is ~500
requests to answer one question, and the answer is stale by the time you finish.

The address is **normalized before it is matched**, using the same rule that
normalizes a stored one. `?email=%20Robin@Example.COM%20` and
`?email=robin@example.com` find the same contact. This matters more than it looks:
without it, a lookup could answer "no such contact" for an address that
[`POST` refuses as a duplicate](#contact-exists), and you would have two endpoints
disagreeing about whether a person exists.

An address that isn't a usable email at all is a `400 bad_request`
(`code: "validation_failed"`, `fields: { "email": … }`) rather than an empty page.
No stored contact can match one, so an empty page would be true and useless — it reads
exactly like "we don't have them" and sends you looking for a missing person instead
of a typo.

There is still no filter by `source`. Provenance is set by whichever capture point
recorded the contact, and it's on the object — page and filter client-side for that
one.

#### Combining `email` and `tag` {#combined-filter}

You can send both. `email` does the narrowing and `tag` is applied to the result, so
the answer is "this person, if they carry that tag" — a 0- or 1-row page. That makes
it a [short page](../conventions.md#short-pages) by the standard rule: check
`has_more`, not the row count.

#### The CRM filters {#crm-filters}

`companyId` can narrow the query itself: it matches the `companyIds` array, which
exists on the record precisely so that "everyone at this account" is one indexed
lookup. `lifecycleStage` and `ownerUid` cannot — they live on a
[per-site profile](#crm-profile), and a field inside one site's profile is not
something an organization-wide list can ask the index for — so both are **checked on
the page**, against the same profile the row publishes (the named site's, or the
union). A page filtered by either can come back short, or empty, with `has_more`
still `true`; the cursor is the only termination signal.

When several filters are sent, one narrows the query — `email`, else `companyId`,
else `tag` — and the rest are checked on the page.

```bash
# everyone at one account
curl "https://app.aglyn.com/api/v1/contacts?companyId=c_1a2b" \
  -H "Authorization: Bearer aglyn_sk_…"

# one site's customers, read through that site's profile
curl "https://app.aglyn.com/api/v1/contacts?lifecycleStage=customer&consentSiteId=site_a1b2c3" \
  -H "Authorization: Bearer aglyn_sk_…"
```

### Retrieve a contact

`GET /v1/contacts/{contactId}` — scope `contacts:read`.

Returns a contact object, or `404 not_found` (`"No such contact"`).

### Add a contact

`POST /v1/contacts` — scope `contacts:write`. Accepts an
[`Idempotency-Key`](../conventions.md#idempotency).

**Body**

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `email` | string | **yes** | Normalized before storing: trimmed and lowercased. An address that isn't usable is a `400`. |
| `name` | string | no | Trimmed, truncated to 120 characters. An explicitly empty string is a `400` rather than a way to clear it. |
| `tags` | string[] | no | Blanks dropped; each tag truncated to 60 characters, at most 50 kept. |
| `notes` | string | no | Truncated to 2,000 characters. |
| `marketingConsent` | boolean | no | `true` also stamps the consent timestamp, and requires `consentSiteId`. |
| `phone`, `jobTitle`, `companyId`, `address`, `ownerUid`, `lifecycleStage` | see [the object](#the-contact-object) | no | The [CRM profile](#crm-profile). Each requires `consentSiteId`, and lands on that site's profile of the person. |
| `consentSiteId` | string | with `marketingConsent: true` or any profile field | The site this write is made on behalf of: the site the person opted in to, and the site whose profile the fields land on. Required for an opt-in and for a profile field; rejected alongside `marketingConsent: false` unless a profile field needs it. A site your organization does not own is a `400`. |

```bash
curl -X POST "https://app.aglyn.com/api/v1/contacts" \
  -H "Authorization: Bearer aglyn_sk_…" \
  -H "Idempotency-Key: 9a41f0c2-…" \
  -H "Content-Type: application/json" \
  -d '{"email":"wholesale@example.com","name":"Robin Wholesale","tags":["b2b"]}'
```

Returns **`201`** with the created contact — or **`200`** with the original contact
when an `Idempotency-Key` replays. The status is how you tell a fresh create from a
replay.

The contact is created with `sources: ["api"]`, so the console shows at a glance which
people an integration put there rather than a site captured.

#### The email is already in use {#contact-exists}

If a contact with that address already exists you get `409 conflict` with
`code: "contact_exists"`, and the message names the existing id:

```json
{
  "error": {
    "type": "conflict",
    "message": "A contact with this email already exists (k7d2b9f104). Update it instead.",
    "code": "contact_exists"
  }
}
```

`PATCH` that id instead — or avoid the round trip entirely by
[looking the address up first](#lookup) with `GET /v1/contacts?email=`, which returns
the whole contact rather than an id embedded in a sentence. We don't silently upsert
here: two upstream systems both claiming to own a record is a real integration bug,
and quietly merging them would hide it and make `POST` and `PATCH` the same call.

Because the address is **normalized first**, `Robin@Example.com` and
`robin@example.com` are the same contact. That is the same rule the capture points on
your sites use, so the API and a form can't disagree about who is a duplicate.

That refusal **releases the key** — see [plan gates](#plan-gates) below, which
explains the rule both of this endpoint's refusals follow.

#### Plan gates {#plan-gates}

Contacts are an **audience band**, not a hard cap, on every plan that includes the
API. Adding people past the included band meters onto your invoice exactly as a form
capture does — [monthly quota and overage](../rate-limits.md#monthly-quota--overage)
covers how that is billed. There is no separate "API contacts" allowance: a contact
is a contact, whoever added it.

When a plan *does* hard-band, a create past the band is refused:

| `code` | Means |
| --- | --- |
| `contact_quota` | The plan's **CRM records band** — contacts, companies and deals together — is full and this plan doesn't meter the overage. The message names the limit. |

**Neither this nor `contact_exists` consumes an `Idempotency-Key.`** Both clear —
one when somebody upgrades, the other when the duplicate is removed — and the retry
that should finally succeed has to be able to, rather than replaying the refusal
forever.

A create that succeeds is different: it is remembered, so a retry with the same key
replays it **even when that create filled the last slot in the band**. Without that,
the retry after a lost response would be refused and you would have no way to tell
whether the contact exists.

### Update a contact

`PATCH /v1/contacts/{contactId}` — scope `contacts:write`. Takes no
`Idempotency-Key` and doesn't need one: the same body twice lands the same state
*and* returns the same `200`.

Send only what changes — `name`, `tags`, `notes`, `marketingConsent` and the six
[profile fields](#crm-profile) are independent:

```bash
curl -X PATCH "https://app.aglyn.com/api/v1/contacts/k7d2b9f104" \
  -H "Authorization: Bearer aglyn_sk_…" \
  -H "Content-Type: application/json" \
  -d '{"tags":["b2b","vip"],"notes":"Renews in March."}'
```

- **An omitted key is left alone, never cleared.** A body of `{}` is a no-op that
  returns the current contact.
- **`tags` is replaced wholesale**, not merged — send the full list. An explicitly
  empty `tags: []` **does** clear them; this is the one field where empty means empty,
  because an integration has to be able to undo its own tagging.
- **An opt-in has to name the site it was given to.** `marketingConsent: true`
  requires `consentSiteId`, because an API key belongs to your *organization* and
  an organization is not a brand: an agency's key reaches every client it runs. The
  grant is recorded against that site (and, if you have declared a consent group,
  against every site in it) and against no other. There is no default — picking your
  only site would work until you had two.
- Setting `marketingConsent: true` stamps the consent timestamp. Setting it back to
  `false` withdraws consent but **leaves the original timestamp in place** — it is the
  evidence of when the person opted in, and an audit needs it. A withdrawal takes no
  `consentSiteId`: it applies to every site, because withholding mail is recoverable
  and sending it is not.
- **A profile field names the site too.** `{"consentSiteId":"site_a1b2c3","lifecycleStage":"customer"}`
  writes that site's profile and no other site's; an explicit `null` clears a field
  there. Changing `companyId` moves the person in `companyIds` — the old id leaves
  once no site files them under it any more. The response reads back through the
  site you named.
- Editing is never refused by the audience band. An edit doesn't grow the audience,
  and a downgraded organization still has to be able to correct its own data.
- `404 not_found` (`"No such contact"`) if it isn't there.

### Delete a contact

`DELETE /v1/contacts/{contactId}` — scope `contacts:write`. Accepts an
[`Idempotency-Key`](../conventions.md#deletes).

A contact is shared by every site that has captured the person — one human is one
record — so a delete removes **your organization's** relationship with them: the
tags, notes, timeline and consent your sites hold. The record itself is destroyed
once nothing is holding it.

```json
{ "id": "k7d2b9f104", "object": "contact", "deleted": true }
```

Deleting a contact that isn't there returns `404 not_found` — **unless** the call
carries the `Idempotency-Key` of the delete that removed it, in which case the
original `200` receipt is replayed. Send a key whenever a deletion runs from a script,
which is most of them: an erasure request on somebody else's deadline is exactly the
case where a response lost to a timeout must not read as a failure.

This removes the contact record. It does not remove the
[form submissions](form-submissions.md), orders, or bookings that person left behind —
those are separate records with their own endpoints.

## Errors

| Status | `type` | When |
| --- | --- | --- |
| `400` | `bad_request` | `code: "validation_failed"` — on a write, a missing or unusable `email`, a non-boolean `marketingConsent`, a `marketingConsent: true` with no
`consentSiteId` (or one naming a site the organization does not own), a profile field with no `consentSiteId`, a `phone` that does not normalize, a `lifecycleStage` outside the list, a `companyId` that does not exist, an `ownerUid` who is not a member, or an attempt
to write `email`/`sources`. On the list, an `?email=` that isn't a usable address, a `?lifecycleStage=` outside the list, or a `?consentSiteId=` naming a site the organization does not own. `fields` names each offending key. |
| `403` | `plan_required` | `code: "contact_quota"` — the CRM records band (contacts, companies and deals together) is full on a plan that doesn't meter the overage. |
| `403` | `insufficient_scope` | Key lacks `contacts:read` / `contacts:write`. Checked before the method, so a write attempt with a read-only key returns `403`, not `405`. |
| `404` | `not_found` | `"No such contact"`. |
| `405` | `method_not_allowed` | Method not supported on that path. The `Allow` header lists what is: `GET, POST` on `/v1/contacts`, `GET, PATCH, DELETE` on one contact. |
| `409` | `conflict` | `code: "contact_exists"` — that email is already a contact. `code: "idempotency_in_progress"` — an earlier write with the same key is still running. |

See [Conventions → Errors](../conventions.md#errors) for the shared envelope.

## Related

- [CRM](/content-and-data/contacts/overview) — how contacts are captured, and
  what the audience band means for your plan.
- [Companies](companies.md), [deals](deals.md), [tasks](tasks.md) and
  [activities](activities.md) — the records that sit beside a contact, each pointing
  back at it by `contactId`.
- [Usage](../usage.md) — how much of the audience band you've used, and whether
  crossing it bills or refuses.
