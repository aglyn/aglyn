---
sidebar_position: 2
title: Pages
description: How each page of your site gets a slug, how the hierarchy builds your URLs, how groups organize pages without changing them, and which pages count against your plan.
---

# Pages

Each **page** of your site has a title, a URL slug, and a place in a hierarchy
that decides the address visitors reach it at.

The page hierarchy maps directly to your URL paths:

```mermaid
flowchart TD
  Home["Home — /"] --> Services["Services — /services"]
  Home --> About["About — /about"]
  Services --> Pricing["Pricing — /services/pricing"]
  Services --> Support["Support — /services/support"]
```

:::info Plan availability
**Free** for core pages. Higher tiers raise the cap on how many pages a site can
publish.
:::

## Pages & routing {#screens--routing}

- Each page has a **title** and a URL **slug**. Aglyn normalizes slugs and keeps a
  site **routing map**.
- Pages form a **hierarchy**: pick a parent and the child inherits a nested path
  (`/services/pricing`). Changing a slug or parent cascades safe rewrites across the map,
  with cycle guards so you can't create a loop. See
  [What a move does to a URL](#what-a-move-does-to-a-url).
- Reorder the hierarchy with **drag-and-drop** in the pages list. To organize pages
  without changing their addresses, put them in a [group](#page-groups).
- The pages list shows each page's **Published** date, and the page's detail view
  shows **Date published**. Both stay empty until the page goes live, and clear again if
  you unpublish it (including a scheduled unpublish) — so the column tells you what's
  live, not what exists. A page you've just created is a **draft**: it holds its slug
  but nothing resolves there until you publish it.
- **Unpublish** takes a live page off your site. It's in the row's **⋮** menu on the
  pages list (on published pages), on the page's detail view under **Publishing**,
  and on the Besigner toolbar. The page, its versions and its slug are all kept, so
  publishing again puts it back at the same address.
- Unpublishing or deleting a page takes **that page alone** off your site. Pages
  nested under it stay live at their own addresses, and the confirmation lists them,
  so you can unpublish them one by one if that's what you meant. A scheduled
  unpublish works the same way.

## Page groups {#page-groups}

A **group** is a folder in the pages list. It holds pages and is not one: it has no
slug, no content and no address of its own, and it's never published, previewed or
listed in your sitemap or navigation.

A group adds **nothing** to the URLs of the pages in it. A page inside a group is
served exactly where it would be if it sat at the group's own level, so a group of
landing pages keeps `/launch-waitlist` at `/launch-waitlist`. Groups can sit inside
other groups, and inside a page: a group under **Services** holds pages at
`/services/...`, just as if they were Services' own children.

- **New group** on the pages list creates one. Drag pages onto it to move them in, and
  drag them out again the same way. Click a group's row to open or close it.
- Moving a page **into or out of a group never changes its address**, because the
  page it's composed under stays the same. The pages list checks this before it saves
  the move, and refuses the move rather than change a live address.
- **Rename** and **Delete** are in a group's **⋮** menu. Deleting a group keeps
  everything in it: its pages move up a level, to where the group was, at the same
  addresses. Nothing is unpublished.
- A group doesn't count against your page allowance, and you can't pick one where a
  page is expected, such as an error page, a sign-in page, an A/B test, a redirect or
  a collection template. In the Besigner's **Parent page** picker, groups are marked
  **(group)**.

## What a move does to a URL {#what-a-move-does-to-a-url}

A page's address is its own slug under the slugs of the **pages** above it. Moving a
page changes its address only when the page it's composed under changes:

| Move | Address |
| --- | --- |
| Into or out of a group at the same level | Unchanged |
| Under a published page, say **Services** | Becomes `/services/your-page` |
| Under a page that has a slug but isn't published | Becomes the composed path. The page stays live there; the parent stays unpublished. |
| Under a page with no slug | Unchanged. It keeps its current address until you publish it again. |
| To the top level | Becomes `/your-page` |

Pages nested under the one you move come along with it. A move never takes a live page
off your site, and it never publishes a page that wasn't live: a draft you move stays
a draft.

A page that keeps its address when the page above it loses its slug, or is deleted,
stays at that address from then on. If you later publish that parent again, the page
doesn't move with it; publish the page itself to give it the new address.

![The pages list](/img/getting-started/screens-list.png)

![Editing a page in the Besigner](/img/besigner/besigner-editor.png)

## What counts against your page allowance {#what-counts-against-your-screen-allowance}

Your plan's page limit counts the pages that have **an address of their own** — the
ones a visitor can reach at a URL. Some pages you design never get an address, and
those don't count:

| Page | Counts? | Why |
| --- | --- | --- |
| A page you publish at a slug | **Yes** | It has a URL of its own. |
| A collection's **list** template | **Yes** | `/{collection}` renders that exact page. |
| A collection's **entry** template | No | One page composes every entry; it has no address of its own. |
| An [error page](../site-protection/error-screens.md) you've assigned | No | It renders on addresses that matched nothing. |
| An [email](../../marketing-and-automation/email-campaigns/overview.md) you design | No | It's sent, never served at a URL. |
| A page you've deleted | No | Deleting frees the slot straight away. |
| A [group](#page-groups) | No | It holds pages; it has no address or content of its own. |

The rule behind the table is one question: **does the page occupy a URL of its own?**
So an error page that is *also* still published at its own address — say a 404 page
you published at `/404` while designing it — has an address, and it counts until you
remove that address. The **Error pages** card tells you when that's the case and offers
the one-click **Remove address**; the page carries on rendering for its status code
afterwards.

## Duplicate a page {#duplicate-a-screen}

Every row on the Pages list has **Duplicate…** in its menu. The copy takes
the latest saved version whole — the element tree, layout values, description
and SEO fields — under the name you give it (`Copy of Home` by default; a name
another page already has gets a number). Its slug becomes `home-copy`, then
`home-copy-2`, so it never claims the original's address.

The copy is a **draft**: it has no address on the live site until you publish
it, exactly like a page you created from scratch. Components and layouts
placed on the original are shared, not copied — the duplicate points at the
same ones. A duplicate counts against your page allowance the moment it is
made, and is refused with the same message a new page would be when the
allowance is spent.

A collection's **entry template** can be duplicated too, which is how a second
collection starts from the first one's design. The copy is still an entry
template, with every `{{entry.*}}` binding kept: it isn't published, and no
collection uses it until you pick it as a collection's **Entry page** in
Content. Like the original, it doesn't count against your page allowance. An
error page can't be duplicated.

## Error & maintenance pages {#error--maintenance-screens}

You can design custom **404 / 401 / 403 / 503** pages and turn on **maintenance mode**.
See [Site protection & error pages](../site-protection/overview.md).

## Related

- [Layouts](layouts.md) — the shared frame a page renders inside
- [Versions & scheduled publishing](versions-and-publishing.md)
- [The Besigner](../besigner/overview.md)
- [Bindings & variables](../bindings/overview.md)
- [SEO toolkit](../seo/overview.md)
