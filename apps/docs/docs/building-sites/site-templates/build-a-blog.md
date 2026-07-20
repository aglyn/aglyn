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

## 2. Write entries

Add **rich blog entries** with images, a **live preview**, and **scheduling** so posts
publish at the right time.

Each entry carries, besides the title, excerpt, cover image, and markdown body:

- **Category** — a single bucket (e.g. `Guides`) used for filtering and related posts.
- **Tags** — comma-separated labels (e.g. `nextjs, seo`).
- **SEO title / SEO description** — search & social overrides; they fall back to the
  title and excerpt when blank.

The body editor ships a **markdown toolbar** (bold, italic, H2, link, image — each wraps
your current selection) plus a **live preview pane** rendered with the exact same
markdown parser the published site uses. Markdown supports `**bold**`, `*italic*`,
`## headings`, `- lists`, `[links](https://…)` — including **site-relative links**
(`[pricing](/pricing)`) that get client-side navigation — and `![images](https://…)`.

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

- **Entry Meta** — a `date · category` line plus tag chips. Keep the default
  `{{entry.date}}` / `{{entry.category}}` / `{{entry.tags}}` bindings on entry
  templates; each part can be hidden with its **Show** switch.
- **Related Posts** — other entries of the same collection that share the current
  entry's **category or a tag**, newest first. Attributes: **Heading** (default
  "Related articles") and **Limit** (default 3). Renders nothing when the entry has no
  category/tags or nothing matches.
- **Share Bar** — X, LinkedIn, Facebook, and copy-link buttons for the current page
  URL. Attribute: **Heading** (default "Share").

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

:::tip Recent posts anywhere
The Collection Entries block also works on **any** screen — set its **Collection slug**
attribute (e.g. `blog`) and an **Entries limit** to build a "Latest posts" section on
your home page. Its **Filter by category** / **Filter by tag** attributes narrow the
list (e.g. a "Guides only" rail), so filtered landing pages are built as filtered
blocks.
:::

### No template? Still designed

When no template screen is set, the built-in list and article render **inside your site
theme and default shared layout** (the home screen's layout), so blog pages never look
detached from the rest of the site. The built-in article includes the entry meta line
under the title, the cover image, the body, related posts, and a share bar.

## 4. Publish & syndicate

Publish the collection. Aglyn generates an **RSS** feed (entries include their category
and tags) so readers and aggregators can subscribe, and blog pages join the site's
**sitemap** automatically. Each entry's `<head>` uses its SEO title/description
(falling back to title/excerpt) and its cover image as the social card.

## Tips

- Schedule entries ahead of time and let Aglyn publish them for you.
- Pair the blog with the [SEO toolkit](../seo/overview.md) — entries emit JSON-LD for rich
  results.

## Related

- [Save a template](save-a-template.md)
- [Datasets & dynamic content](../../content-and-data/datasets/overview.md)
- [SEO toolkit](../seo/overview.md)
