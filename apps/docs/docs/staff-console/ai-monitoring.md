---
sidebar_position: 14
title: AI monitoring
description: How staff watch one organization's AI usage — add-on, credits, overage, refusals, jobs, tokens, cache hits and margin — read its AI conversations, and find those figures across the staff console.
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

**Tokens.** This month's tokens as the provider counts them — sent, read from
the prompt cache, written to it, and generated — with the **cache hit rate**:
the share of prompt tokens the cache served, out of everything the prompts
were billed as. Cache writes count against it, because a prompt prefix that
expires and is written again every other request costs more than one never
cached. Below that, one row per kind of request — the assistant, a Besigner
copy mode, each generation job kind — with its requests, the provider cost
**per request**, its tokens and its own cache hit rate. A request is one
metered model call, so a generation job that plans and then builds counts
two, and a question answered from the docs counts none. A month recorded
before kinds were kept shows its totals and no rows.

**Top users this month.** The ten people who drew the most, by credits — named
from the roster, with their share of the organization's spend, the dollars
behind their credits, requests and refusals beside them. Those dollars are what
the credits were charged at, so a person's three figures are one arithmetic;
what the month cost the platform is the Margin section below. Each name opens the account's
staff page. An organization with nobody attributed reads as exactly that, not
as a failed read.

**Margin.** This month's provider spend against what AI brings in: the
add-on's price when it is on, the share of the plan price the band was sized
against, and overage priced at the plan's rate. Spend here is what the models
actually cost, which on the balanced tier is below what the same tokens drew in
credits — the credit rate carries a markup, and reading it as a cost would make
a fully-drawn band look like exactly break-even. The section turns **red when
spend exceeds the add-on plus the plan's assist share** — overage is left out
of that comparison because it bills at a margin, so an organization deep in
overage is not the one losing money. It also names the multiple of the staff
review threshold the spend has reached, which is the same figure the margin
alert email escalates on.

**Actions.** Links to the entitlement override editor, where the credit band
and the AI features are overridden per organization, and to Lockdown, where
the `ai-assist` and `ai-generate` feature keys pause AI for one organization.

## Compensating a customer's AI credits {#compensating-credits}

When a fault of ours spent a customer's AI credits — a generation that failed
after it had already drawn, a refusal our own code caused — give the credits
back rather than raising their band. A give-back undoes the one month's spend;
a band override changes every month after it.

**Who can.** The `billing` and `super` staff roles. Anyone else sees the
buttons disabled with the reason.

**Where.** The AI card on **Staff → Organizations → an organization** carries
two header actions, and each recent generation job a row action:

- **Give back credits** — a number of credits, back to the meter you choose.
  It opens at the amount that puts the meter back to zero; from a job's row it
  opens at what that job spent, with the job id filled in.
- **Reset this month** — everything the meter used this month, each meter its
  own figure.
- **Give back this job's credits** (the job's row menu) — the first, prefilled
  for that job.

**Which meter.** A paid workspace has one: its **workspace band**. A Free
workspace has two, and both refuse at 300 credits — its own band, and its
**owner's Free allowance**, which every free workspace that person owns draws
on. A Free customer stopped by either is stopped, so the dialog defaults to
**both**; the amount then applies to each, and can be no more than the lower
of the two. On **Staff → Users → an account**, the same two actions give back
to that account's Free allowance alone.

**What it asks.** A **reason** — required, and written to the audit log — and,
optionally, the AI job id it compensates.

**What happens.**

- The amount cannot exceed what the meter used this month, after earlier
  give-backs. Asking for more is refused and names each meter's figure.
- The spend is never erased. The month's record keeps what was spent, adds
  what was given back beside it, and keeps each give-back with who gave it,
  why, and the job. The card then shows *N credits given back this month*.
- Every figure the customer sees reads the reduced use straight away — the
  usage strip in the AI panels and the credit banner — and their next request
  is admitted against it. There is no notice; tell them in the conversation
  that prompted it.
- On a paid workspace past its band, the credits given back also come off the
  overage the month bills. An overage that was **already charged** is not
  refunded by this — use [Refunds](refunds.md) for the money.
- One `ai.credits.giveBack` (or `ai.credits.reset`) row lands in the staff
  audit log with the meters, amounts, reason, job and month. A double-click or
  a retried request returns the credits once.

It does not touch the daily request or message caps, which reset at midnight
UTC on their own, and it does not change what the month cost us: the margin
and spend figures keep the real provider spend.

## AI conversations {#ai-conversations}

Below the AI card, **AI conversations** shows what people in the organization
typed to Aglyn AI and what it answered. It's where to look when you want to
know what a new customer was trying to do, or why an answer confused them.

Nothing loads until you choose **Show conversations**. Then switch between:

- **Assist chat**: each question asked in the Assist panel, with its answer,
  who asked, when, the console page it was asked from, the model, what it cost
  and any thumbs rating. Questions and answers are deleted 180 days after they
  were asked, so older chat isn't listed.
- **AI jobs**: each job's brief, kind, status and credits, who started it,
  what it made, and any error. For an insight question or a CRM summary, email
  draft or column match, the answer itself is shown too. A CRM answer is
  deleted 14 days after it's written.

Each list shows 25 entries at a time, newest first. Use **Load more** for older
ones.

Every page you open is recorded in the staff audit log as
`org.ai-conversations-viewed` (an access), with the list you opened and how
many entries it returned. The log never records the text itself. Customers'
AI requests and answers are accessible to Aglyn under the Privacy Policy, but
read them only to support the customer or improve the product.

## Where else the figures appear {#where-else}

**Metered usage.** The rollup table on the same page, and the Usage dialog on
the Organizations list, carry two more columns: **AI credits used** and
**AI overage billed**. Both come off the monthly rollup, so they describe
closed months; a dash means the rollup predates the credit meter, not that
the organization used nothing.

**Organizations list.** An **AI spend (month)** column shows this month's
live provider spend per organization and sorts on it, unmeasured
organizations last. Months closed before provider spend was recorded
separately show what they drew, which is at or above what they cost. It is the quickest way to find the one organization
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
