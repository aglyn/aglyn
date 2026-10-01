---
sidebar_position: 4
title: Maintenance mode
description: Temporarily take your site offline behind a designed 503 page.
---

# Maintenance mode

Need to pause your live site while you make changes? **Maintenance mode** serves your
designed **503** page to visitors until you switch it back.

![The Error pages card, with the four error-page pickers and the "Maintenance mode — show the 503 page at every address" switch beneath them](/img/site-protection/setup-error-pages.png)

## Turn it on

1. Open **Admin → Error pages** for the site — the same card that assigns your
   [error pages](error-screens.md). The switch takes every page of the site offline for
   every visitor, so the Admin area is limited to **site admins**.
2. Switch on **Maintenance mode — show the 503 page at every address**. It confirms with
   *"Maintenance mode on — visitors see the 503 page"*.
3. Visitors now see your [503 error page](error-screens.md) on every path.
4. When you're done, switch it back off and the site returns.

If you haven't assigned a **503 · Maintenance** page, maintenance mode still works — but
visitors get Aglyn's plain built-in notice ("This site is undergoing maintenance. Please
check back shortly.") rather than anything on-brand. Design and assign the 503 first.

## Tips

- Design the 503 page first (see [custom error pages](error-screens.md)) so maintenance
  mode shows something on-brand.
- Tell visitors when you'll be back — a simple line on the 503 goes a long way.

## Related

- [Design custom error pages](error-screens.md)
