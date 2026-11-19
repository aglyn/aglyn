---
sidebar_position: 3
title: Sites
description: List your organization's sites and read their details.
---

# Sites

List the sites in your organization, read their details, and
[create](#create) new ones. Renaming and deleting a site stay console actions, and so
does editing what is on a page — but you can [publish](#publish) a site, which is what
makes writes you made elsewhere in the API appear on the live pages.

Several things under a site are resources of their own, with their own scopes:
[pages](pages.md) and each page's search listing, the site's
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

`POST /v1/sites/{siteId}/publish` — scope `sites:publish`.

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

A `200` does **not** always mean published. `published: false` with a `reason` is the
honest answer for a site with nothing routed yet, or a refresh we could not complete —
reported rather than hidden, because otherwise you would poll a page that is never
going to change. Treat `published` as the field that matters, not the status code.

Publishing is **idempotent and takes no `Idempotency-Key`**: publishing twice lands the
same state and returns the same answer.

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
— see [Conventions → Sites a connected app can reach](../conventions.md#site-access).

#### Writes that are live without a publish {#live-when-saved}

Some writes refresh the live site themselves, because the console has no draft for
them either: [products](products.md#live-when-saved), a site's
[search listing](seo.md#live-when-saved), a page's
[search listing](pages.md#live-when-saved), and
[business details](business-details.md#live-when-saved). Each is saved at once and the
live site refreshes right away — no publish needed, and none of them spends the
publish budget.

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
| `403` | `forbidden` | `code: "site_permission_required"` — a [connected app](../conventions.md#site-access) publishing a site its person can't edit. |
| `404` | `not_found` | Unknown or unowned site; unknown sub-path. |
| `405` | `method_not_allowed` | Anything other than `GET`, or anything other than `POST` on `/publish`. |
| `423` | — | The site is [locked](../conventions.md#site-access): every call on it while the lock lasts, or only writes under a read-only lock. |
| `429` | `rate_limited` | The site's [publish budget](#publish-limit) is spent. Carries `Retry-After`. |
