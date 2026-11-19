---
sidebar_position: 2
title: Authentication
description: Authenticate REST API requests with an organization API key, scoped to exactly what it needs.
---

# Authentication

Every request authenticates with an **API key** — a secret that identifies your
organization. Keys look like `aglyn_sk_…`. An app that acts for a person — an AI
assistant or a code editor that speaks MCP — can [sign in](#apps-that-sign-in) instead.

A key carries the organization's access, not a person's: it keeps working after the
teammate who created it leaves, and it isn't limited by their role.

## Create a key

1. In the console, go to **Organization → Settings → API keys**.
2. Choose **Create API key**, give it a name, and select its **scopes**.
3. Copy the key **when it's shown** — it is displayed only once. Aglyn stores only a
   hash and can never show it again. If you lose it, revoke it and create a new one.

Only organization **owners and admins** can create or revoke keys; any member can see
the list. The list shows each key's name, scopes, a truncated prefix
(`aglyn_sk_ab12cd…`) to identify it, and roughly when it was last used — that
timestamp updates at most once a minute, so it's for spotting unused keys, not for
auditing individual calls.

Keys **don't expire**. A key stays valid until you revoke it, so rotate deliberately.

## Send the key

Pass the key as a bearer token:

```bash
curl https://app.aglyn.com/api/v1/datasets \
  -H "Authorization: Bearer aglyn_sk_your_key_here"
```

The header `X-Api-Key: aglyn_sk_…` is also accepted. If both are present,
`Authorization: Bearer` wins.

Check a key at any time with [`GET /v1/me`](overview.md#get-v1me), which tells you
which organization it belongs to and what it can do.

A missing, malformed, revoked, or expired key returns `401`:

```json
{ "error": { "type": "unauthorized", "message": "Invalid or missing API key" } }
```

If the organization's plan doesn't include API access, requests return `403`
`plan_required` — the API is included on [Starter, Pro and Custom](overview.md). A key
whose organization has been downgraded stops working without being revoked.

## Scopes

A key is granted only the scopes you select, and a request that needs a scope the key
lacks returns `403` `insufficient_scope`. Grant the least a key needs.

| Scope | Grants |
| --- | --- |
| `datasets:read` | List datasets, read records. |
| `datasets:write` | Create, update, and delete datasets and their records. |
| `contacts:read` | List and read contacts. |
| `contacts:write` | Add contacts, edit their name, tags and notes, and delete them. Never changes the email a contact is identified by, or where it came from. |
| `sites:read` | List sites and read their details. |
| `sites:publish` | Refresh a site's live pages so writes made over the API appear immediately, and [publish chosen pages](resources/sites.md#publish-pages), which makes their drafts live. Also needed beside `pages:write` for any change to an already-published page. |
| `sites:write` | Create new sites in the organization. Counts against your site allowance. Cannot rename or delete a site. |
| `forms:read` | Read a site's form submissions. |
| `forms:write` | Mark a site's form submissions read or unread, and delete them. Never edits what a visitor typed. |
| `orders:read` | Read a site's store orders. |
| `orders:write` | [Record a shipment](resources/orders.md#record-a-shipment): mark an order fulfilled or delivered and attach a carrier and tracking number. Cannot cancel or refund an order, and never moves stock or money. |
| `products:read` | Read a site's products, variants, prices and stock. |
| `products:write` | [Add, edit and delete](resources/products.md#create-a-product) a site's products, and change a variant's price, SKU, barcode, weight and stock. Variants follow the product's options; a single variant cannot be added or removed on its own, and a digital product is made in the console. A change to a product on sale is live in the store when saved. |
| `bookings:read` | Read a site's [bookings](resources/bookings.md): the service, the time, the guest and what they paid. Cannot move or cancel a booking. |
| `media:read` | List files in the organization library and in a site's media. |
| `media:write` | Upload files to the organization library and to a site's media. Cannot replace, edit or delete an existing file. |
| `crm:read` | List and read [companies](resources/companies.md), [pipelines](resources/pipelines.md), [deals](resources/deals.md), [tasks](resources/tasks.md), [activities](resources/activities.md) and [email templates](resources/email-templates.md), across the organization. |
| `crm:write` | Add, edit and delete companies, deals, tasks and email templates, and log or delete activities, each on behalf of a named site. Cannot edit a pipeline's stages, and cannot edit an activity once logged. |
| `pages:read` | List and read a site's [pages](resources/pages.md) and folders: their names, public addresses, whether they are published, and their search listings; and [read what is on a page](resources/pages.md#get-content), from its waiting draft or its saved version. |
| `pages:write` | [Create](resources/pages.md#create), [rename, re-address, move](resources/pages.md#update) and [delete](resources/pages.md#delete) a site's pages, and [edit what is on a page](resources/pages.md#edit-content). A content edit is saved as the page's draft and goes live only when the page is published, which takes `sites:publish`; a new page starts unpublished. Any change to a page that is already published, and deleting one, also needs `sites:publish`. Cannot change the theme, layouts, reusable components or templates. |
| `components:read` | List a site's [page templates](resources/templates.md), the starting points a new page can be created from. Cannot create or change a template. |
| `seo:read` | Read a site's [search listing](resources/seo.md) and each page's. |
| `seo:write` | Change a site's search title, description, separator and title pattern, and a page's search title, description and breadcrumb label. Live when saved. Cannot change the search-indexing switch, verification codes or the social image. |
| `business:read` | Read a site's [business details](resources/business-details.md): name, slogan, phone, email, address and social links. |
| `business:write` | Change a site's business details. Live when saved. |

`crm:read` and `crm:write` are one pair for five resources rather than five pairs,
because a key that needs any of them needs the set: a deal names a company and a
contact, a task names a deal, an activity names all three, and a key that could read
deals but not the pipelines whose stages they cite would hand back stage ids it cannot
explain. A contact's own CRM profile — phone, job title, company, owner, lifecycle
stage — stays under `contacts:read` / `contacts:write`, because it is a field of the
[contact](resources/contacts.md#crm-profile) and reads with the contact.

`forms:write` is deliberately narrow. It grants the `read` flag and the delete, and
nothing that rewrites a submission's `fields` — a submission is a record of what a
visitor typed, and an API that could edit it would make the inbox unattributable. See
[form submissions](resources/form-submissions.md#read-is-the-only-writable-field).

`contacts:write` is narrow for the same kind of reason. It adds, edits and deletes
contacts, and cannot touch the two fields that would make the list untrustworthy: the
`email` a contact is unified on, and the `sources` recording where the person came
from. See [contacts](resources/contacts.md#read-only-fields).

Some changes have no write scope at all, and the omission is deliberate in each case
rather than an oversight:

- **Canceling and refunding an order.** `orders:write` stops precisely at the line
  where money moves: it records shipments, which change no money and no stock. A
  cancel returns held inventory and a refund returns money, each under its own
  transaction with its own decisions, so both stay in the console. A write scope for
  them belongs to the change that ships the endpoint, not ahead of it — a scope you
  can grant that grants nothing is a broken permission.
- **Renaming and deleting a site.** `sites:write` creates; it deliberately stops
  there. A delete would erase a whole site — pages, versions, products, uploaded
  files — immediately, from one field in a request body, with no hold and no undo.
- **A site's theme, layouts, reusable components and templates.** `pages:write` edits
  what is on a page, element by element, and `components:read` lists templates; the
  theme, the layouts pages sit in, the components they reuse, and the templates
  themselves are edited in the console.

```json
{
  "error": {
    "type": "insufficient_scope",
    "message": "Missing the \"datasets:write\" scope",
    "code": "datasets:write"
  }
}
```

Scopes are independent — there's no hierarchy. `datasets:write` does **not** imply
`datasets:read`; a key that both writes and reads back needs both.

Two endpoints need no scope at all: [`GET /v1`](overview.md#get-v1) and
[`GET /v1/me`](overview.md#get-v1me). Any valid key can call them.

## Apps that sign in

An app that acts for a person — any Model Context Protocol client, such as an AI
assistant, a code editor or an MCP inspector — doesn't need a key. Point it at
`https://app.aglyn.com/api/mcp` and it asks the person to sign in, pick a
workspace and choose **View only** or **View and make changes**. Nothing is
copied anywhere. The consent screen names the app as it names itself and shows,
above everything else, the address the app will receive the connection at.

What the app receives instead of a key:

- An **access token** (`aglyn_at_…`) that lasts one hour, sent as
  `Authorization: Bearer aglyn_at_…` exactly as a key is. It works on `/api/v1`
  and `/api/mcp`, with the same rate limit, plan check and usage meter, and the
  scopes the person's choice grants: every `:read` scope for View only, every
  scope for View and make changes.
- A **refresh token** (`aglyn_rt_…`) that the app trades for a new pair. Each one
  works once. A retry within 30 seconds of the trade is refused and changes
  nothing, so an app that lost the answer is not disconnected; used again any
  later, it ends the connection.

A connection's writes appear in activity as *Connected app* followed by its name, and
[`GET /v1/me`](overview.md#get-v1me) answers `"object": "connected_app"` for it. A lock on
the workspace refuses a connection for as long as it lasts without ending it, as it
does an API key.

On a site, a connection can reach only what its person can: a site they are not a
member of answers `404`; writing a site's products, search listing or business
details, uploading to its media, creating a page, changing a page's name or
description, editing what is on a page, or publishing the site needs their **Edit site
content** permission on it; and changing a page's address or place, deleting a page,
or publishing named pages needs their **Publish site content** permission — see
[Conventions → Sites a connected app can reach](conventions.md#site-access).

A connection is a person's, unlike a key. Connecting takes the **Manage API keys**
permission in the workspace, and the connection stops working the moment that
person leaves the workspace or loses the permission, or someone disconnects it
under **Settings → API keys → Connected apps**.

For client developers, it is OAuth 2.1 with PKCE, public clients only:

| | |
| --- | --- |
| Discovery | A `401` from `/api/mcp` carries `WWW-Authenticate: Bearer resource_metadata="https://app.aglyn.com/.well-known/oauth-protected-resource/api/mcp"`; the same document is also at `/.well-known/oauth-protected-resource`. The authorization server is described at `/.well-known/oauth-authorization-server` (RFC 8414). Both list every scope in `scopes_supported` and link back here. The server card (SEP-2127) is at `/api/mcp/server-card`. |
| Missing scope | A call the token's scopes do not cover is answered `403` with `error.type` `insufficient_scope` and `WWW-Authenticate: Bearer error="insufficient_scope", scope="…"` naming the scope it needs. Over MCP the same refusal is the tool call's result. |
| Registration | Dynamic (RFC 7591) at `/api/oauth/register`, open to any client. Send `client_name` and up to five `redirect_uris`. The name is normalized (NFKC), quotation marks and control, invisible and blank characters are removed, and it is capped at 60 characters; a name with no letter or digit becomes *Unnamed app*, and a name that is or contains the platform's own name is refused. No client secret is issued, and an identical registration returns the same `client_id` with `201`. A registration nobody approves expires after 7 days. |
| Redirect addresses | Each must be exactly as a URL parser prints it, with no user info and no fragment, and one of: `https://` on a domain name (not an IP address, and not one of this platform's own domains or a site published on it), any path; or `http://` on `localhost`, `127.0.0.1` or `[::1]` only, any port. **Native and desktop clients use a loopback address.** Custom app-link schemes are not accepted, because the scheme decides which program is launched; an app-link callback can be added for a client on request, as one exact address. Addresses outside these rules are dropped from a registration, which fails only if none is left. At sign-in the `redirect_uri` must match a registered one exactly, except that a loopback port may differ. |
| Consent | The person sees the address the app will receive the connection at — the full host and path, or *an app on this computer* — above the name the app gave itself, and chooses a workspace and **View only** (always offered, and the default) or **View and make changes**. Nothing navigates away from the page until they press a button; a request that is wrong is shown on the page, and Cancel returns the error to the app. |
| Browser clients | `/api/mcp` answers CORS from any origin without credentials, and exposes `WWW-Authenticate` and `MCP-Protocol-Version`. |
| Authorization | `/oauth/authorize` with `response_type=code`, `code_challenge_method=S256` and a `state`. The answer carries `iss`. |
| Token | `/api/oauth/token`, form-encoded, `authorization_code` or `refresh_token`. Codes last five minutes and work once. |
| Revocation | `/api/oauth/revoke` (RFC 7009). Revoking a refresh token ends the connection. |
| Limits | A code or refresh token that resolves is never refused by a failure limit. Guesses — well-formed secrets that resolve to nothing — are counted per address, and past 30 a minute a further guess is answered `429` with `error: "invalid_request"` and `Retry-After`; lookups of any kind are capped at 600 a minute per address. While the workspace is locked, a refresh is answered `503` with `error: "temporarily_unavailable"` and `Retry-After`: keep the refresh token and retry. Each account may approve 30 times per 10 minutes and bring at most 20 new apps into use a day. Registration allows 300 requests and 20 new clients per address per 10 minutes. In an MCP batch, every `tools/call` is charged as its own request; one the budget no longer covers returns the `429` body as that call's result. |

## Keep keys safe

- Treat a key like a password. Never commit it to source control or expose it in
  client-side code — it carries your organization's access.
- Use a separate key per integration so you can revoke one without affecting the
  others, and so the "last used" column tells you something.
- Revoke a key the moment it's no longer needed, from the same settings page. Revoking
  takes effect immediately.
