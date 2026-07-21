---
sidebar_position: 1
title: Site Search
description: Let visitors search your site's pages, blog entries, and dataset records with a built-in search page.
---

# Site Search

Give visitors a **Search Box** to find content across your site. Aglyn ships a
built-in search page — there's nothing to configure, enable, or index.

:::info Plan availability
Included on **every plan**, free tiers too.
:::

![The Search component in the elements drawer](/img/besigner/elements-drawer.png)

## How it works

The **Search Box** element is a simple form: a visitor types a query and submits
it to your site's built-in `/search` page, which renders the matching results.
There's no JavaScript and no external search service — the page reads your
published content directly when the visitor searches.

## What it searches

A search matches the query as a case-insensitive substring across three kinds of
content:

- **Screens** — the screen's name, description, and [SEO](../seo/overview.md)
  title and description.
- **Blog & collection entries** — published entries' title, excerpt, and body
  (see [collections](../site-templates/build-a-blog.md)).
- **Dataset records** — a record's [dataset](../../content-and-data/datasets/overview.md)
  values. A record only appears in results when a published screen
  [repeats over that dataset](../../content-and-data/datasets/overview.md#repeatable-components),
  so the result can link to a real page.

Results are listed in that order (screens, then entries, then records), up to
50 matches. There's no relevance ranking — matching is a straight substring
test — so clear titles and descriptions make results more useful. The `/search`
results page is excluded from search engines, and `search` is a reserved screen
slug.

## Configure it

The Search Box exposes one setting — its **Placeholder** text. There are no
scope, result-limit, or styling options; the box inherits your site
[theme](../theme-builder/overview.md).

:::tip How-tos
- [Add search to your site](add-search.md)
:::

## Related

- [Datasets & dynamic content](../../content-and-data/datasets/overview.md)
- [SEO toolkit](../seo/overview.md)
