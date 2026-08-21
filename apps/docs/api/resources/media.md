---
sidebar_position: 7
title: Media
description: List the files in your organization library and in each site's media, with their dimensions, folders and CDN URLs.
---

# Media

List the files your organization has uploaded — images, video, documents — with their
size, dimensions, folder and URLs, and [upload new ones](#upload).

Uploading is a create only: there is no API call that replaces, renames or deletes an
existing file. Those stay console actions.

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
| `tags` | array | Library tags. Stored **lower-cased and de-duplicated**, so match them in lower case — there is no `Hero` to find. |
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

### The response does not tell you which variants exist {#no-variants}

Aglyn generates WebP variants at **320**, **640** and **1280** pixels wide when an
image is uploaded, and `cdnUrl` accepts a `?w=` parameter to select one:

```
https://app.aglyn.com/api/media/cdn/org:org_abc123/m_9fK2xQ?w=640
```

**The media object carries no `variants` field**, so the API cannot tell you which of
those widths a particular file actually has. That is a known limitation of this
resource, not something to derive from another field: `contentType` and `width` say
what the original is, not what was generated from it. Only the console's media library
— the delivery line in a file's **Details** drawer — reports the per-asset truth.

Two consequences worth designing around:

- **A `?w=` width the file doesn't have is not an error.** The CDN serves the original
  bytes instead of resizing or 404ing. So a `srcset` built from all three widths always
  renders; the cost of guessing wrong is full-size bytes over a mobile connection, not
  a broken image.
- **Non-images never have variants.** An SVG, a PDF, a video or a document is served as
  uploaded whatever `?w=` says.

Nothing about `?w=` applies when `cdnUrl` is `null` — there is no CDN address to add a
parameter to.

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

### Upload a file {#upload}

`POST /v1/media` — scope `media:write`, uploads to the **organization library**.
`POST /v1/sites/{siteId}/media` — same call, uploads to **one site's** library.

Accepts an [`Idempotency-Key`](../conventions.md#idempotency).

**Body** — JSON, with the file's bytes base64-encoded. There is no multipart form.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `data` | string | yes | The file's bytes, base64. Anything that isn't valid base64 is a `400` — we never store a partially-decoded file. |
| `contentType` | string | yes | MIME type. Must be on the [allowed list](#upload-limits). |
| `fileName` | string | no | Defaults to `upload`. Truncated at 200 characters. |
| `folderId` | string | no | Put the file in a folder, by its id. |
| `alt` | string | no | Alt text. Worth setting — it's the field an accessibility audit reads. |
| `private` | boolean | no | `true` stores it restricted: no `cdnUrl`, no public link. |

```bash
curl -X POST "https://app.aglyn.com/api/v1/media" \
  -H "Authorization: Bearer aglyn_sk_…" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: 2b9f1c4e-…" \
  -d "{\"fileName\":\"hero.jpg\",\"contentType\":\"image/jpeg\",\"data\":\"$(base64 < hero.jpg)\"}"
```

Returns **`201`** with the [media object](#the-media-object) — or **`200`** with the
original object when an `Idempotency-Key` replays. Image variants are generated exactly
as they are for a console upload, so an uploaded image gets its `cdnUrl` and its `?w=`
widths without a second call.

#### Size and type limits {#upload-limits}

Because the bytes travel inside a JSON body, base64 inflates them by about a third —
budget for that when you size a batch.

| Family | Limit |
| --- | --- |
| Images (`image/*`, including SVG) | 15 MB |
| PDF, Word, Excel, CSV, text, Markdown, JSON, ZIP | 10 MB |
| Video (`mp4`, `webm`, `quicktime`) | 25 MB |
| PowerPoint | 10 MB |

Anything outside the allowed types returns `415 unsupported_media_type`; anything past
its ceiling returns `413 payload_too_large`. The size is measured on the **decoded**
bytes, not on anything you declare.

Video and document uploads need a plan that includes them; images do not.

#### What we check, and what we don't {#upload-checks}

Worth stating exactly, because "the platform accepted it" is not the same as "the
platform vetted it":

- **We check the declared content type against an allowlist** and refuse the rest.
- **We measure the real decoded size** against the per-type ceiling.
- **We check that the bytes match the type you declared.** A file labelled
  `application/pdf` has to start with a PDF header, a `.docx` has to be a ZIP, a
  `image/png` has to carry a PNG signature. A mismatch is refused with `415`
  (`type_mismatch`). Text types — `text/plain`, `text/csv`, `text/markdown`,
  `application/json`, `image/svg+xml` — have no header to check and are exempt.
- **We refuse executables outright**, whatever they claim to be: Windows `.exe`,
  Linux ELF, macOS Mach-O, installer packages and Windows shortcuts are rejected
  under every content type (`415`, `executable_bytes`).
- **We refuse Office documents that carry macros.** A `.docx`, `.xlsx` or `.pptx`
  containing a `vbaProject.bin` entry is rejected (`415`, `macro_payload`) — including
  a macro-enabled file simply renamed to a non-macro extension.
- **We sanitize SVGs**, stripping script and other active content before storing.
- **We hash the file** (SHA-256) and refuse anything matching a taken-down asset.
- **We do not scan for malware.** No upload path on the platform does. The checks
  above are *structural* — they establish that a file is the kind of thing it says it
  is, not that its contents are safe. A malicious PDF that is a genuine PDF passes
  all of them, and an accepted file has not been examined for anything harmful
  inside it.

Treat files uploaded through your own integration as you would any other content you
are responsible for.

#### Quota

Uploads count against your **storage allowance**, the same one console uploads count
against — there is no separate API allowance and no per-upload charge. An upload that
would cross the band returns `403 plan_required` with `code: "storage_quota"`, and
nothing is stored: no file, no metering.

A quota refusal **releases** the `Idempotency-Key`, so if you free up space or upgrade,
retrying with the same key genuinely re-runs rather than replaying the refusal.

Check [`GET /v1/usage`](../usage.md) before a large batch — `dataStorageMb` tells you
what is left.

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
| `400` | `bad_request` | `data` is not valid base64. |
| `403` | `insufficient_scope` | Key lacks `media:read`, or `media:write` to upload. |
| `403` | `plan_required` | `code: "storage_quota"` — the upload would cross your storage band. Or the file type needs a higher plan. |
| `404` | `not_found` | Unknown or unowned site; unknown or deleted file. |
| `405` | `method_not_allowed` | A method the path doesn't take — `POST` is accepted on the collection, never on `/media/{id}`. |
| `413` | `payload_too_large` | Past the [ceiling](#upload-limits) for that type. |
| `415` | `unsupported_media_type` | Content type not on the allowed list. |
| `451` | `unavailable_for_legal_reasons` | The file matches a taken-down asset. |

Media needs no commerce entitlement — an organization with no store still reads its
own files.

## Related

- [Products](products.md) — `mediaUrls` point at these files.
- [Media library](/content-and-data/media/overview) — organizing what you upload.
- [Variant widths](/content-and-data/media/overview#variant-widths) — what `?w=` can ask
  for, and what a file's own delivery line says it has.
- [Conventions](../conventions.md) — pagination, ordering, errors.
