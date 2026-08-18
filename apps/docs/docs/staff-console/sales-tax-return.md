---
sidebar_position: 9
title: Sales tax return (Texas)
description: The quarterly Texas return — pick a period, read the Form 01-114 figures, check the rows that need attention, and export the working papers.
---

# Sales tax return (Texas)

:::warning Aglyn staff only
This page lives at **Staff → Sales tax** and requires a staff claim. It is read-only:
it computes and exports, it never files. Filing happens at the Comptroller's Webfile.
:::

Aglyn's Texas registration declares a **first taxable sales date of 2026-09-01** — the
public beta date — so from that day there is a Texas sales tax collection obligation on
Aglyn's own revenue. The billing webhook records one `platformRevenue` row per paid
invoice; this page turns a period's worth of those rows into the figures the return
asks for.

Filing frequency is **quarterly**, following the registration's declared "anticipated
monthly taxable sales under $8,000".

## Choosing the period

The **Period** menu lists every quarter and every month from September 2026 to the
present, newest first.

- **Quarters** are the normal choice — they are the filing periods.
- **Months** are there for two reasons: if the Comptroller reassigns Aglyn to monthly
  filing, and as the way to narrow a quarter that exceeded the row cap (see below).

Nothing before September 2026 is offered. There was no collection obligation then, so
an earlier period is not a period that can be filed — it is only a period that can be
picked by mistake.

The page defaults to the most recent quarter that has **fully ended**. The current
quarter is still accruing, so its figures are a progress reading, not a return.

## Rows that need attention

This is the part to read first, and it sits above the figures deliberately.

The summary counts every row it could not fully read, rather than skipping it. An
undercount presented as a total is precisely the failure a filing record cannot have —
so the page states the count out loud and, when it is serious, says **do not file**.

**Blocking** findings mean the figures are wrong, not merely uncertain:

| Finding | What it means |
|---|---|
| **Period exceeded the row cap** | More invoices matched than the route returns. Every total shown is a *lower bound*. File a month at a time instead, or raise the cap in the route. |
| **Rows outside every period** | These invoices carry no readable paid date. A date-range query cannot match a null field, so these rows are missing from *this* return and from *every* other one — they are not merely in the wrong quarter. |

**Review** findings mean a human has to decide something:

| Finding | What it means |
|---|---|
| **Billed without automatic tax** | Charged before its subscription gained tax behaviour. If the buyer is in Texas, tax was under-collected and is still owed — Aglyn pays it out of the receipt. |
| **Tax but no stated base** | Tax was collected, but no line says what it was charged on, so the row adds nothing to Taxable sales. Derive the base by hand (80% of the charge) and add it. |
| **No readable address** | The row is bucketed under `unknown` and is *not* in the Texas figures. If the customer is in Texas, the return understates the tax due. |
| **Not in US dollars** | Summed at face value alongside dollar rows. Convert before relying on the totals. |
| **No paid date** | Period assignment fell back to the query bounds, so the row may belong to a neighbouring period. |

A clean period says so explicitly — "every row read cleanly" — so that silence is never
mistaken for a passing check.

## The figures

The **Form 01-114 figures** card is Texas only. Aglyn sells everywhere; a Texas return
reports Texas receipts, so these lines come from the Texas jurisdiction bucket and never
from the platform totals.

- **Item 1 — Total Texas sales.** Receipts excluding the tax itself, including the
  20% that [§151.351](https://statutes.capitol.texas.gov/Docs/TX/htm/TX.151.htm) exempts.
- **Item 2 — Taxable sales.** The base the rate was applied to: Stripe's
  `taxable_amount` summed, which is 80% of the charge under the data-processing
  position Aglyn files on.
- **Item 3 — Taxable purchases.** Shown as **not computed**. This is use tax on Aglyn's
  *own* purchases, which is not in the revenue records at all — take it from the expense
  records. It is stated as "not computed" rather than as `0.00` on purpose: a zero
  printed where nothing was derived is a claim this data cannot support.
- **Tax collected** is not a form line. It is what was actually charged to Texas
  customers, there to reconcile against the tax Webfile computes from Item 2. A gap
  between them is a real discrepancy worth understanding before submitting.

While a blocking finding stands, the figures render dimmed with a warning beneath them.
They are still shown — you need them to investigate — but they must not read as ready
to type in.

**Period bounds** echoes the exact UTC window swept, so a return filed today can be
reproduced from the same bounds a year from now.

## Refunds

Refunds are **stated, never netted out** of the figures above.

A revenue row keeps one cumulative refunded amount and only the *latest* refund
timestamp, so two refunds in different quarters cannot be told apart from the row
alone. Rather than silently misassign them, the page reports the refunds recorded
during the period with their tax share estimated at each row's own tax-to-gross ratio,
and leaves applying them to the preparer. At launch volumes this is an inspection, not
a computation.

## All jurisdictions

Every buyer state in the period, Texas first.

Texas is the return. The other rows are two things at once: the audit trail for why the
rest of the period's revenue is *not* on the Texas return, and the early-warning list
for economic nexus somewhere else — a state whose totals are climbing is a state worth
checking a threshold against.

Rows with no readable billing address appear as `unknown` and are flagged.

## Exporting the working papers

**Export working papers (CSV)** downloads a self-contained record of the period:

- the period and its exact UTC bounds, the taxpayer number and the Webfile number;
- the Webfile figures as filed;
- the refunds recorded, with their estimated tax share;
- **every finding**, with its severity — so the export of a qualified period carries
  that qualification, instead of a spreadsheet of clean-looking numbers;
- the full jurisdiction table;
- one line per invoice, in dollars, with its invoice id — so any figure on the return
  can be walked back to a specific invoice in the Stripe dashboard.

Keep the export. It is the contemporaneous record behind a filed return, and the
position Aglyn files under is documented rather than confirmed by a ruling — the working
papers are what make the position read as good faith later.

## Related

- [Staff console overview](overview.md)
- [Billing & plans](../workspace-and-billing/billing-and-plans/overview.md)
