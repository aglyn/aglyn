---
sidebar_position: 19
title: Templates
description: List the page templates a new page can start from over the REST API — a site's own templates and the built-in starter pages — with the placeholders each asks for.
---

# Templates

The page templates a new page can start from: the site's own page templates, saved on
the site or installed into it, then the platform's built-in starter pages. They are
what the console's template gallery offers when you add a page.

You can list them and [create a page](pages.md#create) from one. A template's own
design is not returned, and templates are not created, edited or deleted over the API:
that stays in the console.

Scope: `components:read`. Creating a page from a template needs `pages:write`.

## The template object

```json
{
  "id": "tpl_services",
  "object": "template",
  "kind": "page",
  "name": "Services",
  "description": "A list of what you offer, with prices and a call to book.",
  "category": "Business",
  "placeholders": [
    { "name": "headline", "label": "Headline", "defaultValue": "What we do" }
  ],
  "source": "site"
}
```

| Field | Type | Notes |
| --- | --- | --- |
| `id` | string | Template id — the `templateId` a [page create](pages.md#create) takes. |
| `object` | string | Always `"template"`. |
| `kind` | string | Always `"page"`: a template a page is made from. |
| `name` | string \| null | The template's name. |
| `description` | string \| null | What the template is for. A page made from it starts with this description. |
| `category` | string \| null | The group the template is listed under, such as `Business`. |
| `placeholders` | array | The text the template asks for when a page is made from it: each with its `name` (the key in a page create's `placeholders`), a `label` saying what it asks for, and the `defaultValue` used when none is given. Empty when it asks for none. |
| `source` | string | `site` for a template saved on or installed into this site; `built_in` for one of the platform's starter pages. |

## Endpoints

### List templates {#list-templates}

`GET /v1/sites/{siteId}/templates` — scope `components:read`.
[Paginated](../conventions.md#pagination): the site's own templates by id, then the
built-in starter pages in the gallery's order.

```bash
curl "https://app.aglyn.com/api/v1/sites/host_demo/templates" \
  -H "Authorization: Bearer aglyn_sk_…"
```

A stored template that is not one of the site's page templates — a component or
layout template, a deleted one — is filtered out **after** the page of results is
read, so a page can be shorter than `limit` while `has_more` is still `true`. Check
`has_more`, not the length.

A built-in starter the site has copied into its library is listed as the site's
copies, which the site may have edited or deleted, rather than as the original.

### Make a page from one

```bash
curl -X POST "https://app.aglyn.com/api/v1/sites/host_demo/pages" \
  -H "Authorization: Bearer aglyn_sk_…" \
  -H "Idempotency-Key: $(uuidgen)" \
  -H "Content-Type: application/json" \
  -d '{ "name": "Services", "templateId": "tpl_services", "placeholders": { "headline": "What we bake" } }'
```

The new page starts with the template's design, its placeholders filled in, and the
template's description, suggested address and search listing. It is not published.
See [Create a page](pages.md#create).

## Errors

| Status | `type` | When |
| --- | --- | --- |
| `403` | `insufficient_scope` | Key lacks `components:read`. |
| `404` | `not_found` | Unknown or unowned site; unknown sub-path. |
| `405` | `method_not_allowed` | Anything other than `GET`. |
| `423` | — | The site is [locked](../conventions.md#site-access). |

## Related

- [Pages](pages.md) — create a page from a template, then edit and publish it.
