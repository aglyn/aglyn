---
sidebar_position: 3
title: Add-ons
description: Buy extra seats, sites, datasets, POS registers, the Event Calendar, Aglyn AI and Site Care from the Billing page — prorated, self-serve, no support ticket.
---

# Add-ons

Add-ons let you buy **more of a specific thing** without jumping a whole plan tier.
They bill as extra line items on your existing subscription, prorate onto your current
billing period, and take effect immediately.

Manage them on **Billing → Add-ons** (requires the `billing.manage` permission and an
active plan subscription — add-ons ride your plan's subscription, so Free workspaces
pick a plan first).

## What you can add

Buy extra capacity for the whole workspace on the **Plan add-ons** card under
**Billing → Plan**: manager seats, datasets and extra sites apply straight away, while
collaborator seats and POS registers become pools you then assign to a site.

:::tip Prices live on one page
Per-unit add-on prices are on **[aglyn.com/pricing](https://aglyn.com/pricing)**, and
what YOUR workspace would pay is shown in **Billing** before you confirm. This page
covers what each add-on does and how it is billed; restating the numbers here would
just be a second copy to keep in step.
:::

| Add-on | What it does | How it is priced |
|---|---|---|
| Manager seats | Workspace manager seats beyond the included count | Per seat, per month — cheaper on higher plans |
| Collaborator seats | Per-site collaborator (teammate) seats beyond the included count | Per seat, per month — cheaper on higher plans |
| Extra datasets | Additional shared datasets across the workspace | Per dataset, per month — cheaper on higher plans |
| Extra sites | Publish more sites than your plan includes | Per site, per month — cheaper on higher plans |
| POS registers | One extra point-of-sale register, assigned to one site | Flat per register, per month — the same on every plan |
| Event Calendar | The event manager + calendar elements, workspace-wide | Flat per month — the same on every plan |
| Aglyn AI | Generative building — pages, emails, campaigns, products and more — plus a monthly band of AI credits added to your plan's, workspace-wide | Flat per month, priced by plan — higher on higher plans, and so is the band it adds |
| Site Care | Our team makes your small site changes for you, about an hour of work a month, workspace-wide | Flat per month — the same on every paid plan |

- **Prices are per unit per month.** On annual billing, add-ons bill yearly alongside
  your plan (12× the monthly price) — a subscription has one billing interval.
- **POS registers** also require a plan with POS (Pro and above), and each one is
  assigned to a specific site — see [Assigning register seats](#assigning-register-seats).
- **Collaborator seats** work the same way as POS registers: bought once for the
  workspace, then assigned to a site — see
  [Assigning collaborator seats](#assigning-collaborator-seats).
- **Event Calendar** is a single workspace-wide toggle, not a per-site charge — see
  [Events calendar](../../content-and-data/events/overview.md).
- **Aglyn AI** is a single workspace-wide toggle too, bought once for the workspace
  rather than per seat or per site — see [Aglyn AI](#aglyn-ai).
- **Site Care** is a workspace-wide toggle as well, on any paid plan — see
  [Site Care](#site-care).

## Assigning register seats

Unlike every other add-on, a POS register seat is bought **once for your workspace**
and then **assigned to one site**. Buying a seat does not raise the register limit
everywhere — it adds one register's worth of capacity that you place where you need it.

Your plan already gives every site a register allowance on its own (Pro 1, Business 2,
Advanced 5). A seat is added on top of that, for the one site you assign it to.

To assign one, go to **Billing → POS register seats**, directly under Plan add-ons.
The card shows how many seats you've **purchased**, how many are **assigned**, and how
many are **unassigned**, then lets you add or remove seats per site.

- **Seats are reassignable.** Moving a seat between sites is immediate and costs
  nothing — you're not buying or canceling anything, just relocating capacity.
- **Taking a seat off a busy site doesn't delete anything.** If the site is running
  more registers than it can after the move, the extra ones stay set up but stop
  taking sales until you assign seats back or remove them. The console warns you
  before the move, with the number affected.
- **Deleting a site returns its seats to the pool** automatically, in the same action
  that removes the site. There's nothing to reclaim by hand.
- **You need the Manage billing permission** to move seats, the same permission that
  buys them.

If every purchased seat is already assigned and a site needs another register, either
move a seat off a site that isn't using it, or buy another seat under Plan add-ons.

## Assigning collaborator seats

Collaborator seats work exactly like register seats: a seat is bought **once for your
workspace** and then **assigned to one site**. Buying a seat does not raise the
collaborator limit on every site — it adds one site's worth of capacity that you place
where you need it.

Your plan already gives every site a collaborator allowance on its own. A purchased
seat is added on top of that, for the one site you assign it to, up to your plan's
per-site maximum. Past that maximum, more seats can't raise the limit and the only
path is a plan upgrade.

To assign one, go to **Billing → Site collaborator seats**, directly under Plan
add-ons. The card shows how many seats you've **purchased**, how many are
**assigned**, and how many are **unassigned**, then lets you add or remove seats per
site. The same numbers appear on each site's own Collaborators card.

- **Seats are reassignable.** Moving a seat between sites is immediate and costs
  nothing — you're not buying or canceling anything, just relocating capacity.
- **Nobody is ever removed for being over the limit.** If a site has more
  collaborators than its limit — because a seat moved, a plan changed, or the limit
  was corrected — everyone on it keeps their access and stays signed in. The only
  effect is that the site can't take on *another* collaborator until it's back under.
  The console warns you before a move that would leave a site over, with the number
  affected.
- **Deleting a site returns its seats to the pool** automatically, in the same action
  that removes the site. There's nothing to reclaim by hand.
- **You need the Manage billing permission** to move seats, the same permission that
  buys them.

If every purchased seat is already assigned and a site needs another collaborator,
either move a seat off a site that isn't using it, or buy another seat under Plan
add-ons.

## Aglyn AI {#aglyn-ai}

**Aglyn AI** is the generative add-on: with it on, the assistant builds for you —
pages, components, emails, campaigns, products and more — rather than only answering
questions about them. It is bought once for the workspace, on any paid plan, and
applies to every member who has the permission to generate. What each door does is
under [Aglyn AI](../../ai/overview.md).

- **Everything it builds is a draft.** The add-on cannot publish a page, change a live
  one or send an email. It writes drafts and unpublished versions, which a person
  reviews and publishes through the buttons that already exist — see
  [the draft rule](../../ai/overview.md#drafts-only).

- **One pool, one meter.** The add-on adds a band of **AI credits** to the band your
  plan already includes, every month. There is no second meter: the AI credits meter
  on **Billing → Usage** shows your plan's credits and the add-on's as one figure, and
  the same overage rate, stop switch and monthly ceiling apply to the whole band — see
  [AI credits and overage](overview.md#assist-overage).
- **Priced by plan.** The add-on's monthly price and the credits it adds both rise with
  the plan. The figures are on [aglyn.com/pricing](https://aglyn.com/pricing) and in
  **Billing** before you confirm; on annual billing it bills yearly with the plan, like
  every add-on. Enterprise workspaces carry generative building in their agreement
  instead of buying it.
- **Starter widens a band it already has.** Starter includes its own monthly AI
  credits, and credits past them are sold at the same rate as Pro — so the stop switch
  and the ceiling are on its billing page with or without the add-on. Adding Aglyn AI
  increases the band and opens generative building.
- **You can see where it is used before you buy it.** On a paid plan without it,
  **Create with AI** still shows on the Pages, Templates, Layouts, Forms, Components,
  Automation, Functions & Variables and email Templates pages, on Products, and on
  Marketing's Campaigns and Overlays — and **Ask AI about these numbers** on your
  dashboards and Marketing reports. Each opens a short note on what it would do there
  with a link to **Billing → Add-ons** — or, for a member without the **Manage billing**
  permission, a note to ask a workspace owner or admin.
- **Free workspaces** do not buy it. They generate against the
  [monthly taste](overview.md#free-ai-credits) instead, which stops at its band and
  never bills.
- **Removing it** takes effect at the end of the period you already paid for, like every
  add-on removal. Then the band shrinks back to your plan's own credits and generative
  building turns off; what the assistant already built stays exactly as it is.

### Common questions {#aglyn-ai-questions}

**Does buying it let everyone generate?** No. Generating is a permission as well as a
plan feature. A workspace member also needs **Generate with AI** on their role, and a
site collaborator needs the **Generate** box on that site's Users card; without it the
request is refused with a message naming the key. See
[the AI permissions](../teams-and-roles/custom-roles.md#ai-permissions).

**Can one person spend the whole band?** Only if you let them. **AI allotments** under
**Billing → Usage** give a member, a site collaborator or a whole site its own monthly
share of the pool — a **hard** allotment stops at the line, a **soft** one keeps working
and notifies. An agency can give every client site the same share, so one site running
out never touches another. See [AI allotments](overview.md#ai-allotments).

**Can I keep it off for one site?** Yes, but it is a site setting rather than a billing
one. A site admin switches AI off for that site under **Admin → Plugins → AI**, which
removes the assistant and every **Create with AI** door from it while the rest of the
workspace carries on. It does not pause the add-on or its charge — see
[Switch AI off for one site](../../ai/overview.md#switch-ai-off-for-one-site).

**Who can see what it cost?** Anyone with the **View billing** permission. Beneath the
usage meters, a table gives each member's share of the month's credits, their requests,
and how often the assistant refused them. It names who drew from the pool, never a
dollar figure per person — the share is of the workspace's own credits. See
[who is generating what](overview.md#who-is-generating-what).

**What happens when the band runs out?** Whatever your plan already does when its own
credits run out, because the add-on widens one band rather than adding a second. On a
plan that sells credits past it the assistant keeps going and the extra is metered,
unless you turn on the stop switch or set a monthly ceiling. See
[AI credits and overage](overview.md#assist-overage).

## Site Care {#site-care}

**Site Care** is the add-on for owners who would rather not make site changes
themselves. You tell us what to change, and our team makes the change on your site
for you. It is bought once for the workspace, on any paid plan, and covers every site
in it.

**What is included.** Small changes to the site you already have, up to about an hour
of our work a month:

- your hours, prices, menu or service list
- swapping or adding photos you send us
- adding or removing a staff member
- a seasonal banner or announcement
- a new section on a page that already exists
- fixing a typo, a link or a phone number

We make each change within **2 business days** of your request and keep a log of the
minutes it took, so you can always see how much of the month's time has been used.
Unused time does not roll over to the next month.

**Extra time.** More of the same small changes past the included hour is extra time.
When a request will take the month past the hour, we ask you first and start only
once you have said yes. We record your approval and email you a confirmation. Extra
time is billed per started hour, so any part of an hour counts as a whole hour, at the
rate on [aglyn.com/pricing](https://aglyn.com/pricing), and it goes on your next
invoice.

**What is quoted first.** Bigger jobs that add something new are projects, outside the
monthly time:

- a new page or a new form
- a redesign of a page or the whole site
- logo or brand work
- photography
- writing the copy for a whole site
- ads

Each project is quoted as one flat price before any work starts, and the price is fixed
once we give it. It is never below the starting prices on
[aglyn.com/pricing](https://aglyn.com/pricing). Projects are paid by invoice; for a
larger quote, half is due before work starts.

**What it never covers.** Site Care is our time, not more capacity. Your plan's limits
still apply: a page past your plan's page count, a form past its form count, campaign
email or a second site still need a plan upgrade. See
[Billing & plans](overview.md) for what each plan includes.

**How to ask for a change.** Open the site in the console and press **Request a
change** at the top of its dashboard, then say what to change. Any member of the
workspace can ask. You can also email **support@aglyn.com** or reply to any message
from us, and say which site and what to change; send photos as attachments. We email
you when we have the request, with the day it will be done, and again when it is done,
with what changed and the time it took. If a request will go past the month's time, or
is a project, we reply first with the extra time it needs or a flat quote, and start
once you say yes.

- **Fair use.** About an hour a month is a guide, not a meter that cuts you off
  mid-change. Time past it is extra time, billed only for a request you said yes to;
  nothing past the hour is billed without your approval.
- **Questions about a charge.** You can question any charge, and ask for a statement
  of the month's requests and the time each one took. If we got something wrong, we
  correct it or credit it.
- **Price.** A flat monthly price, the same on every paid plan. It is on
  [aglyn.com/pricing](https://aglyn.com/pricing) and in **Billing** before you
  confirm; on annual billing it bills yearly with the plan, like every add-on.
- **Free workspaces** cannot add it: there is no subscription for it to bill on.
  Choose a paid plan first, and the switch on **Billing → Add-ons** turns on.
  Enterprise workspaces arrange it in their agreement instead.
- **Turning it off** takes effect at the end of the period you already paid for, like
  every add-on removal. Every change we already made stays on your site.

### Your Site Care statement {#site-care-statement}

The **Site Care** card on **Billing** is the month's statement, kept up to date as we
work. It shows each request with the time it took, how much of the month's included
time is used and how much is left, any extra time and where its charge stands (on your
next invoice, removed, credited back or refunded), and every record in order: each
request, each approval you gave us, each charge and each correction, with the reason.
Switch to **Last month** to see the month before. Anyone who can view billing sees it.

Nothing on it is ever rewritten. If we correct the time on a request, or remove,
credit or refund a charge, a new record says what it was, what it is now and why, and
we email you the same. We can also email you the whole month's statement; just ask.

### Projects on Billing {#site-care-projects}

A project is billed on its own invoice, separate from your plan. Before we send one, we
email you a confirmation of what it covers and the price you agreed to. Each invoice
then comes by email with a link to pay it by card on your phone or computer, and we
email you a receipt when it is paid. A larger project is billed in two halves: the
first before we start, the second when it launches.

The **Projects** card on **Billing** lists each project with what it covers, the price
and how it is split, where it stands, and each invoice with a **Pay** button while it is
unpaid. **Everything we recorded** shows every step in order, including any correction
and why. The invoices are also in your billing history with your other charges.
Anyone who can view billing sees it.

## How changes bill

- Adding units shows a **prorated preview** of today's charge before you confirm. It is
  charged to your card when you confirm, and the units are yours as soon as that
  payment goes through — if your bank asks you to confirm it, Billing shows the check
  right there.
- Removing units charges nothing and refunds nothing: you keep them until the end of
  the period you already paid for, and they drop off then.

:::note Add-ons are not on the plan-switch schedule
Adding an add-on works like a plan upgrade: charged today, prorated, and applied once
paid. Removing one works like a plan downgrade: nothing today, and it ends at your
period end.
See [when each change takes effect](./downgrading-and-canceling.md#when-changes-take-effect).
:::
- **Hard caps**: seat and dataset add-ons stop at your plan's maximum (for example,
  Starter tops out at 5 workspace managers). Past the cap, the answer is a plan
  upgrade — the Billing page tells you when you're there.

## Plan switches and cancellation

- **Switching plans** keeps your add-on quantities and re-prices them at the new
  plan's rates. If the new plan doesn't sell one of your add-ons, it's removed and
  the switch confirmation says so. On an **upgrade** this happens today, in the same
  prorated charge as the plan change. On a **downgrade** it happens on the effective
  date along with the plan — your add-ons keep running, at your current plan's rates,
  for the rest of the period you already paid for.
- **Canceling** (or a subscription that dies after failed payments) ends your add-ons
  with the plan — they bill on that subscription, so entitlement enforcement stops
  counting them at the same moment the plan downgrades to Free.

## Related

- [Billing & plans overview](overview.md)
- [Downgrading, canceling & your data](downgrading-and-canceling.md)
- [Teams, roles & membership](../teams-and-roles/overview.md)
