---
sidebar_position: 3
title: Sites
description: List your organization's sites, read their details, create a site, and publish one — including making chosen pages' drafts live.
---

# Sites

List the sites in your organization, read their details, and
[create](#create) new ones. Renaming and deleting a site stay console actions. You can
[publish](#publish) a site, which is what makes writes you made elsewhere in the API
appear on the live pages — and, given a list of pages, makes those pages' drafts live.

Several things under a site are resources of their own, with their own scopes:
[pages](pages.md) — with what is on each and its search listing — the site's
[page templates](templates.md), the site's
[search listing](seo.md), its [business details](business-details.md), its
[products](products.md) and [orders](orders.md), its
[form submissions](form-submissions.md), and its [media](media.md).

## The site object

```json
{
  "id": "host_demo",
  "object": "site",
  "displayName": "Demo Bakery",
  "subdomain": "demo",
  "domain": null
}
```

| Field | Type | Notes |
| --- | --- | --- |
| `id` | string | Site id — use it in the paths below. |
| `object` | string | Always `"site"`. |
| `displayName` | string \| null | Name shown in the console. |
| `subdomain` | string \| null | The `{subdomain}.aglyn.app` address. |
| `domain` | string \| null | The **custom domain**, once verified — `null` if the site only uses its subdomain. |

## The form submission object

```json
{
  "id": "sub_1",
  "object": "form_submission",
  "form": "contact",
  "path": "/contact",
  "fields": { "email": "hi@example.com", "message": "Hello!" },
  "read": false,
  "created": "2026-07-20T18:23:23.950Z"
}
```

| Field | Type | Notes |
| --- | --- | --- |
| `form` | string \| null | The form's name — what you filter on. |
| `path` | string \| null | The page path it was submitted from. |
| `fields` | object | Submitted values, keyed by field name. Shape follows the form's design, so it varies per form. |
| `read` | boolean | Whether it's been marked read in the console inbox. Reading over the API doesn't change it. |
| `created` | string \| null | ISO 8601. |

## Endpoints

### List sites

`GET /v1/sites` — scope `sites:read`. [Paginated](../conventions.md#pagination),
ordered by site id.

```bash
curl "https://app.aglyn.com/api/v1/sites" \
  -H "Authorization: Bearer aglyn_sk_…"
```

### Create a site {#create}

`POST /v1/sites` — scope `sites:write`. Accepts an
[`Idempotency-Key`](../conventions.md#idempotency).

```bash
curl -X POST "https://app.aglyn.com/api/v1/sites" \
  -H "Authorization: Bearer aglyn_sk_…" \
  -H "Idempotency-Key: $(uuidgen)" \
  -H "Content-Type: application/json" \
  -d '{ "displayName": "Demo Bakery", "subdomain": "demo-bakery" }'
```

| Field | Required | Notes |
| --- | --- | --- |
| `displayName` | yes | Name shown in the console. Trimmed, truncated at 80 characters. |
| `subdomain` | yes | 3–30 characters: lowercase letters, numbers and hyphens, starting with a letter or number. Becomes `{subdomain}.aglyn.app`. |

Returns `201` with the [site object](#the-site-object). A replayed request returns the
**same site** with `200` — so if you retry after a dropped connection, compare the
status to tell a fresh create from a replay.

**Send an `Idempotency-Key`.** Subdomains are globally unique, so a retry that reuses
the same one happens to 409 — but that is an accident of the namespace, not a
guarantee. If your client generates a subdomain per attempt, a retry without a key
creates a **second site**, which consumes a slot of your site allowance.

Refusals:

| Status | `code` | Means |
| --- | --- | --- |
| `400` | `validation_failed` | Missing `displayName`, or a `subdomain` that is malformed or reserved. Never consumes the idempotency key — fix the body and retry with the same one. |
| `403` | `site_quota` | Your plan's site limit is reached. Upgrade or add extra sites, then retry with the same key. |
| `409` | `subdomain_taken` | Something already uses that subdomain. The message lists free alternatives. Also the answer when another request claims the same subdomain at the same moment: uniqueness is settled inside the transaction that creates the site, so exactly one of two simultaneous creates wins and the loser writes nothing at all — no site, no slot spent. |
| `429` | — | More than 10 creates in an hour for this organization. Honor `Retry-After`. |

Each of those releases the key, so the retry that should finally succeed is not
answered with a replay of the refusal.

Renaming and deleting a site are deliberately **not** available over the API. A delete
would erase every page, version, product and uploaded file immediately, with no hold
and no undo, from one field in a request body — that is not something to expose to an
automated caller before a soft-delete exists.

### Retrieve a site

`GET /v1/sites/{siteId}` — scope `sites:read`.

A site your organization doesn't own returns `404 not_found` (`"No such site"`) rather
than `403` — the API doesn't reveal whether an id exists elsewhere. So a `404` here
means "not yours or not real", not "your key is missing a scope". A
[connected app](../conventions.md#site-access) gets the same `404` for a site its person
is not a member of.

### Publish {#publish}

`POST /v1/sites/{siteId}/publish` — scope `sites:publish`. The body is optional: with [`pages`](#publish-pages) it also makes those pages' drafts live.

Refreshes the site's live pages so data you wrote over the API appears **now** instead
of when the cache happens to expire.

You need this more often than it first looks. Writing a
[dataset record](datasets.md) changes what a page *would* render, but a live page is
cached: pages are rebuilt at most once an hour, the dataset reads behind them are
cached for an hour as well, and the page cache is stale-while-revalidate — the first
visitor after the window still gets the old copy while the new one is built behind
them. So without a publish, "my record is in the API but not on the site" is the
expected behavior for an hour or more, and you cannot tell it apart from a write that
failed.

```bash
curl -X POST "https://app.aglyn.com/api/v1/sites/host_demo/publish" \
  -H "Authorization: Bearer aglyn_sk_…"
```

```json
{
  "object": "publish",
  "site": "host_demo",
  "published": true,
  "reason": null,
  "pages": 12,
  "pagesDropped": 0
}
```

| Field | Notes |
| --- | --- |
| `published` | `true` when the site's pages were refreshed. **Check it** — see below. |
| `reason` | `null` on success. Otherwise why not: `"not_routed"` (the site has no live pages yet), `"not-configured"`, `"tenant-{status}"`, `"error"`. |
| `pages` | How many cached pages were dropped. |
| `pagesDropped` | Pages **not** refreshed because the site exceeded the 250-page limit for one call. They catch up on their own when their cached copy expires, within the hour. |
| `promoted` | Only when the request named [`pages`](#publish-pages): what happened to each. |

A `200` does **not** always mean published. `published: false` with a `reason` is the
honest answer for a site with nothing routed yet, or a refresh we could not complete —
reported rather than hidden, because otherwise you would poll a page that is never
going to change. Treat `published` as the field that matters, not the status code.

Publishing is **idempotent and takes no `Idempotency-Key`**: publishing twice lands the
same state and returns the same answer.

#### Publish pages {#publish-pages}

Send a body with `pages`, a list of 1 to 25 page ids, to make those pages' **drafts**
live as well — what the editor's **Publish** does for one page. This is how
[edits to a page's content](pages.md#edit-content) and a [new page](pages.md#create)
reach visitors.

```bash
curl -X POST "https://app.aglyn.com/api/v1/sites/host_demo/publish" \
  -H "Authorization: Bearer aglyn_sk_…" \
  -H "Content-Type: application/json" \
  -d '{ "pages": ["scr_about", "scr_catering"] }'
```

For each page, in order:

| The page | What publishing it does | `status` |
| --- | --- | --- |
| Published, with a draft | The draft is saved into the page's live version, **replacing what the page showed**, and the draft is cleared. The version it replaces is not kept. | `published` |
| Published, with no draft | Nothing; it is left as it is. | `unchanged` |
| Not yet published | Its draft, if it has one, is saved into its version, and the page is published at its own address (its `slug` under its parent's address), with any published pages below it. | `published` |
| The site's placeholder home page | Its draft is saved, and its address is republished as the site's own home page. | `published` |

**Every page is checked before any is written.** If one is refused, nothing is
published and the publish budget is not spent. After the pages, the site's live pages
are refreshed exactly as a publish without a body does.

```json
{
  "object": "publish",
  "site": "host_demo",
  "published": true,
  "reason": null,
  "pages": 14,
  "pagesDropped": 0,
  "promoted": [
    { "page": "scr_about", "status": "published", "path": "/about" },
    { "page": "scr_catering", "status": "published", "path": "/catering" }
  ]
}
```

`promoted` is present only when you sent `pages`: one line per page, with its address
as a visitor types it. A retry is safe: a page whose draft already went live has no
draft left and answers `unchanged`.

Only a site's ordinary pages are published this way. **Layouts, reusable components,
email designs and templates are never published by it**, and neither is any page you
did not name. A body with no `pages` member, or no body at all, only refreshes the
live pages, as before.

With `pages`, a [connected app](../conventions.md#site-access) needs its person's
**Publish site content** permission on the site, not only **Edit site content**.

##### When a page is refused {#publish-refusals}

A refusal answers with the first refused page's status and reason in the usual error
envelope, and every page's line beside it in `results`:

```json
{
  "error": {
    "type": "conflict",
    "message": "This page’s draft was started before its last save, so it is out of date. Open it in the editor to bring it up to date, then publish.",
    "code": "stale_draft"
  },
  "results": [
    { "page": "scr_about", "status": "refused", "code": "stale_draft", "message": "This page’s draft was started before its last save, so it is out of date. Open it in the editor to bring it up to date, then publish." },
    { "page": "scr_catering", "status": "not_attempted" }
  ]
}
```

A body that is not valid — not a JSON object, `pages` not 1 to 25 distinct page ids,
or another member beside it — is an ordinary `400` with `code: "validation_failed"` and
`fields`, and no `results`. Each page's own refusals:

| Status | `code` | Means |
| --- | --- | --- |
| `400` | `not_a_page` | The id is an email design, an error page, a collection template or a folder. |
| `400` | `no_slug` | A page not yet published has no address (`slug`). [Give it one](pages.md#update) first. |
| `400` | `slug_path_separator` | The page's address holds a `/`. |
| `400` | `reserved_address` | The page, or a published page below it, would take a reserved address. |
| `404` | `page_not_found` | No such page on this site, or it is deleted. |
| `409` | `stale_draft` | The page's draft was started before its last save, so it is out of date. Open it in the editor to bring it up to date, then publish. |
| `409` | `scheduled_publish_pending` | A scheduled publish is waiting on the page. Cancel it or run it in the console first. |
| `409` | `forms_off_for_site` | The page carries a form, and Forms is switched off for the site. |
| `409` | `no_version` | The page has no saved version to publish. |
| `409` | `unpublished_ancestor` | The page sits under a page that is not published yet. Publish the parent first. |
| `409` | `address_taken` | Another published page holds the address, or another page in the same request would take it. |
| `409` | `address_changed` | The page is live at one address, and publishing it would move it to another. Publish it from the editor. |
| `409` | `publish_from_editor` | The page's saved version has layout style overrides (its own restyles of the layout it sits in), and its draft does not carry them: a draft whose author cleared them in the editor, or a draft an [API edit](pages.md#edit-content) or an AI edit saved before those edits kept them. Publishing could keep them or clear them, and the draft cannot say which, so publish this page from the editor. A draft made by an API edit now carries the overrides, and publishes with them. |
| `409` | `page_changed` | The page changed while it was being published. Nothing was published; try again. |
| `413` | `page_too_large` | The page is over 900,000 bytes. |

A refusal found while writing — another writer changed a page between the check and
the write — stops there: the response carries `promoted` with what already went live,
and `results` with every page's line, so nothing is claimed that did not happen. If a
new page's draft was saved but its address was then refused (`code: "route_refused"`),
its line says `"draftSaved": true`: the page still has no address, so no visitor sees
it.

##### When a publish fails partway {#publish-failures}

An unexpected error — not a refusal — can stop a publish after some pages went live.
The answer is then `500` with `type: "internal_error"`, and still says exactly what
happened:

```json
{
  "error": {
    "type": "internal_error",
    "message": "Something went wrong while publishing the pages. The pages in `promoted` went live; see `results` for the rest.",
    "code": "internal_error"
  },
  "promoted": [
    { "page": "scr_about", "status": "published", "path": "/about" }
  ],
  "results": [
    { "page": "scr_about", "status": "published", "path": "/about" },
    {
      "page": "scr_catering",
      "status": "failed",
      "message": "An unexpected error stopped this page’s publish after its draft was saved into the page; the page has no address yet, so no visitor sees it. Publish it again.",
      "draftSaved": true
    },
    { "page": "scr_menu", "status": "not_attempted" }
  ]
}
```

`promoted` lists the pages that were done before it stopped (`published` or
`unchanged`). `results` has one line per page you named, in order: those done, then
the page that failed (`status: "failed"`), then `not_attempted` for every page after it. The failed page's line says only what is known
to have been written for it:

| The failed line | Means |
| --- | --- |
| No `draftSaved` | Nothing was written for the page, or what was written is not known. Its `message` says which; read the page before publishing it again if it says so. |
| `"draftSaved": true`, no `path` | Its draft was saved into the page, which has no address yet, so no visitor sees it. |
| `"draftSaved": true` and a `path` | Its draft is live at that address; only republishing the address as the site's home page did not finish. |

Publishing the same pages again is safe: a page whose draft already went live answers
`unchanged`.

If every named page went live and the **refresh** of the site's live pages afterwards
fails, the answer is also `500` with `type: "internal_error"`, now with
`code: "refresh_failed"`, and `promoted` and `results` both list every page's outcome.
Those pages are published; publish again without `pages` to refresh the live
copies.

#### It is rate limited per site, not per key {#publish-limit}

**10 publishes per site per hour**, counted separately from the
[120 requests a minute](../rate-limits.md) your key gets. One publish can drop up to
250 pages and each one costs real work to rebuild, so this limit is sized to the work
rather than to the request — and minting more keys does not raise it, because the
budget belongs to the site.

Over budget returns `429 rate_limited` with a `Retry-After`. Nothing is lost when it
does: the hour-long cache is still underneath, so the change appears on its own — an
hour or more later rather than now.

Publish **once at the end of a batch**, not after every record. A sync that writes 500
records and publishes once is both faster and within budget; one that publishes per
record is refused after ten and gains nothing over waiting.

A connected app publishes only where its person has **Edit site content** on the site
— and **Publish site content** when the request names `pages` — see
[Conventions → Sites a connected app can reach](../conventions.md#site-access).

#### Writes that are live without a publish {#live-when-saved}

Some writes refresh the live site themselves, because the console has no draft for
them either: [products](products.md#live-when-saved), a site's
[search listing](seo.md#live-when-saved), a page's
[search listing](pages.md#live-when-saved),
[business details](business-details.md#live-when-saved), and a published page's
[name, description, address or place](pages.md#update) and its
[deletion](pages.md#delete). Each is saved at once and the live site refreshes right
away — no publish needed, and none of them spends the publish budget.

[Edits to a page's content](pages.md#edit-content) are **not** among them: they are
saved as the page's draft, and visitors see them only once the page is
[published](#publish-pages).

Because there is nothing to review afterwards, an app acting for a person should show
the change and get their approval before it sends the write.

### Form submissions

Moved to their own page: [Form submissions](form-submissions.md). They live under a
site (`/v1/sites/{siteId}/form-submissions`) but carry their own scopes — `forms:read`
to read, `forms:write` to mark read or delete — and, unlike a site, they can be
written.

## Errors

| Status | `type` | When |
| --- | --- | --- |
| `403` | `insufficient_scope` | Key lacks `sites:read`, or `sites:publish` on the publish path. |
| `400` | `bad_request` | `code: "validation_failed"` — a publish body that is not valid; see [When a page is refused](#publish-refusals). |
| `403` | `forbidden` | `code: "site_permission_required"` — a [connected app](../conventions.md#site-access) publishing a site its person can't edit, or naming `pages` without the permission to publish. |
| `404` | `not_found` | Unknown or unowned site; unknown sub-path. |
| `405` | `method_not_allowed` | Anything other than `GET`, or anything other than `POST` on `/publish`. |
| `423` | — | The site is [locked](../conventions.md#site-access): every call on it while the lock lasts, or only writes under a read-only lock. |
| `400`, `404`, `409`, `413` | — | A page named in `pages` was refused. See [When a page is refused](#publish-refusals). |
| `429` | `rate_limited` | The site's [publish budget](#publish-limit) is spent. Carries `Retry-After`. |
| `500` | `internal_error` | A publish of `pages` stopped partway (`code: "internal_error"`), or the refresh after them failed (`code: "refresh_failed"`). Both still say what went live; see [When a publish fails partway](#publish-failures). |
