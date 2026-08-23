---
sidebar_position: 10
title: Refunds
description: Refunding an organization's subscription charge from its org page — how much each staff role may refund before it escalates, why a refund is a loss rather than a reversal, and the audit row it writes.
---

# Refunds

:::warning Aglyn staff only
This card lives on **Staff → Organizations → _the organization_** and requires a staff
claim. Reading the refundable charges is open to every staff role. **Issuing** one is
open to every staff role too, **up to a limit** — above it, the refund needs the `super`
role. See [How much you can refund](#how-much-you-can-refund).
:::

A refund used to mean leaving Aglyn for the Stripe dashboard. That worked, but the only
record it left was Stripe's — an actor, an amount, and nothing about *why*. Every other
money-adjacent action on the org page (the plan override, the discount, suspension)
writes an audit row with a reason; the largest one wrote nothing. The **Refund a charge**
card closes that.

## Where it is {#where-it-is}

Open **Staff → Organizations**, pick the organization, and scroll to
**Refund a charge** — directly under **Billing history & payment method**. That
placement is deliberate: the charge you are about to refund is almost always the one you
were just reading about, so you never have to copy a charge id from one screen to
another, and you never have to paste one from Stripe.

The card lists the organization's most recent charges with, for each one, what it
captured, what is still refundable, and the processing fee Stripe kept. Select a row to
refund it.

If the organization has never subscribed, the card says so. If Stripe could not be
reached, the card says **that** — it never renders a lookup failure as "nothing to
refund", because those two facts send an operator in opposite directions.

## How much you can refund {#how-much-you-can-refund}

| Action | `support` / `billing` | `super` |
| -- | -- | -- |
| See the charges and how much is already refunded | yes | yes |
| Issue a refund, per refund | up to **$150.00** | any amount |
| Issue refunds, per rolling 24 hours | up to **$500.00** | any amount |

This started out `super`-only, and it changed for an operational reason: the person a
customer actually reaches is support, and making them escalate a $12 refund means the
customer waits on one person's availability. A control that turns every routine refund
into a queue is a control people route around.

**There is no second approver.** That is a deliberate decision, and it is why there are
*two* limits rather than one.

- **$150.00 per refund** covers a full month on every plan a customer can sign up to
  self-serve, with headroom for tax and proration. It stops at the two things worth a
  second pair of eyes: an **annual** term, which is billed twelve months up front, and
  the largest accounts. "One month of a mainstream plan" is a transaction. "A year up
  front" is a decision.
- **$500.00 in a rolling 24 hours, per person** is what stops the first limit being
  defeated by arithmetic. Without it, a $600 annual charge is four $150 refunds — each
  one legal, and together landing exactly where the escalation existed to stop them. The
  window is *rolling*, not a calendar day, so it cannot be doubled by refunding at
  23:59 and again at 00:01.

Neither number is a target. $500 a day is far above any plausible day of support volume,
and it exists to bound what a mistake or a compromised session can give away. Raise it
as volume grows — it lives in one place, `apps/console/constants/refund-authority.ts`,
and the console reads the same numbers the server enforces.

### You see your limit before you type {#you-see-your-limit}

The card states your own allowance above the form, counting **down** as you spend it, so
you never fill in a charge, an amount and a reason only to be told your role could not
have done it. A charge larger than your per-refund limit says so on its own row, and the
Amount field carries the refusal — with the same sentence the server would have used —
if you type past it.

If the card could not read your remaining 24-hour allowance, it says that too rather than
showing a full one.

### It is enforced on the server {#enforced-on-the-server}

Both limits are checked **in the route that talks to Stripe, before Stripe is called**.
The console's disabled button is so you are not refused after doing the work; it is not
the control. A client-side cap is not a cap.

Two consequences worth knowing:

- If the 24-hour ledger cannot be read, the refund is **refused**, not allowed. The cap
  is the only control on the largest staff action there is, so an outage must not
  quietly lift it. Nothing is charged or refunded; retry, or ask someone with `super`.
- A refund that **Stripe** refuses does not spend your daily allowance. No money moved,
  so nothing was used up.

## Issuing a refund {#issuing-a-refund}

1. **Select the charge.** The row shows what is left to refund.
2. **Enter an amount, or leave it blank for the full remaining amount.** Partial refunds
   are supported; you may issue several partials against one charge until it is
   exhausted. Typing `0` is rejected rather than read as "everything".
3. **Pick a reason.** The set is fixed so a quarter's refunds read as a distribution:
   duplicate charge, billing error on our side, outage or service failure, goodwill or
   retention, cancellation of an unused period, fraudulent or unauthorized charge, or
   **other**. `other` will not submit until the note says what — it is the escape hatch
   that stops staff picking the nearest wrong code, so it is the one code that requires
   an explanation. The note is internal and is never shown to the customer.
4. **Confirm.** The dialog names the amount, the currency, the charge, the invoice, what
   the charge originally captured, how much of it is already refunded, and the fee Stripe
   keeps regardless. You must **type the amount** to confirm. There is no single-click
   refund from a list row, by design.

A refund cannot be undone from Aglyn. If you refund too much, the only remedy is to
charge the customer again — so read the confirmation rather than dismissing it.

## A refund is a loss, not a reversal {#a-refund-is-a-loss}

**Stripe does not return its processing fee on a refunded charge.** Refund $100 and the
customer gets $100 back while Aglyn is out $100 *plus* the fee Stripe already took. A
lost dispute costs more still, because it adds a dispute fee on top.

This is settled policy, not a bug to be fixed later: refunds and disputes are a loss and
always were. The card therefore shows the **actual** fee Stripe took on that specific
charge — read from the charge's balance transaction, not estimated from a rate card —
beside the amount, *before* you click. The rate varies by card, currency and country, and
a number you can reconcile against the Stripe dashboard is worth more than a plausible
one you cannot.

## What it refuses, and why {#what-it-refuses}

The route refuses these before any money moves, and says which:

- **A disputed charge.** While a chargeback is open the bank has already pulled the
  funds. A refund that landed anyway would pay the customer twice — losing the refund
  *and* the dispute plus its fee. Respond to or accept the dispute in Stripe first, then
  refund any remainder once it settles.
- **A charge belonging to another customer.** The page names the organization and the
  request names a charge; this is what stops a charge id from a different customer —
  pasted, stale or crafted — being refunded through this org's page and audited against
  the wrong organization.
- **More than is left.** Stripe caps over-refunds server-side too, so a partial that
  would take a charge past what it captured is refused rather than half-applied.
- **A fully refunded charge**, and a charge that never captured.
- **A duplicate submit.** A double click, or a retry after a lost response, is deduped
  per attempt. A second *legitimate* partial on the same charge is not affected.
- **More than your role may refund.** Over your per-refund limit, the refusal names the
  amount and says to ask someone with `super` — rather than splitting it, which the
  24-hour ceiling refuses anyway. Over your remaining 24-hour allowance, the refusal
  names how much is left. Both come *before* the attempt is claimed, so correcting the
  amount and submitting again works normally.

When Stripe itself refuses, the attempt stays retryable — no money moved, so nothing is
stranded.

## What is recorded {#what-is-recorded}

Every settled refund writes one `adminAudit` row with `action: 'org.refund'`, targeting
`orgs/{orgId}`, readable in the staff **audit log viewer**:

- **who** — the acting staff uid
- **when** — a server timestamp
- **why** — the reason code, plus the note
- **against what** — the charge id and the invoice id
- **the money** — what the charge captured, what was already refunded before this one,
  the amount refunded now, the resulting cumulative total, and the fee Stripe kept
- **on whose authority** — `actorRole` (the role held at the time), `authority`
  (`capped` or `super`), `overCap` (whether the amount was one only `super` could have
  issued), and `capCentsAtTime` (the limit in force when the row was written)

`overCap` is the field to query. It separates a refund that **needed** the escalation
from a routine one — a `super` refunding $50 is an ordinary refund, and `authority`
alone cannot say so. `capCentsAtTime` is recorded so that raising the limit later does
not silently reinterpret the rows written under the old one.

The fee is recorded rather than re-derived, so a later margin or churn review reads the
true cost off the row instead of going back to Stripe months afterwards.

The reason is validated *before* Stripe is called. There is no path that moves money and
then discovers the record is blank — the audit row is append-only and cannot be
corrected later, which is exactly why the dialog will not submit without one.

## Where it shows up in revenue {#in-revenue}

You do not have to do anything for a refund to reach [Revenue](revenue.md). Stripe emits
`charge.refunded` for a refund whatever issued it — this card or the Stripe dashboard —
and Aglyn's billing webhook records the cumulative refunded amount against that invoice's
revenue row. **Staff → Revenue** then reports it under **less refunds and lost disputes**,
subtracted from settled subscription revenue, with the lost-dispute share kept separate
from voluntary refunds so the two are never confused.

Two consequences worth knowing:

- The refund card writes **nothing** to the revenue mirror itself. Both surfaces derive
  from Stripe, through the webhook, so they agree by construction rather than by two
  systems being kept in step.
- A refund appears in Revenue when the webhook lands, which is usually seconds but is not
  synchronous with the click. The org page's own invoice list refreshes immediately.

## What this is not {#what-this-is-not}

This card refunds **Aglyn's own subscription charges**. It is not the marketplace or
storefront refund path: those refund an *order* on a merchant's connected account, where
the transfer to the merchant and Aglyn's commission have to unwind together, and they are
issued from their own surfaces.

It also does not cancel anything. Refunding the last invoice does not end a subscription,
change a plan, or release entitlements — use the entitlement editor or the plan controls
on the same page for that.

## Related

- [Revenue](revenue.md)
- [Staff console overview](overview.md)
- [Sales tax return](sales-tax-return.md)
