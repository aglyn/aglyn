---
sidebar_position: 5
title: Org automations
description: Write an automation once for the whole organization and run it on the sites you choose, with a pause on each site.
---

# Org automations

An **org automation** is one automation your organization writes once and runs on the
sites it chooses — every site, or the ones you pick. Build it at the organization level
under **Automation → Org automations**; each site shows the ones that run on it, and
can pause them for itself.

:::info Plan availability
Org automations are built from the [actions builder](actions-builder.md)'s steps, so
they are **Pro+**, like the actions builder, and their runs are **metered** on the
same allowance a site's own actions use.
:::

## What an org automation is {#what-an-org-automation-is}

An org automation has a trigger, optional conditions and an ordered list of steps,
exactly like an action — and a **placement**: the sites it runs on.

**Each run belongs to the site the event happened on.** When a form is submitted on
your Shop site, the org automation runs **as Shop**:

- its emails go from Shop's sending identity, respect Shop's unsubscribes and
  suppressions, and are logged on the contact's timeline for Shop;
- its CRM steps write into Shop's part of the contact, the way Shop's own actions do;
- it counts on **Shop's action runs** — the same meter as Shop's own actions, shown
  on Shop's **Automation → Actions** — and a site that has used its month's runs runs
  no more of either;
- its run history is on **Shop's** Actions section, under **Org automations on this
  site → Runs**.

Nothing about one site's run touches another site. Placing an automation on five sites
is five sites each running it for themselves.

A site's own actions always come first: an org automation never stops one of the site's
actions from running, even when the month's runs are nearly used up.

## Create one

1. At the organization level, open **Automation → Org automations** and choose
   **Add org automation**.
2. Name it and pick the **trigger event**. Optionally add a filter or conditions — the
   same ones the actions builder offers.
3. Choose where it **runs on**: **Every site** — including sites you add later — or
   **Chosen sites**, up to 30 of them.
4. Add the **steps**, then save.

Only an organization **owner**, **admin** or **editor** creates and edits org
automations. An organization holds up to 100 of them; deleting one frees its place.

### Triggers

Org automations start on what the server records about a person: **Form submitted**,
**New lead**, **Contact created**, **Contact changed stage**, **New booking**, **Member
signed up**, **Member signed in**, **Deal moved**, **Deal won**, **Deal lost** and **CRM
task completed**. What each event carries for filters and conditions is listed under the
filter field as you pick it.

Page views and on-page events (clicks, scroll depth, exit intent) are not offered: they
belong to one site's pages. Build those as [actions](actions-builder.md) on the site.

### Steps

**Send an email**, **Notify site admins**, **Enroll in a list**, **Assign to a
campaign**, **Write to a dataset**, **Update a dataset record**, the five
[CRM steps](../../content-and-data/crm/automations.md#the-steps), **Fire a custom
event**, **Wait**, **Wait for something to happen** and **End the flow here**.

What is left out belongs to one site, so an org automation cannot run it:

- **Run a workflow** — a workflow calls its own site's functions and variables;
- **Send a webhook** — a webhook holds its own site's address and secret;
- every in-page step — popups, drawers, menus, show and hide, CSS classes, custom HTML
  and JavaScript, analytics events, redirects and site alerts.

To hand over to something site-specific, use **Fire a custom event**: it fires on the
site the org automation is running on, and that site's own actions can start on it.

A dataset or a campaign is offered only when it is shared with every site the
automation runs on, so the step works wherever it runs. A list belongs to the whole
organization and is always offered.

## Pause it on one site {#pause-it-on-one-site}

Each site's **Automation → Actions** section shows **Org automations on this site**:
the ones placed on it, whether each runs here, and **Pause here** / **Resume here**.
A site's **admins** and **editors** can pause an org automation on their own site —
only their own; the organization's editors can pause it on any of its sites from the
organization hub, with **Pause on…** and the **Paused on** chips.

Pausing stops it on that site, including for anyone waiting inside it there, and leaves
every other site running it.

## Waiting, switching off and deleting

An org automation can **Wait** and **Wait for something to happen**, like an action. A
person who is waiting waits on the site their run started on, and continues with the
steps as they were when they entered, even if the automation is edited meanwhile.

Switching an org automation **off**, **deleting** it, taking a site **off** its
placement, or **pausing** it on a site stops the people waiting inside it on the sites
affected, on their next step — the same as switching off an action does.

## Every site's own automations {#every-sites-own-automations}

The organization hub's **Workflows**, **Actions** and **Webhooks** sections list every
site's own workflows, actions and webhooks side by side, with the site each belongs to.
Each row opens that site's **Automation**, where it is edited, and **Add … on a site**
asks which site first. The lists open with the first few sites and show the rest when
asked; a site with more than fits in the list links to its own page for all of them.
Webhooks are listed for admins and editors, because each holds its site's secret.

## Related

- [Actions builder](actions-builder.md)
- [Build a workflow](build-a-workflow.md)
- [Automations for the CRM](../../content-and-data/crm/automations.md)
- [Automation overview](overview.md)
