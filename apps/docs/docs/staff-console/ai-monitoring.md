---
sidebar_position: 14
title: AI monitoring
description: How staff watch one organization's AI usage — the add-on, the credit pool, overage and refusals, generation jobs, the top spenders, the margin — and where those figures appear across the staff console.
---

# AI monitoring

:::warning Staff only
Every surface on this page reads per-organization AI spend and, on the card,
per-person attribution. All of it requires a staff claim; none of it is
reachable from a customer console.
:::

AI is the one line on the platform whose unit cost is real money paid to a
third party every time a customer uses it, and the only one that can outrun
what a subscription brings in on its own. This page is where staff watch that
happen — per organization, on the page they already open to look at an
organization, and across the fleet on the boards that already rank cost.

## The AI card {#the-ai-card}

On **Staff → Organizations → an organization**, between *Effective
entitlements* and *Metered usage*, the card named after the AI add-on carries
everything about that organization's AI in one place. It reads once when the
page opens, and **opening it writes an access row** to the staff audit log —
the card shows per-person figures, and a look at those is recorded the same
way a look at a customer's email is.

**Add-on.** Whether the AI add-on is on — bought, and on a subscription that
is still paying for it — at what price on this plan, and since when. The date
comes from the subscription item in Stripe and is cached for a quarter of an
hour, so a purchase can take that long to show its date; when Stripe cannot
be asked the card says so rather than showing nothing.

**Credit pool.** The month's band as its named parts: the plan's own band, or
a staff override where one is written in its place, plus the add-on's band
when the add-on is on. Under it, what has been drawn in credits and in
provider dollars, what is left, and a straight-line projection of where the
month ends at the pace so far. The projection over-reads a burst on purpose —
it is a monitoring figure, and the direction to err in is the one that gets a
second look.

**Overage.** Credits past the band, what they are sold at on this plan, and
the dollars accrued so far. The line beneath names the state: sold with no
ceiling, sold up to the ceiling the organization set, stopped because that
ceiling is reached, stopped because the organization's own band switch is
on, or not sold on this plan at all.

**Refusals.** How many times the gate said no this month, by reason: the
band (a wall the organization chose, or a plan with nothing to sell past
it), the organization's own overage ceiling, the message cap, and the
operator's spend backstop. A workspace refused at its band forty times is a
sales conversation; one refused at the backstop is an incident. The counter
is kept on the same monthly document as the spend, so it starts from the
month this shipped.

**Generation jobs.** Counts of queued, running, needs-input and failed jobs
this month, and the last ten with their kind, credits used against reserved,
status and who started them. An organization that has never run a job reads
as having none; a read that failed says so instead.

**Top users this month.** The ten people who drew the most, by credits — named
from the roster, with their share of the organization's spend, provider
dollars, requests and refusals beside them. Each name opens the account's
staff page. An organization with nobody attributed reads as exactly that, not
as a failed read.

**Margin.** This month's provider spend against what AI brings in: the
add-on's price when it is on, the share of the plan price the band was sized
against, and overage priced at the plan's rate. The section turns **red when
spend exceeds the add-on plus the plan's assist share** — overage is left out
of that comparison because it bills at a margin, so an organization deep in
overage is not the one losing money. It also names the multiple of the staff
review threshold the spend has reached, which is the same figure the margin
alert email escalates on.

**Actions.** Links to the entitlement override editor, where the credit band
and the AI features are overridden per organization, and to Lockdown, where
the `ai-assist` and `ai-generate` feature keys pause AI for one organization.

## Where else the figures appear {#where-else}

**Metered usage.** The rollup table on the same page, and the Usage dialog on
the Organizations list, carry two more columns: **AI credits used** and
**AI overage billed**. Both come off the monthly rollup, so they describe
closed months; a dash means the rollup predates the credit meter, not that
the organization used nothing.

**Organizations list.** An **AI spend (month)** column shows this month's
live provider spend per organization and sorts on it, unmeasured
organizations last. It is the quickest way to find the one organization
spending while the month is still open.

**Margin utilization.** Each organization's revenue side names the AI add-on's
share, and the fleet summary totals it. The add-on was already inside the net
revenue figure — this names it, so the assist band's cost reads against what
it brings in rather than as pure drag.

## One account, across organizations {#one-account}

**Staff → Users → an account** carries a card named after the AI add-on with the
account's credits in **every workspace it belongs to, month by month** — the
same rollup the customer's Team and Usage pages read, kept thirteen months. It
is the answer to "is this one person driving the spend in three workspaces".
Opening it writes an access row **about that person** to the staff audit log,
which their page's *Data access by staff* card then shows.

## The spend leaderboard {#the-spend-leaderboard}

**Staff → Assist signal** opens with **AI spend this month, by workspace**:
each organization's plan, whether the add-on is on, credits drawn, provider
dollars and refusals for the current month, dearest first, above the tier and
model splits. It reads the monthly documents rather than the all-time signal
corpus the rest of the board mines, which is why it is the board's only panel
scoped to a month. The footnote says how many workspaces were ranked and how
many are shown; a warning above the table means the scan stopped at its
ceiling and the ranking is over a sample.

## Alerts {#alerts}

The staff margin alert — one organization's AI spend crossing the review
threshold — now says in the email whether that organization's AI add-on is on
and what its credit band is, so the reader knows without opening the console
whether the figure is a paying customer using what they bought or a cost with
nothing against it. The platform-wide free-spend ceiling alert reuses the same
sender.

## Related

- [Assist signal](assist-signals.md) — the docs-gap and cost board the
  leaderboard sits on.
- [Lockdown](lockdown.md) — the feature keys that pause AI for one
  organization.
- [Billing & plans](../workspace-and-billing/billing-and-plans/overview.md) —
  what the customer sees of the same credit pool.
