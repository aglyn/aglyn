---
sidebar_position: 17
title: Pages
description: List, create, rename, move and delete a site's pages over the REST API, read what is on a page and edit it as a draft, and change each page's search listing.
---

# Pages

The pages of a site, and the folders they sit in: what each is called, where it sits,
its public address, whether it is published, and its search listing. You can list and
read them, [create](#create) a page (blank or from a [template](templates.md)),
[rename, re-address or move](#update) one, [delete](#delete) one, read
[what is on a page](#content) and [edit it](#edit-content), and change a page's
[search listing](#update-seo).

Email designs, error pages, collection templates and deleted pages are not part of
this resource. Neither are the site's theme, its layouts, its reusable components or
its templates themselves: those are edited in the console.

Scopes:

| Scope | For |
| --- | --- |
| `pages:read` | Listing and reading pages and folders, and reading what is on a page. |
| `pages:write` | Creating, updating and deleting pages, and editing what is on a page. |
| `seo:write` | Changing a page's search listing. |
| `sites:publish` | Also needed for any change to a **published** page, and to delete one. See [what visitors see](#what-visitors-see). |

## What visitors see, and when {#what-visitors-see}

Pages are the one resource where some writes wait and others are live at once. Read
this before you write anything:

| Write | Visitors see it |
| --- | --- |
| [Editing a page's content](#edit-content) | **Not until the page is published.** Every edit is saved as the page's **draft**, exactly where an edit in the editor waits. Review it in the editor, then [publish the page](sites.md#publish-pages). |
| [Creating a page](#create) | **Not until it is published.** A new page has no public address, so no visitor can reach it. |
| [Updating](#update) an **unpublished** page | Never directly: it has no address yet. |
| [Updating](#update) a **published** page — its name, description, address or position | **At once.** The browser title falls back to the name, the search description to the description, and a new address moves the page, and the published pages under it, right away. Needs `sites:publish`. |
| [Deleting](#delete) a **published** page | **At once.** Its address leaves the live site. Needs `sites:publish`. |
| A page's [search listing](#update-seo) | **At once.** See [Changes are live when saved](#live-when-saved). |

A key or app with `pages:write` and **without** `sites:publish` can therefore build and
edit pages as drafts for a person to review, and cannot change anything a visitor sees.

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
| `kind` | string | `page` for an ordinary page, `group` for a [folder](#folders). |
| `parentId` | string \| null | The page or folder it sits under, or `null` at the top. |
| `order` | integer \| null | Its place among the pages beside it. |
| `path` | string \| null | Its public address on the site, such as `/about`. `null` when the page has none — a page not yet published, or a folder. |
| `published` | boolean | Whether the page has a public address. Always `false` for a folder. |
| `seo` | object | The page's own search listing: `title`, `description`, `breadcrumb`, and the social `image` and `imageAlt`. A member that is `null` falls back to the [site's](seo.md). |
| `created`, `updated` | string \| null | ISO 8601. |

### Folders {#folders}

The list and the read include the site's **folders** (`kind: "group"`): the groups in
the console's Pages list that pages sit in. A folder has a name and a place, never an
address, a description, content or a search listing of its own. You can
[rename or move](#update) a folder and move pages into it with `parentId`. A folder
is not deleted over the API: dissolve it from the console's Pages list, which moves
its pages up a level. Its `/seo` and `/content` answer `404`.

## Endpoints

### List pages

`GET /v1/sites/{siteId}/pages` — scope `pages:read`.
[Paginated](../conventions.md#pagination). Returns pages and folders.

```bash
curl "https://app.aglyn.com/api/v1/sites/host_demo/pages" \
  -H "Authorization: Bearer aglyn_sk_…"
```

What isn't a page or a folder — an email or error page, a collection template, a
deleted page — is filtered out **after** the page of results is read, so a page can be
shorter than `limit` while `has_more` is still `true`. Check `has_more`, not the length.

### Retrieve a page

`GET /v1/sites/{siteId}/pages/{pageId}` — scope `pages:read`. Also reads a folder.

```bash
curl "https://app.aglyn.com/api/v1/sites/host_demo/pages/scr_about" \
  -H "Authorization: Bearer aglyn_sk_…"
```

### Create a page {#create}

`POST /v1/sites/{siteId}/pages` — scope `pages:write`. Accepts an
[`Idempotency-Key`](../conventions.md#idempotency).

Adds a page, blank or from a page [template](templates.md), as the console's
**Add page** does. **The page is not published**: it has no public address, and no
visitor can reach it until it is [published](sites.md#publish-pages). It counts
against your plan's page allowance.

```bash
curl -X POST "https://app.aglyn.com/api/v1/sites/host_demo/pages" \
  -H "Authorization: Bearer aglyn_sk_…" \
  -H "Idempotency-Key: $(uuidgen)" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Catering",
    "templateId": "tpl_services",
    "placeholders": { "headline": "Catering for every table" }
  }'
```

| Member | Required | Notes |
| --- | --- | --- |
| `name` | yes | The page's name in the console. A published page's browser title falls back to it. |
| `description` | no | A short description; a published page's search description falls back to it. |
| `slug` | no | The page's own address segment, such as `catering`, or `/` for the home page. One segment: a `/` inside it, or a reserved address, is refused. Stored for when the page is published; taken from the name when left out, and made unique against the site's other pages. |
| `templateId` | no | The `id` of a template from [List templates](templates.md#list-templates). Left out, the page starts blank. |
| `placeholders` | no | Only with `templateId`: the text for each of the template's placeholders, by `name`. A placeholder left out takes its default value, or nothing. A name the template doesn't ask for is a `400`. |

A page made from a template also starts with the template's description, suggested
address and search listing, unless you send your own `description` or `slug`. A new
page sits at the top level; [update](#update) it to move it under another page.

Returns `201` with the [page object](#the-page-object), `published: false` and
`path: null`. A replayed request returns the same page with `200`.

Any member not in the table is a `400` that names it.

### Update a page {#update}

`PATCH /v1/sites/{siteId}/pages/{pageId}` — scope `pages:write`, plus `sites:publish`
when the page is published.

Renames a page, changes its description or its address, or moves or reorders it, as
the console's page details card, address edit and Pages list do. Members left out
keep their values; send at least one. Works on a [folder](#folders) for `name`,
`parentId` and `index`.

```bash
curl -X PATCH "https://app.aglyn.com/api/v1/sites/host_demo/pages/scr_catering" \
  -H "Authorization: Bearer aglyn_sk_…" \
  -H "Content-Type: application/json" \
  -d '{ "name": "Catering & events", "parentId": "scr_services", "index": 0 }'
```

| Member | Notes |
| --- | --- |
| `name` | Not empty. |
| `description` | A string, or `null` or `""` to clear it. Not on a folder. |
| `slug` | The page's own address segment, as on [create](#create). On a published page this **moves the page and the published pages under it** to the new address. Refused under a parent that has no address yet, and at an address another published page holds. Not on a folder. |
| `parentId` | The `id` of a page or folder to move it under, or `null` for the top level. Not under itself or a page below it. |
| `index` | Its position among the pages beside it, from 0. With `parentId`, its position under the new parent; alone, it reorders the page where it is. Left out with `parentId`, it goes last. |

Every part is checked before anything is saved, so a refused update saves nothing.
Returns the page as it reads after the change.

**On a published page the change is live at once** — there is no draft for a page's
name, description, address or place. Such an update needs `sites:publish` as well as
`pages:write`, and so does a move that changes the address of a published page below
it; without it the answer is `403 insufficient_scope` with `code: "sites:publish"`,
and nothing is saved. An app acting for a person should show the change and get their
approval first.

Any member not in the table is a `400` that names it.

### Delete a page {#delete}

`DELETE /v1/sites/{siteId}/pages/{pageId}` — scope `pages:write`, plus `sites:publish`
when the page is published.

Deletes a page as the console's Pages list does: the page is marked deleted and its
address taken off the site, so **a published page leaves the live site at once**. The
pages under it stay where they are. A folder is not deleted this way (`400`,
`code: "page_is_folder"`).

```bash
curl -X DELETE "https://app.aglyn.com/api/v1/sites/host_demo/pages/scr_catering" \
  -H "Authorization: Bearer aglyn_sk_…"
```

```json
{ "id": "scr_catering", "object": "page", "deleted": true }
```

Deleting a page that is already deleted returns the same receipt, so a retry is safe
without an `Idempotency-Key`.

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

## Page content {#content}

What is on a page is a tree of **elements** — sections, stacks, headings, text,
buttons, images — each of a **kind**, with settings (`props`) and styles (`style`).
You read the tree, then send edits that name elements by `id`. Edits are saved to the
page's **draft**; nothing a visitor sees changes until the page is
[published](sites.md#publish-pages).

### Get a page's content {#get-content}

`GET /v1/sites/{siteId}/pages/{pageId}/content` — scope `pages:read`.

| Query | Notes |
| --- | --- |
| `elementId` | Read only this element and what is inside it. |

```bash
curl "https://app.aglyn.com/api/v1/sites/host_demo/pages/scr_about/content" \
  -H "Authorization: Bearer aglyn_sk_…"
```

```json
{
  "object": "page_content",
  "page": "scr_about",
  "versionId": "ver_3",
  "base": "draft",
  "revision": "d_Qm9vbXN0YXJ0ZXJyZXZpc2",
  "rootId": "_@_",
  "total": 5,
  "elements": [
    { "id": "_@_", "kind": "div", "parentId": null, "children": ["el_hero"], "props": {} },
    {
      "id": "el_hero",
      "kind": "section",
      "name": "Hero",
      "parentId": "_@_",
      "children": ["el_title", "el_photo", "el_cta"],
      "props": {},
      "style": { "py": { "xs": 6, "md": 10 } }
    },
    {
      "id": "el_title",
      "kind": "muiTypography",
      "parentId": "el_hero",
      "children": [],
      "props": { "children": "Three bakers, one oven", "variant": "h1" },
      "style": { "textAlign": "center" }
    },
    {
      "id": "el_photo",
      "kind": "image",
      "parentId": "el_hero",
      "children": [],
      "props": { "src": "media:host_demo/m_9fK2xQ", "alt": "Loaves cooling on a rack" }
    },
    {
      "id": "el_cta",
      "kind": "muiButton",
      "parentId": "el_hero",
      "children": [],
      "props": { "children": "Order ahead", "screenId": "scr_order" },
      "readOnly": { "fields": ["className"] }
    }
  ],
  "kinds": {
    "muiTypography": {
      "label": "Typography",
      "acceptsChildren": false,
      "props": {
        "children": { "role": "text", "type": "string", "maxLength": 2000 },
        "variant": { "type": "string", "values": ["displayXl", "h1", "h2", "h3", "…"] },
        "align": { "type": "string", "values": ["inherit", "left", "center", "right", "justify"] }
      }
    },
    "image": {
      "label": "Image",
      "acceptsChildren": false,
      "props": {
        "src": { "role": "media", "type": "string" },
        "alt": { "role": "text", "type": "string", "maxLength": 200 },
        "screenId": { "role": "screen", "type": "string" },
        "href": { "role": "url", "type": "string" }
      }
    }
  },
  "editorUrl": "https://app.aglyn.com/demo-workspace/hosts/demo/screens/scr_about/versions/ver_3/besigner?draft=open"
}
```

The example is abridged: `kinds` lists every kind on the page, and each kind every
setting it takes.

| Field | Notes |
| --- | --- |
| `page` | The page's id. |
| `versionId` | The version the page points at. Edits are saved in that version's draft. |
| `base` | `draft` when the page has a draft waiting, which is what was read; `saved` when it has none and the saved version was read. |
| `revision` | Changes whenever the content read changes, and only then. Send it back as [`ifRevision`](#if-revision). |
| `rootId` | The page's root element (`_@_`), which holds the rest. It cannot be changed, moved or removed. |
| `total` | How many elements the page has — more than `elements` holds when you read one branch with `elementId`. |
| `elements` | Every element read, the root first, each before what is inside it, in the order the page reads. |
| `kinds` | For each kind of element in `elements`, what it is and takes. See [below](#kinds). |
| `editorUrl` | A link that opens the page in the editor — on its draft when it has one. `null` when no link can be built. |

Each element:

| Field | Notes |
| --- | --- |
| `id` | What an edit names it by. |
| `kind` | The kind of element, such as `section`, `muiStack`, `muiTypography`, `muiButton` or `image`. |
| `pluginId` | The plugin that provides the kind, when there is one. |
| `name` | Its name in the editor's layers, when it has one. |
| `parentId`, `children` | The element it sits in (`null` for the root), and the ids inside it, in order. |
| `props` | Its settings that an edit can set, as stored. |
| `style` | Its styles that an edit can set, as stored. A value may be an object by screen size (`xs`, `sm`, `md`, `lg`, `xl`). |
| `hidden` | `true` when the element is hidden. |
| `readOnly` | What the element stores that an edit **cannot** set, shown so you can read it: `props` (such as rich text in `html`, or a class name), `style` (keys outside the editable set), `interactions` (how many it runs) and `fields` (other things only the editor changes, such as `className` or `styleOverrides`). Present only when there is some. |

### Finding an element's text, picture or link {#kinds}

`kinds` tells you which setting does what, so you don't have to guess from names. Each
setting may carry:

| Member | Means |
| --- | --- |
| `role` | What the setting is for: `text` is copy a visitor reads; `media` a picture or file; `url` a link to an address; `screen` a link to another page of the site, by page id; `motion` an animation setting; `dataset` the dataset an element repeats over. Absent for a plain setting, such as a color or a variant. |
| `type` | `string`, `number`, `integer` or `boolean`. |
| `values` | The only values a setting with a fixed list of choices takes. |
| `maxLength` | The most characters the value may have. |

So to change a heading's words, find the element whose kind has a `text` setting
(for `muiTypography`, `children`) and set that. To change a picture, set the `media`
setting (for `image`, `src`). To change where a button goes, set its `screen` setting
(`screenId`) to another page's id, or its `url` setting (`href`) to an address.

A heading that holds **rich text** shows it under `readOnly.props.html`. Rich text
cannot be set over the API: setting the `text` setting (`children`) replaces it with
plain text.

### Edit a page's content {#edit-content}

`POST /v1/sites/{siteId}/pages/{pageId}/content/edits` — scope `pages:write`. Accepts
an [`Idempotency-Key`](../conventions.md#idempotency).

Sends 1 to 20 edits, applied in order as **one change: all or none**. If any edit is
refused, nothing is saved. The edits are saved as **the page's draft** — the same
draft the editor keeps — so visitors see nothing until the page is
[published](sites.md#publish-pages).

```bash
curl -X POST "https://app.aglyn.com/api/v1/sites/host_demo/pages/scr_about/content/edits" \
  -H "Authorization: Bearer aglyn_sk_…" \
  -H "Idempotency-Key: $(uuidgen)" \
  -H "Content-Type: application/json" \
  -d '{
    "ifRevision": "d_Qm9vbXN0YXJ0ZXJyZXZpc2",
    "edits": [
      { "op": "updateProps", "elementId": "el_title", "props": { "children": "Four bakers, two ovens" } },
      { "op": "updateStyle", "elementId": "el_hero", "style": { "py": 8 } }
    ]
  }'
```

| Member | Required | Notes |
| --- | --- | --- |
| `edits` | yes | 1 to 20 edits, each an object with an `op`. |
| `ifRevision` | no | A `revision` from [Get a page's content](#get-content). See [below](#if-revision). |

Any other member is a `400` that names it.

#### The six kinds of edit

**`updateProps`** — sets settings of an element. The settings you name replace those
values; the rest stay as they are.

```json
{ "op": "updateProps", "elementId": "el_photo", "props": { "src": "media:host_demo/m_7hQ2pL", "alt": "A tray of croissants" } }
```

**`updateStyle`** — sets styles of an element, the same way. A value may be an object
by screen size.

```json
{ "op": "updateStyle", "elementId": "el_title", "style": { "textAlign": { "xs": "center", "md": "left" } } }
```

**`rename`** — renames an element in the editor's layers. 80 characters or fewer, on
one line.

```json
{ "op": "rename", "elementId": "el_hero", "name": "Hero banner" }
```

**`insert`** — adds a new element, with anything inside it, into an element whose kind
accepts children. `index` is its position among the parent's children, from 0; left
out or `null`, it is added last. One insert adds at most 40 elements.

```json
{
  "op": "insert",
  "parentId": "el_hero",
  "index": 1,
  "element": {
    "kind": "muiTypography",
    "name": "Intro",
    "props": { "children": "Open every day from 7 am.", "variant": "body1" },
    "style": { "mt": 2 }
  }
}
```

A new element takes `kind` (required), `props`, `style`, `name` and `children` — a list
of new elements, for a kind that accepts children — and nothing else.

**`move`** — moves an element, with what is inside it, into another element or to
another position. `parentId` and `index` are both required; to reorder in place, give
its current parent.

```json
{ "op": "move", "elementId": "el_cta", "parentId": "el_hero", "index": 0 }
```

**`remove`** — removes an element and everything inside it.

```json
{ "op": "remove", "elementId": "el_photo" }
```

#### Every value is checked, and nothing is changed for you

Each edit is held to what the element's kind takes, strictly. A value is never
dropped, shortened or converted to make it fit: text over its `maxLength`, a value not
in `values`, `"true"` where a boolean is wanted, a setting or style the kind does not
take, an element kind a page cannot hold — each is refused, named by the edit and the
member it is in:

```json
{
  "error": {
    "type": "unprocessable_entity",
    "message": "The edits could not be saved, so none were. `fields` names each problem.",
    "code": "edit_refused",
    "fields": {
      "edits[0].props.children": "is longer than 2000 characters",
      "edits[2].elementId": "is not an element of this page"
    }
  }
}
```

Some things are never set over the API, and are refused if you send them: rich text
(`html`), `className`, `style` or `sx` inside `props`, event handlers, and an icon,
which the site owner picks from the library in the editor. The page's root cannot be
changed, moved or removed, and an edit cannot name an element an earlier edit in the
same request removes.

**Pictures** (a `media` setting) take a file from the site's own media library or the
workspace's, written `media:{library}/{mediaId}` — `{library}` is the site's id for
its own media, or `org:{orgId}` for the workspace's library, and `{mediaId}` a
[media file's](media.md) `id` — or any `https://` address, such as a file's `cdnUrl`. **Page links** (a
`screen` setting) must name a page of this site by its id. **Links** (a `url` setting)
take an `https://` address, a path on the site such as `/contact`, or a `tel:` or
`mailto:` link.

#### Limits

| Limit | Value |
| --- | --- |
| Edits in one request | 1 to 20 |
| Elements one `insert` adds | 40 |
| How deeply new elements nest | 40 levels |
| An element's name | 80 characters |
| A page, once edited | 900,000 bytes — a larger result is `413` with `code: "page_too_large"`, and nothing is saved |

#### Guard against a change in between {#if-revision}

Send the `revision` you read as `ifRevision`. If the page's content has changed since
— someone saved it in the editor, or another edit landed — the edits are refused with
`409 conflict`, `code: "stale"`, and nothing is saved. Read the page again and rebuild
your edits on what is there now. Without `ifRevision`, edits apply to the page as it
is when they arrive, and each is still checked against it.

#### The response

```json
{
  "object": "page_content_edit",
  "page": "scr_about",
  "versionId": "ver_3",
  "revision": "d_TmV4dHJldmlzaW9uYWZ0ZX",
  "applied": 2,
  "created": [],
  "editorUrl": "https://app.aglyn.com/demo-workspace/hosts/demo/screens/scr_about/versions/ver_3/besigner?draft=open"
}
```

| Field | Notes |
| --- | --- |
| `revision` | The draft's revision after the edits — send it as `ifRevision` on your next request. |
| `applied` | How many edits were saved. |
| `created` | One entry per `insert`: `index` (its position in `edits`), `id` (the element it added) and `ids` (every element it added, the added element first, then what is inside it in the order it reads). |
| `editorUrl` | Opens the page's **draft** in the editor, where a person can review the edits before publishing. |

Send an `Idempotency-Key`: two inserts sent twice add four elements. A retry with the
same key returns the first response instead of editing again. A refused request gives
its key back, so you can correct it and retry with the same one.

#### Then publish {#then-publish}

An edited page stays as it was for visitors until its draft is published: in the
editor, or with [`POST /v1/sites/{siteId}/publish`](sites.md#publish-pages) and the
page's id in `pages`. An app acting for a person should hand them `editorUrl` to look
first, and publish only when they say so.

## Changes are live when saved {#live-when-saved}

A page's search listing has no draft: a change is saved at once, and a published
page's live copy refreshes right away. There's no need to [publish](sites.md#publish)
after it. The same is true of a published page's name, description, address and place
when you [update](#update) it, and of [deleting](#delete) a published page.

Because there is nothing to review afterwards, an app acting for a person should show
the change and get their approval before it sends the write. Page **content** edits
are the exception: they wait as a draft, as [above](#what-visitors-see).

## Errors

| Status | `type` | When |
| --- | --- | --- |
| `400` | `bad_request` | `code: "validation_failed"` — a member that isn't writable, a missing or malformed value, a value over its limit, or an edit request of the wrong shape (not 1 to 20 edits, an unknown `op`, a missing member). `fields` names each. `code: "page_is_folder"` — a delete on a folder. |
| `403` | `insufficient_scope` | Key lacks the scope the call needs; `code` names it. `code: "sites:publish"` on an update or delete that would change what visitors see. |
| `403` | `forbidden` | `code: "site_permission_required"` — a [connected app](../conventions.md#site-access) whose person lacks the permission the change needs on the site; the message names it. |
| `403` | `plan_required` | `code: "page_quota"` — your plan's page allowance is used. The message names the limit. |
| `404` | `not_found` | Unknown or unowned site; `"No such page"` for an unknown id; `"No such template"` for an unknown `templateId`. On content: `code: "page_not_found"`, `code: "page_empty"` (the page has no saved content yet — open it in the editor once), `code: "element_not_found"` for an `elementId` not on the page. |
| `405` | `method_not_allowed` | `Allow: GET, POST` on the list, `GET, PATCH, DELETE` on one page, `PATCH` on its `/seo`, `GET` on `/content`, `POST` on `/content/edits`. |
| `409` | `conflict` | `code: "address_taken"` — another published page already has that address. `code: "move_refused"` — the move would change a published address the page's own slug disagrees with; publish it again first. `code: "stale"` — the page changed since `ifRevision`, or while the edits were being saved. `code: "idempotency_in_progress"` — see [idempotency](../conventions.md#idempotency). |
| `413` | `payload_too_large` | `code: "page_too_large"` — the edited page would be over 900,000 bytes. Also a template whose design is too large for one page. |
| `422` | `unprocessable_entity` | `code: "edit_refused"` — the edits are well formed, and at least one asks for something the element does not take. `fields` names each problem by edit and member. Nothing is saved. |
| `423` | — | The site is [locked](../conventions.md#site-access). |
| `501` | `not_implemented` | Page content cannot be read or edited on this deployment right now. |

## Related

- [Templates](templates.md) — the page templates a new page can start from.
- [Sites → Publish](sites.md#publish-pages) — make a page's draft live.
- [Search listing](seo.md) — the site-wide title and description pages fall back to.
- [Media](media.md) — the files a picture can name.
- [SEO Toolkit](/building-sites/seo/overview) — each page's listing in the console.
