---
sidebar_position: 1
slug: /
title: Aglyn REST API
description: A REST API and MCP server for your organization's datasets, contacts, CRM, sites and their pages, page content, templates, search listings and business details, form submissions, store orders, products and media — authenticated with API keys or by signing in.
---

# Aglyn REST API

The Aglyn REST API gives you programmatic access to your organization's data —
[datasets and records](resources/datasets.md), [contacts](resources/contacts.md) and
the CRM around them — [companies](resources/companies.md),
[pipelines](resources/pipelines.md), [deals](resources/deals.md),
[tasks](resources/tasks.md), [activities](resources/activities.md),
[email templates](resources/email-templates.md) and each site's
[leads](resources/leads.md) — [sites](resources/sites.md) and their
[pages](resources/pages.md) and what is on them, [page templates](resources/templates.md),
[search listing](resources/seo.md),
[business details](resources/business-details.md) and
[form submissions](resources/form-submissions.md), your store's
[orders](resources/orders.md) and [products](resources/products.md), and your
[media library](resources/media.md). Use it to sync content from another system, push
orders into accounting, record shipments from a 3PL or warehouse system, keep a
catalog and its stock in step with a PIM or warehouse, feed a catalog to a marketplace, sync a CRM's contacts and deals in either direction, log
calls from a dialer, draft page changes for a person to review and publish, back up
records, or build an integration.

:::info Plan availability
The REST API is included on **Starter**, **Pro** and **Custom**. Create keys from
**Organization → Settings → API keys**. What differs by plan is how much: Starter
includes 500 requests a month and stops at 20,000, at 120 a minute for the whole
workspace; Pro includes 1,500 with no monthly ceiling, at 600 a minute; Custom's
limits are set by your agreement. See [Rate limits & usage](rate-limits.md).
:::

## Base URL

```
https://app.aglyn.com/api/v1
```

All requests are over HTTPS and every response is JSON. The version lives in the path;
there's no version header.

## Quick start

Check your key and see what it can do:

```bash
curl https://app.aglyn.com/api/v1/me \
  -H "Authorization: Bearer aglyn_sk_your_key_here"
```

```json
{
  "object": "api_key",
  "org": "org_abc123",
  "name": "Warehouse sync",
  "scopes": ["datasets:read", "datasets:write"]
}
```

Then read some data — here, the first page of a dataset's records:

```bash
curl "https://app.aglyn.com/api/v1/datasets" \
  -H "Authorization: Bearer aglyn_sk_your_key_here"

curl "https://app.aglyn.com/api/v1/datasets/ds_team/records?limit=100" \
  -H "Authorization: Bearer aglyn_sk_your_key_here"
```

### In JavaScript

```js
const res = await fetch('https://app.aglyn.com/api/v1/datasets/ds_team/records', {
  headers: { Authorization: `Bearer ${process.env.AGLYN_API_KEY}` },
})
if (!res.ok) {
  const { error } = await res.json()
  throw new Error(`${error.type}: ${error.message}`)
}
const { data, next_cursor, has_more } = await res.json()
```

### Paging through everything

Lists are ordered by id and paged with an opaque cursor, so a full sync is a loop:

```js
let cursor = null
const all = []
do {
  const url = new URL('https://app.aglyn.com/api/v1/datasets/ds_team/records')
  url.searchParams.set('limit', '100')
  if (cursor) url.searchParams.set('cursor', cursor)
  const page = await fetch(url, {
    headers: { Authorization: `Bearer ${process.env.AGLYN_API_KEY}` },
  }).then((r) => r.json())
  all.push(...page.data)
  cursor = page.next_cursor
} while (cursor)
```

Read [ordering](conventions.md#ordering) before you assume page 1 holds the newest
records — it doesn't.

## Machine-readable description {#openapi}

The whole API is described as [OpenAPI 3.1](https://spec.openapis.org/oas/v3.1.0) at:

```
GET https://app.aglyn.com/api/v1/openapi.json
```

**It needs no key.** A description of how to authenticate that itself required
authentication would be useless at the only moment you want it, and it contains nothing
this documentation does not already publish.

Point a generator at it and you get a typed client — every resource, every filter, the
pagination envelope and the error shape, without hand-writing types this API already
knows:

```bash
npx @openapitools/openapi-generator-cli generate \
  -i https://app.aglyn.com/api/v1/openapi.json -g typescript-fetch -o ./aglyn-client
```

Two things to know when reading it:

- The schemas use JSON Schema **2020-12**, so a field that can be `null` is a type
  *union* (`"type": ["string", "null"]`), not OpenAPI 3.0's `nullable: true`. A
  generator that only understands 3.0 will get optionality wrong.
- Most write bodies **close** — an unknown field is rejected, not ignored. The
  exceptions read only the members they document and ignore the rest:
  [datasets and records](resources/datasets.md), whose record `values` also drop any
  field id the dataset's model doesn't define; [creating a site](resources/sites.md#create);
  and [media uploads](resources/media.md).

## MCP server {#mcp}

The same API is served as [Model Context Protocol](https://modelcontextprotocol.io)
tools, for AI assistants, code editors and agents:

```
https://app.aglyn.com/api/mcp
```

Any MCP client can connect. Give it an API key as a bearer token, or give it nothing
and it asks the person to [sign in](authentication.md#apps-that-sign-in) and pick a
workspace and an access level — no key is copied anywhere. Either way, a tool call
runs through the same pipeline a request does, with the same scopes, rate limit and
usage meter.

The transport is Streamable HTTP and the server keeps no session. A client that is
only given the address finds everything else on its own:

| Document | Address |
| --- | --- |
| Server card ([SEP-2127](https://modelcontextprotocol.io/seps/2127-mcp-server-cards)) | `https://app.aglyn.com/api/mcp/server-card` |
| Protected resource ([RFC 9728](https://www.rfc-editor.org/rfc/rfc9728)) — named by the `401` | `https://app.aglyn.com/.well-known/oauth-protected-resource/api/mcp` |
| Authorization server ([RFC 8414](https://www.rfc-editor.org/rfc/rfc8414)) | `https://app.aglyn.com/.well-known/oauth-authorization-server` |
| API catalog ([RFC 9727](https://www.rfc-editor.org/rfc/rfc9727)), on every published site | `/.well-known/api-catalog` |

The tool list is the server's own answer to `tools/list`, generated from the
[OpenAPI description](#openapi), and depends on what the key or connection may do.

## Service endpoints

Three endpoints need no scope; any valid key can call them.

### `GET /v1`

What this API is and what it serves.

```json
{
  "object": "api",
  "name": "Aglyn REST API",
  "version": "v1",
  "documentation": "https://docs.aglyn.com/api",
  "openapi": "/api/v1/openapi.json",
  "mcp": "/api/mcp",
  "resources": ["sites", "media", "contacts", "companies", "pipelines", "deals", "tasks", "activities", "leads", "email-templates", "datasets"]
}
```

This lists only **top-level** resources. Form submissions, [pages](resources/pages.md),
[templates](resources/templates.md), [orders](resources/orders.md)
and [products](resources/products.md) all live under a site
(`/v1/sites/{siteId}/…`) and are deliberately absent, so a client that walks this list
never builds a path that 404s. `media` is here because
[`/v1/media`](resources/media.md) — the *organization* library — really is a top-level
path; each site's own files are additionally at `/v1/sites/{siteId}/media`. The five
CRM resources are organization-level like contacts, and so are top-level here. Leads are
a site's rows, but the path is `/v1/leads` with the site as a
[parameter](resources/leads.md#site), so the path is what is listed.

### `GET /v1/me`

Introspect the key you're calling with — useful for verifying a key after rotation, or
for failing fast at startup with a clear message. `name` is the name the key was given
when it was created, or `null` for a key from before names were required.

```json
{
  "object": "api_key",
  "org": "org_abc123",
  "name": "Warehouse sync",
  "scopes": ["datasets:read", "datasets:write"]
}
```

Called by an app that [signed in](authentication.md#apps-that-sign-in) instead of using a
key, `object` is `"connected_app"` and `name` is the name the app registered under; the
other fields are the same. Its writes appear in activity as *Connected app* followed by
that name, where a key's appear as *API key* and the key's name.

### `GET /v1/usage`

Where you stand against every plan band this month — requests, contacts, datasets and
dataset storage — and, for each, whether crossing it bills or refuses; plus the size of
each CRM collection, for sizing a sync. See [Usage](usage.md).

```json
{
  "object": "usage",
  "month": "2026-08",
  "apiRequests": { "used": 18422, "included": 100000, "remaining": 81578, "metered": true, "ceiling": null, "unitBytes": 262144 }
}
```

## Resources

| Resource | Description |
| --- | --- |
| [Datasets & records](resources/datasets.md) | Create, read, update, and delete datasets and the records inside them — the one resource the API can provision from nothing. |
| [Contacts](resources/contacts.md) | Read your organization's contacts, add the people your own systems own, and edit their name, tags, notes and CRM profile. |
| [Companies](resources/companies.md) | The accounts your contacts work for — keyed by domain, with an owner and an address. |
| [Pipelines](resources/pipelines.md) | The stages a deal moves through. Read-only; seeded by the first deal. |
| [Deals](resources/deals.md) | Opportunities with a value, a stage and a status — create them, move them, close them. |
| [Tasks](resources/tasks.md) | Calls, emails, meetings and to-dos with a due date, against a contact, company or deal. |
| [Activities](resources/activities.md) | What happened — a write-once log of calls, meetings and notes. |
| [Leads](resources/leads.md) | A site's work queue — everyone it has captured, with status, owner and notes — and the conversion of a lead into a contact, a company and a deal. |
| [Email templates](resources/email-templates.md) | The letters a team sends from a record — templates and snippets, with merge fields. |
| [Sites](resources/sites.md) | List sites, read their details, create a site, and publish one — including making chosen pages' drafts live. |
| [Pages](resources/pages.md) | A site's pages and folders — create, rename, re-address, move and delete them — what is on each page, edited as a draft until it is published, and each page's search listing. |
| [Templates](resources/templates.md) | The page templates a new page can start from: the site's own and the built-in starter pages. |
| [Search listing](resources/seo.md) | Read and change the title and description a site shows in search results, and how its page titles are built. |
| [Business details](resources/business-details.md) | Read and change a site's business name, slogan, phone, email, address and social links. |
| [Form submissions](resources/form-submissions.md) | Read a site's form submissions, mark them read as you process them, and delete them after export. |
| [Orders](resources/orders.md) | Read a site's store orders — line items, totals, refunds, disputes — and record shipments against them. |
| [Products](resources/products.md) | Read and write a site's catalog — add, edit and delete products, and change variants' prices and stock. |
| [Media](resources/media.md) | List and upload files in the organization library and in each site's media. |

Orders and products need a plan that includes **commerce**, in addition to their
scope — see each page's plan note. Companies, pipelines, deals, tasks, activities,
leads and email templates need a plan that includes the **CRM suite** (Starter and
above); a plan without it answers `plan_required` with `code: "crm"` on all seven, while
contacts keep working.

For event-driven integrations, see [Webhooks](integrations/webhooks.md) — push instead
of poll.

## Everything you need to know

- [Authentication](authentication.md) — API keys and scopes.
- [Rate limits & usage](rate-limits.md) — 120 requests/minute per key, and how the
  monthly quota bills.
- [Conventions](conventions.md) — pagination, ordering, errors, and idempotency.
