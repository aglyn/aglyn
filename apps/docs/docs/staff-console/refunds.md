---
sidebar_position: 10
title: Refunds
description: Refunding an organization's subscription charge from its org page — who may issue one, what the confirmation states, why a refund is a loss rather than a reversal, and the audit row it writes.
---

# Refunds

:::warning Aglyn staff only
This card lives on **Staff → Organizations → _the organization_** and requires a staff
claim. Reading the refundable charges is open to every staff role; **issuing** a refund
requires the `super` role.
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

## Who can refund {#who-can-refund}

| Action | Role |
| -- | -- |
| See the charges and how much is already refunded | any staff |
| Issue a refund | `super` only |

Issuing is `super` because it is the only staff action that sends money *out* — the same
bar as publishing a feature flag or managing users. Support staff still see the whole
card, because "how much of this invoice is already refunded" is a support question they
should be able to answer without escalating.

The role is enforced **on the server**, in the route that talks to Stripe. The button is
also wrapped for the role that cannot press it, but that is courtesy, not the control:
a client-side gate is not a gate.

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
