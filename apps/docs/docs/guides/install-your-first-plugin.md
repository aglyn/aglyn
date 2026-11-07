---
sidebar_position: 9
title: Install your first marketplace item
description: A click-by-click walkthrough of the Marketplace — find something, choose which sites get it, install it, and turn it off again.
---

# Install your first marketplace item

The **Marketplace** is where you add capability to Aglyn that you didn't build
yourself: plugins, ready-made site templates, themes, layouts, components, dataset
schemas and email templates. This guide walks the whole loop once — find, install,
use, upgrade, remove — clicking every step.

No code, and nothing you can't undo. The only decision worth slowing down for is
**which sites it lands on**, and step 4 is entirely about that.

:::info Plan availability
**Free** to browse and install. Individual listings may cost money — the button says
so before you buy. *Publishing* your own listing is a separate thing and needs Pro;
see [Publish a plugin](../developers/plugins/publish-a-plugin.md).
:::

## Before you start

You need an organization with at least one site, and a role that can install. By
default that's **owner**, **admin** *and* **editor** — installing is treated as
content work, not an account setting. **Viewers** cannot, and a custom role can only
if it carries the **Install plugins** permission.

If the Marketplace opens but the Install button doesn't, that's the role, not the
plan — see [Teams & roles](../workspace-and-billing/teams-and-roles/overview.md).

## Step 1 — Open the Marketplace {#step-1-open}

In the **organization** navigation (the top-level one, not a site's), choose
**Marketplace**.

It's at the organization level on purpose. What you install is available to every site
you choose, so it isn't a per-site setting, and you don't repeat the work for each
site you run — the thing agencies and multi-site teams notice first.

<!-- screenshot: marketplace/org-nav-marketplace-and-plugins.png per SCREENSHOT_PLAN.md -->

Its own navigation panel lists:

- **Browse All** — the catalog.
- **Installed** — what you already have, with upgrade and uninstall.
- and, once you publish, the seller sections: **Upload / Publish**, **Publisher
  Profile**, **Listings**, **Payouts**, **Sales**.

:::tip Marketplace is the shop; Plugins is the switch
There is a separate **Plugins** section in the same organization navigation. That is
where things get turned **on and off** — including Aglyn's own built-in plugins.
Marketplace installs, Plugins toggles. If you are looking for a switch and can't find
one, you're in the wrong section. [More on the split](../developers/plugins/overview.md).
:::

## Step 2 — Find something {#step-2-browse}

**Browse All** is a grid of listing cards you can search, filter and sort. Cards are a
catalog only — clicking one takes you to its **detail page**, which is the only
place an install can happen. You cannot install by accident from the grid.

The controls answer over the whole marketplace, not the cards already on screen:

- **Search components** finds a listing by a word of its name. It matches one word at
  a time, from the start of the word (`count` finds *Promo Countdown*).
- **The category chips** show one category's listings; click the chip again to clear it.
- **The sort menu** orders by **Newest**, **Most installed** or **Highest rated**
  (listings nobody has rated come last).

The grid pages at the bottom. Your own organization's listings still waiting on
review appear here too, so you can watch a submission move through review.

Two things on a card are worth reading before you click into one:

- **The price chip.** Every card has one. A paid listing shows `$29`; a free one shows
  the word **Free**, rather than leaving the corner empty for you to interpret.
- **The stars, and the number beside them.** `4.8 (12)` is twelve people's opinion;
  `5.0 (1)` is one person's. A listing nobody has rated says **Not yet rated** instead
  of showing no stars.

<!-- screenshot: marketplace/listing-detail-header.png per SCREENSHOT_PLAN.md -->

On the detail page, read three things before anything else:

1. **The What's included box.** Aglyn writes it from the listing itself, not the
   publisher, so it is the one description that cannot oversell. Its first row names
   what the install produces — a sandboxed *plugin*, an editable *component*,
   *pages* you rework in Besigner, a *theme*, or **a new empty dataset with its
   fields already defined** for a dataset schema, which is the reminder that **records
   never travel**: you get the shape, not somebody's data. The rows after it cover
   where it lands (step 4), review, license and updates. See
   [What's included](../developers/plugins/overview.md#whats-included) for every row it
   can produce.
2. **The badges.** They make two different claims, and it's worth knowing which is
   which — see [what the badges mean](../developers/plugins/overview.md#what-the-badges-on-a-listing-mean).
3. **The price.** The header repeats the card's chip — `$29`, or **Free** — and the
   button spells out what pressing it does: a paid listing reads **Buy for $29** rather
   than **Install**. Buying is one payment; the listing's updates are included in it.

## Step 3 — Read the reviews, and know who can leave one {#step-3-reviews}

Ratings on a listing come only from people with a **verified email** whose
organization **actually installed it**. Comments are open to any signed-in user. So a
listing's star rating is a claim by users, and its comment thread is a claim by
anyone — weight them differently.

## Step 4 — Choose which sites get it {#step-4-targeting}

This is the step to read.

On the detail page you'll find **Install to**, with up to three choices:

| Option | What it means |
| --- | --- |
| **All sites** | Everything in the organization. For a plugin, that includes **sites you add later**. |
| **Selected sites** | Only the sites you tick. A list of your sites appears underneath — tick at least one. |
| **All sites except…** | Every site but the ones you tick to leave out. For a plugin, that includes **sites you add later**. Tick at least one, and keep at least one in. |

<!-- screenshot: marketplace/install-to-selected-sites.png per SCREENSHOT_PLAN.md -->

**"All sites" does not mean the same thing for every kind of listing**, and that is the
whole reason this step exists:

- **Plugins and dataset schemas install organization-wide.** A site you create next
  month gets them too.
- **Components, templates, layouts, themes and email templates are site-scoped.** "All
  sites" copies them onto every site you have *right now*; a site you add later will
  **not** have them. "All sites except…" works the same way: it copies them onto the
  sites you have now, minus the ones you leave out, and a site you add later will
  **not** have them.

You will have seen this fact once already, in the **What's included** box further up
the page — *Installs org-wide, covering sites you add later*, or *Installs per site —
new sites are not covered automatically*. The line under each **Install to** choice is
the same fact with your own numbers in it: for the site-scoped case it reads "Installs
to all 4 sites. New sites won't get it automatically." Two wordings, one behavior — if
they ever seem to disagree, the line under the choice is the one counting your actual
sites.

"Selected sites" and "All sites except…" only appear when there's a choice to make. A
dataset schema installs for the whole organization, so it offers **All sites** alone.
On a one-site organization "All sites except…" is switched off, because there is
nothing to leave out.

**A plugin left out of a site** is switched off there exactly as if that site had
switched it off itself, on its **Admin → Plugins** page:

- Leaving a site out takes the **Manage site settings** permission on that site, which
  its admins hold by default. If you don't hold it on a site you tick, nothing is
  installed, and the message names the site.
- Anyone holding **Manage site settings** on a site you left out can turn the plugin back
  on for that site, from its **Admin → Plugins** page.
- A site that had switched this plugin off before keeps it off; installing doesn't turn
  it back on there.

:::caution Every site here is a live site
There is no staging site in Aglyn. Whatever you install is reachable by real visitors
as soon as it's on a site. If you want to try something cautiously, install it to
**one** site — ideally the quietest one — rather than to all of them.
:::

## Step 5 — Install it {#step-5-install}

Press **Install** (or **Buy for $…**). A confirmation dialog names the listing, its
type, its **version**, and — in bold — exactly where it's going:

> Install **Bookings Pro** (plugin, v2.1).
> This will be installed to **all sites**.

<!-- screenshot: marketplace/install-confirm-dialog.png per SCREENSHOT_PLAN.md -->

Read that bold phrase. It is the last chance to catch a mis-set target, and it is why
the dialog exists.

Choose **Install**. That's it.

A paid listing is bought first, and you pay right there on the listing. **Buy for $…**
opens the price, the sales tax, the total and the card that will be charged, under the
button. Choose **Pay** and your workspace's card on file is charged. If your bank wants
to confirm the payment, its own step opens first. If the workspace has no card or billing
address on file, you add them in the same place. If the card is declined, nothing is
charged: the step says why, with a link to Billing to change the card. The receipt is the
invoice under **Organization → Billing → Invoices**, and the listing's button then reads
**Install**.

Paying charges the workspace's card, so it takes the **Manage billing** permission.
Without it you still see the price, the sales tax and the total, but there is no **Pay**,
and the step says someone who manages billing can buy it.

Two things happen that are worth knowing:

- **The install is version-pinned.** You have v2.1 and you keep v2.1 until you
  deliberately upgrade. A publisher shipping v2.2 tomorrow does not change your sites
  overnight.
- **A plugin is enabled for the workspace automatically.** You don't have to go and
  switch it on after installing.

## Step 6 — Use it {#step-6-use}

Where it shows up depends on what you installed:

- **Plugins** add a named group to the Besigner's **elements drawer**, and often a
  page in the console navigation.
- **Components, layouts and templates** appear in the drawer and in your site's
  templates library, badged **Marketplace** with the version they came from.
- **Themes** apply to the site you chose.
- **Dataset schemas** appear as a new, empty dataset under **Data**.
- **Email templates** arrive as a **draft** email you can edit before sending.

## Step 7 — Turn it off, or take it back off {#step-7-off}

Three different actions, often confused:

| You want to | Where | What happens |
| --- | --- | --- |
| Stop it running, keep it | **Plugins** → its switch | Off everywhere in the workspace. Flip it back any time. |
| Remove it from your sites | **Marketplace → Installed** → **Uninstall**, or **Uninstall org-wide** on an org-wide install. The listing's own detail page carries the same button. | The pin and the switchboard entry go. |
| Update it | **Marketplace → Installed**, or the detail page's **Update to v2.2** button | You move to the new version, deliberately. |

<!-- screenshot: plugins/plugins-switchboard-cards.png per SCREENSHOT_PLAN.md -->

**Uninstalling never deletes the data a plugin created.** Reinstall it and it picks up
where it left off. That is deliberate — an accidental uninstall shouldn't cost you a
year of bookings — but it also means uninstalling is *not* how you erase data. For
that, delete the data itself.

Design copied onto a site behaves differently, and the difference matters: a component
or template you installed and then **edited** is now *your* copy. Uninstalling the
listing doesn't reach into your pages and remove it, and updating shows you field by
field what the publisher's new version would overwrite before it touches your edits.

## Manage your plugins {#manage-plugins}

**Plugins**, in the organization navigation, is where you switch plugins on and off for
the whole workspace — the ones you installed from the Marketplace, listed first, and
Aglyn's own built-in plugins below them. Open any plugin to see where it runs and change
its settings.

### Find the Plugins section {#find-plugins}

Plugins is its own section in the **organization** navigation, next to **Marketplace**.
**Organization → Settings → Plugins** used to hold the switches; it now only points you
to the section, where enabling, configuring and managing marketplace installs all live.

### Built-in plugins {#built-in-plugins}

The **Built in** card lists the plugins that ship with Aglyn, each with its own switch.
Switching one **off** removes it from every site in the workspace — its navigation, the
editor, published pages and the API — and switching it back on restores it.

- Flipping a switch needs the **Organization settings** permission, which the workspace's
  owners and admins hold by default. Without it the switches stay off, and a plugin's page
  names the permission to ask an organization admin for.
- A few cannot be switched off at all, because sites are built out of them.
- **AI** and **Forms** have no workspace switch: they stay on for the workspace, and a
  site switches them off for itself — see [A plugin on one site](#plugin-on-one-site).
  Their page's **Runs on** can leave sites out from the workspace too — see
  [Where a plugin runs](#where-a-plugin-runs).
- Switching off a plugin that another one depends on asks first, and names what else
  will go with it.

### A plugin's page {#a-plugins-page}

Open a plugin from the Plugins section to manage it for the workspace. Its page shows
**Where it runs**, the plugin's own **settings** — saved once for the workspace and
followed by every site — its **Dependencies**, and, for a marketplace plugin, the version
you are pinned to and what it is allowed to reach. **View listing** opens a marketplace
plugin's listing.

### Where a plugin runs {#where-a-plugin-runs}

The **Where it runs** card on a plugin's page answers which of your sites have it. A
marketplace plugin runs on the sites it was [installed to](#step-4-targeting) —
**All sites**, including ones you add later, **All sites except…** the ones you left
out, or the sites you picked. A site that switched it off on its own **Admin → Plugins**
page doesn't run it, whichever you chose.

For a marketplace plugin, the card lists each site it is installed on, and marks a site
that switched it off, or that you left out when you installed it, **Switched off on this
site**. The sentence above the list counts only the sites that run it. The listing's own
page in the Marketplace shows the same list. Anyone holding **Manage site settings** on
a site marked this way, which its admins hold by default, can turn the plugin back on
there from that site's **Admin → Plugins** page.

A built-in plugin has the workspace switch, and under it **Runs on**:

| Choice | What it means |
| --- | --- |
| **All sites** | Every site in the workspace, including sites you add later. |
| **All sites except…** | Tick the sites to leave out. Every other site runs it, including sites you add later. |

Press **Save**. The line beside it says how many sites the plugin comes off, and how
many it comes back on for. Switched off for the workspace, a plugin runs on no site,
so **Runs on** stays off until you switch it on.

A site left out is switched off exactly as if that site had switched the plugin off
itself, on its **Admin → Plugins** page, so:

- **A site left out can turn it back on for itself.** Anyone holding **Manage site
  settings** on that site, which its admins hold by default, can switch it on there.
  **Runs on** then counts that site as in.
- A site that switched the plugin off for itself shows here as left out, and choosing
  **All sites** turns it back on there.
- **Selected sites** is not offered, because a site you add later would get the
  plugin anyway.
- You can't leave every site out; switch the plugin off for the workspace instead.
- Where a plugin on a site needs the one you are leaving out — **User Accounts** needs
  **Commerce** — saving is refused, naming the site. Switch the other plugin off on that
  site first, or keep the site in.
- **User Accounts** still runs only on the sites that turned it on. Leaving a site out
  keeps it off there even if that site turned it on.
- The **Components** library runs on every site and can't be left out.

Changing **Runs on** takes the **Organization settings** permission, which the
workspace's owners and admins hold by default, and **Manage site settings** on each site
it switches the plugin on or off for. Without them, the field stays off and says which
permission it takes.

### Permissions & data {#permissions-and-data}

The **Permissions & data** card shows what a marketplace plugin declared it can reach,
so you can check it before you rely on it. **Capabilities** lists the parts of your
workspace data it may use — none declared means it cannot reach your data directly —
and **Network allowlist** names the outside sites it may call; with none listed, its
sandbox blocks every outbound request. Built-in plugins have no card, because they are
not sandboxed.

### Plugins on one site {#site-plugins}

A site can run fewer plugins than the workspace enables. **Site Admin → Plugins** lists
the workspace-enabled plugins in two groups, **Built in** and **Installed from the
marketplace**; turn a switch off and press **Save site plugins** to switch it off for that site
alone. It disappears from that site's navigation, editor, published pages and API, and
other sites are unaffected. A site can never switch on a plugin the workspace has
switched off.

### A plugin on one site {#plugin-on-one-site}

Open a plugin from **Site Admin → Plugins** to see whether it **runs on this site**, and
why: the workspace switch, and this site's own choice. Where switching it off for the
site stops some things and keeps others — AI keeps the workspace's add-on and billing,
Forms keeps its saved submissions — the card says which before you flip it. The plugin's
settings can be answered differently for this site field by field; see
[Settings for one site](../developers/plugins/overview.md#configure-site).

### Connect a plugin to another service {#plugin-connections}

Some plugins show information from another service, such as your business listing's
reviews. Their page under **Site Admin → Plugins** has a card for each service the
plugin uses:

1. Press **Connect**. You sign in at that service and choose what to share; this site
   never sees your password.
2. Back on the page, choose what the plugin should use, such as an account and then one
   of its locations, and press **Use this…**.
3. From then on the plugin stays up to date on its own. The card shows when it last
   synced and when it syncs next. **Sync now** updates it straight away, **Change**
   picks something else, and **Disconnect** stops it.

If the service stops accepting the connection, the card says **Reconnect needed**;
press **Reconnect** and sign in again. Connecting is part of the Starter, Pro and
Custom plans, and it needs the **Manage a site’s plugin connections** permission. On a
plan without it the card stays on the page with its buttons off and an **Upgrade** link.

## What to do next

- **Running several client sites?** [Run an agency workspace](./run-an-agency-workspace.md)
  covers standardizing installs across sites, and automating the rest.
- **Want to build one?** [Build your first plugin](../developers/plugins/guides/first-plugin.md)
  is the developer half of this page — same product, written for someone who codes.
- **Selling one?** [Publish a plugin](../developers/plugins/publish-a-plugin.md) and
  the [publisher handbook](../developers/plugins/publishing/publisher-handbook.md).

## Related

- [Plugins & Marketplace](../developers/plugins/overview.md) — the reference: install
  scopes, badges, sandboxing, and the Marketplace/Plugins split.
- [Your templates library](../building-sites/site-templates/templates-library.md) —
  where installed design lands, and how a marketplace copy is badged.
- [Teams & roles](../workspace-and-billing/teams-and-roles/overview.md) — who is
  allowed to install.
