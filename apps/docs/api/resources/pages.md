---
sidebar_position: 17
title: Pages
description: List a site's pages over the REST API — their names, public addresses and whether they are published — and change each page's search listing.
---

# Pages

The pages of a site: what each is called, where it sits, its public address, whether
it is published, and its search listing. You can list and read them, and change a
page's search title, description and breadcrumb label.

A page's **content and design are not part of this resource** — they are edited in
the console's editor. Folders, email pages, error pages, templates and deleted pages
are not listed.

Scopes: `pages:read` to read, `seo:write` to change a page's search listing.

## The page object

```json
{
  "id": "scr_about",
  "object": "page",
  "name": "About us",
  "kind": "page",
  "parentId": null,
  "order": 2,
  "path": "/about",
  "published": true,
  "seo": {
    "title": "About Demo Bakery",
    "description": "Three bakers, one oven, and a 24-hour ferment.",
    "breadcrumb": "About",
    "image": null,
    "imageAlt": null
  },
  "created": "2026-03-02T11:00:00.000Z",
  "updated": "2026-08-10T09:14:00.000Z"
}
```

| Field | Type | Notes |
| --- | --- | --- |
| `id` | string | Page id — the `pageId` in the paths below. |
| `object` | string | Always `"page"`. |
| `name` | string \| null | The page's name in the console. |
| `kind` | string | `page` for an ordinary page. |
| `parentId` | string \| null | The page or folder it sits under, or `null` at the top. |
| `order` | integer \| null | Its place among the pages beside it. |
| `path` | string \| null | Its public address on the site, such as `/about`. `null` when the page has none. |
| `published` | boolean | Whether the page has a public address. |
| `seo` | object | The page's own search listing: `title`, `description`, `breadcrumb`, and the social `image` and `imageAlt`. A member that is `null` falls back to the [site's](seo.md). |
| `created`, `updated` | string \| null | ISO 8601. |

## Endpoints

### List pages

`GET /v1/sites/{siteId}/pages` — scope `pages:read`.
[Paginated](../conventions.md#pagination).

```bash
curl "https://app.aglyn.com/api/v1/sites/host_demo/pages" \
  -H "Authorization: Bearer aglyn_sk_…"
```

What isn't a page — a folder, an email or error page, a template, a deleted page — is
filtered out **after** the page of results is read, so a page can be shorter than
`limit` while `has_more` is still `true`. Check `has_more`, not the length.

### Retrieve a page

`GET /v1/sites/{siteId}/pages/{pageId}` — scope `pages:read`.

```bash
curl "https://app.aglyn.com/api/v1/sites/host_demo/pages/scr_about" \
  -H "Authorization: Bearer aglyn_sk_…"
```

### Update a page's search listing {#update-seo}

`PATCH /v1/sites/{siteId}/pages/{pageId}/seo` — scope `seo:write`.

A member left out keeps its value. Returns the page.

```bash
curl -X PATCH "https://app.aglyn.com/api/v1/sites/host_demo/pages/scr_about/seo" \
  -H "Authorization: Bearer aglyn_sk_…" \
  -H "Content-Type: application/json" \
  -d '{ "title": "About Demo Bakery", "breadcrumb": null }'
```

| Member | Notes |
| --- | --- |
| `title` | The page's search title. At most 60 characters. |
| `description` | The page's search description. At most 155 characters. |
| `breadcrumb` | The page's short name in a breadcrumb trail. At most 40 characters. |

An empty string or `null` removes the page's own value, and the page falls back to
the [site's search listing](seo.md). Values are trimmed, and the limits are checked on
what is stored. The social image stays in the console.

## Changes are live when saved {#live-when-saved}

A page's search listing has no draft: a change is saved at once, and a published
page's live copy refreshes right away. There's no need to [publish](sites.md#publish)
after it.

Because there is nothing to review afterwards, an app acting for a person should show
the change and get their approval before it sends the write.

## Errors

| Status | `type` | When |
| --- | --- | --- |
| `400` | `bad_request` | `code: "validation_failed"` — a member that isn't writable, or a value over its limit. `fields` names each. |
| `403` | `insufficient_scope` | Key lacks `pages:read`, or `seo:write` on a search listing change. |
| `403` | `forbidden` | `code: "site_permission_required"` — a [connected app](../conventions.md#site-access) whose person can't edit the site's content. |
| `404` | `not_found` | Unknown or unowned site; `"No such page"` for an unknown id or one that isn't a page. |
| `405` | `method_not_allowed` | `Allow: GET` on the list and on one page, `PATCH` on its `/seo`. |
| `423` | — | The site is [locked](../conventions.md#site-access). |

## Related

- [Search listing](seo.md) — the site-wide title and description pages fall back to.
- [Sites](sites.md) — the site a page belongs to.
- [SEO Toolkit](/building-sites/seo/overview) — each page's listing in the console.
