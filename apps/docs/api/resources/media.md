---
sidebar_position: 6
title: Media
description: List the files in your organization library and in each site's media, with their dimensions, folders and CDN URLs.
---

# Media

List the files your organization has uploaded — images, video, documents — with their
size, dimensions, folder and URLs. Media is **read-only** over the API; uploading goes
through the console's media library, which does virus scanning, image variant
generation and quota accounting that a bare `PUT` would skip.

## Two libraries, one resource

Aglyn stores media in two places, and the API serves both at the same object shape:

| Path | Which library |
| --- | --- |
| `GET /v1/media` | The **organization library** — files shared across every site. |
| `GET /v1/sites/{siteId}/media` | **One site's** own files. |

They are separate stores, not a filter over one store: a file in the organization
library does not appear in a site's listing, and vice versa. If you're building an
inventory of everything you have, read the organization library once and then each
site.

## The media object

```json
{
  "id": "m_9fK2xQ",
  "object": "media",
  "fileName": "hero-bakery.jpg",
  "contentType": "image/jpeg",
  "sizeBytes": 184320,
  "width": 2400,
  "height": 1260,
  "alt": "Loaves cooling on a rack",
  "description": null,
  "tags": ["hero", "bakery"],
  "folderId": "fold_marketing",
  "url": "https://firebasestorage.googleapis.com/…?alt=media&token=…",
  "cdnUrl": "https://app.aglyn.com/api/media/cdn/org:org_abc123/m_9fK2xQ",
  "private": false,
  "created": "2026-06-11T14:20:03.881Z"
}
```

| Field | Type | Notes |
| --- | --- | --- |
| `id` | string | Media id. Stable across replacing the file and moving it between folders. |
| `object` | string | Always `"media"`. |
| `fileName` | string \| null | Original filename. Not unique — two folders can hold `logo.png`. |
| `contentType` | string \| null | MIME type as stored. |
| `sizeBytes` | integer | Size of the original. Generated image variants are **not** counted here, but they *do* count toward your storage quota. |
| `width`, `height` | integer \| null | Pixel dimensions. `null` for non-images and for images we couldn't read — never assume an image has them. |
| `alt` | string \| null | Alt text. Worth syncing if you're auditing accessibility. |
| `description` | string \| null | Free text set in the library. |
| `tags` | array | Library tags. |
| `folderId` | string \| null | The folder it's in; `null` at the library root. |
| `url` | string \| null | The **durable download URL**. Always present. See below. |
| `cdnUrl` | string \| null | The CDN URL, **or `null`**. See below. |
| `private` | boolean | `true` for restricted files. |
| `created` | string \| null | ISO 8601. |

### `url` versus `cdnUrl` — pick deliberately {#urls}

These are not two spellings of one thing.

- **`url`** is the storage download URL. It always exists and always works, and it
  carries an access token in the query string. **Treat it as a secret**: it grants
  whoever holds it the ability to fetch the file. It is the right choice for a
  server-side pipeline; it is the wrong thing to paste into a public page.
- **`cdnUrl`** is the cached public URL, served from your Aglyn origin. It is what
  belongs in an `<img src>`. It is **`null`** in two cases:
  - your plan doesn't include the media CDN, or
  - the file is `private`.

So `cdnUrl === null` is information, not an omission — it tells you the file has no
publicly cacheable address. Never fall back from `cdnUrl` to `url` to fill an `src`:
that publishes a tokenised link to a file that is `null` precisely because it wasn't
meant to be public.

```js
// Right: absence is a decision, not a gap.
const src = file.cdnUrl
if (!src) {
  // Private, or a plan without the CDN. Link through your own authenticated
  // handler, or skip it — don't reach for `file.url`.
}
```

Private files are reachable only through a short-lived signed link the console mints;
there is no API endpoint that signs one.

## Endpoints

### List organization library files

`GET /v1/media` — scope `media:read`.
[Paginated](../conventions.md#pagination), ordered by media id.

| Param | Notes |
| --- | --- |
| `folder` | Filter to one folder by its **id** (`folderId`), exact match. Files at the root have `folderId: null` and can't be selected with this param. |
| `limit`, `cursor` | [Standard pagination](../conventions.md#pagination). |

```bash
curl "https://app.aglyn.com/api/v1/media?limit=100" \
  -H "Authorization: Bearer aglyn_sk_…"
```

The filter is on the folder **id**, not its name. There is no endpoint that lists
folders yet, so the practical route is to page all files once and group them by
`folderId` yourself — which you'd want anyway, since folders nest.

Deleted files are filtered out after the page is read, so a page can be shorter than
`limit` while `has_more` is `true`. Trust `has_more`.

### List a site's files

`GET /v1/sites/{siteId}/media` — scope `media:read`. Same params, same shape.

```bash
curl "https://app.aglyn.com/api/v1/sites/host_demo/media" \
  -H "Authorization: Bearer aglyn_sk_…"
```

### Retrieve a file

`GET /v1/media/{mediaId}` — scope `media:read`.

```bash
curl "https://app.aglyn.com/api/v1/media/m_9fK2xQ" \
  -H "Authorization: Bearer aglyn_sk_…"
```

Returns `404 not_found` (`"No such file"`) for an unknown id **and** for one that has
been deleted.

## Recipes

### Audit images missing alt text

```js
const missing = files.filter(
  (f) => f.contentType?.startsWith('image/') && !f.alt?.trim(),
)
console.log(`${missing.length} images have no alt text`)
for (const f of missing) console.log(` ${f.fileName} (${f.id})`)
```

### Find what's eating your storage quota

```js
const byType = {}
for (const f of files) {
  const group = (f.contentType ?? 'unknown').split('/')[0]
  byType[group] = (byType[group] ?? 0) + f.sizeBytes
}
const mb = (b) => (b / 1024 / 1024).toFixed(1)
for (const [group, bytes] of Object.entries(byType).sort((a, b) => b[1] - a[1])) {
  console.log(`${group.padEnd(12)} ${mb(bytes)} MB`)
}
```

This measures **originals**. Your billed storage is larger, because Aglyn also stores
generated image variants — so treat this as "which files should I clean up", not as a
reconciliation of your invoice. The billed figure is on the
[billing page](/workspace-and-billing/billing-and-plans/overview#usage-meters).

### Mirror the library to disk

```js
for (const f of files) {
  if (f.private) continue                        // no fetchable link
  const res = await fetch(f.url)                 // `url`, not `cdnUrl` — server side
  await writeFile(`./backup/${f.id}-${f.fileName}`, Buffer.from(await res.arrayBuffer()))
}
```

Prefix the filename with the id: `fileName` is not unique across folders, and a plain
`fileName` mirror silently overwrites.

## Errors

| Status | `type` | When |
| --- | --- | --- |
| `403` | `insufficient_scope` | Key lacks `media:read`. |
| `404` | `not_found` | Unknown or unowned site; unknown or deleted file. |
| `405` | `method_not_allowed` | Anything other than `GET`. |

Media needs no commerce entitlement — an organization with no store still reads its
own files.

## Related

- [Products](products.md) — `mediaUrls` point at these files.
- [Media library](/content-and-data/media/overview) — uploading and organizing.
- [Conventions](../conventions.md) — pagination, ordering, errors.
