---
sidebar_position: 2
title: Build a blog
description: Create a collection, publish rich entries, and design the list and entry pages with template screens.
---

# Build a blog

Aglyn's blog is built on **collections** — a collection holds your entries, and its pages
are **first-class designed pages**: the list at `/{collection}` and each entry at
`/{collection}/{entry}` render through your site's theme and shared layout, and can be
fully designed in the besigner via **template screens**.

![The Content page in the Aglyn console, showing a Blog collection with its published entries](/img/content/content-page.png)

:::info Plan availability
**Free** to start; content features scale with your tier.
:::

## 1. Create a collection

In **Content**, create a **collection** for your posts. Manage entries from the console.

### Delete a collection

**Delete collection** sits in the **Collections & Entries** toolbar, beside **Categories**
and **New entry**, and acts on the collection currently picked in the **Collection**
dropdown. It is a **site admin** action: if your role on this site is editor or viewer the
button is not there at all, and an org role on its own does not grant it — the check reads
your role on *this site*. Ask a site admin, or have one raise your role in **Members**.

Aglyn refuses the delete while anything still depends on the collection, and the dialog
tells you which of these it is before you can type anything:

- **A template screen still points at it.** The message names the screen and which picker
  holds it — *"Blog" is still the source for "Blog index" (list template)*. Set that
  collection's **List template screen** or **Entry template screen** back to the built-in
  option first. Deleting it while a published page renders from it would leave that page
  with nothing to draw.
- **It still has entries.** The message gives the count — *"Blog" still has 12 entries*.
  Delete them from the entries table first, one at a time; deleting a collection never
  removes published entries for you.

Once nothing depends on it, type the collection's **display name** exactly — the name, not
the slug, and capitalisation counts — and confirm. Deleting removes the collection, its
**category list**, and its template pointers. Your **screens are not deleted** (they keep
their design and simply stop being template screens) and nothing in the media library is
touched. The `/{collection}` and `/{collection}/{entry}` routes stop resolving on the live
site within about a minute; there is no publish step.

:::warning No undo
There is no trash and no restore. A deleted collection comes back only from your own
export. Export anything you may want before you confirm.
:::

## 2. Write entries

Add **rich blog entries** with images, a **live preview**, and **scheduling** so posts
publish at the right time.

Each entry carries, besides the title, excerpt, cover image, and markdown body:

- **Category** — a single bucket (e.g. `Guides`) used for filtering and related posts,
  **picked from the collection's category list** (see below), never typed free-form.
- **Tags** — comma-separated labels (e.g. `nextjs, seo`).
- **Author** — the entry's byline; falls back to the site name when blank.
- **SEO title / SEO description** — search & social overrides; they fall back to the
  title and excerpt when blank.

### Scheduling

Each entry row has a **Schedule** button. Pick a **Publish at** time (the past is
refused) and confirm — the entry's status chip reads **scheduled** with the local
time, and *"the entry goes live once the time passes (applied on the next site
refresh)"*, exactly as the dialog says: no manual step, and its status flips to
published on its own. A scheduled entry joins the sitemap and RSS feed at the same
moment. **Publish**/**Unpublish** on the row toggle an entry immediately, and **View**
opens the live URL once it's published.

<!-- screenshot: content/entry-schedule-dialog.png per SCREENSHOT_PLAN.md -->

### Categories

Categories are **managed per collection** — open **Categories** next to the template
pickers (or **Manage categories…** inside the entry editor) to add, rename, or delete
them.

<!-- screenshot: content/categories-dialog.png per SCREENSHOT_PLAN.md --> Entries reference a category by a **stable id**, so **renaming a category updates
every post instantly without touching a single entry** — the display name is resolved at
render time wherever it appears (entry pages, meta lines, related posts, RSS, JSON-LD).
Deleting a category leaves its entries uncategorized until they are reassigned. A
collection holds up to 50 categories.

Posts written before category lookup existed keep rendering their old free-typed
category; the entry editor flags them so you can migrate each post to a real category
with one save.

### Visual editor

The body opens in a **Visual** tab — a WYSIWYG surface where you edit the formatted
article directly. It is native to the markdown dialect: what you type round-trips
losslessly to the same markdown string the site stores and renders, so nothing is ever
saved as HTML. A **Markdown** tab sits beside it with the raw source and a live preview
pane (rendered with the exact same parser the published site uses); both tabs edit the
same content, so you can switch freely.

The shared **toolbar** works in both tabs:

- **B / I** — bold or italicize the selection (`Cmd/Ctrl+B`, `Cmd/Ctrl+I` in Visual).
- **H2** — toggle the current line between paragraph and heading.
- **Link** — wrap the selection as a link; you're prompted for an `https://` URL or a
  site path like `/pricing`. In Visual mode, clicking an existing link opens a small
  popover to **edit or remove** it (it never navigates).
- **Image** — insert an image by URL, or hit **Choose from media** in the same dialog
  to pick one from your media library; the standalone **Insert image** button opens the
  media picker directly.

Visual-mode shortcuts: type `# `, `## `, `### `, `- `, or `1. ` at the start of a line
to convert it to a heading or list item; **Enter** splits a block (and exits a list from
an empty item); **Backspace** at a line start demotes headings/list items and then
merges paragraphs; `Cmd/Ctrl+Z` / `Cmd/Ctrl+Shift+Z` undo and redo. Pasting rich text
(from a web page, Google Docs, etc.) keeps everything the markdown dialect can
express — bold, italic, links, headings, lists, and images — and flattens the rest to
plain text.

Markdown supports `**bold**`, `*italic*`,
`## headings`, `- lists`, `1. numbered lists`, `[links](https://…)` — including
**site-relative links** (`[pricing](/pricing)`) that get client-side navigation — and
`![images](https://…)`.

There are **two heading sizes**. Any `#` run is read as a heading and clamped onto
them: `#` becomes the larger one and `####` or deeper become the smaller one, so a
document pasted from elsewhere keeps its structure instead of leaving a literal `#`
in the text.

## 3. Design the pages with template screens

Each collection has two template pickers in **Content**:

- **List template screen** — renders `/{collection}`. Drop the **Collection Entries**
  block on it: its children repeat once per published entry, with `{{entry.*}}` tokens
  substituted per entry. The default card ships title, date, excerpt, and a Read more
  link, so dropping it in works instantly.
- **Entry template screen** — renders `/{collection}/{entry}`. Use `{{entry.*}}` bindings
  and the **Entry Body** block, which renders the entry's markdown as themed headings,
  paragraphs, lists, links, and images.

Template screens go through the **normal published pipeline** — site theme, shared
layout, reusable components, variables — exactly like any other screen (the same
mechanism as commerce product/collection templates).

### Blog blocks

Besides **Collection Entries** and **Entry Body**, three entry-page blocks are available
in the block library:

- **Entry Meta** — a `date · category` line plus tag chips. On an entry template it
  fills itself in from the entry being rendered, so drop it on and it works; each part
  can be hidden with its **Show** switch. Typing into **Date** / **Category** / **Tags**
  overrides what it would have shown — including the `{{entry.date}}` /
  `{{entry.category}}` / `{{entry.tags}}` bindings, which still work and are still what
  the block's preset seeds.
- **Related Posts** — other entries of the same collection that share the current
  entry's **category or a tag**, newest first. Attributes: **Heading** (default
  "Related articles"), **Limit** (default 3), **Layout**, **Columns** and **Show
  cover**. Layout **List** — the default — is a plain list of links with a
  `date · category` line under each. Layout **Card grid** lays the posts out in
  **Columns** cards per row (default 3), each with a category chip above its title.
  **Show cover** adds each post's cover image; posts without one show their title
  alone rather than an empty box. Renders nothing when the entry has no
  category/tags or nothing matches.
- **Share Bar** — X, LinkedIn, Facebook, and copy-link buttons for the current page
  URL. Attribute: **Heading** (default "Share").
- **Category Pills** — the collection's categories as a row of links: **All** plus one
  pill per category. Drop it on the **list template screen**, above the Collection
  Entries block. Attributes: **Collection slug** (blank = the collection from the URL)
  and **All label** — the text of the unfiltered pill, default "All". Clear the All
  label box to drop that pill and leave only the category pills; the box then reads
  `none`, which is the value that actually persists — typing `none` yourself does the
  same thing. Renders nothing until the collection has categories.

### Category filtering

Each pill is a real link to `/{collection}/category/{category}`, which renders the
**same list template** with only that category's entries. Nothing to wire: the pills are
built from the collection's categories and the current one is highlighted
automatically.

Because the category is part of the **path** rather than a `?query=`, each filtered
listing is its own cacheable, linkable, indexable page — it can be shared, opened in a
new tab, and crawled. **All** is the bare `/{collection}`, so the unfiltered listing
never gains a second address.

A category with nothing published in it still renders — the page, the pills and the rest
of your template, with **zero entry rows** — so a reader can pick another pill instead of
hitting a 404. The built-in listing writes *"Nothing published in Guides yet."* in that
gap; **on your own list template nothing fills it**, so add your own empty-state message
under the Collection Entries block if you expect thin categories. A category segment that
matches nothing at all renders the same empty listing and is marked `noindex`.

Pagination composes with the filter: page 2 of a category lives at
`/{collection}/category/{category}/page/2`, and page counts describe the filtered set.
Category listings join the sitemap automatically.

Pills address a category by its **stable id**, so renaming a category changes every
pill's label without breaking the links between your own pages. A link someone else wrote
by hand against the *old name* is the exception — the route also accepts a category's
current name, so an outside link built that way stops matching after a rename and lands
on the empty listing above. Prefer linking with the pills.

### Entry tokens

| Token | Value |
| --- | --- |
| `{{entry.title}}` | Entry title |
| `{{entry.excerpt}}` | Short summary |
| `{{entry.body}}` | Raw markdown source (use the Entry Body block to render it) |
| `{{entry.date}}` | Published date |
| `{{entry.slug}}` | Entry slug |
| `{{entry.url}}` | Entry route, e.g. `/blog/my-post` |
| `{{entry.coverImage}}` | Cover image URL |
| `{{entry.category}}` | Entry category |
| `{{entry.tags}}` | Comma-joined tags, e.g. `nextjs, seo` |
| `{{entry.seoTitle}}` | SEO title (falls back to the title) |
| `{{entry.seoDescription}}` | SEO description (falls back to the excerpt) |
| `{{collection.name}}` / `{{collection.slug}}` | The routed collection |
| `{{collection.category}}` | Name of the category the URL filtered on (empty when unfiltered) |
| `{{collection.categorySlug}}` | That category's URL segment (empty when unfiltered) |
| `{{pagination.page}}` / `{{pagination.totalPages}}` | Which page this URL shows, and how many there are |
| `{{pagination.prevUrl}}` | Link to the previous page (empty on the first page) |
| `{{pagination.nextUrl}}` | Link to the next page (empty on the last page) |

:::tip Recent posts anywhere
The Collection Entries block also works on **any** screen — set its **Collection slug**
attribute (e.g. `blog`) and an **Entries limit** to build a "Latest posts" section on
your home page. Its **Filter by category** / **Filter by tag** attributes narrow the
list (e.g. a "Guides only" rail), so filtered landing pages are built as filtered
blocks. The category filter matches either the category's display name or its stable
id, so it keeps working across renames.
:::

### No template? Still designed

When no template screen is set, the built-in list and article render **inside your site
theme and default shared layout** (the home screen's layout), so blog pages never look
detached from the rest of the site. The built-in article includes the entry meta line
under the title, the cover image, the body, related posts, and a share bar. The built-in
list is **paginated** (see below).

### Paginated page sets

Long collections split into pages. The built-in list shows a page of entries with
**← Newer / Older →** links; deeper pages live at `/{collection}/page/2`,
`/{collection}/page/3`, and so on (page 1 is the bare `/{collection}`). A page past the
end returns 404.

On your own **list template screen**, turn on pagination by setting the **Collection
Entries** block's **Entries per page** attribute; it then renders the page from the URL
(the **Page** attribute overrides it for a fixed page). Without **Entries per page**, the
block shows the top **Entries limit** entries as before. The same applies inside a
category: `/{collection}/category/{category}/page/2`.

#### Build your own pager

One list template screen serves every one of those URLs, so a pager built from
hardcoded links would read the same on all of them. Bind the `{{pagination.*}}` tokens
instead: a **Text** block with `Page {{pagination.page}} of {{pagination.totalPages}}`,
and two **Link** blocks whose **URL** is `{{pagination.prevUrl}}` and
`{{pagination.nextUrl}}`.

Both URLs **keep the category you are inside**, so "next" never drops the reader back
onto the unfiltered list. And both are **empty where there is nowhere to go** — no
previous page, no `{{pagination.prevUrl}}` — which makes a link with no target render as
inert text rather than a link to a page that doesn't exist. That is why you can bind them
on every route without building a variant of the screen for each.

## 4. Publish & syndicate

Publish the collection. Blog pages join the site's **sitemap** automatically, and each
entry's `<head>` uses its SEO title/description (falling back to title/excerpt) and its
cover image as the social card.

Aglyn also generates an **RSS feed** per collection, at:

```
https://your-domain.com/<collection-slug>/rss.xml
```

e.g. `https://acme.com/blog/rss.xml`. **This is the URL to link** — it names no site, so
it keeps working if you connect a custom domain later, and it is the one to put behind a
"Subscribe" link.

The same feed answers on the explicit form, if you need to point at another site's:

```
https://your-domain.com/api/collections-rss?host=<your-site>&collection=<collection-slug>
```

`host` accepts your site's platform origin (`acme.aglyn.app`), your custom domain
(`acme.com`), or the bare subdomain (`acme`), and `collection` is the collection's slug.

Items carry the entry's title, link, publish date, excerpt, and its category and tags as
feed categories, newest first. Link it from your own footer or share it with
aggregators — feed readers don't discover it automatically yet.

## Tips

- Schedule entries ahead of time and let Aglyn publish them for you.
- Pair the blog with the [SEO toolkit](../seo/overview.md) — entries emit JSON-LD for rich
  results.

## Related

- [Save a template](save-a-template.md)
- [Datasets & dynamic content](../../content-and-data/datasets/overview.md)
- [SEO toolkit](../seo/overview.md)
