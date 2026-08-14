---
sidebar_position: 2
title: The console tour
description: Where things live in the Aglyn console app bar and navigation.
---

# The console tour

The **console** is where you manage a site. Here's what each part of the chrome does.

![The console chrome with its main areas numbered](/img/getting-started/console-chrome-annotated.png)

1. **App bar** — the Aglyn console wordmark, notifications, and your account menu.
2. **Workspace switcher** — jump between the organizations you belong to.
3. **Site sections** — every area of the selected site (Dashboard,
   Screens, Media, Content, …).
4. **Site switcher** — switch between the sites in your workspace.
5. **Page body** — the selected section's cards and tables.

## The app bar

- **Site switcher** (left) — jump between the sites you belong to, search them by name
  with **Find site…**, or create a new one.
- **Breadcrumbs** — show the current site's display name and where you are.
- **Screen switcher** — a searchable dropdown for hopping between screens without leaving
  the editor: your recent screens by default, or type to find any screen or layout in the
  site by name. **View all screens** opens the full list.
- **Version dropdown** (right, near your avatar) — pick or schedule a
  [version](../building-sites/screens-and-layouts/overview.md#versions--scheduled-publishing) to view.
- **Notifications** — the bell shows an unread badge and drops down your 10 most recent
  notifications (form submissions, bookings, invoices, team changes), split across an
  **Inbox** tab (unread) and an **Archive** tab (already read). **Mark all read** clears
  the inbox, the gear opens your notification preferences, and **View all** opens the
  full paginated feed.
- **Account menu** — your avatar opens it. The header shows your name and email, with a
  gear to [Manage Account](../workspace-and-billing/manage-account.md); below that are
  **Manage Team**, **Billing**, **Support**, **Staff console** (Aglyn staff only), and a
  **Documentation** link that opens this docs site in a new tab. It also holds the
  **theme toggle** (light / system / dark), an **Upgrade plan** button — shown only when
  your workspace has a higher plan to move to, and only to members who can open Billing —
  **Sign out**, and a footer naming your current workspace and plan.

## In-context help

Look for the small **?** icons throughout the console — next to page titles,
card titles, form fields, table column headers, and the Besigner's style and
attribute panels. Hover one for a one- or two-line explanation, and click it
(or the **Open documentation** link in the tooltip) to jump straight to the
matching section of these docs in a new tab.

## Primary navigation

The tabs across the top of a site are its **sections**. Some are always present; the rest
are contributed by the plugins your workspace has enabled — so two sites, or the same site
before and after you enable a plugin, can show different tabs. Don't be surprised by a
tab strip that doesn't match a screenshot exactly.

These four are where a new site's work happens:

| Section | What's there |
| --- | --- |
| **Dashboard** | The site at a glance — analytics and recent-signup summaries, and the ten most recent activity entries. |
| **Screens** | The screen hierarchy — create, reorder (drag-and-drop), and open screens. This is where you build; start at [Publish your first screen](publish-your-first-screen.md). |
| **Media** | The media library — folders, images, video, and files. |
| **Setup** | Basic details, SEO, theme, custom domain, emails, and the full activity log. Each tab is deep-linkable — the `?tab=` in the URL follows you, so you can bookmark or share the exact one. |

Alongside them, and always present: **Layouts** and **Components** (the shared frames and
reusable pieces screens are assembled from — see
[Screens & Layouts](../building-sites/screens-and-layouts/overview.md)), **Templates**
(saved starting points), **Content** (collections and blog entries), **Users** (the people
who sign in to the site you're building, not your own team), and **Analytics**. **Admin**
appears only if you're an owner or admin of the site; it holds per-site plugin settings and
the danger zone.

:::note Sections that come and go
Tabs such as **Data**, **Products**, **Logic**, **Workflows**, **Inbox**, **Contacts**,
**Bookings**, **Events**, **Redirects**, **Marketing** and **Marketplace** are contributed
by plugins and appear only where that plugin is enabled for your workspace (they're
inserted after **Analytics**). If a section these docs describe isn't in your tab strip,
that's usually why — enable the plugin under **Organization → Marketplace → Installed**.
:::

**Billing is not a site section.** Plan cards and usage meters are workspace-wide and live
in your account menu under **Billing** — one bill covers every site in the workspace.

## Editing vs. managing

You can manage a screen (rename, schedule, view raw JSON) from its **detail page**
without opening the editor. When you want to design it, open the
**[Besigner](../building-sites/besigner/overview.md)**.

## A site's dashboard

Opening a site lands you on its dashboard — the primary navigation tabs across the top,
account/role management, quick controls for surfaces like the announcement bar and
promotional popup, and the ten most recent activity entries (the full, paginated log
lives under **Setup → Activity**). Each entry names the thing that changed — "Saved the
screen — Home" — and links straight to it.

![The Aglyn console site dashboard, showing the primary navigation tabs (Dashboard, Screens, Layouts, Media, Content, Inbox, Contacts, Bookings, Events, Data, Redirects, Workflows, Marketplace), the Users card with the account owner listed, and Announcement bar / Promotional popup quick-edit cards](/img/getting-started/console-dashboard.png)

## Next

- [Publish your first screen](publish-your-first-screen.md)

## Workspace settings & notifications

Organization-wide settings (name, workspace URL) live under
**Organization → Settings**. Enabling plugins, configuring them, and managing
marketplace installs live under **Organization → Marketplace → Installed**:

![Organization settings](/img/getting-started/org-settings-page.png)

Your in-app notification feed — billing, publishing, workflow failures —
lives under **Notifications**, with per-category mutes:

![The notifications feed](/img/getting-started/notifications-page.png)

### Alerts on this device

Below the category mutes, three switches control how a new notification
reaches you in **this browser**:

- **Unread count in tab title** — badges the browser tab, e.g. `(3) Aglyn`,
  so you can see new activity from another tab. On by default.
- **Sound** — a short chime when a notification arrives. Off by default.
- **Desktop notifications** — a system notification, shown only while the
  Aglyn tab is in the background (in the foreground, the bell and chime
  already tell you). Off by default; switching it on asks your browser for
  permission. If you previously blocked notifications for the site, re-allow
  them in your browser settings first.

These are per-device, not per-account: notification permission is granted
per browser, so muting sound on your laptop leaves your other devices alone.
The **category mutes** above are account-wide and apply everywhere.

**Send test alert** plays the chime and, if you've allowed them, fires a desktop
notification — so you can confirm your setup works instead of discovering weeks
later that you never heard a thing. The chime always plays, even with **Sound**
switched off, so you can hear it before deciding.

Aglyn asks you in-app before triggering your browser's own permission prompt.
That's deliberate: **browsers allow exactly one permission request per site**.
Dismiss the browser's prompt and the answer is remembered as a permanent *no* —
Aglyn can't ask again, and only you can undo it from your browser's site
settings. The in-app card gives you a "Not now" that costs nothing, so the real
prompt is only raised once you've said yes. To clear a previous block, open your
browser's site settings for Aglyn (the icon at the left of the address bar in
Chrome and Edge; **Settings → Websites → Notifications** in Safari) and set
notifications back to *Allow*.
