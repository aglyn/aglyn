---
sidebar_position: 10
title: Reports
description: New contacts over time, where they came from and how far they have gone, the open pipeline and its forecast, deals won and lost, and the task load — counted on the server for the records your site can see.
---

# Reports

**Reports** is the CRM in aggregate. Open it from the CRM's section rail or at
`…/hosts/{site}/crm/reports`. Every figure on the page is computed over the
same records the other sections list — a report can never count a contact,
deal or task the reader could not open — and most of them are counted by the
database rather than downloaded, so the page stays quick on a large CRM.

## Choosing a period

A picker at the top of the page selects the window the flow reports measure:
**Last 7 days**, **Last 30 days** (the default), **Last 90 days** or **This
month**. A day period counts back from the moment you pick it; "This month"
starts on the first of your calendar month. Each period is compared to the
one before it of the same length — thirty days against the thirty before them,
this month against last month — which is what the percentage next to a figure
is measured against.

Two cards ignore the period on purpose. The **Pipeline** and **Tasks** cards
describe what is open *now*; "the pipeline over the last 30 days" would be a
different question.

## Contacts

- **New contacts** in the period, with the change against the previous period.
  The percentage is left off when the previous period had nothing — a first
  contact has no growth rate.
- **Total contacts** visible to this site.
- **New contacts per week** — one bar per seven days from the start of the
  period; the last bar may be shorter.

A contact is "new" on the day it was first captured, not the day it was last
edited.

## Sources and lifecycle

- **By source** — how many contacts came through each capture surface (forms,
  orders, bookings, members, and so on). A person captured two ways counts
  under both.
- **Lifecycle funnel** — one row per lifecycle stage. Each row counts everyone
  who reached that stage *or went further*, so a customer also counts as a
  lead, and the funnel narrows as it goes down. Beside each row is how many
  people sit at exactly that stage now and the conversion from the step
  before. Contacts with no stage, and those marked *Other*, are reported
  under the funnel rather than folded into a step.

These two charts need a field off each contact, which the database cannot
aggregate, so they are read from the **newest 1,000 contacts** your site can
see. When the CRM holds more than that, the card says so and calls the figures
a sample.

## Pipeline

- **Open deals** and their **pipeline value** — the face value of every open
  deal, counted on the server.
- **Weighted forecast** — each open deal at the odds of its stage (a deal in a
  60% stage counts 60% of its amount). Won and lost deals are never in the
  pipeline: a won deal is revenue and a lost one is history.
- **Deals by stage**, per pipeline, each stage with its count, value and
  weighted value. A deal sitting in a stage the pipeline no longer has, or in
  no pipeline at all, is listed separately and is worth nothing to the
  forecast.
- **Top open deals** — the ten largest, each a link to the deal.

Deals in more than one currency are added as numbers and shown in the most
common currency, with a note saying so.

## Won and lost

- **Won** in the period, with the value of what was won.
- **Lost** in the period.
- **Win rate** — won over everything that closed in the period.
- **Won vs lost per week** — two bars per week, placed by the moment each deal
  was closed.

## Tasks

- **Open tasks**, **Overdue** (due before today) and **Due today**. Today and
  overdue are decided on your calendar day, the same way the Tasks list
  decides them, so the two never disagree about the same task.
- **Open tasks by assignee** — for each person, their overdue, due-today,
  upcoming and undated tasks, and the open total. Unassigned tasks are their
  own row.

## CRM at a glance

The site dashboard carries a **CRM at a glance** card with four numbers:
contacts, new contacts this week, the value of every open deal, and tasks due
today or overdue. Each is a link into the section that explains it, and each
is a single server-side count or sum — the card never downloads records to
count them. Switch it off from the dashboard's customize dialog if you do not
want it there.

## How the numbers are counted

- A figure that has not arrived, or that the database refused, shows as a
  dash — never as a zero. A zero is a measurement; a dash is the absence of
  one.
- Counts and sums are taken by the database. Where a chart needs a field off
  each record — a lifecycle stage, an assignee, the stage a deal sits in — it
  reads a bounded window (the newest 1,000 contacts, the 1,000 most recently
  updated open deals, the 1,000 soonest-due open tasks, the 500 most recently
  closed deals of each outcome) and says when the window was full.
- Everything follows the same per-site visibility as the contacts themselves.
  A collaborator scoped to one site sees that site's totals, not the
  organization's.
- The figures are remembered for a minute. Leaving the section to open a deal
  it named and coming straight back costs no reads and shows the same numbers;
  **Refresh** asks the database again at once, and a different period or a
  different site is always its own read.

## Related

- [CRM overview](./overview.md)
- [Deals pipeline](./deals.md) — the stages and probabilities the pipeline and forecast figures read
- [Tasks & follow-ups](./tasks.md) — the views the task counts mirror
- [The contact record](./contact-record.md) — the lifecycle stages the funnel is built from
