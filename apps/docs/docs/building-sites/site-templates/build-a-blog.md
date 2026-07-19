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

Add **rich blog entries** with images, a **preview**, and **scheduling** so posts publish at
the right time.

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
| `{{collection.name}}` / `{{collection.slug}}` | The routed collection |

:::tip Recent posts anywhere
The Collection Entries block also works on **any** screen — set its **Collection slug**
attribute (e.g. `blog`) and an **Entries limit** to build a "Latest posts" section on
your home page.
:::

### No template? Still designed

When no template screen is set, the built-in list and article render **inside your site
theme and default shared layout** (the home screen's layout), so blog pages never look
detached from the rest of the site.

## 4. Publish & syndicate

Publish the collection. Aglyn generates an **RSS** feed so readers and aggregators can
subscribe.

## Tips

- Schedule entries ahead of time and let Aglyn publish them for you.
- Pair the blog with the [SEO toolkit](../seo/overview.md) — entries emit JSON-LD for rich
  results.

## Related

- [Save a template](save-a-template.md)
- [Datasets & dynamic content](../../content-and-data/datasets/overview.md)
- [SEO toolkit](../seo/overview.md)
