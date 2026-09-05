---
sidebar_position: 8
title: Companies
description: Read, add, edit and delete the companies your contacts work for over the REST API.
---

# Companies

The organizations behind your [contacts](contacts.md) — the accounts a sales team
files people, deals and tasks under. Part of the CRM, alongside
[pipelines](pipelines.md), [deals](deals.md), [tasks](tasks.md) and
[activities](activities.md).

A company is keyed, in practice, by its **domain**: two contacts at `acme.com` work
for one company, and the console files them under it by that string. So the API
normalizes a domain exactly as the console stores it, refuses a second company on a
domain already held, and offers `?domain=` as the lookup a sync starts with.

:::note The API is ahead of the console
These endpoints are live. The console's **CRM** pages are still
[rolling out](/content-and-data/contacts/overview), so until they open this API is the
way to work with companies, deals and tasks.
:::

:::info Plan availability
Companies, pipelines, deals, tasks and activities are the **CRM suite**, included from
Starter; a plan without it answers `403 plan_required` with `code: "crm"` on every one
of them, while [contacts](contacts.md) keep working. A company is also a **CRM
record**: it counts with contacts and deals against the plan's records band, and on a
plan that hard-bands (Free) a create past the band answers `403 plan_required` with
`code: "crm_records_quota"` — the key is given back, so the same retry lands once the
band is raised. Paid plans meter the excess instead.
:::

## Scopes and sites {#scopes-and-sites}

Every CRM resource uses the same two scopes — `crm:read` for `GET`, `crm:write` for
`POST`, `PATCH` and `DELETE` — and follows two rules worth knowing once:

- **Reads are organization-wide.** An API key is an organization credential, so a
  list returns every company any of your sites knows, whichever site created it. That
  is the same answer [`GET /v1/contacts`](contacts.md) gives.
- **Writes name a site.** Every create takes a `consentSiteId` — the same parameter a
  [contact opt-in](contacts.md#add-a-contact) takes — and the record is stored exactly
  as that site's console would store it: visible to that site (and, if you have
  declared a consent group, to every site in it), and recorded as created from it.
  There is no default site, for the reason the contacts endpoint gives: picking your
  only site works until you have two. A record created for the wrong site is a record
  that site's own team cannot open, which is why this is required rather than
  guessed.

The site is published on every record as `siteId`, read-only. It cannot be changed
after creation; a record that belongs somewhere else is deleted and recreated there.

## The company object

```json
{
  "id": "k7d2b9f104",
  "object": "company",
  "name": "Acme",
  "domain": "acme.com",
  "website": "https://acme.com/",
  "phone": "+15125550123",
  "address": { "line1": "1 Main St", "city": "Austin", "state": "TX", "postalCode": "78701", "country": "US" },
  "industry": "Coffee roasting",
  "ownerUid": "u_9f1c",
  "notes": "Renews in March.",
  "siteId": "site_a1b2c3",
  "created": "2026-09-05T18:23:23.941Z",
  "updated": "2026-09-05T18:23:23.941Z"
}
```

| Field | Type | Notes |
| --- | --- | --- |
| `id` | string | Opaque company id. |
| `object` | string | Always `"company"`. |
| `name` | string | Required. Trimmed, truncated to 200 characters. Writable. |
| `domain` | string \| null | The bare lowercase hostname — `acme.com`, never `https://www.acme.com/`. Normalized before storing, and **unique** within the organization. Writable. |
| `website` | string \| null | A web address. A bare `acme.com` is stored with `https://`. Writable. |
| `phone` | string \| null | E.164 (`+15125550123`). Normalized before storing; a number that cannot be normalized confidently is a `400`, never a half-cleaned string. Writable. |
| `address` | object \| null | `line1`, `line2`, `city`, `state`, `postalCode`, `country` (two-letter ISO code). Blank parts are dropped; an address with nothing in it is stored as `null`. Writable. |
| `industry` | string \| null | Free text, 120 characters. Writable. |
| `ownerUid` | string \| null | The team member responsible for the account. Must be a member of your organization. Writable. |
| `notes` | string \| null | Free text, 5,000 characters. Writable. |
| `siteId` | string | The site the company was created from — see [above](#scopes-and-sites). **Read-only.** |
| `created` / `updated` | string \| null | ISO 8601. A fresh record's `updated` equals its `created`. |

Every writable field is also returned, so you can read back what you wrote.

## Endpoints

### List companies

`GET /v1/companies` — scope `crm:read`. [Paginated](../conventions.md#pagination),
ordered by company id (see [ordering](../conventions.md#ordering)) — unless
`updatedAfter` is given, which [changes the order](../conventions.md#updated-after).

| Param | Notes |
| --- | --- |
| `domain` | Exact lookup. Normalized the same way a stored domain is, so `?domain=https://www.Acme.com/about` finds `acme.com`. Returns 0 or 1 company. A value that is not a domain at all is a `400`. |
| `ownerUid` | Companies owned by this member. |
| `updatedAfter` | Companies updated **after** this instant, oldest change first — the [sync filter](../conventions.md#updated-after). ISO 8601 with an offset, like `2026-09-01T00:00:00Z`. |
| `limit`, `cursor` | [Standard pagination](../conventions.md#pagination). |

```bash
# the whole list, a page at a time
curl "https://app.aglyn.com/api/v1/companies?limit=50" \
  -H "Authorization: Bearer aglyn_sk_…"

# one account, by the domain your own system keys on
curl "https://app.aglyn.com/api/v1/companies?domain=acme.com" \
  -H "Authorization: Bearer aglyn_sk_…"

# what changed since the last sync
curl "https://app.aglyn.com/api/v1/companies?updatedAfter=2026-09-01T00:00:00Z" \
  -H "Authorization: Bearer aglyn_sk_…"
```

Only **one** filter narrows the query itself — `domain` first, then `ownerUid` — and
any other is checked on the page, so a combined filter can return a
[short page](../conventions.md#short-pages). Check `has_more`, not the row count.

### Retrieve a company

`GET /v1/companies/{companyId}` — scope `crm:read`. Returns a company, or
`404 not_found` (`"No such company"`).

### Add a company

`POST /v1/companies` — scope `crm:write`. Accepts an
[`Idempotency-Key`](../conventions.md#idempotency), scoped to the organization.

**Body** — `name` and `consentSiteId` are required; every other
[writable field](#the-company-object) is optional.

```bash
curl -X POST "https://app.aglyn.com/api/v1/companies" \
  -H "Authorization: Bearer aglyn_sk_…" \
  -H "Idempotency-Key: 9a41f0c2-…" \
  -H "Content-Type: application/json" \
  -d '{"name":"Acme","domain":"acme.com","ownerUid":"u_9f1c","consentSiteId":"site_a1b2c3"}'
```

Returns **`201`** with the created company — or **`200`** with the original when an
`Idempotency-Key` replays. The status is how you tell a fresh create from a replay.

#### The domain is already in use {#company-exists}

If a company with that domain already exists you get `409 conflict` with
`code: "company_exists"`, and the message names the existing id:

```json
{
  "error": {
    "type": "conflict",
    "message": "A company with this domain already exists (k7d2b9f104). Update it instead.",
    "code": "company_exists"
  }
}
```

`PATCH` that id instead — or avoid the round trip by looking the domain up first with
`GET /v1/companies?domain=`. Because the domain is **normalized first**,
`https://www.Acme.com/` and `acme.com` are the same company, the same rule the
console's auto-association uses, so the API and the console cannot disagree about
who is a duplicate.

That refusal **releases the key**, so the retry that should succeed once the
duplicate is removed still can.

### Update a company

`PATCH /v1/companies/{companyId}` — scope `crm:write`. Takes no `Idempotency-Key`
and doesn't need one: the same body twice lands the same state and returns the same
`200`.

Send only what changes. **An omitted key is left alone; an explicit `null` clears
it.** A body of `{}` is a no-op that returns the current company.

```bash
curl -X PATCH "https://app.aglyn.com/api/v1/companies/k7d2b9f104" \
  -H "Authorization: Bearer aglyn_sk_…" \
  -H "Content-Type: application/json" \
  -d '{"industry":"Coffee roasting","notes":null}'
```

Changing `domain` to one another company already holds is the same
[`409 company_exists`](#company-exists) as on create. `consentSiteId`, `siteId` and
`visibleTo` are refused with a `400` naming the key — the site is set when the record
is created.

### Delete a company

`DELETE /v1/companies/{companyId}` — scope `crm:write`. Accepts an
[`Idempotency-Key`](../conventions.md#deletes), scoped to the organization.

```json
{ "id": "k7d2b9f104", "object": "company", "deleted": true }
```

**The company alone is removed.** The deals, tasks and activities filed against it
keep their `companyId`, and the contacts that worked there keep theirs — they are
records of their own, and a delete that cascaded through them would erase a sales
history because somebody removed a duplicate account. Deleting a company that isn't
there returns `404 not_found`, unless the call carries the key of the delete that
removed it, in which case the original receipt is replayed.

## Errors

| Status | `type` | When |
| --- | --- | --- |
| `400` | `bad_request` | `code: "validation_failed"` — a missing `name` or `consentSiteId` (or one naming a site the organization does not own), a `domain` or `phone` that does not normalize, a `website` that is not a web address, an `ownerUid` who is not a member, or a key that is not writable. On the list, a `?domain=` that is not a domain or a malformed `?updatedAfter=`. `fields` names each offending key. |
| `403` | `plan_required` | `code: "crm"` — the plan doesn't include the CRM suite. `code: "crm_records_quota"` — the CRM records band is full on a plan that doesn't meter the overage. |
| `403` | `insufficient_scope` | Key lacks `crm:read` / `crm:write`. Checked before the method. |
| `404` | `not_found` | `"No such company"`. |
| `405` | `method_not_allowed` | `Allow` lists what is: `GET, POST` on `/v1/companies`, `GET, PATCH, DELETE` on one company. |
| `409` | `conflict` | `code: "company_exists"` — that domain is already a company. `code: "idempotency_in_progress"` — an earlier write with the same key is still running. |

See [Conventions → Errors](../conventions.md#errors) for the shared envelope.

## Related

- [Contacts](contacts.md) — a contact's `companyId` points here, and
  `GET /v1/contacts?companyId=` lists the people at an account.
- [Deals](deals.md), [tasks](tasks.md) and [activities](activities.md) — each takes a
  `companyId` and filters by it.
