---
sidebar_position: 10
title: Revenue
description: What Aglyn earned — contracted plan value and settled Stripe cash side by side, the gap between them broken into named causes, and every deduction between gross and net.
---

# Revenue

:::warning Aglyn staff only
This page lives at **Staff → Revenue** and requires a staff claim. It is read-only:
it reports and writes nothing, to Firestore or to Stripe.
:::

Revenue has two honest meanings and they rarely agree. **Contracted** is what the book
bills — plan price times live subscriptions, plus add-ons, net of discounts — and it
reflects a signup the moment its subscription mirror lands. **Settled** is money Stripe
actually collected. This page shows both, and treats the difference between them as the
main result rather than as an error.

## The two bases

Pick a month or a quarter from the **Period** menu.

**Settled** figures are ranged over that period: paid invoices on Aglyn's own account,
marketplace sales, and storefront orders that settled between the period's start and end.

**Contracted MRR is not ranged.** It is what the book bills *today*, because a past
period's contracted value is not recoverable from current org documents — plans, add-ons
and discounts change, and filtering on a creation date would report today's prices
against yesterday's customers. The two columns therefore answer different questions and
should not be subtracted directly. Use the gap section, which compares like with like.

A quarter cannot answer the unbilled-metered-usage question, because the usage rollup
keys on a single month. Select a month to see that figure.

## How each org is treated

A plan tier is not a price. The page states each case rather than leaving it in the code:

| Org state | Contracted | Settled |
| --- | --- | --- |
| Active and collecting | counted | counted |
| Trialing | counted | $0 |
| Past due | counted | $0 |
| Comped / staff override | $0 | $0 |

**Trialing** orgs are counted as contracted because the subscription is real; they settle
nothing until the trial converts, which is not a failure.

**Past due** orgs are counted as contracted because the money is genuinely owed — Stripe
is still retrying the card. This is dunning, and it is the most actionable line on the page.

**Comped orgs** — an org sitting on a paid plan with no Stripe subscription behind it,
typically from a staff plan override — contribute **$0 to both bases**, with no dollar
figure attached at all. Pricing a comp off the plan table would invent revenue that never
existed, which is exactly the mistake this page is built to avoid: a staff override writes
the plan field and never writes a subscription, so the plan field alone cannot tell a
comped org from a paying one.

The same applies to an org on a 100%-off coupon (bills $0), an enterprise org on a
negotiated rate (bills that rate, not the plan's list price), and an org carrying add-ons
the plan price does not include. Every figure on this page is derived from the Stripe
subscription mirror.

## The gap

The gap compares **contracted MRR for the orgs that should be collecting** — total
contracted, less trialing and less past-due — against **subscription cash that actually
settled**. Marketplace and storefront commission are excluded from both sides so the
comparison is like for like.

A positive gap means money was contracted and did not arrive. The named causes are:

- **Past due** — owed, unpaid, Stripe retrying.
- **Trialing** — settles $0 by design.
- **Refunded and charged back** — a loss (see below).
- **Metered usage measured but never invoiced** — the nightly rollup priced the usage and
  the meter event never reached Stripe. This is a leak, not a timing difference; check
  **Maintenance** for a blocked sweep.

Anything left over appears as an **unexplained residual**. It is shown rather than
absorbed. A large residual usually means a mid-period signup, cancellation or proration —
things a monthly run-rate cannot express — or an invoice not yet paid. Investigate it.

Discounts are reported as context but are **not** subtracted from the gap: contracted MRR
is already net of them, so counting them again would double-explain the difference.

## Where the money came from

Earned revenue by source. Every line is already net of the thing that would overstate it:

- **Subscriptions, add-ons and metered usage** — paid invoices, net of sales tax and of
  every reversal. Add-ons and metered usage bill as lines on these same invoices, so they
  are already inside this figure. Summing the usage rollup beside it would double-count.
- **Marketplace commission** — the platform's cut, at the rate resolved from the seller's
  entitlements when each sale settled, net of refunds. The buyer's gross and the
  publisher's transfer are excluded; that money is the publisher's.
- **Storefront commission** — the advertised take, net of refunds, with Stripe's card
  processing removed.

## Gross versus net

Three deductions stand between money moving through Stripe and money Aglyn keeps.

**Sales tax is never revenue.** It is collected, held and remitted to the state.

**Refunds and disputes are a loss, and always were.** Stripe does not return its
processing fee when a charge is refunded, and a lost dispute costs a further fee on top of
the reversed amount. The true cost of a reversal is therefore *higher* than the figure
shown. A "gross revenue" that ignores reversals is not a simpler truth, it is a wrong one.

**Card processing passed through at cost is not revenue.** The platform fee on a storefront
sale is the advertised take *plus* Stripe's processing cost:

```
fee = take%(goods) + processing%(charge) + 30¢
      └─ Aglyn ──┘   └──── Stripe, at cost ────┘
```

Every storefront charge is a destination charge, so Stripe moves the whole amount to the
merchant and debits its processing fee from **Aglyn's** balance. The pass-through half of
the fee recovers exactly that. Reporting the whole fee as earnings would overstate margin
on every storefront sale, and on a small order would report the 30¢ Stripe just took as
money Aglyn made. Only the take reaches the earned column.

The pass-through is priced at the dearest enabled payment method's rate, because that is
the rate the fee was charged at and the shopper chooses how to pay after the session is
created. On a card-family order the real cost is lower, so the take is **understated**
rather than overstated — the safe direction.

### Three costs the page flags but does not net out

- **Marketplace processing.** Marketplace checkout is a destination charge with a fixed
  transfer and deliberately no application fee, so the sales tax stays with the platform
  that owes it. The consequence is that Stripe's processing fee comes out of Aglyn's
  balance with nothing recovering it, so marketplace commission is **gross** of that cost.
  An estimate is shown as a warning chip.
- **Storefront subscription renewals.** Stripe subscriptions accept only a fee
  *percentage*, which cannot carry a fixed 30¢, so that path never got the processing
  recovery. Aglyn absorbs the card cost on those renewals; the count is shown.
- **Internal traffic.** Aglyn's own tagged purchases are real charges that really settled,
  so they are **included** in the totals — dropping them would make this page disagree
  with Stripe's own balance. They are surfaced separately because analytics excludes them.

## Rows that need attention

The page raises a banner when a figure cannot be trusted as a total:

- **Lower bound** — a sweep hit its row cap. Narrow the period; do not quote the numbers.
- **Storefront orders could not be read** — the query failed, so a $0 storefront commission
  means "not counted", not "no sales". Usually a missing collection-group index.
- **Invoices with no payment date** — a date-range query cannot match a row whose timestamp
  is empty, so those invoices are invisible to every period and settled revenue is short
  by them.

## Related

- [Staff console overview](./overview.md) — the MRR tile links here.
- [Sales tax return](./sales-tax-return.md) — the same invoice records, asked what is owed
  to the state rather than what Aglyn earned.
