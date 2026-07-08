---
sidebar_position: 3
title: Publish your first screen
description: Create a screen, design it in the Besigner, and publish it live.
---

# Publish your first screen

This walks through the core loop: **create → design → publish**.

## 1. Create a screen

1. Go to **Screens** and choose **New screen**.
2. Set a **title** and a URL **slug** (e.g. `about`). Aglyn normalizes the slug and
   registers it in the host's routing map.
3. Optionally pick a **parent** screen — children inherit a nested URL path
   (`/services/pricing`).

## 2. Design it in the Besigner

1. Open the screen to launch the **[Besigner](../besigner/overview.md)**.
2. Drag components from the drawer onto the canvas. Rearrange them in the **hierarchy**
   panel or directly on the canvas.
3. Double-click text to edit it inline. Set component attributes in the inspector.
4. Bind a shared **[layout](../screens-and-layouts/overview.md#layouts)** if you want a
   common header/footer.

## 3. Preview and publish

1. Use the artboard **light/dark toggle** to check both color schemes.
2. Save a **version** — you can name it and even schedule it to go live later.
3. **Publish**. The screen's slug is registered in the routing map and the page goes live
   on your host's domain.

:::tip The Live button
The **Live** button is environment-aware — in production it reflects your published
saves so you can jump straight to the real page.
:::

## Next

Explore the feature areas in the sidebar, or see **[What's New](../whats-new.md)** for
the latest capabilities.
