---
sidebar_position: 3
title: Add-ons
description: Buy extra seats, sites, datasets, POS registers, and the Event Calendar from the Billing page — prorated, self-serve, no support ticket.
---

# Add-ons

Add-ons let you buy **more of a specific thing** without jumping a whole plan tier.
They bill as extra line items on your existing subscription, prorate onto your current
billing period, and take effect immediately.

Manage them on **Billing → Add-ons** (requires the `billing.manage` permission and an
active plan subscription — add-ons ride your plan's subscription, so Free workspaces
pick a plan first).

## What you can add

| Add-on | What it does | Starter | Pro | Business | Scale | Advanced | Agency |
|---|---|---|---|---|---|---|---|
| Manager seats | Workspace manager seats beyond the included count | $5/mo | $4/mo | $3/mo | $2/mo | $2/mo | $2/mo |
| Collaborator seats | Per-site collaborator (teammate) seats beyond the included count | $3/mo | $2/mo | $1/mo | $1/mo | $1/mo | $1/mo |
| Extra datasets | Additional shared datasets across the workspace | $2/mo | $2/mo | $1/mo | $1/mo | $1/mo | $1/mo |
| Extra sites | Publish more sites than your plan includes | $10/mo | $8/mo | $5/mo | $5/mo | $4/mo | $3/mo |
| POS registers | Additional point-of-sale registers/locations | $89/mo | $89/mo | $89/mo | $89/mo | $89/mo | $89/mo |
| Event Calendar | The event manager + calendar elements, workspace-wide | $9/mo | $9/mo | $9/mo | $9/mo | $9/mo | $9/mo |

- **Prices are per unit per month.** On annual billing, add-ons bill yearly alongside
  your plan (12× the monthly price) — a subscription has one billing interval.
- **POS registers** also require a plan with POS (Pro and above).
- **Event Calendar** is a single workspace-wide toggle, not a per-site charge — see
  [Events calendar](../../content-and-data/events/overview.md).

## How changes bill

- Adding or removing units shows a **prorated preview** of today's charge before you
  confirm, and takes effect immediately.
- Removing an add-on credits the unused time onto your next invoice.

:::note Add-ons are not on the plan-switch schedule
Add-on changes are always immediate and always prorated, in **both** directions.
Plan switches are not: since Aglyn moved to end-of-cycle downgrades, a *plan*
downgrade waits for your period end and charges $0 today, while only a plan
*upgrade* is immediate and prorated. Removing an add-on still credits you today.
See [when each change takes effect](./downgrading-and-canceling.md#when-changes-take-effect).
:::
- **Hard caps**: seat and dataset add-ons stop at your plan's maximum (for example,
  Starter tops out at 5 workspace managers). Past the cap, the answer is a plan
  upgrade — the Billing page tells you when you're there.

## Plan switches and cancellation

- **Switching plans** keeps your add-on quantities and re-prices them at the new
  plan's rates. If the new plan doesn't sell one of your add-ons, it's removed and
  the switch confirmation says so. On an **upgrade** this happens today, in the same
  prorated update as the plan change. On a **downgrade** it happens on the effective
  date along with the plan — your add-ons keep running, at your current plan's rates,
  for the rest of the period you already paid for.
- **Canceling** (or a subscription that dies after failed payments) ends your add-ons
  with the plan — they bill on that subscription, so entitlement enforcement stops
  counting them at the same moment the plan downgrades to Free.

## Related

- [Billing & plans overview](overview.md)
- [Downgrading, canceling & your data](downgrading-and-canceling.md)
- [Teams, roles & membership](../teams-and-roles/overview.md)
