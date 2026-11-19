---
sidebar_position: 18
title: Business details
description: Read and change a site's business details over the REST API — the name, slogan, phone, email, address and social links its pages, structured data and emails show.
---

# Business details

The business behind a site, as its pages, its structured data for search engines and
its emails show it: the name, a slogan, a phone number, an email address, the postal
address, and social profile links. These are the console's **Setup → Business** card,
and a write here is the card's own save.

Scopes: `business:read` to read, `business:write` to change.

## The business details object

```json
{
  "object": "business_details",
  "site": "host_demo",
  "name": "Demo Bakery",
  "slogan": "Bread worth waking up for.",
  "phone": "+1 512-555-0100",
  "email": "hello@example.com",
  "address": {
    "street": "1 Main St",
    "city": "Austin",
    "region": "TX",
    "postalCode": "78701",
    "country": "US"
  },
  "socialLinks": [
    { "label": "Instagram", "url": "https://instagram.com/example" }
  ]
}
```

| Field | Type | Notes |
| --- | --- | --- |
| `object` | string | Always `"business_details"`. |
| `site` | string | The site's id. |
| `name` | string \| null | The business name. `null` means the site's name is used. |
| `slogan` | string \| null | A short line about the business. |
| `phone` | string \| null | The phone number, as customers should dial it. |
| `email` | string \| null | Where customers write to the business. |
| `address` | object | The postal address in parts: `street`, `city`, `region`, `postalCode`, `country`. A part that is `null` is not set. |
| `socialLinks` | array | The business's social profiles, each `{ "label", "url" }`. |

## Endpoints

### Retrieve business details

`GET /v1/sites/{siteId}/business` — scope `business:read`.

```bash
curl "https://app.aglyn.com/api/v1/sites/host_demo/business" \
  -H "Authorization: Bearer aglyn_sk_…"
```

### Update business details

`PATCH /v1/sites/{siteId}/business` — scope `business:write`.

A member left out keeps its value. Returns the business details as saved.

```bash
curl -X PATCH "https://app.aglyn.com/api/v1/sites/host_demo/business" \
  -H "Authorization: Bearer aglyn_sk_…" \
  -H "Content-Type: application/json" \
  -d '{
    "phone": "+1 512-555-0199",
    "address": { "street": "200 Congress Ave" },
    "socialLinks": [
      { "label": "Instagram", "url": "https://instagram.com/example" },
      { "label": "Facebook", "url": "https://facebook.com/example" }
    ]
  }'
```

| Member | Notes |
| --- | --- |
| `name` | At most 200 characters. Empty or `null` goes back to the site's name. |
| `slogan` | At most 120 characters. |
| `phone` | At most 64 characters, as customers should dial it. |
| `email` | An email address, such as `you@example.com`. |
| `address` | An object of the five parts, each at most 200 characters. A part left out keeps its value, so `{ "street": "…" }` changes only the street. `null` clears every part. `country` is a country name or its two-letter code. |
| `socialLinks` | Up to **8** links, each `{ "label", "url" }`; `url` is required. **Replaces the whole list** — send every link you want to keep. An empty list or `null` clears it. |

Values are trimmed. An empty string or `null` clears a text member; a cleared field is
removed rather than stored blank, as the console's card does.

## Changes are live when saved {#live-when-saved}

The console has no draft for business details: a change is saved at once, and the live
site refreshes right away — the details on its pages, in its structured data, and in
the emails it sends from then on. There's no need to [publish](sites.md#publish) after
it.

After **30** such changes to one site in **an hour**, later changes are still saved and
show within a few minutes. The `X-Live-Refresh` response header says which happened:
`now` or `scheduled`.

## Errors

| Status | `type` | When |
| --- | --- | --- |
| `400` | `bad_request` | `code: "validation_failed"` — a member or address part that isn't writable, a value over its limit, an `email` that isn't an address, more than 8 social links, or a link with no `url`. `fields` names each key, nested ones as `address.city` or `socialLinks[0].url`. |
| `403` | `insufficient_scope` | Key lacks `business:read`, or `business:write` on a `PATCH`. |
| `403` | `forbidden` | `code: "site_permission_required"` — a [connected app](../conventions.md#site-access) whose person can't edit the site's content. |
| `404` | `not_found` | Unknown or unowned site. |
| `405` | `method_not_allowed` | `Allow: GET, PATCH`. |
| `423` | — | The site is [locked](../conventions.md#site-access). |

## Related

- [Search listing](seo.md) — how the site appears in search results.
- [Sites](sites.md) — the site these details belong to.
