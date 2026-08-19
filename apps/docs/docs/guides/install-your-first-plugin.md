---
sidebar_position: 9
title: Install your first marketplace item
description: A click-by-click walkthrough of the Marketplace — find something, choose which sites get it, install it, and turn it off again.
---

# Install your first marketplace item

The **Marketplace** is where you add capability to Aglyn that you didn't build
yourself: plugins, ready-made site templates, themes, layouts, components, dataset
schemas and email templates. This guide walks the whole loop once — find, install,
use, upgrade, remove — clicking every step.

No code, and nothing you can't undo. The only decision worth slowing down for is
**which sites it lands on**, and step 4 is entirely about that.

:::info Plan availability
**Free** to browse and install. Individual listings may cost money — the button says
so before you buy. *Publishing* your own listing is a separate thing and needs Pro;
see [Publish a plugin](../developers/plugins/publish-a-plugin.md).
:::

## Before you start

You need an organization with at least one site, and a role that can install. By
default that's **owner**, **admin** *and* **editor** — installing is treated as
content work, not an account setting. **Viewers** cannot, and a custom role can only
if it carries the **Install plugins** permission.

If the Marketplace opens but the Install button doesn't, that's the role, not the
plan — see [Teams & roles](../workspace-and-billing/teams-and-roles/overview.md).

## Step 1 — Open the Marketplace {#step-1-open}

In the **organization** navigation (the top-level one, not a site's), choose
**Marketplace**.

It's at the organization level on purpose. What you install is available to every site
you choose, so it isn't a per-site setting, and you don't repeat the work for each
site you run — the thing agencies and multi-site teams notice first.

<!-- screenshot: marketplace/org-nav-marketplace-and-plugins.png per SCREENSHOT_PLAN.md -->

Its own navigation panel lists:

- **Browse All** — the catalogue.
- **Installed** — what you already have, with upgrade and uninstall.
- and, once you publish, the seller sections: **Upload / Publish**, **Publisher
  Profile**, **Listings**, **Payouts**, **Sales**.

:::tip Marketplace is the shop; Plugins is the switch
There is a separate **Plugins** section in the same organization navigation. That is
where things get turned **on and off** — including Aglyn's own built-in plugins.
Marketplace installs, Plugins toggles. If you are looking for a switch and can't find
one, you're in the wrong section. [More on the split](../developers/plugins/overview.md).
:::

## Step 2 — Find something {#step-2-browse}

**Browse All** is a grid of listing cards you can search, filter and sort. Cards are a
catalogue only — clicking one takes you to its **detail page**, which is the only
place an install can happen. You cannot install by accident from the grid.

<!-- screenshot: marketplace/listing-detail-header.png per SCREENSHOT_PLAN.md -->

On the detail page, read three things before anything else:

1. **What kind of thing it is.** A *plugin* adds capability. A *template*, *theme*,
   *layout* or *component* adds design you then edit. A *dataset schema* adds an empty
   dataset with its field model — **records never travel**, so you're getting the
   shape, not somebody's data.
2. **The badges.** They make two different claims, and it's worth knowing which is
   which — see [what the badges mean](../developers/plugins/overview.md#what-the-badges-on-a-listing-mean).
3. **The price.** A paid listing's button reads **Buy for $12** rather than
   **Install**. Free ones just say **Install**.

## Step 3 — Read the reviews, and know who can leave one {#step-3-reviews}

Ratings on a listing come only from people with a **verified email** whose
organization **actually installed it**. Comments are open to any signed-in user. So a
listing's star rating is a claim by users, and its comment thread is a claim by
anyone — weight them differently.

## Step 4 — Choose which sites get it {#step-4-targeting}

This is the step to read.

On the detail page you'll find an **Install to** dropdown with two options:

| Option | What it means |
| --- | --- |
| **All sites** | Everything in the organization. For a plugin, that includes **sites you add later**. |
| **Selected sites** | Only the sites you tick. A **Sites** checklist appears underneath — tick at least one. |

<!-- screenshot: marketplace/install-to-selected-sites.png per SCREENSHOT_PLAN.md -->

The helper text under the dropdown tells you exactly what will happen for *this*
listing, because it isn't the same for every kind:

- A **plugin** installed to "All sites" is genuinely organization-wide, and a site you
  create next month gets it too.
- **Components, templates and layouts are site-scoped.** "All sites" copies them onto
  every site you have *right now*, and a site you add later will **not** have them.
  The helper text says so — it reads "Installs to all 4 sites. New sites won't get it
  automatically."

"Selected sites" only appears when there's a choice to make, so on a one-site
organization you won't see it.

:::caution Every site here is a live site
There is no staging site in Aglyn. Whatever you install is reachable by real visitors
as soon as it's on a site. If you want to try something cautiously, install it to
**one** site — ideally the quietest one — rather than to all of them.
:::

## Step 5 — Install it {#step-5-install}

Press **Install** (or **Buy for $…**). A confirmation dialog names the listing, its
type, its **version**, and — in bold — exactly where it's going:

> Install **Bookings Pro** (plugin, v2.1).
> This will be installed to **all sites**.

<!-- screenshot: marketplace/install-confirm-dialog.png per SCREENSHOT_PLAN.md -->

Read that bold phrase. It is the last chance to catch a mis-set target, and it is why
the dialog exists.

Choose **Install**. That's it.

Two things happen that are worth knowing:

- **The install is version-pinned.** You have v2.1 and you keep v2.1 until you
  deliberately upgrade. A publisher shipping v2.2 tomorrow does not change your sites
  overnight.
- **A plugin is enabled for the workspace automatically.** You don't have to go and
  switch it on after installing.

## Step 6 — Use it {#step-6-use}

Where it shows up depends on what you installed:

- **Plugins** add a named group to the Besigner's **elements drawer**, and often a
  page in the console navigation.
- **Components, layouts and templates** appear in the drawer and in your site's
  templates library, badged **Marketplace** with the version they came from.
- **Themes** apply to the site you chose.
- **Dataset schemas** appear as a new, empty dataset under **Data**.
- **Email templates** arrive as a **draft** email you can edit before sending.

## Step 7 — Turn it off, or take it back off {#step-7-off}

Three different actions, often confused:

| You want to | Where | What happens |
| --- | --- | --- |
| Stop it running, keep it | **Plugins** → its switch | Off everywhere in the workspace. Flip it back any time. |
| Remove it from your sites | **Marketplace → Installed** → **Uninstall**, or **Uninstall org-wide** on an org-wide install. The listing's own detail page carries the same button. | The pin and the switchboard entry go. |
| Update it | **Marketplace → Installed**, or the detail page's **Update to v2.2** button | You move to the new version, deliberately. |

<!-- screenshot: plugins/plugins-switchboard-cards.png per SCREENSHOT_PLAN.md -->

**Uninstalling never deletes the data a plugin created.** Reinstall it and it picks up
where it left off. That is deliberate — an accidental uninstall shouldn't cost you a
year of bookings — but it also means uninstalling is *not* how you erase data. For
that, delete the data itself.

Design copied onto a site behaves differently, and the difference matters: a component
or template you installed and then **edited** is now *your* copy. Uninstalling the
listing doesn't reach into your screens and remove it, and updating shows you field by
field what the publisher's new version would overwrite before it touches your edits.

## What to do next

- **Running several client sites?** [Run an agency workspace](./run-an-agency-workspace.md)
  covers standardising installs across sites, and automating the rest.
- **Want to build one?** [Build your first plugin](../developers/plugins/guides/first-plugin.md)
  is the developer half of this page — same product, written for someone who codes.
- **Selling one?** [Publish a plugin](../developers/plugins/publish-a-plugin.md) and
  the [publisher handbook](../developers/plugins/publishing/publisher-handbook.md).

## Related

- [Plugins & Marketplace](../developers/plugins/overview.md) — the reference: install
  scopes, badges, sandboxing, and the Marketplace/Plugins split.
- [Your templates library](../building-sites/site-templates/templates-library.md) —
  where installed design lands, and how a marketplace copy is badged.
- [Teams & roles](../workspace-and-billing/teams-and-roles/overview.md) — who is
  allowed to install.
