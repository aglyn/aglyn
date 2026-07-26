---
sidebar_position: 3
title: Sites & form submissions
description: List your organization's sites and read the submissions their forms collect.
---

# Sites & form submissions

List the sites in your organization and read the submissions collected by their
[forms](/content-and-data/forms/overview). Both are read-only.

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
| `path` | string \| null | The screen path it was submitted from. |
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

### Retrieve a site

`GET /v1/sites/{siteId}` — scope `sites:read`.

A site your organization doesn't own returns `404 not_found` (`"No such site"`) rather
than `403` — the API doesn't reveal whether an id exists elsewhere. So a `404` here
means "not yours or not real", not "your key is missing a scope".

### List form submissions

`GET /v1/sites/{siteId}/form-submissions` — scope **`forms:read`** (not `sites:read`).
[Paginated](../conventions.md#pagination).

| Param | Notes |
| --- | --- |
| `form` | Filter to one form by exact name. Omit for every form on the site. |
| `limit`, `cursor` | [Standard pagination](../conventions.md#pagination). |

```bash
curl "https://app.aglyn.com/api/v1/sites/host_demo/form-submissions?form=contact" \
  -H "Authorization: Bearer aglyn_sk_…"
```

```json
{
  "object": "list",
  "data": [
    {
      "id": "sub_1",
      "object": "form_submission",
      "form": "contact",
      "path": "/contact",
      "fields": { "email": "hi@example.com", "message": "Hello!" },
      "read": false,
      "created": "2026-07-20T18:23:23.950Z"
    }
  ],
  "next_cursor": null,
  "has_more": false
}
```

Submissions are ordered by id, not by date — to process new ones, page through and
track the ids you've already handled. See [ordering](../conventions.md#ordering).

## Errors

| Status | `type` | When |
| --- | --- | --- |
| `403` | `insufficient_scope` | Key lacks `sites:read` (or `forms:read` for submissions). |
| `404` | `not_found` | Unknown or unowned site; unknown sub-path. |
| `405` | `method_not_allowed` | Anything other than `GET`. |
