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
2. **Assign it.** Go to **Setup** and scroll to the **Error pages** card. Each status has
   its own picker — **404 · Not found**, **401 · Members only**, **403 · Forbidden**,
   **503 · Maintenance** — listing every screen on the site. Choose your screen in the
   matching picker.

Step 2 is the one that's easy to miss: designing a screen does **not** make it an error
page on its own. Until it's picked in the **Error pages** card, the status still renders
Aglyn's **Built-in default**, which is what every picker is set to until you change it.

Assigned error screens are automatically kept out of search results, so a 404 page can't
itself turn up in a search.

## Error screens are free

An assigned error screen **doesn't count against your plan's screen allowance**. Nothing
about it is a page of your site: it renders on addresses that matched nothing, so it has
no URL of its own — the same reason a collection's entry template doesn't count. See
[what counts against your screen allowance](../screens-and-layouts/overview.md#what-counts-against-your-screen-allowance).

There's one thing to know, and it's the reason you don't need to publish the screen at
all:

:::tip Don't give it an address
An error screen that is *also* published at its own address — a 404 screen you published
at `/404` so you could preview it, say — **is** a page, so it counts like any other page
until you remove that address.

If you've already published one, the **Error pages** card says so and offers **Remove
address**. Removing it frees the allowance slot and the screen carries on rendering for
its status code, which is the only place it was ever meant to appear.
:::

## Tips

- Put a search box or navigation on your 404 so visitors can recover.
- Keep the 503 lightweight — it shows when the site is under maintenance.

## Related

- [Maintenance mode](maintenance-mode.md)
- [Password-protect a screen](password-a-screen.md)
