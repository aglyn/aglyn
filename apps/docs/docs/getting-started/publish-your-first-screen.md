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
   registers it in the site's routing map.
3. Optionally pick a **parent** screen — children inherit a nested URL path
   (`/services/pricing`).

## 2. Design it in the Besigner

1. Open the screen to launch the **[Besigner](../building-sites/besigner/overview.md)**.
2. Drag components from the drawer onto the canvas. Rearrange them in the **hierarchy**
   panel or directly on the canvas.
3. Double-click text to edit it inline. Set component attributes in the inspector.
4. Bind a shared **[layout](../building-sites/screens-and-layouts/overview.md#layouts)** if you want a
   common header/footer.

## 3. Preview and publish

1. Use the artboard **light/dark toggle** to check both color schemes.
2. Save a **version** — you can name it and even schedule it to go live later.
3. **Publish**. The screen's slug is registered in the routing map and the page goes live
   on your site's domain.

:::tip The Live button
The **Live** button is environment-aware — in production it reflects your published
saves so you can jump straight to the real page.
:::

## How fast changes go live

- **Publishing a screen** refreshes its live page immediately — the very next visitor
  gets the new version, usually within seconds.
- **Publishing a layout or a reusable component** refreshes every page that uses it
  the same way. When that fan-out is very large, the publish confirms that the
  remaining pages *"update on their own within a minute"* — and they do.
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
