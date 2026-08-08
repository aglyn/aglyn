---
sidebar_position: 12
title: Edit from the live site
description: The admin bar on published sites — jump from any live page straight into the besigner for the screen serving it.
---

# Edit from the live site

Browsing your published site and spot something to fix? The **admin bar** connects
your console edit access to the live site, so any page you're looking at is one click
from its screen in the besigner.

:::caution Rolling out
The admin bar is a **release-flagged feature, currently being rolled out** — it may
not be available on your site yet. Nothing needs configuring; it switches on
per-workspace as the rollout proceeds.
:::

## Call it up

On any page of your published site, either:

- add **`?aglyn-edit`** to the URL — handy as a shareable habit, or
- press **Cmd/Ctrl + Shift + E**.

<!-- screenshot: tenant/admin-bar-pill.png per SCREENSHOT_PLAN.md -->

A small **Edit this site** pill appears in the bottom-right corner. Visitors never see
it — the pill only appears when you ask for it, and the bar itself only renders for
accounts that actually hold edit access.

## Connect your access

Click the pill. Because your published site and the console live on different domains,
a small **console popup** opens to confirm it's really you: it checks your console
sign-in and your role on this site, then reports **"Connected — edit access confirmed"**
and closes itself. If you're not signed in to the console, it says so and waits for
you to sign in and try the shortcut again; an account without edit rights gets a plain
"No edit access".

Edit access means what it does everywhere else: a site **admin or editor**, or a
workspace **owner, admin, or editor**. Viewers don't get a read-only bar — they simply
don't get one.

## The bar

Once connected, a slim dark bar sits along the bottom of the page:

<!-- screenshot: tenant/admin-bar-connected.png per SCREENSHOT_PLAN.md -->

- the **site name**, and the name of the screen serving the current page;
- **Edit this page** — opens the besigner for exactly that screen, in a new tab
  (shown whenever the page maps to a routed screen);
- **Open console** — the site's dashboard;
- **×** hides the bar for the rest of the page view.

The bar follows you as you browse — navigate to another page and it re-resolves which
screen you're on.

## Good to know

- The connection lasts for the **browser tab** (and tokens expire after 30 minutes on
  their own) — closing the tab forgets it, and the site sets **no new cookies**.
- The bar is a convenience surface only: it never changes what the page serves, and
  all real editing still happens in the console with your normal permissions.

## Related

- [The Besigner](overview.md)
- [Publish your first screen](../../getting-started/publish-your-first-screen.md)
- [Teams, roles & membership](../../workspace-and-billing/teams-and-roles/overview.md)
