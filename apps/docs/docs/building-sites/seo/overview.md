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

<!-- screenshot: seo/setup-seo-tab.png per SCREENSHOT_PLAN.md (replaces the borrowed custom-domains image) -->

## Per-screen SEO

Every screen's detail page has an **SEO** card with three fields:

- **Title** — up to 60 characters; overrides the site title on this page.
- **Description** — up to 155 characters, the meta description.
- **Social image URL** — shown as the `og:image` preview when the page is shared.

Fill them in and press **Save SEO** — it saves independently of the canvas, so you can
update metadata without touching the design. The published site emits these into the
page head, deduping descriptions so you never get conflicting tags.

<!-- screenshot: seo/screen-seo-card.png per SCREENSHOT_PLAN.md -->

Anything you leave blank falls back sensibly: the title falls back to the screen's
display name (joined to the site title with your separator), the description to the
screen's own description and then the site's, and the social image to the site-wide one.

### Site-wide defaults

**Setup → SEO** holds the site-level fields every screen inherits: the site **Title**
and **Description**, the **Separator** used to join page and site titles (default
`–`), the **Favicon**, and an **Entity** block (Organization or Person, with a name
and logo) that feeds the site's structured data.

## Search engine visibility

You decide what search engines are allowed to index, at two levels.

### The whole site

**Setup → SEO → Search engines** has a **Discourage search engines from indexing this
site** switch. Turn it on while you stage a launch — the site stays live and anyone with
a link can still reach it, but:

<!-- screenshot: seo/search-engines-card-on.png per SCREENSHOT_PLAN.md -->

- `robots.txt` refuses every crawler (`Disallow: /`) and names no sitemap
- `sitemap.xml` is served empty (valid but with no URLs, so search consoles read
  "nothing here" rather than an error they retry)
- every page carries a `noindex` robots meta tag — links are still followed, but the
  page is not listed

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

<!-- screenshot: seo/page-access-visibility.png per SCREENSHOT_PLAN.md -->

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
search engines can crawl your site correctly. The sitemap always names your site by its
real address (your custom domain when you have one), and includes:

- every published screen whose visibility is **Public** — template screens (blog list/
  entry templates, product page templates) are excluded, since their real URLs are the
  entries and products they render;
- your **product** and catalog **collection** URLs, once a product-page or
  collection-page template is set;
- your **content collections** — each collection's list URL and its **published**
  entries. A scheduled entry joins the sitemap once its publish time passes.

The sitemap is cached for a few minutes, and every publish refreshes it immediately —
so a freshly published page never waits on the cache.

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
