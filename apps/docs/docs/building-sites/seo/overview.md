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

- **Search title** — up to 60 characters, published exactly as you type it.
- **Search description** — up to 155 characters, the meta description.
- **Social image** — the picture shown when the page is shared. Press **Choose
  image** to pick one from your [media library](../../content-and-data/media/overview.md)
  (or the organization's shared library); **Clear** puts the site default back.

Fill them in and press **Save SEO** — it saves independently of the canvas, so you can
update metadata without touching the design. The published site emits these into the
page head, deduping descriptions so you never get conflicting tags.

The social image is a media **pick**, not a URL you type. That is deliberate: a
picked asset is stored by identity, so moving it into a folder or replacing it
with a new version keeps every card that references it working.

<!-- screenshot: seo/screen-seo-card.png per SCREENSHOT_PLAN.md -->

Anything you leave blank falls back sensibly: the description falls back to the
screen's own description and then the site's, and the social image to the site-wide
one.

### How a page title is built

A **search title** you write is the whole title — nothing is appended to it. That is
what lets you keep every page inside the ~60 characters a search result shows, and
say the brand once rather than twice.

A page with no search title of its own is titled from its **name** — the screen's
display name, a blog post's headline, a collection's name — joined to the site
**Title** with your **Separator**:

| Page | Rendered title |
| --- | --- |
| Search title `About Aglyn — one platform for the open web` | `About Aglyn — one platform for the open web` |
| Screen named `Contact`, no search title | `Contact – Acme Widgets` |
| Neither | `Acme Widgets` |

Your brand still travels with every share regardless: the site title is published as
`og:site_name` on every page.

### Site-wide defaults

**Setup → SEO** holds the site-level fields every screen inherits: the site **Title**
and **Description**, the **Separator** used to join a page's name to the site title
when that page has no search title of its own (default `–`), the **Favicon**, an
**App icon**, a **Social image**, and an **Entity** block (Organization or Person,
with a name and logo) that feeds the site's structured data.

The **App icon** is the square mark someone installs to a phone or desktop home
screen, and it is a third picture rather than a reuse of the other two on purpose: a
favicon is a 16–32px glyph with nowhere near the resolution, and a site logo is
usually a wordmark, which an operating system crops to a square tile. Leave it unset
and installing your site falls back to the logo, exactly as it always has. Bring a
square PNG at 512×512.

The **Social image** card is the default card for the whole site — every page that
sets none of its own uses it, including collection lists and blog entries with no
cover image. Set one and no page of your site ever shares as a bare, image-less
link again.

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

![The Page Access card on a screen's page, with the Visibility menu open on Public, Unlisted, Password protected and Members only](/img/seo/page-access-visibility.png)

Use the site-wide switch while nothing is ready, and per-screen **Unlisted** once you're
launching page by page — the switch also covers pages you haven't created yet, which
per-screen visibility cannot.

:::caution `noindex` is a request, not access control
Both controls ask search engines not to list a page. Well-behaved crawlers honor that;
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

### One index, one file per section

`sitemap.xml` is a **sitemap index**: instead of listing your URLs directly, it names a
child sitemap for each part of your site, and each child holds that part's URLs.

```text
https://your-site/sitemap.xml
  ├─ /sitemaps/pages/1.xml          your screens
  ├─ /sitemaps/products/1.xml       your products
  ├─ /sitemaps/catalog/1.xml        your catalog collections
  ├─ /sitemaps/content-blog/1.xml   the blog, and its published entries
  └─ /sitemaps/content-news/1.xml   … one per content collection
```

Submit `sitemap.xml` and nothing else — every search engine follows an index to its
children on its own. You never write these child URLs yourself, and the index adds and
drops them as you add and remove collections.

The split is what keeps a growing site correct. A single sitemap may hold at most
**50,000 URLs**, and anything past that is not submitted at all — silently. A section
that outgrows one file simply continues into a second (`/sitemaps/content-blog/2.xml`),
and the index names both.

Every URL with a known date carries a last-modified date (`lastmod`) — the day a
screen was last published, the day an entry, product or catalog collection last
changed, and for a listing the day of its newest entry — so a crawler can skip what
has not moved since its last visit. A URL whose date is not known simply has none;
the sitemap never invents one.

The sitemap is cached for a few minutes, and every publish refreshes it immediately —
so a freshly published page never waits on the cache.

## Social cards

Every published page emits **Open Graph** and **Twitter** metadata: title,
description, canonical URL, site name, and — once an image is set — `og:image`
with its `og:image:width` and `og:image:height`.

Which image a page uses is decided in this order:

1. the **entry's cover image**, for a blog or collection entry;
2. the **screen's own social image**, from its SEO panel;
3. the **site default**, from Setup → SEO;
4. nothing.

The first three make the page share as a **large** card
(`twitter:card: summary_large_image`). Only the fourth falls back to the small
image-less `summary` card, which is why setting a site default is worth doing once.

**Size.** 1200×630 is the size every network crops well. Aglyn reads the real
dimensions off the media record and publishes them, so previews reserve the right
shape before the image finishes loading — it does not assume a size, so a different
ratio is described honestly rather than stretched.

**Addresses.** Card images are always published as absolute URLs on your site's own
domain (your custom domain when you have one). A crawler fetches the image without a
page to resolve a relative path against, so a relative address is a blank card.

## Structured data

Published sites emit **JSON-LD** for blogs, the site, and breadcrumbs, giving search
engines rich context about your content.

Every page also carries a top-level **`Organization`** (or `Person`) describing who
publishes the site — the entity AI assistants read when someone asks who you are or
how to reach you. It is filled in from **Setup → SEO → Entity**, and it falls back to
your site name and description, so a site that has never touched that form still
publishes a named, described entity.

Two fields are worth adding by hand, because nothing can guess them:

- **Contact email / phone**, published as `contactPoint`;
- **Address**, published as a `PostalAddress`. Partial is fine — a city and a country
  are still a real answer.

## AI agents

Agents read a site differently from a browser. Aglyn publishes four things for them,
on every site, with nothing to switch on.

### Markdown for any page

Every page serves a **Markdown** version of itself with the navigation, styling and
scripts removed. Two ways to ask:

```bash
curl -H "Accept: text/markdown" https://your-site/pricing
curl https://your-site/pricing.md
```

Both return the same document: the page title, its summary, the content region, and a
`Source:` line carrying the canonical URL. Site chrome is left out — that is the point.
The HTML page links to its own Markdown with
`<link rel="alternate" type="text/markdown">`, so an agent reading the HTML can find it.

A request that accepts neither HTML nor Markdown — `Accept: application/pdf`, say — is
answered `406 Not Acceptable` with a plain-text list of what IS available. Ordinary
browser requests are never affected.

The **search** page is the one exception: its results are computed in the browser, so
there is no Markdown version to serve and it stays HTML.

### `/llms.txt`

A short guide at `https://your-site/llms.txt` telling an agent what the site is for and
which addresses answer what — your collections and their entry counts, search, the
sitemap, the API description, and a contact route when you publish one.

You can lead it with your own words. **Setup → SEO → AI agents** has two boxes:

- **When to use this site** — the questions you are the best source for. Be specific;
  an agent discounts a claim it cannot check, and generic marketing copy does not read
  as guidance.
- **How an agent should call you** — anything worth knowing before it fetches.

Both are optional. The rest of the file is derived from what your site actually
publishes, so it is never empty and never out of date.

### `/openapi.json`

A machine-readable **OpenAPI 3.1** description of everything your site serves, generated
per site so it always names your own domain. Every operation carries a unique
`operationId`, a description, typed parameters and a response schema — the shape an AI
tool-calling integration reads to turn your site into callable functions.

It describes reads only. Your forms still work exactly as they did; they are simply not
listed as an endpoint for every crawler on the internet to call.

### Crawler access

`robots.txt` names the major AI crawlers and assistants explicitly — GPTBot,
ClaudeBot, Google-Extended, PerplexityBot and the rest — and allows them, alongside the
usual wildcard rule.

Turning on **Discourage search engines** reverses all of it in one switch: `robots.txt`
refuses everything including those named agents, and `/llms.txt` and `/openapi.json`
stop being served at all.

## Analytics integration

Add your **Google Analytics** ID to track traffic alongside Aglyn's built-in
[analytics](../../marketing-and-automation/analytics/overview.md).

## Related

- [Analytics](../../marketing-and-automation/analytics/overview.md)
- [Content collections & blog](../site-templates/overview.md)
