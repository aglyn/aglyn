---
sidebar_position: 16
title: Search listing
description: Read and change how a site appears in search results over the REST API — the title and description its pages fall back to, and how a page's title is built.
---

# Search listing

How a site is described to search engines: the title and description its pages fall
back to, the separator between a page's name and the site's title, and the pattern a
page's title is built from. These are the four fields of the console's
**Setup → SEO** base card.

Each page can also have a listing of its own, which wins over the site's — that is on
[pages](pages.md#update-seo). A product's page has its own listing
too, on the [product](products.md#product-write).

Scopes: `seo:read` to read, `seo:write` to change.

## The search listing object

```json
{
  "object": "site_seo",
  "site": "host_demo",
  "title": "Demo Bakery — bread and pastries in Austin",
  "description": "Sourdough, rye and pastries baked fresh every morning. Order online for pickup.",
  "separator": "|",
  "titlePattern": null,
  "image": "https://…/social-card.jpg",
  "imageAlt": "A table of fresh loaves"
}
```

| Field | Type | Notes |
| --- | --- | --- |
| `object` | string | Always `"site_seo"`. |
| `site` | string | The site's id. |
| `title` | string \| null | The title a page with no search title of its own falls back to. |
| `description` | string \| null | The description a page with no search description of its own falls back to. |
| `separator` | string \| null | The character between a page's name and the site title, such as `\|`. |
| `titlePattern` | string \| null | How a page with no search title of its own is titled, using `{{page.name}}`, `{{site.separator}}` and `{{site.name}}`. `null` is the default pattern. |
| `image` | string \| null | The social image shown when a page is shared. **Read-only** here. |
| `imageAlt` | string \| null | What the social image shows. **Read-only** here. |

### What the API doesn't change {#not-writable}

The rest of **Setup → SEO** stays in the console: the switch that asks search engines
to stay away, the site verification codes, the text for AI agents, the local business
fields, and the social image. A write that names any of them is a `400` that names the
member.

## Endpoints

### Retrieve the search listing

`GET /v1/sites/{siteId}/seo` — scope `seo:read`.

```bash
curl "https://app.aglyn.com/api/v1/sites/host_demo/seo" \
  -H "Authorization: Bearer aglyn_sk_…"
```

### Update the search listing

`PATCH /v1/sites/{siteId}/seo` — scope `seo:write`.

A member left out keeps its value. Returns the search listing as saved.

```bash
curl -X PATCH "https://app.aglyn.com/api/v1/sites/host_demo/seo" \
  -H "Authorization: Bearer aglyn_sk_…" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Demo Bakery — Austin sourdough",
    "titlePattern": "{{page.name}} {{site.separator}} {{site.name}}"
  }'
```

| Member | Notes |
| --- | --- |
| `title` | At most 60 characters. Required: it cannot be emptied. |
| `description` | At most 155 characters. Required: it cannot be emptied. |
| `separator` | At most 3 characters. Required: it cannot be emptied. |
| `titlePattern` | At most 120 characters. The only one that can be cleared: an empty string or `null` goes back to the default pattern. |

Over the API the limits are hard. The console shows the title and description limits
as guidance; a program writing a listing is held to what a search result shows.

## Changes are live when saved {#live-when-saved}

The console has no draft for these settings: a change is saved at once, and the live
site refreshes right away — search engines and the browser tab see the new title and
description the next time they load a page. There's no need to
[publish](sites.md#publish) after it.

Because there is nothing to review afterwards, an app acting for a person should show
the change and get their approval before it sends the write.

## Errors

| Status | `type` | When |
| --- | --- | --- |
| `400` | `bad_request` | `code: "validation_failed"` — a member that isn't writable, a value over its limit, or `title`, `description` or `separator` emptied. `fields` names each. |
| `403` | `insufficient_scope` | Key lacks `seo:read`, or `seo:write` on a `PATCH`. |
| `403` | `forbidden` | `code: "site_permission_required"` — a [connected app](../conventions.md#site-access) whose person can't edit the site's content. |
| `404` | `not_found` | Unknown or unowned site. |
| `405` | `method_not_allowed` | `Allow: GET, PATCH`. |
| `423` | — | The site is [locked](../conventions.md#site-access). |

## Related

- [Pages](pages.md) — each page's own search listing.
- [Business details](business-details.md) — the name, address and contact details the
  site shows.
- [SEO Toolkit](/building-sites/seo/overview) — the same settings in the console.
