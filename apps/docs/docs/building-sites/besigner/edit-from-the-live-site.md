---
sidebar_position: 13
title: Edit from the live site
description: The admin bar on your published site — who sees it, how it appears on your Aglyn subdomain and on your own domain, what it links to, and how to hide it.
---

# Edit from the live site

Browsing your published site and spot something to fix? If you can edit the site, the
**admin bar** runs across the top of the live page. It names the screen serving that
page and opens it in the besigner in one click.

:::info Plan availability
**Every plan**, Free included. The count of today's views of the page you're on is
**Pro+**, like [per-screen traffic](../../marketing-and-automation/analytics/overview.md#per-screen-traffic).
:::

## Who sees it

The bar only appears for someone whose
[role on the site](../../workspace-and-billing/teams-and-roles/overview.md#site-roles) can
edit content: **Admin**, **Editor** or **Author**. Workspace owners and admins are admins
on every site. A **Viewer** doesn't get a read-only bar; they get no bar at all.

Nobody else gets the bar. A visitor who isn't signed in, or who is signed in without
edit access to this site, gets the page exactly as it is.

## On your aglyn.app address

On your site's `aglyn.app` address, the bar **appears by itself**. Open any page of the
site in the browser you use the console in, and the bar is there with nothing to click.

The console makes that possible by leaving a hint for `aglyn.app` sites in your browser.
While you're signed in, it refreshes the hint at most once a day as the console loads, so
you may notice a quick redirect through `console.aglyn.app`. The hint lasts a week. It
isn't a sign-in: each time the bar connects, the site's server checks that your account
still exists and can still edit this site.

## On your own domain

A custom domain like `www.example.com` can't see that hint, so there the bar waits until
you ask for it. On any page of the site, either:

- add **`?aglyn-edit`** to the address, as in `https://www.example.com/about?aglyn-edit`,
  or
- press **Cmd/Ctrl + Shift + E**.

**Visit** on the console's Sites list opens your site with `?aglyn-edit` already added.

<!-- screenshot: tenant/admin-bar-pill.png per SCREENSHOT_PLAN.md -->

An **Edit this site** button appears in the bottom-right corner. Click it and a small
console window opens. It checks your console sign-in and your role on this site, then
connects the site; the window closes and the bar appears. If you aren't signed in to the
console, the window says so and links to sign in. Sign in, then click the button on your
site again. An account that can't edit the site sees **No edit access** instead.

The connection lasts **30 minutes** and is kept in your browser for that site, so other
pages and tabs of the site show the bar without asking again. When it runs out, connect
the same way again.

`?aglyn-edit` and the shortcut work on the `aglyn.app` address too. There they bring the
bar straight up, with no button, whenever the hint is in your browser. **Visit site** on a
site's dashboard opens that address with `?aglyn-edit` added.

## The bar

<!-- screenshot: tenant/admin-bar-connected.png per SCREENSHOT_PLAN.md -->

From left to right:

- the site's **name**, beside the Aglyn mark and the site's favicon, if it has one. It
  opens the site's dashboard in the console.
- the **screen** serving the page. A blog post or another collection page shows the
  collection and the template screen that renders it, such as *Blog entry · Post*. A page
  no screen serves shows *Unrouted page*.
- **Draft changes**, when the screen has a version newer than the one that's live.
- **Edit this page**, which opens the besigner on that screen, at the version the page is
  serving. On a blog post or another collection entry it reads **Edit template**, because
  that screen is the design every entry shares, and **Edit this entry** beside it opens
  the entry itself — its text, cover and author — in the console's content editor.
- today's page views across the site, and on **Pro+** how many of them were of this page,
  as in *120 views today · 18 on this page*. Days are counted in UTC. It opens the site's
  analytics.
- **Screens**, plus **Inbox** and **Orders** where the inbox and commerce plugins are
  enabled on the site.
- your email, which opens a menu with **Account settings**, **Site dashboard** and
  **Disconnect**.
- **×**.

Every link opens the console in a new tab, where your usual permissions apply. As you
browse, the bar follows: go to another page and it names that page's screen.

The bar sits above the page rather than over it. The page moves down by the bar's height,
and so does a site header pinned to the top of the window. On a phone, the bar keeps the
site name, the edit links and **×**, and a **⋯** menu holds the links, your email and
**Disconnect**.

## Hide it

- **×** hides the bar until the next full page load.
- **Disconnect** forgets the connection for this site in this browser, and the bar stops
  appearing by itself there. `?aglyn-edit` or the shortcut brings it back.

## What it never does

- **Appear on its own for anyone who can't edit.** A visitor sees nothing unless they add
  `?aglyn-edit` or press the shortcut themselves. Even then, all they get is the **Edit
  this site** button, and the console window answers it with *Sign in first* or *No edit
  access*.
- **Change your site.** The bar reads which screen serves the page and today's counts,
  and links to the console. Every edit still happens in the console, with your normal
  permissions, and what visitors see is untouched.
- **Give the site your console sign-in.** The site gets a pass that works only on that
  site and expires in 30 minutes, plus your email to show in the bar.
- **Set cookies on your own domain.** The hint lives on `aglyn.app`, and only in the
  browsers of people who use the console.

## Good to know

- **Signing out of the console doesn't remove the hint.** It lapses within a week, and
  the site's server re-checks your access every time the bar connects. On a shared
  computer, use **Disconnect** on each site you opened, or clear the browser's cookies and
  site data for `aglyn.app`.
- **Taking away someone's edit access** stops new connections straight away. A connection
  their browser already holds keeps showing the bar until its 30 minutes run out, and every
  link in it leads to the console, which refuses them.

## Related

- [The Besigner](overview.md)
- [Versions & scheduled publishing](../screens-and-layouts/versions-and-publishing.md)
- [Publish your first screen](../../getting-started/publish-your-first-screen.md)
- [Teams, roles & membership](../../workspace-and-billing/teams-and-roles/overview.md)
