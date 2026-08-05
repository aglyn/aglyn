---
sidebar_position: 1
title: SEO Toolkit
description: Per-screen SEO, sitemap and robots, Open Graph/Twitter cards, and structured data.
---

# SEO Toolkit

The **SEO toolkit** helps your pages rank and share well. Set metadata per screen, and
Aglyn emits the right tags, sitemap, and structured data automatically.

:::info Plan availability
**Free** for core SEO fields; richer structured data ships for published sites.
:::

![Site setup, where the SEO settings live](/img/custom-domains/setup-domains.png)

## Per-screen SEO

Open **Screen Properties** in the Besigner and use its **SEO** section to set a
**Search title** and **Search description** for that screen, then **Save SEO** — it
saves independently of the canvas, so you can update metadata without touching the
design. The published site emits these into the page head, deduping descriptions so you
never get conflicting tags.

## Search engine visibility

You decide what search engines are allowed to index, at two levels.

### The whole site

**Setup → SEO → Search engines** has a **Discourage search engines from indexing this
site** switch. Turn it on while you stage a launch — the site stays live and anyone with
a link can still reach it, but:

- `robots.txt` refuses every crawler (`Disallow: /`) and names no sitemap
- `sitemap.xml` is served empty
- every page carries `<meta name="robots" content="noindex">`

While it is on, a warning banner follows you through the console on every page of that
site. That is deliberate — a site missing from Google weeks after launch is almost always
this switch, left on and forgotten.

Turning it off restores everything within about a minute. Search engines take longer:
re-indexing a site is their schedule, not yours, so allow days.

:::caution
`robots.txt` and `noindex` answer different questions. `Disallow` asks a crawler not to
*fetch* a page; `noindex` asks it not to *list* one. Aglyn sends both, because a page
linked from somewhere else can be listed without ever being fetched — and a crawler that
obeys the disallow never sees the `noindex` that would have stopped it.
:::

### A single page

Use the page's own **Visibility**, in **Page Access** on the screen's detail page. Only
**Public** pages are offered to search engines. **Unlisted**, **Password protected** and
**Members only** pages are all kept out of search results and out of the sitemap, while
staying reachable to whoever has the link or the credentials.

Use the site-wide switch while nothing is ready, and per-screen **Unlisted** once you're
launching page by page — the switch also covers pages you haven't created yet, which
per-screen visibility cannot.

:::caution `noindex` is a request, not access control
Both controls ask search engines not to list a page. Well-behaved crawlers honour that;
nothing stops a person with the URL. If a page must be genuinely inaccessible, use
[site protection](../site-protection/overview.md) instead.
:::

Walking through a staged launch end to end — coming-soon page, hidden site, signup
collection, and the reversal on launch day — is covered in
[Launch a coming-soon page](../../guides/coming-soon-launch.md).

## Sitemap & robots

Aglyn generates **`sitemap.xml`** and **`robots.txt`** for your site automatically, so
search engines can crawl your site correctly. The sitemap lists your published, indexable
pages — plus your product, collection and blog entry URLs — and always names your site by
its real address (your custom domain when you have one).

## Social cards

Set **Open Graph** and **Twitter** metadata, including images from your
[media library](../../content-and-data/media/overview.md). Aglyn checks media completeness so cards render.

## Structured data

Published sites emit **JSON-LD** for blogs, the site, and breadcrumbs, giving search
engines rich context about your content.

## Analytics integration

Add your **Google Analytics** ID to track traffic alongside Aglyn's built-in
[analytics](../../marketing-and-automation/analytics/overview.md).

## Related

- [Analytics](../../marketing-and-automation/analytics/overview.md)
- [Content collections & blog](../site-templates/overview.md)
