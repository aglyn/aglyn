---
sidebar_position: 3
title: Sites & form submissions
description: List your organization's sites and read their form submissions.
---

# Sites & form submissions

List the sites in your organization and read the submissions collected by their
[forms](/content-and-data/forms/overview).

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

## Endpoints

### List sites

`GET /v1/sites` — scope `sites:read`. [Paginated](../conventions.md#pagination).

```bash
curl "https://app.aglyn.io/api/v1/sites" \
  -H "Authorization: Bearer aglyn_sk_…"
```

### Retrieve a site

`GET /v1/sites/{siteId}` — scope `sites:read`.

### List form submissions

`GET /v1/sites/{siteId}/form-submissions` — scope `forms:read`.
[Paginated](../conventions.md#pagination). Filter to one form with `?form=`.

```bash
curl "https://app.aglyn.io/api/v1/sites/host_demo/form-submissions?form=contact" \
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
