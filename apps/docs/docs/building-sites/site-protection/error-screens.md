---
sidebar_position: 3
title: Design custom error screens
description: Replace generic 404/401/403/503 pages with branded screens you design.
---

# Design custom error screens

When something goes wrong, visitors should still see *your* site. Design custom **error
screens** for each status.

![The Error pages card in Setup: one picker per status code, each defaulting to Aglyn's built-in screen until you assign your own](/img/site-protection/setup-error-pages.png)

## The error screens

| Status | Picker label | When it shows |
| --- | --- | --- |
| **404** | 404 · Not found | The URL doesn't match any screen. |
| **401** | 401 · Members only | A members-only screen, requested by a signed-out visitor. |
| **403** | 403 · Forbidden | Reserved for future access rules — nothing serves it yet. |
| **503** | 503 · Maintenance | Shown on every page while [maintenance mode](maintenance-mode.md) is on. |

## Design one

1. **Create a screen** for the status, in **Screens**, and design it in the
   [Besigner](../besigner/overview.md) like any other screen — add your header/layout, a
   helpful message, and a link home.
2. **Publish** it.
3. **Assign it.** Go to **Setup** and scroll to the **Error pages** card. Each status has
   its own picker — **404 · Not found**, **401 · Members only**, **403 · Forbidden**,
   **503 · Maintenance** — listing every screen on the site. Choose your screen in the
   matching picker.

Step 3 is the one that's easy to miss: designing and publishing a screen does **not** make
it an error page on its own. Until it's picked in the **Error pages** card, the status
still renders Aglyn's **Built-in default**, which is what every picker is set to until you
change it.

Assigned error screens are automatically kept out of search results, so a 404 page can't
itself turn up in a search.

## Tips

- Put a search box or navigation on your 404 so visitors can recover.
- Keep the 503 lightweight — it shows when the site is under maintenance.

## Related

- [Maintenance mode](maintenance-mode.md)
- [Password-protect a screen](password-a-screen.md)
