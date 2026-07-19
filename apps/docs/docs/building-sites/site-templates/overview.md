---
sidebar_position: 1
title: Templates, Blocks & Content
description: Start from templates, drop in pre-built sections and blocks, and publish a blog with collections.
---

# Templates, Blocks & Content

Build faster by starting from something. Aglyn gives you **site templates**, a **section &
block library**, and a **blog** with content collections.

:::info Plan availability
**Free** to use the starter gallery and block library. Some templates and content features
scale with your tier.
:::

![Templates in the community marketplace](/img/plugins/community-page.png)

## Site templates & starter gallery

- Spin up a new site from the **starter template gallery**, which instantiates published
  screens for you.
- **Save a site as a template**, then browse and install community templates.

## Section & block library

Drop in pre-built **sections and blocks** from the library instead of assembling every page
from primitives — a fast way to build common layouts.

The library is a first-class group in the Besigner: open **INSERT → New Element** (or the
components drawer) and the **Sections & Blocks** category sits at the top of the list,
ahead of the primitive element groups. Every entry inserts a ready-made subtree with
sensible props — drop it in, then edit text and styles in place.

The library ships these sections:

| Block | What it inserts |
| --- | --- |
| **Nav Bar** | App bar + toolbar with brand text and three screen links, in page flow (switch its Position attribute to *Sticky* for a pinned header) |
| **Hero** | Centered headline, tagline, and call-to-action button |
| **Feature Grid** | Three selling-point columns that wrap on small screens |
| **Image + Text** | Image beside a heading, paragraph, and link button |
| **Testimonials** | Three customer quote cards |
| **Pricing Table** | Three plan columns with features and plan buttons |
| **FAQ** | Question-and-answer list with a heading |
| **Call to Action** | Accent-colored band with a heading and button |
| **Contact Section** | Heading plus a working name/email/message form |
| **Announcement Bar** | Accent strip with a message and link |
| **Image Gallery** | Three-across image row |
| **Footer** | Semantic `<footer>` with brand, screen links, social icons, and copyright |

Blocks are ordinary elements once inserted — nothing is locked. Screen links resolve
against your site's screens (pick targets in the link's attributes), the contact form
submits like any [form](../../content-and-data/forms/overview.md), and social icons
appear once you add profile URLs.

## Content collections & blog

- Create **collections** managed in the console.
- Publish a **blog** with rich entries (images, preview, scheduling) and an **RSS** feed.
- Use **entry-template screens** with `{{entry.*}}` bindings to render each collection item.

:::note More detailed how-tos coming
Guides for building a blog and saving your own template are on the way.
:::

## Related

- [The Besigner](../besigner/overview.md)
- [Datasets & dynamic content](../../content-and-data/datasets/overview.md)
- [SEO toolkit](../seo/overview.md)
