---
sidebar_position: 3
title: Publish your first screen
description: Create a screen, design it in the Besigner, and publish it live.
---

# Publish your first screen

This walks through the core loop: **create → design → publish**.

![The screens list with each screen's publish state](/img/getting-started/screens-list.png)

:::tip Publish from the editor
You don't have to leave the Besigner to go live: the **Publish** button in
the top-right of the editor publishes the version you're editing (and
flips to **Unpublish** once the screen is live). Screens without a URL
path yet are prompted to set one in Properties first.
:::

## 1. Create a screen

1. Go to **Screens** and choose **New screen**.
2. Set a **title** and a URL **slug** (e.g. `about`). Aglyn normalizes the slug and
   stores it on the screen, ready for when you publish.
3. Optionally pick a **parent** screen — children inherit a nested URL path
   (`/services/pricing`).

:::info A new screen is a draft
Creating a screen doesn't put anything on your live site — its **Date published**
stays empty and nothing resolves at its address until you publish it in step 3.
Design it first, publish when it's ready.
:::

## 2. Design it in the Besigner

1. Open the screen to launch the **[Besigner](../building-sites/besigner/overview.md)**.
2. Drag components from the drawer onto the canvas. Rearrange them in the **hierarchy**
   panel or directly on the canvas.
3. Double-click text to edit it inline. Set component attributes in the inspector.
4. Bind a shared **[layout](../building-sites/screens-and-layouts/layouts.md)** if you want a
   common header/footer.

## 3. Preview and publish

1. Use the artboard **light/dark toggle** to check both color schemes.
2. **Save** the canvas. Saving writes your working version — it isn't publishing.
3. **Publish**. The screen's slug is registered in the routing map and the page goes live
   on your site's domain.

:::info Keeping more than one version is a Pro feature
Every screen is created with one working version, and **Save** updates that version on
every plan — the core loop above needs nothing extra. Keeping *more* than one — named
snapshots you can reopen, publish to roll back to, or schedule — requires **Pro or
above**, and scheduling a version requires **Business or above**. On Free and Starter the
editor answers *"Versioning requires a Pro plan — see Billing to upgrade"* instead of
opening the name dialog. See
[Versions & scheduled publishing](../building-sites/screens-and-layouts/versions-and-publishing.md).
:::

:::tip The Live button
The **Live** button is environment-aware — in production it reflects your published
saves so you can jump straight to the real page.
:::

## How fast changes go live

- **Publishing a screen** refreshes its live page immediately — the very next visitor
  gets the new version, usually within seconds.
- **Publishing a layout or a reusable component** refreshes every page that uses it
  the same way. When that fan-out is very large, the publish confirms that the
  remaining pages *"update on their own within an hour"* — and they do.
- **Site settings go live when you save them.** Your theme, logo, favicon, app icon,
  social image, SEO and structured data, business details, languages, consent banner,
  announcement bar, popup and store settings have no publish step — saving one
  refreshes every page of the live site immediately, the same way a publish does.
  Installing, updating or resetting a marketplace theme does too, and so does saving a
  product, a review's moderation, a site variable or function, an overlay or an A/B
  test. If you close the tab straight after saving, the refresh still happens within
  a few minutes.
- **Collections refresh their own pages.** Changing a collection's template screens,
  its address or its categories refreshes its listing and every published entry page
  — including the old addresses after a rename.
- **A deleted site stops serving at once.** Its cached pages are dropped when you
  delete it, rather than lingering for up to an hour.
- **Saving is not publishing.** A save writes your working version; the live site
  serves the published one. The one subtle case: if you edit the version that is
  *currently live* and press Save, the live site catches up on its own within about a
  minute — and because pages regenerate behind the scenes, you may need to refresh
  twice to see it.
- Your site's `sitemap.xml`, `robots.txt`, and RSS feeds refresh within about five
  minutes (a publish refreshes the sitemap immediately).

## Next

Explore the feature areas in the sidebar, or see **[What's New](../whats-new.md)** for
the latest capabilities.
