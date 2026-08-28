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

September 2026 is Aglyn's own first taxable month, and it is a **setting**, not a fixed
floor. An operator whose obligation began earlier sets **Earliest filable period** in
[Where this deployment files](#where-this-deployment-files) and the menu offers their
periods instead. The page reads that setting before it builds the menu, so the floor is
right on first paint.

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
| **Billed without automatic tax** | Charged before its subscription gained tax behavior. If the buyer is in Texas, tax was under-collected and is still owed — Aglyn pays it out of the receipt. |
| **Tax but no stated base** | Tax was collected, but no line says what it was charged on, so the row adds nothing to Taxable sales. Derive the base by hand (80% of the charge) and add it. |
| **No readable address** | The row is bucketed under `unknown` and is *not* in the Texas figures. If the customer is in Texas, the return understates the tax due. |
| **Not in US dollars** | Summed at face value alongside dollar rows. Convert before relying on the totals. |
| **No paid date** | Period assignment fell back to the query bounds, so the row may belong to a neighboring period. |

A clean period says so explicitly — "every row read cleanly" — so that silence is never
mistaken for a passing check.

## Where this deployment files

**Staff → Platform settings → Sales tax filing.** Reading it needs any staff role;
changing it needs **super**, and every change is written to the audit log with the
reason you type.

| Field | What it is |
|---|---|
| **Jurisdiction** | A country, and a subdivision only if you file at that level. It is looked up as a key in the return's own buckets — `US-TX`, `US-CA`, `GB`, `DE` — so a value that cannot be a key is refused here rather than discovered later as a page of zeros. |
| **Registration number** | The number the authority knows you by: a Texas taxpayer number, a seller's permit, a VAT number. |
| **Filing credential** | The filing-portal number, where the authority issues one. Required alongside the registration number for `US-TX`, because the Comptroller's eSystems authenticates a profile with both; optional everywhere else, since most authorities issue one number. |
| **Earliest filable period** | When your collection obligation began, as `YYYY-QN` or `YYYY-MM`. The period menu offers nothing earlier. |

The country list is derived from the runtime's own region data rather than checked in,
so it does not go stale. Subdivisions are **typed, not picked** — no runtime enumerates
them, and a half-populated dropdown would be worse than an honest text field. Use the
code that appears on buyer addresses (`TX`, `CA`, `NSW`). A country-only key is the
right answer for most authorities.

### Which layer is in force {#tax-filing-precedence}

There are two places these values can come from, and the card says which one won for
every field.

1. **This console wins.** Anything stored here is in force.
2. **The environment is the bootstrap.** `AGLYN_TAX_JURISDICTION`,
   `AGLYN_TAX_REGISTRATION_ID` and `AGLYN_TAX_FILING_ID` (and the deprecated
   `TX_TAXPAYER_NUMBER` / `TX_WEBFILE_NUMBER`) fill in every field the console has not
   stored, which is what a fresh install runs on before anybody opens this page.

Each field carries a chip reading *From this console*, *From the environment* or *Not
set*, and a variable that is set but outranked is listed by name under **Set in the
environment, not in force**, with the reason. That exists for one failure: editing
`.env`, shipping it, seeing nothing change, and having no way to discover that a stored
value won.

**Clear and use the environment** removes the stored record and hands the environment
its layer back. It is audited like any other change.

One guard sits on top of the rule: an environment identifier applies only while the
jurisdiction in force is the one those variables were configured for. Move the
jurisdiction in the console and the bootstrap numbers stop applying — one authority's
registration number is never filed under another.

### What the console will not show you {#tax-filing-secrecy}

The registration number reports as configured with a last four. The filing credential
reports as configured and nothing more: a Texas Webfile number is six digits behind a
fixed prefix, so a last four of it would narrow the secret to a hundred candidates
rather than mask it. There is no reveal. The numbers are write-only here — type a new
one to replace it, leave the field blank to keep what is stored — and the audit log
records that an identifier changed, never what it changed to.

The one surface that prints them in full is this return page, at the moment they are
transcribed onto a filing, and it is behind the same staff gate.

## The figures

The **Form 01-114 figures** card is Texas only. Aglyn sells everywhere; a Texas return
reports Texas receipts, so these lines come from the Texas jurisdiction bucket and never
from the platform totals.

The card names the jurisdiction it is for, and so does the page heading and the chip
beside the period menu. Where a deployment files is configured in
[Where this deployment files](#where-this-deployment-files).

Texas is the one jurisdiction with a form this software knows, so it is the one that
gets Form 01-114's own lines. Any other jurisdiction gets a **return breakdown** — the
same period, gross, taxable base and tax collected, split by the destination region the
tax was computed for — labeled on screen and in the export as raw material for filing by
hand. It is deliberately not dressed as a return: the platform knows what it collected
and where, and it does not know another authority's form.

A jurisdiction code that cannot match a bucket at all makes every figure read `0.00`, so
it is raised as a **blocking** finding rather than filed as a quiet zero.

The registration identifiers are configured in the same place. This page is the one
surface that prints them in full, because it is the one place they are transcribed onto
a return. With none of them set the page says so and names what to set, and the export
writes `NOT CONFIGURED …` rather than a blank cell someone files from.

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

## Aglyn's own sales by jurisdiction

Every buyer state in the period, Texas first — for **Aglyn's own** subscription and
add-on revenue.

Texas is the return. The other rows are the audit trail for why the rest of the
period's revenue is *not* on the Texas return.

Rows with no readable billing address appear as `unknown` and are flagged.

:::caution This table is not the nexus list
It used to say it was. It reads `platformRevenue` — Aglyn's own invoices — so it
cannot answer a question about what Aglyn facilitated for its merchants. For that,
read **Facilitated sales by buyer state** below. The two are different taxpayers'
money and are never summed.
:::

## Facilitated sales by buyer state

Aglyn is a marketplace facilitator, so each state asks the same question: how much did
you facilitate into me, and in how many transactions. This table, in the storefront
commerce card, is the answer — merchants' storefront sales grouped by where the shopper
was.

It **sums all three liability buckets**, on purpose. A threshold counts the sale
whoever remits the tax, and reading only the Aglyn-liable rows would under-report
exactly the states worth watching: the ones where Aglyn collects nothing today. Who
remits is still on each row, as *Of which Aglyn owes*, so the nexus question and the
"what do we owe" question never blur together.

**Texas is not read off this table.** A Texas LLC has no in-state economic-nexus
threshold, so the Texas obligation is unconditional from 2026-09-01 whatever the
figures say. The table is for *other* states.

:::warning These figures are a lower bound
A storefront sale that collected no tax at all files no tax row, so it does not appear
here — and that is precisely the population a nexus check wants to see. Treat a state's
total as a floor, never a measurement. Recorded on AGL-1956.
:::

A state showing sales and no tax collected is flagged **No tax collected**. That is the
row to check a threshold against.

## Exporting the working papers

**Export working papers (CSV)** downloads a self-contained record of the period:

- the period and its exact UTC bounds, the filing jurisdiction, and the registration
  identifiers configured for it;
- the filing figures — the Webfile lines for Texas, the return breakdown elsewhere;
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
