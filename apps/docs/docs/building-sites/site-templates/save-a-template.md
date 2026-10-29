---
sidebar_position: 3
title: Save & share a template
description: Turn a site into a reusable template and install marketplace templates.
---

# Save & share a template

Turn a site you've built into a **template** others can start from — or start your own site
from the marketplace gallery.

:::info Plan availability
**Free** to use the starter gallery; sharing scales with your tier.
:::

![The pages list, with the Templates button that opens the "Start from a template" picker next to Create New Page](/img/getting-started/screens-list.png)

## Start from a template

Open the **starter template gallery** and install a template. It lands in
[your templates library](./templates-library.md) as one page template per page —
publishing nothing until you choose which pages you want. Aglyn's own starter
templates still create their pages straight away, since you pick those when a site
is empty.

### Where to find it

**Templates** sits next to the create button on three lists, and each one offers
templates of its own kind:

| List | What the picker offers |
| --- | --- |
| **Pages** | Page templates, plus Aglyn's starter sites and marketplace templates |
| **Layouts** | Layout templates |
| **Components** | Component templates |

Starter sites and marketplace templates are whole-site page bundles, so they appear
only on **Pages** — a layout or component picker would have nothing to do with
them.

The filter icon in the dialog's header opens the picker's search box, which finds a
template, a starter or a marketplace listing by the start of any word of its name —
its name only, not its description or category. It reads the first word you type.
Each shelf asks its own query, so the search looks through your whole library and the
whole marketplace, not only the cards on screen, and your templates and the
marketplace templates page through what matched.

## Save your site as a template

Saving a *whole site* is not done from the pages list — it lives in **Setup**.

1. Open **Admin → Backup & template** for the site and find the **Site template** card.
2. Click **Publish as template**.
3. Fill in **Template name**, **Description**, **Category** (e.g. Portfolio, Restaurant) and
   **Price (USD, 0 = free)**, then publish.

This captures **every published page plus the theme**, and publishes it to the
**marketplace** — so it is a share, not a private snapshot. Re-publishing bumps the
version. Add a preview image afterwards from **Manage → Marketplace**.

### Saving a single page instead

To reuse one page rather than a whole site, use the **⋮** row menu on the **Pages** list
and choose **Save as template**. **Layouts** and **Components** have the same row action.
These save into [your own templates library](./templates-library.md) and are **not**
published anywhere until you publish them separately.

## Publish as a starter {#publish-as-a-starter}

**Publish as a starter is rolling out**, and your workspace may not have it yet. Where it
is on, the **Site template** card also offers **Publish as a starter**.

A [site starter](site-starters.md) is a ready-made website people pick in **Create site**,
before their site exists: the new site is born with its pages, its shared header and
footer, and its theme. Publishing your site as one:

1. Open **Admin → Backup & template** for the site and find the **Site template** card.
2. Click **Publish as a starter**.
3. Check **Listing name** and **Description**, which start as the site's name and
   description, and fill in **What kind of site is it?** (for example Bakery or Law firm).
4. Set **Price (USD)**, or leave it empty for a free starter.
5. Choose its **Theme**. Nothing is chosen for you, and **Publish** waits until you
   choose:
   - **This site's built-in theme with its brand colors**: the built-in theme the site
     wears, with the brand colors you set over it and its fonts. A site created from the
     starter can switch to another built-in theme. When your site wears a theme of its
     own rather than a built-in one, this choice is unavailable and the window says why.
   - **The site's full theme**: every color, font and style your site's theme sets. A
     site created from the starter gets it as one of its themes, named after the starter.
6. Pick a **Closest style** if you like: the kind of site your starter is listed under
   when people choose a starter.
7. Tick **I agree to the Marketplace Publisher Agreement**, then click **Publish**.

![The Publish as a starter window: Listing name, Description, What kind of site is it?, Price (USD), the pages it captures, the Theme choice with This site's built-in theme with its brand colors chosen, Closest style, the publisher agreement box, and Publish](/img/building-sites/publish-as-starter.png)

### What it captures {#what-a-starter-captures}

- **Every published page**, as it was last published. A page that was never published is
  left out. The window says how many pages it captures.
- **The shared header and footer** your Home page sits in.
- **The theme you chose**.

Your site itself is unaffected.

### Before you can publish {#before-you-publish-a-starter}

The window says what is missing before you click **Publish**, with a link to where you
set it up, and **Publish** stays unavailable until it is done:

- a plan that includes selling on the marketplace (**See plans**);
- a publisher profile, under **Marketplace → Publisher Profile**;
- payouts, under **Marketplace → Payouts**, for a starter with a price;
- a published Home page, and no more pages than a starter can hold.

If the publish is still refused (a page holds something a starter cannot carry, or a
brand color cannot be read on its page, for example), the window says why in its own
words and keeps what you entered, so you can fix it and publish again.

### After you publish {#after-you-publish-a-starter}

A new starter is reviewed by Aglyn before anyone else can see it. Publishing the same site
as a starter again publishes a new version of the same starter, and a starter that is
already listed stays listed. Every publish asks you to agree to the Marketplace Publisher
Agreement again.

## Tips

- Templates are a fast way to reuse a proven layout across client sites.
- Combine with the [section & block library](overview.md#section--block-library) for
  page-level reuse without a whole template.

## Related

- [Build a blog](build-a-blog.md)
- [Templates, blocks & content](overview.md)
