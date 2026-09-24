---
sidebar_position: 2
title: The console tour
description: Where things live in the Aglyn console app bar and navigation.
---

# The console tour

The **console** is where you manage a site. Here's what each part of the chrome does.

![The console chrome with its main areas numbered](/img/getting-started/console-chrome-annotated.png)

1. **App bar** — the Aglyn console wordmark, search, notifications, and your account menu.
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

## Filter and search a list {#filter-and-search}

Most lists in the console are tables with the same toolbar above them:
**Columns** shows and hides columns, **Filters** narrows the rows, **Export**
downloads the table, and **Search** finds rows by their words. They work the
same way on every list.

- **Filters** opens a panel that edits one filter at a time: pick a column, an
  operator and a value. Pick another column and set it too, and both apply —
  filters on different columns add up, and each column holds one filter.
  Clearing the value, or deleting the panel's row, drops that column's filter.
- **Chips** above the table show every filter in force, each read as a sentence
  such as "Status is Live". The panel shows one filter at a time; the chips show
  them all. Remove a chip to drop its filter.
- **Search** matches words. Type several and a row is kept when every word
  appears, in any order and either case, in one of the things that list
  searches — each list's page names them. Search adds to the filters, and an
  empty box shows the list unfiltered again.
- The **pager** at the foot of the table then turns through the matches, not
  the whole list.

How far a filter or a search reaches depends on how the list reads its rows,
and each list's page says which:

- **The whole list.** A list that reads every row at once, or whose query
  applies the filter itself, answers across all of it — not only the page on
  screen.
- **The rows read.** A long list reads a window of its rows instead: its
  newest rows up to a cap its page names, or, on a list that reads a page at a
  time, 100 rows as soon as the first filter or search word is set, and one
  page more each time you turn past the last match. A filter there looks
  through what has been read, and the table says when there is more.
- **One served filter.** Some lists hand one filter to the server, which looks
  through every record, and apply the rest to the rows it returned. The served
  filter's chip is filled in; hover a chip to see which kind it is. On such a
  list a new served filter replaces the previous one.

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
Tabs such as **Data**, **Products**, **Logic**, **Automation**, **Inbox**, **Bookings**,
**Events**, **Redirects**, **Marketing** and **Marketplace** are contributed by plugins
and appear only where that plugin is enabled for your workspace (they're inserted after
**Analytics**). If a section these docs describe isn't in your tab strip, that's usually
why — enable the plugin under **Organization → Plugins**.
:::

**Billing is not a site section.** Plan cards and usage meters are workspace-wide and live
in your account menu under **Billing** — one bill covers every site in the workspace.

## Editing vs. managing

You can manage a screen (rename, schedule, view raw JSON) from its **detail page**
without opening the editor. When you want to design it, open the
**[Besigner](../building-sites/besigner/overview.md)**.

## The Sites list {#the-sites-list}

**All Sites** is the front door of a workspace: a table with one row per site, for the
workspace currently selected in the switcher. A site you can reach in another organization
isn't missing — it's behind the workspace switcher.

Each row carries:

- The site's **display name**, with its **hostname** underneath — the custom domain when
  the site has one, otherwise its `name.aglyn.app` address. Both are also columns of their
  own, **Aglyn domain** and **Custom domain**.
- A **status pill** (below).
- When the site was **created** and last **updated**.
- **Visit**, which opens the live site in a new tab, and **Manage**, which opens that
  site's dashboard in the console.

**Filters** in the table's toolbar narrows the list by name, **Status** (Live, Draft,
Maintenance or Suspended), either domain, **Custom domain status** (Connected, Pending
while a connect or disconnect is unfinished, or None), or the date a site was created or
last updated. **Search** matches any word of the name, the slug, or either domain. Each
filter in force shows as a chip above the table; remove a chip to drop it. The list holds
every site you have in the workspace, so a filter or a search looks through all of them,
not only the page on screen. The site count beside the heading always counts every site.
See [Filter and search a list](#filter-and-search).

### The status pill {#the-status-pill}

| Pill | Hover tells you |
| --- | --- |
| **Live** (green) | How many pages are published — "12 published pages." |
| **Draft** (gray outline) | "Nothing published yet — visitors see the placeholder." |
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
  ("Saved the screen — Home") and linking straight to it. A change an integration made
  through the REST API is attributed to its key by name — *API key Zapier* — rather than
  to a person. The full, paginated log lives under **Admin → Activity**.

Plugins contribute the rest, so this list is a floor rather than an exact match for your
own dashboard: **Last campaign** appears once you've sent an email campaign,
**Commerce** where the commerce plugin is enabled and the site has products or orders,
**Tasks due** and **CRM at a glance** where the CRM is on, and **Inbox** with the site's
unread form submissions.
A brand-new site shows the same cards with empty states — "No pageviews recorded yet",
"No activity yet" — which is what a first visit should look like.

Two things people expect here and won't find: **role management** lives under **Users**,
and the **announcement bar** and **promotional popup** live under **Marketing**.

**Visit site**, in the dashboard header, opens the published site in a new tab with the
[admin bar](../building-sites/besigner/edit-from-the-live-site.md) armed — the route
from a site's own dashboard to the site itself, without going back out to the Sites list
and in through a card action.

![The site dashboard: the Traffic card with its 14-day range picker, top pages, referrers and campaigns, then the Commerce, Newest site users, Tasks due, CRM at a glance, Inbox and Last campaign cards, and the Recent Activity feed across the bottom](/img/getting-started/console-dashboard.png)

## Next

- [Publish your first screen](publish-your-first-screen.md)

## Workspace settings & notifications

Organization-wide settings (name, workspace URL) live under
**Organization → Settings**, which also holds Profile, API keys, Branding,
Single sign-on, Privacy, Ownership and Delete. Turning plugins on and off for the
workspace is its own section, **Organization → Plugins** — **Marketplace** is
for finding and installing new ones, not for administering what you already run:

![The Organization Settings page: a Navigation card listing General, Profile, Plugins, API keys, Branding, Single sign-on, Privacy, Ownership and Delete, beside the General card with the organization name and workspace URL](/img/getting-started/org-settings-page.png)

### The notifications feed

Your in-app notification feed — billing, publishing, workflow failures —
lives under **Notifications**, which has two sections in the rail on the left:
**All notifications** and **Settings**. The first shows what arrived, newest
first, with **Mark all read** above it. The feed's **Filters** narrows it by
**Type** (one type, or several) and by **Status** (**New** or **Read**), and
both can stand together. Each filter in force shows as a chip above the feed;
remove the chip to drop it. The filters apply to the whole feed, not just the
page on screen, and the pager then turns through the matches; see
[Filter and search a list](#filter-and-search). There is no search box, because a
notification's words are not indexed:

![The Notifications page: a Navigation rail listing All notifications and Settings, beside Mark all read and the feed as a table of notification, type, workspace, time and status, under the table's Columns, Filters and Export controls](/img/getting-started/notifications-page.png)

### Notification settings

Everything about *what* reaches you lives on the second section,
**Settings**.

**What you are told about** is a table: one row per category, one column for
**In console** and one for **Email**. Each row says what arrives in that
category, so you are never switching off a bucket you would have to guess the
contents of.

- **In console** is on for every category. Switching it off stops that
  category appearing in the feed and in the bell.
- **Email** is **off for every category**. Switch one on and you also get a
  message in your inbox when one of those notifications arrives. This does not
  touch the mail Aglyn already sends you — invites, verification, receipts,
  password resets and dunning are separate, and are not affected by anything on
  this page.

Rows marked **Staff only** are Aglyn's own — they are shown to staff and reach
nobody else. They are about the platform rather than any one workspace, which
is why they appear here and not under **One workspace or one site**.

#### One kind at a time

Open a category with the arrow beside its name and it lists the individual
notifications inside it, each with its own **In console** and **Email**
switches. A switch here shows what would actually happen: its own answer if you
have given one, otherwise its category's.

Set one and the row is marked **Set**, with **Follow category** beside it to
put it back. This is how you stop hearing about one thing without silencing its
neighbors — turning **Payment failed** off leaves the rest of **Billing**
alone.

A digest's **Email** switch is grayed out here, because a digest composes and
sends its own mail under its own switch in **Digests** below.

These are answers for your whole account. A narrower scope still wins: a
workspace or site answer overrides what you said about the kind of
notification here.

### Workspace and site overrides

**One workspace or one site** sets the same answers for a single workspace or a
single site, rather than for your whole account. Each cell starts at
**Inherit**, which means it follows the level above it: a site follows its
workspace, a workspace follows your account. Set one to **On** or **Off** and
only that scope changes. This is how you take form submissions by email from
one busy site without taking them from the other five.

Categories open here too, so a scope can answer for a single notification
rather than a whole category — the finest grain, in the place the noise
usually is. A type set to **Inherit** follows its own category at that scope;
a category set to **Inherit** follows the scope above it.

Staff rows do not appear here. They are about the platform, not about any one
workspace, so there is nothing for a workspace answer to change.

### Daily digests

**Daily CRM digest** is on by default. Each morning it sends you one
notification and one email listing your overdue and due-today tasks and the
leads nobody has worked, across every workspace you belong to. Switch it off to
stop both. Switching the **Forms & bookings** console channel off silences the
digest's console notification but not its email. What it counts, and when, is in
[Tasks & follow-ups](../content-and-data/crm/tasks.md#the-daily-digest).

**Weekly insights** appear beside it once you have turned them on for a workspace from
**Ask about your numbers**, with one switch per workspace. They are off unless you turn
them on. See [Insights](../marketing-and-automation/analytics/insights.md#weekly-insights).

**Task reminders** — the notification and email a CRM task sends at its own due time —
are **Forms & bookings** notifications, beside **Task assigned to you**. Open that
category to switch **Task reminder** on or off by itself, or switch the whole category
off to stop both the notification and the email for everything in it; a single task is
silenced by clearing its **Remind me** field. See
[Reminders](../content-and-data/crm/tasks.md#reminders).

### Alerts on this device

At the foot of the **Settings** section, three switches control how a new
notification reaches you in **this browser**:

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
Everything above them is account-wide and applies everywhere you sign in.

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
