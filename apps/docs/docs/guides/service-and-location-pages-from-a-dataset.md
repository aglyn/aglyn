---
sidebar_position: 2.5
title: Service and location pages from a dataset
description: Give every record of a dataset its own page from one design — a page per service, per location or per team member, each at its own address, with search titles from your fields and every page in the sitemap.
---

# Service and location pages from a dataset

A contractor offers twelve services and works in eight towns. Each one deserves
its own page: something to link from the home page, a title and description
written for search, and an address worth sharing, like
`/services/kitchen-remodeling`. Building twenty pages by hand means twenty pages
to keep in step every time the design changes.

**Record pages** solve it with one design. You keep the services in a
[dataset](../content-and-data/datasets/overview.md), design one page, and mark it
as the dataset's **record template**. Every record then has its own page, built
from that one design, filled in with that record's values. Change the design once
and every page changes; add a record and its page exists.

This guide builds a services section end to end: the dataset, the template, the
listing page that links to each service, and what search engines see.

:::info Plan availability
**Starter** and above, the plans with datasets. Record pages don't count toward
your plan's pages: the template is one design, and the pages it serves are
bounded by your dataset limits instead.
:::

## 1. Model the data

On the **Data** page, create a dataset called **Services** and give it the
fields a service page shows. For example:

| Field | Type | Used for |
| --- | --- | --- |
| Name | Text | The page heading and its name in the browser tab |
| Summary | Text | The intro paragraph, and the search description |
| Photo | Text | The hero image (a media library image or a URL) |
| Category | Text | Grouping related services |
| Page address | Page address | The service's own segment of its address |

The **Page address** field is what gives each record a page. Its type is
**Page address**, and its values are lowercase words joined by hyphens:
`kitchen-remodeling`, `roof-repair`. You can type each one, but you don't have
to. Set the field's **Fill in from** to the **Name** field, and every record
gets an address made from its name when it's added. A record **keeps its
address when it's renamed**, so a live URL never moves under someone who
bookmarked it.

Already have records? The record template settings below can add the field for
you and give every existing record an address in one step.

Add a record per service. Make sure the dataset is shared with the site that
will show it (**Sharing** on the dataset); a site only serves records of
datasets shared with it.

## 2. Design the template

Create a page for the design. Its own name and address don't matter much,
because once it's a template it no longer answers at its own address. Design it
like any page. Wherever a record's value belongs, write `{{item.field}}`, the
same tokens a [repeat](../building-sites/besigner/repeat.md) uses:

- a heading of `{{item.name}}`
- a paragraph of `{{item.summary}}`
- an image whose source is `{{item.photo}}`
- a reference goes one hop further: `{{item.crew_lead.name}}`

A repeat on the template can list the routed record's neighbors. A Stack that
repeats over **Services** with the filter `category == {{item.category}}` lists
the other services in the same category. The filter fills in from the page's
record, and the copies fill in from their own rows.

## 3. Make it the record template

Open **Page Properties** (**Properties**, at the left of the Besigner toolbar,
or **File ▸ Page Properties**) and scroll to **Record pages**:

1. **Dataset**: pick **Services**. Only datasets shared with this site are
   listed.
2. **Address**: the path the pages live under, such as `services`. Nested
   paths work too, like `services/residential`. Each record's page is the
   address plus its page address: `/services/kitchen-remodeling`.
3. **Page address field**: picked for you when the dataset has one. If it has
   none, choose a text field under **Make addresses from** and press **Make
   addresses**. Every record gets one, made unique where two names collide
   (`roofing`, `roofing-2`).
4. Optionally, choose where each page's name, search title, search description
   and sharing image come from. Anything left on its default uses this page's
   own setting, then the site's.
5. Press **Serve record pages**. The first time, you're asked to confirm that
   the page becomes a template: it stops answering at its own address and no
   longer counts toward your plan's pages.

Publish the template as you would any page. Record pages serve the published
version of the design.

**Preview with** picks the record the canvas draws the template for, so you
design against real content instead of `{{item.name}}` placeholders. Switch
records to check a long name or a missing photo.

## 4. Link to the pages

On your **Services** listing page (an ordinary page at `/services`, say),
repeat a card over the **Services** dataset. Each repeated row carries its
record's page as `{{item.url}}`, so a button or link with the address
`{{item.url}}` goes to that service's page. The canvas previews the real links.

If the dataset has a field of its own called `url`, `{{item.url}}` keeps meaning
that field.

## What visitors and search engines get

- **One page per record** at `/services/{page address}`. An address no record
  holds is the site's 404, and so is the template's own address.
- **The head names the record.** The tab title is the record's name followed by
  the site's title, or its search title exactly as written. The description
  comes from the picked field, and the canonical address is the record's own
  page.
- **The sitemap lists every record page**, with each record's last edit as its
  date. Templates that are unpublished or hidden from search aren't listed.
- **`/llms.txt` names the group**, with its page count and a link to your
  listing page when one is published at the base.
- **Pages stay fresh.** Editing, adding or removing a record refreshes its page
  and the pages listing it, whether the change comes from the Data page, an
  import, a form, an automation or the REST API. Publishing the template
  refreshes every page it draws.

## When records go away

- A record with no page address has no page; give it one and its page appears.
- If two records share an address, the one first in the dataset's order gets
  the page.
- If the dataset stops being shared with the site, or is deleted, its record
  pages stop answering. They 404 rather than show data the site may no longer
  see.
- **Stop serving** in **Record pages** takes every record page down. The page
  stays a template, so it doesn't answer at its own address either.
- A site that switches the Data plugin off serves no record pages.

## Locations, team members, portfolio

The same steps cover any set of similar pages:

| Dataset | Address | A record's page |
| --- | --- | --- |
| Service areas | `service-areas` | `/service-areas/round-rock` |
| Team | `team` | `/team/marisol-vega` |
| Projects | `work` | `/work/hillside-kitchen` |

Each dataset has one record template per site. Two templates can nest, like
`services` and `services/residential`, but never share an address. An address
can't take a path the site already uses for a content collection (`/blog`), the
store (`/products`, `/collections`), author pages (`/author`) or a reserved
address.

## Related

- [Datasets overview](../content-and-data/datasets/overview.md#record-pages)
- [Build a data model](../content-and-data/datasets/model-builder.md)
- [Repeat over data](../building-sites/besigner/repeat.md)
- [Datasets & schema deep-dive](datasets-and-schema.md)
