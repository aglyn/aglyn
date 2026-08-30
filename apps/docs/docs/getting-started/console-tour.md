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
  [version](../building-sites/screens-and-layouts/versions-and-publishing.md) to view.
- **Notifications** — the bell shows an unread badge and drops down your 10 most recent
  notifications (form submissions, bookings, invoices, team changes), split across an
  **Inbox** tab (unread) and an **Archive** tab (already read). **Mark all read** clears
  the inbox, the gear opens your notification preferences, and **View all** opens the
  full paginated feed.
- **Account menu** — your avatar opens it. The header shows your name and email with a
  gear to [Manage Account](../workspace-and-billing/manage-account.md), and the first row
  below repeats that destination as a labeled **Manage account** — a gear is not
  discoverable as a name. Then come **Manage Team**, **Billing** and **Support**, which
  appear only on a page that names a workspace and only for members whose role can reach
  those pages; **Staff console** (Aglyn staff only); a **Documentation** link that opens
  this docs site in a new tab; and **Report an issue**, directly under Documentation
  because "the docs didn't answer it" is the step before reporting it. **Report an
  issue** opens a form *over* the page you're on rather than navigating away — the page
  you were looking at is the most useful thing the report carries — and unlike the rows
  above it, it needs no particular role, no resolved workspace, and no paid plan: every
  signed-in member has it on every page. See
  [Report an issue](../workspace-and-billing/report-an-issue.md). Below that the menu
  holds the **theme toggle** (light / system / dark), an **Upgrade plan** button — shown
  only when your workspace has a higher plan to move to, and only to members who can open
  Billing — **Sign out**, and a footer naming your current workspace and plan.

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
| **Setup** | Basic details, SEO, tracking, theme, and emails. Each tab is deep-linkable — the `?tab=` in the URL follows you, so you can bookmark or share the exact one. |

Alongside them, and always present: **Layouts** and **Components** (the shared frames and
reusable pieces screens are assembled from — see
[Screens & Layouts](../building-sites/screens-and-layouts/overview.md)), **Templates**
(saved starting points), **Content** (collections and blog entries), **Users** (the people
who sign in to the site you're building, not your own team), and **Analytics**. **Admin**
appears only if you're an owner or admin of the site; it holds per-site plugin settings,
the custom domain, the site's security lists, the full activity log, and the danger zone.

:::note Sections that come and go
Tabs such as **Data**, **Products**, **Logic**, **Workflows**, **Inbox**, **Bookings**,
**Events**, **Redirects**, **Marketing** and **Marketplace** are contributed by plugins
and appear only where that plugin is enabled for your workspace (they're inserted after
**Analytics**). If a section these docs describe isn't in your tab strip, that's usually
why — enable the plugin under **Organization → Plugins**.

**Contacts** is the exception: it's a release-flagged feature still
[rolling out](../content-and-data/contacts/overview.md), so there is no switch for it
under **Organization → Plugins** and looking for one is a dead end. It appears on its
own once the rollout reaches your workspace.
:::

**Billing is not a site section.** Plan cards and usage meters are workspace-wide and live
in your account menu under **Billing** — one bill covers every site in the workspace.

## Editing vs. managing

You can manage a screen (rename, schedule, view raw JSON) from its **detail page**
without opening the editor. When you want to design it, open the
**[Besigner](../building-sites/besigner/overview.md)**.

## The Sites list {#the-sites-list}

**All Sites** is the front door of a workspace: one card per site, for the workspace
currently selected in the switcher. A site you can reach in another organization isn't
missing — it's behind the workspace switcher.

Each card carries:

- The site's **display name** as the title, with its **hostname** underneath as the
  subheader — the custom domain when the site has one, otherwise its `name.aglyn.app`
  address. Both are also listed inside the card, as **Aglyn Domain** and **Custom
  Domain**.
- A **status pill** (below).
- **Visit**, which opens the live site in a new tab, and **Manage**, which opens that
  site's dashboard in the console.

### The status pill {#the-status-pill}

| Pill | Hover tells you |
| --- | --- |
| **Live** (green) | How many pages are published — "12 published pages." |
| **Draft** (grey outline) | "Nothing published yet — visitors see the placeholder." |
| **Maintenance** (amber) | "Every path serves the maintenance screen." |
| **Suspended** (red) | "This site is serving a lockdown notice instead of content." |

**Live** means exactly one thing: the site has at least one published page. Publishing
writes the routing map the site is served from, and the pill is read off that map — so
it costs no extra lookup on a list of a hundred sites, and it is not a health check. A
site with a misconfigured domain still reads **Live** if it has published pages.

### How the pill is decided {#how-the-pill-is-decided}

Reference detail, and the reason the pill is worth reading rather than glancing at: a
site can be in several of these states at once, and the pill reports the first that
applies, in this order.

1. **Suspended** — the site record carries a suspension that hasn't ended.
2. **Maintenance** — maintenance mode is on.
3. **Live** — at least one published page.
4. **Draft** — everything else.

So a suspended or maintenance site is **never** shown as **Live**, however much it has
published. The order is the point: reporting either as Live would be the console
agreeing with someone who thinks their site is up while every request is being served a
lockdown or maintenance screen.

A **timed** suspension whose end has already passed is treated as over, even though the
suspension fields are still on the record, and the site falls through to whatever it
would otherwise be. The published site applies the same rule, so the two agree.

### Your site allowance {#your-site-allowance}

Opposite the **All Sites** heading, beside **Create site**, a line reads
`6 of 10 sites · Business plan` — how many sites this workspace has, against how many
its plan includes, and which plan that is. **Create site** sits next to it, and appears
only if your role can create sites.

The line stays **blank** until both the workspace and its plan have resolved, rather
than filling in a partial answer. An unresolved organization reads as Free, and a
Business customer told for a moment that they're at "1 of 1 site" has been handed a
false upgrade prompt by a page that was only loading. No line at all is the better
answer while it waits.

Raising the limit is a billing change — see
[Billing & plans](../workspace-and-billing/billing-and-plans/overview.md).

## A site's dashboard

Opening a site lands you on its dashboard. It's a place to *glance* at the site, not to
edit it — every card is a summary with a link to the section that owns the detail:

- **Traffic** — pageviews over a window you choose (14 days by default). **View details**
  opens **Analytics**.
- **Newest site users** — the five most recent people who signed up *on your site*.
  **View all** opens **Users**.
- **Recent Activity** — the ten most recent changes, each naming the thing that changed
  ("Saved the screen — Home") and linking straight to it. The full, paginated log lives
  under **Admin → Activity**.

Plugins contribute the rest, so this list is a floor rather than an exact match for your
own dashboard: **Last campaign** appears once you've sent an email campaign, and
**Commerce** where the commerce plugin is enabled and the site has products or orders.
A brand-new site shows the same cards with empty states — "No pageviews recorded yet",
"No activity yet" — which is what a first visit should look like.

Two things people expect here and won't find: **role management** lives under **Users**,
and the **announcement bar** and **promotional popup** live under **Marketing**.

**Visit site**, in the dashboard header, opens the published site in a new tab with the
[admin bar](../building-sites/besigner/edit-from-the-live-site.md) armed — the route
from a site's own dashboard to the site itself, without going back out to the Sites list
and in through a card action.

![The site dashboard: a Traffic card with its 14-day range picker, a Newest site users card, a Last campaign card counting sends, opens and clicks, and the Recent Activity feed across the bottom](/img/getting-started/console-dashboard.png)

## Next

- [Publish your first screen](publish-your-first-screen.md)

## Workspace settings & notifications

Organization-wide settings (name, workspace URL) live under
**Organization → Settings**, which also holds Profile, API keys, Branding,
Single sign-on, Ownership and Delete. Turning plugins on and off for the
workspace is its own section, **Organization → Plugins** — **Marketplace** is
for finding and installing new ones, not for administering what you already run:

![The Organization Settings page: a Navigation card listing General, Profile, Plugins, API keys, Branding, Single sign-on, Ownership and Delete, beside the General card with the organization name and workspace URL](/img/getting-started/org-settings-page.png)

Your in-app notification feed — billing, publishing, workflow failures —
lives under **Notifications**, with per-category mutes:

![The Notifications page: a Mark all read action, a row of per-category mute toggles (Billing, Team & access, Forms & bookings, Marketplace, Product & system), the three per-device Alerts switches with Send test alert beside them, and the paginated feed below](/img/getting-started/notifications-page.png)

### Alerts on this device

Below the category mutes, three switches control how a new notification
reaches you in **this browser**:

- **Unread count in tab title** — badges the browser tab, e.g. `(3) Aglyn`,
  so you can see new activity from another tab. On by default.
- **Sound** — a short chime when a notification arrives. On by default on a
  browser you haven't set it on before; a device where you already turned it off
  keeps your choice.
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
