---
sidebar_position: 3
title: POS & reservations
description: Sell in person from the console register and take date-range reservations with deposits.
---

# POS & reservations

:::info Plan availability
POS requires **Pro** or above. The number of **registers** a site can run at
once follows your plan — Pro 1, Business 2, Advanced 5 — plus any $89/mo
register seats you've assigned to **that site**. A seat is bought once for the
workspace and then placed on one site, so buying one does not raise the limit
everywhere; see [Assigning register seats](../../workspace-and-billing/billing-and-plans/add-ons.md#assigning-register-seats).
Opening more browser tabs does not give you more registers; each sale runs
through a register you've created.
:::

![The point-of-sale page](/img/commerce/pos-page.png)

## Registers

Create your registers under **Commerce → Settings → POS registers** — one
per till or device that takes in-person payments. Give each a name (and,
if you use inventory locations, the location it sells from). Every POS sale
is tagged with its register so you can reconcile end-of-day takings per
till. Your plan caps how many registers you can run; add more with the
[register add-on](../../workspace-and-billing/billing-and-plans/add-ons.md) in
Billing. If you downgrade below your register count, the
extra registers (newest first) stop taking payments and show **Over plan
limit** until you remove them or upgrade again — none are deleted.

## The register

Open **`/{site}/pos`** in the console for a touch-first register. Pick which
register you're on at the top of the panel (skipped automatically when you
have only one):

- **Product grid** — tap to add; products with variants show quick chips.
- **Barcode scanners** — any keyboard-wedge scanner works: it types the
  code into the search box and presses Enter, which adds the exact
  SKU/barcode match. No drivers or pairing needed.
- **Payments** — cash (with change calculation), **card via QR** (the
  customer scans and pays on their phone; the sale completes
  automatically), or **charge to room** for checked-in reservation guests.
  Stripe Terminal readers can replace the QR step later without changing
  the flow.
- **Receipts** print through the browser's print dialog — any receipt
  printer with a system print driver works. Set the paper size to your
  roll width once and the browser remembers it.

POS sales create normal orders tagged `pos`, decrement the same inventory
as your online store (per location if you use locations), and appear in
the orders list under the channel filter.

### Platform fees at the register

Your plan's platform fee is charged on the **sale**, not on how it was
paid — the rate is the same whether the customer hands you cash, scans the
QR, or charges it to their room. What differs is only how it reaches us:

| Tender | How the fee is collected |
| --- | --- |
| Card (QR) | Deducted from your Stripe payout for that sale |
| Cash | No payout to deduct from — added to your next monthly invoice |
| Charge to room | Same as cash: added to your next monthly invoice |

The customer never pays the fee, and the amount **Due** on the register is
the same on every tender. On plans with a 0% fee there is nothing to
collect either way. See
[Billing & plans](../../workspace-and-billing/billing-and-plans/overview.md#platform-fees)
for your plan's rates.

### Selling past the count

If a line is for more units than the count says are on the shelf, the
register says so under that line — **"Only 1 in stock — selling 2"** — and
**still lets you take the sale**. The shelf is the truth at a counter: if
the item is in your hand it exists, whatever the number says. Your managers
are notified of the shortfall so the count can be corrected afterwards with
a stock adjustment.

Products set to **allow backorders** never show this, because selling past
zero is what that setting asks for. Products with stock tracking switched
off have no count to be short against.

Online checkout is different: there, a product set to **deny** out-of-stock
purchases really does refuse.

### When something disconnects

- If the QR payment page fails to load, cancel and retake the payment —
  pending card sales never decrement stock until paid.
- Cash sales need no network round-trip beyond saving the order; if the
  console loses connection entirely, note sales on paper and enter them
  when back online (an offline queue is on the roadmap).

## Reservations

For stays (cabins, rooms, rentals):

1. Add **resources** on the Products page — nightly rate, weekend
   multiplier, minimum nights, deposit percent, and free-cancellation
   window.
2. Drop the **Reservation widget** on any screen in the besigner and point
   it at the resource id. Guests pick dates, see a live quote, and pay the
   deposit (or full amount) at checkout.
3. Manage stays from the **Reservations** card: check in, check out
   (with a folio summary if the guest charged store purchases to the
   room), walk-ins, no-shows, and cancellations.

:::info Deposits need a plan with commerce
Taking a **reservation deposit** is a sale, and it is checked against your plan
at the moment a guest tries to pay — not just when you added the widget. On a
plan without commerce the widget still renders but checkout answers
"Reservations are not enabled". Enabling the plugin is your switch; including
commerce is your plan's. See
[downgrading](/workspace-and-billing/billing-and-plans/downgrading-and-canceling#what-changes-on-a-downgrade).
:::

## Related

- [Commerce overview](overview.md)
- [Product catalog](catalog.md)
